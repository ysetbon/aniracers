// Back-project the generated game world (sarcelles_world.json) onto the real
// geo-referenced aerial (assets/refs/aerial/sat_z17) to prove the in-game track
// loop + building footprints match the satellite. Writes a check PNG.
//
// Run: node scripts/verify-world.mjs   (no API key needed)
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'sarcelles_world.json'), 'utf8'));
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'osm_processed.json'), 'utf8'));
const gr = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'refs', 'aerial', 'sat_z17.json'), 'utf8'));

const C0 = osm.center, R = 6378137, cosC = Math.cos(C0.lat * Math.PI / 180);
const project = (lat, lon) => [(lon - C0.lon) * Math.PI / 180 * R * cosC, -(lat - C0.lat) * Math.PI / 180 * R];

// Generator transform: game = (osm - centroid) * scale, rot 0. Prefer the exact
// params stored by the generator; fall back to recovering from the start anchor.
const S = world.scale;
const centroid = world.transform ? world.transform.centroidOsm
  : (() => { const a = project(world.route[0].lat, world.route[0].lon); return [a[0] - world.startPlayground[0] / S, a[1] - world.startPlayground[1] / S]; })();
const gameToOsm = (gx, gz) => [centroid[0] + gx / S, centroid[1] + gz / S];
const osmToPx = (ox, oz) => [gr.outPx / 2 + (ox - gr.centerOsm[0]) / gr.mPerPx, gr.outPx / 2 + (oz - gr.centerOsm[1]) / gr.mPerPx];
const gameToPx = (gx, gz) => { const o = gameToOsm(gx, gz); return osmToPx(o[0], o[1]); };

// Catmull-Rom centerline through the closed control loop (same as the generator/runtime).
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}
const ctrl = world.ctrl, M = ctrl.length, center = [];
for (let i = 0; i < M; i++) {
  const p0 = ctrl[(i - 1 + M) % M], p1 = ctrl[i], p2 = ctrl[(i + 1) % M], p3 = ctrl[(i + 2) % M];
  for (let s = 0; s < 16; s++) center.push(catmull(p0, p1, p2, p3, s / 16));
}
const centerPx = center.map(p => gameToPx(p[0], p[1]));
const roadHalfPx = (16 / 2 / S) / gr.mPerPx; // ROAD_W=16 game units -> px on the aerial

// Building footprints -> aerial px (rotated rectangles)
const bldPx = world.buildings.map(b => {
  const c = Math.cos(b.r), s = Math.sin(b.r), hw = b.w / 2, hd = b.d / 2;
  return {
    n: b.n || '', k: b.k,
    cor: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([ox, oz]) => gameToPx(b.x + ox * c - oz * s, b.z + ox * s + oz * c)),
  };
});
const startPx = gameToPx(world.startPlayground[0], world.startPlayground[1]);
const b64 = fs.readFileSync(path.join(ROOT, 'assets', 'refs', 'aerial', 'sat_z17.png')).toString('base64');

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const dataUrl = await page.evaluate(async (P) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + P.b64; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  // track corridor
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = 'rgba(40,40,40,0.45)'; g.lineWidth = P.roadHalfPx * 2;
  g.beginPath(); P.centerPx.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
  g.strokeStyle = 'rgba(255,210,63,0.95)'; g.lineWidth = 2.5; g.setLineDash([10, 8]);
  g.beginPath(); P.centerPx.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
  g.setLineDash([]);
  // buildings
  g.lineWidth = 2;
  for (const b of P.bldPx) {
    g.strokeStyle = b.k === 'barre' ? 'rgba(255,120,0,0.95)' : b.k === 'school' ? 'rgba(0,180,255,0.95)' : b.k === 'synagogue' ? 'rgba(230,200,40,0.95)' : 'rgba(255,255,255,0.9)';
    g.beginPath(); b.cor.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
  }
  // start
  g.fillStyle = 'rgba(255,40,40,0.95)'; g.strokeStyle = '#000'; g.lineWidth = 2;
  g.beginPath(); g.arc(P.startPx[0], P.startPx[1], 10, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.strokeText('START', P.startPx[0] + 10, P.startPx[1] - 8); g.fillText('START', P.startPx[0] + 10, P.startPx[1] - 8);
  return cv.toDataURL('image/png');
}, { b64, centerPx, roadHalfPx, bldPx, startPx });
const out = path.join(ROOT, 'maps', 'sarsel_info', '_world_check.png');
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`wrote ${path.relative(ROOT, out)}  | ctrl=${M} pts, buildings=${world.buildings.length}, scale=${S}`);
console.log(`recovered OSM centroid: ${centroid.map(v => v.toFixed(1))}  (aerial ${gr.outPx}px @ ${gr.mPerPx.toFixed(3)} m/px)`);
try { await browser.close(); } catch { }
