// Multi-viewpoint Street View harvest (v2 of harvest-buildings): several panos per building
// with good angular spread, budgeted by distance from the race line, plus optional per-street
// "context strips" along the track corridor. See docs/world-enhancement-plan.md §A.
//
// Run:  node --env-file=.env scripts/harvest-views.mjs --world=<name> [--tier=A] [--limit=N]
//       node --env-file=.env scripts/harvest-views.mjs --world=<name> --strips [--corridor=60]
//       node scripts/harvest-views.mjs --world=<name> --dry        # plan only, no API key needed
//
// Tiers (min distance from building centroid to the track polyline in track.json):
//   A <=60m: 3 views    B <=150m: 2 views    C beyond: 1 view (today's behaviour)
// Idempotent/resumable: existing non-empty jpgs are skipped; the manifest is rewritten each run.
// Output: maps/<name>/views/bld_<id>_<k>.jpg (+ views/strips/...) and building-views.json.
import fs from 'fs'; import path from 'path';
import { resolveWorld, readArea, projection, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const STRIPS = argv.includes('--strips');
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const ONLY_TIER = arg('tier', null);            // e.g. --tier=A  (also accepts A,B)
const LIMIT = +arg('limit', 0) || 0;
const CORRIDOR = +arg('corridor', 60);          // strips: roads within this many m of the track
const KEY = process.env.GMAPS_KEY;
if (!KEY && !DRY) { console.error('Missing GMAPS_KEY — run with: node --env-file=.env scripts/harvest-views.mjs --world=<name>  (or --dry to plan)'); process.exit(1); }

const W = resolveWorld(argv);
const need = f => { if (!fs.existsSync(f)) { console.error('missing ' + path.relative(ROOT, f)); process.exit(1); } };
need(W.paths.buildings); need(W.paths.track);
const blds = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const roads = fs.existsSync(path.join(W.paths.dir, 'roads.json'))
  ? JSON.parse(fs.readFileSync(path.join(W.paths.dir, 'roads.json'), 'utf8')).roads : [];
const track = JSON.parse(fs.readFileSync(W.paths.track, 'utf8'));
const proj = projection(readArea(W));
fs.mkdirSync(W.paths.views, { recursive: true });

const META = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const IMG = 'https://maps.googleapis.com/maps/api/streetview';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = Math.PI / 180;
function bearing(la1, lo1, la2, lo2) {
  const y = Math.sin((lo2 - lo1) * R) * Math.cos(la2 * R);
  const x = Math.cos(la1 * R) * Math.sin(la2 * R) - Math.sin(la1 * R) * Math.cos(la2 * R) * Math.cos((lo2 - lo1) * R);
  return (Math.atan2(y, x) / R + 360) % 360; }
function haversine(la1, lo1, la2, lo2) {
  const dla = (la2 - la1) * R, dlo = (lo2 - lo1) * R;
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin(dlo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a)); }
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// --- polyline helpers (world XZ) ---
function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  const qx = ax + t * dx, qz = az + t * dz;
  return { d: Math.hypot(px - qx, pz - qz), qx, qz, t };
}
function distToPolyline(px, pz, pts, closed) {
  let best = { d: Infinity };
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    const r = distToSeg(px, pz, ax, az, bx, bz);
    if (r.d < best.d) best = { ...r, seg: i };
  }
  return best;
}
// point at arc-length s along a polyline (clamped)
function pointAt(pts, s) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (acc + L >= s || i === pts.length - 2) {
      const t = L ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      return [ax + t * (bx - ax), az + t * (bz - az)];
    }
    acc += L;
  }
  return pts[pts.length - 1];
}
function arcLengthAt(pts, seg, t) {
  let acc = 0;
  for (let i = 0; i < seg; i++) acc += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return acc + t * Math.hypot(pts[seg + 1][0] - pts[seg][0], pts[seg + 1][1] - pts[seg][1]);
}

const TIERS = { A: { max: 60, views: 3 }, B: { max: 150, views: 2 }, C: { max: Infinity, views: 1 } };
const tierOf = d => d <= TIERS.A.max ? 'A' : d <= TIERS.B.max ? 'B' : 'C';

