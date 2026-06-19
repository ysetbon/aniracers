// Locate the red START marker in sarsel_from_above.png, rejecting the orange POI
// pins (orange has G>>B; true red has G≈B). Saves an upscaled crop to eyeball it.
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b64 = fs.readFileSync(path.join(ROOT, 'maps', 'sarsel_info', 'sarsel_from_above.png')).toString('base64');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const r = await page.evaluate(async (b64) => {
  const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
  const W = img.width, H = img.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  // red, NOT orange: R high, R-G & R-B large, and G≈B (|G-B| small)
  const isRed = (R, G, B) => R > 100 && R - G > 55 && R - B > 55 && Math.abs(G - B) < 30;
  let sx = 0, sy = 0, c = 0, minx = 1e9, miny = 1e9, maxx = 0, maxy = 0; const samples = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
    if (isRed(R, G, B)) { sx += x; sy += y; c++; minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); if (samples.length < 6 && (x + y) % 7 === 0) samples.push([x, y, R, G, B]); }
  }
  const cx = c ? sx / c : -1, cy = c ? sy / c : -1;
  // upscaled crop around the detected centroid (or image center) for visual confirmation
  const ccx = c ? Math.round(cx) : W / 2, ccy = c ? Math.round(cy) : H / 2;
  const cw = 140, scale = 4;
  const crop = document.createElement('canvas'); crop.width = cw * scale; crop.height = cw * scale;
  const cg = crop.getContext('2d'); cg.imageSmoothingEnabled = false;
  cg.drawImage(cv, ccx - cw / 2, ccy - cw / 2, cw, cw, 0, 0, cw * scale, cw * scale);
  cg.strokeStyle = '#00e5ff'; cg.lineWidth = 2; cg.beginPath(); cg.arc(cw / 2 * scale, cw / 2 * scale, 6, 0, 7); cg.stroke();
  return { W, H, count: c, centroid: [+cx.toFixed(1), +cy.toFixed(1)], bbox: [minx, miny, maxx, maxy], samples, cropDataUrl: crop.toDataURL('image/png') };
}, b64);
fs.writeFileSync(path.join(ROOT, 'maps', 'sarsel_info', '_reddot_crop.png'), Buffer.from(r.cropDataUrl.split(',')[1], 'base64'));
delete r.cropDataUrl;
console.log(JSON.stringify(r, null, 1));
console.log('wrote _reddot_crop.png');
try { await browser.close(); } catch { }
