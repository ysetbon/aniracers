// Headless DRIVABILITY check: loads the game world, reads the live centreline (samples/
// normals) + DRIVE envelope, then (1) measures the loop's tightest turn radius and (2)
// simulates an AI kart following the loop for ~90 s, reporting whether it ever gets stuck.
// A "stuck" frame = the kart is trying to drive but its forward progress stalls (it's being
// pinned against the corridor wall). Run: node scripts/verify-drive.mjs --world=<name>
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, ROOT } from './world-config.mjs';
const W = resolveWorld(process.argv.slice(2));

// node-side: how well does the (smoothed) loop sit on the real drivable roads? distance from
// each control point to the nearest avenue/street segment in roads.json (same recentred coords).
function loopOnRoads(){
  const tj = JSON.parse(fs.readFileSync(W.paths.track,'utf8'));
  const rj = JSON.parse(fs.readFileSync(path.join(W.paths.dir,'roads.json'),'utf8'));
  const segs=[];
  for(const r of rj.roads){ if(!(r.type==='avenue'||r.type==='street')||!r.pts) continue;
    for(let i=0;i<r.pts.length-1;i++) segs.push([r.pts[i],r.pts[i+1]]); }
  const d2seg=(p,a,b)=>{ const vx=b[0]-a[0],vz=b[1]-a[1], wx=p[0]-a[0],wz=p[1]-a[1];
    const L=vx*vx+vz*vz||1; let t=(wx*vx+wz*vz)/L; t=Math.max(0,Math.min(1,t));
    return Math.hypot(p[0]-(a[0]+vx*t), p[1]-(a[1]+vz*t)); };
  let max=0,sum=0,within=0; const TH=12;
  for(const p of tj.ctrl){ let m=Infinity; for(const s of segs){ const d=d2seg(p,s[0],s[1]); if(d<m)m=d; }
    max=Math.max(max,m); sum+=m; if(m<=TH)within++; }
  return { pts:tj.ctrl.length, meanM:+(sum/tj.ctrl.length).toFixed(1), maxM:+max.toFixed(1),
           pctWithin:Math.round(within/tj.ctrl.length*100), TH };
}

const MIME = { '.html':'text/html', '.json':'application/json', '.bin':'application/octet-stream', '.glb':'model/gltf-binary',
               '.png':'image/png', '.svg':'image/svg+xml', '.js':'text/javascript', '.jpg':'image/jpeg' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = u === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800 });
