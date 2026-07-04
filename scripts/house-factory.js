// Shared browser-side 3D house factory used by BOTH build-mishkenot-from-specs.mjs
// (bakes the game world) and building-gallery.mjs (the inspection gallery), so the
// models you inspect are byte-identical to the ones in the game. Loaded via <script src>.
// Requires THREE (r128) to be loaded first. Exposes globals: FLOOR_H, makeBuilding, obb.
var FLOOR_H = 3.0;
function hx(c){return (typeof c==='number')?c:new THREE.Color(c).getHex();}
function box(w,h,d,color,x,y,z){var m=new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.02,w),Math.max(0.02,h),Math.max(0.02,d)),new THREE.MeshLambertMaterial({color:hx(color)}));m.position.set(x,y,z);return m;}

function addWindows(g,W,H,D,floors,glass,cols,shutters,doors,style,frameCol){
  cols=Math.max(1,cols||Math.max(2,Math.round(W/3.4)));
  var winW=Math.min(1.4,(W/cols)*0.55),winH=1.45;
  if(style==='horizontal'){cols=Math.max(1,Math.round(cols*0.6));winW=Math.min(2.8,(W/cols)*0.8);winH=1.15;}
  var colD=Math.max(1,Math.round(D/3.6));
  var winD=Math.min(1.4,(D/colD)*0.55);
  var doorXs=doors>=2?[-W/4,W/4]:[0];
  var framed=style==='framed',fc=frameCol||0xf4f1e8;
  for(var f=0;f<floors;f++){var y=f*FLOOR_H+FLOOR_H*0.55;
    for(var c=0;c<cols;c++){var x=-W/2+(c+0.5)*(W/cols);
      var nearDoor=false;for(var di=0;di<doorXs.length;di++)if(Math.abs(x-doorXs[di])<1.2)nearDoor=true;
      if(f===0&&nearDoor)continue;
      if(framed){g.add(box(winW+0.3,winH+0.28,0.08,fc,x,y,D/2+0.01));g.add(box(winW+0.3,winH+0.28,0.08,fc,x,y,-D/2-0.01));}
      g.add(box(winW,winH,0.14,glass,x,y,D/2+0.02));g.add(box(winW,winH,0.14,glass,x,y,-D/2-0.02));
      if(shutters){g.add(box(winW+0.22,winH+0.1,0.06,0xb7ad97,x,y,D/2+0.05));}}
    for(var k=0;k<colD;k++){var z=-D/2+(k+0.5)*(D/colD);
      g.add(box(0.14,winH,winD,glass,W/2+0.02,y,z));g.add(box(0.14,winH,winD,glass,-W/2-0.02,y,z));}}
}
function addBalconies(g,W,H,D,floors){for(var f=1;f<floors;f++){var y=f*FLOOR_H;
  g.add(box(W*0.84,0.18,1.1,0xe4e1d8,0,y+0.05,D/2+0.55));g.add(box(W*0.84,0.7,0.1,0xf3f1ea,0,y+0.45,D/2+1.05));
  for(var x=-W*0.4;x<=W*0.4;x+=1.1)g.add(box(0.08,0.7,0.08,0xf3f1ea,x,y+0.45,D/2+1.05));}}
function addDoors(g,W,D,doors){var xs=doors>=2?[-W/4,W/4]:[0];
  for(var i=0;i<xs.length;i++){g.add(box(1.25,2.25,0.16,0x5a4636,xs[i],1.12,D/2+0.06));
    g.add(box(1.7,0.16,0.9,0xf0ede4,xs[i],2.4,D/2+0.42));}}  // small canopy over each door
function addFlatRoof(g,W,H,D,roof,solar){g.add(box(W+0.2,0.25,D+0.2,roof,0,H+0.12,0));
  var E=[[0,D/2],[0,-D/2],[W/2,0],[-W/2,0]];for(var i=0;i<4;i++){var hz=E[i][1]!==0;g.add(box(hz?W+0.3:0.25,0.5,hz?0.25:D+0.3,0xe7e7e7,E[i][0],H+0.45,E[i][1]));}
  if(solar){g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,2.2,12),new THREE.MeshLambertMaterial({color:0xf2f2f2})).translateX(-W*0.2).translateY(H+1.3).translateZ(-D*0.15));
    var p=box(2.6,0.12,1.4,0x24405e,W*0.18,H+0.9,D*0.05);p.rotation.x=-0.5;g.add(p);g.add(box(0.6,0.6,0.6,0x333333,W*0.18,H+0.5,D*0.05));}}
