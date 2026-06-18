// Track editor: trace the kart racing line on the Mishkenot Zvulun world from above.
// Renders assets/mishkenot/world.glb top-down (three.js ortho). Click to drop track
// waypoints on the ground; DRAG to pan, WHEEL to zoom, RIGHT-CLICK to undo, click the
// first point (or "Close loop") to close. Shows a live Catmull racing line at the real
// road width. "Save track" writes maps/mishkenot_zvulun/track.json for Claude to apply.
// Run:  node scripts/track-editor.mjs   then open  http://localhost:8766/
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'maps', 'mishkenot_zvulun', 'track.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const PORT = Number(process.env.EDITOR_PORT || 8766);
const MIME = { '.html':'text/html', '.glb':'model/gltf-binary', '.json':'application/json',
               '.png':'image/png', '.js':'text/javascript', '.bin':'application/octet-stream' };

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AniRacers — track editor</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,Segoe UI,sans-serif;background:#9fd0f0}
  #gl,#draw{position:absolute;inset:0;width:100%;height:100%}
  #draw{touch-action:none;cursor:crosshair}
  #panel{position:absolute;top:12px;left:12px;z-index:10;background:#fff;border-radius:12px;
    box-shadow:0 6px 24px rgba(0,0,0,.25);padding:12px 14px;width:280px}
  #panel h2{margin:0 0 6px;font-size:15px}
  #panel p{margin:5px 0;font-size:12px;color:#444;line-height:1.45}
  .btn{border:none;border-radius:8px;padding:8px 11px;margin:4px 4px 0 0;font:inherit;font-size:13px;color:#fff;cursor:pointer}
  .save{background:#2f7a3e}.save:disabled{background:#9bbfa3;cursor:default}
  .undo{background:#9a6b2f}.reset{background:#b03a3a}.close{background:#2f6fd6}
  #stats{font-size:12px;background:#f4f5f7;border-radius:8px;padding:7px;margin-top:8px;white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace}
  kbd{background:#eee;border-radius:4px;padding:0 4px;border:1px solid #ccc;font-size:11px}
  #banner{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:20;background:#1e7e34;color:#fff;
    padding:10px 18px;border-radius:10px;font-size:14px;display:none;box-shadow:0 4px 16px rgba(0,0,0,.3)}
</style></head>
<body>
<canvas id="gl"></canvas><canvas id="draw"></canvas>
<div id="banner"></div>
<div id="panel">
  <h2>🏁 Draw the kart track</h2>
  <p><b>Click</b> on a street to drop track points. <b>Click the first (green) point</b> to close the loop, then <b>Save track</b>.</p>
  <p><kbd>drag</kbd> pan &nbsp; <kbd>wheel</kbd> zoom &nbsp; <kbd>right-click</kbd> undo</p>
  <div>
    <button class="btn close" id="close">⭯ Close loop</button>
    <button class="btn undo" id="undo">↶ Undo</button>
    <button class="btn reset" id="reset">✕ Clear</button>
    <button class="btn save" id="save" disabled>💾 Save track</button>
  </div>
  <div id="stats">Loading world…</div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script>
const ROAD_W=16;                        // metres — must match the game's ROAD_W
const glc=document.getElementById('gl'), drc=document.getElementById('draw');
const renderer=new THREE.WebGLRenderer({canvas:glc,antialias:true});
renderer.setClearColor(0x9fd0f0);
const scene=new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff,0x6b7a55,0.95));
const sun=new THREE.DirectionalLight(0xfff1d0,0.9); sun.position.set(0.4,1,0.25); scene.add(sun);
const dctx=drc.getContext('2d');
const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
const ray=new THREE.Raycaster();

let cam, center={x:0,z:0}, halfH=400;    // ortho view state (world metres)
let pts=[], closed=false;
let W=1, H=1, DPR=Math.min(2,window.devicePixelRatio||1);

function resize(){
  W=window.innerWidth; H=window.innerHeight;
  renderer.setPixelRatio(DPR); renderer.setSize(W,H,false);
  drc.width=W*DPR; drc.height=H*DPR; drc.style.width=W+'px'; drc.style.height=H+'px';
  dctx.setTransform(DPR,0,0,DPR,0,0);
  buildCam(); render();
}
function buildCam(){
  const asp=W/H, hw=halfH*asp;
  cam=new THREE.OrthographicCamera(-hw,hw,halfH,-halfH,0.1,20000);
  cam.position.set(center.x,5000,center.z); cam.up.set(0,0,-1); cam.lookAt(center.x,0,center.z);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}
function worldAt(px,py){               // screen px -> world (x,z) on y=0
  const ndc=new THREE.Vector2((px/W)*2-1, -((py/H)*2-1));
  ray.setFromCamera(ndc,cam);
  const hit=new THREE.Vector3();
  return ray.ray.intersectPlane(plane,hit)?{x:hit.x,z:hit.z}:null;
}
function toScreen(x,z){                 // world -> screen px
  const v=new THREE.Vector3(x,0,z).project(cam);
  return {x:(v.x*0.5+0.5)*W, y:(-v.y*0.5+0.5)*H};
}
function mPerPx(){ return (2*halfH)/H; }  // metres per screen pixel

function render(){ renderer.render(scene,cam); drawOverlay(); }
function drawOverlay(){
  dctx.clearRect(0,0,W,H);
  if(pts.length===0) return;
  const sp=pts.map(p=>toScreen(p.x,p.z));
  // smoothed racing line (Catmull, matches the game) + road width
  if(pts.length>=2){
    const v3=pts.map(p=>new THREE.Vector3(p.x,0,p.z));
    const curve=new THREE.CatmullRomCurve3(v3, closed, 'catmullrom', 0.5);
    const n=Math.max(60,pts.length*24);
    const path=curve.getPoints(n).map(p=>toScreen(p.x,p.z));
    const roadPx=ROAD_W/mPerPx();
    dctx.lineJoin='round'; dctx.lineCap='round';
    dctx.strokeStyle='rgba(40,42,48,.55)'; dctx.lineWidth=Math.max(2,roadPx);
    dctx.beginPath(); path.forEach((p,i)=>i?dctx.lineTo(p.x,p.y):dctx.moveTo(p.x,p.y)); dctx.stroke();
    dctx.strokeStyle='#ffe14d'; dctx.lineWidth=2; dctx.setLineDash([7,6]);
    dctx.beginPath(); path.forEach((p,i)=>i?dctx.lineTo(p.x,p.y):dctx.moveTo(p.x,p.y)); dctx.stroke();
    dctx.setLineDash([]);
  }
  // waypoints
  sp.forEach((p,i)=>{
    dctx.beginPath(); dctx.arc(p.x,p.y,i===0?7:5,0,7);
    dctx.fillStyle=i===0?'#39d96a':'#fff'; dctx.fill();
    dctx.lineWidth=2; dctx.strokeStyle=i===0?'#0a7d2c':'#1e7e34'; dctx.stroke();
  });
}
function trackLength(){
  if(pts.length<2) return 0;
  const v3=pts.map(p=>new THREE.Vector3(p.x,0,p.z));
  return new THREE.CatmullRomCurve3(v3,closed,'catmullrom',0.5).getLength();
}
function updateStats(){
  const el=document.getElementById('stats');
  el.textContent=pts.length+' point'+(pts.length!=1?'s':'')+(closed?' (closed ✔)':' (open)')+
    '\\nlength ~ '+Math.round(trackLength())+' m'+
    '\\nview half-height '+Math.round(halfH)+' m';
  document.getElementById('save').disabled=!(closed&&pts.length>=3);
}

// ---- interaction ----
let down=null, dragged=false, lastPx=null;
drc.addEventListener('pointerdown',e=>{ if(e.button!==0)return; down={x:e.clientX,y:e.clientY}; lastPx={x:e.clientX,y:e.clientY}; dragged=false; drc.setPointerCapture(e.pointerId); });
drc.addEventListener('pointermove',e=>{
  if(!down) return;
  if(Math.abs(e.clientX-down.x)+Math.abs(e.clientY-down.y)>4) dragged=true;
  if(dragged){ // pan: keep the world point under the cursor fixed
    const a=worldAt(lastPx.x,lastPx.y), b=worldAt(e.clientX,e.clientY);
    if(a&&b){ center.x+=a.x-b.x; center.z+=a.z-b.z; buildCam(); render(); }
    lastPx={x:e.clientX,y:e.clientY};
  }
});
drc.addEventListener('pointerup',e=>{
  if(e.button!==0){ down=null; return; }
  if(!dragged){ placeAt(e.clientX,e.clientY); }
  down=null;
});
drc.addEventListener('contextmenu',e=>{ e.preventDefault(); if(!closed&&pts.length){ pts.pop(); afterChange(); } });
drc.addEventListener('wheel',e=>{ e.preventDefault();
  const before=worldAt(e.clientX,e.clientY);
  halfH=Math.max(40,Math.min(2000, halfH*(e.deltaY>0?1.12:0.89)));
  buildCam();
  const after=worldAt(e.clientX,e.clientY);     // zoom toward cursor
  if(before&&after){ center.x+=before.x-after.x; center.z+=before.z-after.z; buildCam(); }
  render();
},{passive:false});

function placeAt(px,py){
  if(closed) return;
  if(pts.length>=3){ const s0=toScreen(pts[0].x,pts[0].z);
    if(Math.hypot(s0.x-px,s0.y-py)<12){ closed=true; afterChange(); return; } }
  const w=worldAt(px,py); if(!w) return;
  pts.push({x:+w.x.toFixed(2),z:+w.z.toFixed(2)}); afterChange();
}
function afterChange(){ render(); updateStats(); }
document.getElementById('close').onclick=()=>{ if(!closed&&pts.length>=3){ closed=true; afterChange(); } };
document.getElementById('undo').onclick=()=>{ if(closed) closed=false; else pts.pop(); afterChange(); };
document.getElementById('reset').onclick=()=>{ pts=[]; closed=false; afterChange(); };
function banner(msg,err){ const b=document.getElementById('banner'); b.textContent=msg; b.style.background=err?'#b03a3a':'#1e7e34'; b.style.display='block'; }
document.getElementById('save').onclick=async()=>{
  if(!(closed&&pts.length>=3)) return;
  const body={ world:'mishkenot', closed:true, ctrl:pts.map(p=>[Math.round(p.x),Math.round(p.z)]),
    lengthM:Math.round(trackLength()) };
  try{ const r=await fetch('/save-track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    banner(r.ok?'✅ Saved! Switch to Claude and say "done".':'Save failed '+r.status, !r.ok);
  }catch(e){ banner('Save failed: '+e,true); }
};

window.addEventListener('resize',resize);
// load the world
new THREE.GLTFLoader().load('/assets/mishkenot/world.glb',gltf=>{
  gltf.scene.traverse(o=>{ if(o.isMesh){ o.material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}); }
    else if(o.isLine||o.isLineSegments){ o.visible=false; } });
  scene.add(gltf.scene);
  const bb=new THREE.Box3().setFromObject(gltf.scene), c=bb.getCenter(new THREE.Vector3()), s=bb.getSize(new THREE.Vector3());
  center={x:c.x,z:c.z}; halfH=Math.max(s.x,s.z)*0.58;
  resize(); updateStats();
}, undefined, err=>{ document.getElementById('stats').textContent='Failed to load world.glb: '+err; });
</script></body></html>`;

const server = http.createServer((req,res)=>{
  if(req.method==='POST' && req.url==='/save-track'){
    let d=''; req.on('data',c=>d+=c);
    req.on('end',()=>{ try{ const o=JSON.parse(d); o.savedAt=new Date().toISOString().replace(/\.\d+Z$/,'Z');
      fs.writeFileSync(OUT, JSON.stringify(o,null,2));
      console.log('\\n[track-editor] SAVED '+o.ctrl.length+' control points (~'+o.lengthM+' m) -> maps/mishkenot_zvulun/track.json');
      res.writeHead(200); res.end('{"ok":true}');
    }catch(e){ res.writeHead(400); res.end(String(e)); } });
    return;
  }
  if(req.url==='/' || req.url===''){ res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(HTML); }
  const u=decodeURIComponent(req.url.split('?')[0]);
  const f=path.join(ROOT,u);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end('nf'); }
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
server.listen(PORT,()=>{
  console.log('Track editor running:  http://localhost:'+PORT+'/');
  console.log('Trace the kart loop on the neighbourhood, press "Save track".');
});
