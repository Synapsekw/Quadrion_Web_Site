import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// Netlify can clone production rows into preview databases. Keep the key in
// production Functions vquoribles only; database access alone cannot read content.
export function encryptRecord(value, secret, recordID) {
  if (!secret || secret.length < 32) throw new Error('Storage encryption unavailable');
  const key = hkdfSync('sha256', secret, 'quadrion', 'quori:database:v1', 32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(recordID));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decryptRecord(value, secret, recordID) {
  if (!secret || secret.length < 32 || typeof value !== 'string' || !value.startsWith('v1.')) throw new Error('Storage encryption unavailable');
  const key = hkdfSync('sha256', secret, 'quadrion', 'quori:database:v1', 32);
  const buffer = Buffer.from(value.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  decipher.setAAD(Buffer.from(recordID));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8'));
}
