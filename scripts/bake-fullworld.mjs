// bake-fullworld (v4): scale the proven test3/test4 T-junction pipeline to the WHOLE
// Netanya/Mishkenot neighbourhood so ?world=mishkenot&v4 reads like the test3/8090 look
// everywhere — warm daylight (from index.html buildMishkenotWorld), muted grass, tiled
// paver/asphalt roads with kerbs, cream articulated facades, and trees at real positions.
//
// This is a GENERALIZATION of bake-test4.mjs, not a rewrite: the in-page scene functions
// (bakeGround / bakeRoadPrepped / bakeIslands / bakeFurniture / bakeBuilding /
// bakeAerialTrees) are reused verbatim. What changes is the NODE-side prep that feeds them:
//   - roads: auto-built from roads.json (every drivable road), paver/asphalt classified,
//     the four hand-tuned T-junction roads keep their tuned style via scene-tjunction.json.
//   - buildings: the 16 that have v3 programs are built with full facade trim (makeBuildingV3
//     + frontage); the other ~285 are extruded from their real footprints as cream low-poly
//     volumes (makeFootprintBuilding) — the test3 background look, small GLB, no hand-auth.
//   - ground: one box over the full building-footprint extent.
//   - trees: real AERIAL positions where we have imagery (detect-trees output), plus a light
//     deterministic procedural verge pass along every road for the rest of the hood (the
//     brief's stated fallback until per-street SV fills detail in). Prefers a `fullworld`
//     aerial tree file if present, else falls back to the committed `tjunction` one.
//
// Run: node scripts/bake-fullworld.mjs --world=netanya
//        [--out=assets/mishkenot/world_v4.glb]
//        [--bbox=xW,xE,zN,zS]   corridor/de-risk subset in world metres (zN most negative)
//        [--trees=fullworld|tjunction]  aerial tree tag to load (auto: fullworld if present)
//        [--noproc]             disable the procedural verge trees (aerial only)
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const OUT = arg('out', path.join(path.dirname(W.paths.assetGlb), 'world_v4.glb'));
const PROPS_DIR = path.join(ROOT, 'assets/props/kenney-nature');
const NOPROC = argv.includes('--noproc');

const BLD = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const ROADS = JSON.parse(fs.readFileSync(path.join(W.paths.dir, 'roads.json'), 'utf8')).roads;
const PROG_DIR = path.join(W.paths.specWork, 'programs');
const SCENE_T = JSON.parse(fs.readFileSync(path.join(W.paths.specWork, 'scene-tjunction.json'), 'utf8'));

// optional bbox filter (corridor / de-risk). world metres: xW,xE,zN,zS (zN most negative).
const bboxArg = arg('bbox', '');
const BBOX = bboxArg ? bboxArg.split(',').map(Number) : null;   // [xW,xE,zN,zS]
const inBox = (x, z, m = 0) => !BBOX || (x >= BBOX[0] - m && x <= BBOX[1] + m && z >= BBOX[2] - m && z <= BBOX[3] + m);

// aerial trees: prefer fullworld, fall back to the committed tjunction set.
const aerialDir = path.join(W.paths.dir, 'aerial');
let AERIAL_TAG = arg('trees', '');
if (!AERIAL_TAG) AERIAL_TAG = fs.existsSync(path.join(aerialDir, 'fullworld-trees.json')) ? 'fullworld' : 'tjunction';
const aerialTreeFile = path.join(aerialDir, AERIAL_TAG + '-trees.json');
const AERIAL = fs.existsSync(aerialTreeFile) ? JSON.parse(fs.readFileSync(aerialTreeFile, 'utf8')) : { trees: [], world: null };
const AERIAL_AOI = AERIAL.world || null;   // rect the aerial actually covers (avoid double-planting)

