// Building isolation pass (exact-restyle plan, between restyle and Meshy): the restyled
// refs are full street scenes (fence, garden, sidewalk, neighbours) and image-to-3D turns
// those into unusable diorama slabs. This pass asks Gemini to redraw ONLY the main building
// as a standalone object so Meshy generates a proper solid building mesh that can be fitted
// to the OSM footprint. Output: maps/<dir>/restyled/iso/bld_<id>.png
//
// Run:  node --env-file=.env scripts/gemini-isolate.mjs --world=<name> --ids=<id,id,...>
//       flags: --force  --limit=N  --model=<id>
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const FORCE = argv.includes('--force');
const LIMIT = +arg('limit', 0) || 0;
const IDS = arg('ids', '') ? arg('ids').split(',') : null;
const MODEL = arg('model', process.env.GEMINI_MODEL || 'gemini-2.5-flash-image');
const KEY = process.env.GEMINI_KEY;
if (!KEY) { console.error('Missing GEMINI_KEY'); process.exit(1); }

const W = resolveWorld(argv);
const ISO_DIR = path.join(W.paths.restyled, 'iso');
fs.mkdirSync(ISO_DIR, { recursive: true });

const promptFor = (floors) =>
  'The image is a low-poly stylized street scene containing one main building. Redraw ONLY ' +
  'that main building as a standalone architectural model in exactly the same art style: ' +
  'remove the fence, walls, gates, garden, vegetation, street, sidewalk, furniture, vehicles, ' +
  'sky decoration and any neighbouring buildings. Where the fence or plants hid parts of the ' +
  'building, plausibly continue its walls, windows and doors in the same style. ' +
  (floors ? `The building has exactly ${floors} floor${floors > 1 ? 's' : ''}. ` : '') +
  'The source photo may crop the building at the image edges: zoom out and COMPLETE the ' +
  'missing parts (upper floors, roof, side walls) by continuing the visible pattern, so the ' +
  'ENTIRE building from ground to roof fits fully inside the frame with clear margin on all ' +
  'sides. Preserve the building\'s exact proportions, window layout and spacing, wall and ' +
  'roof colours, roof shape and balconies. Use a camera angle close to the source. Place it ' +
  'centered on a plain uniform light-grey background with soft neutral lighting and no ' +
  'ground shadow. Output only the image.';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fileSha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const sha = parts => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

async function isolate(refAbs, outAbs, prompt) {
  const body = {
    contents: [{ parts: [
      { text: prompt },
      { inlineData: { mimeType: 'image/png', data: fs.readFileSync(refAbs).toString('base64') } },
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
    if (!img) throw new Error('no image in response (' + (j.candidates?.[0]?.finishReason || 'no image part') + ')');
    fs.writeFileSync(outAbs, Buffer.from(img.inlineData.data, 'base64'));
    return;
  }
  throw new Error('gave up after retries (429/5xx)');
}

const specsRaw = fs.existsSync(W.paths.specs) ? JSON.parse(fs.readFileSync(W.paths.specs, 'utf8')) : {};
const specs = specsRaw.specs || specsRaw;
const refs = fs.readdirSync(W.paths.restyled).filter(f => /^bld_\d+\.png$/.test(f));
const jobs = [];
for (const f of refs) {
  const id = f.match(/^bld_(\d+)\.png$/)[1];
  if (IDS && !IDS.includes(id)) continue;
  const s = specs[id] || (Array.isArray(specs) ? specs.find(x => String(x.id) === id) : null);
  jobs.push({ id, ref: path.join(W.paths.restyled, f), out: path.join(ISO_DIR, f),
    prompt: promptFor(s?.floors || 0) });
}
const work = LIMIT ? jobs.slice(0, LIMIT) : jobs;

const manifestPath = path.join(ISO_DIR, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { items: {} };

let done = 0, skipped = 0, failed = 0;
console.log(`[${W.name}] ${work.length} isolation jobs (model=${MODEL})`);
for (const j of work) {
  const hash = sha([MODEL, j.prompt, fileSha(j.ref)]);
  if (!FORCE && manifest.items[j.id]?.hash === hash && fs.existsSync(j.out)) { skipped++; continue; }
  try {
    await isolate(j.ref, j.out, j.prompt);
    manifest.items[j.id] = { hash, model: MODEL };
    done++;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  OK ${j.id}  [${done}/${work.length - skipped}]`);
  } catch (e) { failed++; console.log(`  FAIL ${j.id}: ${e.message}`); }
  await sleep(150);
}
console.log(`\n[${W.name}] isolate DONE: ${done} new, ${skipped} cached, ${failed} failed -> ${path.relative(ROOT, ISO_DIR)}/`);
