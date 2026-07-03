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
const OUTDIR = arg('out', path.join(W.paths.dir, argv.includes('--hero') ? 'art-match' : 'critic-work'));
const PREFIX = arg('prefix', argv.includes('--hero') ? 'hero_' : 'game_');
const GLB_OVERRIDE = arg('glb', null);
fs.mkdirSync(OUTDIR, { recursive: true });

const proj = projection(readArea(W));
const BJ = JSON.parse(fs.readFileSync(W.paths.buildings, 'utf8'));
const PCX = BJ.PCX || 0, PCZ = BJ.PCZ || 0;

// build the shot list
const shots = [];
const HERO = argv.includes('--hero');
const ART = HERO || argv.includes('--art');      // aimed sun + shadows + tone mapping
const CLEAN = HERO || argv.includes('--clean');  // hide kart / gameplay objects
let heroSpec = null;
if (HERO) {
  const HF = path.join(W.paths.specWork, 'hero-shots.json');
  heroSpec = JSON.parse(fs.readFileSync(HF, 'utf8'));
  const only = arg('shot', null);                // --shot=junction-north to render just one
  for (const h of heroSpec.shots) {
    if (only && h.id !== only) continue;
    shots.push({ name: h.id, x: h.x, z: h.z, heading: h.heading, fov: h.fov || 72,
      eye: h.eye != null ? h.eye : null, pitch: h.pitch != null ? h.pitch : null, hero: h });
  }
} else if (arg('at')) {
  const [lat, lon] = arg('at').split(',').map(Number);
  shots.push({ name: 'at', lat, lon, heading: +arg('heading', 0), fov: +arg('fov', 72),
    eye: arg('eye', null) != null ? +arg('eye') : null, pitch: arg('pitch', null) != null ? +arg('pitch') : null });
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

// world XZ for each shot (game frame = projection minus buildings.json recentre).
// hero shots already carry world XZ directly — only project lat/lon shots.
for (const s of shots) { if (s.x == null && s.lat != null) { const [x, z] = proj.toXZ(s.lat, s.lon); s.x = x - PCX; s.z = z - PCZ; } }

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
// offline containers: serve the CDN three.js/GLTFLoader from the local vendor copies
await page.setRequestInterception(true);
const VENDOR = { 'three.min.js': 'three.min.js', 'GLTFLoader.js': 'GLTFLoader.js' };
page.on('request', rq => {
  const u = rq.url();
  if (/^https?:\/\/(cdnjs|unpkg)/.test(u)) {
    const base = Object.keys(VENDOR).find(k => u.endsWith(k));
    if (base) return rq.respond({ status: 200, contentType: 'text/javascript',
      body: fs.readFileSync(path.join(ROOT, 'scripts/vendor', VENDOR[base])) });
    return rq.abort();
  }
  rq.continue();
});

const extraQ = arg('q', '') ? '&' + arg('q') : '';   // e.g. --q=test3 to exercise the real URL routing
await page.goto(`http://localhost:${port}/?world=${W.gameKey}${extraQ}&dbg`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForFunction('window.__dbg && (window.__dbg.worldGroup || window.__dbg.mishGroup)', { timeout: 90000 })
  .catch(() => { console.error('timed out waiting for worldGroup — world did not load'); process.exit(1); });
await new Promise(r => setTimeout(r, 1500));

for (const s of shots) {
  const png = await page.evaluate((s, ART, CLEAN) => {
    const d = window.__dbg, sc = d.scene;
    const savedFog = sc.fog; sc.fog = null;
    // sv fov is horizontal; three takes vertical: vFov = 2 atan(tan(hFov/2) * h/w)
    const vfov = 2 * Math.atan(Math.tan(s.fov * Math.PI / 360) * 768 / 1024) * 180 / Math.PI;
    const cam = new THREE.PerspectiveCamera(vfov, 1024 / 768, 0.1, 4000);
    const EYE = s.eye != null ? s.eye : 2.5, PITCH = (s.pitch != null ? s.pitch : 4) * Math.PI / 180;
    const hd = s.heading * Math.PI / 180;                    // deg from north, clockwise; north = -Z
    cam.position.set(s.x, EYE, s.z);
    cam.lookAt(s.x + Math.sin(hd), EYE + Math.tan(PITCH), s.z - Math.cos(hd));

    // --- CLEAN: hide the kart and any non-world gameplay object (keep world mesh, lights,
    //     and big ground planes so shadows still land). Restore after the shot.
    const hidden = [];
    if (CLEAN) {
      const world = d.worldGroup || d.mishGroup;
      for (const o of sc.children) {
        if (o === world || o.isLight) continue;
        const bigPlane = o.geometry && o.geometry.type === 'PlaneGeometry';
        if (bigPlane) continue;
        if (o.visible) { hidden.push(o); o.visible = false; }
      }
    }

    // --- ART: aim the sun + shadow frustum at THIS shot's area (the game's ±160 shadow box
    //     is centred on the origin, but the junction sits at ~(120,-330) → no shadows land).
    //     Warm low key light, cooler dimmer fill, ACES tone map to clamp the neon palette.
    const saved = {};
    if (ART) {
      let sun = null, hemi = null;
      sc.traverse(o => { if (o.isDirectionalLight && !sun) sun = o; if (o.isHemisphereLight && !hemi) hemi = o; });
      if (sun) {
        saved.sun = { pos: sun.position.clone(), int: sun.intensity, col: sun.color.clone(),
          L: sun.shadow.camera.left, R: sun.shadow.camera.right, T: sun.shadow.camera.top,
          B: sun.shadow.camera.bottom, far: sun.shadow.camera.far, bias: sun.shadow.bias,
          tpos: sun.target.position.clone() };
        // late-afternoon Street View sun: low, from the west-south-west, shadows thrown east
        sun.position.set(s.x - 70, 95, s.z - 45);
        sun.target.position.set(s.x + 6, 0, s.z - 30); sun.target.updateMatrixWorld();
        if (!sun.target.parent) sc.add(sun.target);
        sun.color.setHex(0xfff0d2); sun.intensity = 1.7;
        const R = 95; sun.shadow.camera.left = -R; sun.shadow.camera.right = R;
        sun.shadow.camera.top = R; sun.shadow.camera.bottom = -R; sun.shadow.camera.far = 320;
        sun.shadow.bias = -0.0006; sun.shadow.camera.updateProjectionMatrix();
      }
      if (hemi) { saved.hemi = { int: hemi.intensity }; hemi.intensity = 0.5; }
      saved.tone = d.renderer.toneMapping; saved.exp = d.renderer.toneMappingExposure;
      d.renderer.toneMapping = THREE.ACESFilmicToneMapping; d.renderer.toneMappingExposure = 1.08;
      d.renderer.shadowMap.needsUpdate = true;
    }

    d.renderer.render(sc, cam);
    const url = d.renderer.domElement.toDataURL('image/png');

    // restore everything so successive shots / live gameplay are untouched
    if (ART) {
      let sun = null, hemi = null;
      sc.traverse(o => { if (o.isDirectionalLight && !sun) sun = o; if (o.isHemisphereLight && !hemi) hemi = o; });
      if (sun && saved.sun) { sun.position.copy(saved.sun.pos); sun.intensity = saved.sun.int; sun.color.copy(saved.sun.col);
        sun.shadow.camera.left = saved.sun.L; sun.shadow.camera.right = saved.sun.R; sun.shadow.camera.top = saved.sun.T;
        sun.shadow.camera.bottom = saved.sun.B; sun.shadow.camera.far = saved.sun.far; sun.shadow.bias = saved.sun.bias;
        sun.target.position.copy(saved.sun.tpos); sun.shadow.camera.updateProjectionMatrix(); }
      if (hemi && saved.hemi) hemi.intensity = saved.hemi.int;
      d.renderer.toneMapping = saved.tone; d.renderer.toneMappingExposure = saved.exp;
    }
    for (const o of hidden) o.visible = true;
    sc.fog = savedFog;
    return url;
  }, s, ART, CLEAN);
  const out = path.join(OUTDIR, PREFIX + s.name + '.png');
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log('  wrote ' + path.relative(ROOT, out));
  if (s.hero) {
    const lines = [`# ${s.hero.id} — ${s.hero.desc}`, ``, `target: ${s.hero.target}`,
      `render: ${path.relative(ROOT, out)}`, `camera: x=${s.x} z=${s.z} heading=${s.heading} fov=${s.fov} eye=${s.eye} pitch=${s.pitch}`, ``];
    for (const cat of Object.keys(s.hero.scorecard)) { lines.push(`## ${cat}`);
      for (const req of s.hero.scorecard[cat]) lines.push(`- [ ] ${req}`); lines.push(``); }
    fs.writeFileSync(path.join(OUTDIR, 'scorecard_' + s.hero.id + '.md'), lines.join('\n'));
  }
}
try { await browser.close(); } catch {}
server.close();
console.log('done [' + W.name + '] -> ' + path.relative(ROOT, OUTDIR));
