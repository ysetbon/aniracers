// Gemini restyle layer: raw Street View photo -> the same scene redrawn in the game's art
// style. The output is the "canonical reference" used by the spec agents and the street
// critic — NOT game geometry. See docs/world-enhancement-plan.md §B.
//
// Run:  node --env-file=.env scripts/gemini-restyle.mjs --world=<name>              # tier-A buildings
//       node --env-file=.env scripts/gemini-restyle.mjs --world=<name> --strips     # street strips (along-road shots)
//       flags: --tier=A,B  --limit=N  --ids=<id,id,...>  --force  --model=<id>
//
// Needs GEMINI_KEY in .env. Style anchor: maps/<name>/style-ref.png if present, else
// new_graphics_example.png at the repo root. Cached by content hash (inputs+prompt+model):
// existing outputs with a matching hash in restyled/manifest.json are skipped.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const STRIPS = argv.includes('--strips');
const FORCE = argv.includes('--force');
const ONLY_TIER = (arg('tier', 'A')).split(',');
const LIMIT = +arg('limit', 0) || 0;
const IDS = arg('ids', '') ? arg('ids').split(',') : null;
const MODEL = arg('model', process.env.GEMINI_MODEL || 'gemini-2.5-flash-image');
const KEY = process.env.GEMINI_KEY;
if (!KEY) { console.error('Missing GEMINI_KEY — run with: node --env-file=.env scripts/gemini-restyle.mjs --world=<name>'); process.exit(1); }

const W = resolveWorld(argv);
fs.mkdirSync(W.paths.restyled, { recursive: true });
const styleRef = fs.existsSync(W.paths.styleRef) ? W.paths.styleRef : path.join(ROOT, 'new_graphics_example.png');
if (!fs.existsSync(styleRef)) { console.error('no style reference image found (maps/<name>/style-ref.png or new_graphics_example.png)'); process.exit(1); }
console.log(`[${W.name}] model=${MODEL}  style ref: ${path.relative(ROOT, styleRef)}`);

const PROMPT_BUILDING =
  'Redraw the scene in the SECOND image as low-poly stylized game art, exactly matching the art style, ' +
  'palette and rendering of the FIRST image (the style reference). This is a real building photographed ' +
  'from the street: preserve its true proportions, floor count, window layout and spacing, wall and roof ' +
  'colours, roof shape, balconies, fences, gates and driveway exactly as photographed. Remove all vehicles, ' +
  'people, text and any foliage that blocks the facade. Keep the camera angle. Neutral noon lighting, no ' +
  'weather effects. Output only the redrawn image.';
const PROMPT_STRIP =
  'Redraw the scene in the SECOND image as low-poly stylized game art, exactly matching the art style, ' +
  'palette and rendering of the FIRST image (the style reference). This is a real residential street: ' +
  'preserve the road width and markings, kerbs, sidewalks, stone fences and walls, gates, power poles, ' +
  'signage positions and the true shapes and colours of the buildings on both sides. Remove all vehicles ' +
  'and people. Keep the camera angle. Neutral noon lighting. Output only the redrawn image.';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = f => fs.readFileSync(f).toString('base64');
const mime = f => f.endsWith('.png') ? 'image/png' : 'image/jpeg';
const sha = parts => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
const fileSha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 16);

async function restyle(photoAbs, prompt, outAbs) {
  const body = {
    contents: [{ parts: [
      { text: prompt },
      { inlineData: { mimeType: mime(styleRef), data: b64(styleRef) } },
      { inlineData: { mimeType: mime(photoAbs), data: b64(photoAbs) } },
    ] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * 2 ** attempt); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const img = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
    if (!img) {
      const why = j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'no image part';
      throw new Error('no image in response (' + why + ')');
    }
    fs.writeFileSync(outAbs, Buffer.from(img.inlineData.data, 'base64'));
    return;
  }
  throw new Error('gave up after retries (429/5xx)');
}

// Build the work list: [{key, photo, prompt, out}]
const jobs = [];
if (!STRIPS) {
  if (!fs.existsSync(W.paths.viewsJson)) { console.error('missing building-views.json — run harvest-views.mjs first'); process.exit(1); }
  const views = JSON.parse(fs.readFileSync(W.paths.viewsJson, 'utf8')).buildings;
  for (const v of Object.values(views)) {
    if (!ONLY_TIER.includes(v.tier) || !v.views?.length) continue;
    if (IDS && !IDS.includes(String(v.id))) continue;
    jobs.push({ key: `bld_${v.id}`, photo: path.join(W.paths.views, v.views[0].file),
      prompt: PROMPT_BUILDING, out: path.join(W.paths.restyled, `bld_${v.id}.png`) });
  }
} else {
  const stripsJson = path.join(W.paths.dir, 'strips-sv.json');
  if (!fs.existsSync(stripsJson)) { console.error('missing strips-sv.json — run harvest-views.mjs --strips first'); process.exit(1); }
  const strips = JSON.parse(fs.readFileSync(stripsJson, 'utf8')).strips;
  for (const s of strips) {
    const along = s.shots?.find(x => x.file.endsWith('_a.jpg'));
    if (!along) continue;
    if (IDS && !IDS.includes(String(s.road))) continue;
    jobs.push({ key: `strip_${s.road}_${s.k}`, photo: path.join(W.paths.views, 'strips', along.file),
      prompt: PROMPT_STRIP, out: path.join(W.paths.restyled, `strip_${s.road}_${s.k}.png`) });
  }
}
const work = LIMIT ? jobs.slice(0, LIMIT) : jobs;

const manifestPath = path.join(W.paths.restyled, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { items: {} };
const styleHash = fileSha(styleRef);

let done = 0, skipped = 0, failed = 0;
console.log(`[${W.name}] ${work.length} restyle jobs (${jobs.length} total, limit=${LIMIT || 'none'})`);
for (const j of work) {
  if (!fs.existsSync(j.photo)) { console.log(`  missing photo for ${j.key}, skipping`); failed++; continue; }
  const hash = sha([MODEL, j.prompt, styleHash, fileSha(j.photo)]);
  if (!FORCE && manifest.items[j.key]?.hash === hash && fs.existsSync(j.out)) { skipped++; continue; }
  try {
    await restyle(j.photo, j.prompt, j.out);
    manifest.items[j.key] = { hash, model: MODEL, src: path.relative(ROOT, j.photo), out: path.basename(j.out) };
    done++;
    if (done % 10 === 0) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`  ${done}/${work.length - skipped} restyled`);
    }
  } catch (e) { failed++; console.log(`  FAIL ${j.key}: ${e.message}`); }
  await sleep(150);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\n[${W.name}] restyle DONE: ${done} new, ${skipped} cached, ${failed} failed -> ${path.relative(ROOT, W.paths.restyled)}/`);
