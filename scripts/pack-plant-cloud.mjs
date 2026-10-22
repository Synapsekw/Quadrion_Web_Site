// One-off packer for the plant photogrammetry cloud (run when cloud.xyz/cloud.rgb change).
// cloud.xyz (float32 x,y,z) is quantised to uint16 per axis over the cloud's bounding box
// (worst-case error 1.6 cm over a 2.1 km survey) and meshopt vertex-encoded with stride 8
// (x,y,z,0). cloud.rgb follows unchanged. Point order is kept, so stride decimation in the
// page picks exactly the same points as before. Layout and decode constants go into cloud.json.
import { readFile, writeFile } from 'node:fs/promises';
import { MeshoptEncoder } from 'meshoptimizer';

const dir = new URL('../directions/data/plant/', import.meta.url);
const meta = JSON.parse(await readFile(new URL('cloud.json', dir), 'utf8'));
const xyzFile = await readFile(new URL('cloud.xyz', dir));
const xyz = new Float32Array(xyzFile.buffer, xyzFile.byteOffset, xyzFile.byteLength / 4);
const rgb = await readFile(new URL('cloud.rgb', dir));
const n = xyz.length / 3;
if (n !== meta.count || rgb.length !== n * 3) throw new Error('cloud.xyz, cloud.rgb and cloud.json disagree');

const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = xyz[i * 3 + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
const scale = min.map((m, a) => (max[a] - m) / 65535 || 1);
const q = new Uint16Array(n * 4);
for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) q[i * 4 + a] = Math.round((xyz[i * 3 + a] - min[a]) / scale[a]);

await MeshoptEncoder.ready;
const xyzEncoded = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(q.buffer), n, 8);
await writeFile(new URL('cloud-q.bin', dir), Buffer.concat([Buffer.from(xyzEncoded), rgb]));
meta.packed = {
  file: 'cloud-q.bin',
  layout: 'Bytes 0..xyzBytes-1: meshopt vertex buffer, count x 8 bytes (uint16 x,y,z + 0). Then count x 3 uint8 r,g,b.',
  xyzBytes: xyzEncoded.length,
  position_decode: 'metres = uint16 * scale + offset (per axis)',
  scale, offset: min,
};
await writeFile(new URL('cloud.json', dir), JSON.stringify(meta, null, 1) + '\n');
console.log(`Packed ${n} points: ${xyzFile.length + rgb.length} -> ${xyzEncoded.length + rgb.length} bytes.`);
