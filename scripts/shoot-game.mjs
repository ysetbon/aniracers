// Launch the server, start the Sarcelles race headlessly, and capture two shots:
//   _game_chase.png   — live chase-cam view of the world
//   _game_topdown.png — frozen top-down (compare against the satellite)
// Run: node scripts/shoot-game.mjs
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8099;
const SHOT = (n) => path.join(ROOT, 'maps', 'sarsel_info', n);

const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitHealth(tries = 40) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise(res => http.get(`http://localhost:${PORT}/healthz`, r => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
    if (ok) return true;
    await wait(250);
  }
  throw new Error('server did not come up');
}

try {
  await waitHealth();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errs = [], notFound = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() === 404) notFound.push(r.url().replace(`http://localhost:${PORT}`, '')); });

  await page.goto(`http://localhost:${PORT}/?dbg=1`, { waitUntil: 'load' });
  await page.waitForSelector('#startSarcelles', { visible: true, timeout: 20000 });
  await page.click('#startSarcelles');
  await wait(6500); // world build + ~3.5s countdown + a little race

  await page.screenshot({ path: SHOT('_game_chase.png') });

  // Freeze the render loop, then drive a clean top-down and render one frame.
  await page.evaluate(() => { window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; });
  await wait(300);
  const td = await page.evaluate(() => {
    try {
      const { scene, camera, renderer, trackCenter: c } = window.__dbg || {};
      if (!scene) return { ok: false, err: 'no __dbg handle' };
      scene.fog = null;
      camera.position.set(c.x, 215, c.z + 0.001);
      camera.up.set(0, 1, 0); camera.lookAt(c.x, 0, c.z);
      camera.fov = 62; camera.near = 0.1; camera.far = 2000; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      return { ok: true, center: [Math.round(c.x), Math.round(c.z)] };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  await page.screenshot({ path: SHOT('_game_topdown.png') });

  console.log('topdown:', JSON.stringify(td));
  console.log('page errors:', errs.length ? errs.slice(0, 8) : 'none');
  console.log('404s:', notFound.length ? [...new Set(notFound)] : 'none');
  try { await browser.close(); } catch { }
} finally {
  srv.kill();
}
