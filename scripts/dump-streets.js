const fs=require('fs'),path=require('path');
const osm=JSON.parse(fs.readFileSync(path.join(__dirname,'..','osm_processed.json'),'utf8'));
const want=[/paul val/i,/albert camus/i,/paul herbe/i,/robert desnos/i,/louis lebrun/i,/8 mai/i];
for(const re of want){
  const segs=osm.roads.filter(r=>re.test(r.name));
  console.log('\n### '+(segs[0]?segs[0].name:re)+'  ('+segs.length+' segs)');
  segs.forEach(s=>console.log('  ', JSON.stringify(s.pts.map(p=>[Math.round(p[0]),Math.round(p[1])]))));
}
