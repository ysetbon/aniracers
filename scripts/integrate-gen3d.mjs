// Integrate step for the exact-restyle pipeline (plan step 4): cut the old parametric
// building masses out of the baked world GLB and append the textured image-to-3D meshes
// from blender-normalize.mjs (gen3d/placed.glb, already world-positioned/fitted).
//
// Same triangle-cut as rebake-buildings.mjs (centroid within 1.5m of the footprint, y>0.25)
// — the spec-v2 frontage fences sit on the lot line, outside that ring, so they survive.
// Unlike rebake, the replacements are textured meshes and CANNOT be merged into the
// vertex-coloured world mesh: the output GLB = one vertex-coloured mesh + one textured
// mesh per building. index.html's world loader must keep texture maps (see the
// map-preserving material override in buildMishkenotWorld).
//
// Run: node scripts/integrate-gen3d.mjs --world=<name> --ids=<id,id,...>
//        [--out=assets/<w>/world_gen3d.glb]
// Expects gen3d/placed_bld_<id>.glb per id (from blender-normalize.mjs).
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const IDS = (arg('ids', '') || '').split(',').filter(Boolean);
if (!IDS.length) { console.error('need --ids=<buildingId,...>'); process.exit(1); }
const OUT = arg('out', W.paths.assetGlb.replace(/\.glb$/, '_gen3d.glb'));

const BLD = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const jobs = [];
for (const id of IDS) {
  const b = BLD.find(x => String(x.id) === id);
  const placed = path.join(W.paths.dir, 'gen3d', `placed_bld_${id}.glb`);
  if (!b) { console.log('skip ' + id + ' (missing building)'); continue; }
  if (!fs.existsSync(placed)) { console.log('skip ' + id + ' (no placed GLB — run blender-normalize.mjs)'); continue; }
  jobs.push({ id, foot: b.foot, placed });
}
if (!jobs.length) { console.error('nothing to integrate'); process.exit(1); }
console.log(`[${W.name}] integrating ${jobs.length} gen3d buildings into ${path.relative(ROOT, OUT)}`);

const PAGE = String.raw`<!doctype html><html><head><meta charset=utf8></head><body>
<script src="/three.min.js"></script>
<script src="/GLTFLoader.js"></script>
<script src="/GLTFExporter.js"></script>
<script>
window.RESULT=null;window.ERR=null;
var JOBS=` + JSON.stringify(jobs) + `;
var KP=[],KN=[],KC=[];
function inFoot(x,z,foot){var c=false;for(var i=0,j=foot.length-1;i<foot.length;j=i++){var xi=foot[i][0],zi=foot[i][1],xj=foot[j][0],zj=foot[j][1];
  if(((zi>z)!=(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))c=!c;}return c;}
function nearFoot(x,z,foot,r){if(inFoot(x,z,foot))return true;
  for(var i=0;i<foot.length;i++){var a=foot[i],b=foot[(i+1)%foot.length];var dx=b[0]-a[0],dz=b[1]-a[1],L2=dx*dx+dz*dz;
    var t=L2?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/L2)):0;
    if(Math.hypot(x-(a[0]+t*dx),z-(a[1]+t*dz))<r)return true;}return false;}
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
      if(cy>0.25){for(var j=0;j<JOBS.length;j++){if(nearFoot(cx,cz,JOBS[j].foot,1.5)){drop=true;break;}}}
      if(drop){removed++;continue;}
      for(var k=0;k<9;k++)KP.push(pos[t+k]);
      for(var k2=0;k2<9;k2++)KN.push(nrm[t+k2]);
      for(var v=0;v<3;v++){var vi=t/3+v;var r=col?col[vi*cis]:1,gg=col?col[vi*cis+1]:1,b=col?col[vi*cis+2]:1;KC.push(r,gg,b);}}
  });
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(KP,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(KN,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(KC,3));
  var worldMesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  var group=new THREE.Group();group.add(worldMesh);
  var added=0;
  for(var ji=0;ji<JOBS.length;ji++){
    var placed=await new Promise(function(res,rej){new THREE.GLTFLoader().load('/placed/'+JOBS[ji].id+'.glb',res,undefined,rej);});
    placed.scene.updateMatrixWorld(true);
    var meshes=[];placed.scene.traverse(function(o){if(o.isMesh)meshes.push(o);});
    for(var i=0;i<meshes.length;i++){var m=meshes[i];
      var g2=m.geometry.clone();g2.applyMatrix4(m.matrixWorld);
      var nm=new THREE.Mesh(g2,m.material);nm.name=m.name||('bld_'+JOBS[ji].id);group.add(nm);added++;}}
  var glb=await new Promise(function(res,rej){new THREE.GLTFExporter().parse(group,res,{binary:true},rej);});
  var bytes=new Uint8Array(glb),bin='';for(var i2=0;i2<bytes.length;i2++)bin+=String.fromCharCode(bytes[i2]);
  window.RESULT={b64:btoa(bin),tris:KP.length/9,removed:removed,added:added};
}
main().catch(function(e){window.ERR=String(e&&e.stack||e);});
</script></body></html>`;

const V = p2 => fs.readFileSync(path.join(ROOT, 'scripts/vendor', p2));
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (req.url === '/three.min.js' || req.url === '/GLTFLoader.js' || req.url === '/GLTFExporter.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(V(req.url.slice(1))); }
  if (req.url === '/base.glb') { res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); return res.end(fs.readFileSync(W.paths.assetGlb)); }
  const pm = req.url.match(/^\/placed\/(\d+)\.glb$/);
  if (pm) { const jb = jobs.find(j => j.id === pm[1]);
    if (jb) { res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); return res.end(fs.readFileSync(jb.placed)); } }
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
