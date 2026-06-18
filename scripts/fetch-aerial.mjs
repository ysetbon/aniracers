// Pull geo-referenced aerial tiles (Maps Static API) for the Sarcelles loop and
// write each with a georef sidecar (center/zoom/scale/size + computed m/px and the
// OSM-meter origin). Then overlay OSM footprints + route pins to verify alignment.
//
// Run: node --env-file=.env scripts/fetch-aerial.mjs
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const KEY = process.env.GMAPS_KEY;
if (!KEY) { console.error('Missing GMAPS_KEY — run: node --env-file=.env scripts/fetch-aerial.mjs'); process.exit(1); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'refs', 'aerial'); fs.mkdirSync(OUT, { recursive: true });
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'osm_processed.json'), 'utf8'));
const CENTER = osm.center, R = 6378137, cosC = Math.cos(CENTER.lat * Math.PI / 180);
const project = (lat, lon) => [(lon - CENTER.lon) * Math.PI / 180 * R * cosC, -(lat - CENTER.lat) * Math.PI / 180 * R];

// Race loop pins (Google Maps); centroid = bbox center
const PINS = [['START', 48.9787, 2.37421], ['P2', 48.980063, 2.374902], ['P3', 48.98044, 2.37221], ['P4', 48.978453, 2.371434], ['P5', 48.97811, 2.374007]];
const lats = PINS.map(p => p[1]), lons = PINS.map(p => p[2]);
const latC = (Math.min(...lats) + Math.max(...lats)) / 2, lonC = (Math.min(...lons) + Math.max(...lons)) / 2;

const SIZE = 640;
const TILES = [
  { name: 'sat_z17', zoom: 17, scale: 2, maptype: 'satellite' }, // ~502 m, 0.39 m/px (full loop + margin)
  { name: 'sat_z18', zoom: 18, scale: 2, maptype: 'satellite' }, // ~251 m, 0.20 m/px (core detail)
  { name: 'hybrid_z18', zoom: 18, scale: 2, maptype: 'hybrid' }, // labels + road lines
];

function georef(zoom, scale) {
  const base = 156543.03392 * Math.cos(latC * Math.PI / 180) / 2 ** zoom;
  return { center: [latC, lonC], zoom, scale, size: SIZE, outPx: SIZE * scale, mPerPx: base / scale, centerOsm: project(latC, lonC) };
}

let okBase = null;
for (const t of TILES) {
  const pngPath = path.join(OUT, t.name + '.png');
  if (fs.existsSync(pngPath) && fs.statSync(pngPath).size > 50000) {
    fs.writeFileSync(path.join(OUT, t.name + '.json'), JSON.stringify(georef(t.zoom, t.scale), null, 2));
    console.log(`${t.name}: cached`);
    if (t.maptype === 'satellite' && (!okBase || t.zoom > okBase.zoom)) okBase = { name: t.name, zoom: t.zoom };
    continue;
  }
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${latC},${lonC}&zoom=${t.zoom}&size=${SIZE}x${SIZE}&scale=${t.scale}&maptype=${t.maptype}&format=png&key=${KEY}`;
  try {
    const r = await fetch(url);
    if (!r.ok) { console.log(`${t.name}: HTTP ${r.status} ${(await r.text()).slice(0, 180)}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(OUT, t.name + '.png'), buf);
    const gr = georef(t.zoom, t.scale);
    fs.writeFileSync(path.join(OUT, t.name + '.json'), JSON.stringify(gr, null, 2));
    console.log(`${t.name}: ${(buf.length / 1024).toFixed(0)}KB  ${gr.outPx}px  ${gr.mPerPx.toFixed(3)} m/px  covers ${(SIZE * gr.scale * gr.mPerPx).toFixed(0)}m`);
    if (t.maptype === 'satellite' && (!okBase || t.zoom > okBase.zoom)) okBase = { name: t.name, zoom: t.zoom };
  } catch (e) { console.log(`${t.name}: ERROR ${e.message}`); }
}
if (!okBase) { console.log('\nNo aerials fetched (Maps Static API may still be propagating — retry in a few min).'); process.exit(0); }

// Overlay OSM footprints + route pins onto the highest-detail satellite tile.
const gr = JSON.parse(fs.readFileSync(path.join(OUT, okBase.name + '.json'), 'utf8'));
const b64 = fs.readFileSync(path.join(OUT, okBase.name + '.png')).toString('base64');
const pins = PINS.map(([n, la, lo]) => ({ n, m: project(la, lo) }));
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const dataUrl = await page.evaluate(async (P) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + P.b64; });
  const W = img.width, H = img.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const toPx = (mx, mz) => [W / 2 + (mx - P.gr.centerOsm[0]) / P.gr.mPerPx, H / 2 + (mz - P.gr.centerOsm[1]) / P.gr.mPerPx];
  const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => { const q = toPx(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.stroke(); };
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,229,255,0.85)';
  for (const b of P.buildings) if (b.pts && b.pts.length > 1) poly(b.pts);
  g.strokeStyle = 'rgba(60,255,90,0.95)';
  for (const pk of P.parks) if (pk.pts && pk.pts.length > 1) poly(pk.pts);
  g.font = 'bold 16px sans-serif'; g.lineWidth = 3;
  for (const pin of P.pins) {
    const q = toPx(pin.m[0], pin.m[1]);
    g.fillStyle = pin.n === 'START' ? 'rgba(255,40,40,0.95)' : 'rgba(255,210,0,0.95)';
    g.beginPath(); g.arc(q[0], q[1], pin.n === 'START' ? 9 : 6, 0, 7); g.fill();
    g.strokeStyle = '#000'; g.stroke();
    g.fillStyle = '#fff'; g.strokeText(pin.n, q[0] + 9, q[1] - 8); g.fillText(pin.n, q[0] + 9, q[1] - 8);
  }
  return cv.toDataURL('image/png');
}, { b64, gr, buildings: osm.buildings, parks: osm.parks, pins });
const outImg = path.join(ROOT, 'maps', 'sarsel_info', '_georef_check.png');
fs.writeFileSync(outImg, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`\nwrote ${path.relative(ROOT, outImg)} (OSM overlay on ${okBase.name}) — inspect for alignment`);
try { await browser.close(); } catch { /* Windows temp-profile cleanup EPERM — harmless */ }
