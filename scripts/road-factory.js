// Shared browser-side ROAD factory: builds a flat ribbon mesh for a road polyline in the
// game's road style, per type. Loaded via <script src> by the world-builder (and any road
// gallery). Requires THREE (r128). Exposes globals: ROAD_STYLE, buildRoad.
//
// Types: avenue (wide, lane dashes, kerb) · street (residential, centre dashes, kerb) ·
//        service (narrow, plain) · plaza (wide paved, no markings) · path (forest trail, dirt).
var ROAD_Y = 0.07;   // ribbon height above ground (ground baked at y=0)
var ROAD_STYLE = {
  avenue:  { w:11, color:0x3b3e44, kerb:0x9aa0a6, mark:'lane',   markColor:0xeae2b0 },
  street:  { w:7,  color:0x42454b, kerb:0x9aa0a6, mark:'centre', markColor:0xeef0f2 },
  service: { w:4,  color:0x474a50, kerb:null,     mark:'none' },
  plaza:   { w:8,  color:0x70757d, kerb:0x8b9098, mark:'none' },
  path:    { w:2.2,color:0x9c8a66, kerb:null,     mark:'none' },   // compacted/dirt forest path
};
// OSM surface -> ribbon colour (overrides the type default when known)
var SURFACE_COLOR = { asphalt:0x3b3e44, paved:0x55585f, paving_stones:0x6f747c,
  cobblestone:0x6a6258, sett:0x6a6258, concrete:0x6c7077, compacted:0x9c8a66,
  ground:0x8a7a5c, dirt:0x8a7a5c, gravel:0x9a9387, grass:0x6f8f55 };

function _hx(c){ return (typeof c==='number')?c:new THREE.Color(c).getHex(); }
function _mesh(pos,color){
  var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.computeVertexNormals();
  return new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:_hx(color),side:THREE.DoubleSide}));
}
// flat ribbon along a polyline, mitred at vertices
function _ribbon(pts,halfW,y){
  var L=[],R=[];
  for(var i=0;i<pts.length;i++){
    var p=pts[i],dx,dz;
    if(i===0){dx=pts[1][0]-p[0];dz=pts[1][1]-p[1];}
    else if(i===pts.length-1){dx=p[0]-pts[i-1][0];dz=p[1]-pts[i-1][1];}
    else {dx=pts[i+1][0]-pts[i-1][0];dz=pts[i+1][1]-pts[i-1][1];}
    var len=Math.hypot(dx,dz)||1, nx=-dz/len, nz=dx/len;
    L.push([p[0]+nx*halfW,y,p[1]+nz*halfW]); R.push([p[0]-nx*halfW,y,p[1]-nz*halfW]);
  }
  var pos=[];
  for(var i=0;i<pts.length-1;i++){
    pos.push(L[i][0],L[i][1],L[i][2], R[i][0],R[i][1],R[i][2], R[i+1][0],R[i+1][1],R[i+1][2],
             L[i][0],L[i][1],L[i][2], R[i+1][0],R[i+1][1],R[i+1][2], L[i+1][0],L[i+1][1],L[i+1][2]);
  }
  return pos;
}
// dashed/solid centre or lane markings
function _marks(pts,y,wmark,dashLen,gap,offset){
  var pos=[];
  for(var i=0;i<pts.length-1;i++){
    var a=pts[i],b=pts[i+1],dx=b[0]-a[0],dz=b[1]-a[1],Ln=Math.hypot(dx,dz); if(Ln<0.2) continue;
    var ux=dx/Ln,uz=dz/Ln,nx=-uz,nz=ux, s=0;
    while(s<Ln){
      var e=Math.min(Ln,s+dashLen);
      if(e-s>0.3){
        var x0=a[0]+ux*s+nx*offset, z0=a[1]+uz*s+nz*offset, x1=a[0]+ux*e+nx*offset, z1=a[1]+uz*e+nz*offset;
        pos.push(x0+nx*wmark,y,z0+nz*wmark, x0-nx*wmark,y,z0-nz*wmark, x1-nx*wmark,y,z1-nz*wmark,
                 x0+nx*wmark,y,z0+nz*wmark, x1-nx*wmark,y,z1-nz*wmark, x1+nx*wmark,y,z1+nz*wmark);
      }
      s+=dashLen+gap;
    }
  }
  return pos;
}

// spec (optional, per-road from vision): { type, color, w, surface, mark, markColor }
function buildRoad(pts, spec){
  spec=spec||{};
  var st=Object.assign({}, ROAD_STYLE[spec.type]||ROAD_STYLE.street);
  if(spec.w) st.w=spec.w;
  if(spec.mark) st.mark=spec.mark;
  if(spec.color) st.color=_hx(spec.color);
  else if(spec.surface && SURFACE_COLOR[spec.surface]!=null) st.color=SURFACE_COLOR[spec.surface];
  var g=new THREE.Group(), hw=st.w/2;
  // kerb / sidewalk: a wider, slightly lower light band peeking at the edges
  if(st.kerb!=null) g.add(_mesh(_ribbon(pts,hw+1.3,ROAD_Y-0.02), st.kerb));
  // road surface
  g.add(_mesh(_ribbon(pts,hw,ROAD_Y), st.color));
  // markings
  if(st.mark==='centre') g.add(_mesh(_marks(pts,ROAD_Y+0.02,0.16,2.4,3.0,0), st.markColor||0xeef0f2));
  else if(st.mark==='lane'){ // dashed centre + solid-ish edge hints via two offset dashed lines
    g.add(_mesh(_marks(pts,ROAD_Y+0.02,0.16,2.6,2.6,0), st.markColor||0xeae2b0));
    g.add(_mesh(_marks(pts,ROAD_Y+0.02,0.12,6,2,hw*0.62), 0xdfe2e6));
    g.add(_mesh(_marks(pts,ROAD_Y+0.02,0.12,6,2,-hw*0.62), 0xdfe2e6));
  }
  return g;
}
