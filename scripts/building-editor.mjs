// Per-building editor: click a building footprint, SEE its real Street View photo,
// and set its TYPE (A apartment / B villa-flat / C villa-tiled) + storeys. Saves
// maps/mishkenot_zvulun/building-overrides.json for Claude to apply via OSM2World.
// Run:  node --env-file=.env scripts/building-editor.mjs   then open http://localhost:8767/
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.EDITOR_PORT || 8767);
const KEY = process.env.GMAPS_KEY || '';
const SVDIR = path.join(ROOT,'maps/mishkenot_zvulun/streetview'); fs.mkdirSync(SVDIR,{recursive:true});
const OVR = path.join(ROOT,'maps/mishkenot_zvulun/building-overrides.json');
const BJSON = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/buildings.json'),'utf8'));
const BYID = new Map(BJSON.buildings.map(b=>[b.id,b]));
const MIME = {'.html':'text/html','.glb':'model/gltf-binary','.json':'application/json','.jpg':'image/jpeg','.js':'text/javascript'};

const HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AniRacers — building editor</title><style>
  html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,Segoe UI,sans-serif;background:#9fd0f0}
  #gl,#draw{position:absolute;inset:0;width:100%;height:100%}
  #draw{touch-action:none;cursor:crosshair}
  #panel{position:absolute;top:10px;right:10px;z-index:10;background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:12px 14px;width:320px;max-height:95vh;overflow:auto}
  h2{margin:0 0 6px;font-size:15px}p{margin:5px 0;font-size:12px;color:#444;line-height:1.4}
  .btn{border:none;border-radius:8px;padding:8px 10px;margin:3px 4px 0 0;font:inherit;font-size:12px;color:#fff;cursor:pointer}
  .save{background:#2f7a3e}.bulk{background:#555}.clr{background:#b03a3a}
  #sv{width:100%;height:200px;object-fit:cover;border-radius:8px;background:#dde3ea;margin-top:6px}
  .ty{display:block;width:100%;text-align:left;border:2px solid #ddd;border-radius:8px;padding:7px 9px;margin:5px 0;background:#fafafa;cursor:pointer;font:inherit;font-size:12px}
  .ty.sel{border-color:#2f7a3e;background:#eef7ee}
  .sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:middle;margin-right:5px}
  #legend{font-size:11px;margin-top:8px}#legend span{margin-right:8px}
  .row{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px}
  #banner{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:20;background:#1e7e34;color:#fff;padding:9px 16px;border-radius:10px;font-size:13px;display:none}
  kbd{background:#eee;border:1px solid #ccc;border-radius:4px;padding:0 4px;font-size:11px}
  input[type=number]{width:54px;font:inherit;padding:3px}
</style></head><body>
<canvas id="gl"></canvas><canvas id="draw"></canvas><div id="banner"></div>
<div id="panel">
  <h2>🏘️ Edit buildings <span id="prog" style="font-weight:400;color:#777"></span></h2>
  <p><b>Click a building</b> to see its Street View &amp; set its type. <kbd>drag</kbd> pan · <kbd>wheel</kbd> zoom</p>
  <div id="sel">No building selected.</div>
  <img id="sv" style="display:none"/>
  <div id="svrow" class="row" style="display:none"><button class="btn bulk" id="svL">◀ look</button><span id="svcap" style="color:#777"></span><button class="btn bulk" id="svR">look ▶</button></div>
  <div id="types" style="display:none">
    <button class="ty" data-t="A"><span class="sw" style="background:#3b82f6"></span><b>A — Apartment block</b><br>white, flat roof, 4 storeys</button>
    <button class="ty" data-t="B"><span class="sw" style="background:#f59e0b"></span><b>B — Villa (flat roof)</b><br>cream, flat, 2 storeys</button>
    <button class="ty" data-t="C"><span class="sw" style="background:#e0552f"></span><b>C — Villa (tiled roof)</b><br>cream + red tiles, 2 storeys</button>
    <div class="row">storeys: <input type="number" id="lv" min="1" max="20" value="4"> <button class="btn bulk" id="applyLv">set</button></div>
  </div>
  <hr>
  <button class="btn bulk" id="fill">Auto-fill empties (by size)</button>
  <button class="btn clr" id="clear">Clear all</button>
  <button class="btn save" id="save">💾 Save</button>
  <div id="legend">Legend:
    <span><span class="sw" style="background:#888"></span>unset</span>
    <span><span class="sw" style="background:#3b82f6"></span>A</span>
    <span><span class="sw" style="background:#f59e0b"></span>B</span>
    <span><span class="sw" style="background:#e0552f"></span>C</span>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script>
var TYPES={A:{lv:4,legend:'#3b82f6'},B:{lv:2,legend:'#f59e0b'},C:{lv:2,legend:'#e0552f'}};
var glc=document.getElementById('gl'),drc=document.getElementById('draw'),dctx=drc.getContext('2d');
var renderer=new THREE.WebGLRenderer({canvas:glc,antialias:true}); renderer.setClearColor(0x9fd0f0);
var scene=new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff,0x6b7a55,0.95));
var sun=new THREE.DirectionalLight(0xfff1d0,0.9); sun.position.set(0.4,1,0.25); scene.add(sun);
var plane=new THREE.Plane(new THREE.Vector3(0,1,0),0), ray=new THREE.Raycaster();
var cam,center={x:0,z:0},halfH=600,W=1,H=1,DPR=Math.min(2,window.devicePixelRatio||1);
var BLD=[],ovr={},sel=null,svOff=0;

function resize(){W=innerWidth;H=innerHeight;renderer.setPixelRatio(DPR);renderer.setSize(W,H,false);
  drc.width=W*DPR;drc.height=H*DPR;drc.style.width=W+'px';drc.style.height=H+'px';dctx.setTransform(DPR,0,0,DPR,0,0);buildCam();render();}
function buildCam(){var asp=W/H,hw=halfH*asp;cam=new THREE.OrthographicCamera(-hw,hw,halfH,-halfH,0.1,20000);
  cam.position.set(center.x,5000,center.z);cam.up.set(0,0,-1);cam.lookAt(center.x,0,center.z);cam.updateProjectionMatrix();cam.updateMatrixWorld();}
function worldAt(px,py){var ndc=new THREE.Vector2((px/W)*2-1,-((py/H)*2-1));ray.setFromCamera(ndc,cam);
  var h=new THREE.Vector3();return ray.ray.intersectPlane(plane,h)?{x:h.x,z:h.z}:null;}
function toScreen(x,z){var v=new THREE.Vector3(x,0,z).project(cam);return {x:(v.x*0.5+0.5)*W,y:(-v.y*0.5+0.5)*H};}
function render(){renderer.render(scene,cam);drawOverlay();}
function legendFor(b){var o=ovr[b.id];return o?TYPES[o.type].legend:'#888';}
function drawOverlay(){dctx.clearRect(0,0,W,H);
  for(var i=0;i<BLD.length;i++){var b=BLD[i],f=b.foot;if(!f.length)continue;var o=ovr[b.id];
    dctx.beginPath();for(var k=0;k<f.length;k++){var s=toScreen(f[k][0],f[k][1]);k?dctx.lineTo(s.x,s.y):dctx.moveTo(s.x,s.y);}dctx.closePath();
    if(o){dctx.fillStyle=TYPES[o.type].legend;dctx.globalAlpha=b===sel?0.9:0.6;dctx.fill();dctx.globalAlpha=1;}
    else if(b===sel){dctx.fillStyle='#888';dctx.globalAlpha=0.55;dctx.fill();dctx.globalAlpha=1;}
    dctx.lineWidth=b===sel?3:1.2;dctx.strokeStyle=b===sel?'#111':(o?'#222':'#ffffffaa');dctx.stroke();}
}
function ptIn(b,x,z){var f=b.foot,c=false;for(var i=0,j=f.length-1;i<f.length;j=i++){
  var xi=f[i][0],zi=f[i][1],xj=f[j][0],zj=f[j][1];if(((zi>z)!=(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))c=!c;}return c;}

function selectAt(px,py){var w=worldAt(px,py);if(!w)return;var found=null;
  for(var i=0;i<BLD.length;i++){if(ptIn(BLD[i],w.x,w.z)){found=BLD[i];break;}}
  sel=found;svOff=0;showSel();render();}
function showSel(){
  var sd=document.getElementById('sel'),ty=document.getElementById('types'),sv=document.getElementById('sv'),svr=document.getElementById('svrow');
  if(!sel){sd.textContent='No building selected.';ty.style.display='none';sv.style.display='none';svr.style.display='none';return;}
  var o=ovr[sel.id];
  sd.innerHTML='<b>Building '+sel.id+'</b><br>footprint ~'+sel.area+' m² '+(sel.levels?('· OSM levels '+sel.levels):'')+
    '<br>now: '+(o?('<b>Type '+o.type+'</b>, '+o.lv+' storeys'):'<i>unset</i>');
  ty.style.display='block';sv.style.display='block';svr.style.display='flex';
  loadSV();
  document.querySelectorAll('.ty').forEach(function(btn){btn.classList.toggle('sel',!!o&&o.type===btn.dataset.t);});
  document.getElementById('lv').value=o?o.lv:(sel.area>250?4:2);
}
function loadSV(){var sv=document.getElementById('sv');sv.src='/sv?id='+sel.id+'&o='+svOff+'&_='+Date.now();
  document.getElementById('svcap').textContent='heading '+svOff+'°';}
function setType(t){if(!sel)return;var lv=TYPES[t].lv;if(ovr[sel.id])lv=ovr[sel.id].lv;ovr[sel.id]={type:t,lv:lv};afterEdit();}
function afterEdit(){showSel();drawOverlay();updProg();}
function updProg(){document.getElementById('prog').textContent='('+Object.keys(ovr).length+'/'+BLD.length+')';}

// interaction (pan/zoom/select)
var down=null,dragged=false,lastPx=null;
drc.addEventListener('pointerdown',function(e){if(e.button!==0)return;down={x:e.clientX,y:e.clientY};lastPx={x:e.clientX,y:e.clientY};dragged=false;drc.setPointerCapture(e.pointerId);});
drc.addEventListener('pointermove',function(e){if(!down)return;if(Math.abs(e.clientX-down.x)+Math.abs(e.clientY-down.y)>4)dragged=true;
  if(dragged){var a=worldAt(lastPx.x,lastPx.y),b=worldAt(e.clientX,e.clientY);if(a&&b){center.x+=a.x-b.x;center.z+=a.z-b.z;buildCam();render();}lastPx={x:e.clientX,y:e.clientY};}});
drc.addEventListener('pointerup',function(e){if(e.button!==0){down=null;return;}if(!dragged)selectAt(e.clientX,e.clientY);down=null;});
drc.addEventListener('wheel',function(e){e.preventDefault();var b4=worldAt(e.clientX,e.clientY);
  halfH=Math.max(30,Math.min(1500,halfH*(e.deltaY>0?1.12:0.89)));buildCam();var af=worldAt(e.clientX,e.clientY);
  if(b4&&af){center.x+=b4.x-af.x;center.z+=b4.z-af.z;buildCam();}render();},{passive:false});

document.querySelectorAll('.ty').forEach(function(btn){btn.onclick=function(){setType(btn.dataset.t);};});
document.getElementById('applyLv').onclick=function(){if(!sel||!ovr[sel.id])return;ovr[sel.id].lv=Math.max(1,+document.getElementById('lv').value||1);afterEdit();};
document.getElementById('svL').onclick=function(){svOff=(svOff-40);loadSV();};
document.getElementById('svR').onclick=function(){svOff=(svOff+40);loadSV();};
document.getElementById('fill').onclick=function(){BLD.forEach(function(b){if(!ovr[b.id])ovr[b.id]={type:b.area>250?'A':'B',lv:b.area>250?4:2};});afterEdit();};
document.getElementById('clear').onclick=function(){ovr={};sel=null;showSel();afterEdit();};
function banner(t,err){var b=document.getElementById('banner');b.textContent=t;b.style.background=err?'#b03a3a':'#1e7e34';b.style.display='block';}
document.getElementById('save').onclick=function(){
  fetch('/save-buildings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({overrides:ovr})})
    .then(function(r){banner(r.ok?'✅ Saved! Switch to Claude and say "apply".':'Save failed',!r.ok);});
};
window.addEventListener('resize',resize);
// load data + world
fetch('/maps/mishkenot_zvulun/buildings.json').then(function(r){return r.json();}).then(function(j){
  BLD=j.buildings; updProg();
  new THREE.GLTFLoader().load('/assets/mishkenot/world.glb',function(g){
    g.scene.traverse(function(o){if(o.isMesh)o.material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});else if(o.isLine||o.isLineSegments)o.visible=false;});
    scene.add(g.scene);var bb=new THREE.Box3().setFromObject(g.scene),c=bb.getCenter(new THREE.Vector3()),s=bb.getSize(new THREE.Vector3());
    center={x:c.x,z:c.z};halfH=Math.max(s.x,s.z)*0.58;resize();
  });
});
</script></body></html>`;

function bearing(la1,lo1,la2,lo2){var r=Math.PI/180;var y=Math.sin((lo2-lo1)*r)*Math.cos(la2*r);
  var x=Math.cos(la1*r)*Math.sin(la2*r)-Math.sin(la1*r)*Math.cos(la2*r)*Math.cos((lo2-lo1)*r);
  return (Math.atan2(y,x)/r+360)%360;}

const server=http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://x');
  if(req.method==='POST'&&u.pathname==='/save-buildings'){let d='';req.on('data',c=>d+=c);req.on('end',()=>{
    try{var o=JSON.parse(d);o.savedAt=new Date().toISOString().replace(/\.\d+Z$/,'Z');o.count=Object.keys(o.overrides).length;
      fs.writeFileSync(OVR,JSON.stringify(o,null,2));console.log('[building-editor] SAVED '+o.count+' overrides -> building-overrides.json');
      res.writeHead(200);res.end('{"ok":true}');}catch(e){res.writeHead(400);res.end(String(e));}});return;}
  if(u.pathname==='/sv'){
    const b=BYID.get(u.searchParams.get('id')); const off=parseInt(u.searchParams.get('o')||'0',10)||0;
    if(!b||!KEY){res.writeHead(204);return res.end();}
    const cache=path.join(SVDIR,'bld_'+b.id+'_o'+off+'.jpg');
    if(fs.existsSync(cache)){res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end(fs.readFileSync(cache));}
    try{
      const meta=await (await fetch('https://maps.googleapis.com/maps/api/streetview/metadata?location='+b.clat+','+b.clon+'&radius=90&key='+KEY)).json();
      if(meta.status!=='OK'){res.writeHead(204);return res.end();}
      const head=(bearing(meta.location.lat,meta.location.lng,b.clat,b.clon)+off+360)%360;
      const img=Buffer.from(await (await fetch('https://maps.googleapis.com/maps/api/streetview?size=480x300&location='+meta.location.lat+','+meta.location.lng+'&heading='+head.toFixed(1)+'&fov=75&pitch=8&key='+KEY)).arrayBuffer());
      fs.writeFileSync(cache,img);res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end(img);
    }catch(e){res.writeHead(204);return res.end();}
  }
  if(u.pathname==='/'||u.pathname===''){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(HTML);}
  const f=path.join(ROOT,decodeURIComponent(u.pathname));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
});
server.listen(PORT,()=>{console.log('Building editor:  http://localhost:'+PORT+'/   ('+BJSON.count+' buildings'+(KEY?'':' — NO GMAPS_KEY, Street View disabled')+')');});
