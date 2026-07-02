// Single-building INSPECTOR: a focused local viewer for ONE building at a time. Renders the
// building's exact in-game model (shared house-factory.js) big, with orbit controls, beside its
// real Street View photos (centre/left/right) and its spec. A dropdown switches between the
// Hartum-area buildings. Spec is read FRESH from building-specs.json on every load, so after you
// edit a building's spec you just refresh the page.
//
// Run:  node scripts/building-inspector.mjs --world=netanya   then open the printed URL.
import http from 'http'; import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
const PORT = Number(process.env.INSPECTOR_PORT || 8770);
const SVDIR = W.paths.streetview;
const BLD = JSON.parse(fs.readFileSync(W.paths.buildings,'utf8')).buildings;
const BYID = new Map(BLD.map(b=>[b.id,b]));
const readSpecs = () => { try { return JSON.parse(fs.readFileSync(W.paths.specs,'utf8')).specs||{}; } catch(e){ return {}; } };

// Hartum-area building ids (within ~40m of Hartum St / הרטום), nearest first — the switch list.
const HARTUM = ["383409997","383410026","383409983","383409987","556598028","556597980","556598012","556597979","556598014","556597987","556597988","556597997","556597998","556598030","556597973","556597978","556598034"];
const DEFAULT_ID = HARTUM.find(id=>BYID.has(id)) || BLD[0].id;
const has = (id,suf) => fs.existsSync(path.join(SVDIR,'bld_'+id+suf+'.jpg'));
function dataFor(id){
  const b = BYID.get(id); if(!b) return null;
  const spec = readSpecs()[id] || null;
  return { id, spec, foot:b.foot||[], area:b.area||null, levels:b.levels||null,
    views:{ c:has(id,''), l:has(id,'_l'), r:has(id,'_r') } };
}
function hartumList(){ const specs=readSpecs();
  return HARTUM.filter(id=>BYID.has(id)).map(id=>{ const s=specs[id]||{}; return { id, label:'#'+id+'  ·  '+(s.style||'?')+' '+(s.floors||'?')+'fl' }; }); }

