// Central per-world config + path resolver so the whole pipeline is swap-and-run:
// every script takes `--world=<name>` and reads its paths from here.
//
// To add a NEW world: draw its polygon (area-picker), then either rely on the naming
// convention (maps/<name>/, assets/<name>/world.glb, OSM stem <name>) or add an entry to
// WORLDS below to override any of those (e.g. a different game key or data dir).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OSM_DIR = 'OSM2World/_aniracers_test';   // where the intermediate .osm/.glb live

// Registry. Only needed when a world deviates from the naming convention.
const WORLDS = {
  // The first real world keeps its original folders (dir != name) for back-compat.
  netanya: { name:'netanya', gameKey:'mishkenot', dir:'maps/mishkenot_zvulun',
             osmStem:'mishkenot', assetGlb:'assets/mishkenot/world.glb' },
};
// Defaults derived purely from the name (the convention for any new world).
function conventional(name){
  return { name, gameKey:name, dir:`maps/${name}`, osmStem:name, assetGlb:`assets/${name}/world.glb` };
}

// Tunables shared by all worlds (override per-world via WORLDS entries if needed).
const DEFAULTS = { overpassMargin:0.0006, lod:2, chunkSize:20, floorH:3.0,
  overpass:'https://overpass-api.de/api/interpreter' };

export function parseWorldName(argv){
  const a = (argv||[]).find(s => typeof s==='string' && s.startsWith('--world='));
  return a ? a.split('=')[1] : (process.env.WORLD || 'netanya');
}

export function resolveWorld(argv){
  const name = Array.isArray(argv) ? parseWorldName(argv) : (argv || 'netanya');
  const base = WORLDS[name] || conventional(name);
  const cfg = { ...DEFAULTS, ...base };
  const abs = p => path.join(ROOT, p);
  cfg.paths = {
    root: ROOT,
    dir:        abs(cfg.dir),
    area:       abs(`${cfg.dir}/area.json`),
    track:      abs(`${cfg.dir}/track.json`),
    buildings:  abs(`${cfg.dir}/buildings.json`),
    specs:      abs(`${cfg.dir}/building-specs.json`),
    sv:         abs(`${cfg.dir}/building-sv.json`),
    overrides:  abs(`${cfg.dir}/building-overrides.json`),
    streetview: abs(`${cfg.dir}/streetview`),
    specWork:   abs(`${cfg.dir}/spec-work`),
    views:      abs(`${cfg.dir}/views`),
    viewsJson:  abs(`${cfg.dir}/building-views.json`),
    restyled:   abs(`${cfg.dir}/restyled`),
    styleRef:   abs(`${cfg.dir}/style-ref.png`),
    osm:        abs(`${OSM_DIR}/${cfg.osmStem}.osm`),
    osmBase:    abs(`${OSM_DIR}/${cfg.osmStem}_base.osm`),
    baseGlb:    abs(`${OSM_DIR}/${cfg.osmStem}_base.glb`),
    osmGlb:     abs(`${OSM_DIR}/${cfg.osmStem}.glb`),
    assetGlb:   abs(cfg.assetGlb),
  };
  return cfg;
}

// Convenience: read area.json (throws a friendly error if missing).
export function readArea(cfg){
  if(!fs.existsSync(cfg.paths.area))
    throw new Error(`no area.json for world "${cfg.name}" at ${cfg.paths.area}\n  -> draw it first:  node scripts/area-picker.mjs --world=${cfg.name}`);
  return JSON.parse(fs.readFileSync(cfg.paths.area,'utf8'));
}

// The MetricMapProjection used everywhere (origin = polygon bbox centre), returned as
// closures so every script projects identically. Pass an area.json object.
export function projection(area){
  const originLat=(area.bbox.minlat+area.bbox.maxlat)/2, originLon=(area.bbox.minlon+area.bbox.maxlon)/2;
  const scale=40075016.686*Math.cos(originLat*Math.PI/180);
  const latToY=d=>{const s=Math.sin(d*Math.PI/180);return Math.log((1+s)/(1-s))/(4*Math.PI)+0.5;};
  const yO=latToY(originLat);
  const toXZ=(lat,lon)=>[ (lon-originLon)/360*scale, -(latToY(lat)-yO)*scale ];
  const fromXZ=(x,z)=>{ const lon=originLon+x/scale*360;
    const t=Math.exp(4*Math.PI*((yO-z/scale)-0.5));
    const lat=Math.asin((t-1)/(t+1))*180/Math.PI; return [lat,lon]; };
  return { originLat, originLon, scale, toXZ, fromXZ };
}
