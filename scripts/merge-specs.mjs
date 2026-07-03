// Merge the per-chunk vision outputs (spec-work/specs_*.json) into one
// maps/<name>/building-specs.json that build-world-from-specs.mjs reads.
// Validates/clamps fields and prints a distribution summary.
// Spec v2 files (specs_v2_*.json) are read AFTER v1 and override per-building; they carry
// the extra fields house-factory v2 consumes (accent/windowStyle/fence/gate, see
// spec-work/INSTRUCTIONS_V2.md).
// Run: node scripts/merge-specs.mjs --world=<name>
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
const WORK = W.paths.specWork, OUT = W.paths.specs;
if(!fs.existsSync(WORK)){ console.error('no spec-work dir for '+W.name+' — run make-spec-chunks + the vision agents first'); process.exit(1); }

const ROOFS = new Set(['flat','gabled','hipped']);
const LEVELS = new Map(JSON.parse(fs.readFileSync(W.paths.buildings,'utf8')).buildings.map(b=>[String(b.id), b.levels||0]));
const hex = (c,def)=>{ if(typeof c!=='string')return def; const m=c.trim().match(/^#?([0-9a-fA-F]{6})$/); return m?'#'+m[1].toLowerCase():def; };
const clampInt = (v,lo,hi,def)=>{ v=Math.round(Number(v)); return Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):def; };

const FENCES = new Set(['slat','stone','hedge','metal','none']);
const WINSTYLES = new Set(['plain','framed','horizontal']);
const clampNum = (v,lo,hi,def)=>{ v=Number(v); return Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):def; };

function cleanV1(s){
  return {
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
function cleanV2(s,id){
  const out = cleanV1(s);
  out.style = ['tower','apartment','house','villa','duplex','cottage'].includes(s.style)?s.style:'villa';
  // street-level photos only see a tall building's base — OSM levels win for 4+ floors
  const lv = LEVELS.get(String(id));
  if(lv>=4 && out.floors<lv-1){ out.floors=Math.min(lv,25); out.style = lv>=8?'tower':'apartment'; }
  if(s.accent!=null) out.accent = hex(s.accent,null);
  if(!out.accent) delete out.accent;
  if(WINSTYLES.has(s.windowStyle)) out.windowStyle = s.windowStyle;
  if(s.fence && typeof s.fence==='object' && FENCES.has(s.fence.type) && s.fence.type!=='none')
    out.fence = { type:s.fence.type, color:hex(s.fence.color,'#d8d2c0'), height:+clampNum(s.fence.height,0.8,2.2,1.5).toFixed(2) };
  if(s.gate && typeof s.gate==='object') out.gate = { color:hex(s.gate.color, out.fence?out.fence.color:'#d8d2c0') };
  if(typeof s.notes==='string' && s.notes.trim()) out.notes = s.notes.trim().slice(0,80);
  return out;
}

const specs = {}; let files=0, bad=0, v2count=0;
const names = fs.readdirSync(WORK);
const byIdx = (a,b)=>(+a.match(/(\d+)\.json$/)[1])-(+b.match(/(\d+)\.json$/)[1]);
const v1files = names.filter(f=>/^specs_\d+\.json$/.test(f)).sort(byIdx);
const v2files = names.filter(f=>/^specs_v2_\d+\.json$/.test(f)).sort(byIdx);   // higher index wins (escalation)
for(const [list,clean] of [[v1files,cleanV1],[v2files,cleanV2]]){
  for(const f of list){
    let j; try{ j=JSON.parse(fs.readFileSync(path.join(WORK,f),'utf8')); }catch(e){ console.warn('  bad JSON: '+f+' — '+e.message); bad++; continue; }
    files++;
    const S = j.specs||j;
    for(const id of Object.keys(S)){
      specs[id] = clean(S[id]||{}, id);
      if(clean===cleanV2) v2count++;
    }
  }
}
const ids=Object.keys(specs);
if(!ids.length){ console.error('no specs_*.json found in '+path.relative(ROOT,WORK)+' — run the vision agents first'); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify({ generatedAt:'', count:ids.length, specs }, null, 1));

const dist=(key)=>ids.reduce((m,id)=>{const k=specs[id][key];m[k]=(m[k]||0)+1;return m;},{});
const floorsHist=ids.reduce((m,id)=>{const f=specs[id].floors;const b=f>=8?'8+':f>=4?'4-7':String(f);m[b]=(m[b]||0)+1;return m;},{});
console.log('['+W.name+'] merged '+files+' files ('+v2files.length+' v2, '+v2count+' v2 specs)'+(bad?(' ('+bad+' unreadable)'):'')+' -> '+ids.length+' specs');
console.log('style :', JSON.stringify(dist('style')));
console.log('roof  :', JSON.stringify(dist('roof')));
console.log('conf  :', JSON.stringify(dist('conf')));
console.log('floors:', JSON.stringify(floorsHist));
console.log('balconies:', ids.filter(i=>specs[i].balconies).length, ' solar:', ids.filter(i=>specs[i].solar).length, ' stoneBase:', ids.filter(i=>specs[i].stoneBase).length, ' doors=2:', ids.filter(i=>specs[i].doors===2).length);
console.log('wrote '+path.relative(ROOT,OUT));
