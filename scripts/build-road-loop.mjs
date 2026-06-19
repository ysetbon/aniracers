// Auto-build a drivable race loop from the real road network (replaces the hand-traced
// track). Builds a graph of the driveable roads (shared OSM nodes already coincide), prunes
// dead-end stubs to the 2-core, then traces the OUTER BOUNDARY (right-hand wall-follow) as
// a closed lap. Writes maps/<name>/track.json and prints the <KEY>_CTRL array for index.html.
// Run: node scripts/build-road-loop.mjs --world=<name> [--types=avenue,street]
import fs from 'fs'; import path from 'path';
import { resolveWorld, readArea, projection, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
const typesArg = process.argv.find(s=>s.startsWith('--types='));
const TYPES = new Set((typesArg?typesArg.split('=')[1]:'avenue,street').split(','));
const RJ = JSON.parse(fs.readFileSync(path.join(W.paths.dir,'roads.json'),'utf8'));
const ROADS = RJ.roads.filter(r=>TYPES.has(r.type) && r.pts && r.pts.length>=2);

// polygon (recentred like the road pts) so we keep the loop INSIDE the rendered area
const AREA = readArea(W); const { toXZ } = projection(AREA);
const PCX=RJ.PCX, PCZ=RJ.PCZ;
const POLY = AREA.polygon.map(([la,lo])=>{const [x,z]=toXZ(la,lo);return [x-PCX,z-PCZ];});
function inPoly(x,z){let c=false;for(let i=0,j=POLY.length-1;i<POLY.length;j=i++){
  const xi=POLY[i][0],zi=POLY[i][1],xj=POLY[j][0],zj=POLY[j][1];
  if(((zi>z)!=(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))c=!c;}return c;}

// graph: snap to 0.1m; intersections share identical projected coords. Edges only where
// BOTH endpoints are inside the polygon, so the lap never leaves the rendered roads.
const key=(x,z)=>x.toFixed(1)+','+z.toFixed(1);
const N=new Map();
function node(x,z){const k=key(x,z); let n=N.get(k); if(!n){n={k,x,z,adj:new Set()};N.set(k,n);} return n;}
for(const r of ROADS){ for(let i=0;i<r.pts.length-1;i++){
  const p0=r.pts[i], p1=r.pts[i+1];
  if(!inPoly(p0[0],p0[1])||!inPoly(p1[0],p1[1])) continue;
  const a=node(p0[0],p0[1]), b=node(p1[0],p1[1]);
  if(a!==b){a.adj.add(b.k); b.adj.add(a.k);} } }

// prune degree-1 stubs iteratively -> 2-core
let changed=true; while(changed){ changed=false;
  for(const n of [...N.values()]){ if(n.adj.size===1){ const o=N.get([...n.adj][0]); o.adj.delete(n.k); N.delete(n.k); changed=true; }
    else if(n.adj.size===0){ N.delete(n.k); changed=true; } } }
if(!N.size){ console.error('no 2-core cycle in the driveable network for types '+[...TYPES]); process.exit(1); }

// largest connected component
function comp(start){const seen=new Set([start.k]),st=[start];while(st.length){const c=st.pop();for(const ak of c.adj)if(!seen.has(ak)){seen.add(ak);st.push(N.get(ak));}}return seen;}
let best=null; const visited=new Set();
for(const n of N.values()){ if(visited.has(n.k))continue; const c=comp(n); c.forEach(k=>visited.add(k)); if(!best||c.size>best.size)best=c; }
const G=new Map([...N].filter(([k])=>best.has(k)));

const ang=(dx,dz)=>Math.atan2(dz,dx);
function startNode(){ let s=null; for(const n of G.values()) if(!s||n.z<s.z||(n.z===s.z&&n.x<s.x))s=n; return s; }
// right-hand wall-follow: arriving at cur from prev, pick neighbour with smallest CW turn
function nextK(prevK,curK){ const v=G.get(curK), back=ang(G.get(prevK).x-v.x, G.get(prevK).z-v.z);
  let best=null,bt=Infinity;
  for(const wk of v.adj){ if(wk===prevK && v.adj.size>1) continue;
    const a=ang(G.get(wk).x-v.x, G.get(wk).z-v.z); let t=back-a; while(t<=1e-9)t+=2*Math.PI; while(t>2*Math.PI)t-=2*Math.PI;
    if(t<bt){bt=t;best=wk;} }
  return best!=null?best:prevK; }

const s=startNode();
G.set('__v',{k:'__v',x:s.x,z:s.z-1e6,adj:new Set()});
const first=nextK('__v',s.k);
const loop=[s.k]; let prev=s.k, cur=first; let guard=0, max=G.size*6;
while(guard++<max){ loop.push(cur); const nx=nextK(prev,cur); prev=cur; cur=nx; if(prev===first && cur===s.k) break; if(cur===s.k && loop.length>2) break; }
G.delete('__v');

// to coords, then simplify: drop near-collinear pts + enforce min spacing
let pts=loop.map(k=>G.get(k)).filter(Boolean).map(n=>[n.x,n.z]);
// dedup consecutive
pts=pts.filter((p,i)=>i===0||p[0]!==pts[i-1][0]||p[1]!==pts[i-1][1]);
const simp=[]; const MINSP=9, MAXDOT=0.985;
for(let i=0;i<pts.length;i++){ const p=pts[i];
  if(simp.length>=2){ const a=simp[simp.length-2], b=simp[simp.length-1];
    const u=[b[0]-a[0],b[1]-a[1]], v=[p[0]-b[0],p[1]-b[1]];
    const lu=Math.hypot(...u)||1, lv=Math.hypot(...v)||1, dot=(u[0]*v[0]+u[1]*v[1])/(lu*lv);
    if(dot>MAXDOT && lv<40){ simp[simp.length-1]=p; continue; } }   // collinear -> replace
  if(simp.length && Math.hypot(p[0]-simp[simp.length-1][0],p[1]-simp[simp.length-1][1])<MINSP) continue;
  simp.push(p); }
// length
let len=0; for(let i=0;i<simp.length;i++){const a=simp[i],b=simp[(i+1)%simp.length];len+=Math.hypot(b[0]-a[0],b[1]-a[1]);}
const ctrl=simp.map(p=>[Math.round(p[0]),Math.round(p[1])]);
fs.writeFileSync(path.join(W.paths.dir,'track.json'), JSON.stringify({world:W.gameKey,closed:true,ctrl,lengthM:Math.round(len),source:'road-loop'},null,2));
console.log('['+W.name+'] road loop: '+ctrl.length+' control points, ~'+Math.round(len)+'m (2-core '+G.size+' nodes)');
console.log('wrote '+path.relative(ROOT,path.join(W.paths.dir,'track.json')));
console.log('\nPaste into index.html as '+W.gameKey.toUpperCase()+'_CTRL:\nconst '+W.gameKey.toUpperCase()+'_CTRL = '+JSON.stringify(ctrl)+';');
