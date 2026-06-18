// STANDARD VERIFIER — always run after changing the Sarcelles world.
// Confirms the built map, seen from straight overhead (north-up), matches the
// reference satellite maps/sarsel_info/sarsel_from_above.png.
//
// Outputs (maps/sarsel_info/, git-ignored):
//   _sarsel_overlay.png  — real OSM footprints + built track drawn ON sarsel_from_above
//                          (proves the geo-reference/scale and that the track sits right)
//   _game_ortho.png      — the built 3D world rendered orthographic top-down, north-up,
//                          framed to the SAME ground extent as sarsel_from_above
//   _topdown_compare.png — sarsel_from_above (left) vs the built world top-down (right)
//
// Run: node scripts/verify-topdown.mjs [metresPerPixel=0.392]
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8099;
const OUT = n => path.join(ROOT, 'maps', 'sarsel_info', n);

const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'osm_processed.json'), 'utf8'));
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'sarcelles_world.json'), 'utf8'));
const C0 = osm.center, R = 6378137, cosC = Math.cos(C0.lat * Math.PI / 180);
const project = (la, lo) => [(lo - C0.lon) * Math.PI / 180 * R * cosC, -(la - C0.lat) * Math.PI / 180 * R];
const Astart = project(48.9787, 2.37421);
const SCALE = world.scale;
const centroid = world.transform ? world.transform.centroidOsm : [0, 0];
const MPP = Number(process.argv[2] || 0.392); // sarsel_from_above metres/px (Google z18, scale 1)

// Built track centreline (game space) — Catmull through the control loop.
function catmull(p0, p1, p2, p3, t) { const t2 = t * t, t3 = t2 * t; return [0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3), 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]; }
const cp = world.ctrl, M = cp.length, centerGame = [];
for (let i = 0; i < M; i++) { const a = cp[(i - 1 + M) % M], b = cp[i], c = cp[(i + 1) % M], d = cp[(i + 2) % M]; for (let s = 0; s < 16; s++) centerGame.push(catmull(a, b, c, d, s / 16)); }

const sarB64 = fs.readFileSync(path.join(ROOT, 'maps', 'sarsel_info', 'sarsel_from_above.png')).toString('base64');
const wait = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
async function waitHealth(t = 40) { for (let i = 0; i < t; i++) { const ok = await new Promise(res => http.get(`http://localhost:${PORT}/healthz`, r => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false))); if (ok) return; await wait(250); } throw new Error('server down'); }

