// test3: bake the whole T-junction area (HaRav Toledano x HaRav Unterman) as a standalone
// world — all 16 programmed buildings + frontages + environment props, the four real road
// arms from roads.json polylines (asphalt south arm, raised terracotta paver street north,
// narrow paver alley east, Unterman west), the planted traffic island in the fork with the
// blue T-sign, the mid-street planted bed, red-white painted kerbs and street lamps.
// Scene-level geometry lives in spec-work/scene-tjunction.json; per-building props in each
// program's "environment" section (same schema as test1/test2, minus ground/road which are
// drawn once here).
//
// Run: node scripts/bake-tjunction.mjs --world=netanya
//      [--ids=556597974,...] [--out=assets/mishkenot/world_test3.glb]
// Also writes spec-work/tjunction-frames.json (per-building frontage frames) for the
// environment-extraction agents.
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
// FULL WORLD (v4): bring the test3 look to the whole neighbourhood — all roads (tiled+kerbed),
// ALL buildings (rich v3 program where one exists, else auto-extruded footprint), and aerial
// trees. Scoped by --region=xW,xE,zN,zS (corridor-first) to validate before going wide.
const OUT = arg('out', path.join(path.dirname(W.paths.assetGlb), 'world_v4.glb'));
const PROPS_DIR = path.join(ROOT, 'assets/props/kenney-nature');
const REGION = (arg('region', '40,210,-460,-180')).split(',').map(Number);   // xW,xE,zN,zS
const inRegion = (x, z) => x >= REGION[0] && x <= REGION[1] && z >= REGION[2] && z <= REGION[3];
// Curated zones = hand-tuned areas (the T-junction test3 set) that the generic full-world
// passes must NOT override: keep their hand-authored env (exact trees/cars/hedges) + scene
// furniture, and SUPPRESS procedural furniture + aerial trees inside them. Add zones here as
// more areas get the exact treatment.
// PARTS: non-overlapping hand-tuned areas. Each keeps its buildings' hand env (cars/hedges/
// trees) + scene furniture, and suppresses the generic aerial-trees + procedural furniture
// inside it. `roads:true` = the part owns its roads (a scene config) so generic roads are
// suppressed inside it; `roads:false` = the part rides on the generic road network (keep them).
const CURATED = [
  { b: [85, 175, -450, -235], roads: true },    // Part 1: T-junction (HaRav Toledano x Unterman)
  { b: [20, 85, -450, -235], roads: false },    // Part 2: West cluster (rides the generic roads)
  { b: [270, 360, -360, -270], roads: false },  // Part 3: East cluster (rides the generic roads)
  { b: [-90, 0, -360, -270], roads: false },    // Part 4: SW cluster (rides the generic roads)
  { b: [270, 360, -180, -90], roads: false },   // Part 5: East-north cluster (rides the generic roads)
  { b: [270, 360, 90, 180], roads: false },     // Part 6: East-far-north cluster (rides the generic roads)
  { b: [270, 360, 0, 90], roads: false },       // Part 7: East-mid cluster (rides the generic roads)
  { b: [-180, -90, -360, -270], roads: false }, // Part 8: SW-mid cluster (rides the generic roads)
  { b: [90, 180, 180, 270], roads: false },     // Part 9: North-central cluster (rides the generic roads)
  { b: [180, 270, 270, 360], roads: false },    // Part 10: NE cluster (rides the generic roads)
  { b: [-180, -90, -450, -360], roads: false }, // Part 11: SW-far cluster (rides the generic roads)
  { b: [360, 450, -180, -90], roads: false },   // Part 12: far-east cluster (rides the generic roads)
  { b: [180, 270, -180, -90], roads: false },   // Part 13: east-central cluster (rides the generic roads)
  { b: [180, 270, 180, 270], roads: false },    // Part 14: NE-central cluster (rides the generic roads)
  { b: [270, 360, 360, 450], roads: false },    // Part 15: NE-far cluster (rides the generic roads)
  { b: [180, 270, 360, 450], roads: false },    // Part 16: N-far cluster (rides the generic roads)
  { b: [270, 360, 270, 360], roads: false },    // Part 17: NE-mid cluster (rides the generic roads)
  { b: [360, 450, 90, 180], roads: false },     // Part 18: far-NE cluster (rides the generic roads)
  { b: [-90, 0, -450, -360], roads: false },    // Part 19: S-far cluster (rides the generic roads)
  { b: [180, 270, -270, -180], roads: false },  // Part 20: SE-central cluster (rides the generic roads)
  { b: [90, 180, 270, 360], roads: false },     // Part 21: N-central cluster (rides the generic roads)
  { b: [180, 270, 90, 180], roads: false },     // Part 22: E-central cluster (rides the generic roads)
  { b: [270, 360, 180, 270], roads: false },    // Part 23: NE-central2 cluster (rides the generic roads)
  { b: [450, 540, -90, 0], roads: false },      // Part 24: E-edge cluster (rides the generic roads)
  { b: [0, 90, -360, -270], roads: false },     // Part 25: S-central cluster (rides the generic roads)
  { b: [360, 450, -360, -270], roads: false },  // Part 26: SE-far cluster (rides the generic roads)
  { b: [360, 450, -270, -180], roads: false },  // Part 27: E-far cluster (rides the generic roads)
  { b: [270, 360, -90, 0], roads: false },      // Part 28: E-mid cluster (rides the generic roads)
  { b: [180, 270, -90, 0], roads: false },      // Part 29: central-E cluster (rides the generic roads)
  { b: [-180, -90, 450, 540], roads: false },   // Part 30: NW-far cluster (rides the generic roads)
  { b: [-450, -360, -270, -180], roads: false },// Part 31: far-west cluster (rides the generic roads)
  { b: [-360, -270, -270, -180], roads: false },// Part 32: W-mid cluster (rides the generic roads)
];
const inCurated = (x, z) => CURATED.some(p => x >= p.b[0] && x <= p.b[1] && z >= p.b[2] && z <= p.b[3]);

