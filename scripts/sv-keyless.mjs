// KEYLESS Street View fetcher — uses the same public endpoints the Google Maps web client
// calls (no API key): SingleImageSearch RPC to find panos, streetviewpixels tiles to get the
// equirect image, then renders perspective views (heading/fov) locally with sharp.
// Unofficial endpoints: fine for development harvesting; the keyed scripts remain the
// "supported" path (see harvest-views.mjs).
//
//   node scripts/sv-keyless.mjs --world=<name> --at=<lat>,<lon> [--headings=h1,h2] [--tag=x]
//   node scripts/sv-keyless.mjs --world=<name> --road=<id>[,<id>...] [--step=20] [--buildings]
//
// Output: maps/<world>/views/keyless/*.jpg + manifest keyless.json (appended/updated).
import fs from 'fs'; import path from 'path';
import sharp from 'sharp';
import { resolveWorld, readArea, projection, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const OUT = path.join(W.paths.views, 'keyless'); fs.mkdirSync(OUT, { recursive: true });
const MANIFEST = path.join(OUT, 'keyless.json');
const proj = projection(readArea(W));

const R = Math.PI / 180;
function bearing(la1, lo1, la2, lo2) {
  const y = Math.sin((lo2 - lo1) * R) * Math.cos(la2 * R);
  const x = Math.cos(la1 * R) * Math.sin(la2 * R) - Math.sin(la1 * R) * Math.cos(la2 * R) * Math.cos((lo2 - lo1) * R);
  return (Math.atan2(y, x) / R + 360) % 360; }
function haversine(la1, lo1, la2, lo2) {
  const dla = (la2 - la1) * R, dlo = (lo2 - lo1) * R;
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin(dlo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a)); }

