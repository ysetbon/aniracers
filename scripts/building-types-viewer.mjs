// 3D designer/viewer for the 3 Mishkenot building types (voxel/block style, to match
// the karts). Shows A (apartment block), B (villa flat roof), C (villa tiled roof) on
// grass with OrbitControls and live sliders. Tweak until they look right; the same
// makeBuilding() factory will later be instanced onto each footprint in the game.
// Run:  node scripts/building-types-viewer.mjs   then open http://localhost:8768/
import http from 'http';
const PORT = Number(process.env.VIEWER_PORT || 8768);

const HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AniRacers — building types</title><style>
  html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,Segoe UI,sans-serif;background:#bfe3f7}
  #c{position:absolute;inset:0}
  #panel{position:absolute;top:10px;left:10px;background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:12px 14px;width:300px;max-height:94vh;overflow:auto}
  h2{margin:0 0 8px;font-size:15px}h3{margin:12px 0 4px;font-size:13px;border-top:1px solid #eee;padding-top:8px}
  label{display:flex;align-items:center;justify-content:space-between;font-size:12px;margin:4px 0;gap:8px}
  input[type=range]{flex:1}input[type=number]{width:46px}
  .lab{position:absolute;transform:translate(-50%,-100%);background:#0008;color:#fff;padding:3px 8px;border-radius:8px;font-size:13px;font-weight:600;pointer-events:none;white-space:nowrap}
  .hint{font-size:11px;color:#777;margin:6px 0}
</style></head><body>
<canvas id="c"></canvas>
<div class="lab" id="lA"></div><div class="lab" id="lB"></div><div class="lab" id="lC"></div>
<div id="panel"><h2>🏗️ Building types</h2>
<div class="hint">Drag to orbit · wheel to zoom. Adjust each type below; tell Claude what to change.</div>
<div id="ui"></div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script>
var FLOOR_H=3.0;
var P={
  A:{label:'A · Apartment block',floors:4,W:18,D:12,wall:'#eef0f2',roof:'#c9cdd2',glass:'#5b7186',balconies:true,solar:true,shutters:false,tiled:false},
  B:{label:'B · Cottage (semi-detached)',floors:2,W:16,D:10,wall:'#efe9dc',roof:'#eceae4',glass:'#6b8194',balconies:false,solar:false,shutters:true,tiled:false,duplex:true},
  C:{label:'C · Villa (tiled roof)',floors:2,W:12,D:10,wall:'#efe6d3',roof:'#b65a3a',glass:'#5b7186',balconies:false,solar:false,shutters:true,tiled:true}
};
var renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true});
renderer.setPixelRatio(Math.min(2,devicePixelRatio||1)); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
var scene=new THREE.Scene(); scene.background=new THREE.Color(0xbfe3f7);
var cam=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,0.5,2000);
cam.position.set(34,26,46);
var controls=new THREE.OrbitControls(cam,renderer.domElement); controls.target.set(0,6,0); controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x6b7a55,0.85));
var sun=new THREE.DirectionalLight(0xfff0d2,1.0); sun.position.set(30,50,20); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-60;sun.shadow.camera.right=60;sun.shadow.camera.top=60;sun.shadow.camera.bottom=-60; scene.add(sun);
var ground=new THREE.Mesh(new THREE.PlaneGeometry(400,400),new THREE.MeshLambertMaterial({color:0x6fae54}));
ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);

function box(w,h,d,color,x,y,z){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:color}));
  m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; return m;}

