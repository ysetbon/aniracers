// Download the OSM data for a world's polygon from Overpass and write <stem>.osm with an
// injected <bounds> element so OSM2World's projection origin is deterministic (= polygon
// bbox centre). Uses `way(bbox)` + `>;` over ONLY ways (no relations) to avoid the
// city-wide "comet-tail" geometry that relation members drag in.
//
// Run:  node scripts/fetch-osm.mjs --world=<name>
// Prereq: maps/<name>/area.json (draw it with area-picker.mjs).
import fs from 'fs'; import path from 'path';
import { resolveWorld, readArea } from './world-config.mjs';

const W = resolveWorld(process.argv.slice(2));
const area = readArea(W);

// polygon bbox (+ symmetric margin so the <bounds> CENTRE stays the polygon-bbox centre,
// which is what extract-buildings / build-world-from-specs use as the projection origin)
const lats = area.polygon.map(p=>p[0]), lons = area.polygon.map(p=>p[1]);
const m = W.overpassMargin;
const minlat=Math.min(...lats)-m, maxlat=Math.max(...lats)+m;
const minlon=Math.min(...lons)-m, maxlon=Math.max(...lons)+m;
const BBOX = `${minlat},${minlon},${maxlat},${maxlon}`;

const FEATURES = ['highway','building','leisure','natural','landuse','amenity','barrier','waterway'];
const query =
`[out:xml][timeout:180];
(
${FEATURES.map(f=>`  way["${f}"](${BBOX});`).join('\n')}
);
out body;
>;
out skel qt;
node["natural"="tree"](${BBOX});
out body;
`;

console.log(`[fetch-osm] world=${W.name}  bbox=${BBOX}`);
const res = await fetch(W.overpass, {
  method:'POST',
  headers:{ 'Content-Type':'application/x-www-form-urlencoded',
            'User-Agent':'aniracers-world-builder (github.com/ysetbon/aniracers)',
            'Accept':'application/osm3s+xml, */*' },
  body: 'data=' + encodeURIComponent(query),
});
if(!res.ok){ console.error('Overpass HTTP '+res.status+': '+(await res.text()).slice(0,300)); process.exit(1); }
let xml = await res.text();
if(!/<osm/.test(xml)){ console.error('unexpected Overpass response:\n'+xml.slice(0,300)); process.exit(1); }

// inject (or replace) <bounds> right after the <osm ...> tag
const bounds = `  <bounds minlat="${minlat}" minlon="${minlon}" maxlat="${maxlat}" maxlon="${maxlon}"/>`;
xml = xml.replace(/<bounds[^>]*\/>\s*/,'');                 // drop any existing
xml = xml.replace(/(<osm\b[^>]*>)/, `$1\n${bounds}`);

fs.mkdirSync(path.dirname(W.paths.osm),{recursive:true});
fs.writeFileSync(W.paths.osm, xml);
const ways=(xml.match(/<way\b/g)||[]).length, nodes=(xml.match(/<node\b/g)||[]).length;
console.log(`[fetch-osm] wrote ${path.relative(W.paths.root,W.paths.osm)}  (${ways} ways, ${nodes} nodes, <bounds> injected)`);
console.log('next: node scripts/strip-buildings-osm.mjs --world='+W.name+'  then convert (osm2world.mjs)');
