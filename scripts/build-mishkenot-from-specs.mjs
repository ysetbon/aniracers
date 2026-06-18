// Build the Mishkenot world by instancing a UNIQUE 3D model for EACH building, driven
// by a per-building spec derived from its real Street View photo (building-specs.json).
// Falls back to the A/B/C presets (building-overrides.json) for any building without a spec.
// Bakes streets/parks/trees (OSM2World base) + every house into ONE vertex-coloured mesh
// -> assets/mishkenot/world.glb.
// Prereq: mishkenot_base.glb, buildings.json. Optional: building-specs.json, building-overrides.json.
// Run: node scripts/build-mishkenot-from-specs.mjs
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_REL = 'OSM2World/_aniracers_test/mishkenot_base.glb';
const AREA = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/area.json'),'utf8'));
const BLD = JSON.parse(fs.readFileSync(path.join(ROOT,'maps/mishkenot_zvulun/buildings.json'),'utf8'));
const rd = p => { try { return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8')); } catch(e){ return null; } };
const OVRJ = rd('maps/mishkenot_zvulun/building-overrides.json');
const OVR = OVRJ ? OVRJ.overrides : {};
const SPECJ = rd('maps/mishkenot_zvulun/building-specs.json');
const SPECS = SPECJ ? SPECJ.specs : {};
const OUT_DIR = path.join(ROOT,'assets','mishkenot'); fs.mkdirSync(OUT_DIR,{recursive:true});

const originLat=(AREA.bbox.minlat+AREA.bbox.maxlat)/2, originLon=(AREA.bbox.minlon+AREA.bbox.maxlon)/2;
const scale=40075016.686*Math.cos(originLat*Math.PI/180);
const latToY=d=>{const s=Math.sin(d*Math.PI/180);return Math.log((1+s)/(1-s))/(4*Math.PI)+0.5;};
const yO=latToY(originLat);
const toXZ=(lat,lon)=>[ (lon-originLon)/360*scale, -(latToY(lat)-yO)*scale ];
const POLY=AREA.polygon.map(([la,lo])=>toXZ(la,lo));
const pxs=POLY.map(p=>p[0]),pzs=POLY.map(p=>p[1]);
const PCX=(Math.min(...pxs)+Math.max(...pxs))/2, PCZ=(Math.min(...pzs)+Math.max(...pzs))/2;

// A/B/C preset -> spec (fallback when a building has no photo-derived spec)
const PRESET = {
  A:{style:'apartment',floors:4,wall:'#eef0f2',roof:'flat',roofColor:'#c9cdd2',cols:3,balconies:true,doors:1,solar:true,shutters:false,stoneBase:false},
  B:{style:'cottage',  floors:2,wall:'#efe9dc',roof:'flat',roofColor:'#eceae4',cols:2,balconies:false,doors:2,solar:false,shutters:true, stoneBase:true},
  C:{style:'villa',    floors:2,wall:'#efe6d3',roof:'hipped',roofColor:'#b65a3a',cols:2,balconies:false,doors:1,solar:false,shutters:true,stoneBase:true},
};
function specFor(b){
  const s = SPECS[b.id];
  if(s) return Object.assign({src:'photo'}, s);
  const o = OVR[b.id];
  if(o){ const p = Object.assign({src:'preset'}, PRESET[o.type]||PRESET.A); p.floors = Math.max(1,o.lv||p.floors); return p; }
  // last resort: size heuristic
  const big = b.area>250; return Object.assign({src:'auto'}, big?PRESET.A:PRESET.B, {floors:big?4:2});
}
// Build the list of buildings to place (every building inside the polygon)
const BUILDINGS = BLD.buildings.filter(b=>b.foot&&b.foot.length>=3).map(b=>({id:b.id,foot:b.foot,spec:specFor(b)}));
const srcCount = BUILDINGS.reduce((m,b)=>{m[b.spec.src]=(m[b.spec.src]||0)+1;return m;},{});
console.log('placing '+BUILDINGS.length+' buildings  sources='+JSON.stringify(srcCount));

const PAGE = String.raw`<!doctype html><html><head><meta charset=utf8></head><body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/exporters/GLTFExporter.js"></script>
<script src="/house-factory.js"></script>
<script>
window.RESULT=null;window.ERR=null;
var POLY=`+JSON.stringify(POLY)+`, PCX=`+PCX+`, PCZ=`+PCZ+`, BUILD=`+JSON.stringify(BUILDINGS)+`;
// FLOOR_H, makeBuilding(p) and obb(foot) come from /house-factory.js (shared with the gallery)
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
  var placed=0,extruded=0;
  for(var bi=0;bi<BUILD.length;bi++){var b=BUILD[bi];if(!b.foot||b.foot.length<3)continue;
    var o=obb(b.foot);var W=Math.max(6,Math.min(130,o.W)),D=Math.max(6,Math.min(100,o.D));
    var s=b.spec; var p={W:W,D:D,floors:Math.max(1,s.floors||2),wall:s.wall||'#eaeaea',roof:s.roof||'flat',
      roofColor:s.roofColor||'#cccccc',glass:s.glass||'#6b8194',cols:s.cols,balconies:!!s.balconies,
      doors:s.doors||1,shutters:!!s.shutters,stoneBase:!!s.stoneBase,solar:!!s.solar};
    // complex (L-shaped) footprints: extrude the REAL polygon so it matches the map exactly.
    // rectangles (fill ratio high) keep the nicer makeBuilding model (gable/hip roofs, balconies).
    var fr=polyArea(b.foot)/(o.W*o.D), complexShape=fr<0.88;
    var model;
    if(complexShape){ model=makeFootprintBuilding(b.foot,p); model.position.set(0,0,0); extruded++; }
    else { model=makeBuilding(p); model.rotation.y=-o.theta; model.position.set(o.cx,0,o.cz); }
    model.updateMatrixWorld(true);
    model.traverse(function(m){if(m.isMesh)collect(m,0,0,0);});placed++;}
  console.log('placed '+placed+' ('+extruded+' footprint-extruded, '+(placed-extruded)+' boxed)');
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
  if(req.url==='/house-factory.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(fs.readFileSync(path.join(ROOT,'scripts/house-factory.js')));}
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
console.log('\n=== Mishkenot world (per-building photo-matched models) ===');
console.log(JSON.stringify(R,null,2));
console.log('wrote assets/mishkenot/world.glb ('+(fs.statSync(path.join(OUT_DIR,'world.glb')).size/1048576).toFixed(2)+' MB)');
await browser.close();server.close();
