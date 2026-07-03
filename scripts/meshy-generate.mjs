// Meshy image-to-3D layer: restyled building reference -> textured GLB, one per building.
// Part of the exact-restyle plan (docs/exact-restyle-3d-plan.md step 2): the Gemini-restyled
// image (maps/<dir>/restyled/bld_<id>.png) is submitted to Meshy's image-to-3d endpoint and
// the resulting mesh lands in maps/<dir>/gen3d/bld_<id>.glb, ready for the Blender
// normalize/fit step. NOT game geometry yet — scale/orientation are unreliable by design
// and must be constrained to the OSM footprint downstream.
//
// Run:  node --env-file=.env scripts/meshy-generate.mjs --world=<name> --ids=<id,id,...>
//       flags: --iso              use isolated refs (restyled/iso/, see gemini-isolate.mjs)
//              --model-type=lowpoly|standard (default lowpoly)
//              --polycount=N     target polycount before Blender decimate (default 6000)
//              --ai-model=<id>   meshy-5|meshy-6|latest (default latest)
//              --enhance         enable Meshy input image enhancement (default off — the
//                                restyled refs are already clean; enhancement may drift)
//              --force           regenerate even if cached
//              --dry             print jobs and exit without spending credits
//
// Needs MESHY_KEY in .env. Cached by content hash (input image + params) in
// gen3d/manifest.json, same pattern as gemini-restyle.mjs. Also saves Meshy's 4-view
// thumbnails next to the GLB (bld_<id>_thumb_*.png) for quick backside checks.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const FORCE = argv.includes('--force');
const DRY = argv.includes('--dry');
const ENHANCE = argv.includes('--enhance');
const IDS = arg('ids', '') ? arg('ids').split(',') : null;
const MODEL_TYPE = arg('model-type', 'lowpoly');
const POLYCOUNT = +arg('polycount', 6000);
const AI_MODEL = arg('ai-model', 'latest');
const KEY = process.env.MESHY_KEY;
if (!KEY) { console.error('Missing MESHY_KEY — run with: node --env-file=.env scripts/meshy-generate.mjs --world=<name> --ids=...'); process.exit(1); }

const W = resolveWorld(argv);
const ISO = argv.includes('--iso');
const SRC_DIR = ISO ? path.join(W.paths.restyled, 'iso') : W.paths.restyled;
const GEN_DIR = path.join(W.paths.dir, 'gen3d');
fs.mkdirSync(GEN_DIR, { recursive: true });

const API = 'https://api.meshy.ai/openapi/v1/image-to-3d';
const HDRS = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fileSha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const sha = parts => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

async function api(method, url, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { method, headers: HDRS, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * 2 ** attempt); continue; }
    if (r.status === 402) throw new Error('Meshy: out of credits (402)');
    if (!r.ok) throw new Error(`Meshy HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
  throw new Error('gave up after retries (429/5xx)');
}

async function download(url, outAbs) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download HTTP ${r.status} for ${outAbs}`);
  fs.writeFileSync(outAbs, Buffer.from(await r.arrayBuffer()));
}

function createBody(refAbs) {
  return {
    image_url: `data:image/png;base64,${fs.readFileSync(refAbs).toString('base64')}`,
    ai_model: AI_MODEL,
    model_type: MODEL_TYPE,
    image_enhancement: ENHANCE,
    should_texture: true,
    enable_pbr: false,            // game world is flat/unlit — base colour only
    remove_lighting: true,        // refs have baked sun shadows; strip them
    should_remesh: true,
    topology: 'triangle',
    target_polycount: POLYCOUNT,
    target_formats: ['glb'],
    multi_view_thumbnails: true,  // cheap backside sanity check without opening the GLB
  };
}

