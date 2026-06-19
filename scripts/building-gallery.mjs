// Building GALLERY: renders EVERY Mishkenot building's 3D model (the exact same models
// baked into the game, via the shared house-factory.js) laid out in sorted rows, each
// model standing next to its real Street View photo for side-by-side comparison.
// Click a building to see its full spec + big photo and (optionally) tweak it.
// Run: node scripts/building-gallery.mjs   then open http://localhost:8769/
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.GALLERY_PORT || 8769);
const SVDIR = path.join(ROOT,'maps/mishkenot_zvulun/streetview');
const BLD = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/buildings.json'),'utf8')).buildings;
const SPECJ = (()=>{ try{return JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/building-specs.json'),'utf8'));}catch(e){return {specs:{}};} })();
const SPECS = SPECJ.specs||{};
const BYID = new Map(BLD.map(b=>[b.id,b]));

// gallery data: every building that has a spec, with its footprint + photo availability
function galleryData(){
  const order = {tower:0,apartment:1,villa:2,house:3};
  const items = Object.keys(SPECS).map(id=>{
    const b=BYID.get(id)||{}; const s=SPECS[id];
    return { id, foot:b.foot||[], area:b.area||null, levels:b.levels||null, spec:s,
      photo: fs.existsSync(path.join(SVDIR,'bld_'+id+'.jpg')) };
  }).filter(it=>it.foot.length>=3);
  items.sort((a,b)=> (order[a.spec.style]??9)-(order[b.spec.style]??9) || (b.spec.floors-a.spec.floors) || a.id.localeCompare(b.id));
  return items;
}

const MIME={'.js':'text/javascript','.jpg':'image/jpeg','.json':'application/json','.html':'text/html'};
const HTML = String.raw`<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
<title>AniRacers — building gallery (all ${Object.keys(SPECS).length})</title><style>
 html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,Segoe UI,sans-serif;background:#aee0ff}
 #c{position:absolute;inset:0}
 #bar{position:absolute;top:0;left:0;right:0;z-index:5;background:#ffffffea;padding:7px 12px;display:flex;gap:14px;align-items:center;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.15)}
 #bar b{font-size:14px}#bar .leg span{margin-right:10px}#bar input{font:inherit;padding:4px 7px;border:1px solid #bbb;border-radius:6px;width:130px}
 .sw{display:inline-block;width:11px;height:11px;border-radius:3px;vertical-align:middle;margin-right:4px}
 #panel{position:absolute;top:50px;right:10px;z-index:6;width:330px;background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.3);padding:12px 14px;display:none;max-height:88vh;overflow:auto}
 #panel h3{margin:0 0 6px}#panel img{width:100%;border-radius:8px;background:#dde3ea;margin:6px 0}
 #panel table{font-size:12px;border-collapse:collapse;width:100%}#panel td{padding:2px 4px;border-bottom:1px solid #eee}
 #hint{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:5;background:#000a;color:#fff;padding:6px 12px;border-radius:8px;font-size:12px}
 #panel .close{float:right;cursor:pointer;color:#999;font-size:18px;line-height:1}
</style></head><body>
<canvas id=c></canvas>
<div id=bar>
 <b>🏘️ All buildings</b><span id=cnt></span>
 <span class=leg>sorted: towers → apartments → villas → houses</span>
 <input id=search placeholder="jump to id / # ...">
 <span class=leg style="margin-left:auto">
   <span><span class=sw style="background:#5b9bd5"></span>tower</span>
   <span><span class=sw style="background:#70ad47"></span>apartment</span>
   <span><span class=sw style="background:#ed7d31"></span>villa</span>
   <span><span class=sw style="background:#ffc000"></span>house</span></span>
</div>
<div id=panel><span class=close onclick="document.getElementById('panel').style.display='none'">×</span><div id=pbody></div></div>
<div id=hint>drag to orbit · wheel to zoom · right-drag to pan · click a building</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script src="/house-factory.js"></script>
<script>
var STYLECOL={tower:'#5b9bd5',apartment:'#70ad47',villa:'#ed7d31',house:'#ffc000'};
var renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true});
renderer.setPixelRatio(Math.min(2,devicePixelRatio||1));renderer.setSize(innerWidth,innerHeight);
renderer.outputEncoding=THREE.sRGBEncoding;
var scene=new THREE.Scene();scene.background=new THREE.Color(0xaee0ff);scene.fog=new THREE.Fog(0xaee0ff,700,2400);
scene.add(new THREE.HemisphereLight(0xffffff,0x7c8a66,0.95));
var sun=new THREE.DirectionalLight(0xfff3d8,0.85);sun.position.set(0.5,1,0.35);scene.add(sun);
var cam=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,0.5,6000);
var controls=new THREE.OrbitControls(cam,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=0.08;
var ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
var PITCH_X=42,PITCH_Z=46,COLS=24,texLoader=new THREE.TextureLoader();
var picks=[],byId={};

fetch('/gallery-data.json').then(r=>r.json()).then(function(items){
  document.getElementById('cnt').textContent='('+items.length+')';
  var rows=Math.ceil(items.length/COLS);
  var gx=(COLS-1)*PITCH_X/2, gz=(rows-1)*PITCH_Z/2;
  // big grass ground
  var ground=new THREE.Mesh(new THREE.PlaneGeometry(COLS*PITCH_X+120,rows*PITCH_Z+120),new THREE.MeshLambertMaterial({color:0x86b56a}));
  ground.rotation.x=-Math.PI/2;ground.position.set(0,-0.05,0);scene.add(ground);
  for(var i=0;i<items.length;i++){
    var it=items[i];var col=i%COLS,row=(i/COLS)|0;
    var x=col*PITCH_X-gx, z=-(row*PITCH_Z-gz);
    var o=obb(it.foot);var W=Math.max(6,Math.min(80,o.W)),D=Math.max(6,Math.min(60,o.D));
    var s=it.spec;var p={W:W,D:D,floors:s.floors,wall:s.wall,roof:s.roof,roofColor:s.roofColor,glass:s.glass||'#6b8194',
      cols:s.cols,balconies:s.balconies,doors:s.doors,shutters:s.shutters,stoneBase:s.stoneBase,solar:s.solar};
    var model=makeBuilding(p);model.position.set(x,0,z);scene.add(model);
    // concrete pad
    var pad=new THREE.Mesh(new THREE.PlaneGeometry(Math.max(W,18)+5,Math.max(D,12)+5),new THREE.MeshLambertMaterial({color:(STYLECOL[s.style]||'#ccc')}));
    pad.rotation.x=-Math.PI/2;pad.position.set(x,0.02,z);pad.material.transparent=true;pad.material.opacity=0.35;scene.add(pad);
    // photo billboard to the right of the model, facing camera (+Z)
    if(it.photo){ var tex=texLoader.load('/sv/'+it.id+'.jpg');tex.encoding=THREE.sRGBEncoding;
      var pm=new THREE.Mesh(new THREE.PlaneGeometry(16,10),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
      pm.position.set(x+Math.max(W,18)/2+10,5.4,z+ D/2 - 2);scene.add(pm);
      var frame=new THREE.Mesh(new THREE.PlaneGeometry(16.6,10.6),new THREE.MeshBasicMaterial({color:0xffffff}));
      frame.position.set(pm.position.x,pm.position.y,pm.position.z-0.05);scene.add(frame);
    }
    // label sprite
    var lab=makeLabel('#'+(i+1)+'  ·  '+s.floors+'fl  ·  '+s.style);
    lab.position.set(x,Math.max(s.floors*3+4,8),z);scene.add(lab);
    // pick target = the main mass (first child mesh); tag the whole model
    model.userData={item:it,index:i,x:x,z:z};
    model.traverse(function(m){if(m.isMesh)m.userData.owner=model;});
    picks.push(model);byId[it.id]=model;
  }
  // frame the whole grid
  controls.target.set(0,8,0);
  cam.position.set(-gx*0.2, Math.max(rows,COLS)*16, gz+ rows*PITCH_Z*0.15 + 120);
  controls.update();
});
function makeLabel(text){
  var cv=document.createElement('canvas');cv.width=256;cv.height=48;var ctx=cv.getContext('2d');
  ctx.fillStyle='rgba(20,20,28,0.82)';ctx.fillRect(0,0,256,48);ctx.fillStyle='#fff';ctx.font='bold 22px system-ui';ctx.textBaseline='middle';ctx.fillText(text,10,26);
  var t=new THREE.CanvasTexture(cv);t.encoding=THREE.sRGBEncoding;
  var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:false}));sp.scale.set(13,2.4,1);sp.renderOrder=999;return sp;
}
function showPanel(model){
  var it=model.userData.item,s=it.spec,p=document.getElementById('panel');
  var rows=[['id',it.id],['style',s.style],['floors',s.floors],['wall','<span class=sw style="background:'+s.wall+'"></span>'+s.wall],
   ['roof',s.roof+' <span class=sw style="background:'+s.roofColor+'"></span>'+s.roofColor],['windows/floor',s.cols],
   ['balconies',s.balconies],['doors',s.doors],['shutters',s.shutters],['stone base',s.stoneBase],['solar',s.solar],
   ['conf',s.conf],['OSM levels',it.levels],['area m²',it.area]];
  document.getElementById('pbody').innerHTML='<h3>#'+(model.userData.index+1)+' · building '+it.id+'</h3>'+
    (it.photo?'<img src="/sv/'+it.id+'.jpg">':'<i>no photo</i>')+
    '<table>'+rows.map(function(r){return '<tr><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>';}).join('')+'</table>';
  p.style.display='block';
}
function focusModel(model){ var u=model.userData;controls.target.set(u.x,8,u.z);
  cam.position.set(u.x-26,30,u.z+46);controls.update();showPanel(model);
  picks.forEach(function(m){m.traverse(function(o){if(o.isMesh&&o.material&&o.material.emissive)o.material.emissive.setHex(0);});});
}
renderer.domElement.addEventListener('pointerdown',function(e){ if(e.button!==0)return;
  mouse.x=(e.clientX/innerWidth)*2-1;mouse.y=-(e.clientY/innerHeight)*2+1;ray.setFromCamera(mouse,cam);
  var hits=ray.intersectObjects(picks,true);
  if(hits.length){var o=hits[0].object;while(o&&!o.userData.item)o=o.parent;if(o)showPanel(o);}
});
document.getElementById('search').addEventListener('change',function(e){
  var v=e.target.value.trim();var m=null;
  if(/^#?\d+$/.test(v)&&v.replace('#','')*1<=picks.length&&v.indexOf('#')===0)m=picks[v.slice(1)*1-1];
  if(!m&&byId[v])m=byId[v];
  if(!m){picks.forEach(function(pk){if(pk.userData.item.id===v)m=pk;});}
  if(m)focusModel(m);else alert('not found: '+v);
});
addEventListener('resize',function(){cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
(function loop(){requestAnimationFrame(loop);controls.update();renderer.render(scene,cam);})();
</script></body></html>`;

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/'||u.pathname===''){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(HTML);}
  if(u.pathname==='/house-factory.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(fs.readFileSync(path.join(ROOT,'scripts/house-factory.js')));}
  if(u.pathname==='/gallery-data.json'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(galleryData()));}
  const sv=u.pathname.match(/^\/sv\/(.+)\.jpg$/);
  if(sv){const f=path.join(SVDIR,'bld_'+sv[1]+'.jpg');if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end(fs.readFileSync(f));}res.writeHead(404);return res.end();}
  res.writeHead(404);res.end('nf');
});
server.listen(PORT,()=>console.log('Building gallery:  http://localhost:'+PORT+'/   ('+Object.keys(SPECS).length+' buildings)'));
