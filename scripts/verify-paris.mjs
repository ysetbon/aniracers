// Headless check that the Paris (Eiffel/Champ de Mars) OSM2World world loads INSIDE
// the game. Serves the repo, deep-links to /?world=paris&dbg, waits for the mesh,
// then writes overview + top + a live gameplay screenshot to assets/paris/.
// Run: node scripts/verify-paris.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'paris');
const MIME = { '.html':'text/html', '.json':'application/json', '.bin':'application/octet-stream',
               '.glb':'model/gltf-binary', '.png':'image/png', '.svg':'image/svg+xml', '.js':'text/javascript' };
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
page.on('console', m => { const t = m.text(); if (/paris|error|failed|three/i.test(t)) console.log('  [page]', t); });
page.on('pageerror', e => { errors.push(String(e)); console.log('  [pageerror]', String(e)); });

await page.goto(`http://localhost:${port}/?world=paris&dbg`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction('window.__dbg && window.__dbg.parisGroup', { timeout: 25000 })
  .catch(() => console.log('  (timed out waiting for parisGroup)'));
await new Promise(r => setTimeout(r, 1500));

function snap(kind){
  return page.evaluate((kind) => {
    const d = window.__dbg; if (!d || !d.parisGroup) return null;
    const savedFog = d.scene.fog; d.scene.fog = null;
    const box = new THREE.Box3();
    d.parisGroup.traverse(o => { if (o.isMesh) box.expandByObject(o); });
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const R = Math.max(s.x, s.z, 40);
    const cam = new THREE.PerspectiveCamera(kind === 'top' ? 52 : 48, 1200/800, 0.1, 12000);
    if (kind === 'top') cam.position.set(c.x, c.y + R * 1.15, c.z + 0.01);
    else cam.position.set(c.x + R * 0.8, c.y + R * 0.55, c.z + R * 0.9);
    cam.lookAt(c.x, c.y * 0.4, c.z);
    d.renderer.render(d.scene, cam);
    const url = d.renderer.domElement.toDataURL('image/png');
    d.scene.fog = savedFog;
    return url;
  }, kind);
}
for (const [kind, name] of [['ov', '_ingame_overview.png'], ['top', '_ingame_top.png']]) {
  const png = await snap(kind);
  if (png) { fs.writeFileSync(path.join(OUT, name), Buffer.from(png.split(',')[1], 'base64')); console.log('wrote assets/paris/' + name); }
  else console.log('NO __dbg.parisGroup — mesh did not load');
}

// live gameplay frame (kart-eye view) after the countdown
await new Promise(r => setTimeout(r, 4500));
const live = await page.screenshot({ encoding: 'base64' });
fs.writeFileSync(path.join(OUT, '_ingame_live.png'), Buffer.from(live, 'base64'));
console.log('wrote assets/paris/_ingame_live.png');

const stats = await page.evaluate(() => {
  const d = window.__dbg; let meshes = 0, tris = 0;
  if (d && d.parisGroup) d.parisGroup.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; if (g) { const n = g.index ? g.index.count : g.attributes.position.count; tris += n/3; } } });
  return { meshes, tris, kids: d ? d.scene.children.length : -1 };
});
console.log('parisGroup meshes:', stats.meshes, '| tris:', (stats.tris|0).toLocaleString(), '| scene children:', stats.kids, '| pageerrors:', errors.length);

try { await browser.close(); } catch {}
server.close();
console.log('done');