// ---- geometry helpers (identical to bake-test4 / rebake-programs) ----
function nearestRoad(cx, cz) {
  let best = { d: Infinity };
  for (const rd of ROADS) {
    if (!rd.pts || rd.pts.length < 2 || rd.type === 'path') continue;
    for (let i = 0; i < rd.pts.length - 1; i++) {
      const [ax, az] = rd.pts[i], [bx, bz] = rd.pts[i + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / L2)) : 0;
      const qx = ax + t * dx, qz = az + t * dz, d = Math.hypot(cx - qx, cz - qz);
      if (d < best.d) best = { d, qx, qz, ux: dx / Math.sqrt(L2 || 1), uz: dz / Math.sqrt(L2 || 1), type: rd.type, id: rd.id };
    }
  }
  return best;
}
function hull(pts) {
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function minAreaOBB(pts) {
  const H = hull(pts); let best = null;
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
      best = { area, angle: a, du: uMax - uMin, dv: vMax - vMin, cx: cu * c - cv * s, cz: cu * s + cv * c };
    }
  }
  return best;
}
function inFoot(x, z, f) {
  let inside = false;
  for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
    const [xi, zi] = f[i], [xj, zj] = f[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- ground: one box over the full footprint extent (or the bbox) ----------
let gx0 = 1e9, gx1 = -1e9, gz0 = 1e9, gz1 = -1e9;
for (const b of BLD) for (const [x, z] of b.foot) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gz0 = Math.min(gz0, z); gz1 = Math.max(gz1, z); }
const GPAD = 24;
const ground = BBOX
  ? { lawn: SCENE_T.ground.lawn, x0: BBOX[0] - 8, x1: BBOX[1] + 8, z0: BBOX[2] - 8, z1: BBOX[3] + 8 }
  : { lawn: SCENE_T.ground.lawn, x0: gx0 - GPAD, x1: gx1 + GPAD, z0: gz0 - GPAD, z1: gz1 + GPAD };

// ---------- roads: auto-build from roads.json, keep the tuned T-junction 4 ----------
const HALFW = { avenue: 3.6, street: 3.4, service: 2.6, plaza: 2.4 };
function classify(rd) {
  // pavers = the genuinely-special raised terracotta pedestrian ways / plazas (per-tile geometry
  // is expensive, so keep it to the streets that actually read as pavers). Ordinary residential
  // living-streets render as grey asphalt. The four tuned T-junction roads keep whatever surface
  // scene-tjunction.json declares (STYLE_KEYS spread below), so the paver spine stays paver.
  return (rd.hw === 'pedestrian' || rd.type === 'plaza') ? 'pavers' : 'asphalt';
}
const STYLE_KEYS = ['surface', 'color', 'halfW', 'kerb', 'grout', 'raise', 'band', 'bandW', 'threshold', 'paint'];
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k]; return r; };
const sceneRoadById = id => SCENE_T.roads.find(x => String(x.id) === String(id));

const sceneRoads = [];
for (const rd of ROADS) {
  if (!rd.pts || rd.pts.length < 2 || rd.type === 'path') continue;
  if (BBOX && !rd.pts.some(([x, z]) => inBox(x, z, 30))) continue;
  const cls = classify(rd);
  const base = cls === 'pavers'
    ? { id: rd.id, surface: 'pavers', color: '#b06f4e', grout: '#7a4a34', raise: 0.06, kerb: '#c4bfb4', halfW: HALFW[rd.type] || 3.2 }
    : { id: rd.id, surface: 'asphalt', color: '#8f9296', kerb: '#b9bdc2', halfW: HALFW[rd.type] || 3.4 };
  const spec = { ...base, ...pick(sceneRoadById(rd.id), STYLE_KEYS), pts: rd.pts };
  sceneRoads.push(spec);
}
const paverCount = sceneRoads.filter(r => r.surface === 'pavers').length;
console.log(`[fullworld] roads: ${sceneRoads.length} drivable (${paverCount} paver / ${sceneRoads.length - paverCount} asphalt)`);

// ---------- islands / signs / lamps / bollards: keep the hand-authored T-junction set ----------
const islands = (SCENE_T.islands || []).filter(o => inBox(o.cx, o.cz, 20));
const signs = (SCENE_T.signs || []).filter(o => inBox(o.x, o.z, 20));
const lamps = (SCENE_T.lamps || []).filter(o => inBox(o.x, o.z, 20));
const bollards = (SCENE_T.bollards || []).filter(o => inBox(o.x, o.z, 20));

// ---------- building jobs ----------
const programmedIds = new Set(SCENE_T.ids.filter(id => fs.existsSync(path.join(PROG_DIR, `bld_${id}.json`))));
const jobs = [];               // v3-program buildings (full trim + frontage + env props)
for (const ID of programmedIds) {
  const b = BLD.find(x => String(x.id) === String(ID));
  if (!b) continue;
  if (BBOX && !inBox(b.cx, b.cz, 20)) continue;
  const program = JSON.parse(fs.readFileSync(path.join(PROG_DIR, `bld_${ID}.json`), 'utf8'));
  const o = minAreaOBB(b.foot);
  const r = nearestRoad(o.cx, o.cz);
  const dl = Math.hypot(r.qx - o.cx, r.qz - o.cz) || 1;
  const dir = [(r.qx - o.cx) / dl, (r.qz - o.cz) / dl];
  const cands = [
    { f: [Math.cos(o.angle), Math.sin(o.angle)], depth: o.du, lateral: o.dv },
    { f: [-Math.cos(o.angle), -Math.sin(o.angle)], depth: o.du, lateral: o.dv },
    { f: [-Math.sin(o.angle), Math.cos(o.angle)], depth: o.dv, lateral: o.du },
    { f: [Math.sin(o.angle), -Math.cos(o.angle)], depth: o.dv, lateral: o.du },
  ];
  const front = cands.reduce((a2, c2) => (c2.f[0] * dir[0] + c2.f[1] * dir[1] > a2.f[0] * dir[0] + a2.f[1] * dir[1] ? c2 : a2));
  const rotY = Math.atan2(front.f[0], front.f[1]);
  let frontage = null, off = 0;
  {
    let nx = o.cx - r.qx, nz = o.cz - r.qz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    let lo2 = Infinity, hi = -Infinity, wallD = Infinity;
    for (const [fx, fz] of b.foot) {
      const u = (fx - r.qx) * r.ux + (fz - r.qz) * r.uz; lo2 = Math.min(lo2, u); hi = Math.max(hi, u);
      wallD = Math.min(wallD, (fx - r.qx) * nx + (fz - r.qz) * nz);
    }
    const edge = { avenue: 6.9, street: 4.9, service: 2.4, plaza: 5.5 }[r.type] || 4.9;
    off = Math.max(edge, Math.min(edge + 2.5, wallD - 1.0));
    const P = u => [r.qx + r.ux * u + nx * off, r.qz + r.uz * u + nz * off];
    frontage = { a: P(lo2 - 1.2), b: P(hi + 1.2), nx: -nx, nz: -nz };
  }
  jobs.push({ id: String(ID), program, obb: { cx: o.cx, cz: o.cz }, rotY,
    W: front.lateral, D: front.depth, frontage,
    roadFrame: { qx: r.qx, qz: r.qz, ux: r.ux, uz: r.uz, nx: (o.cx - r.qx) / dl, nz: (o.cz - r.qz) / dl },
    off, seed: parseInt(String(ID).slice(-6)) || 7 });
}

