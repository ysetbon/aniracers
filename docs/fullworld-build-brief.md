# Full-World Build Brief — make ALL of Netanya/Mishkenot look like test3 (port 8090)

Written 2026-07-04 as the handoff for a fresh Claude Code session. Read this whole file
first. The method is proven on the T-junction (test3/test4); the task is to scale it to the
entire neighbourhood. Everything referenced here is committed on this branch.

## Goal
`?world=mishkenot` should read like the polished test3 look everywhere: warm daylight, muted
grass, tiled paver/asphalt roads with kerbs, articulated cream facades, and **trees placed
from aerial detection** — across all ~200 buildings and every street, not just the 16-building
T-junction. Judge by driving the real game (localhost) and comparing to `docs/target-street-image.png`
and the test3 hero frames (`maps/mishkenot_zvulun/art-match/hero_*.png`).

## The division of labour (user-decided — do not deviate)
> **Aerial = WHERE (positions). Street View→Gemini = WHAT it looks like (detail).**
- **Trees/vegetation → top-down AERIAL** auto-placement (the scale unlock; no hand-authoring
  ~185 buildings' env sections).
- **Buildings + small vertical objects (street signs, lamps, gates, bollards) → SV→Gemini**
  scene-faithful refs (`gemini-restyle-scene.mjs`, KEEP-EVERYTHING prompt — keeps cars/lamps/
  trees in frame; the old `gemini-restyle.mjs` deletes them, don't use it).
- Cars: position from aerial or SV, colour from SV.

## What ALREADY WORKS — reuse, do NOT rebuild
1. **Lighting** — `index.html` `buildMishkenotWorld()` sets ACES tone-map + warm hemisphere
   fill + a sun whose shadow frustum is aimed at the neighbourhood. Applies to EVERY mishkenot
   GLB automatically. This is why the game now matches the hero renders. Leave it.
2. **Facade trim (Pass 2)** — `scripts/house-factory.js` `makeBuildingV3` adds plinth, floor
   string-courses, corner pilasters, window sills/lintels. Applies to all v3 buildings on any
   rebake. Use `shade(c,dl)` not `dim()` for near-white walls (dim overflows getHex).
3. **Ground materials (Pass 1)** — `scripts/bake-tjunction.mjs` `bakeRoadPrepped()` tiles paver
   streets (grout base + per-tile jitter + grey centre band), bevels kerbs, paints red-white
   spans, and `bakeIslands()`/`bakeFurniture()` do islands/T-sign/lamps/bollards. Currently
   driven by `spec-work/scene-tjunction.json` (4 roads, 16 buildings).
4. **Aerial tree pipeline (test4 — PROVEN)** — three `--world=`-parameterized scripts:
   - `scripts/fetch-aerial-aoi.mjs --aoi=xW,xE,zN,zS --tag=NAME` → georeferenced Esri World
     Imagery (NO API key). Netanya's Esri ceiling is **~0.5 m/px** (finer → HTTP 500; the script
     auto-retries coarser). Writes `maps/mishkenot_zvulun/aerial/NAME.jpg` + `NAME-transform.json`.
     px↔world is pure-linear (this projection: x=lon-only, z=lat-only; PCX/PCZ≈0).
   - `scripts/detect-trees.mjs --tag=NAME [--debug]` → excess-green (2G−R−B) blob detection +
     connected components → `NAME-trees.json` (world XZ + radius + size-heuristic species).
     Rejects blobs inside building footprints (green roofs/pools). `--debug` writes a QA overlay.
   - `scripts/bake-test4.mjs` → clone of bake-tjunction that SKIPS hand-authored `tree_*` props
     and places aerial trees instead (roadway-culled). `?test4` wired in index.html.
5. **SV harvest + restyle** — `scripts/sv-keyless.mjs` (keyless Street View, free) and
   `scripts/gemini-restyle-scene.mjs` (needs `GEMINI_KEY` in `.env`). See the machinery table
   in `docs/t-junction-test-world-brief.md`.

## THE TASK — a full-world baker
Generalize the T-junction scene baker from "16 buildings + 4 roads" to "ALL buildings + ALL
roads", producing e.g. `assets/mishkenot/world_v4.glb`, wired to `?v4` (and consider making it
the default `?world=mishkenot` once it looks right). Steps:

### 1. Full-neighbourhood aerial + trees
- Compute the full AOI from `maps/mishkenot_zvulun/buildings.json` footprint extent (min/max
  x,z over all 301 footprints), padded ~15 m. Likely ~1 km across → one Esri fetch at 0.5 m/px
  is ~2000 px (< the 4096 cap), so a single `fetch-aerial-aoi.mjs --tag=fullworld` should cover
  it. If it exceeds 4096 px, tile it (add a tiling loop) and merge tree lists.
