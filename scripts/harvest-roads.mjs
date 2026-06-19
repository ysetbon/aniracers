// Harvest one Street View photo per road (camera at the road midpoint, looking ALONG the
// road and slightly down) so the vision step can classify each road's type + surface.
// Run: node --env-file=.env scripts/harvest-roads.mjs --world=<name>
// Idempotent/resumable. Writes maps/<name>/roads-sv.json (manifest w/ pano distance + conf).
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';
const KEY = process.env.GMAPS_KEY;
if (!KEY) { console.error('Missing GMAPS_KEY — run with: node --env-file=.env scripts/harvest-roads.mjs --world=<name>'); process.exit(1); }
const W = resolveWorld(process.argv.slice(2));
const ROADS = JSON.parse(fs.readFileSync(path.join(W.paths.dir,'roads.json'),'utf8')).roads;
const SVDIR = path.join(W.paths.dir,'roads-sv'); fs.mkdirSync(SVDIR,{recursive:true});
const META='https://maps.googleapis.com/maps/api/streetview/metadata', IMG='https://maps.googleapis.com/maps/api/streetview';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function haversine(la1,lo1,la2,lo2){const r=Math.PI/180,R=6371000;const dla=(la2-la1)*r,dlo=(lo2-lo1)*r;
  const a=Math.sin(dla/2)**2+Math.cos(la1*r)*Math.cos(la2*r)*Math.sin(dlo/2)**2;return 2*R*Math.asin(Math.sqrt(a));}

const manifest=[]; let got=0,skipped=0,nopano=0;
console.log(`[${W.name}] ${ROADS.length} roads; harvesting Street View along each...`);
for(let i=0;i<ROADS.length;i++){
  const rd=ROADS[i]; const file=`road_${rd.id}.jpg`, abs=path.join(SVDIR,file);
  if(fs.existsSync(abs)&&fs.statSync(abs).size>2000){ skipped++; manifest.push({id:rd.id,file,cached:true}); continue; }
  let mt; try{ mt=await (await fetch(`${META}?location=${rd.mid[0]},${rd.mid[1]}&radius=40&source=outdoor&key=${KEY}`)).json(); }
  catch(e){ manifest.push({id:rd.id,status:'meta_error'}); continue; }
  if(mt.status!=='OK'){ nopano++; manifest.push({id:rd.id,status:mt.status,type:rd.type}); continue; }
  const dist=haversine(mt.location.lat,mt.location.lng,rd.mid[0],rd.mid[1]);
  try{
    const r=await fetch(`${IMG}?size=640x400&pano=${mt.pano_id}&heading=${rd.heading}&fov=80&pitch=-5&key=${KEY}`);
    if(!r.ok) throw new Error('HTTP '+r.status);
    const buf=Buffer.from(await r.arrayBuffer()); if(buf.length<2000) throw new Error('tiny');
    fs.writeFileSync(abs,buf); got++;
    manifest.push({id:rd.id,file,hw:rd.hw,type:rd.type,name:rd.name,surface:rd.surface,lanes:rd.lanes,
      lengthM:rd.lengthM,dist:+dist.toFixed(1),conf:dist<25?'high':dist<45?'med':'low'});
    if(got%25===0) console.log(`  ${got} fetched (${i+1}/${ROADS.length})`);
  }catch(e){ manifest.push({id:rd.id,status:'img_error'}); }
  await sleep(35);
}
fs.writeFileSync(path.join(W.paths.dir,'roads-sv.json'),JSON.stringify({count:manifest.length,fetched:got,skipped,nopano,photos:manifest},null,2));
console.log(`\n[${W.name}] DONE: ${got} new, ${skipped} cached, ${nopano} no-pano -> ${path.relative(ROOT,SVDIR)}/`);
