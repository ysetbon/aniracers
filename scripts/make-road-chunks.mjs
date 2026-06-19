// Split harvested ROAD photos into chunks for parallel vision classification, and write the
// road INSTRUCTIONS.md. Mirrors make-spec-chunks but for roads-sv/roads.json.
// Run: node scripts/make-road-chunks.mjs --world=<name> [--size=25]
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
const sizeArg = process.argv.find(s=>s.startsWith('--size=')); const SIZE = Number(sizeArg?sizeArg.split('=')[1]:25);
const SVDIR = path.join(W.paths.dir,'roads-sv'); const WORK = path.join(W.paths.dir,'road-work'); fs.mkdirSync(WORK,{recursive:true});
const SV = JSON.parse(fs.readFileSync(path.join(W.paths.dir,'roads-sv.json'),'utf8')).photos;
const work=[];
for(const p of SV){ const abs=path.join(SVDIR,'road_'+p.id+'.jpg'); if(!fs.existsSync(abs)||fs.statSync(abs).size<2000) continue;
  work.push({ id:p.id, img:abs, hw:p.hw, baseType:p.type, surface:p.surface||null, lanes:p.lanes||null, lengthM:p.lengthM||null, conf:p.conf||'?' }); }
for(const f of fs.readdirSync(WORK)) if(/^(chunk|specs)_\d+\.json$/.test(f)) fs.unlinkSync(path.join(WORK,f));
let k=0; for(let i=0;i<work.length;i+=SIZE){ fs.writeFileSync(path.join(WORK,'chunk_'+k+'.json'),JSON.stringify(work.slice(i,i+SIZE),null,2)); k++; }
fs.writeFileSync(path.join(WORK,'INSTRUCTIONS.md'), INSTRUCTIONS());
console.log('['+W.name+'] '+work.length+' roads with photos -> '+k+' chunks of '+SIZE+'  (+ INSTRUCTIONS.md)');
console.log('chunk dir: '+path.relative(ROOT,WORK));

function INSTRUCTIONS(){ return `# Road photo -> road spec

You are analyzing Google Street View photos taken ALONG roads (camera looks down the road) to
classify each road for a low-poly racing game. The OSM tag is given as a strong prior.

## Input
Read the chunk JSON: an array of roads \`{id, img, hw, baseType, surface, lanes, lengthM, conf}\`
where \`img\` is the absolute path, \`hw\` is the OSM highway tag, \`baseType\` is the tag-derived
guess. Use the **Read** tool on \`img\` to view each photo.

## Output spec — EXACTLY these fields per road
- \`type\`: one of \`avenue\` (wide, ≥2 lanes, lane markings) | \`street\` (residential, 1–2 lanes) |
  \`service\` (narrow access road/alley) | \`plaza\` (pedestrian paved square/promenade, no cars) |
  \`path\` (footpath/trail/cycle path, often through greenery). Start from \`baseType\`; only change
  it if the photo clearly disagrees.
- \`surface\`: \`asphalt\` | \`paved\` | \`paving_stones\` | \`cobblestone\` | \`concrete\` | \`compacted\`
  (dirt/gravel) | \`grass\`. Use the OSM \`surface\` if given and the photo agrees.
- \`markings\`: \`none\` | \`centre\` (centre line/dashes) | \`lane\` (multiple painted lanes).
- \`lanes\`: integer 1–4 (driveable lanes; 1 for paths/plazas).
- \`sidewalk\`: true if there are sidewalks/kerbs beside the road.
- \`conf\`: \`high\` | \`med\` | \`low\` (how clearly the photo shows the road).
- \`notes\`: ≤8 words.

If the photo is unusable (blocked, indoors, clearly elsewhere) set \`conf:"low"\` and keep
\`baseType\` + the OSM surface.

## Write the result
Use **Write** to write the output file path as strict JSON, no prose:
\`\`\`
{"chunk":<k>,"specs":{"<id>":{ ...spec... }, ...}}
\`\`\`
Then reply with ONE line: \`road chunk <k>: N specs\`.
`; }
