// Merge the per-chunk vision outputs (spec-work/specs_*.json) into one
// maps/mishkenot_zvulun/building-specs.json that build-mishkenot-from-specs.mjs reads.
// Validates/clamps fields and prints a distribution summary.
// Run: node scripts/merge-specs.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT,'maps/mishkenot_zvulun/spec-work');
const OUT = path.join(ROOT,'maps/mishkenot_zvulun/building-specs.json');

const ROOFS = new Set(['flat','gabled','hipped']);
const hex = (c,def)=>{ if(typeof c!=='string')return def; const m=c.trim().match(/^#?([0-9a-fA-F]{6})$/); return m?'#'+m[1].toLowerCase():def; };
const clampInt = (v,lo,hi,def)=>{ v=Math.round(Number(v)); return Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):def; };

const specs = {}; let files=0, bad=0;
for(const f of fs.readdirSync(WORK)){
  if(!/^specs_\d+\.json$/.test(f)) continue;
  let j; try{ j=JSON.parse(fs.readFileSync(path.join(WORK,f),'utf8')); }catch(e){ console.warn('  bad JSON: '+f+' — '+e.message); bad++; continue; }
  files++;
  const S = j.specs||j;
  for(const id of Object.keys(S)){
    const s=S[id]||{};
    specs[id] = {
      floors: clampInt(s.floors,1,25,2),
      wall: hex(s.wall,'#ece3d0'),
      roof: ROOFS.has(s.roof)?s.roof:'flat',
      roofColor: hex(s.roofColor, (s.roof==='gabled'||s.roof==='hipped')?'#b25a3c':'#c9cdd2'),
      cols: clampInt(s.cols,1,8,3),
      balconies: !!s.balconies,
      doors: (clampInt(s.doors,1,2,1)),
      shutters: !!s.shutters,
      stoneBase: !!s.stoneBase,
      solar: !!s.solar,
      style: ['tower','apartment','house','villa'].includes(s.style)?s.style:'house',
      conf: ['high','med','low'].includes(s.conf)?s.conf:'low',
    };
  }
}
const ids=Object.keys(specs);
fs.writeFileSync(OUT, JSON.stringify({ generatedAt:'', count:ids.length, specs }, null, 1));

// summary
const dist=(key)=>ids.reduce((m,id)=>{const k=specs[id][key];m[k]=(m[k]||0)+1;return m;},{});
const floorsHist=ids.reduce((m,id)=>{const f=specs[id].floors;const b=f>=8?'8+':f>=4?'4-7':String(f);m[b]=(m[b]||0)+1;return m;},{});
console.log('merged '+files+' files'+(bad?(' ('+bad+' unreadable)'):'')+' -> '+ids.length+' specs');
console.log('style :', JSON.stringify(dist('style')));
console.log('roof  :', JSON.stringify(dist('roof')));
console.log('conf  :', JSON.stringify(dist('conf')));
console.log('floors:', JSON.stringify(floorsHist));
console.log('balconies:', ids.filter(i=>specs[i].balconies).length, ' solar:', ids.filter(i=>specs[i].solar).length, ' stoneBase:', ids.filter(i=>specs[i].stoneBase).length, ' doors=2:', ids.filter(i=>specs[i].doors===2).length);
console.log('wrote '+path.relative(ROOT,OUT));
