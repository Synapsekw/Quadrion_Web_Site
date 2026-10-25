// Downscaled WebP copies of the inspection photos for the places that show them small:
// issue-list rows (54x40 CSS px desktop, up to 120x96 on phones) use <name>-240.webp and the
// floating evidence cards (at most 260 CSS px wide) use <name>-640.webp, about 2x the displayed
// size. The full-size originals stay for the evidence panels and the photo grid.
// Run after adding or replacing a photo: npm run build:thumbs
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const data = new URL('../directions/data/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SOURCES = [
  ['flare/patches', /^F\d+\.webp$/],
  ['road/closeups', /\.webp$/],
  ['tank/photos', /\.jpg$/],
  ['facade/photos', /^p\d+\.jpg$/],
];
const WIDTHS = [240, 640];
let made = 0;
for (const [dir, pattern] of SOURCES) {
  const out = join(data, dir, 'thumbs');
  await mkdir(out, { recursive: true });
  for (const name of (await readdir(join(data, dir))).filter((n) => pattern.test(n))) {
    const source = join(data, dir, name), mtime = (await stat(source)).mtimeMs;
    for (const width of WIDTHS) {
      const target = join(out, `${parse(name).name}-${width}.webp`);
      const existing = await stat(target).catch(() => null);
      if (existing && existing.mtimeMs >= mtime) continue;
      await sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: 78, effort: 6 }).toFile(target);
      made++;
    }
  }
}
console.log(`Thumbnails written: ${made}.`);
