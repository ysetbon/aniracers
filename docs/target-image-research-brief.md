# GOAL: make the T-street look EXACTLY like docs/target-street-image.png

Written 2026-07-03 as the handoff for the next session. The user's bar: the in-game frame
at the HaRav Toledano × HaRav Unterman T-junction (Mishkenot Zvulun, Netanya — spawn with
`http://localhost:8080/?v3&spawnat=126,-367`) must read as `docs/target-street-image.png`.

## What the target image contains (inventory to reproduce)

- **Vegetation (the dominant missing layer):** large faceted low-poly trees (trunk + 3-6
  angular canopy blobs, two greens), palm trees (segmented trunk + fan of flat fronds),
  trimmed hedge blocks along walls, small shrubs/agaves, a magenta bougainvillea mass
  climbing a wall (right side), potted plants at gates.
- **Planted traffic island** at the junction: grey stone kerb ring, grass, rocks, shrub
  cluster — sitting in the road fork.
- **Street furniture:** metal street lamp (curved head), blue square road sign with white
  "T" on a pole, background power poles.
- **Ground:** clean grey asphalt with lighter kerb bands, light paved sidewalk strips,
  BRIGHT green lawns (the neon green actually matches the image!), paved driveways.
- **Buildings (already covered by scene programs):** cream/white villas, low compound
  walls, orange hip roofs in the background, flat parapet roofs foreground.
- **Sky:** light blue with chunky low-poly clouds (game already has these).

## Current state (do NOT redo — it works)

The scene-program pipeline (docs/exact-geometry-program-plan.md) is BUILT and PROVEN:
- 16/17 T-street buildings + frontages baked from programs into assets/mishkenot/world_v3.glb
  (`node scripts/rebake-programs.mjs --world=netanya --ids=...`), pilot frame passed a
  7-iteration compare-and-refix loop (archived: critic-work/pass_bld_556597974.png).
- Factory v3 lives in scripts/house-factory.js (makeBuildingV3/makeFrontageV3).
- Programs in maps/mishkenot_zvulun/spec-work/programs/ (SCHEMA.md + 16 JSONs, colours
  pixel-sampled with scripts/sample-colors.mjs).
- Mishkenot world light recalibrated to neutral noon in index.html (critical — do not
  revert; the old rig tinted everything sage).
- Extraction agents left a factory BACKLOG in each program's "notes": picket/hedge/slat
  fence types, window bars, shutters, planters, canopies, terrace positioning.

What's MISSING vs the target image = the environment/prop layer (trees, palms, hedges,
bougainvillea, island, lamp, sign, driveway aprons, kerb bands) + per-frame refinement
loops for the 15 first-pass buildings.

## RESEARCH TASK for this session (user request: "maybe people did this exact task")

Search GitHub + the web for prior art before building more in-house. Two distinct bets:

**Bet 1 — free low-poly ASSET PACKS (highest expected value).** Nobody has "Gemini image
→ exact world", but the props in the target image are commodity low-poly assets:
- Kenney (kenney.nl) — CC0 "Nature Kit", "City Kit", "Suburb Kit": GLB/GLTF trees, palms,
  hedges, lamps, signs, rocks. Exact art style match (flat-shaded faceted).
- Quaternius (quaternius.com) — CC0 "Ultimate Nature", "Buildings" packs.
- Google Poly archive mirrors, OpenGameArt low-poly packs, "low poly tree pack" GitHub.
Evaluate: license (want CC0), format (GLB preferred), flat-shaded/vertex-colour
compatibility with our one-material world mesh (we merge everything through the
rebake collect() path which multiplies material.color into vertex colours — textured
packs need a conversion step), tri counts (tree should be ≤400 tris).
Integration: add a "props" pass to rebake-programs.mjs (or a new scripts/rebake-props.mjs)
that instances pack GLBs (or factory props) at program-specified positions.

**Bet 2 — procedural/OSM city generators (check, but likely only inspiration):**
- blender-osm / blosm, osm2world (already vendored in ./OSM2World — produced the base),
  CityEngine-style rule repos, "procedural city three.js" repos, A/B Street, Townscaper
  discussions. Question per repo: can it emit our style (flat low-poly, exact colours)?
  Most emit realistic or untextured geometry — probably not the shortcut.
- Also search: "streetview to 3d scene", "image to 3d city scene reconstruction github",
  "scene layout from single image" — verify there is/isn't a turnkey image→world tool
  better than our program approach before investing further.

**Recommendation to validate in that session:** Bet 1 assets + our existing scene-program
placement (positions read off the restyled refs by extraction agents, same as buildings)
is very likely the fastest path to the target image. The island/sign/lamp are 3 one-off
factory props. Then run the acceptance loop street-wide.

## Acceptance (unchanged, user requirement)

Per docs/exact-geometry-program-plan.md: build → shoot-street at ref pano → vision critic
diffs vs ref → program edits → repeat until no material discrepancy. Final judge: the
in-game T-junction frame vs docs/target-street-image.png, at the user's eye.

## Practical notes for the next session

- Local server: `node server.js` (port 8080). Dev spawn: `?v3&spawnat=126,-367`.
- Worlds by URL: `/` = v2 parametric, `?gen3d` = Meshy comparison, `?v3` = scene programs.
- Meshy path is DEPRECATED for this goal (kept as comparison; docs/exact-restyle-3d-plan.md).
- .env holds GMAPS_KEY, GEMINI_KEY, MESHY_KEY (git-ignored). Blender at
  "C:\Program Files\Blender Foundation\Blender 4.1\blender.exe" (not on PATH; only the
  deprecated Meshy path needs it).
- Memory file `exact-restyle-3d-pilot` has the full pipeline state; `MEMORY.md` indexes it.
