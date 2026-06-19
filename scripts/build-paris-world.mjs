// Turn the raw OSM2World Eiffel GLB into a compact, game-ready Paris world:
//   - clip triangles to a square play-area around the dense centre (kills the
//     "comet-tail" ways that cross the bbox edge)
//   - recentre to origin, drop onto y=0
//   - bake material/vertex colours into a single per-vertex-coloured mesh
//   - re-export as assets/paris/world.glb (GLTFExporter, binary)
// Also reports where the Eiffel Tower lands (highest geometry) so the race track
// can be routed around it.
// Run: node scripts/build-paris-world.mjs [HALF_METRES]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'OSM2World/_aniracers_test/eiffel_lod2.glb';
const HALF = Number(process.argv[2] || 340);          // half-extent of square play area (m)
const OUT_DIR = path.join(ROOT, 'assets', 'paris');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PAGE = `<!doctype html><html><head><meta charset=utf8></head><body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js"></script>
<script>
window.RESULT=null; window.ERR=null;
const HALF=${HALF};
function median(arr){ const a=Float64Array.from(arr).sort(); return a[a.length>>1]; }
function pctile(arr,p){ const a=Float64Array.from(arr).sort(); return a[Math.max(0,Math.min(a.length-1,Math.floor(a.length*p)))]; }
async function main(){
  const loader=new THREE.GLTFLoader();
  const gltf=await new Promise((res,rej)=>loader.load('/src.glb',res,undefined,rej));

  // 1) gather every triangle in world space: pos(9), nrm(9), col(9 = vColor*matColor)
  const P=[],Nr=[],C=[]; const matInfo={};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o=>{
    if(!o.isMesh) return;
    let g=o.geometry; if(g.index) g=g.toNonIndexed(); else g=g.clone();
    g.applyMatrix4(o.matrixWorld);
    if(!g.attributes.normal) g.computeVertexNormals();
    const pos=g.attributes.position.array, nrm=g.attributes.normal.array;
    const col=g.attributes.color?g.attributes.color.array:null;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    const mc=mats[0].color||{r:1,g:1,b:1};
    const key=mats[0].name||mats[0].uuid; matInfo[key]=(matInfo[key]||0)+pos.length/9;
    for(let i=0;i<pos.length;i++){ P.push(pos[i]); Nr.push(nrm[i]); }
    const vc=pos.length/3;
    for(let v=0;v<vc;v++){
      const cr=col?col[v*(g.attributes.color.itemSize)]:1;
      const cg=col?col[v*(g.attributes.color.itemSize)+1]:1;
      const cb=col?col[v*(g.attributes.color.itemSize)+2]:1;
      C.push(cr*mc.r, cg*mc.g, cb*mc.b);
    }
  });

  // 2) robust centre via medians of vertex X/Z (ignores far comet-tail outliers);
  //    ground level via a low percentile of Y (ignores stray sub-ground objects)
  const xs=[],zs=[],ys=[]; for(let i=0;i<P.length;i+=3){ xs.push(P[i]); ys.push(P[i+1]); zs.push(P[i+2]); }
  const cx=median(xs), cz=median(zs), gy=pctile(ys,0.02);
  const TOP=gy+360;   // keep up to ~360m (real Eiffel ~330m) — kills the 657m stray spike
  const BOT=gy-25;    // a little below ground

  // 3) clip per-triangle: square play area around (cx,cz) AND vertical band [BOT,TOP]
  const kp=[],kn=[],kc=[];
  for(let t=0;t<P.length;t+=9){
    const ctx=(P[t]+P[t+3]+P[t+6])/3, ctz=(P[t+2]+P[t+5]+P[t+8])/3, cty=(P[t+1]+P[t+4]+P[t+7])/3;
    if(Math.abs(ctx-cx)>HALF||Math.abs(ctz-cz)>HALF) continue;
    if(cty<BOT||cty>TOP) continue;
    for(let k=0;k<9;k++){ kp.push(P[t+k]); kn.push(Nr[t+k]); kc.push(C[t+k]); }
  }

  // 4) recentre to origin, ground (gy) -> y=0
  for(let i=0;i<kp.length;i+=3){ kp[i]-=cx; kp[i+1]-=gy; kp[i+2]-=cz; }

  // 5) build single mesh
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(kp,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(kn,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(kc,3));
  const mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));

  // tower = centroid of the tallest geometry (y>120 after recentre)
  let tx=0,tz=0,tn=0,maxY=0;
  for(let i=0;i<kp.length;i+=3){ const y=kp[i+1]; if(y>maxY)maxY=y; if(y>120){ tx+=kp[i]; tz+=kp[i+2]; tn++; } }
  const tower=tn?{x:+(tx/tn).toFixed(1),z:+(tz/tn).toFixed(1),h:+maxY.toFixed(0)}:null;
  const bb=new THREE.Box3().setFromObject(mesh); const sz=bb.getSize(new THREE.Vector3());

  // 6) export GLB
  const exporter=new THREE.GLTFExporter();
  const glb=await new Promise((res,rej)=>exporter.parse(mesh,res,{binary:true},rej));
  // GLTFExporter (r128) returns ArrayBuffer for binary
  const bytes=new Uint8Array(glb);
  let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
  window.RESULT={ b64:btoa(bin), tris:kp.length/9, tower,
    size:[+sz.x.toFixed(1),+sz.y.toFixed(1),+sz.z.toFixed(1)],
    matInfo, center:[+cx.toFixed(1),+cz.toFixed(1)] };
}
main().catch(e=>{ window.ERR=String(e&&e.stack||e); });
</script></body></html>`;

const server = http.createServer((req,res)=>{
  if (req.url === '/') { res.writeHead(200,{'Content-Type':'text/html'}); return res.end(PAGE); }
  if (req.url === '/src.glb') { res.writeHead(200,{'Content-Type':'model/gltf-binary'}); return res.end(fs.readFileSync(path.join(ROOT,SRC_REL))); }
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
const R=await page.evaluate('window.RESULT');
const b64=R.b64; delete R.b64;
fs.writeFileSync(path.join(OUT_DIR,'world.glb'),Buffer.from(b64,'base64'));
console.log('\n=== Paris world built ===');
console.log(JSON.stringify(R,null,2));
const mb=(fs.statSync(path.join(OUT_DIR,'world.glb')).size/1048576).toFixed(2);
console.log(`wrote assets/paris/world.glb (${mb} MB), clipped to +/-${HALF}m`);
await browser.close(); server.close();
