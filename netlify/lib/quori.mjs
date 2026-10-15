import { randomBytes } from 'node:crypto';
import { PublicError, hash, hmac, equal, validID, contactFields, contactSchema, validateAnswer, receipt, contactEvent, topics } from './domain.mjs';
import { boundedText, postJSON } from './http.mjs';

export function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, noarchive', ...extra,
  } });
}
function sessionID(request, secret, cookieName) {
  const value = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const [id, signature] = value?.split('.') ?? [];
  return /^[a-f0-9]{64}$/.test(id ?? '') && equal(signature, hmac(id, secret)) ? id : randomBytes(32).toString('hex');
}
async function inputJSON(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new PublicError(415, 'JSON required');
  let raw;
  try { raw = await boundedText(request.body, 8192); }
  catch (error) { throw new PublicError(error instanceof RangeError ? 413 : 400, error instanceof RangeError ? 'Message too large' : 'Invalid request'); }
  let input;
  try { input = JSON.parse(raw); } catch { throw new PublicError(400, 'Invalid request'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublicError(400, 'Invalid request');
  return input;
}
async function modelAnswer(config, fetcher, knowledge, data, message, lastReceipt) {
  const capabilities = config.callback
    ? 'Contact request form is available. Offer a contact_request draft when the visitor asks for a callback or human follow-up. The visitor must use Review and send; a chat message never submits it.'
    : 'Contact request form is unavailable. Use the team email/phone instead. Set contact_request to null.';
  const history = [...data.history, { role: 'user', content: message }].map(({ role, content }) => ({ role, content }));
  const provider = config.provider;
  const payload = {
    model: provider.model,
    messages: [{ role: 'system', content: knowledge + '\nRuntime: ' + capabilities
      + ' Last contact submission status: ' + (lastReceipt?.delivery || 'none')
      + '. Accepted means the team assistant received it, not that a person read it or a call is booked.' }, ...history],
    [provider.tokenParameter]: provider.tokens,
  };
  if (provider.effort !== 'omit') payload.reasoning_effort = provider.effort;
  payload.response_format = provider.structured ? { type: 'json_schema', json_schema: {
    name: 'quori_answer', strict: true, schema: {
      type: 'object', additionalProperties: false, required: ['reply', 'topic', 'source_ids', 'analysis', 'contact_request'],
      properties: { source_ids: { type: 'array', items: { type: 'string', enum: Array.from({length:3},(_,i)=>'S'+(i+1)) } }, reply: { type: 'string' }, contact_request: contactSchema,
        topic: { type: 'string', enum: [...Object.keys(topics), 'none'] },
        analysis: { type: 'object', additionalProperties: false, required: ['intent', 'urgency', 'summary', 'next_step'],
          properties: { intent: { type: 'string', enum: ['product', 'enquiry', 'support', 'other'] },
            urgency: { type: 'string', enum: ['normal', 'high'] }, summary: { type: 'string' }, next_step: { type: 'string' } } },
      },
    },
  } } : { type: 'json_object' };
  const res = await postJSON(fetcher, provider.endpoint, payload, { Authorization: 'Bearer ' + provider.key }, 28000);
  if (res.status < 200 || res.status >= 300) throw new Error('Provider unavailable');
  const content = JSON.parse(res.text)?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Invalid provider response');
  let answer;
  try { answer = validateAnswer(JSON.parse(content)); } catch { throw new Error('Invalid provider answer'); }
  if (!config.callback) answer.contact_request = null;
  return answer;
}

export function createQuoriHandler({ config, store, knowledge, fetch: fetcher = globalThis.fetch }) {
  return async (request, context) => {
    let session;
    try {
      const cookieName = config.local ? 'quadrion_quori_local' : '__Host-quadrion_quori';
      const action = new URL(request.url).searchParams.get('action'), method = request.method;
      if (!['status', 'chat', 'reset', 'callback'].includes(action)) throw new PublicError(404, 'Not found');
      if (method !== (action === 'status' ? 'GET' : 'POST')) throw new PublicError(405, 'Method not allowed');
      const origin = request.headers.get('origin');
      if ((origin && !config.origins.includes(origin) && !(config.local && origin === context.localOrigin)) || (method === 'POST' && !origin)
        || request.headers.get('sec-fetch-site') === 'cross-site') throw new PublicError(403, 'Request origin not allowed');
      if (!config.ready) return action === 'status' ? json({ mode: 'preview' }) : json({ error: 'Quori is not connected yet.' }, 503);
      session = await store.acquire(sessionID(request, config.secret, cookieName), action === 'status');
      const data = session.data;
      // Host-only cookie; no session IDs, tokens or credentials in URLs or browser storage.
      const headers = session.fresh ? { 'Set-Cookie': cookieName + '=' + session.id + '.' + hmac(session.id, config.secret)
        + '; Path=/; HttpOnly; SameSite=Strict' + (config.local ? '' : '; Secure') } : {};
      if (action === 'status') {
        const last = await store.lastReceipt(data.conversation);
        await store.save(session);
        return json({ mode: 'live', test_mode: config.mock === true, token: data.token, history: data.history,
          last_request_id: Object.keys(data.requests).at(-1) ?? null, reporting_enabled: false,
          callbacks_enabled: !!config.callback, callback_receipt: last }, 200, headers);
      }
      if (!equal(data.token, request.headers.get('x-quori-token'))) throw new PublicError(403, 'Session expired. Close and reopen Quori to reconnect.');
      if (action === 'reset') {
        data.history = []; data.requests = {}; data.conversation = randomBytes(16).toString('hex');
        await store.save(session);
        return json({ token: data.token });
      }
      const input = await inputJSON(request);
      // Netlify's trusted context supplies the client IP, never a caller-chosen X-Forwarded-For.
      const ip = hmac(context.ip || 'unknown', config.secret);
      if (action === 'callback') {
        if (!config.callback) throw new PublicError(503, 'Contact requests are temporarily unavailable. Please contact info@synapse-solutions.ai.');
        if (input.confirmed !== true || !validID(input.request_id)) throw new PublicError(400, 'Please review and confirm your details before sending.');
        const lead = contactFields(input.lead, true);
        const id = hash(data.conversation + ':callback:' + input.request_id);
        const claimed = await store.claimCallback(session, id, hmac('contact:' + JSON.stringify(lead), config.secret), contactEvent(id, lead, input.page), ip, config.limits);
        if (!claimed.send) return json(claimed.result);
        // The database committed "sending" before this external action. A crash, timeout,
        // or failed receipt write must never turn into an automatic duplicate bot run.
        let status = 'unknown';
        try {
          const res = await postJSON(fetcher, config.callback.url, claimed.event,
            { Authorization: 'Bearer ' + config.callback.key, 'X-Quori-Event-Id': id }, 8000);
          // A queued response or server failure can follow a started bot run.
          // Only an explicit client-side rejection is safe to retry.
          status = res.status === 200 ? 'accepted'
            : [400,401,403,404,405,413,415,422,429].includes(res.status) ? 'failed' : 'unknown';
        } catch { /* An ambiguous response cannot safely be retried. */ }
        await store.finishCallback(id, status);
        await store.save(session);
        return json(receipt(id, status));
      }
      const message = input.message;
      if (typeof message !== 'string' || !message.isWellFormed() || !message.trim() || [...message].length > 1200 || !validID(input.request_id))
        throw new PublicError(400, 'Please send a message of up to 1,200 characters.');
      if (Object.hasOwn(data.requests, input.request_id)) { const cached=data.requests[input.request_id]; if(cached.digest!==hash(message.trim())) throw new PublicError(409, 'This message changed after submission. Start a new message.'); return json(cached.answer); }
      if (data.history.length >= 24) throw new PublicError(409, 'Please start a new conversation to continue.');
      await store.consumeRate(ip, config.limits);
      const last = await store.lastReceipt(data.conversation);
      // Fence stale workers after all database reads and immediately before I/O.
      await store.renew(session);
      const answer = await modelAnswer(config, fetcher, knowledge, data, message.trim(), last);
      data.history.push({ role: 'user', content: message.trim() },
        { role: 'assistant', content: answer.reply, links: answer.links, source_ids: answer.source_ids, contact_request: answer.contact_request });
      data.requests[input.request_id] = {digest: hash(message.trim()), answer};
      data.requests = Object.fromEntries(Object.entries(data.requests).slice(-12));
      await store.save(session);
      return json(answer);
    } catch (error) {
      if (error instanceof PublicError) return json({ error: error.message }, error.status,
        error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
      // Provider, database and network errors can contain credentials or visitor text.
      // Neither log their content nor return them to the browser.
      return json({ error: 'Quori could not complete that request. Please try again, or contact the team.' }, 503);
    } finally {
      if (session) await store.release(session).catch(() => {});
    }
  };
}
