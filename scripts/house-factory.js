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
  var c=new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT2/2,1,4),new THREE.MeshLambertMaterial({color:hx(roof)}));
  c.scale.set(W+1.0,rh,D+1.0);c.rotation.y=Math.PI/4;c.position.y=H+rh/2+0.1;g.add(c);g.add(box(W+1.0,0.22,D+1.0,0x8a7e6a,0,H+0.1,0));}

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
