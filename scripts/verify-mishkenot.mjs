// Headless check that the Mishkenot Zvulun mesh world loads INSIDE the game.
// Serves the repo, deep-links to /?world=mishkenot&dbg, waits for the mesh, then
// writes an overview + a live gameplay screenshot to maps/mishkenot_zvulun/.
// Run: node scripts/verify-mishkenot.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html', '.json':'application/json', '.bin':'application/octet-stream',
               '.png':'image/png', '.svg':'image/svg+xml', '.js':'text/javascript' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = u === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800 });
const errors = [];
page.on('console', m => { const t = m.text(); if (/mishkenot|error|failed|three/i.test(t)) console.log('  [page]', t); });
page.on('pageerror', e => { errors.push(String(e)); console.log('  [pageerror]', String(e)); });

await page.goto(`http://localhost:${port}/?world=mishkenot&dbg`, { waitUntil: 'domcontentloaded', timeout: 45000 });
// wait for the async mesh to be added
await page.waitForFunction('window.__dbg && window.__dbg.mishGroup', { timeout: 90000 })
  .catch(() => console.log('  (timed out waiting for mishGroup)'));
await new Promise(r => setTimeout(r, 2000));

// 1) deterministic overview via the dbg handle
function snap(kind){
  return page.evaluate((kind) => {
    const d = window.__dbg; if (!d || !d.mishGroup) return null;
    const savedFog = d.scene.fog; d.scene.fog = null;
    // frame: 'buildings' = built-up area only; 'top' = whole world, north-up
    const box = new THREE.Box3();
    d.mishGroup.traverse(o => { if (o.isMesh) box.expandByObject(o); });
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const R = Math.max(s.x, s.z, 40);
    const cam = new THREE.PerspectiveCamera(kind === 'top' ? 52 : 48, 1200/800, 0.1, 8000);
    if (kind === 'top') cam.position.set(c.x, c.y + R * 1.15, c.z + 0.01);
    else cam.position.set(c.x + R * 0.85, c.y + R * 0.6, c.z + R * 0.95);
    cam.lookAt(c.x, c.y, c.z);
    d.renderer.render(d.scene, cam);
    const url = d.renderer.domElement.toDataURL('image/png');
    d.scene.fog = savedFog;
    return url;
  }, kind);
}
for (const [kind, name] of [['buildings', '_ingame_overview.png'], ['top', '_ingame_top.png']]) {
  const png = await snap(kind);
  if (png) { fs.writeFileSync(path.join(ROOT, 'maps', 'mishkenot_zvulun', name), Buffer.from(png.split(',')[1], 'base64')); console.log('wrote maps/mishkenot_zvulun/' + name); }
  else console.log('NO __dbg.mishGroup — mesh did not load');
}

// 2) live gameplay frame (kart-eye view of the neighbourhood)
await new Promise(r => setTimeout(r, 4000));
const live = await page.screenshot({ encoding: 'base64' });
fs.writeFileSync(path.join(ROOT, 'maps', 'mishkenot_zvulun', '_ingame_live.png'), Buffer.from(live, 'base64'));
console.log('wrote maps/mishkenot_zvulun/_ingame_live.png');

const stats = await page.evaluate(() => {
  const d = window.__dbg; let meshes = 0, tris = 0;
  if (d && d.mishGroup) d.mishGroup.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; if (g && g.index) tris += g.index.count/3; } });
  return { meshes, tris, kids: d ? d.scene.children.length : -1 };
});
console.log('mishGroup meshes:', stats.meshes, '| tris:', (stats.tris|0).toLocaleString(), '| scene children:', stats.kids, '| pageerrors:', errors.length);

try { await browser.close(); } catch {}
server.close();
console.log('done');