const HTML = String.raw`<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Building inspector</title><style>
 html,body{margin:0;height:100%;font-family:system-ui,Segoe UI,sans-serif;background:#aee0ff;overflow:hidden}
 #c{position:absolute;left:0;top:0;bottom:0;right:430px}
 #side{position:absolute;right:0;top:0;bottom:0;width:430px;background:#fff;box-shadow:-2px 0 12px rgba(0,0,0,.25);overflow:auto;padding:12px 14px;box-sizing:border-box}
 #side h2{margin:.2em 0;font-size:17px}#side h3{margin:.8em 0 .3em;font-size:13px;color:#555;text-transform:uppercase;letter-spacing:.04em}
 select{font:inherit;padding:5px 8px;border:1px solid #bbb;border-radius:7px;width:100%}
 .photos{display:flex;gap:4px;margin:6px 0}.photos figure{margin:0;flex:1}.photos img{width:100%;border-radius:7px;background:#dde3ea;display:block}
 .photos figcaption{font-size:11px;color:#888;text-align:center}
 table{font-size:12.5px;border-collapse:collapse;width:100%}td{padding:3px 5px;border-bottom:1px solid #eee}td:first-child{color:#777;width:42%}
 .sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:middle;margin-right:5px;border:1px solid #0002}
 #hint{position:absolute;left:12px;bottom:10px;background:#000a;color:#fff;padding:6px 11px;border-radius:8px;font-size:12px}
 a.big{display:block;margin-top:8px;font-size:12px;color:#06c}
</style></head><body>
<canvas id=c></canvas>
<div id=side>
 <h2 id=ttl>building</h2>
 <select id=sw></select>
 <div class=photos id=photos></div>
 <h3>spec</h3><table id=spec></table>
 <a class=big href="#" id=reload>↻ reload spec from disk</a>
 <p style="font-size:12px;color:#777">Edit this building's entry in <code>building-specs.json</code>, then hit reload. To push it into the game, rebuild <code>world.glb</code>.</p>
</div>
<div id=hint>drag = orbit · wheel = zoom · right-drag = pan</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script src="/house-factory.js"></script>
<script>
var qs=new URLSearchParams(location.search), ID=qs.get('id')||'';
var cv=document.getElementById('c');
var renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true});renderer.outputEncoding=THREE.sRGBEncoding;
var scene=new THREE.Scene();scene.background=new THREE.Color(0xaee0ff);
scene.add(new THREE.HemisphereLight(0xffffff,0x8a9676,1.0));
var sun=new THREE.DirectionalLight(0xfff3d8,0.8);sun.position.set(0.6,1,0.4);scene.add(sun);
var cam=new THREE.PerspectiveCamera(48,1,0.3,4000);
var controls=new THREE.OrbitControls(cam,renderer.domElement);controls.enableDamping=true;
var ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshLambertMaterial({color:0x86b56a}));
ground.rotation.x=-Math.PI/2;ground.position.y=-0.05;scene.add(ground);
var current=null;
function size(){var w=Math.max(50,innerWidth-430),h=innerHeight;renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));renderer.setSize(w,h,true);cam.aspect=w/h;cam.updateProjectionMatrix();}
size();
addEventListener('resize',size);
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function build(d){
  if(current){scene.remove(current);current.traverse(function(o){if(o.geometry)o.geometry.dispose();});}
  var s=d.spec||{floors:2,wall:'#eaeaea',roof:'flat'};
  var o=obb(d.foot), Wd=clamp(o.W,6,130), Dd=clamp(o.D,6,100);
  var p={W:Wd,D:Dd,floors:Math.max(1,s.floors||2),wall:s.wall||'#eaeaea',accent:s.accent||null,accent2:s.accent2||null,roof:s.roof||'flat',
    roofColor:s.roofColor||'#cccccc',glass:'#464a4e',cols:s.cols,winShape:s.winShape||'rect',
    balconyType:s.balconyType||(s.balconies?'open':'none'),balconies:!!s.balconies,doors:s.doors||1,
    shutters:!!s.shutters,stoneBase:!!s.stoneBase,ground:s.ground||'res',bands:!!s.bands,vbands:!!s.vbands,
    parapet:s.parapet||'plain',roofGear:s.roofGear||(s.solar?['solar']:[]),solar:!!s.solar,setback:!!s.setback};
  var fr=polyArea(d.foot)/(o.W*o.D), complex=fr<0.88, model;
  if(complex){ model=makeFootprintBuilding(d.foot,p); model.position.set(-o.cx,0,-o.cz); }
  else { model=makeBuilding(p); model.rotation.y=-o.theta; }
  scene.add(model);current=model;
  size();  // ensure cam.aspect is correct before framing
  model.updateMatrixWorld(true);  // so the bbox reflects rotation/position, not local geometry
  var bb=new THREE.Box3().setFromObject(model),c3=bb.getCenter(new THREE.Vector3()),sz=bb.getSize(new THREE.Vector3());
  var maxd=Math.max(sz.x,sz.y,sz.z),dist=maxd/(2*Math.tan(cam.fov*Math.PI/360))*1.45;
  controls.target.copy(c3);cam.position.set(c3.x+dist*0.85,c3.y+dist*0.45,c3.z+dist*0.95);controls.update();
  // side panel
  document.getElementById('ttl').textContent='#'+d.id+'  ·  '+(s.style||'?')+'  ·  '+(s.floors||'?')+' floors';
  var v=d.views,pics=[['','centre'],['_l','left'],['_r','right']].filter(function(q){return v[q[0]==''?'c':q[0].slice(1)];});
  document.getElementById('photos').innerHTML=pics.map(function(q){return '<figure><img src="/sv/'+d.id+q[0]+'.jpg"><figcaption>'+q[1]+'</figcaption></figure>';}).join('')||'<i>no photos</i>';
  var sw=function(c){return c?('<span class=sw style="background:'+c+'"></span>'+c):'—';};
  var rows=[['style',s.style],['floors',s.floors],['wall',sw(s.wall)],['accent',sw(s.accent)],['accent2',sw(s.accent2)],['roof',s.roof+' '+sw(s.roofColor)],
   ['parapet',s.parapet],['windows/floor',s.cols],['win shape',s.winShape],['balcony',s.balconyType],['doors',s.doors],
   ['shutters',s.shutters],['ground',s.ground],['bands',s.bands],['v-panels',s.vbands],['stone base',s.stoneBase],
   ['roof gear',(s.roofGear&&s.roofGear.length)?s.roofGear.join(', '):'—'],['setback',s.setback],['conf',s.conf],
   ['OSM levels',d.levels],['area m²',d.area]];
  document.getElementById('spec').innerHTML=rows.map(function(r){return '<tr><td>'+r[0]+'</td><td>'+(r[1]==null?'—':r[1])+'</td></tr>';}).join('');
  size();
}
function load(id){fetch('/data/'+id+'.json').then(function(r){return r.json();}).then(function(d){if(!d){alert('no building '+id);return;}ID=id;history.replaceState(0,'','?id='+id);build(d);});}
fetch('/hartum.json').then(function(r){return r.json();}).then(function(list){
  var sel=document.getElementById('sw');
  sel.innerHTML=list.map(function(it){return '<option value="'+it.id+'"'+(it.id===ID?' selected':'')+'>'+it.label+'</option>';}).join('');
  if(!ID){ID=list[0].id;}
  if(sel.value!==ID){sel.value=ID;}
  sel.addEventListener('change',function(){load(sel.value);});
  load(ID||list[0].id);
});
document.getElementById('reload').addEventListener('click',function(e){e.preventDefault();load(ID);});
(function loop(){requestAnimationFrame(loop);controls.update();renderer.render(scene,cam);})();
</script></body></html>`;

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/'||u.pathname===''){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(HTML);}
  if(u.pathname==='/house-factory.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(fs.readFileSync(path.join(ROOT,'scripts/house-factory.js')));}
  if(u.pathname==='/hartum.json'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(hartumList()));}
  const dm=u.pathname.match(/^\/data\/(.+)\.json$/);
  if(dm){const d=dataFor(dm[1]);res.writeHead(d?200:404,{'Content-Type':'application/json'});return res.end(JSON.stringify(d||null));}
  const sv=u.pathname.match(/^\/sv\/(.+)\.jpg$/);
  if(sv){const f=path.join(SVDIR,'bld_'+sv[1]+'.jpg');if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end(fs.readFileSync(f));}res.writeHead(404);return res.end();}
  res.writeHead(404);res.end('nf');
});
server.listen(PORT,()=>{
  console.log('Building inspector:  http://localhost:'+PORT+'/?id='+DEFAULT_ID);
  console.log('(switch buildings with the dropdown; '+hartumList().length+' Hartum-area buildings)');
});
