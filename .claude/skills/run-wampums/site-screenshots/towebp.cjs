/* Convert every PNG in <src> to WebP in <dest>: node towebp.cjs <src> <dest> <quality 0-1> */
const fs = require('fs'); const path = require('path');
const { chromium } = require(path.join(process.env.HOME, '.cache/wampums-run/node_modules/playwright-core'));
const [src, dest, quality] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(dest, { recursive: true });
  const b = await chromium.launch({ env: { ...process.env, LD_LIBRARY_PATH: path.join(process.env.HOME, '.cache/wampums-run/libs/root/usr/lib/x86_64-linux-gnu') } });
  const p = await b.newPage();
  for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.png')).sort()) {
    const data = `data:image/png;base64,${fs.readFileSync(path.join(src, f)).toString('base64')}`;
    const webp = await p.evaluate(async ({ data, q }) => {
      const img = new Image(); img.src = data; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', q);
    }, { data, q: Number(quality) });
    const out = path.join(dest, f.replace(/\.png$/, '.webp'));
    fs.writeFileSync(out, Buffer.from(webp.split(',')[1], 'base64'));
  }
  await b.close();
})();
