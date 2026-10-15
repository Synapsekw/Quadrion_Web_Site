import test from 'node:test';
import assert from 'node:assert/strict';
import { sendDemoRequest } from '../directions/d3-quarter/demo-request.mjs';

const enquiry = { name: 'Demo test', email: 'test@example.com', company: 'A&B', message: 'Survey + inspection', 'bot-field': '' };

test('demo sends one form submission, preserving special characters, without a chatbot request', async () => {
  const requests = [];
  await sendDemoRequest(enquiry, { hostname: 'quadrion.ai', fetchImpl: async (...args) => { requests.push(args); return { ok: true }; } });
  assert.equal(requests.length, 1);
  const [url, options] = requests[0];
  assert.equal(url, '/d3-quarter/');
  assert.equal(options.method, 'POST');
  const body = new URLSearchParams(options.body);
  assert.equal(body.get('form-name'), 'quadrion-demo');
  assert.equal(body.get('company'), 'A&B');
  assert.equal(body.get('message'), 'Survey + inspection');
  assert.equal(body.get('email'), enquiry.email);
});

test('local and deploy previews cannot create live notifications', async () => {
  for (const hostname of ['127.0.0.1', 'localhost', 'deploy-preview-3--quadrionai.netlify.app']) {
    let calls = 0;
    await assert.rejects(sendDemoRequest(enquiry, { hostname, fetchImpl: async () => { calls++; return { ok: true }; } }), /live website/i);
    assert.equal(calls, 0);
  }
});

test('failed delivery is not reported as success or retried automatically', async () => {
  let calls = 0;
  await assert.rejects(sendDemoRequest(enquiry, { hostname: 'quadrion.ai', fetchImpl: async () => { calls++; return { ok: false }; } }));
  assert.equal(calls, 1);
});