page.on('pageerror', e => console.log('  [pageerror]', String(e)));
await page.goto(`http://localhost:${port}/?world=${W.gameKey}&dbg`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction('window.__dbg && window.__dbg.samples && window.__dbg.samples.length>0', { timeout: 90000 })
  .catch(() => console.log('  (timed out waiting for samples)'));
// network-mode worlds publish a road graph shortly after load — wait so the sim can use it
await page.waitForFunction('window.__dbg && window.__dbg.driveNet', { timeout: 30000 }).catch(()=>{});

const out = await page.evaluate(() => {
  const d = window.__dbg;
  const S = d.samples.map(p=>({x:p.x,z:p.z}));
  const NM = d.normals.map(p=>({x:p.x,z:p.z}));
  const N = S.length, DR = d.drive, LOOK = d.look, DN = d.driveNet || null;
  const nearestIdx = (x,z)=>{ let bi=0,bd=Infinity; for(let i=0;i<N;i++){const dx=x-S[i].x,dz=z-S[i].z,dd=dx*dx+dz*dz; if(dd<bd){bd=dd;bi=i;}} return bi; };
  // "on road" exactly as the game decides it: network grid (real roads) or corridor band
  const onRoadAt = (x,z)=>{
    if(DR.mode==='network' && DN){ const cell=DN.cell, cx=Math.floor(x/cell), cz=Math.floor(z/cell);
      for(let ix=-1;ix<=1;ix++)for(let iz=-1;iz<=1;iz++){ const a=DN.map.get((cx+ix)+','+(cz+iz)); if(!a)continue;
        for(const p of a){ const dx=x-p[0],dz=z-p[1],h=p[2]||5; if(dx*dx+dz*dz<=h*h) return true; } }
      return false; }
    const i=nearestIdx(x,z); return Math.hypot(x-S[i].x,z-S[i].z)<DR.full;
  };

  // tightest turn radius of the sampled centreline (R = segLen / turnAngle)
  let minR = Infinity;
  for(let i=0;i<N;i++){
    const a=S[(i-1+N)%N], b=S[i], c=S[(i+1)%N];
    const u={x:b.x-a.x,z:b.z-a.z}, v={x:c.x-b.x,z:c.z-b.z};
    const lu=Math.hypot(u.x,u.z)||1, lv=Math.hypot(v.x,v.z)||1;
    let ang=Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.z*v.z)/(lu*lv))));
    if(ang>1e-3){ const r=((lu+lv)/2)/ang; if(r<minR) minR=r; }
  }

  // simulate an AI kart following the loop (mirrors the in-game NPC physics)
  const dt=1/60, aiSpeed=34, boostMul=1;
  let pos={x:S[0].x,z:S[0].z}, rot=Math.atan2(S[1].x-S[0].x, S[1].z-S[0].z), speed=0, idxPrev=0, total=0;
  let stuck=0, frames=0, minSp=Infinity, sumSp=0, progWin=[];
  const T=90, steps=Math.round(T/dt);
  for(let s=0;s<steps;s++){
    const idx=nearestIdx(pos.x,pos.z);
    const onRoad=onRoadAt(pos.x,pos.z);
    const look=(idx+LOOK)%N;
    const want=Math.atan2(S[look].x-pos.x, S[look].z-pos.z);
    let diff=want-rot; while(diff>Math.PI)diff-=2*Math.PI; while(diff<-Math.PI)diff+=2*Math.PI;
    rot+=Math.max(-2.6*dt, Math.min(2.6*dt, diff));
    let sp=aiSpeed*boostMul; if(!onRoad) sp=Math.min(sp,DR.offSp);
    speed += Math.max(-40*dt, Math.min(26*dt, sp-speed));
    pos.x += Math.sin(rot)*speed*dt; pos.z += Math.cos(rot)*speed*dt;
    const idx2=nearestIdx(pos.x,pos.z);
    const d2=Math.hypot(pos.x-S[idx2].x, pos.z-S[idx2].z);
    if(DR.mode==='network' && DN && DN.bounds){ const b=DN.bounds;
      pos.x=Math.max(b[0],Math.min(b[2],pos.x)); pos.z=Math.max(b[1],Math.min(b[3],pos.z)); }
    else if(d2>DR.limit){ const dx=pos.x-S[idx2].x, dz=pos.z-S[idx2].z, l=Math.hypot(dx,dz)||1;
      pos.x=S[idx2].x+dx/l*DR.limit; pos.z=S[idx2].z+dz/l*DR.limit; speed*=DR.wallKeep; }
    let delta=idx2-idxPrev; if(delta<-N/2)delta+=N; if(delta>N/2)delta-=N;
    if(DR.mode==='network') delta=Math.max(-2,Math.min(2,delta)); total+=delta; idxPrev=idx2;
    frames++; minSp=Math.min(minSp,speed); sumSp+=speed;
    // progress over the last ~1 s: if the kart is barely advancing along the loop, it's stuck
    progWin.push(delta); if(progWin.length>60) progWin.shift();
    if(s>120){ const adv=progWin.reduce((a,b)=>a+b,0); if(adv<0.5 && speed<6) stuck++; }
  }
  return { N, minR:+minR.toFixed(1), DR, LOOK, avgSp:+(sumSp/frames).toFixed(1), minSp:+minSp.toFixed(1),
           lapsIn90s:+(total/N).toFixed(2), stuckFrames:stuck, stuckSec:+(stuck*dt).toFixed(1) };
});

const onR = loopOnRoads();
console.log('['+W.name+'] drivability:');
console.log('  loop on roads: '+onR.pctWithin+'% of '+onR.pts+' ctrl pts within '+onR.TH+'m of a road | mean '+onR.meanM+'m, max '+onR.maxM+'m');
console.log('  centreline samples:', out.N, '| tightest turn radius:', out.minR, 'm');
console.log('  DRIVE envelope:', JSON.stringify(out.DR), '| AI look-ahead:', out.LOOK, 'samples');
console.log('  AI kart over 90s: avg', out.avgSp, 'm/s | min', out.minSp, 'm/s | laps', out.lapsIn90s);
console.log('  stuck frames:', out.stuckFrames, '('+out.stuckSec+'s of 90s)');
// turn radius the kart NEEDS at avg speed (R = v / max-yaw-rate); loop must be gentler than this
const needR = (out.avgSp/2.6).toFixed(1);
console.log('  kart needs radius >=', needR, 'm at that speed ->', out.minR>=needR ? 'OK (loop is drivable)' : 'TIGHT (corners may pinch)');