const BLD = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const ROADS = JSON.parse(fs.readFileSync(path.join(W.paths.dir, 'roads.json'), 'utf8')).roads;
const PROG_DIR = path.join(W.paths.specWork, 'programs');
const SCENE = JSON.parse(fs.readFileSync(path.join(W.paths.specWork, 'scene-tjunction.json'), 'utf8'));
const AERIAL_TAG = arg('trees', 'fullworld');
const TREES = JSON.parse(fs.readFileSync(path.join(W.paths.dir, 'aerial', AERIAL_TAG + '-trees.json'), 'utf8')).trees;

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

const CREAMS = ['#e7ddc8', '#eae0cb', '#e3d8c0', '#efe7d4', '#e0d5bd', '#ece3ce', '#e6dcc6'];
const jobs = [];
const regionBld = BLD.filter(b => b.foot && b.foot.length >= 3 && inRegion(b.cx, b.cz));
let nProg = 0, nAuto = 0;
for (const b of regionBld) {
  const ID = String(b.id);
  const progPath = path.join(PROG_DIR, `bld_${ID}.json`);
  if (fs.existsSync(progPath)) {
    // rich v3 program building (same math as test3/test4)
    const program = JSON.parse(fs.readFileSync(progPath, 'utf8'));
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
    let nx = o.cx - r.qx, nz = o.cz - r.qz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    let lo2 = Infinity, hi = -Infinity, wallD = Infinity;
    for (const [fx, fz] of b.foot) {
      const u = (fx - r.qx) * r.ux + (fz - r.qz) * r.uz; lo2 = Math.min(lo2, u); hi = Math.max(hi, u);
      wallD = Math.min(wallD, (fx - r.qx) * nx + (fz - r.qz) * nz);
    }
    const edge = { avenue: 6.9, street: 4.9, service: 2.4, plaza: 5.5 }[r.type] || 4.9;
    const off = Math.max(edge, Math.min(edge + 2.5, wallD - 1.0));
    const P = u => [r.qx + r.ux * u + nx * off, r.qz + r.uz * u + nz * off];
    const frontage = { a: P(lo2 - 1.2), b: P(hi + 1.2), nx: -nx, nz: -nz };
    const roadFrame = { qx: r.qx, qz: r.qz, ux: r.ux, uz: r.uz, nx: (o.cx - r.qx) / dl, nz: (o.cz - r.qz) / dl };
    jobs.push({ id: ID, program, obb: { cx: o.cx, cz: o.cz }, rotY,
      W: front.lateral, D: front.depth, frontage, roadFrame, off, seed: parseInt(ID.slice(-6)) || 7,
      curated: inCurated(o.cx, o.cz) });
    nProg++;
  } else {
    // auto-extrude fallback: real OSM footprint + default cream wall + roof + windows/parapet.
    // floors from OSM levels/height, else guessed from area. Built in world coords (no frontage).
    const seed = parseInt(ID.slice(-6)) || 7;
    const floors = Math.max(1, Math.min(9, b.levels || (b.height ? Math.round(b.height / 3) : (b.area > 240 ? 3 : 2))));
    jobs.push({ id: ID, auto: true, foot: b.foot, floors, seed,
      wall: CREAMS[seed % CREAMS.length],
      roof: b.roof === 'gabled' || b.roof === 'hipped' ? b.roof : 'flat',
      roofColor: b.roof === 'gabled' || b.roof === 'hipped' ? '#b0543c' : '#d8d2c4' });
    nAuto++;
  }
}
console.log(`[${W.name}] v4 region x[${REGION[0]},${REGION[1]}] z[${REGION[2]},${REGION[3]}]: ${nProg} program + ${nAuto} auto-extruded buildings`);
console.log(`[${W.name}] v4: ${jobs.length} buildings total; drive ?world=mishkenot&v4&spawnat=122,-346`);

