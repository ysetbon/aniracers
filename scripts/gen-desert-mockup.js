const fs = require('fs');
const path = require('path');

const ctrl = [
  [0, -88], [50, -90], [100, -72], [108, -28], [88, 18], [52, 58], [0, 72],
  [-52, 58], [-95, 22], [-108, -28], [-88, -68], [-42, -86]
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + ((2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2) + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + ((2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2) + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
  ];
}

const N = 260, HALF_W = 8, SCALE = 2.8, CX = 450, CY = 430;
const center = [], normals = [], tangents = [];

for (let i = 0; i < N; i++) {
  const t = i / N, seg = Math.floor(t * ctrl.length), lt = (t * ctrl.length) % 1;
  const i0 = (seg - 1 + ctrl.length) % ctrl.length;
  const i1 = seg % ctrl.length;
  const i2 = (seg + 1) % ctrl.length;
  const i3 = (seg + 2) % ctrl.length;
  center.push(catmull(ctrl[i0], ctrl[i1], ctrl[i2], ctrl[i3], lt));
}
for (let i = 0; i < N; i++) {
  const p0 = center[(i - 1 + N) % N], p2 = center[(i + 1) % N];
  const tx = p2[0] - p0[0], tz = p2[1] - p0[1], len = Math.hypot(tx, tz) || 1;
  tangents.push([tx / len, tz / len]);
  normals.push([-tz / len, tx / len]);
}

function toSvg(x, z) { return [CX + x * SCALE, CY - z * SCALE]; }
function frame(t) {
  const i = ((Math.round(t * N)) % N + N) % N;
  return { i, p: center[i], nor: normals[i], tan: tangents[i] };
}

function roadRing(i0, i1) {
  const outer = [], inner = [];
  for (let k = 0; k <= i1 - i0; k++) {
    const j = ((i0 + k) % N + N) % N;
    outer.push(toSvg(center[j][0] + normals[j][0] * HALF_W, center[j][1] + normals[j][1] * HALF_W));
    inner.push(toSvg(center[j][0] - normals[j][0] * HALF_W, center[j][1] - normals[j][1] * HALF_W));
  }
  const path = outer.map((p, idx) => (idx ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
    + ' ' + inner.slice().reverse().map(p => 'L' + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + ' Z';
  return path;
}

function fullRoadPath() {
  const outer = [], inner = [];
  for (let i = 0; i < N; i++) {
    outer.push(toSvg(center[i][0] + normals[i][0] * HALF_W, center[i][1] + normals[i][1] * HALF_W));
    inner.push(toSvg(center[i][0] - normals[i][0] * HALF_W, center[i][1] - normals[i][1] * HALF_W));
  }
  return outer.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
    + ' ' + inner.slice().reverse().map(p => 'L' + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + ' Z';
}

function cenPath() {
  return center.map((p, i) => {
    const s = toSvg(p[0], p[1]);
    return (i ? 'L' : 'M') + s[0].toFixed(1) + ',' + s[1].toFixed(1);
  }).join(' ');
}

function insidePoly(x, z) {
  let c = false;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    const a = center[i], b = center[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

const cen = center.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map(v => v / N);
const oasis = toSvg(cen[0], cen[1]);
const sphinx = frame(0.22);
const tomb = frame(0.28);
const oasisF = frame(0.48);
const start = frame(0);

const sp = toSvg(sphinx.p[0], sphinx.p[1]);
const spOff = toSvg(sphinx.p[0] + sphinx.nor[0] * 22, sphinx.p[1] + sphinx.nor[1] * 22);
const tombPath = roadRing(tomb.i - 8, tomb.i + 8);

// scattered decor
let dunes = '', pyramids = '', palms = '', obelisks = '', pickups = '';
for (let i = 0; i < 28; i++) {
  const x = (Math.random() - 0.5) * 300, z = (Math.random() - 0.5) * 250;
  const s = toSvg(x, z);
  if (Math.hypot(x - center[nearest(x, z)][0], z - center[nearest(x, z)][1]) < HALF_W + 14) continue;
  const w = 18 + Math.random() * 34, h = 8 + Math.random() * 14;
  dunes += `<ellipse cx="${s[0].toFixed(1)}" cy="${s[1].toFixed(1)}" rx="${w.toFixed(1)}" ry="${h.toFixed(1)}" fill="#c99845" opacity=".55"/>`;
}
function nearest(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i++) {
    const d = (x - center[i][0]) ** 2 + (z - center[i][1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
for (let i = 0; i < 6; i++) {
  const x = (Math.random() - 0.5) * 280, z = (Math.random() - 0.5) * 220;
  if (insidePoly(x, z)) continue;
  const s = toSvg(x, z), sz = 16 + Math.random() * 22;
  pyramids += `<polygon points="${s[0].toFixed(1)},${(s[1] - sz).toFixed(1)} ${(s[0] - sz * .9).toFixed(1)},${(s[1] + sz * .35).toFixed(1)} ${(s[0] + sz * .9).toFixed(1)},${(s[1] + sz * .35).toFixed(1)}" fill="#d4a855" stroke="#a07830" stroke-width="1"/>`;
  pyramids += `<rect x="${(s[0] - 4).toFixed(1)}" y="${(s[1] - sz - 6).toFixed(1)}" width="8" height="5" fill="#d4a017"/>`;
}
for (let i = oasisF.i - 10; i <= oasisF.i + 10; i += 2) {
  const j = ((i % N) + N) % N;
  for (const side of [1, -1]) {
    const x = center[j][0] + normals[j][0] * side * 14;
    const z = center[j][1] + normals[j][1] * side * 14;
    const s = toSvg(x, z);
    palms += `<circle cx="${s[0].toFixed(1)}" cy="${s[1].toFixed(1)}" r="7" fill="#2f8a3e" opacity=".9"/>`;
    for (let l = 0; l < 4; l++) {
      const a = l / 4 * Math.PI * 2;
      palms += `<line x1="${s[0].toFixed(1)}" y1="${s[1].toFixed(1)}" x2="${(s[0] + Math.cos(a) * 12).toFixed(1)}" y2="${(s[1] + Math.sin(a) * 12).toFixed(1)}" stroke="#3a8a3a" stroke-width="3" stroke-linecap="round"/>`;
    }
  }
}
for (const t of [0.08, 0.65, 0.82]) {
  const f = frame(t);
  const x = f.p[0] + f.nor[0] * -32, z = f.p[1] + f.nor[1] * -32;
  const s = toSvg(x, z);
  obelisks += `<rect x="${(s[0] - 4).toFixed(1)}" y="${(s[1] - 18).toFixed(1)}" width="8" height="22" fill="#c4a574"/>`;
  obelisks += `<polygon points="${s[0].toFixed(1)},${(s[1] - 22).toFixed(1)} ${(s[0] - 5).toFixed(1)},${(s[1] - 16).toFixed(1)} ${(s[0] + 5).toFixed(1)},${(s[1] - 16).toFixed(1)}" fill="#d4a017"/>`;
}
for (const [lat, col] of [[-4, '#e3342f'], [0, '#2fb344'], [4, '#2f6fe3']]) {
  const x = oasisF.p[0] + oasisF.nor[0] * lat, z = oasisF.p[1] + oasisF.nor[1] * lat;
  const s = toSvg(x, z);
  pickups += `<rect x="${(s[0] - 5).toFixed(1)}" y="${(s[1] - 5).toFixed(1)}" width="10" height="10" fill="${col}" stroke="#fff" stroke-width="1"/>`;
}

const st = toSvg(start.p[0], start.p[1]);
const markers = [
  [start, 'START / FINISH', '#e3342f'],
  [frame(0.08), 'DRAGWAY STRAIGHT', '#c0392b'],
  [sphinx, 'SPHINX SHORTCUT', '#c0392b'],
  [tomb, 'PHARAOH TOMB', '#c0392b'],
  [oasisF, 'OASIS CURVE', '#c0392b']
].map(([f, label]) => {
  const p = toSvg(f.p[0], f.p[1]);
  return `<g>
    <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="6" fill="#c0392b" stroke="#fff" stroke-width="2"/>
    <rect x="${(p[0] + 10).toFixed(1)}" y="${(p[1] - 14).toFixed(1)}" width="${label.length * 6.2 + 10}" height="16" rx="3" fill="rgba(255,255,255,.82)"/>
    <text x="${(p[0] + 15).toFixed(1)}" y="${(p[1] - 2).toFixed(1)}" font-family="Arial,sans-serif" font-size="11" fill="#3d2914" font-weight="bold">${label}</text>
  </g>`;
}).join('');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="860" viewBox="0 0 900 860">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8dba0"/><stop offset="100%" stop-color="#e8b85a"/>
    </linearGradient>
    <pattern id="sand" width="10" height="10" patternUnits="userSpaceOnUse">
      <rect width="10" height="10" fill="#d4a855"/>
      <circle cx="2" cy="4" r="1" fill="#c99845" opacity=".45"/>
      <circle cx="7" cy="8" r=".8" fill="#e0b868" opacity=".35"/>
    </pattern>
    <pattern id="cobble" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="#9a8870"/>
      <rect x="0" y="0" width="3" height="3" fill="#a89878" opacity=".7"/>
      <rect x="3" y="3" width="3" height="3" fill="#8a7860" opacity=".7"/>
    </pattern>
    <pattern id="check" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#eee"/>
      <rect width="4" height="4" fill="#111"/>
      <rect x="4" y="4" width="4" height="4" fill="#111"/>
    </pattern>
  </defs>
  <rect width="900" height="860" fill="url(#sky)"/>
  <rect x="30" y="50" width="840" height="760" rx="12" fill="url(#sand)" stroke="#b8893a" stroke-width="3"/>
  ${dunes}
  ${pyramids}
  ${obelisks}
  <ellipse cx="${oasis[0].toFixed(1)}" cy="${oasis[1].toFixed(1)}" rx="46" ry="34" fill="#4a9ec8" opacity=".78" stroke="#2f7aa0" stroke-width="2"/>
  <ellipse cx="${oasis[0].toFixed(1)}" cy="${(oasis[1] + 8).toFixed(1)}" rx="34" ry="18" fill="#e8d3a4" opacity=".55"/>
  ${palms}
  <g transform="translate(${spOff[0].toFixed(1)},${spOff[1].toFixed(1)}) rotate(${(-Math.atan2(sphinx.tan[0], sphinx.tan[1]) * 180 / Math.PI).toFixed(1)})">
    <rect x="-28" y="-12" width="56" height="24" rx="2" fill="#c4a574" stroke="#9a8460" stroke-width="1.5"/>
    <rect x="-16" y="-22" width="32" height="12" fill="#c4a574" stroke="#9a8460" stroke-width="1.5"/>
    <rect x="-8" y="-28" width="16" height="8" fill="#d4a017"/>
    <rect x="-4" y="12" width="8" height="10" fill="#e3342f" opacity=".85"/>
    <text x="-24" y="34" font-family="Arial,sans-serif" font-size="9" fill="#3d2914" font-weight="bold">shortcut wall</text>
  </g>
  <path d="${fullRoadPath()}" fill="url(#cobble)" stroke="#6b5344" stroke-width="2"/>
  <path d="${tombPath}" fill="#4a3d30" opacity=".72"/>
  <path d="${cenPath()}" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="6 5" opacity=".75"/>
  <g transform="translate(${st[0].toFixed(1)},${st[1].toFixed(1)}) rotate(${(-Math.atan2(start.tan[0], start.tan[1]) * 180 / Math.PI).toFixed(1)})">
    <rect x="-24" y="-8" width="48" height="16" fill="url(#check)" stroke="#333" stroke-width="1"/>
  </g>
  ${pickups}
  ${markers}
  <text x="450" y="34" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#3d2914" font-weight="bold">Desert Adventure Dragway — Top-Down Mockup</text>
  <text x="450" y="56" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#5c3d1e">AniRacers world layout (inspired by LEGO Racers 1999)</text>
  <g transform="translate(780,120)">
    <text x="0" y="0" font-family="Arial,sans-serif" font-size="12" fill="#3d2914" font-weight="bold">LEGEND</text>
    <rect x="0" y="10" width="14" height="14" fill="url(#cobble)"/><text x="20" y="22" font-size="11" fill="#3d2914">Cobblestone track</text>
    <rect x="0" y="32" width="14" height="14" fill="#4a3d30"/><text x="20" y="44" font-size="11" fill="#3d2914">Pharaoh tomb tunnel</text>
    <circle cx="7" cy="58" r="7" fill="#4a9ec8"/><text x="20" y="62" font-size="11" fill="#3d2914">Oasis pool</text>
    <rect x="0" y="72" width="14" height="14" fill="#c4a574"/><text x="20" y="84" font-size="11" fill="#3d2914">Sphinx + shortcut</text>
    <polygon points="7,78 0,92 14,92" fill="#d4a855"/><text x="20" y="104" font-size="11" fill="#3d2914">Pyramids / ruins</text>
    <circle cx="7" cy="118" r="6" fill="#2f8a3e"/><text x="20" y="122" font-size="11" fill="#3d2914">Palm trees</text>
  </g>
  <text x="450" y="842" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#5c3d1e" opacity=".85">North is up · Same track spline used in-game</text>
</svg>`;

const outDir = path.join(__dirname, '..', 'maps');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'desert-adventure-dragway-mockup.svg'), svg);

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Desert Adventure Dragway Mockup</title>
<style>body{margin:0;background:#1a1208;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:Arial,sans-serif;color:#f0d090}
img{max-width:96vw;box-shadow:0 12px 40px rgba(0,0,0,.55);border:3px solid #b8893a;border-radius:8px}
p{opacity:.85;font-size:14px}</style></head>
<body>
<h1 style="font-size:20px;margin-bottom:8px">Desert Adventure Dragway — Top-Down Mockup</h1>
<p>How the new AniRacers desert world should look from above</p>
<img src="desert-adventure-dragway-mockup.svg" width="900" alt="Desert Adventure Dragway top-down mockup">
</body></html>`;
fs.writeFileSync(path.join(outDir, 'desert-adventure-dragway-mockup.html'), html);

console.log('Wrote maps/desert-adventure-dragway-mockup.svg');
console.log('Wrote maps/desert-adventure-dragway-mockup.html');
