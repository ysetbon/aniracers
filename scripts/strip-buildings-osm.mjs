// Make a "base" OSM (streets/parks/trees, NO buildings) by stripping building/roof/
// height tags, so OSM2World renders the ground without buildings — we instance our
// own 3D house models on top. Keeps the injected <bounds>.
// Run: node scripts/strip-buildings-osm.mjs --world=<name>
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
if(!fs.existsSync(W.paths.osm)){ console.error('missing '+path.relative(ROOT,W.paths.osm)+' — run: node scripts/fetch-osm.mjs --world='+W.name); process.exit(1); }
let o = fs.readFileSync(W.paths.osm,'utf8');
const before = (o.match(/k="building"/g)||[]).length;
o = o.replace(/^[ \t]*<tag k="(building|building:[^"]*|roof:[^"]*|height|min_height)"[^>]*\/>\r?\n/gm,'');
fs.writeFileSync(W.paths.osmBase,o);
console.log('['+W.name+'] stripped building tags ('+before+' building ways) -> '+path.relative(ROOT,W.paths.osmBase)+'; <bounds> '+(/<bounds/.test(o)?'kept':'MISSING'));
