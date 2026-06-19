const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname,'..','sarcelles_preview.svg'),'utf8');
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({width:920,height:900,deviceScaleFactor:2});
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  const el = await page.$('svg');
  await el.screenshot({path: path.join(__dirname,'..','sarcelles_preview.png')});
  await browser.close();
  console.log('wrote sarcelles_preview.png');
})();
