// Fetch Street View shots at points on the Mishkenot track, to read the real
// buildings (floors / wall colour / roof) and later tag the OSM data accordingly.
// Run:  node --env-file=.env scripts/mishkenot-streetview.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.GMAPS_KEY;
if (!KEY) { console.error('Missing GMAPS_KEY — run: node --env-file=.env scripts/mishkenot-streetview.mjs'); process.exit(1); }
const AREA = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/area.json'),'utf8'));
const OUT = path.join(ROOT,'maps/mishkenot_zvulun/streetview'); fs.mkdirSync(OUT,{recursive:true});

// inverse of the OSM2World MetricMapProjection used to build the world
const originLat=(AREA.bbox.minlat+AREA.bbox.maxlat)/2, originLon=(AREA.bbox.minlon+AREA.bbox.maxlon)/2;
const scale=40075016.686*Math.cos(originLat*Math.PI/180);
const latToY=d=>{const s=Math.sin(d*Math.PI/180);return Math.log((1+s)/(1-s))/(4*Math.PI)+0.5;};
const yToLat=y=>360/Math.PI*Math.atan(Math.exp((y-0.5)*2*Math.PI))-90;
const yO=latToY(originLat);
const toLatLon=(x,z)=>[ yToLat(yO - z/scale), originLon + (x/scale)*360 ];

// a few points ON the drawn track (so Street View coverage is good — they're on roads)
const SAMPLES=[[122,-332],[-159,-189],[-200,-44],[44,56],[131,-57]];
const META='https://maps.googleapis.com/maps/api/streetview/metadata';
const IMG='https://maps.googleapis.com/maps/api/streetview';

const index=[];
for(let i=0;i<SAMPLES.length;i++){
  const [x,z]=SAMPLES[i]; const [lat,lon]=toLatLon(x,z);
  let m; try{ m=await (await fetch(`${META}?location=${lat},${lon}&radius=60&key=${KEY}`)).json(); }catch(e){ m={status:'ERR'}; }
  console.log(`pt${i} world(${x},${z}) -> ${lat.toFixed(6)},${lon.toFixed(6)}  SV:${m.status}${m.date?' '+m.date:''}`);
  if(m.status!=='OK') continue;
  for(const h of [0,90,180,270]){
    const url=`${IMG}?size=640x640&location=${m.location.lat},${m.location.lng}&heading=${h}&fov=90&pitch=6&key=${KEY}`;
    const buf=Buffer.from(await (await fetch(url)).arrayBuffer());
    const fn=`sv_pt${i}_h${h}.jpg`; fs.writeFileSync(path.join(OUT,fn),buf);
    index.push({pt:i,world:[x,z],lat:m.location.lat,lon:m.location.lng,heading:h,date:m.date,file:fn});
  }
}
fs.writeFileSync(path.join(OUT,'index.json'),JSON.stringify(index,null,2));
console.log(`\nwrote ${index.length} Street View images to maps/mishkenot_zvulun/streetview/`);