function gablePrism(W,D,rh,color){ // ridge along the LONGER horizontal axis
  var alongX=W>=D, L=alongX?W:D, S=alongX?D:W; var hl=L/2,hs=S/2;
  var A=[-hl,0,-hs],B=[hl,0,-hs],C=[hl,0,hs],E=[-hl,0,hs],R0=[-hl,rh,0],R1=[hl,rh,0];
  var tris=[A,B,R1, A,R1,R0,  E,R0,R1, E,R1,C,  A,R0,E,  B,C,R1];
  var pos=[];for(var i=0;i<tris.length;i++){var v=tris[i];if(!alongX){var t=v[0];v=[v[2],v[1],-t];}pos.push(v[0],v[1],v[2]);}
  var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.computeVertexNormals();
  return new THREE.Mesh(geo,new THREE.MeshLambertMaterial({color:hx(color),side:THREE.DoubleSide}));}
function addGableRoof(g,W,H,D,roof){var rh=Math.max(1.8,Math.min(W,D)*0.42);
  g.add(box(W+0.6,0.2,D+0.6,0x8a7e6a,0,H+0.1,0));var m=gablePrism(W+0.6,D+0.6,rh,roof);m.position.y=H+0.18;g.add(m);}
function addHipRoof(g,W,H,D,roof){var rh=Math.max(2.0,Math.min(W,D)*0.36);
  // pre-rotate the 4-gon cone in GEOMETRY space: object scale is applied before rotation,
  // so scale-then-rotate on a non-square plan shears the pyramid into a giant diamond
  var cg=new THREE.ConeGeometry(Math.SQRT2/2,1,4);cg.rotateY(Math.PI/4);
  var c=new THREE.Mesh(cg,new THREE.MeshLambertMaterial({color:hx(roof)}));
  c.scale.set(W+1.0,rh,D+1.0);c.position.y=H+rh/2+0.1;g.add(c);g.add(box(W+1.0,0.22,D+1.0,0x8a7e6a,0,H+0.1,0));}

function makeBuilding(p){
  var g=new THREE.Group();var floors=Math.max(1,p.floors||2),H=floors*FLOOR_H,W=p.W,D=p.D;
  var glass=new THREE.Color(p.glass||0x6b8194);
  // main mass
  g.add(box(W,H,D,p.wall,0,H/2,0));
  // base / plinth
  if(p.stoneBase)g.add(box(W+0.4,1.2,D+0.4,0xc8bda6,0,0.6,0));
  else g.add(box(W+0.3,0.4,D+0.3,0xcfc7b5,0,0.2,0));
  addWindows(g,W,H,D,floors,glass,p.cols,p.shutters,p.doors||1,p.windowStyle,p.accent);
  addDoors(g,W,D,p.doors||1);
  if(p.accent){g.add(box(W+0.06,0.5,D+0.06,p.accent,0,H-0.25,0));}   // accent band under the roofline
  if(p.balconies)addBalconies(g,W,H,D,floors);
  var roof=new THREE.Color(p.roofColor||0xcfcfcf);
  if(p.roof==='gabled')addGableRoof(g,W,H,D,roof);
  else if(p.roof==='hipped')addHipRoof(g,W,H,D,roof);
  else addFlatRoof(g,W,H,D,roof,p.solar);
  return g;}

function obb(foot){var bestLen=0,theta=0;for(var i=0;i<foot.length;i++){var a=foot[i],b=foot[(i+1)%foot.length];var dx=b[0]-a[0],dz=b[1]-a[1];var l=dx*dx+dz*dz;if(l>bestLen){bestLen=l;theta=Math.atan2(dz,dx);}}
  var c=Math.cos(theta),s=Math.sin(theta),mnu=1e9,mxu=-1e9,mnv=1e9,mxv=-1e9;
  for(var j=0;j<foot.length;j++){var u=foot[j][0]*c+foot[j][1]*s,v=-foot[j][0]*s+foot[j][1]*c;if(u<mnu)mnu=u;if(u>mxu)mxu=u;if(v<mnv)mnv=v;if(v>mxv)mxv=v;}
  var W=mxu-mnu,D=mxv-mnv,uc=(mnu+mxu)/2,vc=(mnv+mxv)/2;return {cx:uc*c-vc*s,cz:uc*s+vc*c,W:W,D:D,theta:theta};}

