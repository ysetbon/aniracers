# Netanya GP (Mishkenot Zvulun) — world build workflow

How the **Netanya GP** world is built: a real Netanya neighbourhood (Mishkenot Zvulun /
Nof HaTalmim) turned into a drivable AniRacers track, with **a unique 3D building model for
every house, matched to its real Google Street View photo** and placed on its true map footprint.

The game loads `assets/mishkenot/world.glb` for the `mishkenot` world (the **NETANYA GP**
button, or `?world=mishkenot`).

---

## TL;DR — regenerate the world

```bash
# 0. one-time: vendored OSM2World built (see "OSM2World" below), .env has GMAPS_KEY
# 1. base geometry (streets/parks/trees, NO buildings) from OSM2World:
node scripts/strip-buildings-osm.mjs          # -> mishkenot_base.osm
#    then OSM2World convert mishkenot_base.osm -> OSM2World/_aniracers_test/mishkenot_base.glb (LOD2)
# 2. harvest one Street View photo per building (needs GMAPS_KEY):
node --env-file=.env scripts/harvest-mishkenot-buildings.mjs
# 3. analyse photos -> per-building specs (vision; see "Vision step"):
node scripts/make-spec-chunks.mjs 20          # -> spec-work/chunk_*.json
#    (run the 15 vision agents, each writes spec-work/specs_<k>.json)
node scripts/merge-specs.mjs                  # -> building-specs.json
# 4. bake the world (instances a model per building on the base):
node scripts/build-mishkenot-from-specs.mjs   # -> assets/mishkenot/world.glb
# 5. verify:
node scripts/verify-mishkenot.mjs             # in-game screenshots
node scripts/verify-placement.mjs             # footprints overlaid on the world (top-down)
```

Inspect every building vs its photo: `node scripts/building-gallery.mjs` → http://localhost:8769/

---

## Pipeline in detail

### 1. Area + track (user-drawn)
- `scripts/area-picker.mjs` (:8765) — Leaflet map; user click-draws the exact neighbourhood
  polygon → `maps/mishkenot_zvulun/area.json` (`polygon`, `bbox`, `center`).
- `scripts/track-editor.mjs` (:8766) — top-down view of `world.glb`; user clicks waypoints to
  trace the race line → `maps/mishkenot_zvulun/track.json`. Baked into `MISHKENOT_CTRL` in
  `index.html` (a ~1.8 km real street loop, 35 control points → closed Catmull-Rom).

### 2. Base geometry from OSM2World
OSM2World renders the OSM data to GLB (Y-up, real metres). We strip building tags first so it
only emits **streets, parks, trees, ground** — we add our own buildings on top.
- `scripts/strip-buildings-osm.mjs` → `mishkenot_base.osm` (keeps the injected `<bounds>` so the
  map projection origin is deterministic = bbox centre).
- OSM2World `convert --lod 2` → `OSM2World/_aniracers_test/mishkenot_base.glb` (~11.8 MB).

### 3. One Street View photo per building
- `scripts/harvest-mishkenot-buildings.mjs` (`node --env-file=.env`) — for each of the 301
  buildings inside the polygon (`maps/mishkenot_zvulun/buildings.json`, from
  `scripts/extract-buildings.mjs`), finds the **nearest real pano** to the footprint centroid,
  aims the heading at the centroid, and auto-zooms the FOV by distance.
  → `maps/mishkenot_zvulun/streetview/bld_<id>.jpg` (git-ignored: fetched Google imagery)
  → `maps/mishkenot_zvulun/building-sv.json` (manifest: pano distance + confidence).
  Result: 300/301 buildings got a real photo (~25–40 m away).

### 4. Vision step — photo → per-building spec
- `scripts/make-spec-chunks.mjs [size]` → splits the photo list into
  `maps/mishkenot_zvulun/spec-work/chunk_<k>.json`, and writes `spec-work/INSTRUCTIONS.md`
  (the spec schema + classification rules).
- **15 parallel vision agents** (one per chunk, ~20 photos each) read their photos + the
  instructions and each write `spec-work/specs_<k>.json`. Each building gets:
  `floors, wall(hex), roof(flat|gabled|hipped), roofColor, cols(windows/floor), balconies,
  doors(1|2), shutters, stoneBase, solar, style(tower|apartment|villa|house), conf`.
  Rule of thumb: **prefer OSM `levels` for floor count** (authoritative); use the photo for
  colour / roof / balconies / window density / style.
