// Convert a Bambu-Studio 3MF city model into a compact, web-ready mesh the game
// loads directly into THREE.BufferGeometry (no glTF loader needed).
//
// The 3MF groups geometry into leaf <object>s; each maps (via model_settings.config
// part id -> extruder) to one of N filament colours (project_settings.config). We
// merge all leaf meshes that share an extruder into ONE part, so the game gets a
// handful of meshes (ground / roads / buildings / grass / trees / water ...) it can
// colour individually. Coordinates are kept in source mm (Z-up); the game re-centres
// and rescales. Indices are rebased per-part (0-based within the part).
//
// Usage (extract the 3mf first, then run):
//   unzip -o maps/mishkenot_zvulun/Full.3mf -d /tmp/full_extract
//   node scripts/convert-3mf-world.mjs /tmp/full_extract assets/mishkenot
import fs from 'fs';
import path from 'path';

const [, , EXTRACT_DIR, OUT_DIR] = process.argv;
if (!EXTRACT_DIR || !OUT_DIR) {
  console.error('usage: node convert-3mf-world.mjs <extractedDir> <outDir>');
  process.exit(1);
}
const modelPath = path.join(EXTRACT_DIR, '3D', 'Objects', 'object-1.model');
const settingsPath = path.join(EXTRACT_DIR, 'Metadata', 'model_settings.config');
const projPath = path.join(EXTRACT_DIR, 'Metadata', 'project_settings.config');

// --- role + display hints per filament colour (by extruder index, 1-based) ---
// Derived from the Mishkenot Zvulun export palette; falls back gracefully.
const ROLE_BY_COLOUR = {
  '#ffffff': 'ground', '#4ade80': 'lawn', '#9ca3af': 'sidewalk', '#262626': 'road',
  '#b8b8b8': 'building', '#0fe300': 'grass', '#7fb35d': 'tree', '#3399ff': 'water',
};

const proj = JSON.parse(fs.readFileSync(projPath, 'utf8'));
const colours = proj.filament_colour || [];

// part id -> extruder (1-based)
const settings = fs.readFileSync(settingsPath, 'utf8');
const p2e = {};
let m;
const pre = /<part id="(\d+)"[\s\S]*?key="extruder" value="(\d+)"/g;
while ((m = pre.exec(settings))) p2e[+m[1]] = +m[2];

// --- collect geometry grouped by extruder ---
const xml = fs.readFileSync(modelPath, 'utf8');
const starts = [...xml.matchAll(/<object\s+id="(\d+)"/g)];
const groups = new Map(); // ext -> { pos:[], idx:[] }
const ensure = e => {
  if (!groups.has(e)) groups.set(e, { pos: [], idx: [] });
  return groups.get(e);
};

for (let k = 0; k < starts.length; k++) {
  const id = +starts[k][1];
  const s = starts[k].index;
  const e = k + 1 < starts.length ? starts[k + 1].index : xml.length;
  const blk = xml.slice(s, e);
  const ext = p2e[id] ?? 0;
  const g = ensure(ext);
  const vbase = g.pos.length / 3; // rebase this object's indices onto the group
  let t;
  const vre = /<vertex\s+x="(-?[\d.eE+]*)"\s+y="(-?[\d.eE+]*)"\s+z="(-?[\d.eE+]*)"/g;
  while ((t = vre.exec(blk))) g.pos.push(+t[1], +t[2], +t[3]);
  const tre = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
  while ((t = tre.exec(blk))) g.idx.push(+t[1] + vbase, +t[2] + vbase, +t[3] + vbase);
}

// --- lay out one binary: all positions (f32), then all indices (u32) ---
const exts = [...groups.keys()].sort((a, b) => a - b);
let totalV = 0, totalI = 0;
for (const e of exts) { totalV += groups.get(e).pos.length / 3; totalI += groups.get(e).idx.length; }
const posBytes = totalV * 3 * 4;
const idxBytes = totalI * 4;
const positions = new Float32Array(totalV * 3);
const indices = new Uint32Array(totalI);

const parts = [];
let vCursor = 0, iCursor = 0; // in vertices / index-elements
const GMIN = [Infinity, Infinity, Infinity], GMAX = [-Infinity, -Infinity, -Infinity];
for (const e of exts) {
  const g = groups.get(e);
  const vCount = g.pos.length / 3, iCount = g.idx.length;
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = g.pos[i + a];
      if (v < bmin[a]) bmin[a] = v; if (v > bmax[a]) bmax[a] = v;
      if (v < GMIN[a]) GMIN[a] = v; if (v > GMAX[a]) GMAX[a] = v;
    }
  }
  positions.set(g.pos, vCursor * 3);
  indices.set(g.idx, iCursor); // 0-based within the part
  const colour = colours[e - 1] || '#cccccc';
  parts.push({
    ext: e, role: ROLE_BY_COLOUR[colour?.toLowerCase()] || ('ext' + e), color: colour,
    vStart: vCursor, vCount, iStart: iCursor, iCount,
    tris: iCount / 3,
    bbox: { min: bmin.map(n => +n.toFixed(3)), max: bmax.map(n => +n.toFixed(3)) },
  });
  vCursor += vCount; iCursor += iCount;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const bin = Buffer.alloc(posBytes + idxBytes);
Buffer.from(positions.buffer, 0, posBytes).copy(bin, 0);
Buffer.from(indices.buffer, 0, idxBytes).copy(bin, posBytes);
fs.writeFileSync(path.join(OUT_DIR, 'world.bin'), bin);

const manifest = {
  source: 'maps/mishkenot_zvulun/Full.3mf',
  unit: 'mm', axis: 'Z-up', note: 'positions in source mm; game re-centres via bbox and swaps Z(up)->Y',
  bbox: { min: GMIN.map(n => +n.toFixed(3)), max: GMAX.map(n => +n.toFixed(3)) },
  size: { x: +(GMAX[0] - GMIN[0]).toFixed(2), y: +(GMAX[1] - GMIN[1]).toFixed(2), z: +(GMAX[2] - GMIN[2]).toFixed(2) },
  bin: { positions: { type: 'f32', byteOffset: 0, byteLength: posBytes, count: totalV },
         indices: { type: 'u32', byteOffset: posBytes, byteLength: idxBytes, count: totalI } },
  parts,
};
fs.writeFileSync(path.join(OUT_DIR, 'world.json'), JSON.stringify(manifest, null, 1));

console.log('parts:', parts.length, '| total tris:', (totalI / 3).toLocaleString(), '| verts:', totalV.toLocaleString());
for (const p of parts) console.log(`  ${p.role.padEnd(9)} ${p.color}  ${String(p.tris).padStart(7)} tris  z ${p.bbox.min[2]}..${p.bbox.max[2]}`);
console.log('world size mm:', manifest.size, '\nwrote', path.join(OUT_DIR, 'world.bin'), `(${(bin.length / 1048576).toFixed(1)} MB)`, 'and world.json');