// Work list: every tier-A building with a restyled ref, or --ids subset.
if (!fs.existsSync(W.paths.viewsJson)) { console.error('missing building-views.json'); process.exit(1); }
const views = JSON.parse(fs.readFileSync(W.paths.viewsJson, 'utf8')).buildings;
const jobs = [];
for (const v of Object.values(views)) {
  if (IDS && !IDS.includes(String(v.id))) continue;
  if (!IDS && v.tier !== 'A') continue;
  const ref = path.join(SRC_DIR, `bld_${v.id}.png`);
  if (!fs.existsSync(ref)) { if (IDS) console.log(`  no ${ISO ? 'isolated' : 'restyled'} ref for ${v.id}, skipping`); continue; }
  jobs.push({ id: String(v.id), ref, out: path.join(GEN_DIR, `bld_${v.id}.glb`) });
}
if (IDS) for (const id of IDS) if (!jobs.find(j => j.id === id)) console.log(`  WARN: --ids ${id} not found in building-views.json`);

const manifestPath = path.join(GEN_DIR, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { items: {} };
const paramsKey = [AI_MODEL, MODEL_TYPE, String(POLYCOUNT), ENHANCE ? 'enh' : 'raw', ISO ? 'iso' : 'scene'];

const pending = [];
let skipped = 0;
for (const j of jobs) {
  j.hash = sha([...paramsKey, fileSha(j.ref)]);
  if (!FORCE && manifest.items[j.id]?.hash === j.hash && fs.existsSync(j.out)) { skipped++; continue; }
  pending.push(j);
}
console.log(`[${W.name}] meshy image-to-3d: ${pending.length} to generate, ${skipped} cached  (${MODEL_TYPE}, ${POLYCOUNT} tris, ${AI_MODEL})`);
if (DRY || !pending.length) { for (const j of pending) console.log(`  would submit ${j.id}`); process.exit(0); }

// Rolling window: Meshy caps concurrent tasks per account (429s past ~10 in flight),
// so keep at most MAX_INFLIGHT submitted and top up as tasks finish.
const MAX_INFLIGHT = 6;
const queue = [...pending];
let done = 0, failed = 0;
const open = new Set();
const started = Date.now();
while (queue.length || open.size) {
  if (Date.now() - started > 90 * 60 * 1000) { console.error(`  TIMEOUT with ${open.size + queue.length} tasks unfinished`); break; }
  while (queue.length && open.size < MAX_INFLIGHT) {
    const j = queue.shift();
    try {
      const res = await api('POST', API, createBody(j.ref));
      j.task = res.result || res.id;   // create returns { result: "<task-id>" }
      open.add(j);
      console.log(`  submitted ${j.id} -> task ${j.task}  (${open.size} in flight, ${queue.length} queued)`);
      await sleep(500);
    } catch (e) {
      queue.unshift(j);   // couldn't submit (rate limit despite retries) — try again next cycle
      console.log(`  submit deferred ${j.id}: ${e.message}`);
      break;
    }
  }
  await sleep(10000);
  for (const j of [...open]) {
    let t;
    try { t = await api('GET', `${API}/${j.task}`); }
    catch (e) { console.log(`  poll error ${j.id}: ${e.message}`); continue; }
    if (t.status === 'PENDING' || t.status === 'IN_PROGRESS') continue;
    open.delete(j);
    if (t.status !== 'SUCCEEDED' || !t.model_urls?.glb) {
      failed++; console.log(`  FAIL ${j.id}: ${t.status} ${t.task_error?.message || ''}`); continue;
    }
    await download(t.model_urls.glb, j.out);
    for (const [side, url] of Object.entries(t.thumbnail_urls || {}))
      await download(url, path.join(GEN_DIR, `bld_${j.id}_thumb_${side}.png`)).catch(() => {});
    manifest.items[j.id] = { hash: j.hash, task: j.task, params: paramsKey.join('/'),
      credits: t.consumed_credits, out: path.basename(j.out),
      kb: Math.round(fs.statSync(j.out).size / 1024) };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    done++;
    console.log(`  OK ${j.id}  (${manifest.items[j.id].kb} KB, ${t.consumed_credits} credits)  [${done + failed}/${pending.length}]`);
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\n[${W.name}] meshy DONE: ${done} generated, ${skipped} cached, ${failed} failed -> ${path.relative(ROOT, GEN_DIR)}/`);
