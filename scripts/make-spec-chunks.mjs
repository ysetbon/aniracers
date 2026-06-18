// Split the harvested building photos into chunks for parallel vision analysis.
// Writes maps/mishkenot_zvulun/spec-work/chunk_<k>.json — each a list of
// {id, img(abs), area, levels, dist, conf}. Subagents read a chunk + its images and
// write specs_<k>.json. Run: node scripts/make-spec-chunks.mjs [chunkSize]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVDIR = path.join(ROOT,'maps/mishkenot_zvulun/streetview');
const WORK = path.join(ROOT,'maps/mishkenot_zvulun/spec-work'); fs.mkdirSync(WORK,{recursive:true});
const SV = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/building-sv.json'),'utf8')).photos;
const BLD = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/buildings.json'),'utf8')).buildings;
const BYID = new Map(BLD.map(b=>[b.id,b]));
const SIZE = Number(process.argv[2]||20);

const work = [];
for(const p of SV){
  const abs = path.join(SVDIR,'bld_'+p.id+'.jpg');
  if(!fs.existsSync(abs)||fs.statSync(abs).size<2000) continue;
  const b = BYID.get(p.id)||{};
  work.push({ id:p.id, img:abs, area:b.area||null, levels:b.levels||null, dist:p.dist||null, conf:p.conf||'?' });
}
// clear old chunks
for(const f of fs.readdirSync(WORK)) if(/^chunk_\d+\.json$/.test(f)) fs.unlinkSync(path.join(WORK,f));
let k=0; const chunks=[];
for(let i=0;i<work.length;i+=SIZE){ const slice=work.slice(i,i+SIZE);
  const file=path.join(WORK,'chunk_'+k+'.json'); fs.writeFileSync(file,JSON.stringify(slice,null,2)); chunks.push(file); k++; }
console.log(work.length+' buildings with photos -> '+k+' chunks of '+SIZE);
console.log('chunk dir: '+path.relative(ROOT,WORK));
