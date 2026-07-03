// Median-colour grid sampler: prints a GRID_W x GRID_H map of median hex per cell for a
// given image — used to pick pixel-exact hexes for scene programs.
import sharp from 'sharp';
const [img, gw = 12, gh = 9] = process.argv.slice(2);
const GW = +gw, GH = +gh;
const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
const med = a => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
for (let gy = 0; gy < GH; gy++) {
  const row = [];
  for (let gx = 0; gx < GW; gx++) {
    const x0 = Math.floor(gx * info.width / GW), x1 = Math.floor((gx + 1) * info.width / GW);
    const y0 = Math.floor(gy * info.height / GH), y1 = Math.floor((gy + 1) * info.height / GH);
    const rs = [], gs = [], bs = [];
    for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
      const i = (y * info.width + x) * info.channels;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }
    row.push('#' + [med(rs), med(gs), med(bs)].map(v => v.toString(16).padStart(2, '0')).join(''));
  }
  console.log(`row${gy}: ` + row.join(' '));
}
