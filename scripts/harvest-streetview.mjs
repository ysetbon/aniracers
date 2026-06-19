// Node port of maps/sarsel_info/.../harvest_streetview.py (no Python available here).
// Walks route_points.csv, snaps each point to the nearest REAL Street View pano,
// downloads 8 directional tiles (yaw 0..315, true-north compass deg), and writes a
// manifest tying every image to its exact GPS / pano_id / capture date.
//
// Run:  node --env-file=.env scripts/harvest-streetview.mjs
// Idempotent/resumable: existing non-empty tiles are skipped.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const KEY = process.env.GMAPS_KEY;
if (!KEY) { console.error('Missing GMAPS_KEY — run with: node --env-file=.env scripts/harvest-streetview.mjs'); process.exit(1); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'refs', 'streetview');
const TILES = path.join(OUT, 'tiles');
fs.mkdirSync(TILES, { recursive: true });

const YAWS = [0, 45, 90, 135, 180, 225, 270, 315];
const FOV = 90, PITCH = 0, TW = 640, TH = 400, RADIUS = 35, SOURCE = 'outdoor';
const META = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const IMG = 'https://maps.googleapis.com/maps/api/streetview';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const csv = fs.readFileSync(path.join(ROOT, 'maps', 'sarsel_info', 'route_points.csv'), 'utf8').trim().split(/\r?\n/);
csv.shift(); // header
const pts = csv.map(l => { const [idx, leg, wp, lat, lon, cum] = l.split(','); return { idx: +idx, leg, wp, lat: +lat, lon: +lon, cum: +cum }; });

const seen = new Set();
const manifest = [];
let n = 0;
console.log(`${pts.length} route points; snapping to panoramas (radius ${RADIUS} m, ${SOURCE})...`);

for (const p of pts) {
  let m;
  try { m = await (await fetch(`${META}?location=${p.lat},${p.lon}&radius=${RADIUS}&source=${SOURCE}&key=${KEY}`)).json(); }
  catch (e) { console.log('  meta error:', e.message); continue; }
  if (m.status !== 'OK') { console.log(`  (no pano @ ${p.lat},${p.lon}: ${m.status})`); continue; }
  if (seen.has(m.pano_id)) continue;
  seen.add(m.pano_id);

  const la = m.location.lat, lo = m.location.lng, date = m.date || '';
  n++;
  const tag = `${String(n).padStart(3, '0')}_${m.pano_id.slice(0, 10).replace(/[^A-Za-z0-9_-]/g, '')}`;
  const tiles = {};
  let got = 0;
  for (const y of YAWS) {
    const rel = `tiles/${tag}_yaw${String(y).padStart(3, '0')}.jpg`;
    const abs = path.join(OUT, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).size > 2000) { tiles[y] = rel; got++; continue; }
    try {
      const r = await fetch(`${IMG}?size=${TW}x${TH}&pano=${m.pano_id}&heading=${y}&pitch=${PITCH}&fov=${FOV}&key=${KEY}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) throw new Error('tiny (' + buf.length + 'B)');
      fs.writeFileSync(abs, buf); tiles[y] = rel; got++;
    } catch (e) { console.log(`  tile err ${tag} yaw${y}:`, e.message); }
    await sleep(40);
  }
  if (!got) { n--; continue; }

  manifest.push({
    index: n, pano_id: m.pano_id, lat: la, lon: lo, date,
    leg: p.leg, nearest_waypoint: p.wp,
    requested_lat: p.lat, requested_lon: p.lon,
    heading_is: 'true-north compass degrees (0=N, 90=E)', tiles,
  });
  console.log(`[${String(n).padStart(3)}] ${m.pano_id}  ${la.toFixed(6)},${lo.toFixed(6)}  ${date}  (${got}/8)`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'),
  JSON.stringify({ crs: 'WGS84', fov_deg: FOV, pitch_deg: PITCH, yaws_deg: YAWS, tile_px: [TW, TH], count: n, generated_from: 'route_points.csv', panoramas: manifest }, null, 2));
console.log(`\nDONE: ${n} unique panoramas -> ${path.relative(ROOT, OUT)}/  (manifest.json written)`);
