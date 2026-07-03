// Facade-texture generator (plan doc §B use-2 spike): per building, ask Gemini for a FLAT
// ORTHOGRAPHIC front elevation in the game art style, derived from the restyled reference.
// The output is meant to be UV-mapped onto the building mass by the factory instead of
// (or on top of) parametric window geometry.
//
// Run: node --env-file=.env scripts/gemini-facade.mjs --world=<name> --ids=<id,id,...> [--force]
// Output: maps/<name>/facades/bld_<id>.png (cached by content hash in facades/manifest.json)
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const FORCE = argv.includes('--force');
const IDS = (arg('ids', '') || '').split(',').filter(Boolean);
const MODEL = arg('model', process.env.GEMINI_MODEL || 'gemini-3.1-flash-image');
const KEY = process.env.GEMINI_KEY;
if (!KEY) { console.error('Missing GEMINI_KEY'); process.exit(1); }
if (!IDS.length) { console.error('need --ids=<buildingId,...>'); process.exit(1); }

const W = resolveWorld(argv);
const FACADES = path.join(W.paths.dir, 'facades'); fs.mkdirSync(FACADES, { recursive: true });
const styleRef = fs.existsSync(W.paths.styleRef) ? W.paths.styleRef : path.join(ROOT, 'new_graphics_example.png');

const PROMPT =
  'From the SECOND image (a stylized street view of one building), produce a FLAT ORTHOGRAPHIC ' +
  'front elevation of that building: perfectly straight-on, zero perspective, as low-poly game art ' +
  'matching the palette and rendering of the FIRST image (the style reference). The facade must fill ' +
  'the frame edge-to-edge: no sky, no ground, no street, no fence, no vegetation, no neighbouring ' +
  'buildings, no cast shadows. Preserve the true number of floors, the window and balcony layout, ' +
  'door position, materials and colours exactly as shown. Flat even lighting. Output only the image.';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = f => fs.readFileSync(f).toString('base64');
const mime = f => f.endsWith('.png') ? 'image/png' : 'image/jpeg';
const fileSha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const sha = parts => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

async function generate(srcAbs, outAbs) {
  const body = {
    contents: [{ parts: [
      { text: PROMPT },
      { inlineData: { mimeType: mime(styleRef), data: b64(styleRef) } },
      { inlineData: { mimeType: mime(srcAbs), data: b64(srcAbs) } },
    ] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * 2 ** attempt); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const img = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
    if (!img) throw new Error('no image (' + (j.candidates?.[0]?.finishReason || 'unknown') + ')');
    fs.writeFileSync(outAbs, Buffer.from(img.inlineData.data, 'base64'));
    return;
  }
  throw new Error('gave up after retries');
}

const manifestPath = path.join(FACADES, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { items: {} };
const styleHash = fileSha(styleRef);
let done = 0, skipped = 0, failed = 0;
for (const id of IDS) {
  const src = path.join(W.paths.restyled, `bld_${id}.png`);
  if (!fs.existsSync(src)) { console.log(`  no restyled ref for ${id}, skipping`); failed++; continue; }
  const out = path.join(FACADES, `bld_${id}.png`);
  const hash = sha([MODEL, PROMPT, styleHash, fileSha(src)]);
  if (!FORCE && manifest.items[id]?.hash === hash && fs.existsSync(out)) { skipped++; continue; }
  try {
    await generate(src, out);
    manifest.items[id] = { hash, model: MODEL, out: path.basename(out) };
    done++; console.log(`  facade bld_${id}.png`);
  } catch (e) { failed++; console.log(`  FAIL ${id}: ${e.message}`); }
  await sleep(150);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`[${W.name}] facades: ${done} new, ${skipped} cached, ${failed} failed -> ${path.relative(ROOT, FACADES)}/`);
