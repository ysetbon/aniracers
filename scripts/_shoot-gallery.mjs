import puppeteer from 'puppeteer';
const b=await puppeteer.launch({args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();await p.setViewport({width:1400,height:850});
p.on('pageerror',e=>console.log('[pageerror]',String(e)));
await p.goto('http://localhost:8769/',{waitUntil:'networkidle2',timeout:60000}).catch(e=>console.log('goto:',e.message));
await new Promise(r=>setTimeout(r,4000));
await p.screenshot({path:'maps/mishkenot_zvulun/_gallery_overview.png'});
// focus building #1 via search to get a close comparison shot
await p.evaluate(()=>{const s=document.getElementById('search');s.value='#1';s.dispatchEvent(new Event('change'));});
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:'maps/mishkenot_zvulun/_gallery_closeup.png'});
const cnt=await p.evaluate(()=>document.getElementById('cnt').textContent);
console.log('gallery count',cnt);
try{await b.close();}catch{}