try {
  await waitHealth();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const page = await browser.newPage();

  // ---- A. Geo-reference sarsel_from_above (red dot) + overlay real footprints + built track ----
  const geo = await page.evaluate(async (P) => {
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + P.sarB64; });
    const W = img.width, H = img.height;
    // detect the dark-red START dot on a native-size canvas (reject orange POI pins: orange has G>>B; red has G≈B)
    const cn = document.createElement('canvas'); cn.width = W; cn.height = H; const gn = cn.getContext('2d'); gn.drawImage(img, 0, 0);
    const d = gn.getImageData(0, 0, W, H).data; let sx = 0, sy = 0, c = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2]; if (R > 100 && R - G > 55 && R - B > 55 && Math.abs(G - B) < 30) { sx += x; sy += y; c++; } }
    const rx = c ? sx / c : W / 2, ry = c ? sy / c : H / 2;
    // draw the overlay at 2x so thin features survive downscaling
    const K = 2; const cv = document.createElement('canvas'); cv.width = W * K; cv.height = H * K; const g = cv.getContext('2d'); g.drawImage(img, 0, 0, W * K, H * K);
    const toPx = (ox, oz) => [(rx + (ox - P.Ax) / P.MPP) * K, (ry + (oz - P.Az) / P.MPP) * K]; // OSM m -> 2x px (north up)
    const g2px = (gx, gz) => toPx(P.centroid[0] + gx / P.SCALE, P.centroid[1] + gz / P.SCALE);  // game -> 2x px
    // real OSM building footprints (cyan, lightly filled)
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,229,255,0.95)'; g.fillStyle = 'rgba(0,229,255,0.12)';
    for (const b of P.buildings) { if (!b.pts || b.pts.length < 2) continue; g.beginPath(); b.pts.forEach((p, i) => { const q = toPx(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); g.stroke(); }
    // built track: faint drivable corridor + bright dashed centreline
    g.lineJoin = g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,210,63,0.28)'; g.lineWidth = (16 / P.SCALE) / P.MPP * K;
    g.beginPath(); P.centerGame.forEach((p, i) => { const q = g2px(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(255,196,0,1)'; g.lineWidth = 3 * K; g.setLineDash([10 * K, 7 * K]);
    g.beginPath(); P.centerGame.forEach((p, i) => { const q = g2px(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.stroke(); g.setLineDash([]);
    // red-dot anchor (magenta) + built start (red)
    g.strokeStyle = 'magenta'; g.lineWidth = 3; g.beginPath(); g.arc(rx * K, ry * K, 9 * K, 0, 7); g.stroke();
    const s = g2px(P.start[0], P.start[1]); g.fillStyle = 'red'; g.beginPath(); g.arc(s[0], s[1], 5 * K, 0, 7); g.fill();
    return { W, H, rx: +rx.toFixed(1), ry: +ry.toFixed(1), redCount: c, dataUrl: cv.toDataURL('image/png') };
  }, { sarB64, buildings: osm.buildings, centerGame, Ax: Astart[0], Az: Astart[1], MPP, centroid, SCALE, start: world.startPlayground });
  fs.writeFileSync(OUT('_sarsel_overlay.png'), Buffer.from(geo.dataUrl.split(',')[1], 'base64'));
  console.log(`sarsel_from_above ${geo.W}x${geo.H}px  red dot=(${geo.rx},${geo.ry}) from ${geo.redCount}px  @ ${MPP} m/px`);

  // ground extent of sarsel_from_above, mapped into game space (for the matched ortho frame)
  const oxC = Astart[0] + (geo.W / 2 - geo.rx) * MPP, ozC = Astart[1] + (geo.H / 2 - geo.ry) * MPP;
  const cx = (oxC - centroid[0]) * SCALE, cz = (ozC - centroid[1]) * SCALE;
  const ex = geo.W * MPP * SCALE, ez = geo.H * MPP * SCALE;

  // ---- B. Render the built world orthographic top-down, north-up, matched extent ----
  await page.setViewport({ width: geo.W, height: geo.H, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/?dbg=1`, { waitUntil: 'load' });
  await page.waitForSelector('#startSarcelles', { visible: true, timeout: 20000 });
  await page.click('#startSarcelles');
  await wait(6500);
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await wait(300);
  // Render the shared scene through a fresh OFFSCREEN ortho renderer (so the game's
  // chase-cam loop can't overwrite it) and export the pixels directly.
  const ortho = await page.evaluate((P) => {
    const dbg = window.__dbg; if (!dbg) return { ok: false, err: 'no __dbg' };
    dbg.scene.fog = null;
    const rr = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    rr.setSize(P.pxW, P.pxH); rr.setClearColor(0xdfe6ea, 1);
    rr.shadowMap.enabled = true; rr.shadowMap.type = THREE.PCFSoftShadowMap;
    const cam = new THREE.OrthographicCamera(-P.ex / 2, P.ex / 2, P.ez / 2, -P.ez / 2, 0.1, 4000);
    cam.position.set(P.cx, 900, P.cz); cam.up.set(0, 0, -1); cam.lookAt(P.cx, 0, P.cz);
    cam.updateProjectionMatrix();
    rr.render(dbg.scene, cam);
    const url = rr.domElement.toDataURL('image/png'); rr.dispose();
    return { ok: true, url };
  }, { ex, ez, cx, cz, pxW: geo.W * 2, pxH: geo.H * 2 });
  if (ortho.url) fs.writeFileSync(OUT('_game_ortho.png'), Buffer.from(ortho.url.split(',')[1], 'base64'));
  console.log('ortho:', ortho.ok, ortho.err || '', `frame ${ex.toFixed(0)}x${ez.toFixed(0)} game-units @ (${cx.toFixed(0)},${cz.toFixed(0)})`);

  // ---- C. Side-by-side compare ----
  const orthoB64 = fs.readFileSync(OUT('_game_ortho.png')).toString('base64');
  await page.goto('about:blank');
  const cmp = await page.evaluate(async (P) => {
    const load = b64 => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/png;base64,' + b64; });
    const a = await load(P.sarB64), b = await load(P.orthoB64);
    const Hc = 600, gap = 16, pad = 30;
    const aw = a.width * Hc / a.height, bw = b.width * Hc / b.height;
    const cv = document.createElement('canvas'); cv.width = aw + gap + bw; cv.height = Hc + pad; const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(a, 0, pad, aw, Hc); g.drawImage(b, aw + gap, pad, bw, Hc);
    g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif';
    g.fillText('sarsel_from_above (reference)', 6, 21); g.fillText('built world — top-down (north up)', aw + gap + 6, 21);
    return cv.toDataURL('image/png');
  }, { sarB64, orthoB64 });
  fs.writeFileSync(OUT('_topdown_compare.png'), Buffer.from(cmp.split(',')[1], 'base64'));
  console.log('wrote _sarsel_overlay.png, _game_ortho.png, _topdown_compare.png');
  try { await browser.close(); } catch { }
} finally {
  srv.kill();
}
