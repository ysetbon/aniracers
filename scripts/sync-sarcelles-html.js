// Embed sarcelles_world.json constants into index.html (SARCELLES_CTRL, SAR_BUILDINGS, etc.)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const world = JSON.parse(fs.readFileSync(path.join(root, 'sarcelles_world.json'), 'utf8'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const ctrlStr = 'const SARCELLES_CTRL = [\n' +
  world.ctrl.map(p => `  [${p[0]},${p[1]}]`).join(',\n') + '\n];';

const bldStr = 'const SAR_BUILDINGS=[\n' +
  world.buildings.map(b => {
    let s = ` {k:'${b.kind}',x:${b.x},z:${b.z},w:${b.w},d:${b.d},r:${b.rotY},h:${b.h}`;
    if (b.scheme != null) s += `,s:${b.scheme}`;
    if (b.name) s += `,n:'${b.name.replace(/'/g, "\\'")}'`;
    return s + '}';
  }).join(',\n') + '\n];';

const parkStr = 'const SAR_PARKS=[\n' +
  world.parks.map(p => ' [' + p.pts.map(q => `[${q[0]},${q[1]}]`).join(',') + ']').join(',\n') + '\n];';

const playStr = `const SAR_PLAY=[${world.startPlayground[0]},${world.startPlayground[1]}]; // Aire de jeux (start/finish)`;

function replaceBetween(src, startMarker, endMarker, replacement) {
  const i = src.indexOf(startMarker);
  const j = src.indexOf(endMarker, i + startMarker.length);
  if (i < 0 || j < 0) throw new Error('Marker not found: ' + startMarker);
  return src.slice(0, i) + replacement + src.slice(j);
}

html = replaceBetween(html, 'const SARCELLES_CTRL = [', 'let ctrl, curve;', ctrlStr + '\n');
html = replaceBetween(html, 'const SAR_BUILDINGS=[', 'const SAR_PARKS=[', bldStr + '\n');
html = replaceBetween(html, 'const SAR_PARKS=[', 'function buildSarcellesWorld', parkStr + '\n' + playStr + '\n\n');

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Synced index.html:', world.ctrl.length, 'ctrl pts,', world.buildings.length, 'buildings,', world.parks.length, 'parks');
