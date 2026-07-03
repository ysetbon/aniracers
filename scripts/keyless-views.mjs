// Bridge: views/keyless/keyless.json (sv-keyless.mjs manifest) -> building-views.json,
// the manifest gemini-restyle.mjs and the spec chunks read. Groups the per-building shots
// (bld_<id>_p<pano>.jpg) by building, sorts views best-first (closest pano), and assigns
// the same track-distance tiers as harvest-views.mjs (A<=60m, B<=150m, C beyond).
//
// Run: node scripts/keyless-views.mjs --world=<name>
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';

const W = resolveWorld(process.argv.slice(2));
const MANIFEST = path.join(W.paths.views, 'keyless', 'keyless.json');
if (!fs.existsSync(MANIFEST)) { console.error('missing ' + path.relative(ROOT, MANIFEST) + ' — run sv-keyless.mjs first'); process.exit(1); }
const shots = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).shots;
const blds = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const track = JSON.parse(fs.readFileSync(W.paths.track, 'utf8'));

function distToPolyline(px, pz, pts, closed) {
  let best = Infinity; const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}
const tierOf = d => d <= 60 ? 'A' : d <= 150 ? 'B' : 'C';

const byBld = new Map();
for (const s of shots) {
  if (s.bld == null) continue;
  if (!fs.existsSync(path.join(W.paths.views, 'keyless', s.file))) continue;
  if (!byBld.has(s.bld)) byBld.set(s.bld, []);
  byBld.get(s.bld).push(s);
}

const out = {}; let nViews = 0;
for (const [id, list] of byBld) {
  const b = blds.find(x => String(x.id) === String(id));
  if (!b) continue;
  const trackDist = distToPolyline(b.cx, b.cz, track.ctrl, track.closed !== false);
  list.sort((a, c) => (a.dist ?? 999) - (c.dist ?? 999));
  const views = list.map(s => ({ file: 'keyless/' + s.file, pano_id: s.pano_id,
    lat: s.lat, lon: s.lon, dist: s.dist, heading: s.heading, fov: s.fov || 72 }));
  out[id] = { id, tier: tierOf(trackDist), trackDist: +trackDist.toFixed(1),
    area: b.area, levels: b.levels, views };
  nViews += views.length;
}

const byTier = {};
for (const v of Object.values(out)) byTier[v.tier] = (byTier[v.tier] || 0) + 1;
fs.writeFileSync(W.paths.viewsJson, JSON.stringify({ generatedAt: '', source: 'keyless',
  count: Object.keys(out).length, buildings: out }, null, 1));
console.log(`[${W.name}] ${Object.keys(out).length} buildings, ${nViews} views, tiers`, byTier);
console.log('wrote ' + path.relative(ROOT, W.paths.viewsJson));
