// One-time asset tooling; @resvg/resvg-js is not a website dependency.
// Install it in a temporary directory, set QUADRION_RESVG_MODULE to that
// directory's node_modules/@resvg/resvg-js, then run this script with Node.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { Resvg } = require(process.env.QUADRION_RESVG_MODULE || '@resvg/resvg-js');
const source = await readFile(new URL('../directions/assets/quadrion-symbol-on-dark.svg', import.meta.url), 'utf8');
const symbol = source.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/s, '');
const output = new URL('../directions/pwa-icons/', import.meta.url);
await mkdir(output, { recursive: true });

for (const [file, size, markSize] of [
  ['icon-192.png', 192, 144],
  ['icon-512.png', 512, 384],
  // The entire mark is inside the central circle with radius 40% of the icon.
  ['maskable-512.png', 512, 320],
  ['apple-touch-icon.png', 180, 135],
]) {
  const offset = (size - markSize) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#0B0F13"/><g transform="translate(${offset} ${offset}) scale(${markSize / 60})">${symbol}</g></svg>`;
  await writeFile(new URL(file, output), new Resvg(svg).render().asPng());
  console.log(`Generated ${file} (${size} × ${size})`);
}
