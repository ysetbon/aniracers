// Build game-space data for the Sarcelles race world from real OSM geometry,
// geo-referenced to the satellite aerial (assets/refs/aerial/).
//
// Track: a closed Catmull-Rom loop through the 5 real Google-Maps pins
// (START=Aire de jeux -> P2 NE -> P3 NW -> P4 W -> P5 S -> START), which the
// route-overlay check proved hugs the real perimeter streets (Paul Valéry N /
// Louis Lebrun E / Paul Herbé S / Albert Camus W) around the central superblock.
// Scenery: every substantial OSM building footprint in the loop frame (the long
// concrete "barres", schools, synagogue), the green courtyards, and the Aire de
// jeux at the start — projected to metres and scaled, NOT over-filtered.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const osm = JSON.parse(fs.readFileSync(path.join(root, 'osm_processed.json'), 'utf8'));

const PIN_LOOP = [
  { name: 'START', lat: 48.978700, lon: 2.374210 }, // Aire de jeux pour enfants (red dot)
  { name: 'P2', lat: 48.980063, lon: 2.374902 },     // NE  (Paul Valéry / Louis Lebrun)
  { name: 'P3', lat: 48.980440, lon: 2.372210 },     // NW  (Paul Valéry / Albert Camus)
  { name: 'P4', lat: 48.978453, lon: 2.371434 },     // W   (Albert Camus)
  { name: 'P5', lat: 48.978110, lon: 2.374007 },     // S   (Paul Herbé)
];

const CENTER = osm.center;
const R = 6378137;
const cosLat = Math.cos(CENTER.lat * Math.PI / 180);
function project(lat, lon) {
  return [(lon - CENTER.lon) * Math.PI / 180 * R * cosLat, -(lat - CENTER.lat) * Math.PI / 180 * R];
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// Uniform Catmull-Rom (tension .5) — matches THREE.CatmullRomCurve3('catmullrom',.5).
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}
function densify(loop, steps) {
  const m = loop.length, out = [];
  for (let i = 0; i < m; i++) {
    const p0 = loop[(i - 1 + m) % m], p1 = loop[i], p2 = loop[(i + 1) % m], p3 = loop[(i + 2) % m];
    for (let s = 0; s < steps; s++) out.push(catmull(p0, p1, p2, p3, s / steps));
  }
  return out;
}

// --- Track control points = the 5 pins (OSM metres), START first ---
const pinsOsm = PIN_LOOP.map(p => project(p.lat, p.lon));
const denseOsm = densify(pinsOsm, 24);

// Transform: game = (osm - centroid) * SCALE, rot 0 (north = -Z, matches game).
const SCALE = 0.55, ROT = 0;
let cx = 0, cz = 0;
denseOsm.forEach(p => { cx += p[0]; cz += p[1]; });
cx /= denseOsm.length; cz /= denseOsm.length;
function T(x, z) { return [(x - cx) * SCALE, (z - cz) * SCALE]; }

const ctrl = pinsOsm.map(p => T(p[0], p[1]));

// Dense game-space centreline (for building/road clearance checks)
const center = densify(ctrl, 16);
const ROAD_W = 16;
function distToRoad(x, z) {
  let best = Infinity;
  for (const c of center) { const d = Math.hypot(x - c[0], z - c[1]); if (d < best) best = d; }
  return best;
}

// --- Region of interest: loop bbox (OSM metres) + pad ---
const PAD = 95;
let rminx = Infinity, rminz = Infinity, rmaxx = -Infinity, rmaxz = -Infinity;
denseOsm.forEach(p => {
  rminx = Math.min(rminx, p[0]); rmaxx = Math.max(rmaxx, p[0]);
  rminz = Math.min(rminz, p[1]); rmaxz = Math.max(rmaxz, p[1]);
});
const ROI = [rminx - PAD, rminz - PAD, rmaxx + PAD, rmaxz + PAD];
const inROI = c => c[0] >= ROI[0] && c[0] <= ROI[2] && c[1] >= ROI[1] && c[1] <= ROI[3];

// --- Geometry helpers ---
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; a += x1 * z2 - x2 * z1; }
  return Math.abs(a) / 2;
}
function longestEdgeAngle(pts) {
  let best = 0, ba = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
    const L = Math.hypot(dx, dz);
    if (L > best) { best = L; ba = Math.atan2(dz, dx); }
  }
  return ba;
}

const NAMED = {
  'École Maternelle Jean Macé': 'school',
  'École élémentaire Jean Macé': 'school',
  'Synagogue': 'synagogue',
  'Bibliothèque Intercommunale Anna Langfus': 'library',
  'Résidence Anne Franck': 'res',
  'Sarcelles VIII': 'res',
  'Centre Administratif': 'civic',
};

