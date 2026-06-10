# DEVELOPMENT.md — handoff notes for continuing this project (Cursor / any AI assistant)

ANIRACERS is a LEGO-Racers-1999-style kart game. Single self-contained `index.html`
(THREE.js r128 from CDN, no build step) + a ~120-line Node WebSocket relay (`server.js`).
Everything below is what you need to modify it safely.

## File map
- `index.html` — the ENTIRE game: CSS, HTML overlays, and one big IIFE `<script>`.
- `server.js` — serves `index.html` over HTTP AND runs the lobby/relay WebSocket on the
  same port. No game logic, just static serving + rooms + message forwarding.
- `render.yaml` / `Dockerfile` — deploy configs (Render free tier / any container host).

## index.html — section map (in order, search for the `====` banners)
1. **SETUP** — renderer, scene, fog, camera, `sun` + `hemi` lights. `onResize`.
2. **AUDIO** — `beep(freq,dur,type,gain)` WebAudio square-wave SFX.
3. **TRACK** — `ctrl[]` control points → closed CatmullRom `curve` → `N=260` arrays:
   `samples[i]` (Vector3 centerline), `tangents[i]`, `normals[i]` (LEFT of travel; for the
   loop's winding, +normal points INTO the loop). Helpers: `nearestIdx(p)`, `distToCenter(p,i)`,
   `trackFrame(t)`. Road mesh (`roadMesh`, DoubleSide — keep it that way, single-sided
   caused see-through bugs), dashes, edge lines, checkered start, `groundMesh`.
   `roadOverlay(i0,i1,color)` paints strips over the road (castle/tunnel floors).
4. **LANDMARKS** (castle world): `buildCastleWorld()` = castle gate at `CASTLE_T=.52`
   (road passes through arch), tunnel at `TUNNEL_T=.18`, windmill. `buildCastleTrees()`.
   Grandstand + start banner + track flags are built at load (shared by both worlds).
5. **SUNSET BEACH WORLD** — `buildBeachWorld()`: the coast wraps the whole track.
   Key helper `ringStrip(off1,y1,off2,y2,color,opacity,i0,i1,skipA,skipB)` builds a strip
   following the track between two lateral offsets. Negative offset = sea side.
   Bridge zone `BR0=144, BR1=156`: ring strips skip these quads; a lagoon inlet
   (water+sand strips) passes under a stone bridge (deck skirt + parapets + piers).
   `insideTrack(p)` = point-in-polygon vs the centerline. Surfaces deliberately tuck
   UNDER the road edge (start at ±6, road half-width is 8) to avoid edge gaps.
   `buildWorld(w)` dispatches once ('castle' | 'beach') and is called at race start.
6. **WARP VORTEX** — `warpGroup`/`warpInner`/`warpTex`: cone tunnel around the player
   during Warp. `FOG0` holds the CURRENT world's fog (beach builder mutates it) —
   warp restore reads from it. Rendering trick: player kart + vortex + lights are on
   **layer 1**; during `player.warpFx>0` the camera renders ONLY layer 1 (world vanishes).
7. **ANIMAL DRIVERS** — `makeDriver(type)`: chicken / dog / sheep / cat / frog voxel
   drivers. `makeKart(bodyColor,animal)` builds kart + flame + twin blue jets + shield bubble.
8. **KARTS** — `spawnKart(name,color,animal,gridIdx,isPlayer)`. IMPORTANT: karts are
   created LAZILY: `setupOffline()` (player + 4 AI) or `setupOnline(roster,myId)`
   (remote karts get `.remote=true`, `.netId`). `player` is null until a mode starts —
   the render loop guards on `if(player)`.
9. **PICKUPS** — rows along the track (`rowTs`): colored rows (red/green/blue/yellow,
   shuffled colors PER CLIENT — known quirk) and white rows. 5s respawn.
10. **FX** — `explode(pos,color,n)` particle bursts, `shake` camera shake, `camSnap`.
11. **PROJECTILES/HAZARDS** — `fireStraight`, `fireHomingAt(owner,target,spread)`,
    `zapVisual`, `dropHazard(owner,type,opt)` (oil/barrel/magnet; `opt={x,z,rot,id}` for
    network spawns), `launchMummy(owner,opt)` (walks the centerline cursing karts).
12. **POWER SYSTEM** — authentic LEGO Racers 1 table, `L = min(whites,3)`, 0..3:
    | color | L0 | L1 | L2 | L3 |
    |---|---|---|---|---|
    | red | smart cannonball (intercept-aim at nearest kart in a forward cone; dumb-fire if none) | grappling hook (forward-only lock; slows victim; reels you to the slot BEHIND them; release slingshot) | lightning wand (zaps all ahead) | 3 guided rockets |
    | yellow | oil slick | gunpowder barrel | magnetic trap (pulls + holds) | mummy's curse |
    | blue | 5s shield | 6s green | 8s yellow (reflects + ram) | 10s red (reflects + ram) |
    | green | turbo | double turbo | flying turbo (airborne, twin jets, immune to ground stuff, can't grab cubes) | WARP (vortex animation, autopilot, then TELEPORT +70 track indices; invulnerable; no flame) |
    Using a power clears brick+whites. `POWER_NAMES` feeds the HUD label.
13. **INPUT** — W/▲ gas; release = slow coast to 0 (-11/s); S/▼ brake then reverse (to -16);
    A/D steer; Space = power; **Z (hold)** = rear-view camera (instant flip both ways).
14. **SIM** — `stepKart` (timers → warp autopilot/controls/AI → integrate → soft wall at
    HALF_W+10 → lap progress via index delta). `stepRemote` (interpolation; >25-unit jump
    = warp snap). `kartCollisions` (+ram), `stepPickups`, `stepProjectiles`
    (reflect for shieldLvl>=2; remote karts get visual-only hits), `stepHazards`.
    `spinOut(k,soft)` respects shield/ram/warping and releases grapples.
15. **ONLINE** — see protocol below. `NEV(obj)` = send event (no-op offline).
16. **LOOP** — countdown → sim → ambient anims → warp visuals/layers → camera
    (chase + Z-flip + shake + camSnap) → HUD → `netTick` (~12.5Hz state send).

## Multiplayer protocol (JSON over WebSocket)
Client→Server: `{t:'create',name,animal}` · `{t:'join',code,name,animal}` ·
`{t:'ready',v:bool}` · `{t:'start',world}` (host; server REJECTS unless all ready) ·
`{t:'st',...}` state · `{t:'ev',...}` event.
Server→Client: `{t:'room',code,you,host,players}` · `{t:'players',players,host}` ·
`{t:'start',world,players}` · relayed `st`/`ev` with `id` of sender · `{t:'left',id}` · `{t:'err',m}`.
State packet: `{x,z,r,s,al,fx:{b,fl,sh,sp},tt,fin}` (sh = shieldLvl+1 or 0).
Events (`ev.a`): `cannon{sp}` · `rockets{ids}` · `hook{target}` · `zap{ids}` ·
`haz{h,x,z,rot,hid}` · `mummy{x,z}` · `hzdone{hid}` · `pick{i}` · `ram{target}`.
**Design: victim-authoritative.** Each client simulates only its own kart; weapons spawn
visuals everywhere but only the victim's own client applies damage to itself.
Invite links: `?server=wss://...&room=CODE` prefill + auto-open the lobby.

## Known issues / quirks (honest list)
- Pickup cube COLORS are shuffled per client (positions match). Fix: seed the shuffle
  with the room code, or have the server send a seed in `start`.
- Reflector shield bounces only damage on the reflector's own screen (reflected
  projectile isn't re-broadcast). Fix: NEV a `cannon`-like event on reflect.
- No reconnect handling: a dropped player's kart freezes (marked finished on 'left').
- Finish ordering on near-ties can differ slightly between clients (local finishCounter).
- AI exists only offline; online rooms are humans-only (no AI fill for empty slots).
- `nearestIdx` is O(N) per call per kart per frame — fine at N=260, don't grow N blindly.
- The lobby ready flags persist if the host starts and players return via reload (rooms
  die when empty, so in practice this is fine).
- 'burst' event handler in netEvent is dead code (red L2 became lightning wand) — harmless.

## TODO / backlog ideas (in rough priority order)
1. Server-sent RNG seed → identical pickup colors for everyone.
2. Broadcast reflected projectiles (reflector shield works cross-client).
3. AI fill for empty online slots (reuse offline AI with netId-less karts).
4. Name tags floating above karts (sprite/canvas texture).
5. Lap times + best-lap HUD; post-race results table for all players.
6. Minimap (top-down canvas overlay using samples[]).
7. ~~Serve index.html from server.js too → ONE Render deploy hosts both.~~ DONE (plain
   `http` module, no express; lobby auto-fills `ws(s)://location.host` when served).
8. Reconnect/rejoin mid-race (server keeps slot for 30s).
9. Mobile: online lobby works but touch controls could use a power-target hint.
10. Third world (night city? desert canyon?) — pattern: copy buildBeachWorld approach.
11. Sound: engine pitch by speed, mute toggle.
12. Seeded per-room track variation (shuffle ctrl[] mildly by seed).

## Workflow tips
- No build step: edit `index.html`, refresh browser. Test OFFLINE mode first (instant),
  then online with two browser windows + `node server.js` locally.
- Quick syntax check used throughout development:
  extract the `<script>` body and run `node --check` on it.
- Keep `roadMesh` and terrain strips DoubleSide; keep overlapping surfaces ~0.01+ apart
  in Y to avoid z-fighting.
