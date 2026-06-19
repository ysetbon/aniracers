// Inject the per-building editor choices (maps/.../building-overrides.json) into the
// Mishkenot OSM extract as tags OSM2World understands, writing mishkenot_tagged.osm.
// Then re-run OSM2World convert + build-mishkenot-world to rebuild the world.
// Run: node scripts/apply-building-overrides.mjs   (then convert + build)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT,'OSM2World/_aniracers_test/mishkenot.osm');
const DST = path.join(ROOT,'OSM2World/_aniracers_test/mishkenot_tagged.osm');
const OVR = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/building-overrides.json'),'utf8')).overrides;

// type presets — MUST match the editor (building-editor.mjs TYPES)
const TYPES = {
  A:{ wall:'#eef0f2', roof:'#b9bcc2', shape:'flat'  },   // apartment block — white, flat
  B:{ wall:'#f0e7d4', roof:'#cabfa6', shape:'flat'  },   // villa — cream, flat
  C:{ wall:'#efe6d3', roof:'#b6523a', shape:'gabled' },  // villa — cream + red tiles
};
const STRIP = /^\s*<tag k="(building:levels|height|building:colour|roof:shape|roof:colour|roof:material|building:material|roof:height)"[^>]*\/>\s*$/gm;

let osm = fs.readFileSync(SRC,'utf8');
let tagged=0;
osm = osm.replace(/(<way id="(\d+)"[^>]*>)([\s\S]*?)(<\/way>)/g, (full, open, id, body, close) => {
  const o = OVR[id]; if(!o) return full;
  const ty = TYPES[o.type]||TYPES.A; const lv = Math.max(1, o.lv||2); const h = (lv*3.2).toFixed(1);
  const cleaned = body.replace(STRIP,'');
  const add =
    '    <tag k="building:levels" v="'+lv+'"/>\n'+
    '    <tag k="height" v="'+h+'"/>\n'+
    '    <tag k="building:colour" v="'+ty.wall+'"/>\n'+
    '    <tag k="roof:shape" v="'+ty.shape+'"/>\n'+
    '    <tag k="roof:colour" v="'+ty.roof+'"/>\n  ';
  tagged++;
  return open + cleaned.replace(/\s*$/,'\n') + add + close;
});
fs.writeFileSync(DST, osm);
console.log('tagged '+tagged+' building ways -> '+path.relative(ROOT,DST));
if(!/<bounds/.test(osm)) console.warn('WARNING: no <bounds> in tagged file — projection origin may drift!');
else console.log('<bounds> preserved (projection origin stays deterministic).');
