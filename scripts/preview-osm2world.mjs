// Headless sanity render of an OSM2World-generated GLB (e.g. the Eiffel Tower area).
// Serves the GLB over http, loads it into three.js r128 via GLTFLoader 0.128 (same
// version the game uses), prints geometry stats, and writes a 3/4 + top-down PNG.
// Run: node scripts/preview-osm2world.mjs [relative/path/to.glb]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB_REL = process.argv[2] || 'OSM2World/_aniracers_test/eiffel.glb';
const OUT_DIR = path.join(ROOT, path.dirname(GLB_REL));
const MIME = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.html': 'text/html', '.png': 'image/png' };

const PAGE = `<!doctype html><html><head><meta charset=utf8><style>html,body{margin:0;background:#9fd0f0}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script></head>
<body><canvas id=c width=1280 height=900></canvas><script>
window.STATS = null; window.DONE = null; window.ERR = null;
async function main(){
  const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true,preserveDrawingBuffer:true});
  renderer.setClearColor(0x9fd0f0);
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x6b7a55,0.9));
  const sun=new THREE.DirectionalLight(0xfff1d0,1.0); sun.position.set(0.6,1,0.4); scene.add(sun);

  const loader=new THREE.GLTFLoader();
  const gltf=await new Promise((res,rej)=>loader.load('/model.glb',res,undefined,rej));
  const model=gltf.scene; scene.add(model);

  // stats
  let tris=0, meshes=0, verts=0; const mats=new Set();
  model.traverse(o=>{ if(o.isMesh){ meshes++; const g=o.geometry; const idx=g.index?g.index.count:g.attributes.position.count; tris+=idx/3; verts+=g.attributes.position.count; (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m.uuid)); }});
  const box=new THREE.Box3().setFromObject(model);
  const size=new THREE.Vector3(); box.getSize(size);
  const center=new THREE.Vector3(); box.getCenter(center);
  window.STATS={ tris:Math.round(tris), meshes, verts, materials:mats.size,
    size:[+size.x.toFixed(1),+size.y.toFixed(1),+size.z.toFixed(1)],
    min:[+box.min.x.toFixed(1),+box.min.y.toFixed(1),+box.min.z.toFixed(1)],
    max:[+box.max.x.toFixed(1),+box.max.y.toFixed(1),+box.max.z.toFixed(1)] };

  const cam=new THREE.PerspectiveCamera(50,1280/900,0.5,100000);
  const r=Math.max(size.x,size.z);
  function shoot(){ return renderer.domElement.toDataURL('image/png'); }

  // 3/4 perspective
  cam.position.set(center.x + r*0.9, center.y + r*0.7, center.z + r*0.9);
  cam.lookAt(center); renderer.render(scene,cam);
  const persp = shoot();

  // top-down
  cam.position.set(center.x, center.y + r*1.6, center.z+0.001);
  cam.up.set(0,0,-1); cam.lookAt(center); renderer.render(scene,cam);
  const top = shoot();

  window.DONE = { persp, top };
}
main().catch(e=>{ window.ERR = String(e&&e.stack||e); });
</script></body></html>`;

const server = http.createServer((req,res)=>{
  if (req.url === '/' || req.url === '/index.html') { res.writeHead(200,{'Content-Type':'text/html'}); return res.end(PAGE); }
  if (req.url === '/model.glb') {
    const p = path.join(ROOT, GLB_REL);
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end('no glb'); }
    res.writeHead(200,{'Content-Type':'model/gltf-binary'}); return res.end(fs.readFileSync(p));
  }
  res.writeHead(404); res.end('not found');
});

await new Promise(r=>server.listen(0,r));
const port = server.address().port;

const browser = await puppeteer.launch({ args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('console',m=>console.log('  [page]',m.text()));
await page.goto(`http://localhost:${port}/`, { waitUntil:'load' });
await page.waitForFunction('window.DONE || window.ERR', { timeout: 60000 });

const err = await page.evaluate('window.ERR');
if (err) { console.error('PAGE ERROR:\n'+err); await browser.close(); server.close(); process.exit(1); }

const stats = await page.evaluate('window.STATS');
console.log('\n=== OSM2World GLB stats:', GLB_REL, '===');
console.log(JSON.stringify(stats,null,2));
console.log('Footprint (X*Z metres):', stats.size[0], 'x', stats.size[2], '| height Y:', stats.size[1]);

const out = await page.evaluate('window.DONE');
for (const [name,data] of Object.entries(out)) {
  const b64 = data.replace(/^data:image\/png;base64,/,'');
  const fp = path.join(OUT_DIR, `_preview_${name}.png`);
  fs.writeFileSync(fp, Buffer.from(b64,'base64'));
  console.log('wrote', fp);
}
await browser.close(); server.close();
