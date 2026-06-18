// Overlay the user's race line (route_points.csv) and a smooth Catmull loop
// through the 5 pins onto the geo-referenced aerial, to judge it as the track.
// Run: node scripts/route-overlay.mjs
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'osm_processed.json'), 'utf8'));
const gr = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'refs', 'aerial', 'sat_z17.json'), 'utf8'));
const C0 = osm.center, R = 6378137, cosC = Math.cos(C0.lat * Math.PI / 180);
const project = (lat, lon) => [(lon - C0.lon) * Math.PI / 180 * R * cosC, -(lat - C0.lat) * Math.PI / 180 * R];
const osmToPx = (o) => [gr.outPx / 2 + (o[0] - gr.centerOsm[0]) / gr.mPerPx, gr.outPx / 2 + (o[1] - gr.centerOsm[1]) / gr.mPerPx];
const llToPx = (la, lo) => osmToPx(project(la, lo));

// raw route_points.csv
const csv = fs.readFileSync(path.join(ROOT, 'maps', 'sarsel_info', 'route_points.csv'), 'utf8').trim().split(/\r?\n/);
csv.shift();
const route = csv.map(l => { const c = l.split(','); return { lat: +c[3], lon: +c[4], wp: c[2] }; });
const routePx = route.map(p => llToPx(p.lat, p.lon));

const PINS = [['START', 48.9787, 2.37421], ['P2', 48.980063, 2.374902], ['P3', 48.98044, 2.37221], ['P4', 48.978453, 2.371434], ['P5', 48.97811, 2.374007]];
const pinsOsm = PINS.map(([n, la, lo]) => ({ n, o: project(la, lo) }));

// Catmull-Rom through the 5 pins (closed)
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
  0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)];
}
const cp = pinsOsm.map(p => p.o), M = cp.length, smooth = [];
for (let i = 0; i < M; i++) { const a = cp[(i - 1 + M) % M], b = cp[i], c = cp[(i + 1) % M], d = cp[(i + 2) % M]; for (let s = 0; s < 24; s++) smooth.push(catmull(a, b, c, d, s / 24)); }
const smoothPx = smooth.map(osmToPx);

const b64 = fs.readFileSync(path.join(ROOT, 'assets', 'refs', 'aerial', 'sat_z17.png')).toString('base64');
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const dataUrl = await page.evaluate(async (P) => {
  const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + P.b64; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  g.lineJoin = g.lineCap = 'round';
  // raw route (thin red)
  g.strokeStyle = 'rgba(255,40,40,0.9)'; g.lineWidth = 2; g.beginPath(); P.routePx.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
  // smooth catmull (thick yellow, ~kart width)
  g.strokeStyle = 'rgba(255,210,63,0.5)'; g.lineWidth = 26; g.beginPath(); P.smoothPx.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
  g.strokeStyle = 'rgba(255,210,63,1)'; g.lineWidth = 2; g.beginPath(); P.smoothPx.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
  // pins
  g.font = 'bold 17px sans-serif';
  for (const p of P.pinsPx) {
    g.fillStyle = p.n === 'START' ? 'rgba(255,40,40,1)' : 'rgba(40,120,255,1)'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(p.px[0], p.px[1], 8, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(p.n, p.px[0] + 9, p.px[1] - 7); g.fillText(p.n, p.px[0] + 9, p.px[1] - 7);
  }
  return cv.toDataURL('image/png');
}, { b64, routePx, smoothPx, pinsPx: pinsOsm.map(p => ({ n: p.n, px: osmToPx(p.o) })) });
fs.writeFileSync(path.join(ROOT, 'maps', 'sarsel_info', '_route_check.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('wrote maps/sarsel_info/_route_check.png');
try { await browser.close(); } catch { }
