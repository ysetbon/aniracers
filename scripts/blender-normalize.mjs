// Blender normalize/fit layer (exact-restyle plan step 3): takes the raw Meshy GLBs from
// maps/<dir>/gen3d/ and produces ONE placed GLB with every building decimated, rotated so
// its generated facade faces the street (the pano used for the restyle ref), scaled to the
// OSM footprint OBB + floors*3.0 height, and positioned at its world XZ with base at y=0.
//
// Never trust the generated mesh's own scale/orientation — the footprint OBB and the pano
// bearing are the only source of truth (docs/exact-restyle-3d-plan.md).
//
// Run:  node scripts/blender-normalize.mjs --world=<name> --ids=<id,id,...>
//       flags: --target-tris=N (default 3000)
// Output: one gen3d/placed_bld_<id>.glb per building (one Blender process each — a crash
// or bad mesh only loses that building, and Blender 4.1 crashes on multi-building export).
//
// Pipeline: this script computes per-building placement (world math lives here, next to
// projection()), writes gen3d/placement.json, then drives Blender headless with
// scripts/normalize_buildings.py which does the mesh work.
import fs from 'fs'; import path from 'path'; import { spawnSync } from 'child_process';
import { resolveWorld, readArea, projection, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const IDS = arg('ids', '') ? arg('ids').split(',') : null;
const TARGET_TRIS = +arg('target-tris', 3000);

const W = resolveWorld(argv);
const GEN_DIR = path.join(W.paths.dir, 'gen3d');
const proj = projection(readArea(W));

const buildings = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8'));
const blist = Array.isArray(buildings) ? buildings : buildings.buildings;
const PCX = buildings.PCX || 0, PCZ = buildings.PCZ || 0;   // game-frame recentre (see shoot-street.mjs)
const specsRaw = JSON.parse(fs.readFileSync(W.paths.specs, 'utf8'));
const specs = specsRaw.specs || specsRaw;
const views = JSON.parse(fs.readFileSync(W.paths.viewsJson, 'utf8')).buildings;

// --- min-area OBB of a footprint polygon (world XZ) -------------------------------------
function hull(pts) { // Andrew monotone chain
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function minAreaOBB(pts) {
  const H = hull(pts);
  let best = null;
  for (let i = 0; i < H.length; i++) {
    const [x0, z0] = H[i], [x1, z1] = H[(i + 1) % H.length];
    const a = Math.atan2(z1 - z0, x1 - x0), c = Math.cos(a), s = Math.sin(a);
    let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
    for (const [x, z] of H) {
      const u = x * c + z * s, v = -x * s + z * c;
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
    const area = (uMax - uMin) * (vMax - vMin);
    if (!best || area < best.area) {
      const cu = (uMin + uMax) / 2, cv = (vMin + vMax) / 2;
      best = { area, angle: a, du: uMax - uMin, dv: vMax - vMin,
        cx: cu * c - cv * s, cz: cu * s + cv * c };
    }
  }
  return best;
}

// --- per-building placement --------------------------------------------------------------
const jobs = [];
for (const idStr of (IDS || Object.values(views).filter(v => v.tier === 'A').map(v => String(v.id)))) {
  const glb = path.join(GEN_DIR, `bld_${idStr}.glb`);
  if (!fs.existsSync(glb)) { console.log(`  no gen3d GLB for ${idStr}, skipping`); continue; }
  const b = blist.find(x => String(x.id) === idStr);
  const v = Object.values(views).find(x => String(x.id) === idStr);
  const s = specs[idStr] || (Array.isArray(specs) ? specs.find(x => String(x.id) === idStr) : null);
  if (!b || !v?.views?.length) { console.log(`  missing footprint/views for ${idStr}, skipping`); continue; }

  const obb = minAreaOBB(b.foot);
  // Front facade = the OBB axis direction closest to building->pano (views[0] made the ref).
  const [pxr, pzr] = proj.toXZ(v.views[0].lat, v.views[0].lon);
  const px = pxr - PCX, pz = pzr - PCZ;
  const dLen = Math.hypot(px - obb.cx, pz - obb.cz);
  const dir = [(px - obb.cx) / dLen, (pz - obb.cz) / dLen];
  const cands = [
    { f: [Math.cos(obb.angle), Math.sin(obb.angle)], depth: obb.du, lateral: obb.dv },   // +u
    { f: [-Math.cos(obb.angle), -Math.sin(obb.angle)], depth: obb.du, lateral: obb.dv }, // -u
    { f: [-Math.sin(obb.angle), Math.cos(obb.angle)], depth: obb.dv, lateral: obb.du },  // +v
    { f: [Math.sin(obb.angle), -Math.cos(obb.angle)], depth: obb.dv, lateral: obb.du },  // -v
  ];
  // NOTE: `depth`/`lateral` above are labelled from the axis we face along: when the front
  // points along u, the building's street-facing width is the v extent (lateral) and its
  // depth away from the street is the u extent.
  const dot = c => c.f[0] * dir[0] + c.f[1] * dir[1];
  const front = cands.reduce((a, c) => (dot(c) > dot(a) ? c : a));
  // best perpendicular candidate: used when the Blender fit decides the pano bearing
  // picked the wrong axis (rotates the model 90deg but must still face the street side)
  const frontAlt = cands.filter(c => Math.abs(c.f[0] * front.f[0] + c.f[1] * front.f[1]) < 0.5)
    .reduce((a, c) => (dot(c) > dot(a) ? c : a));
  const floors = s?.floors || b.levels || 2;
  // pitched roofs add real height beyond floors*3; flat roofs just a parapet
  const roofAllow = (!s?.roof || s.roof === 'flat') ? 0.8 : 2.2;
  jobs.push({
    id: idStr, glb: path.resolve(glb),
    cx: obb.cx, cz: obb.cz,
    rotY: Math.atan2(front.f[0], front.f[1]),   // world yaw: model +Z (image front) -> front dir
    rotYAlt: Math.atan2(frontAlt.f[0], frontAlt.f[1]),
    width: front.lateral, depth: front.depth, height: +(floors * W.floorH + roofAllow).toFixed(1),
    floors, panoDist: Math.round(dLen),
  });
}
if (!jobs.length) { console.error('nothing to place'); process.exit(1); }
for (const j of jobs)
  console.log(`  ${j.id}: ${j.width.toFixed(1)}x${j.depth.toFixed(1)}m h=${j.height}m rotY=${(j.rotY * 180 / Math.PI).toFixed(0)}deg pano@${j.panoDist}m`);

// --- drive Blender headless ---------------------------------------------------------------
function findBlender() {
  if (process.env.BLENDER_EXE) return process.env.BLENDER_EXE;
  const base = 'C:\\Program Files\\Blender Foundation';
  if (process.platform === 'win32' && fs.existsSync(base)) {
    const vers = fs.readdirSync(base).filter(d => d.startsWith('Blender')).sort().reverse();
    for (const v of vers) {
      const exe = path.join(base, v, 'blender.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return 'blender'; // hope it's on PATH (linux/mac/CI)
}
const py = path.join(ROOT, 'scripts', 'normalize_buildings.py');
const BLENDER = findBlender();
console.log(`\n[${W.name}] blender (${BLENDER}): ${jobs.length} buildings, one process each`);
let ok = 0, failed = 0;
for (const j of jobs) {
  const out = path.join(GEN_DIR, `placed_bld_${j.id}.glb`);
  const placement = { targetTris: TARGET_TRIS, out: path.resolve(out), buildings: [j] };
  const placementPath = path.join(GEN_DIR, `placement_${j.id}.json`);
  fs.writeFileSync(placementPath, JSON.stringify(placement, null, 2));
  const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python', py, '--', placementPath],
    { cwd: ROOT, encoding: 'utf8' });
  const norm = (r.stdout || '').split('\n').filter(l => l.includes('[normalize]')).join('\n');
  if (r.status !== 0 || !fs.existsSync(out)) {
    failed++;
    console.log(`  FAIL ${j.id} (blender exit ${r.status})\n${norm}`);
    if (r.stderr) console.log('  ' + r.stderr.split('\n').slice(0, 4).join('\n  '));
    continue;
  }
  ok++;
  console.log(`  OK ${j.id} -> ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)\n${norm}`);
}
console.log(`\n[${W.name}] normalize DONE: ${ok} ok, ${failed} failed -> ${path.relative(ROOT, GEN_DIR)}/placed_bld_*.glb`);
if (!ok) process.exit(1);
