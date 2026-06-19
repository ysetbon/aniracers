// Make a "base" OSM (streets/parks/trees, NO buildings) by stripping building/roof/
// height tags, so OSM2World renders the ground without buildings — we instance our
// own 3D house models on top. Keeps the injected <bounds>.
// Run: node scripts/strip-buildings-osm.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT,'OSM2World/_aniracers_test/mishkenot.osm');
const DST = path.join(ROOT,'OSM2World/_aniracers_test/mishkenot_base.osm');
let o = fs.readFileSync(SRC,'utf8');
const before = (o.match(/k="building"/g)||[]).length;
o = o.replace(/^[ \t]*<tag k="(building|building:[^"]*|roof:[^"]*|height|min_height)"[^>]*\/>\r?\n/gm,'');
fs.writeFileSync(DST,o);
console.log('stripped building tags ('+before+' building ways) -> mishkenot_base.osm; <bounds> '+(/<bounds/.test(o)?'kept':'MISSING'));
