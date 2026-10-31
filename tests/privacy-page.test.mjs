import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The Microsoft Store listing points at https://quadrion.ai/privacy/. It must stay public, static and at this path.
const root = new URL('../directions/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('privacy policy is a static page at /privacy/ with no scripts', async () => {
  const html = await read('privacy/index.html');
  assert.match(html, /<title>Privacy policy \| Quadrion AI<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/quadrion\.ai\/privacy\/">/);
  assert.doesNotMatch(html, /<script/i, 'the policy must render without JavaScript');
  assert.doesNotMatch(html, /noindex/i);
  assert.match(html, /Last updated: \d{1,2} [A-Z][a-z]+ \d{4}/);
  assert.match(html, /mailto:info@synapse-solutions\.ai/);
  assert.doesNotMatch(html, /\[(date|address|support email)\]|<(PUBLISH DATE|COMPANY ADDRESS|SUPPORT EMAIL)>/i);
});

test('public footer and sitemap link the privacy policy', async () => {
  const home = await read('d3-quarter/index.html');
  const footer = home.slice(home.indexOf('<footer'), home.indexOf('</footer>'));
  assert.match(footer, /href="\/privacy\/"/);
  assert.match(await read('sitemap.xml'), /<loc>https:\/\/quadrion\.ai\/privacy\/<\/loc>/);
});

test('netlify config keeps /privacy/ outside the portal and admin areas', async () => {
  const toml = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  const blocks = toml.split(/\n(?=\[\[)/);
  for (const block of blocks) {
    if (/^\[\[redirects\]\]/.test(block)) {
      const from = block.match(/from\s*=\s*"([^"]+)"/)?.[1] ?? '';
      assert.ok(!/^\/privacy|^\/\*$|^\/\*\*/.test(from), 'no redirect may capture /privacy: ' + from);
    }
    if (/^\[\[headers\]\]/.test(block)) {
      const path = block.match(/for\s*=\s*"([^"]+)"/)?.[1] ?? '';
      if (/^\/privacy|^\/\*$/.test(path)) assert.doesNotMatch(block, /noindex|private, no-store/);
    }
  }
});
