// Scene-program rebake (exact-geometry-program-plan): replace buildings + their frontage
// inside the baked world GLB with factory-v3 models built from
// spec-work/programs/bld_<id>.json. Sibling of rebake-buildings.mjs (spec v2), same
// surgical approach, but v3 also cuts the OLD fence strip (the program's compound wall
// replaces it) and lays the frontage (wall/gates/sidewalk/verge).
//
// Run: node scripts/rebake-programs.mjs --world=<name> --ids=<id,...> [--out=path.glb]
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const IDS = (arg('ids', '') || '').split(',').filter(Boolean);
if (!IDS.length) { console.error('need --ids=<buildingId,...>'); process.exit(1); }
const OUT = arg('out', W.paths.assetGlb.replace(/\.glb$/, '_v3.glb'));

const BLD = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const ROADS = JSON.parse(fs.readFileSync(path.join(W.paths.dir, 'roads.json'), 'utf8')).roads;
const PROG_DIR = path.join(W.paths.specWork, 'programs');

function nearestRoad(cx, cz) {
  let best = { d: Infinity };
  for (const rd of ROADS) {
    if (!rd.pts || rd.pts.length < 2 || rd.type === 'path') continue;
    for (let i = 0; i < rd.pts.length - 1; i++) {
      const [ax, az] = rd.pts[i], [bx, bz] = rd.pts[i + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / L2)) : 0;
      const qx = ax + t * dx, qz = az + t * dz, d = Math.hypot(cx - qx, cz - qz);
      if (d < best.d) best = { d, qx, qz, ux: dx / Math.sqrt(L2 || 1), uz: dz / Math.sqrt(L2 || 1), type: rd.type };
    }
  }
  return best;
}
// min-area OBB (same as blender-normalize)
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

const jobs = [];
for (const id of IDS) {
  const b = BLD.find(x => String(x.id) === id);
  const progPath = path.join(PROG_DIR, `bld_${id}.json`);
  if (!b) { console.log('skip ' + id + ' (no building)'); continue; }
  if (!fs.existsSync(progPath)) { console.log('skip ' + id + ' (no program json)'); continue; }
  const program = JSON.parse(fs.readFileSync(progPath, 'utf8'));
  const o = minAreaOBB(b.foot);
  const r = nearestRoad(o.cx, o.cz);
  // front axis: OBB direction closest to building->road
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
  // frontage line: parallel to the road on the lot line (same rule as v2 fences),
  // clipped to the building width + 1.2m each side
  let frontage = null;
  if (program.frontage && r.d < 60) {
    let nx = o.cx - r.qx, nz = o.cz - r.qz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    let lo2 = Infinity, hi = -Infinity, wallD = Infinity;
    for (const [fx, fz] of b.foot) {
      const u = (fx - r.qx) * r.ux + (fz - r.qz) * r.uz; lo2 = Math.min(lo2, u); hi = Math.max(hi, u);
      wallD = Math.min(wallD, (fx - r.qx) * nx + (fz - r.qz) * nz);
    }
    const edge = { avenue: 6.9, street: 4.9, service: 2.4, plaza: 5.5 }[r.type] || 4.9;
    const off = Math.max(edge, Math.min(edge + 2.5, wallD - 1.0));
    if (wallD > edge + 0.6) {
      const P = u => [r.qx + r.ux * u + nx * off, r.qz + r.uz * u + nz * off];
      frontage = { a: P(lo2 - 1.2), b: P(hi + 1.2), nx: -nx, nz: -nz };   // outward = toward road
    }
  }
  jobs.push({ id, foot: b.foot, program, obb: { cx: o.cx, cz: o.cz }, rotY,
    W: front.lateral, D: front.depth, frontage, seed: parseInt(id.slice(-6)) || 7 });
}
if (!jobs.length) { console.error('nothing to rebake'); process.exit(1); }
console.log(`[${W.name}] program-rebake ${jobs.length} buildings -> ${path.relative(ROOT, OUT)}`);

