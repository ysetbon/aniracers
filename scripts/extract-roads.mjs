// Extract the OSM road/path network for a world (the "black lines/curves" you see in the
// track editor), projected into the SAME world XZ coords as world.glb. Maps each road to one
// of a few base types and records a midpoint + heading for Street View. Includes walkable
// paths (footway/path/track/cycleway) so the forest trail is covered.
// Run: node scripts/extract-roads.mjs --world=<name>
import fs from 'fs'; import path from 'path';
import { resolveWorld, readArea, projection, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
if(!fs.existsSync(W.paths.osm)){ console.error('missing '+path.relative(ROOT,W.paths.osm)+' — run: node scripts/fetch-osm.mjs --world='+W.name); process.exit(1); }
const OSM = fs.readFileSync(W.paths.osm,'utf8');
const AREA = readArea(W);

const { originLat, toXZ } = projection(AREA);
const POLY=AREA.polygon.map(([la,lo])=>toXZ(la,lo));
const pxs=POLY.map(p=>p[0]), pzs=POLY.map(p=>p[1]);
const PCX=(Math.min(...pxs)+Math.max(...pxs))/2, PCZ=(Math.min(...pzs)+Math.max(...pzs))/2;
const xz=(lat,lon)=>{const [x,z]=toXZ(lat,lon);return [Math.round((x-PCX)*100)/100, Math.round((z-PCZ)*100)/100];};
function inPoly(x,z){let c=false;for(let i=0,j=POLY.length-1;i<POLY.length;j=i++){
  const xi=POLY[i][0]-PCX,zi=POLY[i][1]-PCZ,xj=POLY[j][0]-PCX,zj=POLY[j][1]-PCZ;
  if(((zi>z)!=(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))c=!c;}return c;}

// OSM highway tag -> our base road type (the vision step can refine)
function baseType(hw){
  if(/^(motorway|trunk|primary|secondary)(_link)?$/.test(hw)) return 'avenue';
  if(/^tertiary(_link)?$/.test(hw)) return 'avenue';
  if(/^(residential|living_street|unclassified|road)$/.test(hw)) return 'street';
  if(/^(service|construction)$/.test(hw)) return 'service';
  if(/^pedestrian$/.test(hw)) return 'plaza';
  if(/^(footway|path|track|cycleway|steps|bridleway)$/.test(hw)) return 'path';
  return 'street';
}

const nodes=new Map();
const reNode=/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g;
let m; while((m=reNode.exec(OSM))) nodes.set(m[1],[+m[2],+m[3]]);

function bearing(la1,lo1,la2,lo2){const r=Math.PI/180;const y=Math.sin((lo2-lo1)*r)*Math.cos(la2*r);
  const x=Math.cos(la1*r)*Math.sin(la2*r)-Math.sin(la1*r)*Math.cos(la2*r)*Math.cos((lo2-lo1)*r);return (Math.atan2(y,x)/r+360)%360;}

const reWay=/<way id="(\d+)"[^>]*?>([\s\S]*?)<\/way>/g;
const roads=[]; const typeCount={};
while((m=reWay.exec(OSM))){
  const id=m[1], body=m[2]; const tags={}; let t; const reTag=/<tag k="([^"]+)" v="([^"]*)"\/>/g;
  while((t=reTag.exec(body))) tags[t[1]]=t[2];
  const hw=tags['highway']; if(!hw) continue;
  const refs=[...body.matchAll(/<nd ref="(\d+)"\/>/g)].map(r=>r[1]);
  const ll=refs.map(r=>nodes.get(r)).filter(Boolean);
  if(ll.length<2) continue;
  const pts=ll.map(c=>xz(c[0],c[1]));
  if(!pts.some(p=>inPoly(p[0],p[1]))) continue;     // keep roads touching the picked area
  // length + midpoint (in lat/lon for Street View) + heading along road at midpoint
  let len=0; for(let i=1;i<pts.length;i++) len+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
  const midI=Math.max(1,Math.floor(ll.length/2)); const a=ll[midI-1], b=ll[Math.min(ll.length-1,midI)];
  const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2]; const head=bearing(a[0],a[1],b[0],b[1]);
  const type=baseType(hw); typeCount[type]=(typeCount[type]||0)+1;
  roads.push({ id, hw, type, name:tags['name']||null,
    surface:tags['surface']||null, lanes:tags['lanes']?+tags['lanes']:null,
    width:tags['width']?parseFloat(tags['width']):null, oneway:tags['oneway']==='yes',
    mid:[+mid[0].toFixed(7),+mid[1].toFixed(7)], heading:+head.toFixed(1),
    lengthM:Math.round(len), pts });
}
const out={ PCX:+PCX.toFixed(2), PCZ:+PCZ.toFixed(2), count:roads.length, typeCount, roads };
fs.mkdirSync(W.paths.dir,{recursive:true});
fs.writeFileSync(path.join(W.paths.dir,'roads.json'), JSON.stringify(out));
console.log('['+W.name+'] roads inside area:',roads.length,'| by type:',JSON.stringify(typeCount),
  '| total length ~'+Math.round(roads.reduce((s,r)=>s+r.lengthM,0))+'m');
console.log('wrote '+path.relative(ROOT,path.join(W.paths.dir,'roads.json')));
