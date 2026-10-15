import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createQuoriHandler, json } from '../lib/quori.mjs';
import { readConfig } from '../lib/config.mjs';
import { runtimeStore, isPublishedProduction } from '../lib/runtime.mjs';
let knowledge;

export default async function quori(request, context) {
  try {
    // CONTEXT is a build variable, not a guaranteed runtime variable.
    // Use trusted platform metadata; a request header or inherited env cannot
    // turn a deploy preview or an old/unpublished deploy into production.
    const settings = readConfig({ ...process.env, CONTEXT: isPublishedProduction(context) ? 'production' : '' });
    let store;
    if (settings.ready) {
      store = runtimeStore();
      knowledge ??= await readFile(resolve('server/knowledge.txt'), 'utf8');
    }
    return await createQuoriHandler({ config: settings, store, knowledge: knowledge ?? '' })(request, context);
  } catch {
    return json({ error: 'Quori could not connect. Please try again, or contact the team.' }, 503);
  }
}

// Same-origin endpoint for the website's Quori transport.
export const config = { path: '/api/quori' };