const PAGE = String.raw`<!doctype html><html><head><meta charset=utf8></head><body>
<script src="/three.min.js"></script>
<script src="/GLTFLoader.js"></script>
<script src="/GLTFExporter.js"></script>
<script src="/house-factory.js"></script>
<script>
window.RESULT=null;window.ERR=null;
var JOBS=` + JSON.stringify(jobs) + `;
var KP=[],KN=[],KC=[];
function collect(mesh){var g=mesh.geometry;g=g.index?g.toNonIndexed():g.clone();g.applyMatrix4(mesh.matrixWorld);
  if(!g.attributes.normal)g.computeVertexNormals();
  var pos=g.attributes.position.array,nrm=g.attributes.normal.array,col=g.attributes.color?g.attributes.color.array:null,cis=col?g.attributes.color.itemSize:0;
  var mc=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material).color||{r:1,g:1,b:1};
  for(var i=0;i<pos.length;i+=3){KP.push(pos[i],pos[i+1],pos[i+2]);KN.push(nrm[i],nrm[i+1],nrm[i+2]);}
  for(var v=0;v<pos.length/3;v++){var r=col?col[v*cis]:1,gg=col?col[v*cis+1]:1,b=col?col[v*cis+2]:1;KC.push(r*mc.r,gg*mc.g,b*mc.b);}}
function inFoot(x,z,foot){var c=false;for(var i=0,j=foot.length-1;i<foot.length;j=i++){var xi=foot[i][0],zi=foot[i][1],xj=foot[j][0],zj=foot[j][1];
  if(((zi>z)!=(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))c=!c;}return c;}
function nearFoot(x,z,foot,r){if(inFoot(x,z,foot))return true;
  for(var i=0;i<foot.length;i++){var a=foot[i],b=foot[(i+1)%foot.length];var dx=b[0]-a[0],dz=b[1]-a[1],L2=dx*dx+dz*dz;
    var t=L2?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/L2)):0;
    if(Math.hypot(x-(a[0]+t*dx),z-(a[1]+t*dz))<r)return true;}return false;}
function nearSeg(x,z,A,B,r){var dx=B[0]-A[0],dz=B[1]-A[1],L2=dx*dx+dz*dz;
  var t=L2?Math.max(0,Math.min(1,((x-A[0])*dx+(z-A[1])*dz)/L2)):0;
  return Math.hypot(x-(A[0]+t*dx),z-(A[1]+t*dz))<r;}
async function main(){
  var base=await new Promise(function(res,rej){new THREE.GLTFLoader().load('/base.glb',res,undefined,rej);});
  base.scene.updateMatrixWorld(true);
  var removed=0;
  base.scene.traverse(function(o){if(!o.isMesh)return;
    var g=o.geometry;g=g.index?g.toNonIndexed():g.clone();g.applyMatrix4(o.matrixWorld);
    if(!g.attributes.normal)g.computeVertexNormals();
    var pos=g.attributes.position.array,nrm=g.attributes.normal.array,col=g.attributes.color?g.attributes.color.array:null,cis=col?g.attributes.color.itemSize:0;
    for(var t=0;t<pos.length;t+=9){
      var cx=(pos[t]+pos[t+3]+pos[t+6])/3,cy=(pos[t+1]+pos[t+4]+pos[t+7])/3,cz=(pos[t+2]+pos[t+5]+pos[t+8])/3;
      var drop=false;
      for(var j=0;j<JOBS.length&&!drop;j++){
        if(cy>0.25&&nearFoot(cx,cz,JOBS[j].foot,1.5))drop=true;             // old building
        else if(JOBS[j].frontage&&cy>0.02&&cy<3.5&&nearSeg(cx,cz,JOBS[j].frontage.a,JOBS[j].frontage.b,1.1))drop=true;  // old fence
      }
      if(drop){removed++;continue;}
      for(var k=0;k<9;k++)KP.push(pos[t+k]);
      for(var k2=0;k2<9;k2++)KN.push(nrm[t+k2]);
      for(var v=0;v<3;v++){var vi=t/3+v;var r=col?col[vi*cis]:1,gg=col?col[vi*cis+1]:1,b=col?col[vi*cis+2]:1;KC.push(r,gg,b);}}
  });
  var kept=KP.length/9,placed=0;
  for(var bi=0;bi<JOBS.length;bi++){var jb=JOBS[bi];
    var model=makeBuildingV3(jb.program,jb.W,jb.D);
    model.rotation.y=jb.rotY;model.position.set(jb.obb.cx,0,jb.obb.cz);
    model.updateMatrixWorld(true);model.traverse(function(m){if(m.isMesh)collect(m);});
    if(jb.frontage){var fr=makeFrontageV3(jb.program,jb.frontage,jb.seed);
      fr.updateMatrixWorld(true);fr.traverse(function(m){if(m.isMesh)collect(m);});}
    placed++;}
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(KP,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(KN,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(KC,3));
  var mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  var glb=await new Promise(function(res,rej){new THREE.GLTFExporter().parse(mesh,res,{binary:true},rej);});
  var bytes=new Uint8Array(glb),bin='';for(var i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  window.RESULT={b64:btoa(bin),tris:KP.length/9,removed:removed,kept:kept,placed:placed};
}
main().catch(function(e){window.ERR=String(e&&e.stack||e);});
</script></body></html>`;

const V = p2 => fs.readFileSync(path.join(ROOT, 'scripts/vendor', p2));
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (req.url === '/three.min.js' || req.url === '/GLTFLoader.js' || req.url === '/GLTFExporter.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(V(req.url.slice(1))); }
  if (req.url === '/house-factory.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(ROOT, 'scripts/house-factory.js'))); }
  if (req.url === '/base.glb') { res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); return res.end(fs.readFileSync(W.paths.assetGlb)); }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, r)); const port = server.address().port;
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=6144'] });
const page = await browser.newPage();
page.on('console', m => console.log('  [page]', m.text()));
await page.goto('http://localhost:' + port + '/', { waitUntil: 'load' });
await page.waitForFunction('window.RESULT||window.ERR', { timeout: 300000 });
const err = await page.evaluate('window.ERR');
if (err) { console.error('ERROR:\n' + err); try { await browser.close(); } catch {} server.close(); process.exit(1); }
const R = await page.evaluate('window.RESULT'); const b64 = R.b64; delete R.b64;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(JSON.stringify(R));
console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB)');
// puppeteer's temp-profile cleanup can throw EPERM on Windows after the GLB is written
try { await browser.close(); } catch {} server.close();
process.exit(0);
