// Overlay the OSM road network on the geo-referenced aerial so we can pick a
// clean perimeter race loop from real street centerlines. Also prints a text
// summary (name, length, endpoints in OSM metres) for numeric stitching.
//
// Run: node scripts/roads-overlay.mjs
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'osm_processed.json'), 'utf8'));
const gr = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'refs', 'aerial', 'sat_z17.json'), 'utf8'));
const osmToPx = (ox, oz) => [gr.outPx / 2 + (ox - gr.centerOsm[0]) / gr.mPerPx, gr.outPx / 2 + (oz - gr.centerOsm[1]) / gr.mPerPx];

const PERIM = /val[ée]ry|lebrun|herb[ée]|camus/i;
const len = pts => pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);

// text summary of named roads (longest first)
const named = osm.roads.filter(r => r.name && r.name !== '(unnamed)').map(r => ({ name: r.name, n: r.pts.length, len: len(r.pts), a: r.pts[0], b: r.pts[r.pts.length - 1], perim: PERIM.test(r.name) }));
named.sort((x, y) => y.len - x.len);
console.log('NAMED ROADS (name | pts | len m | end A (x,z) | end B):');
for (const r of named) console.log(`${r.perim ? '*' : ' '} ${r.name.padEnd(26)} ${String(r.n).padStart(3)} ${r.len.toFixed(0).padStart(5)}  A[${r.a.map(v => v.toFixed(0)).join(',')}] B[${r.b.map(v => v.toFixed(0)).join(',')}]`);

const roadsPx = osm.roads.map(r => ({ name: r.name || '', perim: PERIM.test(r.name || ''), pts: r.pts.map(p => osmToPx(p[0], p[1])) }));
const b64 = fs.readFileSync(path.join(ROOT, 'assets', 'refs', 'aerial', 'sat_z17.png')).toString('base64');

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const dataUrl = await page.evaluate(async (P) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + P.b64; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of P.roadsPx) {
    if (r.pts.length < 2) continue;
    g.strokeStyle = r.perim ? 'rgba(255,60,0,0.95)' : 'rgba(0,200,255,0.7)';
    g.lineWidth = r.perim ? 4 : 2;
    g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
  }
  // label perimeter roads at midpoint
  g.font = 'bold 15px sans-serif';
  for (const r of P.roadsPx) {
    if (!r.perim || r.pts.length < 2) continue;
    const m = r.pts[Math.floor(r.pts.length / 2)];
    g.fillStyle = '#000'; g.fillRect(m[0] - 2, m[1] - 14, g.measureText(r.name).width + 6, 18);
    g.fillStyle = '#ffd23f'; g.fillText(r.name, m[0] + 1, m[1]);
  }
  return cv.toDataURL('image/png');
}, { b64, roadsPx });
fs.writeFileSync(path.join(ROOT, 'maps', 'sarsel_info', '_roads_check.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('\nwrote maps/sarsel_info/_roads_check.png');
try { await browser.close(); } catch { }
