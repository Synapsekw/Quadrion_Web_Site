import { runtimeStore, isPublishedProduction } from '../lib/runtime.mjs';

export default async function cleanup(request, context) {
  if (!isPublishedProduction(context)) return new Response(null, { status: 204 });
  try {
    // Retention continues even if QUORI_ENABLED is temporarily turned off.
    await runtimeStore().cleanup();
    return new Response(null, { status: 204 });
  } catch {
    // A generic failure allows the platform to surface the failed scheduled run.
    throw new Error('Quori retention cleanup failed');
  }
}
export const config = { schedule: '17 * * * *' };
