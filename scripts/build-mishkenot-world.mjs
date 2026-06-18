// Build the Mishkenot Zvulun world from OSM2World output, clipped to the EXACT
// polygon the user drew in the area picker (maps/mishkenot_zvulun/area.json).
//
// The source GLB was converted with an injected <bounds> equal to the polygon
// bbox (+/-0.0005deg margin), so OSM2World's MetricMapProjection origin is the
// bbox CENTRE. That lets us project the lat/lon polygon straight into GLB XZ:
//   scale = 40075016.686 * cos(originLat)
//   X = (lon-originLon)/360 * scale
//   Z = -(latToY(lat)-latToY(originLat)) * scale     (GltfOutput negates z)
// Then clip triangles whose centroid is inside the polygon, recentre, bake
// colours into one per-vertex-coloured mesh, export assets/mishkenot/world.glb.
// Run: node scripts/build-mishkenot-world.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'OSM2World/_aniracers_test/mishkenot_osm.glb';
const AREA = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps/mishkenot_zvulun/area.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'assets', 'mishkenot');
fs.mkdirSync(OUT_DIR, { recursive: true });

// origin = bbox centre (== area.json.center) — matches the injected <bounds>
const originLat = (AREA.bbox.minlat + AREA.bbox.maxlat) / 2;
const originLon = (AREA.bbox.minlon + AREA.bbox.maxlon) / 2;
const EARTH_C = 40075016.686;
const scale = EARTH_C * Math.cos(originLat * Math.PI / 180);
const latToY = d => { const s = Math.sin(d * Math.PI / 180); return Math.log((1 + s) / (1 - s)) / (4 * Math.PI) + 0.5; };
const toXZ = (lat, lon) => [ (lon - originLon) / 360 * scale, -(latToY(lat) - latToY(originLat)) * scale ];
// project polygon [[lat,lon],...] -> [[X,Z],...]
const POLY = AREA.polygon.map(([la, lo]) => toXZ(la, lo));
const pxs = POLY.map(p => p[0]), pzs = POLY.map(p => p[1]);
const pcx = (Math.min(...pxs) + Math.max(...pxs)) / 2, pcz = (Math.min(...pzs) + Math.max(...pzs)) / 2;

const PAGE = `<!doctype html><html><head><meta charset=utf8></head><body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js"></script>
<script>
window.RESULT=null; window.ERR=null;
const POLY=${JSON.stringify(POLY)};        // polygon in GLB XZ
const PCX=${pcx}, PCZ=${pcz};              // polygon bbox centre (recentre point)
function pctile(arr,p){ const a=Float64Array.from(arr).sort(); return a[Math.max(0,Math.min(a.length-1,Math.floor(a.length*p)))]; }
function inPoly(x,z){ let c=false; for(let i=0,j=POLY.length-1;i<POLY.length;j=i++){
  const xi=POLY[i][0],zi=POLY[i][1],xj=POLY[j][0],zj=POLY[j][1];
  if(((zi>z)!=(zj>z)) && (x < (xj-xi)*(z-zi)/(zj-zi)+xi)) c=!c; } return c; }
async function main(){
  const loader=new THREE.GLTFLoader();
  const gltf=await new Promise((res,rej)=>loader.load('/src.glb',res,undefined,rej));
  const P=[],Nr=[],C=[]; gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o=>{
    if(!o.isMesh) return;
    let g=o.geometry; g=g.index?g.toNonIndexed():g.clone(); g.applyMatrix4(o.matrixWorld);
    if(!g.attributes.normal) g.computeVertexNormals();
    const pos=g.attributes.position.array, nrm=g.attributes.normal.array;
    const col=g.attributes.color?g.attributes.color.array:null, cis=col?g.attributes.color.itemSize:0;
    const m=(Array.isArray(o.material)?o.material:[o.material])[0], mc=m.color||{r:1,g:1,b:1};
    for(let i=0;i<pos.length;i++){ P.push(pos[i]); Nr.push(nrm[i]); }
    for(let v=0;v<pos.length/3;v++){
      const r=col?col[v*cis]:1,gg=col?col[v*cis+1]:1,b=col?col[v*cis+2]:1;
      C.push(r*mc.r, gg*mc.g, b*mc.b);
    }
  });
  const ys=[]; for(let i=1;i<P.length;i+=3) ys.push(P[i]);
  const gy=pctile(ys,0.02), TOP=gy+140, BOT=gy-25;

  const kp=[],kn=[],kc=[];
  for(let t=0;t<P.length;t+=9){
    const cx=(P[t]+P[t+3]+P[t+6])/3, cz=(P[t+2]+P[t+5]+P[t+8])/3, cy=(P[t+1]+P[t+4]+P[t+7])/3;
    if(cy<BOT||cy>TOP) continue;
    if(!inPoly(cx,cz)) continue;
    for(let k=0;k<9;k++){ kp.push(P[t+k]); kn.push(Nr[t+k]); kc.push(C[t+k]); }
  }
  for(let i=0;i<kp.length;i+=3){ kp[i]-=PCX; kp[i+1]-=gy; kp[i+2]-=PCZ; }

  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(kp,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(kn,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(kc,3));
  const mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  const bb=new THREE.Box3().setFromObject(mesh), sz=bb.getSize(new THREE.Vector3());

  const exporter=new THREE.GLTFExporter();
  const glb=await new Promise((res,rej)=>exporter.parse(mesh,res,{binary:true},rej));
  const bytes=new Uint8Array(glb); let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
  window.RESULT={ b64:btoa(bin), tris:kp.length/9,
    size:[+sz.x.toFixed(1),+sz.y.toFixed(1),+sz.z.toFixed(1)] };
}
main().catch(e=>{ window.ERR=String(e&&e.stack||e); });
</script></body></html>`;

const server = http.createServer((req,res)=>{
  if(req.url==='/'){ res.writeHead(200,{'Content-Type':'text/html'}); return res.end(PAGE); }
  if(req.url==='/src.glb'){ res.writeHead(200,{'Content-Type':'model/gltf-binary'}); return res.end(fs.readFileSync(path.join(ROOT,SRC_REL))); }
  res.writeHead(404); res.end();
});
await new Promise(r=>server.listen(0,r));
const port=server.address().port;
const browser=await puppeteer.launch({ args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page=await browser.newPage();
page.on('console',m=>console.log('  [page]',m.text()));
await page.goto(`http://localhost:${port}/`,{waitUntil:'load'});
await page.waitForFunction('window.RESULT||window.ERR',{timeout:120000});
const err=await page.evaluate('window.ERR');
if(err){ console.error('ERROR:\n'+err); await browser.close(); server.close(); process.exit(1); }
const R=await page.evaluate('window.RESULT'); const b64=R.b64; delete R.b64;
fs.writeFileSync(path.join(OUT_DIR,'world.glb'),Buffer.from(b64,'base64'));
console.log('\n=== Mishkenot (OSM2World) world built ===');
console.log('origin(lat,lon):',originLat.toFixed(6),originLon.toFixed(6),'| polygon pts:',POLY.length);
console.log(JSON.stringify(R,null,2));
console.log(`wrote assets/mishkenot/world.glb (${(fs.statSync(path.join(OUT_DIR,'world.glb')).size/1048576).toFixed(2)} MB)`);
await browser.close(); server.close();
