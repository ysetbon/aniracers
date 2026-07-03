// One-house test world (new-method pilot): bake a SMALL standalone world containing a
// single program-built house + frontage + an "environment" prop layer (CC0 pack GLBs
// from assets/props/ + factory pieces) at the building's REAL world coordinates, so the
// existing mishkenot race loop and ?spawnat both work. Ground + real road strip included.
//
// The program's new "environment" key drives the prop pass:
//   props[]: { model, h, t, inset, rxz?, tint? }  — one instance on the frontage frame
//            { row, h, t0, t1, step, inset, tint? } — a row of instances (hedges)
//   t = fraction along the frontage line (gates use the same coordinate), may exceed 0..1;
//   inset = metres INWARD from the wall line (negative = toward the road).
//
// Run: node scripts/bake-test-world.mjs --world=netanya --id=556597974
//      [--out=assets/mishkenot/world_test.glb]
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const ID = arg('id', '');
if (!ID) { console.error('need --id=<buildingId>'); process.exit(1); }
const OUT = arg('out', path.join(path.dirname(W.paths.assetGlb), 'world_test.glb'));
const PROPS_DIR = path.join(ROOT, 'assets/props/kenney-nature');

const BLD = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8')).buildings;
const ROADS = JSON.parse(fs.readFileSync(path.join(W.paths.dir, 'roads.json'), 'utf8')).roads;
const PROG_DIR = path.join(W.paths.specWork, 'programs');

