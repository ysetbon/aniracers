# Building a new AniRacers world (real place → drivable track)

This is the **repeatable recipe** for turning any real neighbourhood into an AniRacers world:
a drivable track on real streets, with **a unique 3D building model per house**, each derived
from its real Google Street View photo and placed on its true map footprint.

The whole pipeline is **parameterized by `--world=<name>`** (see `scripts/world-config.mjs`).
Netanya is the worked example below (`--world=netanya`). To make a *new* world, pick a name and
run the same commands with `--world=<yourname>`.

> Naming convention for a new world `<name>`: data in `maps/<name>/`, output GLB at
> `assets/<name>/world.glb`, intermediate OSM at `OSM2World/_aniracers_test/<name>.osm`.
> If you want different folders or a different in-game `gameKey`, add an entry to `WORLDS`
> in `scripts/world-config.mjs` (Netanya does this: dir `maps/mishkenot_zvulun`, gameKey
> `mishkenot`).

---

## Prerequisites (one-time)

1. **`.env`** with `GMAPS_KEY=<your Google Maps key>` (Street View Static + metadata enabled).
2. **OSM2World built** (vendored at `OSM2World/`, git-ignored). JDK 17 + Maven 3.9:
   ```
   mvn -f OSM2World/pom.xml -pl desktop -am -DskipTests -Dmaven.javadoc.skip=true package
   ```
   (PowerShell: put `--%` before the `-D…` args so they aren't mangled.) Produces
   `OSM2World/desktop/target/osm2world-desktop-0.5.0-SNAPSHOT.jar`.
3. `npm install` (puppeteer is used by the bake/verify steps).

---

## The recipe

Replace `<name>` with your world's name throughout.

```bash
# 1. Draw the exact area polygon (your browser): click points, click the first to close, Save.
node scripts/area-picker.mjs --world=<name> --center=<lat>,<lon>      # -> maps/<name>/area.json

# 2. Download the OSM data for that polygon (+ inject <bounds> for a deterministic origin).
node scripts/fetch-osm.mjs --world=<name>                            # -> <name>.osm

# 3. Strip building tags, then render the BASE (streets/parks/trees, no buildings) with OSM2World.
node scripts/strip-buildings-osm.mjs --world=<name>                  # -> <name>_base.osm
node scripts/osm2world.mjs --world=<name>                            # -> <name>_base.glb

# 4. Extract building footprints (inside the polygon), in world XZ coords.
node scripts/extract-buildings.mjs --world=<name>                    # -> maps/<name>/buildings.json

# 5. Harvest one Street View photo per building.
node --env-file=.env scripts/harvest-buildings.mjs --world=<name>    # -> streetview/ + building-sv.json

# 6. Chunk the photos for vision analysis (also writes the analysis INSTRUCTIONS.md).
node scripts/make-spec-chunks.mjs --world=<name> --place="<place description>"
#    -> maps/<name>/spec-work/chunk_*.json + INSTRUCTIONS.md

# 7. VISION STEP (run by Claude): launch one agent per chunk; each reads its photos +
#    spec-work/INSTRUCTIONS.md and writes spec-work/specs_<k>.json. Then merge:
node scripts/merge-specs.mjs --world=<name>                          # -> maps/<name>/building-specs.json

# 8. Bake: instance a unique model per building onto the base -> the playable world.glb.
node scripts/build-world-from-specs.mjs --world=<name>              # -> assets/<name>/world.glb

# 9. Trace the race line on the baked world (your browser): click waypoints, close, Save.
node scripts/track-editor.mjs --world=<name>                         # -> maps/<name>/track.json

# 10. Verify.
node scripts/verify-placement.mjs --world=<name>     # footprints overlaid on the world (top-down)
node scripts/verify-ingame.mjs --world=<name>        # loads it inside the game, screenshots

# Inspect every model next to its real photo:
node scripts/building-gallery.mjs --world=<name>     # http://localhost:8769/
```

### Step 7 in detail — the vision fan-out
`make-spec-chunks` splits the photos into `chunk_<k>.json` and writes `spec-work/INSTRUCTIONS.md`
(the spec schema + rules). Claude launches **one subagent per chunk** (~20 photos each); each
reads its chunk's images and `INSTRUCTIONS.md`, then writes `spec-work/specs_<k>.json`. Each
building gets: `floors, wall, roof(flat|gabled|hipped), roofColor, cols, balconies, doors,
shutters, stoneBase, solar, style, conf`. Rule: **prefer OSM `levels` for floor count**; use the
photo for colour / roof / balconies / window density / style. `merge-specs` validates + clamps
all chunks into `building-specs.json`.

### How the models are built (`scripts/house-factory.js`)
Shared browser factory used by **both** the bake and the gallery, so what you inspect is what
you drive. `makeBuilding(p)` = box mass + stone plinth, 4-facade window grid (+shutters),
per-door canopies, balconies, rooftop solar, and flat/gabled/hipped roofs. Complex / L-shaped
footprints (OBB fill-ratio < 0.88) instead use `makeFootprintBuilding(foot,p)` which **extrudes
the real polygon** so walls follow the true footprint.

---

## Step 11 — wire the world into the game (`index.html`)

The build produces `assets/<name>/world.glb`; these edits make it playable. For a world with
`gameKey = <key>` (defaults to `<name>`; Netanya's is `mishkenot`):

1. **Track control points** — paste `maps/<name>/track.json`'s `ctrl` array as a constant near
   `MISHKENOT_CTRL` (~line 613):
   ```js
   const <KEY>_CTRL = [ [x,z], [x,z], ... ];   // from maps/<name>/track.json
   ```
2. **Theme** — add a `VTHEME.<key>` entry (sky/fog/light), copying `VTHEME.mishkenot` (~line 1560).
3. **Loader** — copy `buildMishkenotWorld()` (~line 1724) to `build<Key>World()`, changing the
   GLB path to `/assets/<name>/world.glb`. Keep the line that sets the debug handle so
   `verify-ingame` works:
   ```js
   if(window.__dbg){ window.__dbg.<key>Group=root; window.__dbg.worldGroup=root; }
   ```
4. **Dispatch** — add a branch in `buildWorld(w)` (~line 1774):
   ```js
   else if(w==='<key>'){ setTrackData(<KEY>_CTRL);
     buildTrackMeshes({road:0x4a4d54, ground:0x6f9e4e}); build<Key>World();
     enhanceWorldVisuals('<key>'); setPickupsEnabled(false); }
   ```
5. **Menu button** — add a `<button id="start<Key>">…</button>` (~line 284) and, near the other
   listeners (~line 2851):
   ```js
   document.getElementById('start<Key>').addEventListener('click',()=>startRace('<key>'));
   ```
   The `?world=<key>` deep-link then works automatically.

---

## Tweaking an existing world
- **One building**: edit its entry in `maps/<name>/building-specs.json`, then re-run step 8.
- **A whole style**: edit `scripts/house-factory.js` (gallery + game update together), re-run step 8.

## Data / weight
`assets/<name>/world.glb` is a single vertex-coloured mesh (Netanya ≈ 495k tris, ~51 MB on
disk but ~3 MB gzipped, 1 draw call — light to render). Local `server.js` serves it
uncompressed; any real host gzips it. If a world's GLB grows unwieldy: re-index + uint8 vertex
colours (→ ~⅓ size, ~½ RAM) or Git LFS for the binary.

## Notes / gotchas
- **Projection origin** is the polygon-bbox centre. `fetch-osm` injects a `<bounds>` with a
  *symmetric* margin so its centre matches what `extract-buildings` / `build-world-from-specs`
  use — keep that invariant if you change the margin.
- **Overpass**: the query pulls only `way[...]` features (+ tree nodes) and recurses to nodes,
  avoiding the city-wide relation "comet tails". Sends a User-Agent + Accept header (else 406).
- **Street View coverage** varies; `building-sv.json` records each photo's pano distance +
  `conf` (high/med/low) so the vision step can down-weight unclear shots.
- Legacy/superseded scripts kept for history: `build-mishkenot-world.mjs`,
  `build-mishkenot-instanced.mjs`, `apply-building-overrides.mjs`, `building-editor.mjs`,
  `mishkenot-streetview.mjs`. The active path is the one above.