async function svMeta(lat, lon, radius) {
  const m = await (await fetch(`${META}?location=${lat},${lon}&radius=${radius}&source=outdoor&key=${KEY}`)).json();
  return m.status === 'OK' ? m : null;
}
async function svFetch(abs, pano, heading, fov, pitch) {
  if (fs.existsSync(abs) && fs.statSync(abs).size > 2000) return 'cached';
  const r = await fetch(`${IMG}?size=640x640&pano=${pano}&heading=${heading.toFixed(1)}&fov=${fov.toFixed(0)}&pitch=${pitch}&key=${KEY}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error('tiny');
  fs.writeFileSync(abs, buf); return 'fetched';
}

// ---------------- buildings mode ----------------
async function harvestBuildings() {
  const prev = fs.existsSync(W.paths.viewsJson)
    ? JSON.parse(fs.readFileSync(W.paths.viewsJson, 'utf8')).buildings || {} : {};
  const out = {}; let planned = 0, fetched = 0, cached = 0, nopano = 0, done = 0;

  for (const b of blds) {
    const trackDist = distToPolyline(b.cx, b.cz, track.ctrl, track.closed !== false).d;
    const tier = tierOf(trackDist);
    if (ONLY_TIER && !ONLY_TIER.split(',').includes(tier)) continue;
    if (LIMIT && done >= LIMIT) break;
    done++;
    const want = TIERS[tier].views;

    // resumable: keep a previous entry if it already has enough views on disk
    const old = prev[b.id];
    if (old && old.views?.length >= want &&
        old.views.every(v => fs.existsSync(path.join(W.paths.views, v.file)))) {
      out[b.id] = old; cached += old.views.length; continue;
    }

    // probe points: building centroid + up/down the nearest road
    const probes = [{ lat: b.clat, lon: b.clon, radius: 90 }];
    let bestRoad = null, bestHit = { d: Infinity };
    for (const rd of roads) {
      if (!rd.pts || rd.pts.length < 2) continue;
      const hit = distToPolyline(b.cx, b.cz, rd.pts, false);
      if (hit.d < bestHit.d) { bestHit = hit; bestRoad = rd; }
    }
    if (bestRoad && bestHit.d < 80) {
      const s0 = arcLengthAt(bestRoad.pts, bestHit.seg, bestHit.t);
      for (const off of [-25, 25]) {
        const [x, z] = pointAt(bestRoad.pts, s0 + off);
        const [lat, lon] = proj.fromXZ(x, z);
        probes.push({ lat, lon, radius: 30 });
      }
    }
    planned += probes.length;
    if (DRY) { out[b.id] = { id: b.id, tier, trackDist: +trackDist.toFixed(1), probes: probes.length, want }; continue; }

    // collect candidate panos (dedupe by pano_id)
    const cands = new Map();
    for (const p of probes) {
      try {
        const m = await svMeta(p.lat, p.lon, p.radius);
        if (m && !cands.has(m.pano_id)) {
          const dist = haversine(m.location.lat, m.location.lng, b.clat, b.clon);
          if (dist <= 120) cands.set(m.pano_id, {
            pano_id: m.pano_id, date: m.date || '', lat: m.location.lat, lon: m.location.lng,
            dist, bear: bearing(m.location.lat, m.location.lng, b.clat, b.clon) });
        }
      } catch (e) { /* metadata errors: just fewer candidates */ }
      await sleep(20);
    }
    if (!cands.size) { nopano++; out[b.id] = { id: b.id, tier, trackDist: +trackDist.toFixed(1), views: [] }; continue; }

    // pick: primary = closest with an age bonus for newer panos, then greedily
    // maximize angular spread (>=25 degrees apart) up to the tier budget
    const list = [...cands.values()];
    const year = d => +String(d).slice(0, 4) || 2010;
    list.sort((a, c) => (a.dist - (year(a.date) - 2010) * 4) - (c.dist - (year(c.date) - 2010) * 4));
    const picked = [list[0]];
    while (picked.length < want) {
      let best = null, bestSep = 25;   // require at least 25 degrees of new angle
      for (const c of list) {
        if (picked.includes(c)) continue;
        const sep = Math.min(...picked.map(p => angDiff(p.bear, c.bear)));
        if (sep >= bestSep) { bestSep = sep; best = c; }
      }
      if (!best) break;
      picked.push(best);
    }

    const views = [];
    for (let k = 0; k < picked.length; k++) {
      const c = picked[k];
      const fov = Math.max(45, Math.min(90, 30 + c.dist * 0.7));
      const file = `bld_${b.id}_${k}.jpg`;
      try {
        const st = await svFetch(path.join(W.paths.views, file), c.pano_id, c.bear, fov, 8);
        st === 'fetched' ? fetched++ : cached++;
        views.push({ file, pano_id: c.pano_id, date: c.date, lat: c.lat, lon: c.lon,
          dist: +c.dist.toFixed(1), heading: +c.bear.toFixed(1), fov: +fov.toFixed(0) });
      } catch (e) { console.log(`  img err ${b.id}/${k}:`, e.message); }
      await sleep(35);
    }
    out[b.id] = { id: b.id, tier, trackDist: +trackDist.toFixed(1), area: b.area, levels: b.levels, views };
    if (done % 20 === 0) console.log(`  ${done} buildings (${fetched} new imgs)`);
  }

  if (DRY) {
    const byTier = {};
    for (const v of Object.values(out)) { byTier[v.tier] = (byTier[v.tier] || 0) + 1; }
    console.log(`[${W.name}] DRY plan: ${Object.keys(out).length} buildings, tiers`, byTier, `~${planned} metadata probes`);
    const est = Object.values(out).reduce((s, v) => s + v.want, 0);
    console.log(`  image budget if fresh: ~${est} static shots`);
    return;
  }
  const manifest = { generatedAt: '', tiers: TIERS.A.max + '/' + TIERS.B.max, count: Object.keys(out).length,
    fetched, cached, nopano, buildings: out };
  fs.writeFileSync(W.paths.viewsJson, JSON.stringify(manifest, null, 2));
  console.log(`\n[${W.name}] DONE: ${fetched} new, ${cached} cached, ${nopano} no-pano -> ${path.relative(ROOT, W.paths.views)}/`);
  console.log('manifest -> ' + path.relative(ROOT, W.paths.viewsJson));
}

// ---------------- strips mode (street-level context along the track corridor) ----------------
async function harvestStrips() {
  const dir = path.join(W.paths.views, 'strips'); fs.mkdirSync(dir, { recursive: true });
  const corridor = roads.filter(rd => rd.pts?.length >= 2 &&
    rd.pts.some(([x, z]) => distToPolyline(x, z, track.ctrl, track.closed !== false).d <= CORRIDOR));
  console.log(`[${W.name}] strips: ${corridor.length}/${roads.length} road segments within ${CORRIDOR}m of the track`);
  const out = []; let fetched = 0, cached = 0;

  for (const rd of corridor) {
    const len = rd.lengthM || 60;
    const samples = [];
    for (let s = 15; s < len; s += 30) samples.push(s);
    if (!samples.length) samples.push(len / 2);
    const seen = new Set();
    for (let si = 0; si < samples.length; si++) {
      const [x, z] = pointAt(rd.pts, samples[si]);
      const [x2, z2] = pointAt(rd.pts, samples[si] + 5);
      const [lat, lon] = proj.fromXZ(x, z);
      const [lat2, lon2] = proj.fromXZ(x2, z2);
      const along = bearing(lat, lon, lat2, lon2);
      if (DRY) { out.push({ road: rd.id, k: si, lat: +lat.toFixed(6), lon: +lon.toFixed(6), along: +along.toFixed(0) }); continue; }
      let m = null;
      try { m = await svMeta(lat, lon, 25); } catch (e) {}
      await sleep(20);
      if (!m || seen.has(m.pano_id)) continue;
      seen.add(m.pano_id);
      const shots = [];
      for (const [tag, hd] of [['a', along], ['l', (along + 270) % 360], ['r', (along + 90) % 360]]) {
        const file = `road_${rd.id}_${si}_${tag}.jpg`;
        try {
          const st = await svFetch(path.join(dir, file), m.pano_id, hd, tag === 'a' ? 80 : 75, tag === 'a' ? 5 : 8);
          st === 'fetched' ? fetched++ : cached++;
          shots.push({ file, heading: +hd.toFixed(1) });
        } catch (e) { console.log(`  img err ${rd.id}/${si}${tag}:`, e.message); }
        await sleep(35);
      }
      out.push({ road: rd.id, name: rd.name, type: rd.type, k: si, pano_id: m.pano_id, date: m.date || '',
        lat: m.location.lat, lon: m.location.lng, along: +along.toFixed(1), shots });
    }
  }
  if (DRY) { console.log(`  DRY: ${out.length} sample points, ~${out.length * 3} shots if fresh`); return; }
  fs.writeFileSync(path.join(W.paths.dir, 'strips-sv.json'),
    JSON.stringify({ corridor: CORRIDOR, count: out.length, fetched, cached, strips: out }, null, 2));
  console.log(`\n[${W.name}] strips DONE: ${fetched} new, ${cached} cached -> ${path.relative(ROOT, dir)}/`);
}

await (STRIPS ? harvestStrips() : harvestBuildings());
