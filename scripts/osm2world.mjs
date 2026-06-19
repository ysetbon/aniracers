// Thin wrapper around the vendored OSM2World CLI: convert a world's stripped base OSM
// (buildings removed) into the base GLB the bake step instances buildings onto.
//
// Run:  node scripts/osm2world.mjs --world=<name>          (base: <stem>_base.osm -> <stem>_base.glb)
//       node scripts/osm2world.mjs --world=<name> --full   (also full <stem>.osm -> <stem>.glb)
// Prereq: OSM2World built once (see docs/netanya-world-workflow.md). JDK 17 recommended.
import fs from 'fs'; import path from 'path'; import { spawnSync } from 'child_process';
import { resolveWorld, ROOT } from './world-config.mjs';

const W = resolveWorld(process.argv.slice(2));
const full = process.argv.includes('--full');
const JAR = path.join(ROOT,'OSM2World/desktop/target/osm2world-desktop-0.5.0-SNAPSHOT.jar');

function convert(inOsm, outGlb){
  if(!fs.existsSync(inOsm)){ console.error('missing input: '+path.relative(ROOT,inOsm)); process.exit(1); }
  const args = ['-jar', JAR, 'convert', '-i', inOsm, '-o', outGlb, '--lod', String(W.lod)];
  if(!fs.existsSync(JAR)){
    console.error('OSM2World jar not found at '+path.relative(ROOT,JAR)+'\nBuild it once (JDK 17 + Maven):');
    console.error('  mvn -f OSM2World/pom.xml -pl desktop -am -DskipTests -Dmaven.javadoc.skip=true package');
    console.error('then re-run, or run manually:\n  java '+args.join(' '));
    process.exit(1);
  }
  console.log('[osm2world] convert '+path.relative(ROOT,inOsm)+' -> '+path.relative(ROOT,outGlb)+' (LOD'+W.lod+')');
  const r = spawnSync('java', args, { stdio:'inherit' });
  if(r.status!==0){
    console.error('\njava convert failed (status '+r.status+'). If it is a module/access error, use JDK 17 or add:');
    console.error('  java --add-exports java.base/java.lang=ALL-UNNAMED '+args.join(' '));
    process.exit(1);
  }
  console.log('[osm2world] wrote '+path.relative(ROOT,outGlb)+' ('+(fs.statSync(outGlb).size/1048576).toFixed(1)+' MB)');
}

convert(W.paths.osmBase, W.paths.baseGlb);
if(full) convert(W.paths.osm, W.paths.osmGlb);