// window grid + shutter boxes on the 4 walls
function addWindows(g,W,H,D,floors,glass,shutters){
  var colW=Math.max(2,Math.round(W/3.4)), colD=Math.max(1,Math.round(D/3.4));
  var winW=Math.min(1.4,(W/colW)*0.5), winH=1.5, winD=Math.min(1.4,(D/colD)*0.5);
  for(var f=0;f<floors;f++){
    var y=f*FLOOR_H+FLOOR_H*0.55;
    for(var c=0;c<colW;c++){
      var x=-W/2+(c+0.5)*(W/colW);
      if(f===0 && Math.abs(x)<1.3) continue;      // leave room for the door
      g.add(box(winW,winH,0.14,glass,x,y,D/2+0.02));
      g.add(box(winW,winH,0.14,glass,x,y,-D/2-0.02));
      if(shutters){ g.add(box(winW+0.2,0.35,0.18,0xb7ad97,x,y+winH/2+0.2,D/2+0.04));
                    g.add(box(winW+0.2,0.35,0.18,0xb7ad97,x,y+winH/2+0.2,-D/2-0.04)); }
    }
    for(var k=0;k<colD;k++){
      var z=-D/2+(k+0.5)*(D/colD);
      g.add(box(0.14,winH,winD,glass,W/2+0.02,y,z));
      g.add(box(0.14,winH,winD,glass,-W/2-0.02,y,z));
    }
  }
}
function addBalconies(g,W,H,D,floors){
  for(var f=1;f<floors;f++){var y=f*FLOOR_H;
    g.add(box(W*0.82,0.18,1.1,0xe4e1d8,0,y+0.05,D/2+0.55));        // slab
    g.add(box(W*0.82,0.7,0.1,0xf3f1ea,0,y+0.45,D/2+1.05));         // front rail
    for(var x=-W*0.4;x<=W*0.4;x+=1.1) g.add(box(0.08,0.7,0.08,0xf3f1ea,x,y+0.45,D/2+1.05));
  }
}
function addFlatRoof(g,W,H,D,roof,solar){
  g.add(box(W+0.2,0.25,D+0.2,roof,0,H+0.12,0));                    // roof slab
  for(var s of [[0,D/2],[0,-D/2],[W/2,0],[-W/2,0]]){               // parapet
    var horiz=s[1]!==0; g.add(box(horiz?W+0.3:0.25,0.5,horiz?0.25:D+0.3,0xe7e7e7,s[0],H+0.45,s[1]));
  }
  if(solar){                                                       // dud + solar panel (very Israeli)
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,2.2,12),new THREE.MeshLambertMaterial({color:0xf2f2f2})).translateX(-W*0.2).translateY(H+1.3).translateZ(-D*0.15));
    var panel=box(2.6,0.12,1.4,0x24405e,W*0.18,H+0.9,D*0.05); panel.rotation.x=-0.5; g.add(panel);
    g.add(box(0.6,0.6,0.6,0x333333,W*0.18,H+0.5,D*0.05));
  }
}
function addTiledRoof(g,W,H,D,roof){
  var rh=Math.max(2.2,Math.min(W,D)*0.32);
  var cone=new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT2/2,1,4),new THREE.MeshLambertMaterial({color:roof}));
  cone.scale.set((W+1.2),rh,(D+1.2)); cone.rotation.y=Math.PI/4; cone.position.y=H+rh/2; cone.castShadow=true; g.add(cone);
  g.add(box(W+1.2,0.25,D+1.2,0x8a7e6a,0,H+0.12,0));                // eave band
}
// Type B: semi-detached cottage — two units sharing a central wall, two floors each,
// two front doors, cream walls + stone base, flat roof with overhang, shuttered windows.
function frontWin(g,x,y,D,glass,shutter){
  g.add(box(1.3,1.5,0.14,glass,x,y,D/2+0.03));
  if(shutter) g.add(box(1.5,0.34,0.18,0xb7ad97,x,y+0.92,D/2+0.05));   // rolling-shutter housing above
}
function makeDuplex(p){
  var g=new THREE.Group(); var H=p.floors*FLOOR_H; var W=p.W, D=p.D; var glass=new THREE.Color(p.glass);
  g.add(box(W+0.5,0.4,D+0.5,0xd8cfba,0,0.2,0));                 // plinth
  g.add(box(W,H,D,p.wall,0,H/2,0));                            // body (both units)
  g.add(box(W,2.4,0.12,0xc3b291,0,1.4,D/2+0.05));             // stone base band, front ground floor
  g.add(box(0.5,H,0.3,0xe7e2d4,0,H/2,D/2+0.06));             // party-wall pilaster (the shared wall, front seam)
  var unit=[-W/4,W/4];
  for(var u=0;u<2;u++){var xc=unit[u];
    g.add(box(1.3,2.3,0.16,0x5a4636,xc,1.15,D/2+0.07));        // door (one per unit)
    g.add(box(2.2,0.16,1.0,0xf4f1ea,xc,2.55,D/2+0.55));        // flat door canopy
    frontWin(g,xc+(u===0?-2.2:2.2),1.5,D,glass,false);          // ground window beside the door
    frontWin(g,xc-1.7,H-1.4,D,glass,p.shutters);               // two upper windows
    frontWin(g,xc+1.7,H-1.4,D,glass,p.shutters);
  }
  for(var f=0;f<p.floors;f++){var y=f*FLOOR_H+FLOOR_H*0.6;       // side + back windows
    for(var s=-1;s<=1;s+=2){ g.add(box(0.12,1.4,1.3,glass,s*(W/2+0.02),y,-D*0.22)); g.add(box(0.12,1.4,1.3,glass,s*(W/2+0.02),y,D*0.22)); }
    for(var k=-1;k<=1;k++) g.add(box(1.3,1.4,0.12,glass,k*W*0.3,y,-D/2-0.02));
  }
  g.add(box(W+1.0,0.3,D+1.0,p.roof,0,H+0.15,0));               // flat roof, overhanging cornice
  var edges=[[0,D/2],[0,-D/2],[W/2,0],[-W/2,0]];
  for(var e=0;e<4;e++){var hz=edges[e][1]!==0; g.add(box(hz?W+0.4:0.3,0.4,hz?0.3:D+0.4,0xeeece6,edges[e][0],H+0.45,edges[e][1]));}
  if(p.solar){g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,2,12),new THREE.MeshLambertMaterial({color:0xf2f2f2})).translateX(-W*0.2).translateY(H+1.2).translateZ(-D*0.2));
    var panel=box(2.4,0.12,1.2,0x24405e,W*0.2,H+0.8,-D*0.1); panel.rotation.x=-0.5; g.add(panel);}
  return g;
}
function makeBuilding(p){
  if(p.duplex) return makeDuplex(p);
  var g=new THREE.Group(); var H=p.floors*FLOOR_H;
  g.add(box(W2(p),0.4,p.D+0.4,0xcfc7b5,0,0.2,0));                  // plinth
  g.add(box(p.W,H,p.D,p.wall,0,H/2,0));                           // body
  addWindows(g,p.W,H,p.D,p.floors,new THREE.Color(p.glass),p.shutters);
  g.add(box(1.6,2.3,0.16,0x6b4f33,0,1.15,p.D/2+0.04));            // door
  if(p.balconies) addBalconies(g,p.W,H,p.D,p.floors);
  if(p.tiled) addTiledRoof(g,p.W,H,p.D,new THREE.Color(p.roof)); else addFlatRoof(g,p.W,H,p.D,new THREE.Color(p.roof),p.solar);
  return g;
}
function W2(p){return p.W+0.4;}

