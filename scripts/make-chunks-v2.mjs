// Chunk builder for spec v2 vision extraction (INSTRUCTIONS_V2.md): per building, the raw
// keyless views (best first) + the restyled canonical reference. Pilot chunks 1-2 (HaRav
// Toledano) were hand-built with this exact shape; this script continues the numbering.
// Buildings that already carry v2 fields in building-specs.json are skipped (re-run with
// --all to redo them).
// Run: node scripts/make-chunks-v2.mjs --world=<name> [--size=16] [--tier=A] [--all]
import fs from 'fs'; import path from 'path';
import { resolveWorld, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const SIZE = +arg('size', 16);
const TIERS = arg('tier', 'A').split(',');
const ALL = argv.includes('--all');
const WORK = W.paths.specWork;

if (!fs.existsSync(W.paths.viewsJson)) { console.error('missing building-views.json — run keyless-views.mjs first'); process.exit(1); }
const views = JSON.parse(fs.readFileSync(W.paths.viewsJson, 'utf8')).buildings;
const specs = fs.existsSync(W.paths.specs) ? JSON.parse(fs.readFileSync(W.paths.specs, 'utf8')).specs : {};

const items = [];
for (const v of Object.values(views)) {
  if (!TIERS.includes(v.tier) || !v.views?.length) continue;
  if (!ALL && specs[v.id]?.windowStyle) continue;          // already v2-spec'd (pilot)
  const raw = v.views.slice(0, 4).map(x => path.join(W.paths.views, x.file));
  const restyled = path.join(W.paths.restyled, `bld_${v.id}.png`);
  items.push([v.id, { views: raw, restyled: fs.existsSync(restyled) ? restyled : null }]);
}
items.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

// continue numbering after any existing chunk_v2_<k>.json
let start = 1;
for (const f of fs.readdirSync(WORK)) {
  const m = f.match(/^chunk_v2_(\d+)\.json$/);
  if (m) start = Math.max(start, +m[1] + 1);
}
let k = start, noRestyle = 0;
for (let i = 0; i < items.length; i += SIZE, k++) {
  const chunk = Object.fromEntries(items.slice(i, i + SIZE));
  noRestyle += Object.values(chunk).filter(c => !c.restyled).length;
  fs.writeFileSync(path.join(WORK, `chunk_v2_${k}.json`), JSON.stringify(chunk, null, 1));
}
console.log(`[${W.name}] ${items.length} buildings -> chunks ${start}..${k - 1} (size ${SIZE})` +
  (noRestyle ? `  — ${noRestyle} without a restyled reference` : ''));
console.log('next: one vision agent per chunk reads ' + path.relative(ROOT, path.join(WORK, 'INSTRUCTIONS_V2.md')) +
  ' and writes specs_v2_<k>.json, then: node scripts/merge-specs.mjs --world=' + W.name);