- `detect-trees.mjs --tag=fullworld --debug`; eyeball the overlay. Tune `--exg`/`--minA` for
  density. Expect several hundred canopies.

### 2. A full-world scene config
- Instead of the hand-written `scene-tjunction.json` (4 roads), auto-build the road list from
  `roads.json`: every drivable road (skip `type:path`), surface = paver vs asphalt from its OSM
  tags (paver streets are the raised terracotta ones — see how scene-tjunction picks them; the
  T-street north arm id 699330771 is paver). Kerbs on all; red-white paint only near junctions
  (optional first pass: skip paint, add later). Islands: keep the two hand-authored T-junction
  ones; others only if visible in aerial.

### 3. The baker
- Clone `bake-tjunction.mjs`/`bake-test4.mjs` → `bake-fullworld.mjs`. Loop ALL building IDs that
  have programs; for the rest, either (a) keep the existing spec-v2 geometry from `world_v3.glb`
  (surgical approach, like rebake-programs) and only ADD ground + aerial trees on top, or
  (b) author more v3 programs. **START WITH (a)** — dress the existing world: bake ground for all
  roads + aerial trees + scene furniture, and composite over the current `world_v3.glb` buildings.
  Only 16 buildings have v3 programs (all with facade trim); the other ~185 are spec-v2 with no
  trim — decide during the one-corridor validation whether they need rebuilding or just dressing.
- Keep the per-building `environment` non-tree props for the 16 that have them; everywhere else,
  rely on aerial trees + a light procedural hedge/verge pass until the SV pass fills in detail.

### 4. Small objects from SV (signs/lamps)
- Harvest keyless SV along each street (`sv-keyless.mjs --road=<id> --step=12`), restyle with
  `gemini-restyle-scene.mjs`, and place signs/lamps/gates per street. This is the slower,
  per-street layer — do it corridor by corridor.

## Recommended sequence (de-risk before going wide)
1. **Corridor first:** HaRav Toledano (road id `27204871`) + its ~30–40 buildings. Full chain:
   ground + trim + aerial trees + SV signs. Drive it; compare to 8090. Fix the baker.
2. **Then the whole hood** in one bake once the corridor reads right.

## Acceptance
Drive `?world=mishkenot&v4&dbg` end-to-end (real routing, not a --glb override). Every street
should have tiled/kerbed roads, cream trimmed facades, and trees at real positions; grass muted,
warm shadows. Shoot hero frames with `shoot-street.mjs --hero` and compare to target. Commit the
baked GLB (small, lets the user drive without rebaking — the project does this on purpose).

## Gotchas (each cost real time)
- **ArcGIS export 500s** on raw commas / png32 → URL-encode bbox+size, use `format=jpg`. And it
  500s if resolution is finer than ~0.5 m/px over Netanya → the fetcher auto-retries coarser.
- **Bake page runs in the browser** (puppeteer). Anything the in-page functions use must be
  injected via `JSON.stringify` like `JOBS`/`SCENE`/`TREES`; node-only helpers (e.g.
  `nearestRoad`) must run in node and pass results in (see how bake-test4 pre-filters trees).
- **Servers:** `:8080` (pre-existing) serves a STALE `.claude/worktrees/one-house-test-world`
  checkout — ignore it. Start your own: `PORT=8091 node server.js` from THIS checkout.
- **Worktree/branch:** this work is on branch `claude/mishkenot-fullworld-artmatch`. `.env`
  (GEMINI_KEY, GMAPS_KEY) is git-ignored — the online session needs its own `.env` with
  `GEMINI_KEY` for the SV restyle (Esri aerial needs no key). node_modules resolves via the repo.
- **Test-URL routing:** `index.html` substring-matches — check `test4` before `test3` before
  `test2`/`test1`; add `v4` similarly. Game needs `?world=mishkenot` to auto-start.

## State pointers
- Branch `claude/mishkenot-fullworld-artmatch`. Key commits: `6a96786` (test4 aerial trees),
  `0a6aad4` (live-game lighting), `1519164` (facade trim). PR #6 is the T-junction (test3) home.
- Drive today: `?world=mishkenot&test4` (aerial trees) vs `&test3` (hand trees) — the A/B.
- Aerial artifacts: `maps/mishkenot_zvulun/aerial/tjunction.{jpg,-transform.json,-trees.json}`.
- Memory: `fullworld-aerial-pipeline`, `test3-tjunction-artmatch`, `one-house-test-world`,
  `target-image-prop-research` (MEMORY.md index).