- `scripts/merge-specs.mjs` → validates + clamps → `maps/mishkenot_zvulun/building-specs.json`.
  Distribution: **21 towers / 85 apartments / 88 villas / 106 houses**; 190 flat / 41 gabled /
  69 hipped roofs; 90 with balconies, 29 with rooftop solar.

> Reality check: this area is **Netanya apartment towers** (up to 17 floors, stone/white,
> balconies) + 1–2 storey flat-roof houses (rooftop solar tanks) + red-tile villas — *not*
> cottages. The photo-driven specs capture that mix.

### 5. Bake — a unique model per building
- `scripts/house-factory.js` — **shared** browser-side factory (`makeBuilding`, `obb`,
  `makeFootprintBuilding`, `polyArea`). Loaded via `<script src>` by **both** the world-builder
  and the gallery so the inspected models are identical to the in-game ones.
  - `makeBuilding(p)` — box mass + stone plinth, 4-facade window grid (with shutters), per-door
    canopies (1 or 2 doors), apartment balconies, rooftop solar/water-tank, and
    flat (parapet) / gabled (prism) / hipped (4-sided cone) roofs.
  - `makeFootprintBuilding(foot,p)` — for **complex / L-shaped footprints**: extrudes the REAL
    polygon (walls follow the true footprint, windows placed along the real edges, flat roof).
- `scripts/build-mishkenot-from-specs.mjs` — loads the base GLB, clips it to the polygon and
  recentres it, then for each building:
  - rectangular footprint (fill ratio ≥ 0.88, ~261 buildings) → `makeBuilding`, fitted by the
    footprint's oriented bounding box (size + orientation).
  - complex footprint (~40 buildings) → `makeFootprintBuilding` (exact polygon).
  Bakes everything into ONE vertex-coloured mesh → `assets/mishkenot/world.glb`
  (~495 k tris, ~51 MB, 301 buildings placed).

### 6. Verify
- `scripts/verify-mishkenot.mjs` — deep-links the game to `?world=mishkenot&dbg`, writes
  overview / top / live screenshots (git-ignored `maps/mishkenot_zvulun/_ingame_*.png`).
- `scripts/verify-placement.mjs` — renders the world top-down and overlays every real footprint
  in red (full + densest-cluster zoom) → confirms each building sits on its map footprint.

### Inspect — the building gallery
- `scripts/building-gallery.mjs` (:8769) — every building's exact in-game model in sorted rows
  (towers → apartments → villas → houses), each standing **next to its real Street View photo**,
  with a `#idx · floors · style` label. Click → spec panel + big photo; search jumps to an id/`#n`.
- `scripts/building-types-viewer.mjs` (:8768) — the original 3-type (A/B/C) designer.
- `scripts/building-editor.mjs` (:8767) — click a footprint, see its photo, set type/storeys →
  `building-overrides.json` (used as the A/B/C fallback when a building has no photo-spec).

---

## Tweaking

- **Change one building** (height, colour, roof, …): edit its entry in
  `maps/mishkenot_zvulun/building-specs.json`, then `node scripts/build-mishkenot-from-specs.mjs`.
- **Change how a whole style looks**: edit `scripts/house-factory.js` (affects the gallery and
  the game together), then re-bake.

## Data / weight

- `assets/mishkenot/world.glb` ≈ **51 MB on disk**, but **~3 MB gzipped** (highly repetitive
  geometry) and a single 495 k-tri draw call — light to render. Local `server.js` serves it
  uncompressed; any real host (or gzip middleware) ships ~3 MB. Future option if needed:
  re-index + uint8 vertex colours (→ ~12–15 MB on disk, ~half the RAM) or Git LFS for the binary.

## OSM2World (build dependency, NOT committed)

`OSM2World/` is a vendored upstream clone (its own `.git`, Maven build, 121 jars + `target/`) —
git-ignored. Build once with JDK 17 + Maven 3.9:
`mvn -f OSM2World/pom.xml -pl desktop -am -DskipTests -Dmaven.javadoc.skip=true package`
(PowerShell needs the `--%` stop-parsing token before the `-D` args). See the project memory
`osm2world-world-pipeline.md` for the full build recipe and gotchas.
