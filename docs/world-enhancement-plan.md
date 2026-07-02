# World Enhancement Plan — multi-view harvest + Gemini restyle + tiered agents

Status: proposal (2026-07). Companion to `docs/netanya-world-workflow.md`, which stays the
canonical recipe; this doc describes the **next version** of steps 5–8 and the agent
architecture that runs them.

## Why

The Netanya pipeline works end-to-end (301 buildings, 178 road segments, one GLB, one draw
call), but three things cap its fidelity:

1. **One viewpoint per building.** `harvest-buildings.mjs` fetches a single 640×400 shot from
   the nearest pano aimed at the centroid. Trees, parked cars, fences and oblique angles mean
   the vision step often sees one facade badly and the other three not at all. (Manifest says
   279/301 "high" conf, but that measures pano *distance*, not how much of the building is
   actually visible.)
2. **A 13-field spec is the ceiling.** `spec-work/INSTRUCTIONS.md` reduces each building to
   `floors/wall/roof/cols/balconies/...`. `house-factory.js` can only express what the spec
   carries, so every house is a box with a window grid — real streets have gates, stone fences,
   pergolas, arched windows, setbacks, garages, hedges. None of that survives the funnel.
3. **No feedback loop.** Nothing compares the baked street to reality. We verified *placement*
   (`verify-placement.mjs`) and *loadability* (`verify-ingame.mjs`) but never *likeness*.

The experiment that motivates this plan: taking a raw Street View photo and asking Gemini's
image model to **redraw it in the game's art style** (see `new_graphics_example.png` for the
target style) produces a street image with far more correct detail than our parametric bake of
the same street. The generated image is not directly usable as game geometry — but it is a
perfect **normalized reference**: trees/cars/lighting removed, style unified, detail preserved.
That gives us both a much better input for spec extraction and, for the first time, a ground
truth to score our bake against.

## Overview of the upgraded pipeline

```
5.  harvest-views.mjs        multi-pano, multi-heading harvest (buildings + street strips)
5b. gemini-restyle.mjs       raw photo(s) -> game-style "canonical" image per building/street
6.  make-spec-chunks.mjs v2  chunks now carry N views + restyled image per building
7.  vision fan-out v2        tiered agents write spec v2 (richer schema)
8.  build-world-from-specs   house-factory v2 + prop-factory consume spec v2
8b. street-critic loop       game screenshot vs restyled reference -> overrides -> rebake
```

Everything stays `--world=<name>`-parameterized through `world-config.mjs`; new paths to add
there: `views/` (multi-view photos), `restyled/`, `props.json`, `critic-work/`.

---

## A. Multi-viewpoint harvest (`harvest-views.mjs`)

Replace the one-shot harvest with a coverage-driven one. Per building:

- Query Street View **metadata** at 3–5 probe points instead of one: the centroid probe (as
  today) plus points on the nearest road polyline (`roads.json` is already in world XZ —
  reproject to lat/lon with `projection()` inverted) offset ±25 m along the road. Dedupe by
  `pano_id`.
- Keep the 2–3 panos with the best angular spread around the building (front + two obliques).
  For each, fetch 640×**640** (max Static API size, we currently waste the free pixels).
- Record per-view `{pano_id, date, dist, heading, fov}` in `building-views.json`. Prefer the
  **newest** pano date when panos overlap — Netanya has multi-year coverage and facades change.

Per street ("context strips", the input for street-level restyle + props):

- Walk each road polyline from `roads.json`, drop a probe every ~30 m, fetch up to 3 headings:
  along-road (already done by `harvest-roads.mjs`), left-facing, right-facing.
- Only for segments within the **track corridor** (see prioritization below) to keep volume sane.

Also fetch one **satellite crop per building** (Static Maps API, zoom ~20) — roof shape/colour
and solar heaters are near-impossible to get wrong from above, and today they're guessed from
street level. `fetch-aerial.mjs` already has most of this code.

**Prioritize by what the player sees.** `track.json` gives the race line; compute each
building's min distance to it. Budget tiers:

