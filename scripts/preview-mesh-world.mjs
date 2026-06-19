// Headless sanity render of the converted Mishkenot Zvulun mesh world.
// Serves the repo over http, loads assets/mishkenot/world.{json,bin} into three.js
// r128, and writes a top-down + 3/4 perspective PNG to maps/mishkenot_zvulun/.
// Run: node scripts/preview-mesh-world.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.json': 'application/json', '.bin': 'application/octet-stream', '.html': 'text/html' };

const PAGE = `<!doctype html><html><head><meta charset=utf8><style>html,body{margin:0;background:#7ec8f7}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></head>
<body><canvas id=c width=1100 height=800></canvas><script>
const COLORS={ground:0xe7d8b5,lawn:0x6fbf5a,sidewalk:0xc2c2c8,road:0x40434b,building:0xcabfa8,grass:0x57a23a,tree:0x4f9d4a,water:0x3399ff};
async function main(){
  const M=await (await fetch('/assets/mishkenot/world.json')).json();
  const buf=await (await fetch('/assets/mishkenot/world.bin')).arrayBuffer();
  const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true});
  renderer.setClearColor(0x7ec8f7);
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x668844,0.95));
  const sun=new THREE.DirectionalLight(0xfff1d0,1.1); sun.position.set(0.5,1,0.3); scene.add(sun);
  const root=new THREE.Group(); scene.add(root);
  const pOff=M.bin.positions.byteOffset, iOff=M.bin.indices.byteOffset;
  for(const part of M.parts){
    const pos=new Float32Array(buf,pOff+part.vStart*12,part.vCount*3);
    const idx=new Uint32Array(buf,iOff+part.iStart*4,part.iCount);
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos.slice(),3));
    g.setIndex(new THREE.BufferAttribute(idx.slice(),1));
    g.computeVertexNormals();
    const mat=new THREE.MeshLambertMaterial({color:COLORS[part.role]??0xff00ff,side:THREE.DoubleSide});
    root.add(new THREE.Mesh(g,mat));
  }
  // re-centre + Z-up -> Y-up
  const c=M.bbox, cx=(c.min[0]+c.max[0])/2, cy=(c.min[1]+c.max[1])/2, cz=c.min[2];
  const pivot=new THREE.Group(); pivot.add(root); scene.remove(root); scene.add(pivot);
  root.position.set(-cx,-cy,-cz);
  pivot.rotation.x=-Math.PI/2;
  const SX=M.size.x, SY=M.size.y, R=Math.max(SX,SY);
  const cam=new THREE.PerspectiveCamera(50,1100/800,0.1,R*6);
  function shoot(name,pos,look){
    cam.position.set(pos[0],pos[1],pos[2]); cam.lookAt(look[0],look[1],look[2]);
    renderer.render(scene,cam);
    window.__png=renderer.domElement.toDataURL('image/png');
    window.__done=name;
  }
  window.__shoot=shoot; window.__R=R; window.__ready=true;
}
main().catch(e=>{window.__err=String(e)+'\\n'+(e.stack||'');});
</script></body></html>`;

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/' || u === '/preview') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 800 });
page.on('console', m => console.log('  [page]', m.text()));
await page.goto(`http://localhost:${port}/preview`, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__ready===true || window.__err', { timeout: 30000 });
const err = await page.evaluate('window.__err||null');
if (err) { console.error('PAGE ERROR:', err); await browser.close(); server.close(); process.exit(1); }
const R = await page.evaluate('window.__R');

async function capture(name, pos, look) {
  await page.evaluate(`window.__shoot(${JSON.stringify(name)},${JSON.stringify(pos)},${JSON.stringify(look)})`);
  await page.waitForFunction(`window.__done===${JSON.stringify(name)}`, { timeout: 10000 });
  const data = await page.evaluate('window.__png');
  const out = path.join(ROOT, 'maps', 'mishkenot_zvulun', name);
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', path.relative(ROOT, out));
}
// top-down (north up) and a 3/4 aerial
await capture('_preview_top.png', [0, R * 1.25, 0.001], [0, 0, 0]);
await capture('_preview_persp.png', [R * 0.7, R * 0.6, R * 0.85], [0, 0, 0]);

try { await browser.close(); } catch {}
server.close();
console.log('done');
