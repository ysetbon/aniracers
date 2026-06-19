// Interactive area picker: open in YOUR browser, click polygon points on the map
// (click the first point again to close the loop), then "Save area". It writes the
// exact polygon to maps/<name>/area.json for Claude to read.
// Run:  node scripts/area-picker.mjs --world=<name> [--center=lat,lon]   then open http://localhost:8765/
import http from 'http';
import fs from 'fs';
import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';

const W = resolveWorld(process.argv.slice(2));
const OUT = W.paths.area;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const PORT = Number(process.env.PICKER_PORT || 8765);

// default view: the world's existing area centre if any, else Mishkenot Zvulun, Netanya
const centerArg = process.argv.find(s=>s.startsWith('--center='));
let CENTER = [32.309930, 34.880891];
if(centerArg){ const [a,b]=centerArg.split('=')[1].split(',').map(Number); if(isFinite(a)&&isFinite(b)) CENTER=[a,b]; }
else if(fs.existsSync(OUT)){ try{ const a=JSON.parse(fs.readFileSync(OUT,'utf8')); if(a.center) CENTER=a.center; }catch(e){} }

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AniRacers — pick area</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body{margin:0;height:100%;font-family:system-ui,Segoe UI,sans-serif}
  #map{position:absolute;inset:0}
  #panel{position:absolute;top:12px;right:12px;z-index:1000;background:#fff;border-radius:12px;
    box-shadow:0 6px 24px rgba(0,0,0,.25);padding:14px 16px;width:300px;max-height:90vh;overflow:auto}
  #panel h2{margin:0 0 6px;font-size:16px}
  #panel p{margin:6px 0;font-size:12px;color:#444;line-height:1.4}
  .btn{display:inline-block;border:none;border-radius:8px;padding:9px 12px;margin:4px 4px 0 0;
    font:inherit;font-size:13px;color:#fff;cursor:pointer}
  .save{background:#2f7a3e}.save:disabled{background:#9bbfa3;cursor:default}
  .undo{background:#9a6b2f}.reset{background:#b03a3a}
  #stats{font-size:12px;background:#f4f5f7;border-radius:8px;padding:8px;margin-top:8px;white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace}
  #banner{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:1000;
    background:#1e7e34;color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;display:none;box-shadow:0 4px 16px rgba(0,0,0,.3)}
  .warn{color:#b03a3a;font-weight:600}
</style></head>
<body>
<div id="map"></div>
<div id="banner"></div>
<div id="panel">
  <h2>🏁 Pick the race area</h2>
  <p><b>Click</b> on the map to drop polygon points. <b>Click the first point again</b> (the green dot) to close the loop. Then press <b>Save area</b>.</p>
  <p>Layer:
     <label><input type="radio" name="ly" value="sat" checked> Satellite</label>
     <label><input type="radio" name="ly" value="street"> Street</label>
  </p>
  <div>
    <button class="btn save" id="save" disabled>💾 Save area</button>
    <button class="btn undo" id="undo">↶ Undo</button>
    <button class="btn reset" id="reset">✕ Reset</button>
  </div>
  <div id="stats">No points yet.</div>
</div>
<script>
const CENTER=${JSON.stringify(CENTER)};
const map=L.map('map',{center:CENTER,zoom:16});
const sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {maxZoom:20,attribution:'Esri'}).addTo(map);
const street=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'OpenStreetMap'});
document.querySelectorAll('input[name=ly]').forEach(r=>r.onchange=()=>{
  if(r.value==='sat'&&r.checked){map.addLayer(sat);map.removeLayer(street);}
  if(r.value==='street'&&r.checked){map.addLayer(street);map.removeLayer(sat);}
});

let pts=[], markers=[], line=null, poly=null, closed=false;
function redraw(){
  if(line){map.removeLayer(line);line=null;}
  if(poly){map.removeLayer(poly);poly=null;}
  const ll=pts.map(p=>[p.lat,p.lng]);
  if(closed&&ll.length>=3){ poly=L.polygon(ll,{color:'#1e7e34',weight:3,fillOpacity:.18}).addTo(map); }
  else if(ll.length>=2){ line=L.polyline(ll,{color:'#1e7e34',weight:3,dashArray:'6 5'}).addTo(map); }
  updateStats();
}
function addMarker(p,i){
  const first=i===0;
  const m=L.circleMarker(p,{radius:first?8:6,color:first?'#0a7d2c':'#1e7e34',
    fillColor:first?'#39d96a':'#7bd39a',fillOpacity:1,weight:2}).addTo(map);
  if(first) m.on('click',e=>{L.DomEvent.stop(e);tryClose();});
  markers.push(m);
}
function tryClose(){ if(!closed&&pts.length>=3){ closed=true; document.getElementById('save').disabled=false; redraw(); } }
map.on('click',e=>{
  if(closed) return;
  if(pts.length>=3){
    const a=map.latLngToContainerPoint(pts[0]), b=e.containerPoint;
    if(a.distanceTo(b)<14){ tryClose(); return; }
  }
  pts.push(e.latlng); addMarker(e.latlng, pts.length-1); redraw();
});
document.getElementById('undo').onclick=()=>{
  if(closed){closed=false;document.getElementById('save').disabled=true;}
  else { pts.pop(); const m=markers.pop(); if(m)map.removeLayer(m); }
  redraw();
};
document.getElementById('reset').onclick=()=>{
  pts=[]; markers.forEach(m=>map.removeLayer(m)); markers=[]; closed=false;
  document.getElementById('save').disabled=true; redraw();
};
function metrics(){
  if(pts.length<3) return null;
  const lat0=pts.reduce((s,p)=>s+p.lat,0)/pts.length;
  const mPerLat=110540, mPerLon=111320*Math.cos(lat0*Math.PI/180);
  // shoelace in metres
  let area=0;
  for(let i=0;i<pts.length;i++){ const a=pts[i],b=pts[(i+1)%pts.length];
    area+=(a.lng*mPerLon)*(b.lat*mPerLat)-(b.lng*mPerLon)*(a.lat*mPerLat); }
  area=Math.abs(area/2);
  const lats=pts.map(p=>p.lat), lngs=pts.map(p=>p.lng);
  const bbox={minlat:Math.min(...lats),maxlat:Math.max(...lats),minlon:Math.min(...lngs),maxlon:Math.max(...lngs)};
  const w=(bbox.maxlon-bbox.minlon)*mPerLon, h=(bbox.maxlat-bbox.minlat)*mPerLat;
  return {area,bbox,w,h};
}
function updateStats(){
  const el=document.getElementById('stats');
  if(pts.length===0){el.textContent='No points yet.';return;}
  let s=pts.length+' point'+(pts.length>1?'s':'')+(closed?' (closed ✔)':' (open)')+'\\n';
  const m=metrics();
  if(m){ s+='bbox ~ '+Math.round(m.w)+' × '+Math.round(m.h)+' m\\n';
    s+='area ~ '+(m.area/1e6).toFixed(3)+' km² ('+Math.round(m.area).toLocaleString()+' m²)\\n';
    if(Math.max(m.w,m.h)>1500) s+='⚠ large area — heavier to convert\\n'; }
  s+='\\n'+pts.map((p,i)=>(i+1)+': '+p.lat.toFixed(6)+', '+p.lng.toFixed(6)).join('\\n');
  el.textContent=s;
}
function banner(msg,err){ const b=document.getElementById('banner');
  b.textContent=msg; b.style.background=err?'#b03a3a':'#1e7e34'; b.style.display='block';
  if(!err) setTimeout(()=>{},0); }
document.getElementById('save').onclick=async()=>{
  if(!closed) return;
  const m=metrics();
  const body={ polygon: pts.map(p=>[+p.lat.toFixed(7),+p.lng.toFixed(7)]),
    bbox:m.bbox, areaM2:Math.round(m.area), center:[ (m.bbox.minlat+m.bbox.maxlat)/2,(m.bbox.minlon+m.bbox.maxlon)/2 ] };
  try{ const r=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.ok){ banner('✅ Saved! Switch back to Claude and say "done".'); }
    else banner('Save failed: '+r.status,true);
  }catch(e){ banner('Save failed: '+e,true); }
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try {
        const obj = JSON.parse(data);
        obj.savedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        fs.writeFileSync(OUT, JSON.stringify(obj, null, 2));
        console.log('\n[area-picker] SAVED polygon (' + obj.polygon.length + ' pts, ~' +
          (obj.areaM2/1e6).toFixed(3) + ' km²) -> ' + path.relative(ROOT, OUT));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) { res.writeHead(400); res.end(String(e)); }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});
server.listen(PORT, () => {
  console.log('Area picker ['+W.name+']:  http://localhost:' + PORT + '/');
  console.log('Draw your polygon, press "Save area", it writes ' + path.relative(ROOT, OUT));
});
