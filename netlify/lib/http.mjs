import { secureURL } from './config.mjs';
export async function boundedText(body, max, signal) {
  if (!body) return '';
  const reader = body.getReader(), chunks = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new RangeError('Payload too large'); }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}
export async function postJSON(fetcher, url, body, headers, timeout) {
  if (!secureURL(url)) throw new Error('Secure endpoint required');
  const signal = AbortSignal.timeout(timeout);
  const response = await fetcher(url, { method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, text: await boundedText(response.body, 131072, signal) };
}
