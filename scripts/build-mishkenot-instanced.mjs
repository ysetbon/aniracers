// Build the Mishkenot world by INSTANCING the designed 3D house models (A apartment,
// B semi-detached cottage, C tiled villa) onto each footprint, on top of the OSM2World
// base (streets/parks/trees, buildings stripped). Bakes everything into one
// vertex-coloured mesh -> assets/mishkenot/world.glb.
// Prereq: mishkenot_base.glb (strip-buildings + convert), buildings.json, building-overrides.json.
// Run: node scripts/build-mishkenot-instanced.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_REL = 'OSM2World/_aniracers_test/mishkenot_base.glb';
const AREA = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/area.json'),'utf8'));
const BLD = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/buildings.json'),'utf8'));
const OVR = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/building-overrides.json'),'utf8')).overrides;
const OUT_DIR = path.join(ROOT,'assets','mishkenot'); fs.mkdirSync(OUT_DIR,{recursive:true});

const originLat=(AREA.bbox.minlat+AREA.bbox.maxlat)/2, originLon=(AREA.bbox.minlon+AREA.bbox.maxlon)/2;
const scale=40075016.686*Math.cos(originLat*Math.PI/180);
const latToY=d=>{const s=Math.sin(d*Math.PI/180);return Math.log((1+s)/(1-s))/(4*Math.PI)+0.5;};
const yO=latToY(originLat);
const toXZ=(lat,lon)=>[ (lon-originLon)/360*scale, -(latToY(lat)-yO)*scale ];
const POLY=AREA.polygon.map(([la,lo])=>toXZ(la,lo));
const pxs=POLY.map(p=>p[0]),pzs=POLY.map(p=>p[1]);
const PCX=(Math.min(...pxs)+Math.max(...pxs))/2, PCZ=(Math.min(...pzs)+Math.max(...pzs))/2;
const BUILDINGS=BLD.buildings.filter(b=>OVR[b.id]).map(b=>({foot:b.foot,type:OVR[b.id].type,lv:OVR[b.id].lv}));