function nearestRoad(cx, cz) {
  let best = { d: Infinity };
  for (const rd of ROADS) {
    if (!rd.pts || rd.pts.length < 2 || rd.type === 'path') continue;
    for (let i = 0; i < rd.pts.length - 1; i++) {
      const [ax, az] = rd.pts[i], [bx, bz] = rd.pts[i + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / L2)) : 0;
      const qx = ax + t * dx, qz = az + t * dz, d = Math.hypot(cx - qx, cz - qz);
      if (d < best.d) best = { d, qx, qz, ux: dx / Math.sqrt(L2 || 1), uz: dz / Math.sqrt(L2 || 1), type: rd.type };
    }
  }
  return best;
}
function hull(pts) {
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function minAreaOBB(pts) {
  const H = hull(pts); let best = null;
  for (let i = 0; i < H.length; i++) {
    const [x0, z0] = H[i], [x1, z1] = H[(i + 1) % H.length];
    const a = Math.atan2(z1 - z0, x1 - x0), c = Math.cos(a), s = Math.sin(a);
    let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
    for (const [x, z] of H) {
      const u = x * c + z * s, v = -x * s + z * c;
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
    const area = (uMax - uMin) * (vMax - vMin);
    if (!best || area < best.area) {
      const cu = (uMin + uMax) / 2, cv = (vMin + vMax) / 2;
      best = { area, angle: a, du: uMax - uMin, dv: vMax - vMin, cx: cu * c - cv * s, cz: cu * s + cv * c };
    }
  }
  return best;
}

const b = BLD.find(x => String(x.id) === ID);
const progPath = path.join(PROG_DIR, `bld_${ID}.json`);
if (!b) { console.error('no building ' + ID); process.exit(1); }
const program = JSON.parse(fs.readFileSync(progPath, 'utf8'));
const o = minAreaOBB(b.foot);
const r = nearestRoad(o.cx, o.cz);
const dl = Math.hypot(r.qx - o.cx, r.qz - o.cz) || 1;
const dir = [(r.qx - o.cx) / dl, (r.qz - o.cz) / dl];
const cands = [
  { f: [Math.cos(o.angle), Math.sin(o.angle)], depth: o.du, lateral: o.dv },
  { f: [-Math.cos(o.angle), -Math.sin(o.angle)], depth: o.du, lateral: o.dv },
  { f: [-Math.sin(o.angle), Math.cos(o.angle)], depth: o.dv, lateral: o.du },
  { f: [Math.sin(o.angle), -Math.cos(o.angle)], depth: o.dv, lateral: o.du },
];
const front = cands.reduce((a2, c2) => (c2.f[0] * dir[0] + c2.f[1] * dir[1] > a2.f[0] * dir[0] + a2.f[1] * dir[1] ? c2 : a2));
const rotY = Math.atan2(front.f[0], front.f[1]);
let frontage = null, off = 0;
{
  let nx = o.cx - r.qx, nz = o.cz - r.qz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  let lo2 = Infinity, hi = -Infinity, wallD = Infinity;
  for (const [fx, fz] of b.foot) {
    const u = (fx - r.qx) * r.ux + (fz - r.qz) * r.uz; lo2 = Math.min(lo2, u); hi = Math.max(hi, u);
    wallD = Math.min(wallD, (fx - r.qx) * nx + (fz - r.qz) * nz);
  }
  const edge = { avenue: 6.9, street: 4.9, service: 2.4, plaza: 5.5 }[r.type] || 4.9;
  off = Math.max(edge, Math.min(edge + 2.5, wallD - 1.0));
  const P = u => [r.qx + r.ux * u + nx * off, r.qz + r.uz * u + nz * off];
  frontage = { a: P(lo2 - 1.2), b: P(hi + 1.2), nx: -nx, nz: -nz };   // outward = toward road
}
// road frame: centreline point nearest the house, direction, and normal toward the house
const roadFrame = { qx: r.qx, qz: r.qz, ux: r.ux, uz: r.uz,
  nx: (o.cx - r.qx) / dl, nz: (o.cz - r.qz) / dl };
const job = { id: ID, program, obb: { cx: o.cx, cz: o.cz }, rotY,
  W: front.lateral, D: front.depth, frontage, roadFrame, off,
  seed: parseInt(ID.slice(-6)) || 7 };
const propFiles = fs.readdirSync(PROPS_DIR).filter(f => f.endsWith('.glb'));
console.log(`[${W.name}] test-world: bld ${ID} at (${o.cx.toFixed(1)}, ${o.cz.toFixed(1)}), road ${r.type} @ ${r.d.toFixed(1)}m`);
console.log(`  spawn suggestion: ?test1&spawnat=${r.qx.toFixed(0)},${r.qz.toFixed(0)}`);

const PAGE = String.raw`<!doctype html><html><head><meta charset=utf8></head><body>
<script src="/three.min.js"></script>
<script src="/GLTFLoader.js"></script>
<script src="/GLTFExporter.js"></script>
<script src="/house-factory.js"></script>
<script>
window.RESULT=null;window.ERR=null;
var JOB=` + JSON.stringify(job) + `;
var KP=[],KN=[],KC=[];
function collect(mesh){var g=mesh.geometry;g=g.index?g.toNonIndexed():g.clone();g.applyMatrix4(mesh.matrixWorld);
  if(!g.attributes.normal)g.computeVertexNormals();
  var pos=g.attributes.position.array,nrm=g.attributes.normal.array,col=g.attributes.color?g.attributes.color.array:null,cis=col?g.attributes.color.itemSize:0;
  var mc=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material).color||{r:1,g:1,b:1};
  for(var i=0;i<pos.length;i+=3){KP.push(pos[i],pos[i+1],pos[i+2]);KN.push(nrm[i],nrm[i+1],nrm[i+2]);}
  for(var v=0;v<pos.length/3;v++){var r=col?col[v*cis]:1,gg=col?col[v*cis+1]:1,b=col?col[v*cis+2]:1;KC.push(r*mc.r,gg*mc.g,b*mc.b);}}
function collectAll(root){root.updateMatrixWorld(true);root.traverse(function(m){if(m.isMesh)collect(m);});}
var CACHE={};
function loadProp(name){if(CACHE[name])return Promise.resolve(CACHE[name]);
  return new Promise(function(res,rej){new THREE.GLTFLoader().load('/props/'+name+'.glb',function(g){CACHE[name]=g.scene;res(g.scene);},undefined,rej);});}
function instProp(src,spec,px,pz,rot){
  var obj=src.clone(true);
  obj.updateMatrixWorld(true);
  var bb=new THREE.Box3().setFromObject(obj),sz=bb.getSize(new THREE.Vector3());
  var sy=(spec.h||2)/Math.max(0.01,sz.y),sxz=sy*(spec.rxz||1);
  obj.traverse(function(m){if(!m.isMesh)return;
    var mats=Array.isArray(m.material)?m.material:[m.material];
    var out=[];
    for(var i=0;i<mats.length;i++){var mat=mats[i];var col=mat.color?mat.color.clone():new THREE.Color(1,1,1);
      if(spec.tint){var mn=(mat.name||'').toLowerCase();var hit=false;
        for(var k in spec.tint){if(k!=='*'&&mn.indexOf(k.toLowerCase())>=0){col=new THREE.Color(spec.tint[k]);hit=true;break;}}
        if(!hit&&spec.tint['*'])col=new THREE.Color(spec.tint['*']);
        if(!hit&&!spec.tint['*'])console.log('tint-miss '+(spec.model||spec.row)+' mat "'+(mat.name||'?')+'"');}
      out.push(new THREE.MeshLambertMaterial({color:col}));}
    m.material=Array.isArray(m.material)?out:out[0];});
  // ground the model: after scaling, its bbox min sits at y=0
  var wrap=new THREE.Group();wrap.add(obj);
  obj.scale.set(sxz,sy,sxz);obj.updateMatrixWorld(true);
  var bb2=new THREE.Box3().setFromObject(obj);
  obj.position.y-=bb2.min.y;
  wrap.position.set(px,spec.y||0,pz);wrap.rotation.y=rot||0;
  return wrap;}
async function main(){
  var env=JOB.program.environment||{};
  var fr=JOB.frontage,rf=JOB.roadFrame;
  var ax=fr.a[0],az=fr.a[1],bx=fr.b[0],bz=fr.b[1];
  var L=Math.hypot(bx-ax,bz-az),fux=(bx-ax)/L,fuz=(bz-az)/L;
  var inx=-fr.nx,inz=-fr.nz;                     // inward = away from the road
  function F(t,inset){return [ax+fux*L*t+inx*inset, az+fuz*L*t+inz*inset];}
  var rphi=Math.atan2(-rf.uz,rf.ux);
  // --- ground
  var gnd=env.ground||{};var gsz=gnd.size||[220,180];
  var g0=new THREE.Mesh(new THREE.BoxGeometry(gsz[0],0.3,gsz[1]),new THREE.MeshLambertMaterial({color:new THREE.Color(gnd.lawn||'#7ec850')}));
  g0.position.set(JOB.obb.cx,-0.15,JOB.obb.cz);collectAll(g0);
  // --- road strip + kerb bands (real centreline through rf.qx/qz along rf.u)
  var rd=env.road||{};var hw=rd.halfW||3.4,rlen=rd.len||160;
  function rbox(w,h,d,color,cx,cz,y){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:new THREE.Color(color)}));
    m.position.set(cx,y,cz);m.rotation.y=rphi;return m;}
  collectAll(rbox(rlen,0.1,hw*2,rd.surface||'#8f9296',rf.qx,rf.qz,0.02));
  for(var s=-1;s<=1;s+=2){
    collectAll(rbox(rlen,0.16,0.35,rd.kerb||'#b9bdc2',rf.qx-rf.nx*s*(hw+0.17),rf.qz-rf.nz*s*(hw+0.17),0.05));}
  // NOTE: rf.n points toward the house; kerbs sit at both asphalt edges.
  // --- red/white painted kerb segments (Israeli no-parking) on the house side,
  // along the frontage span: alternating 1m modules proud of the grey kerb band
  if(rd.paintKerb!==false){
    var kx=rf.qx+rf.nx*(hw+0.17),kz=rf.qz+rf.nz*(hw+0.17);
    // project frontage ends onto the road axis to know the painted span
    var e0=((ax-rf.qx)*rf.ux+(az-rf.qz)*rf.uz)-2,e1=((bx-rf.qx)*rf.ux+(bz-rf.qz)*rf.uz)+6;
    if(e1<e0){var tmp=e0;e0=e1;e1=tmp;}
    for(var ks=e0,ki=0;ks<e1;ks+=1.0,ki++){
      var kcx=kx+rf.ux*(ks+0.5),kcz=kz+rf.uz*(ks+0.5);
      collectAll(rbox(0.98,0.18,0.37,(ki%2?'#e8e6e0':'#c94434'),kcx,kcz,0.06));}}
  // --- driveway apron from road edge to the vehicle gate
  if(env.driveway){var dv=env.driveway;var dP=F(dv.at,0);
    var dLen=Math.max(1,JOB.off-hw+0.3);
    var dcx=dP[0]-inx*dLen/2,dcz=dP[1]-inz*dLen/2;
    var m2=new THREE.Mesh(new THREE.BoxGeometry(dv.w||5,0.2,dLen),new THREE.MeshLambertMaterial({color:new THREE.Color(dv.color||'#a89d8b')}));
    m2.position.set(dcx,0.1,dcz);m2.rotation.y=Math.atan2(inx,inz);collectAll(m2);}
  // --- house + frontage (factory v3, same as rebake-programs)
  var model=makeBuildingV3(JOB.program,JOB.W,JOB.D);
  model.rotation.y=JOB.rotY;model.position.set(JOB.obb.cx,0,JOB.obb.cz);
  collectAll(model);
  var fro=makeFrontageV3(JOB.program,JOB.frontage,JOB.seed);
  collectAll(fro);
  // --- environment props (CC0 pack GLBs, retinted, bbox-normalised)
  var placed=0;var rnd=(function(seed){var s2=seed>>>0||1;return function(){s2=(s2*1664525+1013904223)>>>0;return s2/4294967296;};})(JOB.seed);
  function mkBox(w,h,d,color,px,py,pz,rot){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:new THREE.Color(color)}));
    m.position.set(px,py,pz);m.rotation.y=rot||0;return m;}
  function mkCar(sp,px,pz,rot){ // simple low-poly car: body + cabin + windows + wheels
    var g2=new THREE.Group(),c=sp.color||'#d8d8d8',dkr=new THREE.Color(c).multiplyScalar(0.85).getStyle();
    g2.add(mkBox(4.2,0.68,1.78,c,0,0.62,0));                          // body
    g2.add(mkBox(2.3,0.52,1.62,c,-0.15,1.18,0));                      // cabin
    g2.add(mkBox(2.31,0.34,1.5,'#3a4750',-0.15,1.16,0));              // window band
    g2.add(mkBox(0.5,0.2,1.5,dkr,1.95,0.5,0));                        // front bumper
    g2.add(mkBox(0.5,0.2,1.5,dkr,-1.95,0.5,0));                       // rear bumper
    for(var wx=-1;wx<=1;wx+=2)for(var wz=-1;wz<=1;wz+=2){
      var wh2=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.24,10),new THREE.MeshLambertMaterial({color:0x24262a}));
      wh2.rotation.x=Math.PI/2;wh2.position.set(wx*1.35,0.34,wz*0.82);g2.add(wh2);}
    g2.position.set(px,0,pz);g2.rotation.y=rot;return g2;}
  function mkLamp(px,pz,rot){ // curved-head street lamp
    var g3=new THREE.Group(),grey='#8d9296';
    var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.12,5.4,8),new THREE.MeshLambertMaterial({color:new THREE.Color(grey)}));
    pole.position.y=2.7;g3.add(pole);
    g3.add(mkBox(1.3,0.14,0.14,grey,0.6,5.5,0));                      // arm out
    g3.add(mkBox(0.55,0.22,0.3,'#e8e4d2',1.25,5.42,0));               // head
    g3.position.set(px,0,pz);g3.rotation.y=rot;return g3;}
  function mkDumpster(px,pz,rot){
    var g4=new THREE.Group(),grn='#3f7d3a';
    g4.add(mkBox(1.45,1.0,1.05,grn,0,0.62,0));
    g4.add(mkBox(1.5,0.12,1.1,'#356a31',0,1.18,0));
    for(var dw=-1;dw<=1;dw+=2)g4.add(mkBox(0.16,0.24,0.16,'#222',dw*0.55,0.12,0.3));
    g4.position.set(px,0,pz);g4.rotation.y=rot;return g4;}
  function mkPlanter(sp,px,pz,rot){
    var g5=new THREE.Group(),bc=sp.color||'#c8a97e';
    g5.add(mkBox(sp.w||2.2,0.55,sp.d||1.2,bc,0,0.28,0));
    g5.add(mkBox((sp.w||2.2)+0.1,0.1,(sp.d||1.2)+0.1,'#b39468',0,0.58,0));
    g5.position.set(px,0,pz);g5.rotation.y=rot;return g5;}
  var specs=env.props||[];
  for(var i2=0;i2<specs.length;i2++){var sp=specs[i2];
    if(sp.car||sp.lamp||sp.bin||sp.planter){
      var pk=F(sp.t,sp.inset!=null?sp.inset:1);
      // rotation.y=θ maps local (1,0,0) to (cosθ,0,-sinθ) → θ=atan2(-uz,ux) for 'along'
      var rotk=(sp.rot==='along')?Math.atan2(-rf.uz,rf.ux)+(sp.flip?Math.PI:0):(sp.rot||0)*Math.PI/180;
      var made=sp.car?mkCar(sp,pk[0],pk[1],rotk):sp.lamp?mkLamp(pk[0],pk[1],rotk)
              :sp.bin?mkDumpster(pk[0],pk[1],rotk):mkPlanter(sp,pk[0],pk[1],rotk);
      collectAll(made);placed++;continue;}
    if(sp.hedge){ // trimmed hedge mass: jittered two-tone boxes along the frame
      var cols=sp.colors||['#3c7031','#2f5d2a'];
      for(var th=sp.t0;th<=sp.t1+1e-6;th+=(sp.step||1.4)/L){
        var ph=F(th,(sp.inset||1)+ (rnd()-0.5)*0.2);
        var hh=(sp.h||3)*(0.92+rnd()*0.16),hw2=(sp.step||1.4)*1.45,hd=(sp.d||1.8);
        var hm=new THREE.Mesh(new THREE.BoxGeometry(hw2,hh,hd),new THREE.MeshLambertMaterial({color:new THREE.Color(cols[Math.floor(rnd()*cols.length)])}));
        hm.position.set(ph[0],hh/2,ph[1]);hm.rotation.y=Math.atan2(fux,fuz)+Math.PI/2+(rnd()-0.5)*0.15;
        collectAll(hm);placed++;}}
    else if(sp.row){var src=await loadProp(sp.row);
      for(var t2=sp.t0;t2<=sp.t1+1e-6;t2+=(sp.step||1.5)/L){
        var p2=F(t2,sp.inset||1);collectAll(instProp(src,sp,p2[0],p2[1],rnd()*Math.PI*2));placed++;}}
    else{var src2=await loadProp(sp.model);
      var p3=F(sp.t,sp.inset||1);collectAll(instProp(src2,sp,p3[0],p3[1],rnd()*Math.PI*2));placed++;}}
  // --- export
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(KP,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(KN,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(KC,3));
  var mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  var glb=await new Promise(function(res,rej){new THREE.GLTFExporter().parse(mesh,res,{binary:true},rej);});
  var bytes=new Uint8Array(glb),bin='';for(var i3=0;i3<bytes.length;i3++)bin+=String.fromCharCode(bytes[i3]);
  window.RESULT={b64:btoa(bin),tris:KP.length/9,props:placed};
}
main().catch(function(e){window.ERR=String(e&&e.stack||e);});
</script></body></html>`;

const V = p2 => fs.readFileSync(path.join(ROOT, 'scripts/vendor', p2));
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (req.url === '/three.min.js' || req.url === '/GLTFLoader.js' || req.url === '/GLTFExporter.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(V(req.url.slice(1))); }
  if (req.url === '/house-factory.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(ROOT, 'scripts/house-factory.js'))); }
  if (req.url.startsWith('/props/')) {
    const f = path.join(PROPS_DIR, path.basename(req.url));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); return res.end(fs.readFileSync(f)); }
  }
  res.writeHead(404); res.end();
});
await new Promise(r2 => server.listen(0, r2)); const port = server.address().port;
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', m => console.log('  [page]', m.text()));
await page.goto('http://localhost:' + port + '/', { waitUntil: 'load' });
await page.waitForFunction('window.RESULT||window.ERR', { timeout: 180000 });
const err = await page.evaluate('window.ERR');
if (err) { console.error('ERROR:\n' + err); try { await browser.close(); } catch {} server.close(); process.exit(1); }
const R = await page.evaluate('window.RESULT'); const b64 = R.b64; delete R.b64;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(JSON.stringify(R));
console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB)');
try { await browser.close(); } catch {} server.close();
process.exit(0);
