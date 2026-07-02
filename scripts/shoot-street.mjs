// Street-level in-game shooter for the critic loop: boots the real game headless (like
// verify-ingame.mjs), places the camera at true Street View pano positions/headings and
// screenshots the baked world from exactly where the reference photos were taken.
// Compare the output against maps/<name>/restyled/ references (plan doc §D).
//
// Shot selection (one of):
//   --files=<f1,f2,...>   file names from views/keyless/keyless.json (heading/fov reused)
//   --pano=<panoId>       every manifest shot from that pano
//   --at=<lat,lon> --heading=<deg> [--fov=72]
// Options:
//   --glb=<path>          serve this GLB instead of the baked one (before/after diffing)
//   --out=<dir>           default maps/<name>/critic-work
//   --prefix=<p>          output name prefix, default game_   (use before_/after_)
// Run: node scripts/shoot-street.mjs --world=netanya --files=road_27204871_0_a.jpg
import http from 'http'; import fs from 'fs'; import path from 'path';
import puppeteer from 'puppeteer';
import { resolveWorld, readArea, projection, ROOT } from './world-config.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find(s => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const W = resolveWorld(argv);
const OUTDIR = arg('out', path.join(W.paths.dir, 'critic-work'));
const PREFIX = arg('prefix', 'game_');
const GLB_OVERRIDE = arg('glb', null);
fs.mkdirSync(OUTDIR, { recursive: true });

const proj = projection(readArea(W));
const BJ = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8'));
const PCX = BJ.PCX || 0, PCZ = BJ.PCZ || 0;

// build the shot list
const shots = [];
if (arg('at')) {
  const [lat, lon] = arg('at').split(',').map(Number);
  shots.push({ name: 'at', lat, lon, heading: +arg('heading', 0), fov: +arg('fov', 72) });
} else {
  const MANIFEST = path.join(W.paths.views, 'keyless', 'keyless.json');
  if (!fs.existsSync(MANIFEST)) { console.error('missing keyless.json — run sv-keyless.mjs first'); process.exit(1); }
  const all = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).shots;
  const files = arg('files', '') ? arg('files').split(',') : null;
  const pano = arg('pano', null);
  for (const s of all) {
    if (files && !files.includes(s.file)) continue;
    if (pano && s.pano_id !== pano) continue;
    if (!files && !pano) continue;
    shots.push({ name: s.file.replace(/\.jpg$/, ''), lat: s.lat, lon: s.lon, heading: s.heading, fov: s.fov || 72 });
  }
}
if (!shots.length) { console.error('no shots selected — use --files / --pano / --at'); process.exit(1); }
console.log(`[${W.name}] ${shots.length} camera positions${GLB_OVERRIDE ? '  (GLB override: ' + GLB_OVERRIDE + ')' : ''}`);

// world XZ for each shot (game frame = projection minus buildings.json recentre)
for (const s of shots) { const [x, z] = proj.toXZ(s.lat, s.lon); s.x = x - PCX; s.z = z - PCZ; }

const MIME = { '.html':'text/html', '.json':'application/json', '.bin':'application/octet-stream', '.glb':'model/gltf-binary',
               '.png':'image/png', '.svg':'image/svg+xml', '.js':'text/javascript', '.jpg':'image/jpeg' };
const glbPath = '/' + path.relative(ROOT, W.paths.assetGlb).split(path.sep).join('/');
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f = u === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, u);
  if (GLB_OVERRIDE && u === glbPath) f = path.resolve(GLB_OVERRIDE);
  if (!f.startsWith(ROOT) && !(GLB_OVERRIDE && f === path.resolve(GLB_OVERRIDE))) { res.writeHead(404); return res.end('nf'); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 768 });
page.on('pageerror', e => console.log('  [pageerror]', String(e)));

await page.goto(`http://localhost:${port}/?world=${W.gameKey}&dbg`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction('window.__dbg && (window.__dbg.worldGroup || window.__dbg.mishGroup)', { timeout: 90000 })
  .catch(() => { console.error('timed out waiting for worldGroup — world did not load'); process.exit(1); });
await new Promise(r => setTimeout(r, 1500));

for (const s of shots) {
  const png = await page.evaluate((s) => {
    const d = window.__dbg;
    const savedFog = d.scene.fog; d.scene.fog = null;
    // sv fov is horizontal; three takes vertical: vFov = 2 atan(tan(hFov/2) * h/w)
    const vfov = 2 * Math.atan(Math.tan(s.fov * Math.PI / 360) * 768 / 1024) * 180 / Math.PI;
    const cam = new THREE.PerspectiveCamera(vfov, 1024 / 768, 0.1, 4000);
    const EYE = 2.5, PITCH = 4 * Math.PI / 180;
    const hd = s.heading * Math.PI / 180;                    // deg from north, clockwise; north = -Z
    cam.position.set(s.x, EYE, s.z);
    cam.lookAt(s.x + Math.sin(hd), EYE + Math.tan(PITCH), s.z - Math.cos(hd));
    d.renderer.render(d.scene, cam);
    const url = d.renderer.domElement.toDataURL('image/png');
    d.scene.fog = savedFog;
    return url;
  }, s);
  const out = path.join(OUTDIR, PREFIX + s.name + '.png');
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log('  wrote ' + path.relative(ROOT, out));
}
try { await browser.close(); } catch {}
server.close();
console.log('done [' + W.name + '] -> ' + path.relative(ROOT, OUTDIR));
