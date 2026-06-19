// Analyze the Overpass OSM dump for the Sarcelles / Rue Louis Lebrun neighborhood.
// Projects lat/lon into local meters centered on the playground and summarizes
// roads, buildings and the park so we can author a faithful race world.
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'osm_raw.json');
const CENTER = { lat: 48.978797, lon: 2.374265 }; // Aire de jeux pour enfants (start area)

const data = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const els = data.elements || [];

// Equirectangular projection to meters, X=east, Z=south(+) so it matches a top-down map.
const R = 6378137;
const cosLat = Math.cos(CENTER.lat * Math.PI / 180);
function project(lat, lon) {
  const x = (lon - CENTER.lon) * Math.PI / 180 * R * cosLat;
  const z = -(lat - CENTER.lat) * Math.PI / 180 * R; // north is -Z
  return [x, z];
}

function buildingHeight(tags, area) {
  if (tags.height) {
    const h = parseFloat(String(tags.height).replace(/m/i, ''));
    if (!Number.isNaN(h) && h > 0) return h;
  }
  if (tags['building:levels']) {
    const lv = parseInt(tags['building:levels'], 10);
    if (!Number.isNaN(lv) && lv > 0) return lv * 3;
  }
  const isBar = area > 800;
  return isBar ? 30 + Math.min(24, area / 200) : 9 + Math.min(18, area / 120);
}

const roads = [], buildings = [], parks = [], playgrounds = [], water = [];
for (const el of els) {
  if (el.type === 'node' && el.tags && el.tags.leisure === 'playground') {
    playgrounds.push({ pt: project(el.lat, el.lon), name: el.tags.name });
    continue;
  }
  if (el.type !== 'way' || !el.geometry) continue;
  const pts = el.geometry.map(g => project(g.lat, g.lon));
  const t = el.tags || {};
  if (t.highway) {
    roads.push({ id: el.id, name: t.name || '(unnamed)', highway: t.highway, pts });
  } else if (t.building) {
    let cx = 0, cz = 0; pts.forEach(p => { cx += p[0]; cz += p[1]; }); cx /= pts.length; cz /= pts.length;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    area = Math.abs(area) / 2;
    buildings.push({
      id: el.id, name: t.name, building: t.building, pts, c: [cx, cz],
      h: buildingHeight(t, area), levels: t['building:levels'] || null,
    });
  } else if (t.leisure === 'park') {
    parks.push({ id: el.id, name: t.name, pts });
  } else if (t.leisure === 'playground') {
    let cx = 0, cz = 0; pts.forEach(p => { cx += p[0]; cz += p[1]; }); cx /= pts.length; cz /= pts.length;
    playgrounds.push({ id: el.id, name: t.name, pts, c: [cx, cz] });
  } else if (t.natural === 'water' || t.waterway || t.landuse === 'basin') {
    water.push({ id: el.id, name: t.name, pts });
  }
}

console.log('=== ROADS ===', roads.length);
for (const r of roads) {
  const xs = r.pts.map(p => p[0]), zs = r.pts.map(p => p[1]);
  const len = r.pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - r.pts[i - 1][0], p[1] - r.pts[i - 1][1]) : 0, 0);
  console.log(`  ${r.name} [${r.highway}] pts=${r.pts.length} len=${len.toFixed(0)}m x[${Math.min(...xs).toFixed(0)},${Math.max(...xs).toFixed(0)}] z[${Math.min(...zs).toFixed(0)},${Math.max(...zs).toFixed(0)}]`);
}
console.log('\n=== BUILDINGS ===', buildings.length);
const named = buildings.filter(b => b.name);
console.log('  named:', named.map(b => b.name).join(' | '));
console.log('\n=== PARKS ===', parks.length, parks.map(p => p.name || '(unnamed)').join(' | '));
console.log('=== PLAYGROUNDS ===', playgrounds.length, playgrounds.map(p => p.name || '(unnamed)').join(' | '));
playgrounds.forEach(p => console.log('   playground at', p.c || p.pt, p.name || ''));

const lebrun = roads.filter(r => /lebrun/i.test(r.name));
console.log('\n=== RUE LOUIS LEBRUN segments ===', lebrun.length);
lebrun.forEach(r => console.log('  pts:', JSON.stringify(r.pts.map(p => [Math.round(p[0]), Math.round(p[1])]))));

const out = {
  center: CENTER,
  roads: roads.map(r => ({ name: r.name, highway: r.highway, pts: r.pts.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]) })),
  buildings: buildings.map(b => ({
    name: b.name || null, c: [+b.c[0].toFixed(1), +b.c[1].toFixed(1)],
    h: +b.h.toFixed(1), levels: b.levels,
    pts: b.pts.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]),
  })),
  parks: parks.map(p => ({ name: p.name || null, pts: p.pts.map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]) })),
  playgrounds: playgrounds.map(p => ({
    name: p.name || null,
    c: p.c ? [+p.c[0].toFixed(1), +p.c[1].toFixed(1)] : p.pt.map(v => +v.toFixed(1)),
    pts: p.pts ? p.pts.map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]) : null,
  })),
  water: water.map(w => ({ name: w.name || null, pts: w.pts.map(q => [+q[0].toFixed(1), +q[1].toFixed(1)]) })),
};
fs.writeFileSync(path.join(__dirname, '..', 'osm_processed.json'), JSON.stringify(out));
console.log('\nWrote osm_processed.json');
