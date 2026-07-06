// Top-down overview of the baked world: boots the real game headless, drops an orthographic
// camera straight above the neighbourhood, warm daylight + shadows, kart hidden, and saves one
// big PNG. Orientation matches the road-inventory map + spawnat coords: +x → right, +z → down.
// Run: node scripts/shoot-topdown.mjs --world=netanya [--px=1600] [--q=v4] [--out=<dir>]
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const OUTDIR = arg('out', path.join(W.paths.dir, 'art-match'));
const PX = +arg('px', '1600');
const extraQ = arg('q', 'v4');
fs.mkdirSync(OUTDIR, { recursive: true });

const MIME = { '.html':'text/html','.json':'application/json','.bin':'application/octet-stream','.glb':'model/gltf-binary',
               '.png':'image/png','.svg':'image/svg+xml','.js':'text/javascript','.jpg':'image/jpeg' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f = u === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, u);
  if (!f.startsWith(ROOT)) { res.writeHead(404); return res.end('nf'); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: PX, height: PX });
page.on('pageerror', e => console.log('  [pageerror]', String(e)));
await page.setRequestInterception(true);
const VENDOR = { 'three.min.js': 'three.min.js', 'GLTFLoader.js': 'GLTFLoader.js' };
page.on('request', rq => {
  const u = rq.url();
  if (/^https?:\/\/(cdnjs|unpkg)/.test(u)) {
    const base = Object.keys(VENDOR).find(k => u.endsWith(k));
    if (base) return rq.respond({ status: 200, contentType: 'text/javascript',
      body: fs.readFileSync(path.join(ROOT, 'scripts/vendor', VENDOR[base])) });
    if (/DRACOLoader\.js$|\/draco\//.test(u)) return rq.continue();
    return rq.abort();
  }
  rq.continue();
});

await page.goto(`http://localhost:${port}/?world=${W.gameKey}&${extraQ}&dbg`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction('window.__dbg && (window.__dbg.worldGroup || window.__dbg.mishGroup)', { timeout: 90000 })
  .catch(() => { console.error('timed out waiting for world'); process.exit(1); });
await new Promise(r => setTimeout(r, 1800));

const png = await page.evaluate((PX) => {
  const d = window.__dbg, sc = d.scene;
  const world = d.worldGroup || d.mishGroup;
  const savedFog = sc.fog; sc.fog = null;
  // world extent (XZ)
  const bb = new THREE.Box3().setFromObject(world);
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const spanX = (bb.max.x - bb.min.x), spanZ = (bb.max.z - bb.min.z);
  const half = Math.max(spanX, spanZ) / 2 * 1.04;   // square, small margin
  // orthographic straight down; up = -Z so north is up, +x right, +z down (matches spawnat/map)
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 4000);
  cam.position.set(cx, 1500, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz);

  // hide kart + gameplay objects; keep world + lights + ground planes
  const hidden = [];
  for (const o of sc.children) {
    if (o === world || o.isLight) continue;
    if (o.geometry && o.geometry.type === 'PlaneGeometry') continue;
    if (o.visible) { hidden.push(o); o.visible = false; }
  }
  // warm daylight, sun angled for relief, big shadow frustum over the whole hood
  const saved = {}; let sun = null, hemi = null;
  sc.traverse(o => { if (o.isDirectionalLight && !sun) sun = o; if (o.isHemisphereLight && !hemi) hemi = o; });
  if (sun) {
    saved.sun = { pos: sun.position.clone(), int: sun.intensity, col: sun.color.clone(),
      L: sun.shadow.camera.left, R: sun.shadow.camera.right, T: sun.shadow.camera.top,
      B: sun.shadow.camera.bottom, far: sun.shadow.camera.far, bias: sun.shadow.bias, tpos: sun.target.position.clone() };
    sun.position.set(cx - half * .35, 1200, cz - half * .3);
    sun.target.position.set(cx, 0, cz); sun.target.updateMatrixWorld(); if (!sun.target.parent) sc.add(sun.target);
    sun.color.setHex(0xfff0d2); sun.intensity = 1.5;
    const R = half + 40; sun.shadow.camera.left = -R; sun.shadow.camera.right = R; sun.shadow.camera.top = R;
    sun.shadow.camera.bottom = -R; sun.shadow.camera.far = 2600; sun.shadow.bias = -0.0005; sun.shadow.camera.updateProjectionMatrix();
  }
  if (hemi) { saved.hemi = { int: hemi.intensity, col: hemi.color.clone(), grd: hemi.groundColor.clone() };
    hemi.intensity = 0.95; hemi.color.setHex(0xfff3de); hemi.groundColor.setHex(0xcdb89a); }
  saved.tone = d.renderer.toneMapping; saved.exp = d.renderer.toneMappingExposure;
  d.renderer.toneMapping = THREE.ACESFilmicToneMapping; d.renderer.toneMappingExposure = 1.06;
  d.renderer.shadowMap.needsUpdate = true;

  d.renderer.render(sc, cam);
  const url = d.renderer.domElement.toDataURL('image/png');

  if (sun && saved.sun) { sun.position.copy(saved.sun.pos); sun.intensity = saved.sun.int; sun.color.copy(saved.sun.col);
    sun.shadow.camera.left = saved.sun.L; sun.shadow.camera.right = saved.sun.R; sun.shadow.camera.top = saved.sun.T;
    sun.shadow.camera.bottom = saved.sun.B; sun.shadow.camera.far = saved.sun.far; sun.shadow.bias = saved.sun.bias;
    sun.target.position.copy(saved.sun.tpos); sun.shadow.camera.updateProjectionMatrix(); }
  if (hemi && saved.hemi) { hemi.intensity = saved.hemi.int; hemi.color.copy(saved.hemi.col); hemi.groundColor.copy(saved.hemi.grd); }
  d.renderer.toneMapping = saved.tone; d.renderer.toneMappingExposure = saved.exp;
  for (const o of hidden) o.visible = true;
  sc.fog = savedFog;
  return { url, cx: Math.round(cx), cz: Math.round(cz), half: Math.round(half),
           bx: [Math.round(bb.min.x), Math.round(bb.max.x)], bz: [Math.round(bb.min.z), Math.round(bb.max.z)] };
}, PX);

const out = path.join(OUTDIR, 'overview_topdown.png');
fs.writeFileSync(out, Buffer.from(png.url.split(',')[1], 'base64'));
console.log(`wrote ${path.relative(ROOT, out)}  (${PX}x${PX})`);
console.log(`view: centre (${png.cx}, ${png.cz})  half-span ${png.half}m  world x[${png.bx}] z[${png.bz}]`);
console.log(`scale: 1px = ${(png.half * 2 / PX).toFixed(2)} m  ·  +x right, +z down (matches spawnat)`);
try { await browser.close(); } catch {}
server.close();
