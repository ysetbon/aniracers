// Split the harvested building photos into chunks for parallel vision analysis, and write
// the analysis INSTRUCTIONS.md the vision agents follow. Each chunk is a list of
// {id, img(abs), area, levels, dist, conf}; agents read a chunk + its images and write
// specs_<k>.json.  Run: node scripts/make-spec-chunks.mjs --world=<name> [--size=20] [--place="..."]
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
const sizeArg = process.argv.find(s=>s.startsWith('--size='));
const SIZE = Number(sizeArg ? sizeArg.split('=')[1] : W.chunkSize);
const placeArg = process.argv.find(s=>s.startsWith('--place='));
const PLACE = placeArg ? placeArg.split('=').slice(1).join('=')
  : (W.name==='netanya' ? 'the Mishkenot Zvulun / Nof HaTalmim neighborhood of Netanya, Israel'
                        : `the "${W.name}" neighborhood`);

if(!fs.existsSync(W.paths.sv)){ console.error('missing '+path.relative(ROOT,W.paths.sv)+' — run: node --env-file=.env scripts/harvest-buildings.mjs --world='+W.name); process.exit(1); }
const SVDIR = W.paths.streetview, WORK = W.paths.specWork; fs.mkdirSync(WORK,{recursive:true});
const SV = JSON.parse(fs.readFileSync(W.paths.sv,'utf8')).photos;
const BLD = JSON.parse(fs.readFileSync(W.paths.buildings,'utf8')).buildings;
const BYID = new Map(BLD.map(b=>[b.id,b]));

const work = [];
for(const p of SV){
  const abs = path.join(SVDIR,'bld_'+p.id+'.jpg');
  if(!fs.existsSync(abs)||fs.statSync(abs).size<2000) continue;
  const b = BYID.get(p.id)||{};
  work.push({ id:p.id, img:abs, area:b.area||null, levels:b.levels||null, dist:p.dist||null, conf:p.conf||'?' });
}
for(const f of fs.readdirSync(WORK)) if(/^(chunk|specs)_\d+\.json$/.test(f)) fs.unlinkSync(path.join(WORK,f));
let k=0; for(let i=0;i<work.length;i+=SIZE){ fs.writeFileSync(path.join(WORK,'chunk_'+k+'.json'),JSON.stringify(work.slice(i,i+SIZE),null,2)); k++; }
fs.writeFileSync(path.join(WORK,'INSTRUCTIONS.md'), INSTRUCTIONS(PLACE));
console.log('['+W.name+'] '+work.length+' buildings with photos -> '+k+' chunks of '+SIZE+'  (+ INSTRUCTIONS.md)');
console.log('chunk dir: '+path.relative(ROOT,WORK));
console.log('next: run '+k+' vision agents (one per chunk) -> specs_<k>.json, then: node scripts/merge-specs.mjs --world='+W.name);

function INSTRUCTIONS(place){ return `# Building photo -> 3D model spec

You are analyzing Google Street View photos of buildings in **${place}**, to produce a 3D-model
spec for each building in a low-poly racing game.

## Input
You will be told a chunk file path and an output file path. Read the chunk JSON: an array of
buildings, each \`{id, img, area, levels, dist, conf}\` where \`img\` is the absolute path to the
photo, \`area\` is footprint m² (may be null), \`levels\` is the OSM floor count (may be null),
\`dist\` is metres from camera.

For **each** building, use the **Read** tool on \`img\` to view the photo, then decide its spec.
The camera is aimed at the building's centroid — focus on the most prominent building near the
**center** of the frame. Photos may be partly blocked by trees/walls/cars or show several
buildings; do your best and lower \`conf\` when unsure.

## Output spec — EXACTLY these fields per building
- \`floors\`: integer 1–25. **If \`levels\` is given, use it** unless the photo flatly contradicts
  it. If \`levels\` is null, estimate from window rows; fall back to: area>250 → 4, else 2.
- \`wall\`: hex \`"#rrggbb"\` of the dominant wall colour (match the local architecture).
- \`roof\`: \`"flat"\` | \`"gabled"\` | \`"hipped"\`. Tiled/pitched roofs → gabled (long ridge) or
  hipped (4-sided pyramid); most blocks/towers are flat.
- \`roofColor\`: hex. Flat ≈ \`"#c9cdd2"\` (grey). Tiled ≈ \`"#b25a3c"\` (terracotta).
- \`cols\`: integer 1–8 = windows per floor across the visible facade width. Towers/blocks 4–6,
  houses 2–3.
- \`balconies\`: true if rows of protruding balconies (typical of apartment blocks/towers).
- \`doors\`: 2 if clearly a semi-detached pair (two front doors / mirrored houses); else 1.
- \`shutters\`: true if windows have prominent external shutters/blinds.
- \`stoneBase\`: true if the ground floor/base is clad in stone or a different material.
- \`solar\`: true if rooftop solar water heaters (cylinders + panels) or water tanks are visible.
- \`style\`: \`"tower"\` (≥8 floors) | \`"apartment"\` (4–7) | \`"house"\` (1–3 low) | \`"villa"\` (1–3 tiled).
- \`conf\`: \`"high"\` | \`"med"\` | \`"low"\` — how clearly the photo shows THIS building.
- \`notes\`: ≤8 words.

When the photo is unusable (only trees/wall/sky/road, or clearly a far different building), set
\`conf:"low"\` and choose sensible defaults from area/levels.

## Write the result
Use the **Write** tool to write the output file path as strict JSON, no prose:
\`\`\`
{"chunk":<k>,"specs":{"<id>":{ ...spec... }, ...}}
\`\`\`
Then reply with ONE line only: \`chunk <k>: N specs, <#high>/<#med>/<#low> conf\`.
`; }