var groups={}, positions={A:-30,B:0,C:30};
function rebuild(){
  for(var k in groups){scene.remove(groups[k]);}
  groups={};
  for(var k in P){var g=makeBuilding(P[k]); g.position.x=positions[k]; scene.add(g); groups[k]=g;}
}
rebuild();

// UI
function ui(){
  var html='';
  for(var k in P){var p=P[k];
    html+='<h3>'+p.label+'</h3>';
    html+=row(k,'floors','floors',1,12,1);
    html+=row(k,'W','width',6,40,1);
    html+=row(k,'D','depth',6,30,1);
    html+=color(k,'wall','wall')+color(k,'roof','roof')+color(k,'glass','windows');
    html+=chk(k,'balconies','balconies')+chk(k,'solar','roof tanks/solar')+chk(k,'shutters','shutter boxes')+chk(k,'tiled','tiled roof');
  }
  document.getElementById('ui').innerHTML=html;
  document.querySelectorAll('[data-k]').forEach(function(el){
    el.addEventListener('input',function(){var k=el.dataset.k,f=el.dataset.f;
      if(el.type==='checkbox')P[k][f]=el.checked; else if(el.type==='color')P[k][f]=el.value; else P[k][f]=+el.value;
      rebuild();});
  });
}
function row(k,f,name,mn,mx,st){return '<label>'+name+' <input type="range" data-k="'+k+'" data-f="'+f+'" min="'+mn+'" max="'+mx+'" step="'+st+'" value="'+P[k][f]+'"></label>';}
function color(k,f,name){return '<label>'+name+' <input type="color" data-k="'+k+'" data-f="'+f+'" value="'+P[k][f]+'"></label>';}
function chk(k,f,name){return '<label>'+name+' <input type="checkbox" data-k="'+k+'" data-f="'+f+'" '+(P[k][f]?'checked':'')+'></label>';}
ui();

var labels={A:document.getElementById('lA'),B:document.getElementById('lB'),C:document.getElementById('lC')};
function updLabels(){for(var k in P){var p=new THREE.Vector3(positions[k],P[k].floors*FLOOR_H+4,0).project(cam);
  var el=labels[k]; el.textContent=P[k].label.split(' · ')[0]; el.style.left=((p.x*0.5+0.5)*innerWidth)+'px'; el.style.top=((-p.y*0.5+0.5)*innerHeight)+'px';}}
addEventListener('resize',function(){cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.setSize(innerWidth,innerHeight);
(function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,cam);updLabels();})();
</script></body></html>`;

http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(HTML);})
  .listen(PORT,()=>console.log('Building-types viewer:  http://localhost:'+PORT+'/'));