// ---- pano search (keyless RPC used by the Maps web client) ----
export async function svFind(lat, lon, radius = 50) {
  const payload = [['apiv3', null, null, null, 'US', null, null, null, null, null, [[0]]],
    [[null, null, lat, lon], radius],
    [null, ['en', 'US'], null, null, null, null, null, null, [2], null, [[[2, true, 2]]]],
    [[2, 6]]];
  const r = await fetch('https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch',
    { method: 'POST', headers: { 'Content-Type': 'application/json+protobuf' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error('SingleImageSearch HTTP ' + r.status);
  const m = await r.json();
  const id = m?.[1]?.[1]?.[1];
  if (!id) return null;                       // no pano within radius
  const loc = m[1][5][0][1];                  // [[null,null,lat,lon],[elev...],[yaw,pitch,roll]]
  return { panoId: id, lat: loc[0][2], lon: loc[0][3], yaw: loc[2][0], pitch: loc[2][1], roll: loc[2][2] };
}

// ---- tiles -> equirectangular buffer ----
const TILE = 'https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=apiv3';
async function tile(panoId, z, x, y) {
  const r = await fetch(`${TILE}&panoid=${panoId}&zoom=${z}&x=${x}&y=${y}`);
  if (!r.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  return b.length > 500 ? b : null;
}
export async function svEquirect(panoId, zoom = 3) {
  // probe the grid size (varies by pano generation), then stitch
  let cols = 0, rows = 0;
  while (cols < 2 ** zoom + 2 && await tile(panoId, zoom, cols, 0)) cols++;
  while (rows < 2 ** zoom + 2 && await tile(panoId, zoom, 0, rows)) rows++;
  if (!cols || !rows) throw new Error('no tiles for ' + panoId);
  const jobs = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) jobs.push([x, y]);
  const tiles = [];
  for (let i = 0; i < jobs.length; i += 8)
    tiles.push(...await Promise.all(jobs.slice(i, i + 8).map(([x, y]) => tile(panoId, zoom, x, y))));
  const composite = jobs.map(([x, y], i) => tiles[i] && ({ input: tiles[i], left: x * 512, top: y * 512 })).filter(Boolean);
  const canvas = sharp({ create: { width: cols * 512, height: rows * 512, channels: 3, background: '#000' } })
    .composite(composite);
  // pano content sits top-left in the tile canvas; the last tile row/col is padded with
  // black (content size depends on pano generation, e.g. 3328x1664 at zoom 3). Detect the
  // true content bounds by scanning for the black margins.
  const { data, info } = await canvas.raw().toBuffer({ resolveWithObject: true });
  const W2 = info.width, H2 = info.height, C = info.channels;
  const colDark = x => { for (let y = 0; y < H2; y += 7) { const o = (x + y * W2) * C; if (data[o] > 12 || data[o + 1] > 12 || data[o + 2] > 12) return false; } return true; };
  const rowDark = y => { for (let x = 0; x < W2; x += 7) { const o = (x + y * W2) * C; if (data[o] > 12 || data[o + 1] > 12 || data[o + 2] > 12) return false; } return true; };
  let cw = W2; while (cw > 512 && colDark(cw - 1)) cw--;
  let ch = H2; while (ch > 512 && rowDark(ch - 1)) ch--;
  // snap to exact 2:1 (content is equirectangular by construction)
  if (Math.abs(cw - 2 * ch) > 8) { cw = Math.min(cw, 2 * ch); ch = Math.round(cw / 2); }
  return sharp(data, { raw: { width: W2, height: H2, channels: C } })
    .extract({ left: 0, top: 0, width: cw, height: Math.min(ch, H2) })
    .jpeg({ quality: 92 }).toBuffer();
}

// ---- equirect -> perspective view (gnomonic), bilinear sampling ----
export async function svView(equirectBuf, panoYaw, headingDeg, { fov = 72, width = 1024, height = 768, pitchDeg = 4 } = {}) {
  const { data, info } = await sharp(equirectBuf).raw().toBuffer({ resolveWithObject: true });
  const Wq = info.width, Hq = info.height, C = info.channels;
  const out = Buffer.alloc(width * height * 3);
  const yawOff = (headingDeg - panoYaw) * R;          // 0 = pano image centre
  const pr = -pitchDeg * R;                            // camera pitched slightly up
  const f = 0.5 * width / Math.tan(fov * R / 2);
  const cosP = Math.cos(pr), sinP = Math.sin(pr);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let x = (i - width / 2 + 0.5) / f, y = (j - height / 2 + 0.5) / f, z = 1;
      // pitch about X axis, then yaw about Y axis
      let y2 = y * cosP - z * sinP, z2 = y * sinP + z * cosP;
      const lonr = Math.atan2(x, z2) + yawOff;
      const latr = Math.atan2(-y2, Math.hypot(x, z2));
      let u = ((lonr / (2 * Math.PI)) + 0.5) * Wq;    // pano centre column = yawOff 0
      let v = (0.5 - latr / Math.PI) * Hq;
      u = ((u % Wq) + Wq) % Wq; v = Math.max(0, Math.min(Hq - 1.001, v));
      const u0 = Math.floor(u), v0 = Math.floor(v), u1 = (u0 + 1) % Wq, v1 = Math.min(v0 + 1, Hq - 1);
      const fu = u - u0, fv = v - v0, o = (i + j * width) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = data[(u0 + v0 * Wq) * C + c], p10 = data[(u1 + v0 * Wq) * C + c];
        const p01 = data[(u0 + v1 * Wq) * C + c], p11 = data[(u1 + v1 * Wq) * C + c];
        out[o + c] = p00 * (1 - fu) * (1 - fv) + p10 * fu * (1 - fv) + p01 * (1 - fu) * fv + p11 * fu * fv;
      }
    }
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

// ---------------- CLI ----------------
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { shots: [] };
const flushManifest = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const equiCache = new Map();
async function equirectCached(panoId) {
  if (!equiCache.has(panoId)) {
    equiCache.set(panoId, await svEquirect(panoId, 3));
    // cap memory on long multi-road runs
    if (equiCache.size > 40) equiCache.delete(equiCache.keys().next().value);
  }
  return equiCache.get(panoId);
}
async function shoot(pano, headingDeg, file, opts = {}) {
  const abs = path.join(OUT, file);
  const rec = { file, pano_id: pano.panoId, lat: pano.lat, lon: pano.lon, heading: +headingDeg.toFixed(1), ...opts };
  if (fs.existsSync(abs) && fs.statSync(abs).size > 2000) {
    // file survived an earlier (possibly crashed) run — make sure the manifest knows it
    if (!manifest.shots.some(s => s.file === file)) manifest.shots.push(rec);
    return false;
  }
  fs.writeFileSync(abs, await svView(await equirectCached(pano.panoId), pano.yaw, headingDeg, opts));
  manifest.shots = manifest.shots.filter(s => s.file !== file);
  manifest.shots.push(rec);
  return true;
}

if (arg('at')) {
  const [lat, lon] = arg('at').split(',').map(Number);
  const tag = arg('tag', 'at');
  const pano = await svFind(lat, lon, +arg('radius', 60));
  if (!pano) { console.error('no pano near ' + lat + ',' + lon); process.exit(1); }
  console.log(`pano ${pano.panoId} @ ${pano.lat.toFixed(6)},${pano.lon.toFixed(6)} yaw ${pano.yaw.toFixed(1)}`);
  const headings = arg('headings') ? arg('headings').split(',').map(Number)
    : [pano.yaw, (pano.yaw + 90) % 360, (pano.yaw + 180) % 360, (pano.yaw + 270) % 360];
  for (let k = 0; k < headings.length; k++) {
    const f = `${tag}_${k}.jpg`;
    await shoot(pano, headings[k], f) && console.log('  wrote ' + f + ' (heading ' + headings[k].toFixed(0) + ')');
  }
} else if (arg('road')) {
  const ids = arg('road').split(',');
  const step = +arg('step', 20);
  const roads = JSON.parse(fs.readFileSync(path.join(W.paths.dir, 'roads.json'), 'utf8')).roads
    .filter(r => ids.includes(String(r.id)));
  if (!roads.length) { console.error('no matching roads'); process.exit(1); }
  const blds = argv.includes('--buildings')
    ? JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings : [];
  const seen = new Set(); let n = 0;
  for (const rd of roads) {
    // arc-length walk of the XZ polyline
    const pts = rd.pts; const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    const total = segs.reduce((a, b) => a + b, 0);
    for (let s = step / 2, k = 0; s < total; s += step, k++) {
      let acc = 0, i = 0; while (i < segs.length - 1 && acc + segs[i] < s) acc += segs[i++];
      const t = segs[i] ? (s - acc) / segs[i] : 0;
      const x = pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), z = pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
      const [lat, lon] = proj.fromXZ(x, z);
      const pano = await svFind(lat, lon, 30).catch(() => null);
      if (!pano || seen.has(pano.panoId)) continue;
      seen.add(pano.panoId);
      try {
        const [x2, z2] = [pts[i + 1][0], pts[i + 1][1]];
        const [lat2, lon2] = proj.fromXZ(x2, z2);
        const along = bearing(pano.lat, pano.lon, lat2, lon2);
        console.log(`road ${rd.id} k${k}: pano ${pano.panoId} (yaw ${pano.yaw.toFixed(0)})`);
        for (const [tag, hd, fov] of [['a', along, 80], ['l', (along + 270) % 360, 72], ['r', (along + 90) % 360, 72]])
          await shoot(pano, hd, `road_${rd.id}_${k}_${tag}.jpg`, { fov }) && n++;
        // aim a dedicated shot at each nearby building
        for (const b of blds) {
          const d = haversine(pano.lat, pano.lon, b.clat, b.clon);
          if (d > 45) continue;
          const hd = bearing(pano.lat, pano.lon, b.clat, b.clon);
          const fov = Math.max(50, Math.min(85, 30 + d * 0.9));
          await shoot(pano, hd, `bld_${b.id}_p${pano.panoId.slice(0, 6)}.jpg`, { fov, bld: b.id, dist: +d.toFixed(1) }) && n++;
        }
      } catch (e) {
        // one bad pano (missing tiles, transient network) must not kill a 55-road run
        console.log(`  skip pano ${pano.panoId}: ${e.message}`);
      }
    }
    flushManifest();
  }
  console.log(`wrote ${n} shots -> ${path.relative(ROOT, OUT)}/`);
} else {
  console.log('usage: --at=lat,lon [--headings=..] | --road=id[,id] [--step=20] [--buildings]');
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
