// Harvest ONE good Street View photo per building (nearest pano to the footprint centroid,
// heading aimed at the centroid, FOV auto-zoomed by distance) so we can model each house.
//
// Run:  node --env-file=.env scripts/harvest-buildings.mjs --world=<name>
// Idempotent/resumable: existing non-empty jpgs are skipped. Writes a manifest
// (maps/<name>/building-sv.json) with pano distance + confidence.
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';

const KEY = process.env.GMAPS_KEY;
if (!KEY) { console.error('Missing GMAPS_KEY — run with: node --env-file=.env scripts/harvest-buildings.mjs --world=<name>'); process.exit(1); }
const W = resolveWorld(process.argv.slice(2));
if(!fs.existsSync(W.paths.buildings)){ console.error('missing '+path.relative(ROOT,W.paths.buildings)+' — run: node scripts/extract-buildings.mjs --world='+W.name); process.exit(1); }
const SVDIR = W.paths.streetview; fs.mkdirSync(SVDIR, { recursive: true });
const blds = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;

const META = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const IMG = 'https://maps.googleapis.com/maps/api/streetview';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function bearing(la1, lo1, la2, lo2) { const r = Math.PI / 180;
  const y = Math.sin((lo2 - lo1) * r) * Math.cos(la2 * r);
  const x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r);
  return (Math.atan2(y, x) / r + 360) % 360; }
function haversine(la1, lo1, la2, lo2) { const r = Math.PI / 180, R = 6371000;
  const dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)); }

const manifest = [];
let got = 0, skipped = 0, nopano = 0;
console.log(`[${W.name}] ${blds.length} buildings; harvesting nearest-pano Street View per centroid...`);
for (let i = 0; i < blds.length; i++) {
  const b = blds[i];
  const file = `bld_${b.id}.jpg`, abs = path.join(SVDIR, file);
  if (fs.existsSync(abs) && fs.statSync(abs).size > 2000) { skipped++; manifest.push({ id: b.id, file, cached: true }); continue; }
  let m;
  try { m = await (await fetch(`${META}?location=${b.clat},${b.clon}&radius=90&source=outdoor&key=${KEY}`)).json(); }
  catch (e) { console.log(`  meta err ${b.id}:`, e.message); manifest.push({ id: b.id, status: 'meta_error' }); continue; }
  if (m.status !== 'OK') { nopano++; manifest.push({ id: b.id, status: m.status }); continue; }
  const dist = haversine(m.location.lat, m.location.lng, b.clat, b.clon);
  const head = bearing(m.location.lat, m.location.lng, b.clat, b.clon);
  const fov = Math.max(45, Math.min(90, 30 + dist * 0.7));
  try {
    const r = await fetch(`${IMG}?size=640x400&pano=${m.pano_id}&heading=${head.toFixed(1)}&fov=${fov.toFixed(0)}&pitch=10&key=${KEY}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) throw new Error('tiny');
    fs.writeFileSync(abs, buf); got++;
    manifest.push({ id: b.id, file, pano_id: m.pano_id, date: m.date || '', dist: +dist.toFixed(1),
      heading: +head.toFixed(1), fov: +fov.toFixed(0), conf: dist < 45 ? 'high' : dist < 75 ? 'med' : 'low',
      area: b.area, levels: b.levels });
    if (got % 20 === 0) console.log(`  ${got} fetched (${i + 1}/${blds.length})  last dist ${dist.toFixed(0)}m`);
  } catch (e) { console.log(`  img err ${b.id}:`, e.message); manifest.push({ id: b.id, status: 'img_error' }); }
  await sleep(35);
}
fs.writeFileSync(W.paths.sv, JSON.stringify({ generatedAt: '', count: manifest.length, fetched: got, skipped, nopano, photos: manifest }, null, 2));
console.log(`\n[${W.name}] DONE: ${got} new, ${skipped} cached, ${nopano} no-pano  ->  ${path.relative(ROOT, SVDIR)}/`);
console.log('manifest -> '+path.relative(ROOT, W.paths.sv));