// the GLB streams in after the track is set — wait for it before the overlay shot
await page.waitForFunction('window.__dbg && (window.__dbg.worldGroup||window.__dbg.mishGroup)', { timeout: 90000 })
  .catch(() => console.log('  (world GLB not loaded; overlay will be blank)'));
await new Promise(r => setTimeout(r, 1500));
// top-down: draw the race loop (magenta) over the world so we can eyeball that it sits on roads
const png = await page.evaluate(() => {
  const d = window.__dbg;
  // cyan = drivable road network (free-roam), magenta = race loop — both above rooftops
  let netPts=null;
  if(d.driveNet){ const arr=[];
    for(const cell of d.driveNet.map.values()) for(const p of cell) arr.push(new THREE.Vector3(p[0],88,p[1]));
    netPts=new THREE.Points(new THREE.BufferGeometry().setFromPoints(arr),
      new THREE.PointsMaterial({color:0x18e0ff, size:3.2}));
    d.scene.add(netPts); }
  const pts = d.samples.map(s=>new THREE.Vector3(s.x,90,s.z)); pts.push(pts[0].clone());  // above rooftops so the top-down camera doesn't occlude it
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({color:0xff1ad0}));
  d.scene.add(line);
  const grp = d.worldGroup || d.mishGroup;
  const box = new THREE.Box3(); if(grp) grp.traverse(o=>{ if(o.isMesh) box.expandByObject(o); });
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const R = Math.max(s.x, s.z, 60);
  const savedFog = d.scene.fog; d.scene.fog = null;
  const cam = new THREE.PerspectiveCamera(52, 1200/800, 0.1, 8000);
  cam.position.set(c.x, c.y + R*1.15, c.z + 0.01); cam.lookAt(c.x, c.y, c.z);
  d.renderer.render(d.scene, cam);
  const url = d.renderer.domElement.toDataURL('image/png');
  d.scene.fog = savedFog; d.scene.remove(line); if(netPts) d.scene.remove(netPts);
  return url;
});
if(png){ fs.writeFileSync(path.join(W.paths.dir,'_loop_overlay.png'), Buffer.from(png.split(',')[1],'base64'));
  console.log('  wrote '+path.relative(ROOT,path.join(W.paths.dir,'_loop_overlay.png'))+' (loop drawn over the world)'); }

// free-roam check: does the road network load, is the race loop on roads, and is grass distinct?
await page.waitForFunction('window.__dbg && window.__dbg.driveNet', { timeout: 8000 }).catch(()=>{});
const net = await page.evaluate(() => {
  const d = window.__dbg; const DN = d.driveNet; if(!DN) return null;
  const onRoad=(x,z)=>{ const cell=DN.cell, cx=Math.floor(x/cell), cz=Math.floor(z/cell);
    for(let ix=-1;ix<=1;ix++)for(let iz=-1;iz<=1;iz++){ const a=DN.map.get((cx+ix)+','+(cz+iz)); if(!a)continue;
      for(const p of a){ const dx=x-p[0],dz=z-p[1],h=p[2]||5; if(dx*dx+dz*dz<=h*h) return true; } } return false; };
  let loopOn=0; for(const s of d.samples) if(onRoad(s.x,s.z)) loopOn++;
  const b=DN.bounds; let road=0,tot=0;
  for(let x=b[0];x<=b[2];x+=10) for(let z=b[1];z<=b[3];z+=10){ tot++; if(onRoad(x,z)) road++; }
  const nodes=[...DN.map.values()].reduce((a,c)=>a+c.length,0);
  return { nodes, loopPct:Math.round(loopOn/d.samples.length*100), roadPct:Math.round(road/tot*100) };
});
if(net) console.log('  free-roam network: '+net.nodes+' road nodes | race loop on-road '+net.loopPct+'% | map is '+net.roadPct+'% road / '+(100-net.roadPct)+'% grass');
else console.log('  free-roam network: NOT loaded (corridor mode or fetch failed)');

try { await browser.close(); } catch {}
server.close();
