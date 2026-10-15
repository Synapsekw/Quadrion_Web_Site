import { getDatabase } from '@netlify/database';
import { PostgresStore } from './store.mjs';
let store;
export function runtimeStore() {
  store ??= new PostgresStore(getDatabase().pool, process.env.QUORI_SESSION_SECRET?.trim());
  return store;
}
export function isPublishedProduction(context) {
  return context?.deploy?.context === 'production' && context.deploy.published === true;
}
