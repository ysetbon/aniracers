// Headless check that a world's mesh loads INSIDE the game. Serves the repo, deep-links to
// /?world=<gameKey>&dbg, waits for the mesh (window.__dbg.worldGroup), then writes overview +
// top + live screenshots to maps/<name>/.
// Run: node scripts/verify-ingame.mjs --world=<name>
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));

const MIME = { '.html':'text/html', '.json':'application/json', '.bin':'application/octet-stream', '.glb':'model/gltf-binary',
               '.png':'image/png', '.svg':'image/svg+xml', '.js':'text/javascript', '.jpg':'image/jpeg' };
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
page.on('pageerror', e => { errors.push(String(e)); console.log('  [pageerror]', String(e)); });
page.on('console', m => { const t = m.text(); if (new RegExp(W.gameKey+'|error|failed|three','i').test(t)) console.log('  [page]', t); });

await page.goto(`http://localhost:${port}/?world=${W.gameKey}&dbg`, { waitUntil: 'domcontentloaded', timeout: 45000 });
// the game must expose window.__dbg.worldGroup for the active GLB world (see docs integration step)
await page.waitForFunction('window.__dbg && (window.__dbg.worldGroup || window.__dbg.mishGroup)', { timeout: 90000 })
  .catch(() => console.log('  (timed out waiting for worldGroup)'));
await new Promise(r => setTimeout(r, 2000));

function snap(kind){
  return page.evaluate((kind) => {
    const d = window.__dbg; const grp = d && (d.worldGroup || d.mishGroup); if (!grp) return null;
    const savedFog = d.scene.fog; d.scene.fog = null;
    const box = new THREE.Box3(); grp.traverse(o => { if (o.isMesh) box.expandByObject(o); });
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
fs.mkdirSync(W.paths.dir, { recursive: true });
for (const [kind, name] of [['buildings', '_ingame_overview.png'], ['top', '_ingame_top.png']]) {
  const png = await snap(kind);
  if (png) { fs.writeFileSync(path.join(W.paths.dir, name), Buffer.from(png.split(',')[1], 'base64')); console.log('wrote '+path.relative(ROOT,path.join(W.paths.dir,name))); }
  else console.log('NO __dbg.worldGroup — mesh did not load');
}
await new Promise(r => setTimeout(r, 4000));
const live = await page.screenshot({ encoding: 'base64' });
fs.writeFileSync(path.join(W.paths.dir, '_ingame_live.png'), Buffer.from(live, 'base64'));
console.log('wrote '+path.relative(ROOT,path.join(W.paths.dir,'_ingame_live.png')));

const stats = await page.evaluate(() => {
  const d = window.__dbg; const grp = d && (d.worldGroup || d.mishGroup); let meshes = 0;
  if (grp) grp.traverse(o => { if (o.isMesh) meshes++; });
  return { meshes, kids: d ? d.scene.children.length : -1 };
});
console.log('worldGroup meshes:', stats.meshes, '| scene children:', stats.kids, '| pageerrors:', errors.length);
try { await browser.close(); } catch {}
server.close();
console.log('done ['+W.name+']');
