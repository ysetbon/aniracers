// Fetch georeferenced top-down aerial imagery for an AOI expressed in GAME world-XZ metres,
// so a tree-detector's canopy centroids drop straight into the bake. Source: Esri World
// Imagery export (no API key, ~30-50cm in metros) — used for tree POSITIONS only, not
// shipped geometry. (World-parameterized; the older fetch-aerial.mjs is Sarcelles-specific.)
//
// Why the transform is trivial: in this project's MetricMapProjection (world-config.mjs),
// world x depends only on longitude and world z only on latitude, so an axis-aligned
// world-XZ rectangle maps to an axis-aligned lon/lat rectangle EXACTLY. The Esri 4326 export
// frames the image linearly in lon/lat, so pixel<->world is pure linear.
//
// Run: node scripts/fetch-aerial-aoi.mjs --world=netanya --aoi=60,200,-435,-230 [--px=1800] [--tag=tjunction]
//   --aoi = xWest,xEast,zNorth,zSouth in game world metres (zNorth = most negative = north).
import fs from 'fs'; import path from 'path';
import { resolveWorld, readArea, projection, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const proj = projection(readArea(W));
const BLD = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8'));
const PCX = BLD.PCX || 0, PCZ = BLD.PCZ || 0;

const tag = arg('tag', 'tjunction');
const [xWest, xEast, zNorth, zSouth] = (arg('aoi', '60,200,-435,-230')).split(',').map(Number);
const worldW = xEast - xWest, worldH = zSouth - zNorth;              // metres (both > 0)

// world corner -> lat/lon (game -> projection is +PC, here ~0). x->lon, z->lat independently.
const [latN, lonW] = proj.fromXZ(xWest + PCX, zNorth + PCZ);         // NW corner
const [latS, lonE] = proj.fromXZ(xEast + PCX, zSouth + PCZ);         // SE corner
const minLon = Math.min(lonW, lonE), maxLon = Math.max(lonW, lonE);
const minLat = Math.min(latN, latS), maxLat = Math.max(latN, latS);
const bbox = encodeURIComponent(`${minLon},${minLat},${maxLon},${maxLat}`);

const outDir = arg('out', path.join(W.paths.dir, 'aerial'));
fs.mkdirSync(outDir, { recursive: true });
const pngPath = path.join(outDir, tag + '.jpg');
const tfPath = path.join(outDir, tag + '-transform.json');

// Esri World Imagery over Netanya tops out ~0.5 m/px — finer requests 500. Target --mpp
// (default 0.5) and auto-retry coarser if the service rejects the resolution.
console.log(`[aerial] AOI world x[${xWest},${xEast}] z[${zNorth},${zSouth}] = ${worldW}x${worldH}m`);
let mpp = parseFloat(arg('mpp', '0.5')), Wpx, H, buf = null;
for (let tries = 0; tries < 5 && !buf; tries++, mpp *= 1.35) {
  Wpx = Math.max(16, Math.round(worldW / mpp)); H = Math.max(16, Math.round(worldH / mpp));
  const size = encodeURIComponent(`${Wpx},${H}`);
  const url = `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export`
    + `?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${size}&format=jpg&f=image`;
  const res = await fetch(url);
  const b = Buffer.from(await res.arrayBuffer());
  if (res.ok && b.slice(0, 3).toString('hex') === 'ffd8ff') { buf = b; break; }   // JPEG SOI
  console.log(`  ${Wpx}x${H} (${mpp.toFixed(2)} m/px) rejected (HTTP ${res.status}) — coarsening`);
}
if (!buf) { console.error('[aerial] all resolutions rejected by Esri'); process.exit(1); }
fs.writeFileSync(pngPath, buf);

// px -> world, pure linear. py=0 (top) = zNorth (most north); px=0 (left) = xWest.
const tf = { world: { xWest, xEast, zNorth, zSouth }, image: { W: Wpx, H },
  lonlat: { minLon, maxLon, minLat, maxLat }, mPerPxX: worldW / Wpx, mPerPxZ: worldH / H,
  map: 'worldX = xWest + (px+0.5)/W*(xEast-xWest); worldZ = zNorth + (py+0.5)/H*(zSouth-zNorth)' };
fs.writeFileSync(tfPath, JSON.stringify(tf, null, 2));
console.log(`[aerial] wrote ${path.relative(ROOT, pngPath)} ${Wpx}x${H} (${(worldW / Wpx).toFixed(2)} m/px, ${(buf.length / 1024).toFixed(0)} KB) + ${path.basename(tfPath)}`);