// clip a road polyline to a max arc length (from its first point)
function clipPts(pts, maxLen) {
  if (!maxLen) return pts;
  const out = [pts[0]]; let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (acc + L >= maxLen) {
      const t = (maxLen - acc) / L;
      out.push([pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]);
      return out;
    }
    acc += L; out.push(pts[i + 1]);
  }
  return out;
}
// Full-world roads: every drivable road with a point in the region, clipped to the region so
// polylines don't shoot off across the map. Curated paver streets keep their terracotta look
// (from scene-tjunction); everything else is styled asphalt + kerbs (reads designed like the
// test3 asphalt arms). A road with a scene-tjunction entry inherits its richer styling.
const HALFW = { avenue: 3.7, street: 3.2, service: 2.3, plaza: 3.2 };
function clipToRegion(pts) {   // keep contiguous run(s) of in-region points, with 1 pt of margin
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i], here = inRegion(x, z);
    const prevIn = i > 0 && inRegion(pts[i - 1][0], pts[i - 1][1]);
    const nextIn = i < pts.length - 1 && inRegion(pts[i + 1][0], pts[i + 1][1]);
    if (here || prevIn || nextIn) out.push(pts[i]);
  }
  return out;
}
const sceneRoads = ROADS.filter(rd => rd.pts && rd.pts.length >= 2 && rd.type !== 'path'
    && rd.pts.some(([x, z]) => inRegion(x, z)))
  .map(rd => {
    const sc = SCENE.roads.find(x => String(x.id) === String(rd.id));
    if (sc) return { ...sc, pts: clipPts(rd.pts, sc.clipLen) };   // curated (paver etc.)
    return { id: rd.id, surface: 'asphalt', color: '#8f9296', halfW: HALFW[rd.type] || 3.0,
      kerb: '#b9bdc2', paint: [], generic: true, pts: clipToRegion(rd.pts) };
  })
  .filter(rd => rd.pts.length >= 2);
console.log(`[${W.name}] v4: ${sceneRoads.length} roads in region`);

// Keep aerial trees in-region and out of the roadway/kerb (island grass + parked-car strips
// read as canopy from above). Done in node where nearestRoad + half-widths are available.
let AERIAL_TREES = TREES.filter(t => {
  if (!inRegion(t.x, t.z)) return false;
  if (inCurated(t.x, t.z)) return false;   // curated zones use their exact hand-placed trees
  const r = nearestRoad(t.x, t.z);
  const scR = sceneRoads.find(x => x.id === r.id);
  return r.d >= ((scR ? scR.halfW : 3.2) + 0.6);
});
// perf cap for the full hood: keep the biggest canopies (largest area first) up to --treecap
const TREECAP = +arg('treecap', '1600');
if (AERIAL_TREES.length > TREECAP) AERIAL_TREES = AERIAL_TREES.slice().sort((a, b) => b.area - a.area).slice(0, TREECAP);
console.log(`[${W.name}] v4: aerial trees ${AERIAL_TREES.length} kept (in region, off-road, cap ${TREECAP})`);

