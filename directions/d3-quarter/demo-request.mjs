const liveHosts = new Set(['quadrion.ai', 'www.quadrion.ai', 'quadrionai.netlify.app']);

export async function sendDemoRequest(fields, { hostname, fetchImpl = fetch } = {}) {
  if (!liveHosts.has(hostname)) throw new Error('Please send demo requests from the live website at quadrion.ai.');
  const body = new URLSearchParams({ 'form-name': 'quadrion-demo' });
  for (const key of ['name', 'email', 'company', 'message', 'bot-field']) body.set(key, String(fields[key] || '').trim());
  const response = await fetchImpl('/d3-quarter/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Your request could not be sent. Please try again or email info@synapse-solutions.ai.');
}
