// Merge per-chunk road vision outputs (road-work/specs_*.json) into maps/<name>/road-specs.json.
// Run: node scripts/merge-road-specs.mjs --world=<name>
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
const WORK = path.join(W.paths.dir,'road-work'), OUT = path.join(W.paths.dir,'road-specs.json');
const TYPES=new Set(['avenue','street','service','plaza','path']);
const SURF=new Set(['asphalt','paved','paving_stones','cobblestone','sett','concrete','compacted','ground','dirt','gravel','grass']);
const MARK=new Set(['none','centre','lane']);
const ci=(v,lo,hi,d)=>{v=Math.round(Number(v));return Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):d;};
const specs={}; let files=0,bad=0;
for(const f of fs.readdirSync(WORK)){ if(!/^specs_\d+\.json$/.test(f))continue;
  let j; try{ j=JSON.parse(fs.readFileSync(path.join(WORK,f),'utf8')); }catch(e){ bad++; continue; } files++;
  const S=j.specs||j;
  for(const id of Object.keys(S)){ const s=S[id]||{};
    specs[id]={ type:TYPES.has(s.type)?s.type:'street', surface:SURF.has(s.surface)?s.surface:null,
      mark:MARK.has(s.markings)?s.markings:null, lanes:ci(s.lanes,1,4,null), sidewalk:!!s.sidewalk,
      conf:['high','med','low'].includes(s.conf)?s.conf:'low' }; }
}
const ids=Object.keys(specs);
if(!ids.length){ console.error('no specs_*.json in '+path.relative(ROOT,WORK)); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify({count:ids.length,specs},null,1));
const dist=k=>ids.reduce((m,i)=>{m[specs[i][k]]=(m[specs[i][k]]||0)+1;return m;},{});
console.log('['+W.name+'] merged '+files+' files -> '+ids.length+' road specs'+(bad?(' ('+bad+' bad)'):''));
console.log('type:',JSON.stringify(dist('type')),'surface:',JSON.stringify(dist('surface')),'mark:',JSON.stringify(dist('mark')));
console.log('wrote '+path.relative(ROOT,OUT));
