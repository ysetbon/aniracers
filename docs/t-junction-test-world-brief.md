# NEXT GOAL: a test-world for the T-junction (HaRav Toledano × HaRav Unterman)

Written 2026-07-03 as the handoff for the next session. Read this whole file before
touching anything — the method is proven, the pieces exist, and the pitfalls are listed.

## The story so far (what exists and why)

**Goal (unchanged):** make the in-game frame at the T-junction (Mishkenot Zvulun,
Netanya — spawn `?world=mishkenot&v3&spawnat=126,-367`) read as
`docs/target-street-image.png`. That target image is itself a Gemini restyle of the
junction pano — bright lawns, faceted trees/palms, planted traffic island, blue T-sign,
curved lamp, red-roofed villas.

**Session 1 — research (docs/target-image-research-brief.md).** Two bets investigated.
Verdict: no turnkey "image → editable world" tool exists anywhere (World Labs Marble,
Genie 3, TRELLIS, blosm, Streets GL all fail on ≥1 hard requirement). Winning method:
**CC0 low-poly packs + our scene-program placement**. OSM has ~zero vegetation data for
Netanya (verified via Overpass) — all prop positions must come from Street View refs.

**Session 1 — test1 (?test1, PR #5).** One-house pilot on the best-documented building
(`bld_556597974`, the 7-iteration pilot villa ~93m north of the junction on Toledano).
Built `scripts/bake-test-world.mjs` (standalone mini-world baker), downloaded 31 Kenney
Nature Kit GLBs to `assets/props/kenney-nature/` (CC0; **plain material colours — zero
conversion**, tri counts 16–336), added an `"environment"` section to the program JSON.
Converged in 4 critic iterations.

**Session 1 — test2 (?test2, PR #5).** The old restyle prompt DELETED vegetation and
cars ("Remove all vehicles ... any foliage that blocks the facade" —
scripts/gemini-restyle.mjs). Wrote **`scripts/gemini-restyle-scene.mjs`** with a
KEEP-EVERYTHING prompt: 7 keyless Street View angles → 7 scene-faithful refs
(committed: `maps/mishkenot_zvulun/restyled/scene/t2_*.png`, heroes in
`docs/test2-ref-*.png`). The refs corrected test1: cream sandstone wall, steel-blue
gates, terracotta paver sidewalk, **red-white painted kerbs**. Environment pass gained:
factory low-poly **cars**, curved **street lamps**, **dumpster**, **planter**,
red-white kerb paint segments. Converged in 2 iterations.
Drive: `http://localhost:8080/?world=mishkenot&test2&spawnat=114,-276`.

## THE TASK: test3 = the whole T-junction area

Scope: both arms of the junction + the junction itself, everything the racer sees
driving through — roughly Toledano from z≈-320 to z≈-420 and the Unterman arm, centred
on the T at world (126,-367). This includes, per the target image:
**the planted traffic island in the road fork (kerb ring + grass + rocks + shrubs), the
blue square T-sign on its pole, the curved street lamp, red-white kerbs, driveway
aprons, lawns, trees/palms/hedges/bougainvillea, and the 16 already-programmed
buildings** (programs in maps/mishkenot_zvulun/spec-work/programs/, 16/17 baked into
world_v3.glb previously).

### Step 1 — harvest MANY angles, including the road itself

Use the keyless harvester (no API cost). Two kinds of shots:

- **Junction + road studies** (the user explicitly wants the ROAD studied): panos at
  ~10–15m spacing along BOTH arms through the junction, with headings along-road (both
  directions) and diagonals across the junction. The island, kerb paint, lane shapes,
  sign and lamp positions come from these.
- **Per-building studies**: aimed shots at each of the 16 buildings (the harvester's
  `--road=<id> --buildings` mode does this automatically).

```
node scripts/sv-keyless.mjs --world=netanya --road=27204871 --step=12 --buildings   # Toledano
# find Unterman's road id in maps/mishkenot_zvulun/roads.json (search the hebrew name
# or take the other road whose pts pass near (126,-367)), then harvest it the same way.
# For the junction itself add --at shots: compute lat/lon via projection.fromXZ
# (worked example below) at ~(126,-350), (126,-367), (126,-385) + the Unterman arm,
# headings toward the island and along each road.
```

XZ→lat/lon for `--at` (PCX/PCZ recentre matters!):
```js
import('./scripts/world-config.mjs').then(m=>{
  const W=m.resolveWorld(['--world=netanya']);
  const proj=m.projection(m.readArea(W));
  const BJ=JSON.parse(require('fs').readFileSync(W.paths.buildings,'utf8'));
  const ll=proj.fromXZ(x+(BJ.PCX||0), z+(BJ.PCZ||0));  // → [lat,lon]
});
```
Heading from camera XZ to target XZ: `atan2(dx,-dz)*180/π` (north = -Z, clockwise).

### Step 2 — restyle EVERYTHING scene-faithfully

```
node --env-file=.env scripts/gemini-restyle-scene.mjs --world=netanya \
  --files=<all new jpgs> --outdir=scene-tjunction
```
GEMINI_KEY is in .env (repo root, git-ignored — copy from main checkout if in a fresh
worktree). Model resolves from GEMINI_MODEL (was gemini-3.1-flash-image). ~10s/image.
Review every output: the prompt keeps trees/cars/kerbs/signs; if a frame hallucinates,
re-run just that file with --force. These refs are the canonical study material — commit
them (subfolder dodges the `restyled/*.png` gitignore; that is intentional).

### Step 3 — build the test3 world

Extend `scripts/bake-test-world.mjs` (or clone to bake-tjunction.mjs) from one building
to a list: `--ids=556597973,556597974,...` (all 16 programs). What it must add:

1. **Multi-building loop** — same per-building math (minAreaOBB, rotY, frontage) as
   rebake-programs.mjs, already copied inside bake-test-world.mjs; loop it.
2. **Both road arms from roads.json polylines** (not one straight strip): asphalt +
   grey kerbs + red-white paint near the junction, following the real pts.
3. **The traffic island** (new factory piece): kerb ring (grey boxes along an ellipse
   ~4×2.5m), grass fill, 2-3 rocks (`rock_smallA/B`), shrub cluster (`plant_bushSmall`)
   — read exact shape/position from the junction refs; it sits in the fork.
4. **T-sign** (new factory prop): blue box 0.6×0.6×0.05 + white "T" (3 white boxes) on
   a grey pole ~2.4m, position from refs (east side of the fork in the target image).
5. **Street lamps** along both arms (mkLamp exists), positions from refs.
6. **Per-building environment sections**: author `"environment"` props for each of the
   16 programs from their refs — this is extraction-agent work; fan out subagents
   (one per 3-4 buildings) reading `restyled/scene-tjunction/` + the old per-building
   refs. Only `props` (trees/hedges/cars/pots) — ground/road come from the shared bake.
   The environment schema and worked example: bld_556597974.json.
7. Wire `?test3` in index.html (add BEFORE the test2/test1 checks — substring matching).

### Step 4 — acceptance

Shoot the exact target frame: camera at the junction pano position looking north up
Toledano (the docs/target-street-image.png view), fov≈72. Then the standard loop:
compare → edit programs/env → rebake → repeat until no material discrepancy. ALSO
verify the real URL end-to-end (`?world=mishkenot&test3&dbg`) — --glb overrides don't
test the routing. Final judge: that frame vs docs/target-street-image.png at the
user's eye. Commit converged frames to docs/test3-*.png, push, update PR #5.

## Machinery reference (all proven this session)

| Thing | Command / path |
|---|---|
| Bake one-house world | `node scripts/bake-test-world.mjs --world=netanya --id=556597974 [--out=...]` |
| Screenshot from anywhere | `node scripts/shoot-street.mjs --world=netanya --glb=<glb> --at=<lat,lon> --heading=<deg> --fov=72 --prefix=x_` |
| Harvest SV (keyless, free) | `node scripts/sv-keyless.mjs --world=netanya --at=<lat,lon> --headings=h1,h2 --tag=x` or `--road=<id> --step=12 --buildings` |
| Scene-faithful restyle | `node --env-file=.env scripts/gemini-restyle-scene.mjs --world=netanya --files=a.jpg,b.jpg [--outdir=d] [--force]` |
| Props library | `assets/props/kenney-nature/` (31 GLBs, CC0, License.txt inside) |
| Env schema example | `maps/mishkenot_zvulun/spec-work/programs/bld_556597974.json` → `"environment"` |
| Serve the game | `node server.js` → localhost:8080 (may already be running detached) |

Environment prop spec (bake-test-world.mjs env pass):
- pack GLB: `{model, h(m), t, inset, rxz?, y?, tint:{materialNameSubstring:hex, "*":fallback}}`
- hedge row: `{hedge:true, t0, t1, step, inset, h, colors:[...]}` (jittered two-tone boxes)
- car: `{car:true, t, inset, rot:"along"|deg, flip?, color}` | lamp `{lamp:true,...}` |
  bin `{bin:true,...}` | planter `{planter:true, w, d, color,...}`
- `t` = fraction along the frontage wall line (gates use the same axis), `inset` =
  metres inward from that line (negative → road side).

## Pitfalls (each cost real time — don't rediscover)

1. **Worktree setup**: EnterWorktree branches from origin/main → immediately
   `git reset --hard claude/netanya-workflow-enhancement-5cpl27` (or current tip).
   Copy `.env` from the main checkout; `cmd /c mklink /J node_modules <main>\node_modules`.
   Git-ignored refs (streetview/, views/, critic-work/) also need copying if used.
2. **Push**: local branch name ≠ remote name → plain `git push` fails SILENTLY in
   scripts; use `git push origin <local>:claude/one-house-test-world` and verify
   `git status -sb` shows not-ahead.
3. **Parked cars**: kerb face is at `off − halfW − 0.17` from the wall line; car centre
   belongs ~1.1m further road-side (inset ≈ −4.85 for this street). Don't put them on
   the kerb.
4. **Hedges**: inset ≥ (depth/2 + 0.4) or the boxes swallow the compound wall. Kenney
   plant_bush* scaled up looks like agave — hedges are factory boxes, not pack bushes.
5. **Trees**: rxz ≤ 1.25 and non-`_detailed` pine variants, else obese trunks/stubs.
6. **Tints**: material names vary per model (stone models use `stone`, not `dirt`) —
   always include a `"*"` wildcard.
7. **Old refs lie about vegetation**: anything in `restyled/bld_*.png` (old prompt) has
   trees/cars REMOVED and may hallucinate wall colours. Trust `restyled/scene*/` refs
   and raw Street View for the environment; old refs only for building architecture.
8. **?test URLs**: substring matching in index.html — check `test3` before `test2`
   before `test1`; the game needs `?world=mishkenot` to auto-start.
9. **Baked GLBs and scene refs are committed on purpose** (small; lets the user drive
   without rebaking). Keep doing that.
10. **Verify the real URL** with a puppeteer boot (see final_ingame_test2.png flow),
    not just --glb-override screenshots.

## State pointers

- Branch: `claude/one-house-test-world` (local worktree branch name differs — see
  pitfall 2). PR: **#5** (draft, base claude/netanya-workflow-enhancement-5cpl27).
- Memory files: `one-house-test-world`, `target-image-prop-research`,
  `netanya-corridor-v2-scaleup` (MEMORY.md index).
- The 16 T-street programs: `maps/mishkenot_zvulun/spec-work/programs/bld_*.json` —
  only 556597974 has an `environment` section so far; the other 15 need one (that IS
  most of the test3 work).
- Kenney City Kit Roads (lamps/signs pack) was researched but NOT downloaded — the
  factory lamp/sign are fine; download only if the critic demands richer models
  (needs the colormap→vertex-colour baker documented in target-image-prop-research).