| Tier | Definition | Views | Restyle | Spec |
|------|-----------|-------|---------|------|
| A | ≤ 60 m from track | 3 views + aerial | yes | spec v2, full |
| B | 60–150 m | 2 views | only if conf low | spec v2 |
| C | > 150 m (background) | 1 view (today's behaviour) | no | spec v1 defaults |

For Netanya that puts roughly a third of the 301 buildings in tier A — the ones that were worth
hand-tuning anyway.

## B. The Gemini restyle layer (`gemini-restyle.mjs`)

A plain Node script (no LLM agent involved — it's an API batch job with caching, same shape as
the harvest scripts). For each tier-A building / street strip:

- Call the Gemini image model (image editing / "nano banana" line — `gemini-2.5-flash-image`
  as of writing; confirm current model id at implementation time) with:
  - the raw Street View photo(s) as input image(s),
  - a **style anchor** image (a curated game screenshot — commit one per world as
    `maps/<name>/style-ref.png`; `new_graphics_example.png` is the current target look),
  - a fixed prompt: *"Redraw this exact scene as low-poly stylized game art matching the style
    reference. Preserve the building's true proportions, floor count, window layout, colours,
    roof shape, fences and gates. Remove vehicles, people, and foliage that blocks the facade.
    Neutral noon lighting."*
- Cache by content hash of (inputs + prompt) so re-runs are free, like the harvest scripts.
- Output `maps/<name>/restyled/bld_<id>.png` and `street_<road>_<k>.png`.

Three distinct uses for the output, in increasing ambition:

1. **Canonical view for spec extraction (do first, cheapest win).** The vision agents read the
   restyled image *alongside* the raw photos. Restyled images are de-noised and style-normalized,
   which is exactly what makes small/cheap vision models reliable (see tiering below). The
   INSTRUCTIONS get one new rule: *geometry/counts from the restyle, colours cross-checked
   against the raw photo* (the restyle can drift hues).
2. **Facade texture experiment (spike before committing).** For a handful of tier-A buildings,
   ask for a flat orthographic facade in the game palette, quantize it, and UV it onto the
   box mass in `house-factory` instead of built-up window geometry. If it reads well at kart
   camera distance, a per-world texture atlas likely beats geometry on both looks and GLB size.
   Keep it a spike: vertex-colour-only is a real virtue of the current pipeline (one material,
   one draw call) and we should measure before giving that up.
3. **Ground truth for the critic loop** (section D).

**Cost reality check** (at current Gemini image pricing, ~$0.04/image): ~100 tier-A buildings +
~150 street strips ≈ 250 images ≈ **$10 per world**, cacheable forever. Vision-agent cost drops
at the same time because cheaper models can do the extraction (below).

## C. Spec v2 + factory v2 — make the extra detail land in the GLB

A better reference is wasted if the spec can't carry it and the factory can't build it. Extend
in lockstep (all optional fields, so v1 specs keep baking — `merge-specs.mjs` clamps/validates
and fills defaults):

- **Spec v2 additions** (per building): `facades` (per-side window cols so the street-facing
  side is right even when sides differ), `windowStyle` (`plain|arched|horizontal`), `garage`
  (0–2 doors), `entrance` (`front|side|corner`), `masses` (1–2 extra boxes for setbacks /
  penthouse / attached wing), `fence` (`none|stone|hedge|metal`, drawn on the *lot* edge —
  Israeli residential streets are visually defined by their stone fences and gates more than
  by the houses), `awnings`, `palette` (2–3 hexes instead of one `wall`).
- **`house-factory.js` v2**: consume the above; also drop the OBB shortcut for tier-A buildings
  and always extrude the real footprint (`makeFootprintBuilding`) with windows distributed
  per facade segment.
- **New `prop-factory.js` + `props.json`**: street furniture spec'd from the street strips —
  fences/walls along lot lines, power poles (`new_graphics_example` shows how much poles/wires
  sell the look — and the current game screenshot already fakes them globally), bus stops,
  dumpsters, planters, road signs. Placed in world XZ, baked by `build-world-from-specs.mjs`
  like buildings are. The road strips' vision pass fills `props.json`; OSM already gives
  candidates (barrier=wall/fence, highway=bus_stop, amenity=waste_disposal) to seed it.

## D. The critic loop — the piece the pipeline never had

Close the loop using machinery that already exists (`verify-ingame.mjs` boots the real game
headless and screenshots via `window.__dbg`):

```
1. street-shots.mjs   place the in-game camera at each tier-A pano's true position/heading
                      (we stored pano lat/lon + heading in the manifest; project with
                      projection().toXZ) and screenshot -> maps/<name>/critic-work/game_<id>.png
2. critic fan-out     one agent per street: reads (game shot, restyled reference) pairs and
                      writes a diff list: {id, score 0-10, fixes:[{field, from, to, why}]}
3. apply              fixes land in building-overrides.json / props.json (the override
                      mechanism already exists), then re-run step 8 and re-shoot.
4. iterate            until median score plateaus (2-3 rounds in practice).
```

Two hard rules for the critic agents: fixes must be expressible in spec-v2 fields (no "make it
prettier"), and colour fixes cite the raw photo, not the restyle. Fixes that don't fit spec v2
get logged to a `wishlist.json` instead — that file becomes the prioritized backlog for the
*next* factory feature, which is how the factory grows by evidence instead of guesswork.

This loop is also the regression harness for any future `house-factory` change: re-run the
critic on Netanya after touching the factory and the score tells you if you got better or worse.

---

## E. Agent architecture — Fable orchestrates, small models do the volume

Today step 7 is "Claude launches one subagent per chunk" with the orchestrating model doing
everything. Split by task difficulty; the restyle layer is what *makes* the cheap tiers viable,
because classifying a clean stylized image is a far easier vision task than peering through
ficus trees at 75 m.

| Role | Model | Why |
|------|-------|-----|
| **Orchestrator** — runs the recipe, spawns fan-outs, merges, adjudicates conflicts, edits factory code, runs the critic *apply* step | **Fable (main agent)** | Judgment, code changes, and cross-chunk consistency live here; it's also the only tier that should touch `index.html` wiring |
| **Bulk spec extraction** — per-chunk photo→spec v2, ~20 buildings/agent (~15 chunks for Netanya) | **Haiku** | Fixed schema + restyled canonical views = classification, not reasoning. Emits `conf` per building as today |
| **Road classification** — 5-way type + surface (existing `road-work` fan-out) | **Haiku** | Already a trivially easy task; never needed a big model |
| **Hard cases** — low-`conf` or validation-failed buildings, complex footprints (OBB fill < 0.88), towers; and the **street critic** diff agents | **Sonnet** | Needs multi-image comparison and spatial reasoning, but is still a bounded per-item task |
| **Escalation terminus** — buildings still inconsistent after Sonnet, cross-chunk style disputes (e.g. same street, clashing palettes) | **Fable** (inline, no subagent) | Rare by construction; keep it cheap by keeping it rare |
| **Restyle + texture generation** | **Gemini image model via `gemini-restyle.mjs`** | Not an agent at all — a cached batch script, like the harvest steps |

Escalation ladder, encoded in the fan-out driver: Haiku writes specs with `conf`; `merge-specs`
validation failures and `conf:"low"` items are re-chunked and sent to Sonnet; whatever survives
that lands on Fable's desk as a short exception list. Expected effect for a Netanya-sized world:
~90 % of vision tokens move to Haiku, the orchestrator reads **zero** routine photos, and total
LLM cost per world drops even though we're now reading 3–4 images per tier-A building instead
of 1.

The chunk protocol stays exactly as is (chunk JSON in, `specs_<k>.json` out, one-line reply) —
it was designed for fan-out and it's already model-agnostic. Only `INSTRUCTIONS.md` grows the
v2 fields and the "restyle for geometry, raw for colour" rule.

## F. Rollout

> **Status:** `harvest-views.mjs` and `gemini-restyle.mjs` are implemented (plus
> `projection().fromXZ` and the new paths in `world-config.mjs`). Dry-run numbers for Netanya:
> the auto race loop rings the whole neighbourhood, so **210/301 buildings are tier A**
> (90 B, 1 C) — ~811 building shots; strips cover 138/178 road segments at ~2 766 shots
> (trim with `--corridor`/`--limit`, or raise the 30 m sample spacing). Needs `GMAPS_KEY` +
> `GEMINI_KEY` in `.env`. First runs, small on purpose:
> ```bash
> node scripts/harvest-views.mjs --world=netanya --dry            # plan only, no key
> node --env-file=.env scripts/harvest-views.mjs --world=netanya --tier=A --limit=20
> node --env-file=.env scripts/gemini-restyle.mjs --world=netanya --limit=10
> node --env-file=.env scripts/harvest-views.mjs --world=netanya --strips --corridor=40
> node --env-file=.env scripts/gemini-restyle.mjs --world=netanya --strips --limit=10
> ```
> Then eyeball `maps/mishkenot_zvulun/restyled/` against the raw shots in `views/` before
> spending the full budget.

1. **Phase 1 — see it work end-to-end on one street.** Pick the start/finish straight of the
   Netanya track. `harvest-views` + `gemini-restyle` + hand-run one Haiku chunk with v2
   instructions + minimal factory v2 (facades, fences, garage). Success = a side-by-side of
   restyled reference vs rebaked street that's obviously closer than today's bake.
2. **Phase 2 — full tier-A corridor + critic loop.** All tier-A buildings, props along the
   track, 2 critic rounds. This is where the game visibly changes.
3. **Phase 3 — generalize.** Fold into the `--world` recipe (new-world cost stays ~$10–15 of
   Gemini + mostly-Haiku vision), update `docs/netanya-world-workflow.md`, and only then
   evaluate the facade-texture spike for tier-A.

New scripts: `harvest-views.mjs`, `gemini-restyle.mjs`, `street-shots.mjs`, `prop-factory.js`;
extended: `make-spec-chunks.mjs`, `merge-specs.mjs`, `house-factory.js`,
`build-world-from-specs.mjs`, `world-config.mjs` (new paths + `GEMINI_KEY` in `.env`).
