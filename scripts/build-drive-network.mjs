// Build a compact DRIVABLE-ROAD network for free-roam driving (Netanya/real-road worlds):
// sample every rendered road centreline into points (each carrying a drivable half-width),
// clipped to the polygon so it matches what's baked into world.glb. The game fetches this and
// lets the kart drive anywhere within `half` of any road — and crawl on grass everywhere else.
// Run: node scripts/build-drive-network.mjs --world=<name>
import fs from 'fs'; import path from 'path';
import { resolveWorld, readArea, projection, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));

const RJ = JSON.parse(fs.readFileSync(path.join(W.paths.dir,'roads.json'),'utf8'));
const PCX = RJ.PCX, PCZ = RJ.PCZ;
const AREA = readArea(W); const { toXZ } = projection(AREA);
const POLY = AREA.polygon.map(([la,lo])=>{ const [x,z]=toXZ(la,lo); return [x-PCX,z-PCZ]; });
function inPoly(x,z){ let c=false; for(let i=0,j=POLY.length-1;i<POLY.length;j=i++){
  const xi=POLY[i][0],zi=POLY[i][1],xj=POLY[j][0],zj=POLY[j][1];
  if(((zi>z)!=(zj>z)) && (x<(xj-xi)*(z-zi)/(zj-zi)+xi)) c=!c; } return c; }

// drivable half-width per road type = the road's half-width + a forgiving ~2.5 m shoulder, so a
// kart riding the edge of the street still counts as "on road" (no crawl). Beyond it is grass.
// Mirrors road-factory widths: avenue 11 / street 7 / service 4 / plaza 8 / path 2.2
const HALF = { avenue:8, street:6, service:4.5, plaza:6.5, path:3.5 };
const STEP = 4;   // sample spacing along each road (m)

const pts=[]; let minx=Infinity,minz=Infinity,maxx=-Infinity,maxz=-Infinity;
function push(x,z,h){ if(!inPoly(x,z)) return; const X=Math.round(x), Z=Math.round(z);
  pts.push([X,Z,h]); if(X<minx)minx=X; if(X>maxx)maxx=X; if(Z<minz)minz=Z; if(Z>maxz)maxz=Z; }

let roadsUsed=0;
for(const r of RJ.roads){
  if(!r.pts || r.pts.length<2) continue;
  const h = HALF[r.type] || HALF.street;
  roadsUsed++;
  for(let i=0;i<r.pts.length-1;i++){
    const a=r.pts[i], b=r.pts[i+1], dx=b[0]-a[0], dz=b[1]-a[1], len=Math.hypot(dx,dz);
    const n=Math.max(1, Math.ceil(len/STEP));
    for(let s=0;s<n;s++){ const t=s/n; push(a[0]+dx*t, a[1]+dz*t, h); }
  }
  const last=r.pts[r.pts.length-1]; push(last[0], last[1], h);
}

const M=18;   // boundary margin (m) so karts can't drive off the map
const out = { cell:7, step:STEP, bounds:[minx-M, minz-M, maxx+M, maxz+M], count:pts.length, pts };
const dir = path.dirname(W.paths.assetGlb);
fs.mkdirSync(dir,{recursive:true});
const OUT = path.join(dir,'drive.json');
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size/1024).toFixed(0);
console.log('['+W.name+'] drive network: '+pts.length+' road nodes from '+roadsUsed+' roads (~'+kb+' KB)');
console.log('  bounds x['+out.bounds[0]+','+out.bounds[2]+'] z['+out.bounds[1]+','+out.bounds[3]+']');
console.log('wrote '+path.relative(ROOT,OUT));
