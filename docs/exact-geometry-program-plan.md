# Exact-restyle v3 — scene programs, not mesh generation

GOAL (user, 2026-07-03): the in-game frame must match the Gemini restyled ref **100% —
including all background details**: brick/paving sidewalks, grass verges with flowers and
rocks, hedges, low-poly trees, fences, benches/pergolas, road surface, sky and clouds.
The unit of extraction is therefore the WHOLE IMAGE (a scene program), of which the
building program is one part. Success is judged on the full shoot-street frame vs the
full ref — never on a building crop alone.

Decision 2026-07-03 (after the Meshy pilot + T-route world): image-to-3D cannot reach
"exactly the Gemini restyled image". The refs are renders of SIMPLE GEOMETRY — flat-colour
prisms, countable window grids, balcony slabs, clean roof forms — and mesh generation
returns melted approximations of that (see maps/mishkenot_zvulun/critic-work/troute_*).
The new approach: **compile the ref, don't scan it**. A vision agent reads each isolated
ref like an architect's elevation drawing and emits a per-building JSON *program*; an
extended factory builds it deterministically in the game's own style.

## Pipeline

```
restyled/iso/bld_<id>.png            (already cached for all 21 + producible for the rest)
  -> extraction agent (vision): building program JSON  (spec-work/programs/bld_<id>.json)
  -> factory v3 (house-factory.js extension, browser-side, vertex colours)
  -> rebake-buildings.mjs surgical cut+merge into assets/<w>/world.glb   (unchanged)
  -> shoot-street.mjs vs ref -> critic agent edits program fields -> instant rebuild
```

Everything stays in the ONE vertex-coloured world mesh — no textures, no material split,
no Blender, no Meshy credits. ~300–800 tris/building.

## Program schema v3 (what spec v2's 17 fields could not say)

- massing: main volume from OSM footprint OBB (or true polygon), plus optional secondary
  volumes: setback top floors, stair towers, wings — each {dx,dz,w,d,h}
- facades (front/back/left/right, front = pano-facing): window grid {rows, cols, winW,
  winH, sillBand, recessed}, per-cell overrides (door, garage, blank), shutters/bars style
- balconies: stacks[] {facade, colRange, floorRange, depth, slabColor, underside:
  chamfered|flat, rail: {type: glass|bars|solid, color}}
- roof: {form: flat|hip|gable|sheds[], parapet {h, color}, overhang, fascia color,
  ridge direction, props: solar, tank}
- materials: wall hex, accent bands [{y0,y1,color}], stone/brick base {rows, color},
  per-volume overrides. ALL colours pixel-sampled from the ref (agent points at a region,
  a deterministic sampler takes the median — no model colour drift).

## Why this wins (vs the Meshy pilot's observed failures)

- melted facets / UV smear / dents      -> boxes and prisms are exactly the refs' look
- green-khaki tint, washout             -> same vertex-colour Lambert as the whole world
- hollow/blank backsides, 180° flips    -> all 4 facades built from the program
- ground slabs / bins fused into mesh   -> factory builds only the building
- $0.60 + re-roll roulette per fix      -> free deterministic rebuild of one field
- Blender 4.1 export crashes            -> no Blender stage at all

## Acceptance gate (user requirement 2026-07-03: "compare exactly and refix until 100%")

No building/frame ships on a first build. The loop per frame:
1. build from program -> rebake into a test GLB
2. shoot-street at the ref's exact pano/heading/fov
3. a vision critic diffs shot vs ref and outputs STRUCTURED discrepancies
   (wrong hex, wrong count, wrong proportion, missing/extra element, misplaced prop)
4. discrepancies are applied as program-field edits -> rebuild (instant, free)
5. repeat until the critic reports NO material discrepancy (or only ones it marks
   as ref-inconsistency, e.g. flower-for-flower layout) — that is the DONE bar.
Passing shots are archived next to the refs (critic-work/pass_bld_<id>.png) as the
regression baseline: any later world rebake must still match them.

## Scope (user 2026-07-03): the T-street area ONLY

All v3 work targets the HaRav Toledano × HaRav Unterman T (the 17 buildings + their
frontages/road). Nothing else gets rebuilt until the whole T passes the acceptance gate.
Pilot = ONE full T-street frame end-to-end (building + hedge/verge/sidewalk/road band),
then the remaining frames. Dev inspection: http://localhost:8080/?gen3d&spawnat=126,-367
spawns the kart at the T-junction (spawnat is a generic dev param, world XZ).
Comparison baseline: the Meshy versions already in world_gen3d.glb (troute_* shots).

## Scene program (the environment half — every ref background element is factory-able)

- ground bands per frontage: sidewalk {material: brick|paving|concrete, pattern colours[],
  border kerb colour}, verge {grass hex, flower density + palette, rocks}, driveway
- vegetation: hedge runs {along fence line, h, hex}, trees[] {pos, type: lowpoly blob/
  cone/palm, trunk+canopy hex}, planters
- street furniture: benches, pergolas, bins, lamp posts (positions from ref, snapped to
  the frontage strip)
- road: surface override per road segment {asphalt hex | paving-stone pattern}, lane paint
- global style: sky gradient hexes, cloud style/colour (enhanceWorldVisuals mishkenot
  entry) sampled once from the style anchor + refs
- consistency rule: where two refs see the same strip, later/closer pano wins (same
  numeric-order rule as merge-specs)

## Work items

1. factory v3 in scripts/house-factory.js (keep v2 functions; add makeBuildingV3(program))
2. prop factory: makeTree/makeHedge/makeFlowerVerge/makeSidewalk/makeBench/makePergola —
   crisp low-poly, vertex colours (per-brick boxes near track, colour-striped strips far)
3. scene extraction: scripts/make-programs.mjs (vision call per FULL ref -> scene program
   incl. building; deterministic colour sampler; writes spec-work/programs/) — reuse the
   chunk-agent harness pattern from v2
4. rebake path: rebake-buildings.mjs learns `--programs` (building + its frontage strip)
5. road surface overrides baked per segment (plan doc §C item, folded in here)
6. critic loop: shoot-street + agent that DIFFS the full frame vs the full ref into
   program field edits (building AND environment)

Meshy assets in maps/<w>/gen3d/ stay as fallback for genuinely sculptural one-offs; the
?gen3d world (assets/mishkenot/world_gen3d.glb) remains for comparison.
