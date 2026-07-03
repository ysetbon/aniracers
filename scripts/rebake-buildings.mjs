// SURGICAL rebake: replace a subset of buildings inside an already-baked world GLB with
// fresh factory models (spec v2: fences/gates/window frames/accent), without needing the
// OSM2World base. Cuts the old buildings' triangles out of assets/<name>/world.glb
// (centroid inside expanded footprint, above ground), builds the new models + a computed
// frontage fence per building, and merges everything back into one vertex-coloured mesh.
//
// Run: node scripts/rebake-buildings.mjs --world=<name> --ids=<id,id,...> [--out=path.glb]
// Uses the vendored three.js (scripts/vendor) so it runs offline.
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const IDS = (arg('ids', '') || '').split(',').filter(Boolean);
if (!IDS.length) { console.error('need --ids=<buildingId,...>'); process.exit(1); }
const OUT = arg('out', W.paths.assetGlb);

const BLD = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const SPECS = JSON.parse(fs.readFileSync(W.paths.specs, 'utf8')).specs;
const ROADS = JSON.parse(fs.readFileSync(path.join(W.paths.dir, 'roads.json'), 'utf8')).roads;

// --- frontage fence line per building: parallel to the nearest road, in front of the house
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
const jobs = [];
for (const id of IDS) {
  const b = BLD.find(x => x.id === id);
  const s = SPECS[id];
  if (!b || !s) { console.log('skip ' + id + ' (missing building or spec)'); continue; }
  const r = nearestRoad(b.cx, b.cz);
  let fence = null;
  if (s.fence && s.fence.type && s.fence.type !== 'none' && r.d < 60) {
    let nx = b.cx - r.qx, nz = b.cz - r.qz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    // building extent along the road direction, and its wall distance from the road
    let lo = Infinity, hi = -Infinity, wallD = Infinity;
    for (const [fx, fz] of b.foot) {
      const u = (fx - r.qx) * r.ux + (fz - r.qz) * r.uz; lo = Math.min(lo, u); hi = Math.max(hi, u);
      wallD = Math.min(wallD, (fx - r.qx) * nx + (fz - r.qz) * nz);
    }
    // fence goes on the lot line: past the paved road half-width + kerb band (road-factory),
    // but never through the house itself
    const edge = { avenue: 6.9, street: 4.9, service: 2.4, plaza: 5.5 }[r.type] || 4.9;
    const off = Math.max(edge, Math.min(edge + 2.5, wallD - 1.0));
    if (wallD > edge + 0.6) {
      const p0u = lo - 1.2, p1u = hi + 1.2;
      const P = u => [r.qx + r.ux * u + nx * off, r.qz + r.uz * u + nz * off];
      fence = { pts: [P(p0u), P(p1u)], spec: { type: s.fence.type, color: s.fence.color, height: s.fence.height, gateT: s.gate ? 0.78 : null, gateColor: s.gate && s.gate.color } };
    }
  }
  jobs.push({ id, foot: b.foot, spec: s, fence });
}
console.log(`[${W.name}] rebaking ${jobs.length} buildings into ${path.relative(ROOT, OUT)}`);

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
async function main(){
  var base=await new Promise(function(res,rej){new THREE.GLTFLoader().load('/base.glb',res,undefined,rej);});
  base.scene.updateMatrixWorld(true);
  // pass base through, dropping old-building tris: centroid near a pilot footprint AND above ground
  var removed=0;
  base.scene.traverse(function(o){if(!o.isMesh)return;
    var g=o.geometry;g=g.index?g.toNonIndexed():g.clone();g.applyMatrix4(o.matrixWorld);
    if(!g.attributes.normal)g.computeVertexNormals();
    var pos=g.attributes.position.array,nrm=g.attributes.normal.array,col=g.attributes.color?g.attributes.color.array:null,cis=col?g.attributes.color.itemSize:0;
    for(var t=0;t<pos.length;t+=9){
      var cx=(pos[t]+pos[t+3]+pos[t+6])/3,cy=(pos[t+1]+pos[t+4]+pos[t+7])/3,cz=(pos[t+2]+pos[t+5]+pos[t+8])/3;
      var drop=false;
      if(cy>0.25){for(var j=0;j<JOBS.length;j++){if(nearFoot(cx,cz,JOBS[j].foot,1.5)){drop=true;break;}}}
      if(drop){removed++;continue;}
      for(var k=0;k<9;k++)KP.push(pos[t+k]);
      for(var k2=0;k2<9;k2++)KN.push(nrm[t+k2]);
      for(var v=0;v<3;v++){var vi=t/3+v;var r=col?col[vi*cis]:1,gg=col?col[vi*cis+1]:1,b=col?col[vi*cis+2]:1;KC.push(r,gg,b);}}
  });
  var kept=KP.length/9;
  // build the replacements (factory v2) + fences
  var placed=0;
  for(var bi=0;bi<JOBS.length;bi++){var jb=JOBS[bi];var o=obb(jb.foot);
    var Wd=Math.max(6,Math.min(130,o.W)),Dd=Math.max(6,Math.min(100,o.D));
    var s=jb.spec;var p={W:Wd,D:Dd,floors:Math.max(1,s.floors||2),wall:s.wall||'#eaeaea',roof:s.roof||'flat',
      roofColor:s.roofColor||'#cccccc',glass:s.glass||'#6b8194',cols:s.cols,balconies:!!s.balconies,doors:s.doors||1,
      shutters:!!s.shutters,stoneBase:!!s.stoneBase,solar:!!s.solar,windowStyle:s.windowStyle,accent:s.accent||null};
    var fr=polyArea(jb.foot)/(o.W*o.D),model;
    if(fr<0.88){model=makeFootprintBuilding(jb.foot,p);}
    else{model=makeBuilding(p);model.rotation.y=-o.theta;model.position.set(o.cx,0,o.cz);}
    model.updateMatrixWorld(true);model.traverse(function(m){if(m.isMesh)collect(m);});placed++;
    if(jb.fence){var f=makeFence(jb.fence.pts,jb.fence.spec);f.updateMatrixWorld(true);f.traverse(function(m){if(m.isMesh)collect(m);});}}
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