// ---- footprint-accurate buildings: extrude the REAL polygon (for L-shaped/complex
// footprints where a fitted rectangle would overshoot). Built in WORLD coords. ----
function ringOf(foot){var r=foot.slice();if(r.length>1){var a=r[0],b=r[r.length-1];if(a[0]===b[0]&&a[1]===b[1])r.pop();}return r;}
function polyArea(foot){var f=ringOf(foot),a=0;for(var i=0,j=f.length-1;i<f.length;j=i++)a+=(f[j][0]+f[i][0])*(f[j][1]-f[i][1]);return Math.abs(a/2);}
function polyCentroid(foot){var f=ringOf(foot),x=0,z=0,a=0;for(var i=0,j=f.length-1;i<f.length;j=i++){var cr=f[j][0]*f[i][1]-f[i][0]*f[j][1];a+=cr;x+=(f[j][0]+f[i][0])*cr;z+=(f[j][1]+f[i][1])*cr;}a*=0.5;
  if(Math.abs(a)<1e-6){x=0;z=0;for(var k=0;k<f.length;k++){x+=f[k][0];z+=f[k][1];}return [x/f.length,z/f.length];}return [x/(6*a),z/(6*a)];}
function prismSides(ring,y0,y1,color){var pos=[];for(var i=0;i<ring.length;i++){var a=ring[i],b=ring[(i+1)%ring.length];
    pos.push(a[0],y0,a[1], b[0],y0,b[1], b[0],y1,b[1], a[0],y0,a[1], b[0],y1,b[1], a[0],y1,a[1]);}
  var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.computeVertexNormals();
  return new THREE.Mesh(geo,new THREE.MeshLambertMaterial({color:hx(color),side:THREE.DoubleSide}));}
function capTris(ring,y,color){var contour=ring.map(function(p){return new THREE.Vector2(p[0],p[1]);});
  var faces=THREE.ShapeUtils.triangulateShape(contour,[]),pos=[];
  for(var i=0;i<faces.length;i++){var f=faces[i];for(var k=0;k<3;k++){var v=contour[f[k]];pos.push(v.x,y,v.y);}}
  var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.computeVertexNormals();
  return new THREE.Mesh(geo,new THREE.MeshLambertMaterial({color:hx(color),side:THREE.DoubleSide}));}
function winBox(w,h,d,color,px,py,pz,phi){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:hx(color)}));m.position.set(px,py,pz);m.rotation.y=phi;return m;}
function makeFootprintBuilding(foot,p){
  var ring=ringOf(foot);var floors=Math.max(1,p.floors||2),H=floors*FLOOR_H,g=new THREE.Group();
  g.add(prismSides(ring,0,H,p.wall));
  if(p.stoneBase)g.add(prismSides(ring,0,1.2,0xc8bda6));
  g.add(capTris(ring,H+0.12,p.roofColor||0xc9cdd2));
  g.add(prismSides(ring,H,H+0.6,0xe7e7e7));           // parapet
  var glass=p.glass||'#6b8194',cen=polyCentroid(ring),longest={len:-1};
  for(var i=0;i<ring.length;i++){var a=ring[i],b=ring[(i+1)%ring.length];
    var dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<1.0)continue;
    var ux=dx/len,uz=dz/len,nx=-uz,nz=ux,mx=a[0]+dx*0.5,mz=a[1]+dz*0.5;
    if((mx-cen[0])*nx+(mz-cen[1])*nz<0){nx=-nx;nz=-nz;}
    var phi=Math.atan2(-uz,ux),nWin=Math.max(1,Math.round(len/3.6)),winW=Math.min(1.3,(len/nWin)*0.55);
    for(var f=0;f<floors;f++){var y=f*FLOOR_H+FLOOR_H*0.55;
      for(var w=0;w<nWin;w++){var t=(w+0.5)/nWin,px=a[0]+dx*t+nx*0.06,pz=a[1]+dz*t+nz*0.06;
        g.add(winBox(winW,1.45,0.14,glass,px,y,pz,phi));
        if(p.shutters)g.add(winBox(winW+0.22,1.6,0.05,0xb7ad97,px+nx*0.02,y,pz+nz*0.02,phi));}}
    if(len>longest.len)longest={len:len,a:a,dx:dx,dz:dz,nx:nx,nz:nz,phi:phi};}
  if(longest.a){var doors=p.doors||1,xs=doors>=2?[0.38,0.62]:[0.5];
    for(var di=0;di<xs.length;di++){var t2=xs[di],px2=longest.a[0]+longest.dx*t2+longest.nx*0.07,pz2=longest.a[1]+longest.dz*t2+longest.nz*0.07;
      g.add(winBox(1.2,2.2,0.16,0x5a4636,px2,1.1,pz2,longest.phi));}}
  if(p.solar){var tk=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,2.0,12),new THREE.MeshLambertMaterial({color:0xf2f2f2}));tk.position.set(cen[0],H+1.2,cen[1]);g.add(tk);}
  return g;}

