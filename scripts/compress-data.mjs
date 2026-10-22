// Netlify compresses text responses but serves binary 3D data (.glb, .bin) as-is.
// Write a gzip sibling (<file>.gz) next to each one; quadrion-data.js fetches the sibling and
// inflates it with DecompressionStream, falling back to the original file when it is missing.
// Generated at build time (see netlify.toml) and ignored by git.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, constants } from 'node:zlib';

const root = new URL('../directions/data/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// cloud.xyz/.rgb stay only for loaders cached before cloud-q.bin; those never ask for .gz.
const BINARY = /\.(glb|bin)$/;
let before = 0, after = 0, count = 0;

async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) { await visit(file); continue; }
    if (!BINARY.test(entry.name)) continue;
    const source = await stat(file);
    const target = file + '.gz';
    const existing = await stat(target).catch(() => null);
    let size;
    if (existing && existing.mtimeMs >= source.mtimeMs) size = existing.size;
    else {
      const packed = gzipSync(await readFile(file), { level: constants.Z_BEST_COMPRESSION });
      await writeFile(target, packed);
      size = packed.length;
    }
    before += source.size; after += size; count++;
  }
}

await visit(root);
console.log(`Compressed ${count} data files: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB gzip.`);