// plain buildings: everything without a v3 program → cream footprint extrusion.
function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const CREAM = ['#f3ecd8', '#efe7d1', '#f6f0dd', '#eae2cc', '#f1ead6'];
const plain = [];
for (const b of BLD) {
  if (programmedIds.has(String(b.id))) continue;
  if (!b.foot || b.foot.length < 3) continue;
  if (BBOX && !inBox(b.cx, b.cz, 12)) continue;
  const h = hash32(String(b.id));
  const floors = Math.max(1, b.levels || (b.height ? Math.round(b.height / 3) : 2));
  // small/low houses get occasional terracotta pitched-look roofs; taller ones stay cream flat
  const terracotta = floors <= 2 && (h % 100) < 32;
  plain.push({ foot: b.foot, floors: Math.min(floors, 12), wall: CREAM[h % CREAM.length],
    roofColor: terracotta ? (['#b0543c', '#a94b34', '#b85f42'][h % 3]) : (['#d8d2c2', '#ded7c6', '#d2ccbb'][h % 3]),
    shutters: (h % 3) === 0, doors: (b.area > 300 ? 2 : 1), gable: terracotta });
}
console.log(`[fullworld] buildings: ${jobs.length} programmed (trim) + ${plain.length} plain (footprint extrude)`);

// ---------- trees ----------
// (1) real aerial positions, roadway-culled (island grass / parked-car strips read as canopy).
const aerialTrees = AERIAL.trees.filter(t => {
  if (BBOX && !inBox(t.x, t.z, 6)) return false;
  const r = nearestRoad(t.x, t.z);
  const scR = sceneRoads.find(x => String(x.id) === String(r.id));
  return r.d >= ((scR ? scR.halfW : 3.4) + 0.6);
});
// (2) procedural verge trees: walk every road, drop a canopy on each side just past the kerb
// at ~11 m spacing, skipping anything on a footprint or inside the aerial AOI (no double-plant).
const footsAll = BLD.map(b => b.foot).filter(f => f && f.length >= 3);
const inAnyFoot = (x, z) => footsAll.some(f => inFoot(x, z, f));
const inAerialAOI = (x, z) => AERIAL_AOI && x >= AERIAL_AOI.xWest - 4 && x <= AERIAL_AOI.xEast + 4 && z >= AERIAL_AOI.zNorth - 4 && z <= AERIAL_AOI.zSouth + 4;
const procTrees = [];
if (!NOPROC) {
  for (const rd of sceneRoads) {
    const pts = rd.pts; let acc = 0, next = 6;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-6, ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      while (next < acc + L) {
        const t = next - acc, px = ax + ux * t, pz = az + uz * t;
        for (const sd of [-1, 1]) {
          const off = rd.halfW + 2.6;
          const x = px + nx * sd * off, z = pz + nz * sd * off;
          if (!inBox(x, z, 0)) continue;
          if (inAerialAOI(x, z)) continue;      // core already has real aerial trees
          if (inAnyFoot(x, z)) continue;         // don't grow trees through a house
          const hh = hash32(`${x.toFixed(1)},${z.toFixed(1)}`);
          if ((hh % 100) < 30) {                 // ~30% of verge slots planted → airy, not a wall
            const sp = (hh % 11) === 0 ? 'canopy-large' : (hh % 5) < 2 ? 'shrub' : 'canopy-med';
            const r = sp === 'canopy-large' ? 3.4 : sp === 'shrub' ? 1.3 : 2.3;
            procTrees.push({ x: +x.toFixed(1), z: +z.toFixed(1), r, species: sp, proc: true });
          }
        }
        next += 15;
      }
      acc += L;
    }
  }
}
const TREES = aerialTrees.concat(procTrees);
console.log(`[fullworld] trees: ${aerialTrees.length} aerial (${AERIAL_TAG}) + ${procTrees.length} procedural verge = ${TREES.length}`);

const SCENE = { ground, roads: sceneRoads, islands, signs, lamps, bollards };

