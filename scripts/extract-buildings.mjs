// Extract building footprints from the Mishkenot OSM extract, projected into the
// SAME world XZ coords as assets/mishkenot/world.glb, for the per-building editor.
// Run: node scripts/extract-buildings.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OSM = fs.readFileSync(path.join(ROOT,'OSM2World/_aniracers_test/mishkenot.osm'),'utf8');
const AREA = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/area.json'),'utf8'));

// --- same MetricMapProjection as the world build ---
const originLat=(AREA.bbox.minlat+AREA.bbox.maxlat)/2, originLon=(AREA.bbox.minlon+AREA.bbox.maxlon)/2;
const scale=40075016.686*Math.cos(originLat*Math.PI/180);
const latToY=d=>{const s=Math.sin(d*Math.PI/180);return Math.log((1+s)/(1-s))/(4*Math.PI)+0.5;};
const yO=latToY(originLat);
const toXZ=(lat,lon)=>[ (lon-originLon)/360*scale, -(latToY(lat)-yO)*scale ];
// polygon -> world, recentre point (matches build-mishkenot-world.mjs)
const POLY=AREA.polygon.map(([la,lo])=>toXZ(la,lo));
const pxs=POLY.map(p=>p[0]), pzs=POLY.map(p=>p[1]);
const PCX=(Math.min(...pxs)+Math.max(...pxs))/2, PCZ=(Math.min(...pzs)+Math.max(...pzs))/2;
const W=(lat,lon)=>{const [x,z]=toXZ(lat,lon);return [Math.round((x-PCX)*100)/100, Math.round((z-PCZ)*100)/100];};
function inPoly(x,z){let c=false;for(let i=0,j=POLY.length-1;i<POLY.length;j=i++){
  const xi=POLY[i][0]-PCX,zi=POLY[i][1]-PCZ,xj=POLY[j][0]-PCX,zj=POLY[j][1]-PCZ;
  if(((zi>z)!=(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))c=!c;}return c;}

// --- parse nodes ---
const nodes=new Map();
const reNode=/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g;
let m; while((m=reNode.exec(OSM))) nodes.set(m[1],[+m[2],+m[3]]);

// --- parse ways ---
const reWay=/<way id="(\d+)"[^>]*?>([\s\S]*?)<\/way>/g;
const mPerLat=110540, mPerLon=111320*Math.cos(originLat*Math.PI/180);
const buildings=[];
while((m=reWay.exec(OSM))){
  const id=m[1], body=m[2];
  const tags={}; let t; const reTag=/<tag k="([^"]+)" v="([^"]*)"\/>/g;
  while((t=reTag.exec(body))) tags[t[1]]=t[2];
  if(!('building' in tags)) continue;
  const refs=[...body.matchAll(/<nd ref="(\d+)"\/>/g)].map(r=>r[1]);
  const coords=refs.map(r=>nodes.get(r)).filter(Boolean);
  if(coords.length<3) continue;
  // centroid (lat/lon) + area (m^2)
  let clat=0,clon=0; coords.forEach(c=>{clat+=c[0];clon+=c[1];}); clat/=coords.length; clon/=coords.length;
  // footprint area via shoelace in local metres
  let area=0; for(let i=0;i<coords.length;i++){const a=coords[i],b=coords[(i+1)%coords.length];
    const ax=(a[1]-clon)*mPerLon, ay=(a[0]-clat)*mPerLat, bx=(b[1]-clon)*mPerLon, by=(b[0]-clat)*mPerLat;
    area+=ax*by-bx*ay;} area=Math.abs(area/2);
  const [cx,cz]=W(clat,clon);
  if(!inPoly(cx,cz)) continue;                 // only buildings inside the picked polygon
  const foot=coords.map(c=>W(c[0],c[1]));
  const levels=tags['building:levels']?+tags['building:levels']:null;
  const height=tags['height']?parseFloat(tags['height']):null;
  buildings.push({id,cx,cz,clat:+clat.toFixed(7),clon:+clon.toFixed(7),area:Math.round(area),
    levels,height,roof:tags['roof:shape']||null,foot});
}
const out={ originLat,originLon, PCX:+PCX.toFixed(2),PCZ:+PCZ.toFixed(2),
  count:buildings.length, buildings };
fs.writeFileSync(path.join(ROOT,'maps/mishkenot_zvulun/buildings.json'),JSON.stringify(out));
console.log('buildings inside polygon:',buildings.length,
  '| with levels:',buildings.filter(b=>b.levels).length,
  '| median area:',buildings.map(b=>b.area).sort((a,b)=>a-b)[buildings.length>>1],'m^2');
