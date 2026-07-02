# Exact-restyle buildings — image-to-3D plan (next session)

Goal: tier-A buildings in game that look **exactly like their Gemini-restyled references**
(`maps/<world>/restyled/bld_<id>.png`) — e.g. bld_383410002's stacked mint balconies — not a
parametric approximation. Decision from 2026-07-02 session: the spec-v2 funnel (17 fields →
house-factory box) is a summary by construction and cannot reach this; the facade-texture
spike (`scripts/gemini-facade.mjs`, kept as fallback) was rejected as not exact enough.

## Approach: per-building image-to-3D + Blender batch normalize/merge

The restyled images are ideal image-to-3D inputs: clean, unoccluded, style-unified, single
building, neutral lighting. Generate a **textured mesh per building** from them, then batch
process into the world.

```
1. multi-view restyle    gemini-restyle.mjs, extended: restyle views[0..2] per building
                         (building-views.json already has 3-4 angles for most tier-A;
                         raw shots on disk under maps/<world>/views/keyless/)
2. image -> 3D           per building: restyled view(s) -> textured GLB
                         local:  Hunyuan3D-2 (single) / Hunyuan3D-2mv (multi-view, kills
                                 hallucinated backsides) — free, needs NVIDIA GPU ≥12GB VRAM
                         API:    Meshy or Tripo3D (~$0.2-0.3/building ≈ $40-60 for 197)
3. Blender batch         blender --background --python normalize_buildings.py:
                         - import GLB, decimate to ~2-4k tris (Decimate modifier, ratio by
                           screen size: tier-A near track finer, far coarser)
                         - scale/orient/position to the real footprint: OBB from
                           buildings.json foot (world XZ), height = floors * 3.0 from
                           building-specs.json; snap base to y=0
                         - bake all textures into one 2048/4096 atlas (Smart UV or per-object
                           islands), single material out
                         - export one merged GLB per batch of ~20
4. integrate             cut the old parametric buildings out of assets/<w>/world.glb with
                         the rebake-buildings.mjs triangle-cut logic (centroid in expanded
                         footprint, y>0.25), append the textured meshes. NOTE index.html's
                         world loader assumes one vertex-coloured material — verify textured
                         submesh renders; GLTFLoader handles it natively, but check lighting
                         (MeshStandardMaterial vs the game's flat look; may want
                         material.flatShading or MeshBasicMaterial-style unlit).
5. verify                scripts/shoot-street.mjs at each building's pano (true position,
                         heading, fov from building-views.json) vs the restyled ref; iterate.
```

## Pilot first (do NOT start at scale)

5 buildings end-to-end before any batch: 383410002 (mint balcony apartment — the user's
benchmark), 406278384 (blue-fence villa), 406278425 (gabled duplex), 557132861 (stone-fence
cottage), 406278405 (hipped 3-storey). Success = shoot-street shot at the pano position is
recognisably "the restyled image in game", tri/size budget holds.

## Budgets & risks

- Tris: 197 × ~3k ≈ 600k added on top of ~600k world — decimate aggressively or demote
  far-from-track tier-A to the parametric bake. Kart camera never sees roofs closely from
  above except on hills — but aerial views exist if roof texture matters.
- GLB size: texture atlas 10-30 MB on top of ~62 MB. Fine locally; consider basis/ktx2 later.
- Style consistency: all inputs share one style anchor so drift is bounded; spot-check.
- Scale/orientation errors: never trust the generated mesh's own scale — always constrain to
  the OSM footprint OBB + floors height. Street-facing side = facade seen from the pano
  bearing in building-views.json.
- Fences/gates: keep factory v2 fences (already good and crisp) — cut only the building mass,
  keep the frontage fence strips from the 2026-07-02 rebake.
- The reference scene's grass/flowers/hedges/brick sidewalks are the separate environment
  phase (props + road surfaces, plan doc §C); buildings alone won't match the full frame.

## Blender MCP vs headless

The workhorse is a headless bpy script (deterministic, batchable, CI-able). A Blender MCP is
optional sugar for interactively inspecting/fixing individual buildings; do not build the
pipeline on it. Blender must be installed locally (4.x); `blender --background --python`.

## Existing tooling to reuse

`building-views.json` (per-building panos/angles), `maps/<w>/restyled/` (197 refs, cached),
`gemini-restyle.mjs` (extend with --view=N), `rebake-buildings.mjs` (triangle cut),
`shoot-street.mjs` (pano-true verification), `merge-specs.mjs`/specs for heights+fences.