// ===================== factory v3: scene programs (exact-geometry-program-plan) ==========
// makeBuildingV3(program, W, D): build in LOCAL coords — x in [-W/2,W/2], z in [-D/2,D/2],
// FRONT = -z side. Caller rotates/places (front toward the street) like rebake does.
// Deterministic: same program -> byte-identical geometry (seeded LCG, no Math.random).
function lcg(seed){var s=seed>>>0||1;return function(){s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function dim(c,f){var col=new THREE.Color(hx(c));col.multiplyScalar(f);return col.getHex();}
// lightness shift that CLAMPS (unlike dim's multiplyScalar, which overflows getHex on
// near-white walls). +dl lightens, -dl darkens; used for facade trim (Pass 2).
function shade(c,dl){var col=new THREE.Color(hx(c));col.offsetHSL(0,0,dl);return col.getHex();}

function v3Volume(g,vol,W,D,floorH){
  var w=(vol.x1-vol.x0)*W, d=(vol.z1-vol.z0)*D, h=(vol.floors||1)*floorH;
  var cx=(-W/2)+(vol.x0+vol.x1)/2*W, cz=(-D/2)+(vol.z0+vol.z1)/2*D;
  g.add(box(w,h,d,vol.wall,cx,h/2,cz));
  // --- facade trim (Pass 2): grounds + articulates EVERY volume so blank end-walls stop
  // reading as flat grey slabs. Subtle by design (Israeli stucco blocks, not ornate villas).
  // Toggle off per-volume with "trim":false.
  if(vol.trim!==false){var wc=vol.wall,floors=vol.floors||1;
    // ground plinth: a slightly proud, slightly darker base course grounds the mass
    var plH=Math.min(0.85,h*0.4);
    g.add(box(w+0.18,plH,d+0.18,shade(wc,-0.06),cx,plH/2,cz));
    // floor-line string courses at each interior division + a cornice line under the roof
    for(var fl=1;fl<floors;fl++)g.add(box(w+0.12,0.16,d+0.12,shade(wc,0.05),cx,fl*floorH,cz));
    g.add(box(w+0.12,0.2,d+0.12,shade(wc,0.05),cx,h-0.1,cz));
    // corner pilasters: narrow proud vertical strips define the box edges (subtle quoin read)
    var qc=shade(wc,0.045),cor=[[cx-w/2,cz-d/2],[cx+w/2,cz-d/2],[cx-w/2,cz+d/2],[cx+w/2,cz+d/2]];
    for(var ci=0;ci<4;ci++)g.add(box(0.28,h,0.28,qc,cor[ci][0],h/2,cor[ci][1]));}
  // bands: horizontal accent strips; 'slats' = several thin boards. Default wraps the
  // volume; with x0/x1 (fractions of the volume width) they sit proud of front+back only.
  var bands=vol.bands||[];
  for(var i=0;i<bands.length;i++){var b=bands[i];
    var y0=(b.floor||0)*floorH+(b.y0||0)*floorH, y1=(b.floor||0)*floorH+(b.y1||1)*floorH;
    var ranged=(b.x0!=null||b.x1!=null);
    var bx0=b.x0!=null?b.x0:0,bx1=b.x1!=null?b.x1:1;
    var bw=ranged?w*(bx1-bx0):w+0.12, bcx=ranged?cx-w/2+w*(bx0+bx1)/2:cx;
    if(b.style==='slats'){var n=Math.max(3,Math.round((y1-y0)/0.28));
      for(var s2=0;s2<n;s2++){var y=y0+(s2+0.5)*(y1-y0)/n;
        if(ranged){g.add(box(bw,0.16,0.1,b.color,bcx,y,cz-d/2-0.05));g.add(box(bw,0.16,0.1,b.color,bcx,y,cz+d/2+0.05));}
        else g.add(box(bw,0.16,d+0.12,b.color,bcx,y,cz));}}
    else g.add(box(bw,y1-y0,ranged?0.1:d+0.1,b.color,bcx,(y0+y1)/2,ranged?cz-d/2-0.05:cz));}
  var roof=vol.roof||{form:'flat'};
  if(roof.form==='flat'){
    var fas=roof.fascia,ov=fas&&fas.overhang||0.25,fh=fas&&fas.h||0.45;
    g.add(box(w+ov*2,fh,d+ov*2,fas&&fas.color||'#f0ead6',cx,h+fh/2,cz));
    if(roof.parapet)g.add(box(w+0.15,roof.parapet.h||0.6,d+0.15,roof.parapet.color||vol.wall,cx,h+fh+(roof.parapet.h||0.6)/2,cz));
  }else if(roof.form==='gable'){var m=gablePrism(w+0.5,d+0.5,Math.max(1.6,Math.min(w,d)*0.4),roof.color||'#b0543c');m.position.set(cx,h+0.1,cz);g.add(m);}
  else if(roof.form==='hip'){var cg2=new THREE.ConeGeometry(Math.SQRT2/2,1,4);cg2.rotateY(Math.PI/4); // pre-rotate: see addHipRoof
    var c2=new THREE.Mesh(cg2,new THREE.MeshLambertMaterial({color:hx(roof.color||'#b0543c')}));
    c2.scale.set(w+0.8,Math.max(1.6,Math.min(w,d)*0.34),d+0.8);c2.position.set(cx,h+Math.max(1.6,Math.min(w,d)*0.34)/2+0.08,cz);g.add(c2);}
  return {w:w,d:d,h:h,cx:cx,cz:cz};
}
// facade helper: returns {ox,oz,ux,uz,nx,nz,len} — origin at facade left end, u along it,
// n outward. Facades in LOCAL volume coords; front = -z.
function v3Facade(ext,facade){
  if(facade==='front')return {ox:ext.cx-ext.w/2,oz:ext.cz-ext.d/2,ux:1,uz:0,nx:0,nz:-1,len:ext.w};
  if(facade==='back') return {ox:ext.cx+ext.w/2,oz:ext.cz+ext.d/2,ux:-1,uz:0,nx:0,nz:1,len:ext.w};
  if(facade==='left') return {ox:ext.cx-ext.w/2,oz:ext.cz+ext.d/2,ux:0,uz:-1,nx:-1,nz:0,len:ext.d};
  return {ox:ext.cx+ext.w/2,oz:ext.cz-ext.d/2,ux:0,uz:1,nx:1,nz:0,len:ext.d};   // right
}
function v3Openings(g,program,exts,floorH){
  var ops=program.openings||[];
  for(var i=0;i<ops.length;i++){var op=ops[i];var ext=exts[op.volume];if(!ext)continue;
    var f=v3Facade(ext,op.facade||'front');
    var ats=op.at||[0.5];if(op.cols&&!op.at){ats=[];for(var c=0;c<op.cols;c++)ats.push((c+0.5)/op.cols);}
    var phi=Math.atan2(f.nx,f.nz);   // rotY so box faces outward
    for(var a=0;a<ats.length;a++){var t=ats[a];
      var px=f.ox+f.ux*f.len*t+f.nx*0.02,pz=f.oz+f.uz*f.len*t+f.nz*0.02;
      var y=(op.floor||0)*floorH+(op.type==='door'?(op.h||2.2)/2:floorH*0.55);
      if(op.recessed){var m0=winBox(op.w+0.34,(op.h||1.4)+0.34,0.06,dim(exts[op.volume].wallColor||'#ffffff',0.82),px,y,pz,phi);g.add(m0);}
      if(op.frame){g.add(winBox(op.w+0.22,(op.h||1.4)+0.22,0.1,op.frame,px+f.nx*0.03,y,pz+f.nz*0.03,phi));}
      g.add(winBox(op.w,(op.h||1.4),0.14,op.glass||'#4b5058',px+f.nx*0.06,y,pz+f.nz*0.06,phi));
      // sill + lintel (Pass 2): proud relief so openings read as designed, casting shadow lines
      if(op.type!=='door'){var oh=op.h||1.4,wcl=ext.wallColor||'#e8e2d0';
        g.add(winBox(op.w+0.3,0.12,0.24,shade(wcl,0.08),px+f.nx*0.12,y-oh/2-0.09,pz+f.nz*0.12,phi));
        g.add(winBox(op.w+0.26,0.14,0.16,shade(wcl,0.03),px+f.nx*0.07,y+oh/2+0.13,pz+f.nz*0.07,phi));}
      if(op.type==='door'){g.add(winBox(op.w+0.5,0.14,0.9,'#e8e2d2',px+f.nx*0.4,(op.h||2.2)+0.15,pz+f.nz*0.4,phi));}}}
}
function v3Terraces(g,program,exts){
  var ts=program.terraces||[];
  for(var i=0;i<ts.length;i++){var t=ts[i];var ext=exts[t.onVolume];if(!ext)continue;
    if(t.side!=='top')continue;
    var topY=ext.h+(0.45);   // above the fascia slab
    var per=[[ext.cx,ext.cz-ext.d/2,ext.w,0],[ext.cx,ext.cz+ext.d/2,ext.w,0],[ext.cx-ext.w/2,ext.cz,0,ext.d],[ext.cx+ext.w/2,ext.cz,0,ext.d]];
    for(var e=0;e<4;e++){var p=per[e];var horiz=p[2]>0;
      if(t.parapet)g.add(box(horiz?p[2]+0.2:0.18,t.parapet.h||0.9,horiz?0.18:p[3]+0.2,t.parapet.color||'#ffffff',p[0],topY+(t.parapet.h||0.9)/2,p[1]));
      if(t.rail){var ry=topY+(t.parapet?t.parapet.h||0.9:0)+(t.rail.h||0.35);
        g.add(box(horiz?p[2]+0.2:0.06,0.06,horiz?0.06:p[3]+0.2,t.rail.color||'#3f3c34',p[0],ry,p[1]));}}}
}
function v3Props(g,program,exts,floorH){
  var ps=program.props||[];
  for(var i=0;i<ps.length;i++){var p=ps[i];var ext=exts[p.volume];if(!ext)continue;
    var f=v3Facade(ext,p.facade||'front');var t=p.at||0.5;
    var px=f.ox+f.ux*f.len*t+f.nx*0.25,pz=f.oz+f.uz*f.len*t+f.nz*0.25;
    var phi=Math.atan2(f.nx,f.nz);
    if(p.type==='ac'){var y=(p.floor||0)*floorH+floorH*0.6;
      g.add(winBox(0.85,0.62,0.4,'#dcdcd4',px,y,pz,phi));g.add(winBox(0.7,0.45,0.05,'#b8b8b0',px+f.nx*0.2,y,pz+f.nz*0.2,phi));}
    else if(p.type==='lamp-globe'){var y2=2.5;
      var sp=new THREE.Mesh(new THREE.SphereGeometry(0.16,8,6),new THREE.MeshLambertMaterial({color:0xf6f3e6}));
      sp.position.set(px+f.nx*0.1,y2,pz+f.nz*0.1);g.add(sp);}}
}
function makeBuildingV3(program,W,D){
  var g=new THREE.Group(),floorH=program.floorH||FLOOR_H;
  var exts={};var vols=program.volumes||[];
  for(var i=0;i<vols.length;i++){exts[vols[i].name]=v3Volume(g,vols[i],W,D,floorH);exts[vols[i].name].wallColor=vols[i].wall;}
  v3Openings(g,program,exts,floorH);
  v3Terraces(g,program,exts);
  v3Props(g,program,exts,floorH);
  return g;
}

// ---- frontage: compound wall + gates + sidewalk + verge along a WORLD-coord line.
// line = {a:[x,z], b:[x,z]} on the lot boundary, road on the OUTWARD (n) side.
function makeFrontageV3(program,line,seed){
  var fr=program.frontage||{};var g=new THREE.Group();var rnd=lcg(seed||1);
  var ax=line.a[0],az=line.a[1],bx=line.b[0],bz=line.b[1];
  var L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L;
  var nx=line.nx,nz=line.nz;                    // outward (toward road)
  var phi=Math.atan2(-uz,ux);
  // --- brick compound wall with gate openings
  // gate.at = fraction along the frontage line (from ref); fallback: chained past centre.
  // Sorted by position — the wall backing-slab segmentation walks left to right.
  var gates=(fr.gates||[]).slice();var s0=L*0.55;
  for(var gi2=0;gi2<gates.length;gi2++){var Gg=gates[gi2];
    Gg._pos=(Gg.at!=null)?Gg.at*L:s0;if(Gg.at==null)s0+=(Gg.w||3)/2+2.2;}
  gates.sort(function(a,b){return a._pos-b._pos;});
  var gw=gates.map(function(x){return x.w||3;}),gpos=gates.map(function(x){return x._pos;});
  if(fr.wall){
    var wh=fr.wall.h||1.9,bw=0.6,bh=0.3;         // brick module
    var inGateAt=function(s0,s1){for(var q=0;q<gpos.length;q++)if(s1>gpos[q]-gw[q]/2-0.1&&s0<gpos[q]+gw[q]/2+0.1)return true;return false;};
    // backing slab segments (mortar colour) between gates, then proud bricks on both faces
    var segS=0;
    for(var qq=0;qq<=gpos.length;qq++){var segE=qq<gpos.length?gpos[qq]-gw[qq]/2-0.1:L;
      if(segE>segS+0.15){var sl2=segE-segS;
        g.add(winBox(sl2,wh,0.16,fr.wall.mortar||'#b5b7ab',ax+ux*(segS+sl2/2),wh/2,az+uz*(segS+sl2/2),phi));
        g.add(winBox(sl2,0.12,0.32,fr.wall.mortar||'#b5b7ab',ax+ux*(segS+sl2/2),wh+0.06,az+uz*(segS+sl2/2),phi));}
      if(qq<gpos.length)segS=gpos[qq]+gw[qq]/2+0.1;}
    var rows=Math.round(wh/bh);
    for(var r=0;r<rows;r++){var y=r*bh+bh/2;var off=(r%2)*bw/2;
      for(var s=off;s<L;s+=bw){
        var len=Math.min(bw*0.94,L-s);if(len<0.1)continue;
        if(inGateAt(s,s+len))continue;
        var cx=ax+ux*(s+len/2),cz=az+uz*(s+len/2);
        var shade=0.94+rnd()*0.12;
        g.add(winBox(len,bh*0.9,0.26,dim(fr.wall.color,shade),cx,y,cz,phi));}}
  }
  // --- gates: panel + raised border frames + arch (stacked boxes) + scroll ornament
  for(var q2=0;q2<gates.length;q2++){var G=gates[q2],w2=G.w||3,c2=G.color||'#5a564b';
    var gx=ax+ux*gpos[q2],gz=az+uz*gpos[q2];
    g.add(winBox(w2,1.5,0.12,c2,gx,0.95,gz,phi));                     // main panel
    g.add(winBox(w2,0.12,0.16,dim(c2,0.8),gx,1.78,gz,phi));           // top rail
    g.add(winBox(w2*0.86,0.5,0.12,c2,gx,2.02,gz,phi));                // arch tier 1
    g.add(winBox(w2*0.55,0.3,0.12,c2,gx,2.38,gz,phi));                // arch tier 2
    g.add(winBox(0.16,2.6,0.2,dim(c2,0.7),gx-ux*w2/2,1.3,gz-uz*w2/2,phi));
    g.add(winBox(0.16,2.6,0.2,dim(c2,0.7),gx+ux*w2/2,1.3,gz+uz*w2/2,phi));
    if(G.style&&G.style.indexOf('ornate')===0){                       // raised panel frames + curls
      var halves=w2>3?2:1,hw=w2/halves;
      for(var hv=0;hv<halves;hv++){var hx2=gx+ux*((hv+0.5)*hw-w2/2),hz2=gz+uz*((hv+0.5)*hw-w2/2);
        var fw=hw*0.72,fh=0.9,fy=0.95,lift=dim(c2,1.25);
        g.add(winBox(fw,0.07,0.16,lift,hx2,fy+fh/2,hz2,phi));         // frame top
        g.add(winBox(fw,0.07,0.16,lift,hx2,fy-fh/2,hz2,phi));         // frame bottom
        g.add(winBox(0.07,fh,0.16,lift,hx2-ux*fw/2,fy,hz2-uz*fw/2,phi));
        g.add(winBox(0.07,fh,0.16,lift,hx2+ux*fw/2,fy,hz2+uz*fw/2,phi));
        // scroll curls: small offset cubes tracing an S in each frame
        var CURL=[[-0.3,0.22],[-0.18,0.3],[-0.05,0.24],[0.05,0.1],[0.16,0.02],[0.28,0.1],[0.2,0.22]];
        for(var cu=0;cu<CURL.length;cu++)
          g.add(winBox(0.09,0.09,0.17,lift,hx2+ux*CURL[cu][0]*fw,fy+CURL[cu][1]*fh,hz2+uz*CURL[cu][0]*fw,phi));
        g.add(winBox(0.12,0.12,0.18,lift,hx2,2.02,hz2,phi));          // arch rosette
      }}}
  // --- sidewalk: mortar strip + proud stone slabs (deterministic irregular grid)
  if(fr.sidewalk){var sw=fr.sidewalk.w||3;
    var scx=ax+ux*L/2+nx*(sw/2+0.1),scz=az+uz*L/2+nz*(sw/2+0.1);
    g.add(winBox(L,0.06,sw,fr.sidewalk.joint||'#8d8474',scx,0.03,scz,phi));
    var s3=0;while(s3<L-0.3){var sl=0.9+rnd()*0.7;sl=Math.min(sl,L-s3);
      var dpos=0;while(dpos<sw-0.2){var dd=0.7+rnd()*0.5;dd=Math.min(dd,sw-dpos);
        var ccx=ax+ux*(s3+sl/2)+nx*(0.1+dpos+dd/2),ccz=az+uz*(s3+sl/2)+nz*(0.1+dpos+dd/2);
        g.add(winBox(sl*0.93,0.07,dd*0.9,dim(fr.sidewalk.color,0.93+rnd()*0.14),ccx,0.075,ccz,phi));
        dpos+=dd;}
      s3+=sl;}}
  // --- verge: grass patches with flowers OUTSIDE the wall ends (meadow strips)
  if(fr.verge){for(var side=-1;side<=1;side+=2){var vLen=6;
    var vs=side<0?-vLen:L;                                    // strip beyond each wall end
    var vcx=ax+ux*(vs+vLen/2),vcz=az+uz*(vs+vLen/2);
    g.add(winBox(vLen,0.12,fr.sidewalk?fr.sidewalk.w||3:3,fr.verge.grass,vcx+nx*1.5,0.06,vcz+nz*1.5,phi));
    var nf=Math.round(vLen*3*(fr.verge.flowers&&fr.verge.flowers.perM2||0.1));
    for(var fi=0;fi<nf;fi++){var pal=fr.verge.flowers&&fr.verge.flowers.palette||['#e04438'];
      var fx=vcx+ux*(rnd()-0.5)*vLen+nx*(0.5+rnd()*2.5),fz=vcz+uz*(rnd()-0.5)*vLen+nz*(0.5+rnd()*2.5);
      g.add(box(0.05,0.22,0.05,'#4d7a3a',fx,0.22,fz));
      g.add(box(0.13,0.1,0.13,pal[Math.floor(rnd()*pal.length)],fx,0.36,fz));}}}
  return g;
}

// ---- fences (spec v2): built along a WORLD-coord polyline, module by module.
// spec = {type:'slat'|'stone'|'hedge'|'metal', color, height, gateT (0..1|null), gateColor}
function fenceModule(g,type,color,h,cx,cz,ux,uz,len,phi){
  var wallC=hx(color||0xd8d2c0);
  if(type==='stone'){g.add(winBox(len,h,0.28,wallC,cx,h/2,cz,phi));g.add(winBox(len+0.08,0.14,0.36,0xe7e2d4,cx,h+0.07,cz,phi));return;}
  if(type==='hedge'){g.add(winBox(len,h,0.55,0x5f8f4a,cx,h/2+0.05,cz,phi));return;}
  // slat/metal share a low base wall + posts; slat adds horizontal boards, metal thin rails
  g.add(winBox(len,0.3,0.24,0xcfc7b5,cx,0.15,cz,phi));
  g.add(winBox(0.1,h,0.12,wallC,cx-ux*len/2,h/2,cz-uz*len/2,phi));
  if(type==='metal'){for(var r=0;r<2;r++)g.add(winBox(len,0.06,0.05,wallC,cx,0.75+r*(h-0.9),cz,phi));}
  else{var nb=Math.max(4,Math.round((h-0.5)/0.22)),bh=0.15;for(var b2=0;b2<nb;b2++){var y=0.5+b2*((h-0.6)/(nb-1));g.add(winBox(len,bh,0.07,wallC,cx,y,cz,phi));}}
}
function makeFence(pts,spec){
  var g=new THREE.Group(),type=spec.type||'slat',h=Math.max(0.8,Math.min(2.2,spec.height||1.5));
  if(type==='none')return g;
  var segs=[],total=0;
  for(var i=0;i<pts.length-1;i++){var L=Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);segs.push(L);total+=L;}
  var gateS=(spec.gateT!=null)?spec.gateT*total:null,GATE_W=2.6;
  var MOD=2.4,s=0;
  for(var i2=0;i2<segs.length;i2++){var a=pts[i2],b=pts[i2+1],L2=segs[i2];
    var ux=(b[0]-a[0])/L2,uz=(b[1]-a[1])/L2,phi=Math.atan2(-uz,ux);
    var n=Math.max(1,Math.round(L2/MOD)),ml=L2/n;
    for(var m=0;m<n;m++){var s0=s+m*ml,mid=s0+ml/2;
      var cx=a[0]+ux*(m+0.5)*ml,cz=a[1]+uz*(m+0.5)*ml;
      if(gateS!=null&&Math.abs(mid-gateS)<GATE_W/2){ // gate: full-height sliding panel, slightly offset
        var gc=hx(spec.gateColor||spec.color||0xd8d2c0);
        g.add(winBox(ml*0.94,0.25,0.2,0xcfc7b5,cx,0.12,cz,phi));
        for(var gb=0;gb<4;gb++)g.add(winBox(ml*0.9,0.14,0.06,gc,cx,0.45+gb*((h+0.15-0.5)/3),cz,phi));
        continue;}
      fenceModule(g,type,spec.color,h,cx,cz,ux,uz,ml*0.98,phi);}
    s+=L2;}
  return g;}
