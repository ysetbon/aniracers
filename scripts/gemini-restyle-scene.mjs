// Scene-faithful Gemini restyle (test2 pilot): unlike gemini-restyle.mjs (which REMOVES
// vehicles and facade-blocking foliage to expose the building), this variant redraws the
// WHOLE scene — every tree, hedge, parked car, pole, lamp, bin, kerb marking — so the
// restyled refs can drive the environment/prop layer, not just the building.
//
// Run: node --env-file=.env scripts/gemini-restyle-scene.mjs --world=<name> \
//        --files=<f1.jpg,f2.jpg,...>   (names under maps/<name>/views/keyless/)
//        [--outdir=scene] [--model=<id>] [--force]
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const FORCE = argv.includes('--force');
const MODEL = arg('model', process.env.GEMINI_MODEL || 'gemini-2.5-flash-image');
const KEY = process.env.GEMINI_KEY;
if (!KEY) { console.error('Missing GEMINI_KEY — run with: node --env-file=.env ...'); process.exit(1); }
const W = resolveWorld(argv);
const FILES = (arg('files', '') || '').split(',').filter(Boolean);
if (!FILES.length) { console.error('need --files=<f1,f2,...> (under views/keyless/)'); process.exit(1); }
const OUTDIR = path.join(W.paths.restyled, arg('outdir', 'scene'));
fs.mkdirSync(OUTDIR, { recursive: true });
const styleRef = fs.existsSync(W.paths.styleRef) ? W.paths.styleRef : path.join(ROOT, 'new_graphics_example.png');

const PROMPT_SCENE =
  'Redraw the scene in the SECOND image as low-poly stylized game art, exactly matching the art style, ' +
  'palette and flat-shaded faceted rendering of the FIRST image (the style reference). This is a real ' +
  'residential street scene: reproduce the ENTIRE scene faithfully, keeping every object in its true ' +
  'position, size and colour. That includes: the house with its exact proportions, floor count, window ' +
  'layout, wall and roof colours; EVERY tree and plant exactly where it stands (tall dark cypresses stay ' +
  'tall narrow conifers, palm trees stay palms with fan fronds, hedges stay trimmed hedge masses, big ' +
  'leafy trees keep their round canopies and their overhang); the compound wall with its block pattern ' +
  'and colour changes; the metal gates with their ornament; the sidewalk with its actual paving colour; ' +
  'the red-and-white painted kerb sections; the road; ALL parked cars, redrawn as simple low-poly cars ' +
  'in their true colours, positions and orientations; power poles, street lamps, waste bins, planter ' +
  'boxes, mailboxes and doors in walls. Do NOT remove anything. Do NOT add anything that is not in the ' +
  'photo. Do NOT relocate objects. Keep the exact camera angle and framing. Neutral bright noon ' +
  'lighting, clear blue sky, no weather effects. Output only the redrawn image.';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = f => fs.readFileSync(f).toString('base64');
const mime = f => f.endsWith('.png') ? 'image/png' : 'image/jpeg';

async function restyle(photoAbs, outAbs) {
  const body = {
    contents: [{ parts: [
      { text: PROMPT_SCENE },
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
    if (!img) throw new Error('no image (' + (j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || '?') + ')');
    fs.writeFileSync(outAbs, Buffer.from(img.inlineData.data, 'base64'));
    return;
  }
  throw new Error('gave up after retries');
}

console.log(`[${W.name}] scene-restyle ${FILES.length} views, model=${MODEL}`);
let ok = 0, fail = 0;
for (const f of FILES) {
  const photo = path.join(W.paths.views, 'keyless', f);
  const out = path.join(OUTDIR, f.replace(/\.jpg$/, '.png'));
  if (!fs.existsSync(photo)) { console.log('  missing ' + f); fail++; continue; }
  if (!FORCE && fs.existsSync(out)) { console.log('  cached ' + f); ok++; continue; }
  try { await restyle(photo, out); ok++; console.log('  ok ' + f); }
  catch (e) { fail++; console.log('  FAIL ' + f + ': ' + e.message); }
  await sleep(150);
}
console.log(`done: ${ok} ok, ${fail} failed -> ${path.relative(ROOT, OUTDIR)}/`);
