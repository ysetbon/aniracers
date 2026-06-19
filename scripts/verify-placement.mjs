// Verify every building is placed on its REAL map footprint. Renders the world.glb
// top-down (north-up, orthographic) and overlays each building's true footprint outline
// (from buildings.json, same coordinate frame) in red. If the red outlines sit on the
// building roofs, placement is correct. Writes maps/<name>/_placement_check.png (+ zoom).
// Run: node scripts/verify-placement.mjs --world=<name>
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));
const BLD = JSON.parse(fs.readFileSync(W.paths.buildings,'utf8')).buildings;
const FOOTS = BLD.filter(b=>b.foot&&b.foot.length>=3).map(b=>b.foot);
const OUT = W.paths.dir;
// pick the densest ~220m window as a zoom target
const CENTS = FOOTS.map(f=>{let x=0,z=0;f.forEach(p=>{x+=p[0];z+=p[1];});return [x/f.length,z/f.length];});
let ZC=[0,0],bestN=-1;
for(const [cx,cz] of CENTS){let n=0;for(const [x,z] of CENTS)if(Math.abs(x-cx)<110&&Math.abs(z-cz)<110)n++;if(n>bestN){bestN=n;ZC=[cx,cz];}}
console.log('densest cluster center ('+ZC[0].toFixed(0)+','+ZC[1].toFixed(0)+') with '+bestN+' buildings in 220m');

const PAGE = String.raw`<!doctype html><html><head><meta charset=utf8></head><body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script>
window.RESULT=null;window.ERR=null;
var FOOTS=`+JSON.stringify(FOOTS)+`, ZC=`+JSON.stringify(ZC)+`;
var W=1500,H=1400;
function renderView(renderer,scene,cx,cz,span){
  var asp=W/H;
  var cam=new THREE.OrthographicCamera(-span*asp,span*asp,span,-span,0.1,20000);
  cam.position.set(cx,5000,cz);cam.up.set(0,0,-1);cam.lookAt(cx,0,cz);cam.updateProjectionMatrix();cam.updateMatrixWorld();
  renderer.render(scene,cam);
  var cv=document.createElement('canvas');cv.width=W;cv.height=H;var ctx=cv.getContext('2d');
  ctx.drawImage(renderer.domElement,0,0);
  function toScreen(x,z){var v=new THREE.Vector3(x,0,z).project(cam);return [(v.x*0.5+0.5)*W,(-v.y*0.5+0.5)*H];}
  ctx.lineWidth=2;ctx.strokeStyle='rgba(235,25,25,0.95)';
  for(var i=0;i<FOOTS.length;i++){var f=FOOTS[i];ctx.beginPath();
    for(var k=0;k<f.length;k++){var p=toScreen(f[k][0],f[k][1]);k?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);}
    ctx.closePath();ctx.stroke();}
  return cv.toDataURL('image/png');
}
async function main(){
  var renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(W,H);renderer.setClearColor(0x9fd0f0);
  var scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x6b7a55,1.0));
  var sun=new THREE.DirectionalLight(0xffffff,0.7);sun.position.set(0.3,1,0.2);scene.add(sun);
  var g=await new Promise((res,rej)=>new THREE.GLTFLoader().load('/world.glb',res,undefined,rej));
  g.scene.traverse(function(o){if(o.isMesh)o.material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});});
  scene.add(g.scene);
  var bb=new THREE.Box3().setFromObject(g.scene),c=bb.getCenter(new THREE.Vector3()),s=bb.getSize(new THREE.Vector3());
  var full=renderView(renderer,scene,c.x,c.z,Math.max(s.x,s.z)*0.52);
  var zoom=renderView(renderer,scene,ZC[0],ZC[1],110);
  window.RESULT={full:full,zoom:zoom,count:FOOTS.length};
}
main().catch(function(e){window.ERR=String(e&&e.stack||e);});
</script></body></html>`;

const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(PAGE);}
  if(req.url==='/world.glb'){res.writeHead(200,{'Content-Type':'model/gltf-binary'});return res.end(fs.readFileSync(W.paths.assetGlb));}
  res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,r));const port=server.address().port;
const browser=await puppeteer.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();page.on('console',m=>console.log('  [page]',m.text()));
await page.goto('http://localhost:'+port+'/',{waitUntil:'load'});
await page.waitForFunction('window.RESULT||window.ERR',{timeout:120000});
const err=await page.evaluate('window.ERR'); if(err){console.error('ERROR:\n'+err);await browser.close();server.close();process.exit(1);}
const R=await page.evaluate('window.RESULT');
fs.writeFileSync(path.join(OUT,'_placement_check.png'),Buffer.from(R.full.split(',')[1],'base64'));
fs.writeFileSync(path.join(OUT,'_placement_zoom.png'),Buffer.from(R.zoom.split(',')[1],'base64'));
console.log('overlaid '+R.count+' footprints -> _placement_check.png + _placement_zoom.png');
try{await browser.close();}catch{} server.close();