const PAGE = String.raw`<!doctype html><html><head><meta charset=utf8></head><body>
<script src="/three.min.js"></script>
<script src="/GLTFLoader.js"></script>
<script src="/GLTFExporter.js"></script>
<script src="/house-factory.js"></script>
<script>
window.RESULT=null;window.ERR=null;
var JOBS=` + JSON.stringify(jobs) + `;
var PLAIN=` + JSON.stringify(plain) + `;
var SCENE=` + JSON.stringify(SCENE) + `;
var TREES=` + JSON.stringify(TREES) + `;
var KP=[],KN=[],KC=[];
function collect(mesh){var g=mesh.geometry;g=g.index?g.toNonIndexed():g.clone();g.applyMatrix4(mesh.matrixWorld);
  if(!g.attributes.normal)g.computeVertexNormals();
  var pos=g.attributes.position.array,nrm=g.attributes.normal.array,col=g.attributes.color?g.attributes.color.array:null,cis=col?g.attributes.color.itemSize:0;
  var mc=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material).color||{r:1,g:1,b:1};
  for(var i=0;i<pos.length;i+=3){KP.push(pos[i],pos[i+1],pos[i+2]);KN.push(nrm[i],nrm[i+1],nrm[i+2]);}
  for(var v=0;v<pos.length/3;v++){var r=col?col[v*cis]:1,gg=col?col[v*cis+1]:1,b=col?col[v*cis+2]:1;KC.push(r*mc.r,gg*mc.g,b*mc.b);}}
function collectAll(root){root.updateMatrixWorld(true);root.traverse(function(m){if(m.isMesh)collect(m);});}
var CACHE={};
function loadProp(name){if(CACHE[name])return Promise.resolve(CACHE[name]);
  return new Promise(function(res,rej){new THREE.GLTFLoader().load('/props/'+name+'.glb',function(g){CACHE[name]=g.scene;res(g.scene);},undefined,rej);});}
function instProp(src,spec,px,pz,rot){
  var obj=src.clone(true);
  obj.updateMatrixWorld(true);
  var bb=new THREE.Box3().setFromObject(obj),sz=bb.getSize(new THREE.Vector3());
  var sy=(spec.h||2)/Math.max(0.01,sz.y),sxz=sy*(spec.rxz||1);
  obj.traverse(function(m){if(!m.isMesh)return;
    var mats=Array.isArray(m.material)?m.material:[m.material];
    var out=[];
    for(var i=0;i<mats.length;i++){var mat=mats[i];var col=mat.color?mat.color.clone():new THREE.Color(1,1,1);
      if(spec.tint){var mn=(mat.name||'').toLowerCase();var hit=false;
        for(var k in spec.tint){if(k!=='*'&&mn.indexOf(k.toLowerCase())>=0){col=new THREE.Color(spec.tint[k]);hit=true;break;}}
        if(!hit&&spec.tint['*'])col=new THREE.Color(spec.tint['*']);}
      out.push(new THREE.MeshLambertMaterial({color:col}));}
    m.material=Array.isArray(m.material)?out:out[0];});
  var wrap=new THREE.Group();wrap.add(obj);
  obj.scale.set(sxz,sy,sxz);obj.updateMatrixWorld(true);
  var bb2=new THREE.Box3().setFromObject(obj);
  obj.position.y-=bb2.min.y;
  wrap.position.set(px,spec.y||0,pz);wrap.rotation.y=rot||0;
  return wrap;}
function mkBox(w,h,d,color,px,py,pz,rot){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:new THREE.Color(color)}));
  m.position.set(px,py,pz);m.rotation.y=rot||0;return m;}
function mkCar(sp,px,pz,rot){
  var g2=new THREE.Group(),c=sp.color||'#d8d8d8',dkr=new THREE.Color(c).multiplyScalar(0.85).getStyle();
  g2.add(mkBox(4.2,0.68,1.78,c,0,0.62,0));
  g2.add(mkBox(2.3,0.52,1.62,c,-0.15,1.18,0));
  g2.add(mkBox(2.31,0.34,1.5,'#3a4750',-0.15,1.16,0));
  g2.add(mkBox(0.5,0.2,1.5,dkr,1.95,0.5,0));
  g2.add(mkBox(0.5,0.2,1.5,dkr,-1.95,0.5,0));
  for(var wx=-1;wx<=1;wx+=2)for(var wz=-1;wz<=1;wz+=2){
    var wh2=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.24,10),new THREE.MeshLambertMaterial({color:0x24262a}));
    wh2.rotation.x=Math.PI/2;wh2.position.set(wx*1.35,0.34,wz*0.82);g2.add(wh2);}
  g2.position.set(px,0,pz);g2.rotation.y=rot;return g2;}
function mkLamp(px,pz,rot){
  var g3=new THREE.Group(),grey='#8d9296';
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.12,5.4,8),new THREE.MeshLambertMaterial({color:new THREE.Color(grey)}));
  pole.position.y=2.7;g3.add(pole);
  g3.add(mkBox(1.3,0.14,0.14,grey,0.6,5.5,0));
  g3.add(mkBox(0.55,0.22,0.3,'#e8e4d2',1.25,5.42,0));
  g3.position.set(px,0,pz);g3.rotation.y=rot;return g3;}
function mkGlobeLamp(px,pz){
  var g3=new THREE.Group(),grey='#9aa0a4';
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.1,3.9,8),new THREE.MeshLambertMaterial({color:new THREE.Color(grey)}));
  pole.position.y=1.95;g3.add(pole);
  var head=new THREE.Mesh(new THREE.SphereGeometry(0.32,10,8),new THREE.MeshLambertMaterial({color:new THREE.Color('#f2f0e4')}));
  head.position.y=4.1;g3.add(head);
  g3.position.set(px,0,pz);return g3;}
function mkDoubleLamp(px,pz,rot){
  var g3=new THREE.Group(),grey='#8d9296';
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.13,6.2,8),new THREE.MeshLambertMaterial({color:new THREE.Color(grey)}));
  pole.position.y=3.1;g3.add(pole);
  for(var s=-1;s<=1;s+=2){
    g3.add(mkBox(1.25,0.13,0.13,grey,s*0.58,6.28,0));
    g3.add(mkBox(0.5,0.2,0.28,'#e8e4d2',s*1.18,6.2,0));}
  g3.position.set(px,0,pz);g3.rotation.y=rot;return g3;}
function mkTSign(px,pz,rot){
  var g4=new THREE.Group();
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.06,2.5,8),new THREE.MeshLambertMaterial({color:new THREE.Color('#9aa0a4')}));
  pole.position.y=1.25;g4.add(pole);
  g4.add(mkBox(0.62,0.62,0.05,'#1e62c8',0,2.55,0));
  g4.add(mkBox(0.4,0.11,0.06,'#f4f4f0',0,2.72,0));
  g4.add(mkBox(0.11,0.34,0.06,'#f4f4f0',0,2.48,0));
  g4.position.set(px,0,pz);g4.rotation.y=rot;return g4;}
function mkBollard(px,pz){
  var m=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.75,8),new THREE.MeshLambertMaterial({color:new THREE.Color('#dcd8cc')}));
  m.position.set(px,0.45,pz);return m;}
function mkDumpster(px,pz,rot){
  var g4=new THREE.Group(),grn='#3f7d3a';
  g4.add(mkBox(1.45,1.0,1.05,grn,0,0.62,0));
  g4.add(mkBox(1.5,0.12,1.1,'#356a31',0,1.18,0));
  for(var dw=-1;dw<=1;dw+=2)g4.add(mkBox(0.16,0.24,0.16,'#222',dw*0.55,0.12,0.3));
  g4.position.set(px,0,pz);g4.rotation.y=rot;return g4;}
function mkPlanter(sp,px,pz,rot){
  var g5=new THREE.Group(),bc=sp.color||'#c8a97e';
  g5.add(mkBox(sp.w||2.2,0.55,sp.d||1.2,bc,0,0.28,0));
  g5.add(mkBox((sp.w||2.2)+0.1,0.1,(sp.d||1.2)+0.1,'#b39468',0,0.58,0));
  g5.position.set(px,0,pz);g5.rotation.y=rot;return g5;}

// ---- scene pass: ground, road arms from polylines, kerbs+paint, islands, signs, lamps ----
function bakeGround(){
  var g=SCENE.ground;
  var w=g.x1-g.x0,d=g.z1-g.z0;
  collectAll(mkBox(w,0.3,d,g.lawn||'#7ec850',(g.x0+g.x1)/2,-0.15,(g.z0+g.z1)/2,0));}
function roadWalk(pts){
  var segs=[],acc=0;
  for(var i=0;i<pts.length-1;i++){
    var dx=pts[i+1][0]-pts[i][0],dz=pts[i+1][1]-pts[i][1],L=Math.hypot(dx,dz);
    segs.push({ax:pts[i][0],az:pts[i][1],ux:dx/L,uz:dz/L,L:L,s0:acc});acc+=L;}
  segs.total=acc;return segs;}
function atArc(segs,s){
  s=Math.max(0,Math.min(segs.total-1e-6,s));
  for(var i=0;i<segs.length;i++){var g=segs[i];
    if(s<=g.s0+g.L||i===segs.length-1){var t=s-g.s0;
      return {x:g.ax+g.ux*t,z:g.az+g.uz*t,ux:g.ux,uz:g.uz,nx:-g.uz,nz:g.ux};}}}
function prepSegs(rd){var segs=roadWalk(rd.pts);
  for(var i=0;i<segs.length;i++){(function(g){
    g.nxn=function(sd){return -g.uz*sd*(rd.halfW+0.16);} ;
    g.nzn=function(sd){return  g.ux*sd*(rd.halfW+0.16);} ;})(segs[i]);}
  return segs;}
async function bakeIslands(){
  for(var ii=0;ii<(SCENE.islands||[]).length;ii++){var isl=SCENE.islands[ii];
    var rot=(isl.rotDeg||0)*Math.PI/180, ca=Math.cos(rot),sa=Math.sin(rot);
    var per=2*Math.PI*Math.sqrt((isl.a*isl.a+isl.b*isl.b)/2), n=Math.max(14,Math.round(per/0.55));
    for(var k=0;k<n;k++){var th=k/n*2*Math.PI;
      var lx=isl.b*Math.cos(th), lz=isl.a*Math.sin(th);
      var tx=-isl.b*Math.sin(th), tz=isl.a*Math.cos(th);
      var wx=isl.cx+lx*ca+lz*sa, wz=isl.cz-lx*sa+lz*ca;
      var wtx=tx*ca+tz*sa, wtz=-tx*sa+tz*ca;
      collectAll(mkBox(0.26,0.3,0.62,isl.kerb||'#c4bfb4',wx,0.12,wz,Math.atan2(wtx,wtz)));}
    var fill=new THREE.Mesh(new THREE.CylinderGeometry(1,1,0.24,24),new THREE.MeshLambertMaterial({color:new THREE.Color(isl.grass||'#6fae46')}));
    fill.scale.set(isl.b-0.18,1,isl.a-0.18);fill.position.set(isl.cx,0.12,isl.cz);fill.rotation.y=rot;
    collectAll(fill);
    for(var fi=0;fi<(isl.fill||[]).length;fi++){var f=isl.fill[fi];
      var fx=isl.cx+f.dx*ca+f.dz*sa, fz=isl.cz-f.dx*sa+f.dz*ca;
      var src=await loadProp(f.model);
      var inst=instProp(src,{h:f.h,tint:f.tint,rxz:f.rxz,y:0.24},fx,fz,(fi*1.7)%(Math.PI*2));
      collectAll(inst);}}
}
function bakeFurniture(){
  for(var i=0;i<(SCENE.signs||[]).length;i++){var sg=SCENE.signs[i];
    if(sg.type==='tsign')collectAll(mkTSign(sg.x,sg.z,(sg.rotDeg||0)*Math.PI/180));}
  for(var j=0;j<(SCENE.lamps||[]).length;j++){var lp=SCENE.lamps[j];
    var r=(lp.rotDeg||0)*Math.PI/180;
    collectAll(lp.style==='globe'?mkGlobeLamp(lp.x,lp.z)
      :lp.style==='double'?mkDoubleLamp(lp.x,lp.z,r):mkLamp(lp.x,lp.z,r));}
  for(var k=0;k<(SCENE.bollards||[]).length;k++){var bo=SCENE.bollards[k];
    collectAll(mkBollard(bo.x,bo.z));}}

// ---- per-building pass: programmed house + frontage + environment props ----
async function bakeBuilding(JOB){
  var env=JOB.program.environment||{};
  var fr=JOB.frontage,rf=JOB.roadFrame;
  var ax=fr.a[0],az=fr.a[1],bx=fr.b[0],bz=fr.b[1];
  var L=Math.hypot(bx-ax,bz-az),fux=(bx-ax)/L,fuz=(bz-az)/L;
  var inx=-fr.nx,inz=-fr.nz;
  function F(t,inset){return [ax+fux*L*t+inx*inset, az+fuz*L*t+inz*inset];}
  var hw=(env.road&&env.road.halfW)||3.4;
  if(env.driveway){var dv=env.driveway;var dP=F(dv.at,0);
    var dLen=Math.max(1,JOB.off-hw+0.3);
    var dcx=dP[0]-inx*dLen/2,dcz=dP[1]-inz*dLen/2;
    var m2=new THREE.Mesh(new THREE.BoxGeometry(dv.w||5,0.2,dLen),new THREE.MeshLambertMaterial({color:new THREE.Color(dv.color||'#a89d8b')}));
    m2.position.set(dcx,0.1,dcz);m2.rotation.y=Math.atan2(inx,inz);collectAll(m2);}
  var model=makeBuildingV3(JOB.program,JOB.W,JOB.D);
  model.rotation.y=JOB.rotY;model.position.set(JOB.obb.cx,0,JOB.obb.cz);
  collectAll(model);
  var fro=makeFrontageV3(JOB.program,JOB.frontage,JOB.seed);
  collectAll(fro);
  var placed=0;var rnd=(function(seed){var s2=seed>>>0||1;return function(){s2=(s2*1664525+1013904223)>>>0;return s2/4294967296;};})(JOB.seed);
  var specs=env.props||[];
  for(var i2=0;i2<specs.length;i2++){var sp=specs[i2];
    if(sp.model&&sp.model.indexOf('tree_')===0)continue;   // trees come from aerial/procedural
    if(sp.car||sp.lamp||sp.bin||sp.planter){
      var pk=F(sp.t,sp.inset!=null?sp.inset:1);
      var rotk=(sp.rot==='along')?Math.atan2(-rf.uz,rf.ux)+(sp.flip?Math.PI:0):(sp.rot||0)*Math.PI/180;
      var made=sp.car?mkCar(sp,pk[0],pk[1],rotk):sp.lamp?mkLamp(pk[0],pk[1],rotk)
              :sp.bin?mkDumpster(pk[0],pk[1],rotk):mkPlanter(sp,pk[0],pk[1],rotk);
      collectAll(made);placed++;continue;}
    if(sp.hedge){
      var cols=sp.colors||['#3c7031','#2f5d2a'];
      for(var th=sp.t0;th<=sp.t1+1e-6;th+=(sp.step||1.4)/L){
        var ph=F(th,(sp.inset||1)+ (rnd()-0.5)*0.2);
        var hh=(sp.h||3)*(0.92+rnd()*0.16),hw2=(sp.step||1.4)*1.45,hd=(sp.d||1.8);
        var hm=new THREE.Mesh(new THREE.BoxGeometry(hw2,hh,hd),new THREE.MeshLambertMaterial({color:new THREE.Color(cols[Math.floor(rnd()*cols.length)])}));
        hm.position.set(ph[0],hh/2,ph[1]);hm.rotation.y=Math.atan2(fux,fuz)+Math.PI/2+(rnd()-0.5)*0.15;
        collectAll(hm);placed++;}}
    else if(sp.row){var src=await loadProp(sp.row);
      for(var t2=sp.t0;t2<=sp.t1+1e-6;t2+=(sp.step||1.5)/L){
        var p2=F(t2,sp.inset||1);collectAll(instProp(src,sp,p2[0],p2[1],rnd()*Math.PI*2));placed++;}}
    else{var src2=await loadProp(sp.model);
      var p3=F(sp.t,sp.inset||1);collectAll(instProp(src2,sp,p3[0],p3[1],rnd()*Math.PI*2));placed++;}}
  return placed;}

// ---- plain buildings: cream low-poly footprint extrusion (the test3 background look) ----
function bakePlain(){
  for(var i=0;i<PLAIN.length;i++){var b=PLAIN[i];
    var g=makeFootprintBuilding(b.foot,{floors:b.floors,wall:b.wall,roofColor:b.roofColor,
      shutters:b.shutters,doors:b.doors,glass:'#8fa0ad'});
    collectAll(g);}
  return PLAIN.length;}

// ---- tree layer: place canopy at every point (aerial + procedural, pre-filtered in node) ----
// Model rotation is kept LIGHT for the hundreds of background/procedural trees (tree_default 384v,
// tree_pineTallA 272v, tree_oak 648v) with detailed palms reserved for the rare large canopies
// that anchor the hero foreground. Keeps the merged GLB small enough to commit + load in-browser.
var TREE_KINDS={
  'canopy-large':{models:['tree_palmDetailedTall','tree_oak'],hMul:2.3,hMin:6,hMax:11,rxz:1.15,
    tints:[{leafs:'#3f9b42',wood:'#a08a67','*':'#a08a67'},{leafs:'#3c7031',wood:'#6e5138','*':'#6e5138'}]},
  'canopy-med':{models:['tree_oak','tree_default','tree_pineTallA'],hMul:2.0,hMin:4,hMax:7,rxz:1.05,
    tints:[{leafs:'#4c8a34',wood:'#6e5138','*':'#4c8a34'},{leafs:'#46a648',wood:'#8a7454','*':'#46a648'},{leafs:'#3d6b39','*':'#3d6b39'}]},
  'shrub':{models:['plant_bushLarge'],hMul:1.7,hMin:1.4,hMax:3,rxz:1.2,
    tints:[{leafs:'#4c8a34','*':'#44603a'}]}};
async function bakeTrees(){
  var n=0;
  for(var i=0;i<TREES.length;i++){var t=TREES[i];
    var kind=TREE_KINDS[t.species]||TREE_KINDS['canopy-med'];
    var pick=(Math.abs(Math.round(t.x*7+t.z*13))+i)%kind.models.length;
    var model=kind.models[pick],tint=kind.tints[pick%kind.tints.length];
    var h=Math.max(kind.hMin,Math.min(kind.hMax,t.r*kind.hMul));
    var src=await loadProp(model);
    collectAll(instProp(src,{h:h,tint:tint,rxz:kind.rxz},t.x,t.z,(i*2.399)%(Math.PI*2)));n++;}
  return n;}

function bakeRoadPrepped(rd,segs){
  var y=rd.raise!=null?rd.raise:0.02, topH=0.1;
  var startAt=rd.startAt||0;
  for(var i=0;i<segs.length;i++){var g=segs[i];
    var ext0=(i===0?(rd.extendStart||0):0.3),ext1=(i===segs.length-1?(rd.extendEnd||0):0.3);
    var s1=g.s0+g.L;
    if(s1<startAt)continue;
    var a0=Math.max(g.s0,startAt)-ext0, a1=s1+ext1;
    var mid=(a0+a1)/2, len=a1-a0;
    var cx=g.ax+g.ux*(mid-g.s0),cz=g.az+g.uz*(mid-g.s0);
    var rot=Math.atan2(g.ux,g.uz);
    if(rd.surface==='pavers'){
      collectAll(mkBox(rd.halfW*2,topH,len,rd.grout||'#7a4a34',cx,y-0.004,cz,rot));
      var band=(rd.band?(rd.bandW||2.2):0)/2, step=1.0, tw=0.94, half=rd.halfW;
      for(var u=-len/2+step/2;u<len/2-1e-3;u+=step){
        for(var a=-half+step/2;a<half-1e-3;a+=step){
          var isBand=band>0&&Math.abs(a)<band+0.01;
          var h1=Math.sin((u*12.9898+a*78.233))*43758.5453; var jit=h1-Math.floor(h1);
          var col=new THREE.Color(isBand?rd.band:rd.color).offsetHSL(0,(jit-0.5)*0.02,(jit-0.5)*0.08);
          var tx=cx+g.ux*u-g.uz*a, tz=cz+g.uz*u+g.ux*a;
          collectAll(mkBox(tw,topH+0.006,tw,col,tx,y+0.004,tz,rot));}}
    } else {
      collectAll(mkBox(rd.halfW*2,topH,len,rd.color,cx,y,cz,rot));
      collectAll(mkBox(0.12,topH+0.004,len,new THREE.Color(rd.color).offsetHSL(0,0,-0.06),cx,y+0.004,cz,rot));
    }
    for(var sd=-1;sd<=1;sd+=2){
      var kcol=rd.kerb||'#b9bdc2';
      collectAll(mkBox(0.34,0.18,len,new THREE.Color(kcol).offsetHSL(0,0,-0.05),cx+g.nxn(sd),y+0.06,cz+g.nzn(sd),rot));
      collectAll(mkBox(0.24,0.05,len,new THREE.Color(kcol).offsetHSL(0,0,0.08),cx+g.nxn(sd),y+0.155,cz+g.nzn(sd),rot));}}
  var paints=rd.paint||[];
  for(var pi=0;pi<paints.length;pi++){var sp=paints[pi];
    for(var s=sp.from,ki=0;s<Math.min(sp.to,segs.total);s+=1.0,ki++){
      var p2=atArc(segs,s+0.5);
      var off=(rd.halfW+0.17)*sp.side;
      collectAll(mkBox(0.36,0.18,0.98,(ki%2?'#e8e6e0':'#c94434'),
        p2.x+p2.nx*off,y+0.06,p2.z+p2.nz*off,Math.atan2(p2.ux,p2.uz)));}}
  if(rd.threshold){
    var p3=atArc(segs,rd.threshold.at);
    for(var q=-3;q<=3;q++)
      collectAll(mkBox(0.98,0.2,0.36,(q%2?'#e8e6e0':'#c94434'),
        p3.x+p3.nx*q*1.0,y+0.04,p3.z+p3.nz*q*1.0,Math.atan2(p3.ux,p3.uz)));
    var ramp=mkBox(rd.halfW*2,0.1,1.6,'#9aa0a4',p3.x-p3.ux*1.4,y-0.03,p3.z-p3.uz*1.4,Math.atan2(p3.ux,p3.uz));
    ramp.rotation.x=-0.06;collectAll(ramp);}
}

async function main(){
  bakeGround();
  for(var r=0;r<SCENE.roads.length;r++){var rd=SCENE.roads[r];bakeRoadPrepped(rd,prepSegs(rd));}
  await bakeIslands();
  bakeFurniture();
  var placed=0;
  for(var bi=0;bi<JOBS.length;bi++)placed+=await bakeBuilding(JOBS[bi]);
  var np=bakePlain();
  var nt=await bakeTrees();
  console.log('  programmed '+JOBS.length+', plain '+np+', trees '+nt+', props '+placed);
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(KP,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(KN,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(KC,3));
  var mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  var glb=await new Promise(function(res,rej){new THREE.GLTFExporter().parse(mesh,res,{binary:true},rej);});
  var bytes=new Uint8Array(glb),bin='';var CH=32768;
  for(var i3=0;i3<bytes.length;i3+=CH)bin+=String.fromCharCode.apply(null,bytes.subarray(i3,i3+CH));
  window.RESULT={b64:btoa(bin),tris:KP.length/9,props:placed,buildings:JOBS.length+np,trees:nt};
}
main().catch(function(e){window.ERR=String(e&&e.stack||e);});
</script></body></html>`;

const V = p2 => fs.readFileSync(path.join(ROOT, 'scripts/vendor', p2));
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (req.url === '/three.min.js' || req.url === '/GLTFLoader.js' || req.url === '/GLTFExporter.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(V(req.url.slice(1))); }
  if (req.url === '/house-factory.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(ROOT, 'scripts/house-factory.js'))); }
  if (req.url.startsWith('/props/')) {
    const f = path.join(PROPS_DIR, path.basename(req.url));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); return res.end(fs.readFileSync(f)); }
  }
  res.writeHead(404); res.end();
});
await new Promise(r2 => server.listen(0, r2)); const port = server.address().port;
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', m => console.log('  [page]', m.text()));
await page.goto('http://localhost:' + port + '/', { waitUntil: 'load' });
await page.waitForFunction('window.RESULT||window.ERR', { timeout: 600000 });
const err = await page.evaluate('window.ERR');
if (err) { console.error('ERROR:\n' + err); try { await browser.close(); } catch {} server.close(); process.exit(1); }
const R = await page.evaluate('window.RESULT'); const b64 = R.b64; delete R.b64;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(JSON.stringify(R));
console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB)');
try { await browser.close(); } catch {} server.close();
process.exit(0);