const PAGE = String.raw`<!doctype html><html><head><meta charset=utf8></head><body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js"></script>
<script>
window.RESULT=null;window.ERR=null;
var POLY=`+JSON.stringify(POLY)+`, PCX=`+PCX+`, PCZ=`+PCZ+`, BUILD=`+JSON.stringify(BUILDINGS)+`;
var FLOOR_H=3.0;
var DEF={
 A:{wall:0xeef0f2,roof:0xc9cdd2,glass:0x5b7186,balconies:true,solar:true,shutters:false,tiled:false},
 B:{wall:0xefe9dc,roof:0xeceae4,glass:0x6b8194,balconies:false,solar:false,shutters:true,tiled:false,duplex:true},
 C:{wall:0xefe6d3,roof:0xb65a3a,glass:0x6b8194,balconies:false,solar:false,shutters:true,tiled:true}
};
function box(w,h,d,color,x,y,z){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:color}));m.position.set(x,y,z);return m;}
function addWindows(g,W,H,D,floors,glass,shutters){var colW=Math.max(2,Math.round(W/3.4)),colD=Math.max(1,Math.round(D/3.4));
  var winW=Math.min(1.4,(W/colW)*0.5),winH=1.5,winD=Math.min(1.4,(D/colD)*0.5);
  for(var f=0;f<floors;f++){var y=f*FLOOR_H+FLOOR_H*0.55;
    for(var c=0;c<colW;c++){var x=-W/2+(c+0.5)*(W/colW);if(f===0&&Math.abs(x)<1.3)continue;
      g.add(box(winW,winH,0.14,glass,x,y,D/2+0.02));g.add(box(winW,winH,0.14,glass,x,y,-D/2-0.02));
      if(shutters){g.add(box(winW+0.2,0.35,0.18,0xb7ad97,x,y+winH/2+0.2,D/2+0.04));g.add(box(winW+0.2,0.35,0.18,0xb7ad97,x,y+winH/2+0.2,-D/2-0.04));}}
    for(var k=0;k<colD;k++){var z=-D/2+(k+0.5)*(D/colD);g.add(box(0.14,winH,winD,glass,W/2+0.02,y,z));g.add(box(0.14,winH,winD,glass,-W/2-0.02,y,z));}}}
function addBalconies(g,W,H,D,floors){for(var f=1;f<floors;f++){var y=f*FLOOR_H;
  g.add(box(W*0.82,0.18,1.1,0xe4e1d8,0,y+0.05,D/2+0.55));g.add(box(W*0.82,0.7,0.1,0xf3f1ea,0,y+0.45,D/2+1.05));
  for(var x=-W*0.4;x<=W*0.4;x+=1.1)g.add(box(0.08,0.7,0.08,0xf3f1ea,x,y+0.45,D/2+1.05));}}
function addFlatRoof(g,W,H,D,roof,solar){g.add(box(W+0.2,0.25,D+0.2,roof,0,H+0.12,0));
  var E=[[0,D/2],[0,-D/2],[W/2,0],[-W/2,0]];for(var i=0;i<4;i++){var hz=E[i][1]!==0;g.add(box(hz?W+0.3:0.25,0.5,hz?0.25:D+0.3,0xe7e7e7,E[i][0],H+0.45,E[i][1]));}
  if(solar){g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,2.2,12),new THREE.MeshLambertMaterial({color:0xf2f2f2})).translateX(-W*0.2).translateY(H+1.3).translateZ(-D*0.15));
    var p=box(2.6,0.12,1.4,0x24405e,W*0.18,H+0.9,D*0.05);p.rotation.x=-0.5;g.add(p);g.add(box(0.6,0.6,0.6,0x333333,W*0.18,H+0.5,D*0.05));}}
function addTiledRoof(g,W,H,D,roof){var rh=Math.max(2.2,Math.min(W,D)*0.32);
  var c=new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT2/2,1,4),new THREE.MeshLambertMaterial({color:roof}));
  c.scale.set(W+1.2,rh,D+1.2);c.rotation.y=Math.PI/4;c.position.y=H+rh/2;g.add(c);g.add(box(W+1.2,0.25,D+1.2,0x8a7e6a,0,H+0.12,0));}
function frontWin(g,x,y,D,glass,shutter){g.add(box(1.3,1.5,0.14,glass,x,y,D/2+0.03));if(shutter)g.add(box(1.5,0.34,0.18,0xb7ad97,x,y+0.92,D/2+0.05));}
function makeDuplex(p){var g=new THREE.Group();var H=p.floors*FLOOR_H,W=p.W,D=p.D,glass=new THREE.Color(p.glass);
  g.add(box(W+0.5,0.4,D+0.5,0xd8cfba,0,0.2,0));g.add(box(W,H,D,p.wall,0,H/2,0));
  g.add(box(W,2.4,0.12,0xc3b291,0,1.4,D/2+0.05));g.add(box(0.5,H,0.3,0xe7e2d4,0,H/2,D/2+0.06));
  var unit=[-W/4,W/4];for(var u=0;u<2;u++){var xc=unit[u];g.add(box(1.3,2.3,0.16,0x5a4636,xc,1.15,D/2+0.07));g.add(box(2.2,0.16,1.0,0xf4f1ea,xc,2.55,D/2+0.55));
    frontWin(g,xc+(u===0?-2.2:2.2),1.5,D,glass,false);frontWin(g,xc-1.7,H-1.4,D,glass,p.shutters);frontWin(g,xc+1.7,H-1.4,D,glass,p.shutters);}
  for(var f=0;f<p.floors;f++){var y=f*FLOOR_H+FLOOR_H*0.6;for(var s=-1;s<=1;s+=2){g.add(box(0.12,1.4,1.3,glass,s*(W/2+0.02),y,-D*0.22));g.add(box(0.12,1.4,1.3,glass,s*(W/2+0.02),y,D*0.22));}
    for(var k=-1;k<=1;k++)g.add(box(1.3,1.4,0.12,glass,k*W*0.3,y,-D/2-0.02));}
  g.add(box(W+1.0,0.3,D+1.0,p.roof,0,H+0.15,0));var E=[[0,D/2],[0,-D/2],[W/2,0],[-W/2,0]];
  for(var e=0;e<4;e++){var hz=E[e][1]!==0;g.add(box(hz?W+0.4:0.3,0.4,hz?0.3:D+0.4,0xeeece6,E[e][0],H+0.45,E[e][1]));}
  if(p.solar){var t=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,2,12),new THREE.MeshLambertMaterial({color:0xf2f2f2}));t.position.set(-W*0.2,H+1.2,-D*0.2);g.add(t);}
  return g;}
function makeBuilding(p){if(p.duplex)return makeDuplex(p);
  var g=new THREE.Group();var H=p.floors*FLOOR_H;
  g.add(box(p.W+0.4,0.4,p.D+0.4,0xcfc7b5,0,0.2,0));g.add(box(p.W,H,p.D,p.wall,0,H/2,0));
  addWindows(g,p.W,H,p.D,p.floors,new THREE.Color(p.glass),p.shutters);
  g.add(box(1.6,2.3,0.16,0x6b4f33,0,1.15,p.D/2+0.04));
  if(p.balconies)addBalconies(g,p.W,H,p.D,p.floors);
  if(p.tiled)addTiledRoof(g,p.W,H,p.D,new THREE.Color(p.roof));else addFlatRoof(g,p.W,H,p.D,new THREE.Color(p.roof),p.solar);
  return g;}

function obb(foot){var bestLen=0,theta=0;for(var i=0;i<foot.length;i++){var a=foot[i],b=foot[(i+1)%foot.length];var dx=b[0]-a[0],dz=b[1]-a[1];var l=dx*dx+dz*dz;if(l>bestLen){bestLen=l;theta=Math.atan2(dz,dx);}}
  var c=Math.cos(theta),s=Math.sin(theta),mnu=1e9,mxu=-1e9,mnv=1e9,mxv=-1e9;
  for(var j=0;j<foot.length;j++){var u=foot[j][0]*c+foot[j][1]*s,v=-foot[j][0]*s+foot[j][1]*c;if(u<mnu)mnu=u;if(u>mxu)mxu=u;if(v<mnv)mnv=v;if(v>mxv)mxv=v;}
  var W=mxu-mnu,D=mxv-mnv,uc=(mnu+mxu)/2,vc=(mnv+mxv)/2;return {cx:uc*c-vc*s,cz:uc*s+vc*c,W:W,D:D,theta:theta};}
function pctile(arr,p){var a=Float64Array.from(arr).sort();return a[Math.max(0,Math.min(a.length-1,Math.floor(a.length*p)))];}
function inPoly(x,z){var c=false;for(var i=0,j=POLY.length-1;i<POLY.length;j=i++){var xi=POLY[i][0],zi=POLY[i][1],xj=POLY[j][0],zj=POLY[j][1];if(((zi>z)!=(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))c=!c;}return c;}

var KP=[],KN=[],KC=[];
function collect(mesh,offX,offY,offZ){
  var g=mesh.geometry;g=g.index?g.toNonIndexed():g.clone();g.applyMatrix4(mesh.matrixWorld);
  if(!g.attributes.normal)g.computeVertexNormals();
  var pos=g.attributes.position.array,nrm=g.attributes.normal.array,col=g.attributes.color?g.attributes.color.array:null,cis=col?g.attributes.color.itemSize:0;
  var mc=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material).color||{r:1,g:1,b:1};
  for(var i=0;i<pos.length;i+=3){KP.push(pos[i]+offX,pos[i+1]+offY,pos[i+2]+offZ);KN.push(nrm[i],nrm[i+1],nrm[i+2]);}
  for(var v=0;v<pos.length/3;v++){var r=col?col[v*cis]:1,gg=col?col[v*cis+1]:1,b=col?col[v*cis+2]:1;KC.push(r*mc.r,gg*mc.g,b*mc.b);}
}
async function main(){
  // 1) base: collect (GLB coords), clip to polygon + vertical band, recentre
  var base=await new Promise((res,rej)=>new THREE.GLTFLoader().load('/base.glb',res,undefined,rej));
  base.scene.updateMatrixWorld(true);
  var BP=[],BN=[],BC=[];var save=KP,saveN=KN,saveC=KC;KP=BP;KN=BN;KC=BC;
  base.scene.traverse(function(o){if(o.isMesh)collect(o,0,0,0);});
  KP=save;KN=saveN;KC=saveC;
  var ys=[];for(var i=1;i<BP.length;i+=3)ys.push(BP[i]);var gy=pctile(ys,0.02),TOP=gy+200,BOT=gy-25;
  for(var t=0;t<BP.length;t+=9){var cx=(BP[t]+BP[t+3]+BP[t+6])/3,cz=(BP[t+2]+BP[t+5]+BP[t+8])/3,cy=(BP[t+1]+BP[t+4]+BP[t+7])/3;
    if(cy<BOT||cy>TOP||!inPoly(cx,cz))continue;
    for(var k=0;k<9;k++){KP.push((k%3===0)?BP[t+k]-PCX:(k%3===1)?BP[t+k]-gy:BP[t+k]-PCZ);KN.push(BN[t+k]);KC.push(BC[t+k]);}}
  var baseTris=KP.length/9;
  // 2) instance the house models on each footprint (footprints already recentred)
  var placed=0;
  for(var bi=0;bi<BUILD.length;bi++){var b=BUILD[bi];if(!b.foot||b.foot.length<3)continue;
    var o=obb(b.foot);var W=Math.max(6,Math.min(70,o.W)),D=Math.max(6,Math.min(50,o.D));
    var d=DEF[b.type]||DEF.A;var p={type:b.type,W:W,D:D,floors:Math.max(1,b.lv||2),wall:d.wall,roof:d.roof,glass:d.glass,balconies:d.balconies,solar:d.solar,shutters:d.shutters,tiled:d.tiled,duplex:d.duplex};
    var model=makeBuilding(p);model.rotation.y=-o.theta;model.position.set(o.cx,0,o.cz);model.updateMatrixWorld(true);
    model.traverse(function(m){if(m.isMesh)collect(m,0,0,0);});placed++;}
  // 3) one mesh + export
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(KP,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(KN,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(KC,3));
  var mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  var bb=new THREE.Box3().setFromObject(mesh),sz=bb.getSize(new THREE.Vector3());
  var glb=await new Promise((res,rej)=>new THREE.GLTFExporter().parse(mesh,res,{binary:true},rej));
  var bytes=new Uint8Array(glb),bin='';for(var i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  window.RESULT={b64:btoa(bin),tris:KP.length/9,baseTris:baseTris,placed:placed,size:[+sz.x.toFixed(1),+sz.y.toFixed(1),+sz.z.toFixed(1)]};
}
main().catch(function(e){window.ERR=String(e&&e.stack||e);});
</script></body></html>`;

const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(PAGE);}
  if(req.url==='/base.glb'){res.writeHead(200,{'Content-Type':'model/gltf-binary'});return res.end(fs.readFileSync(path.join(ROOT,BASE_REL)));}
  res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,r));const port=server.address().port;
const browser=await puppeteer.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();page.on('console',m=>console.log('  [page]',m.text()));
await page.goto('http://localhost:'+port+'/',{waitUntil:'load'});
await page.waitForFunction('window.RESULT||window.ERR',{timeout:180000});
const err=await page.evaluate('window.ERR');
if(err){console.error('ERROR:\n'+err);await browser.close();server.close();process.exit(1);}
const R=await page.evaluate('window.RESULT');const b64=R.b64;delete R.b64;
fs.writeFileSync(path.join(OUT_DIR,'world.glb'),Buffer.from(b64,'base64'));
console.log('\n=== Mishkenot world (instanced 3D houses) ===');
console.log(JSON.stringify(R,null,2));
console.log('wrote assets/mishkenot/world.glb ('+(fs.statSync(path.join(OUT_DIR,'world.glb')).size/1048576).toFixed(2)+' MB)');
await browser.close();server.close();