const PAGE = String.raw`<!doctype html><html><head><meta charset=utf8></head><body>
<script src="/three.min.js"></script>
<script src="/GLTFLoader.js"></script>
<script src="/GLTFExporter.js"></script>
<script src="/house-factory.js"></script>
<script>
window.RESULT=null;window.ERR=null;
var JOBS=` + JSON.stringify(jobs) + `;
var SCENE=` + JSON.stringify({ ...SCENE, roads: sceneRoads,
  ground: { lawn: SCENE.ground.lawn, x0: REGION[0] - 20, x1: REGION[1] + 20, z0: REGION[2] - 20, z1: REGION[3] + 20 } }) + `;
var TREES=` + JSON.stringify(AERIAL_TREES) + `;
var CURATED=` + JSON.stringify(CURATED) + `;
function inCur(x,z){for(var i=0;i<CURATED.length;i++){var c=CURATED[i].b;if(x>=c[0]&&x<=c[1]&&z>=c[2]&&z<=c[3])return true;}return false;}
function inCurRoad(x,z,m){for(var i=0;i<CURATED.length;i++){if(!CURATED[i].roads)continue;var c=CURATED[i].b;if(x>=c[0]-m&&x<=c[1]+m&&z>=c[2]-m&&z<=c[3]+m)return true;}return false;}
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
        if(!hit&&spec.tint['*'])col=new THREE.Color(spec.tint['*']);
        if(!hit&&!spec.tint['*'])console.log('tint-miss '+(spec.model||spec.row)+' mat "'+(mat.name||'?')+'"');}
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
function mkLamp(px,pz,rot){ // curved-head street lamp
  var g3=new THREE.Group(),grey='#8d9296';
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.12,5.4,8),new THREE.MeshLambertMaterial({color:new THREE.Color(grey)}));
  pole.position.y=2.7;g3.add(pole);
  g3.add(mkBox(1.3,0.14,0.14,grey,0.6,5.5,0));
  g3.add(mkBox(0.55,0.22,0.3,'#e8e4d2',1.25,5.42,0));
  g3.position.set(px,0,pz);g3.rotation.y=rot;return g3;}
function mkGlobeLamp(px,pz){ // straight pole + white sphere head (paver-street style)
  var g3=new THREE.Group(),grey='#9aa0a4';
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.1,3.9,8),new THREE.MeshLambertMaterial({color:new THREE.Color(grey)}));
  pole.position.y=1.95;g3.add(pole);
  var head=new THREE.Mesh(new THREE.SphereGeometry(0.32,10,8),new THREE.MeshLambertMaterial({color:new THREE.Color('#f2f0e4')}));
  head.position.y=4.1;g3.add(head);
  g3.position.set(px,0,pz);return g3;}
function mkDoubleLamp(px,pz,rot){ // two curved arms, junction style
  var g3=new THREE.Group(),grey='#8d9296';
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.13,6.2,8),new THREE.MeshLambertMaterial({color:new THREE.Color(grey)}));
  pole.position.y=3.1;g3.add(pole);
  for(var s=-1;s<=1;s+=2){
    g3.add(mkBox(1.25,0.13,0.13,grey,s*0.58,6.28,0));
    g3.add(mkBox(0.5,0.2,0.28,'#e8e4d2',s*1.18,6.2,0));}
  g3.position.set(px,0,pz);g3.rotation.y=rot;return g3;}
function mkTSign(px,pz,rot){ // Israeli dead-end: blue square, white T (bar on top)
  var g4=new THREE.Group();
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.06,2.5,8),new THREE.MeshLambertMaterial({color:new THREE.Color('#9aa0a4')}));
  pole.position.y=1.25;g4.add(pole);
  g4.add(mkBox(0.62,0.62,0.05,'#1e62c8',0,2.55,0));
  g4.add(mkBox(0.4,0.11,0.06,'#f4f4f0',0,2.72,0));       // T bar (top)
  g4.add(mkBox(0.11,0.34,0.06,'#f4f4f0',0,2.48,0));      // T stem
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
function roadWalk(pts){ // per-segment frames + cumulative arc length
  var segs=[],acc=0;
  for(var i=0;i<pts.length-1;i++){
    var dx=pts[i+1][0]-pts[i][0],dz=pts[i+1][1]-pts[i][1],L=Math.hypot(dx,dz);
    segs.push({ax:pts[i][0],az:pts[i][1],ux:dx/L,uz:dz/L,L:L,s0:acc});acc+=L;}
  segs.total=acc;return segs;}
function atArc(segs,s){ // point+frame at arc length s (clamped)
  s=Math.max(0,Math.min(segs.total-1e-6,s));
  for(var i=0;i<segs.length;i++){var g=segs[i];
    if(s<=g.s0+g.L||i===segs.length-1){var t=s-g.s0;
      return {x:g.ax+g.ux*t,z:g.az+g.uz*t,ux:g.ux,uz:g.uz,nx:-g.uz,nz:g.ux};}}}
// helper: attach per-side normal offsets to segment frames
function prepSegs(rd){var segs=roadWalk(rd.pts);
  for(var i=0;i<segs.length;i++){(function(g){
    g.nxn=function(sd){return -g.uz*sd*(rd.halfW+0.16);} ;
    g.nzn=function(sd){return  g.ux*sd*(rd.halfW+0.16);} ;})(segs[i]);}
  return segs;}
async function bakeIslands(){
  for(var ii=0;ii<(SCENE.islands||[]).length;ii++){var isl=SCENE.islands[ii];
    var rot=(isl.rotDeg||0)*Math.PI/180, ca=Math.cos(rot),sa=Math.sin(rot);
    // kerb ring: boxes along the ellipse, tangent-aligned  (local frame: X=b axis, Z=a axis)
    var per=2*Math.PI*Math.sqrt((isl.a*isl.a+isl.b*isl.b)/2), n=Math.max(14,Math.round(per/0.55));
    for(var k=0;k<n;k++){var th=k/n*2*Math.PI;
      var lx=isl.b*Math.cos(th), lz=isl.a*Math.sin(th);          // local
      var tx=-isl.b*Math.sin(th), tz=isl.a*Math.cos(th);          // tangent
      var wx=isl.cx+lx*ca+lz*sa, wz=isl.cz-lx*sa+lz*ca;
      var wtx=tx*ca+tz*sa, wtz=-tx*sa+tz*ca;
      collectAll(mkBox(0.26,0.3,0.62,isl.kerb||'#c4bfb4',wx,0.12,wz,Math.atan2(wtx,wtz)));}
    // grass fill: squashed cylinder
    var fill=new THREE.Mesh(new THREE.CylinderGeometry(1,1,0.24,24),new THREE.MeshLambertMaterial({color:new THREE.Color(isl.grass||'#6fae46')}));
    fill.scale.set(isl.b-0.18,1,isl.a-0.18);fill.position.set(isl.cx,0.12,isl.cz);fill.rotation.y=rot;
    collectAll(fill);
    // planted fill: pack props at local offsets (dx across, dz along)
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

// ---- per-building pass: house + frontage + environment props (no ground/road here) ----
async function bakeBuilding(JOB){
  if(JOB.auto){   // program-less building: extrude the real footprint with default cream + roof
    var bg=makeFootprintBuilding(JOB.foot,{floors:JOB.floors,wall:JOB.wall,roofColor:JOB.roofColor,stoneBase:true,shutters:true});
    collectAll(bg);return 0;}
  var env=JOB.program.environment||{};
  var fr=JOB.frontage,rf=JOB.roadFrame;
  var ax=fr.a[0],az=fr.a[1],bx=fr.b[0],bz=fr.b[1];
  var L=Math.hypot(bx-ax,bz-az),fux=(bx-ax)/L,fuz=(bz-az)/L;
  var inx=-fr.nx,inz=-fr.nz;
  function F(t,inset){return [ax+fux*L*t+inx*inset, az+fuz*L*t+inz*inset];}
  var hw=(env.road&&env.road.halfW)||3.4;
  // driveway apron from road edge to the vehicle gate
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
    if(!JOB.curated&&sp.model&&sp.model.indexOf('tree_')===0)continue;   // outside curated zones trees come from aerial; inside, keep the exact hand-placed trees
    if(sp.car||sp.lamp||sp.bin||sp.planter){
      var pk=F(sp.t,sp.inset!=null?sp.inset:1);
      // 'along': car/prop local X axis onto the road direction u — rotation.y=θ maps
      // local (1,0,0) to (cosθ,0,-sinθ), so θ=atan2(-uz,ux) (atan2(ux,uz) was 90° off)
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

// ---- aerial tree layer (test4): place canopy trees at detected world points. Species is a
// size heuristic for now (aerial can't read it at 0.5 m/px); the SV pass refines it later. ----
var TREE_KINDS={
  'canopy-large':{models:['tree_oak','tree_palmDetailedTall'],hMul:2.3,hMin:6,hMax:11,rxz:1.15,
    tints:[{leafs:'#3c7031',wood:'#6e5138','*':'#6e5138'},{leafs:'#3f9b42',wood:'#a08a67','*':'#a08a67'}]},
  'canopy-med':{models:['tree_oak','tree_palmTall'],hMul:2.1,hMin:4,hMax:7,rxz:1.1,
    tints:[{leafs:'#4c8a34',wood:'#6e5138','*':'#6e5138'},{leafs:'#46a648',wood:'#a08a67','*':'#a08a67'}]},
  'shrub':{models:['plant_bushLarge'],hMul:1.7,hMin:1.4,hMax:3,rxz:1.2,
    tints:[{leafs:'#4c8a34','*':'#44603a'}]}};
async function bakeAerialTrees(){
  var n=0;
  for(var i=0;i<TREES.length;i++){var t=TREES[i];   // TREES pre-filtered in node (roadway culled)
    var kind=TREE_KINDS[t.species]||TREE_KINDS['canopy-med'];
    var pick=(Math.abs(Math.round(t.x*7+t.z*13))+i)%kind.models.length;
    var model=kind.models[pick],tint=kind.tints[pick%kind.tints.length];
    var h=Math.max(kind.hMin,Math.min(kind.hMax,t.r*kind.hMul));
    var src=await loadProp(model);
    collectAll(instProp(src,{h:h,tint:tint,rxz:kind.rxz},t.x,t.z,(i*2.399)%(Math.PI*2)));n++;}
  return n;}

// ---- procedural street furniture over the WHOLE hood: globe lamps along every road,
// parked cars against the kerbs, T-signs at dead-ends. Reuses the T-junction factory so the
// whole world reads as rich as the junction. Real building/tree positions come from SV/aerial;
// this furniture is rule-placed (deterministic hash, no Math.random). ----
var CARCOLORS=['#eceae4','#3d5a82','#a5342c','#d8d8d8','#454649','#6b7f6b','#c9b08a','#8a2f2a','#b8b4ac'];
function hsh(n){n=(n*2654435761)>>>0;return n/4294967296;}
function bakeStreetFurniture(){
  // dead-end endpoints = used by exactly one road
  var ep={};
  for(var i=0;i<SCENE.roads.length;i++){var p=SCENE.roads[i].pts;
    [p[0],p[p.length-1]].forEach(function(q){var k=Math.round(q[0])+'_'+Math.round(q[1]);ep[k]=(ep[k]||0)+1;});}
  var n=0;
  for(var r=0;r<SCENE.roads.length;r++){var rd=SCENE.roads[r];if(rd.pts.length<2)continue;
    var segs=roadWalk(rd.pts),hw=rd.halfW||3.2;if(segs.total<10)continue;
    // globe lamps ~38m apart, alternating side, on the verge just past the kerb
    for(var s=16,li=0;s<segs.total-5;s+=38,li++){var f=atArc(segs,s),sd=(li%2)?1:-1;
      var lx=f.x+f.nx*(hw+0.7)*sd,lz=f.z+f.nz*(hw+0.7)*sd;if(inCur(lx,lz))continue;   // curated zones have their own scene lamps
      collectAll(mkGlobeLamp(lx,lz));n++;}
    // parked cars ~15m apart, alternating side, ~55% density, hugging the kerb
    for(var s2=9,ci=0;s2<segs.total-5;s2+=15,ci++){if(hsh(r*131+ci*7)>0.55)continue;
      var f2=atArc(segs,s2),sd2=(ci%2)?1:-1;
      var cx=f2.x+f2.nx*(hw+1.25)*sd2,cz=f2.z+f2.nz*(hw+1.25)*sd2;if(inCur(cx,cz))continue;   // curated zones have hand-authored cars
      var rot=Math.atan2(-f2.uz,f2.ux)+(sd2<0?Math.PI:0);
      collectAll(mkCar({color:CARCOLORS[Math.floor(hsh(r*977+ci*13)*CARCOLORS.length)]},cx,cz,rot));n++;}
    // T-sign at each dead-end endpoint, facing back down the road
    var ends=[[rd.pts[0],rd.pts[1]],[rd.pts[rd.pts.length-1],rd.pts[rd.pts.length-2]]];
    for(var e=0;e<2;e++){var a=ends[e][0],b=ends[e][1],k=Math.round(a[0])+'_'+Math.round(a[1]);
      if(ep[k]===1&&!inCur(a[0],a[1])){var dx=a[0]-b[0],dz=a[1]-b[1],L=Math.hypot(dx,dz)||1;
        collectAll(mkTSign(a[0]-dx/L*2.5+(-dz/L)*(hw+0.6),a[1]-dz/L*2.5+(dx/L)*(hw+0.6),Math.atan2(-dx,-dz)));n++;}}}
  return n;}

async function main(){
  bakeGround();
  for(var r=0;r<SCENE.roads.length;r++){
    var rd=SCENE.roads[r];
    bakeRoadPrepped(rd,prepSegs(rd));
  }
  await bakeIslands();
  bakeFurniture();
  var furn=bakeStreetFurniture();
  console.log('  street furniture placed: '+furn+' (lamps/cars/signs hood-wide)');
  var placed=0;
  for(var bi=0;bi<JOBS.length;bi++)placed+=await bakeBuilding(JOBS[bi]);
  var aerialTrees=await bakeAerialTrees();
  console.log('  aerial trees placed: '+aerialTrees+' / '+TREES.length);
  // drop any triangle carrying a non-finite vertex. A single stray degenerate prop
  // (e.g. a model scaled against a zero-extent axis) yields NaN positions that both
  // break Draco encoding for the WHOLE file and render as garbage — filter them here.
  var dropped=0;
  {var fP=[],fN=[],fC=[],ntri=KP.length/9;
   for(var t=0;t<ntri;t++){var o=t*9,ok=true;
     for(var q=0;q<9;q++){if(!isFinite(KP[o+q])){ok=false;break;}}
     if(!ok){dropped++;continue;}
     for(var q=0;q<9;q++){fP.push(KP[o+q]);fN.push(KN[o+q]);fC.push(KC[o+q]);}}
   if(dropped){KP=fP;KN=fN;KC=fC;console.log('  DROPPED '+dropped+' non-finite triangles (degenerate prop geometry)');}}
  // weld coincident vertices -> indexed geometry (big GLB shrink for box-heavy scenes).
  // key on quantized pos+normal+colour so flat-shaded faces keep their hard edges.
  // CHUNKED: split the triangle soup into sub-meshes and weld each independently, so no
  // single primitive exceeds Draco's per-primitive WASM encoding ceiling (~3M verts —
  // one merged world-mesh started failing there once the hood filled in). Multiple
  // primitives are fine: the game loader traverses every mesh (index.html ~1761).
  var nv=KP.length/3, TRIS=nv/3, CHUNK_TRIS=350000;  // ~1.05M loose verts/chunk -> safe post-weld
  var group=new THREE.Group(), totalWelded=0, nChunks=0;
  for(var cStart=0;cStart<TRIS;cStart+=CHUNK_TRIS){
    var cEnd=Math.min(cStart+CHUNK_TRIS,TRIS);
    var vmap=new Map(),P=[],N=[],C=[],IDX=[];
    for(var t=cStart;t<cEnd;t++)for(var cc=0;cc<3;cc++){var b0=(t*3+cc)*3;
      var k=(Math.round(KP[b0]*400))+'_'+(Math.round(KP[b0+1]*400))+'_'+(Math.round(KP[b0+2]*400))
        +'|'+(Math.round(KN[b0]*50))+'_'+(Math.round(KN[b0+1]*50))+'_'+(Math.round(KN[b0+2]*50))
        +'|'+(Math.round(KC[b0]*63))+'_'+(Math.round(KC[b0+1]*63))+'_'+(Math.round(KC[b0+2]*63));
      var e=vmap.get(k);
      if(e===undefined){e=P.length/3;vmap.set(k,e);P.push(KP[b0],KP[b0+1],KP[b0+2]);N.push(KN[b0],KN[b0+1],KN[b0+2]);C.push(KC[b0],KC[b0+1],KC[b0+2]);}
      IDX.push(e);}
    var geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(C,3));
    geo.setIndex(IDX);
    group.add(new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide})));
    totalWelded+=P.length/3; nChunks++;}
  console.log('  weld+chunk: '+nv+' loose -> '+totalWelded+' verts in '+nChunks+' primitives');
  var glb=await new Promise(function(res,rej){new THREE.GLTFExporter().parse(group,res,{binary:true},rej);});
  var bytes=new Uint8Array(glb),bin='';for(var i3=0;i3<bytes.length;i3++)bin+=String.fromCharCode(bytes[i3]);
  window.RESULT={b64:btoa(bin),tris:KP.length/9,verts:totalWelded,props:placed,buildings:JOBS.length};
}
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
    if(rd.generic&&inCurRoad(cx,cz,7))continue;   // generic roads suppressed only inside parts that own their roads (+margin)
    var rot=Math.atan2(g.ux,g.uz);
    if(rd.surface==='pavers'){
      // designed ground: dark grout base, then a ~1m tile grid (0.94m tiles → 0.06m seams)
      // with per-tile lightness jitter; grey centre-band tiles vs terracotta field tiles.
      collectAll(mkBox(rd.halfW*2,topH,len,rd.grout||'#7a4a34',cx,y-0.004,cz,rot));
      var band=(rd.band?(rd.bandW||2.2):0)/2, step=1.0, tw=0.94, half=rd.halfW;
      for(var u=-len/2+step/2;u<len/2-1e-3;u+=step){
        for(var a=-half+step/2;a<half-1e-3;a+=step){
          var isBand=band>0&&Math.abs(a)<band+0.01;
          var h1=Math.sin((u*12.9898+a*78.233))*43758.5453; var jit=h1-Math.floor(h1); // det 0..1
          var col=new THREE.Color(isBand?rd.band:rd.color).offsetHSL(0,(jit-0.5)*0.02,(jit-0.5)*0.08);
          var tx=cx+g.ux*u-g.uz*a, tz=cz+g.uz*u+g.ux*a;
          collectAll(mkBox(tw,topH+0.006,tw,col,tx,y+0.004,tz,rot));}}
    } else {
      collectAll(mkBox(rd.halfW*2,topH,len,rd.color,cx,y,cz,rot));
      // subtle asphalt lane seam down the centre
      collectAll(mkBox(0.12,topH+0.004,len,new THREE.Color(rd.color).offsetHSL(0,0,-0.06),cx,y+0.004,cz,rot));
    }
    for(var sd=-1;sd<=1;sd+=2){
      var kcol=rd.kerb||'#b9bdc2';
      collectAll(mkBox(0.34,0.18,len,new THREE.Color(kcol).offsetHSL(0,0,-0.05),cx+g.nxn(sd),y+0.06,cz+g.nzn(sd),rot)); // kerb body (shaded face)
      collectAll(mkBox(0.24,0.05,len,new THREE.Color(kcol).offsetHSL(0,0,0.08),cx+g.nxn(sd),y+0.155,cz+g.nzn(sd),rot));}} // bevel cap highlight
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
await page.waitForFunction('window.RESULT||window.ERR', { timeout: 240000 });
const err = await page.evaluate('window.ERR');
if (err) { console.error('ERROR:\n' + err); try { await browser.close(); } catch {} server.close(); process.exit(1); }
const R = await page.evaluate('window.RESULT'); const b64 = R.b64; delete R.b64;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(JSON.stringify(R));
const rawMB = (fs.statSync(OUT).size / 1048576).toFixed(1);
try { await browser.close(); } catch {} server.close();
// Draco-compress in place (~25x for this box-heavy world). Game decodes via DRACOLoader.
// Skip with --nodraco. Needs gltf-pipeline (npm i gltf-pipeline).
if (!argv.includes('--nodraco')) {
  try {
    const gp = await import('gltf-pipeline');
    const processGlb = gp.processGlb || (gp.default && gp.default.processGlb);   // CJS interop
    // 18-bit position precision (~0.5cm over the 1.2km world) — the DEFAULT 11 bits (~0.5m)
    // collapses the mm-scale paver tiles / kerb caps / sign panels into z-fighting slabs.
    const out = await processGlb(fs.readFileSync(OUT),
      { dracoOptions: { compressionLevel: 7, quantizePositionBits: 18, quantizeNormalBits: 8, quantizeColorBits: 8 } });
    fs.writeFileSync(OUT, out.glb);
    console.log(`wrote ${path.relative(ROOT, OUT)} (${rawMB}MB raw -> ${(out.glb.length / 1048576).toFixed(1)}MB draco)`);
  } catch (e) { console.warn('draco skipped (gltf-pipeline missing?): ' + e.message + '\n  raw GLB kept at ' + rawMB + 'MB'); }
} else console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + rawMB + 'MB, --nodraco)');
process.exit(0);