// --- Buildings: faithful footprints in the loop frame ---
const buildings = [];
let dropped = 0;
for (const b of osm.buildings) {
  if (!inROI(b.c)) continue;
  const area = polyArea(b.pts);
  if (area < 30) continue;
  const ang = longestEdgeAngle(b.pts);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let lo = Infinity, hi = -Infinity, plo = Infinity, phi = -Infinity;
  for (const p of b.pts) {
    const along = (p[0] - b.c[0]) * ux + (p[1] - b.c[1]) * uz;
    const perp = -(p[0] - b.c[0]) * uz + (p[1] - b.c[1]) * ux;
    lo = Math.min(lo, along); hi = Math.max(hi, along);
    plo = Math.min(plo, perp); phi = Math.max(phi, perp);
  }
  const len = hi - lo, wid = phi - plo;
  const long = Math.max(len, wid), short = Math.min(len, wid);
  if (short < 4) { dropped++; continue; }                  // drop wall/fence slivers
  const aspect = long / Math.max(1, short);
  const lv = b.levels ? +b.levels : 0;
  const g = T(b.c[0], b.c[1]);
  // barre = long slab; tower = compact & tall (point block); else small block
  let kind = NAMED[b.name]
    || (long > 50 && aspect > 1.8 ? 'barre'
      : (long >= 16 && aspect < 2.2 && (lv >= 9 || long >= 24)) ? 'tower'
        : 'block');
  // height: OSM floors when known, else realistic per kind (panorama-calibrated)
  let h;
  if (lv) h = lv * 3.1;
  else if (kind === 'barre') h = 26;            // ~8-9 floors
  else if (kind === 'tower') h = 45;            // ~15 floors
  else h = 9 + Math.min(9, area / 150);         // small blocks ~3-6 floors
  if (kind === 'tower' && h < 33) h = 45;       // point towers always read tall
  if (kind === 'barre' && h < 18) h = 21;
  if (kind === 'school' || kind === 'synagogue' || kind === 'library' || kind === 'civic') h = Math.min(h, 14);
  const W2 = long * SCALE, D2 = short * SCALE;
  const rotY = -(ang) + ROT + (len >= wid ? 0 : Math.PI / 2);
  // Safety: drop only an UNNAMED footprint whose centre would sit on the track.
  if (!b.name && distToRoad(g[0], g[1]) < ROAD_W / 2 + 3) { dropped++; continue; }
  buildings.push({
    name: b.name || null, kind,
    x: +g[0].toFixed(1), z: +g[1].toFixed(1),
    w: +W2.toFixed(1), d: +D2.toFixed(1),
    rotY: +rotY.toFixed(3),
    h: +h.toFixed(1),
    scheme: (Math.abs(Math.round(b.c[0] * 0.07 + b.c[1] * 0.11)) % 4),
    levels: b.levels ? +b.levels : null,
  });
}
buildings.sort((a, b) => b.w * b.d - a.w * a.d);

function projPoly(pts) { return pts.map(p => { const g = T(p[0], p[1]); return [+g[0].toFixed(1), +g[1].toFixed(1)]; }); }
const parks = osm.parks.filter(p => p.pts && inROI(p.pts[0])).map(p => ({ name: p.name, pts: projPoly(p.pts) }));
const waterPolys = (osm.water || []).filter(p => p.pts && inROI(p.pts[0])).map(p => ({ name: p.name, pts: projPoly(p.pts) }));
const playgrounds = osm.playgrounds.filter(p => p.c && inROI(p.c)).map(p => {
  const g = T(p.c[0], p.c[1]);
  return { name: p.name, x: +g[0].toFixed(1), z: +g[1].toFixed(1), pts: p.pts ? projPoly(p.pts) : null };
});
const startPg = T(pinsOsm[0][0], pinsOsm[0][1]);

const out = {
  scale: SCALE, rot: ROT,
  transform: { centroidOsm: [+cx.toFixed(2), +cz.toFixed(2)], scale: SCALE, rot: ROT, osmCenter: CENTER },
  route: PIN_LOOP.map(p => ({ name: p.name, lat: p.lat, lon: p.lon })),
  ctrl: ctrl.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]),
  buildings, parks, water: waterPolys, playgrounds,
  startPlayground: [+startPg[0].toFixed(1), +startPg[1].toFixed(1)],
};
fs.writeFileSync(path.join(root, 'sarcelles_world.json'), JSON.stringify(out, null, 1));

console.log('Route pins:', PIN_LOOP.map(p => p.name).join(' -> '), '-> START');
console.log('track ctrl pts:', ctrl.length, '| buildings:', buildings.length, '(named ' + buildings.filter(b => b.name).length + ', dropped-on-road ' + dropped + ') | parks:', parks.length, '| playgrounds:', playgrounds.length);
console.log('centroid OSM:', [cx.toFixed(1), cz.toFixed(1)], '| scale', SCALE);
console.log('track extent x', Math.min(...ctrl.map(p => p[0])).toFixed(0), Math.max(...ctrl.map(p => p[0])).toFixed(0),
  'z', Math.min(...ctrl.map(p => p[1])).toFixed(0), Math.max(...ctrl.map(p => p[1])).toFixed(0));
console.log('wrote sarcelles_world.json');
