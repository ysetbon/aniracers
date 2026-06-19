// Make a "base" OSM (terrain only: parks/forest/water/landuse, NO buildings and NO roads)
// by stripping building + highway/path tags, so OSM2World renders just the ground. We
// instance our own 3D houses (house-factory) and styled roads (road-factory) on top.
// Keeps the injected <bounds>.
// Run: node scripts/strip-buildings-osm.mjs --world=<name>
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
if(!fs.existsSync(W.paths.osm)){ console.error('missing '+path.relative(ROOT,W.paths.osm)+' — run: node scripts/fetch-osm.mjs --world='+W.name); process.exit(1); }
let o = fs.readFileSync(W.paths.osm,'utf8');
const nBld = (o.match(/k="building"/g)||[]).length, nHw = (o.match(/k="highway"/g)||[]).length;
o = o.replace(/^[ \t]*<tag k="(building|building:[^"]*|roof:[^"]*|height|min_height|highway|footway|sidewalk|cycleway|crossing|lanes|junction|area:highway)"[^>]*\/>\r?\n/gm,'');
fs.writeFileSync(W.paths.osmBase,o);
console.log('['+W.name+'] stripped '+nBld+' building + '+nHw+' highway tags -> '+path.relative(ROOT,W.paths.osmBase)+'; <bounds> '+(/<bounds/.test(o)?'kept':'MISSING'));
