// Regenerate assets/aniracers-intro-hero.png and assets/aniracers-animal-portraits.png
// from the exact in-game makeDriver() / makeKart() voxel models.
// Run: node scripts/regen-intro-assets.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(__dirname, 'render-intro-assets.html');
const OUT = {
  hero: path.join(ROOT, 'assets', 'aniracers-intro-hero.png'),
  portraits: path.join(ROOT, 'assets', 'aniracers-animal-portraits.png'),
};

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  console.error('Install puppeteer first: npm install --save-dev puppeteer');
  process.exit(1);
}

async function capture(mode) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
    const url = 'file:///' + HTML.replace(/\\/g, '/') + '?mode=' + mode;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => window.__RENDERED, { timeout: 30000 });
    const dataUrl = await page.evaluate(() => window.__EXPORT_DATA);
    const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    fs.writeFileSync(OUT[mode], buf);
    console.log('Wrote', OUT[mode], '(' + buf.length + ' bytes)');
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

(async () => {
  const modes = process.argv.slice(2);
  const todo = modes.length ? modes : ['hero', 'portraits'];
  for (const mode of todo) {
    if (!OUT[mode]) throw new Error('Unknown mode: ' + mode);
    await capture(mode);
  }
  console.log('Done — intro assets now match in-game voxel models.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
