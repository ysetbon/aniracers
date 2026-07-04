// Detect tree canopies in a georeferenced aerial (fetch-aerial-aoi.mjs output) and emit
// world-XZ tree POINTS for the bake. Lightweight (no ML): excess-green segmentation +
// connected-component blobs, rejecting blobs that fall on a building footprint (green roofs
// / pools) so we don't sprout phantom rooftop trees. Species/appearance is NOT decided here
// (aerial can't read it reliably at 0.5 m/px) — a size heuristic tags each point and the SV
// pass refines it later. This is the "aerial = WHERE" half of the pipeline.
//
// Run: node scripts/detect-trees.mjs --world=netanya --tag=tjunction
//   [--exg=28] [--gmax=195] [--minA=10] [--maxA=1200] [--debug]
import fs from 'fs'; import path from 'path';
import sharp from 'sharp';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const tag = arg('tag', 'tjunction');
const EXG = +arg('exg', '28');          // excess-green threshold (2G-R-B)
const GMAX = +arg('gmax', '195');       // reject very bright green (sunlit lawn, not canopy)
const MINA = +arg('minA', '10');        // min blob area px (0.5 m/px: ~2.2m crown)
const MAXA = +arg('maxA', '1400');      // split-guard: huge blobs are contiguous canopy runs
const debug = argv.includes('--debug');

const aerDir = path.join(W.paths.dir, 'aerial');
const tf = JSON.parse(fs.readFileSync(path.join(aerDir, tag + '-transform.json'), 'utf8'));
const { W: IW, H: IH } = tf.image;
const { xWest, xEast, zNorth, zSouth } = tf.world;
const pxToWorld = (px, py) => [xWest + (px + 0.5) / IW * (xEast - xWest),
                               zNorth + (py + 0.5) / IH * (zSouth - zNorth)];
const mpp = (tf.mPerPxX + tf.mPerPxZ) / 2;

// building footprints (world XZ) that overlap the AOI — reject canopy blobs whose centroid
// sits inside one (green/tiled roofs and pools read as green from above).
const BLD = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const foots = BLD.map(b => b.foot).filter(f => f && f.length >= 3)
  .filter(f => f.some(([x, z]) => x >= xWest - 6 && x <= xEast + 6 && z >= zNorth - 6 && z <= zSouth + 6));
function inFoot(x, z) {
  for (const f of foots) { let inside = false;
    for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
      const [xi, zi] = f[i], [xj, zj] = f[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return true; }
  return false;
}

const { data, info } = await sharp(path.join(aerDir, tag + '.jpg')).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels, N = IW * IH;
const mask = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * ch], g = data[i * ch + 1], b = data[i * ch + 2];
  const exg = 2 * g - r - b;
  if (exg > EXG && g > 45 && g < GMAX && g >= r && g >= b) mask[i] = 1;
}

// connected components (4-neighbour flood fill)
const seen = new Uint8Array(N), stack = [], trees = [];
const sizes = [];
for (let s = 0; s < N; s++) {
  if (!mask[s] || seen[s]) continue;
  stack.length = 0; stack.push(s); seen[s] = 1;
  let area = 0, sx = 0, sy = 0;
  while (stack.length) {
    const p = stack.pop(); area++; const px = p % IW, py = (p / IW) | 0; sx += px; sy += py;
    const nb = [p - 1, p + 1, p - IW, p + IW];
    if (px === 0) nb[0] = -1; if (px === IW - 1) nb[1] = -1;
    for (const q of nb) { if (q < 0 || q >= N || seen[q] || !mask[q]) continue; seen[q] = 1; stack.push(q); }
  }
  if (area < MINA) continue;
  const cx = sx / area, cy = sy / area;
  const [wx, wz] = pxToWorld(cx, cy);
  if (inFoot(wx, wz)) continue;                       // canopy blob on a roof -> skip
  const rPx = Math.sqrt(area / Math.PI), rM = rPx * mpp;
  sizes.push(area);
  // big contiguous runs = hedge/garden mass or merged canopies: cap the radius, flag it
  const clipped = area > MAXA;
  trees.push({ x: +wx.toFixed(1), z: +wz.toFixed(1), r: +Math.min(rM, 6).toFixed(1),
    area, clipped, cx: +cx.toFixed(1), cy: +cy.toFixed(1) });
}

// size heuristic for a provisional species tag (SV pass overrides). r in metres.
for (const t of trees) {
  t.species = t.r >= 3.2 ? 'canopy-large' : t.r >= 1.8 ? 'canopy-med' : 'shrub';
}
trees.sort((a, b) => b.area - a.area);
const outPath = path.join(aerDir, tag + '-trees.json');
fs.writeFileSync(outPath, JSON.stringify({ world: tf.world, mpp: +mpp.toFixed(3), count: trees.length,
  params: { EXG, GMAX, MINA, MAXA }, trees }, null, 1));
console.log(`[trees] ${trees.length} canopy points (largest area ${sizes.length ? Math.max(...sizes) : 0}px, `
  + `median ${sizes.length ? sizes.sort((a, b) => a - b)[sizes.length >> 1] : 0}px) -> ${path.relative(ROOT, outPath)}`);

if (debug) {
  // draw magenta rings at detected centroids over a 3x aerial for visual QA
  const S = 3, dbg = await sharp(path.join(aerDir, tag + '.jpg')).resize(IW * S, IH * S, { kernel: 'nearest' }).raw().toBuffer();
  const put = (x, y) => { if (x < 0 || y < 0 || x >= IW * S || y >= IH * S) return; const i = (y * IW * S + x) * 3; dbg[i] = 255; dbg[i + 1] = 0; dbg[i + 2] = 255; };
  for (const t of trees) { const cx = t.cx * S, cy = t.cy * S, rr = Math.max(3, t.r / mpp * S);
    for (let a = 0; a < 360; a += 6) { put(Math.round(cx + rr * Math.cos(a * Math.PI / 180)), Math.round(cy + rr * Math.sin(a * Math.PI / 180))); } }
  const dpath = path.join(aerDir, tag + '-trees-debug.png');
  await sharp(dbg, { raw: { width: IW * S, height: IH * S, channels: 3 } }).png().toFile(dpath);
  console.log(`[trees] debug overlay -> ${path.relative(ROOT, dpath)}`);
}
