const clean = value => typeof value === 'string' ? value.trim() : '';
export function secureURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
function limit(value, fallback, max) {
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error('Invalid usage limit');
  return number;
}
export function readConfig(env = process.env) {
  const key = clean(env.OPENAI_API_KEY);
  const endpoint = clean(env.QUORI_PROVIDER_ENDPOINT) || 'https://api.openai.com/v1/chat/completions';
  const secret = clean(env.QUORI_SESSION_SECRET);
  const botKey = clean(env.GROKBOT_WEBHOOK_KEY);
  const botURL = clean(env.GROKBOT_WEBHOOK_URL);
  const header = clean(env.GROKBOT_AUTHORIZATION_HEADER);
  const match = /^(?:Authorization:\s*)?Bearer ([^\s]+)$/i.exec(header);
  const botValid = /^https:\/\/api2\.cursor\.sh\/automations\/webhook\/[a-zA-Z0-9-]+$/.test(botURL)
    && botKey && !/\s/.test(botKey) && (!header || match?.[1] === botKey);
  const origins = (env.QUORI_ALLOWED_ORIGINS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (origins.some(value => !secureURL(value) || new URL(value).origin !== value)) throw new Error('Invalid origin');
  const tokenParameter = clean(env.QUORI_TOKEN_PARAMETER) || 'max_completion_tokens';
  if (!['max_tokens', 'max_completion_tokens'].includes(tokenParameter)) throw new Error('Invalid token parameter');
  const effort = clean(env.QUORI_REASONING_EFFORT) || 'none';
  if (!['omit', 'none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error('Invalid reasoning effort');
  return {
    ready: env.CONTEXT === 'production' && env.QUORI_ENABLED === 'true'
      && origins.length > 0 && !!key && !/[\r\n]/.test(key) && secret.length >= 32 && secureURL(endpoint),
    origins, secret,
    provider: { key, endpoint, model: clean(env.QUORI_MODEL) || 'gpt-6-luna',
      tokenParameter, effort, tokens: limit(env.QUORI_OUTPUT_TOKENS, 1600, 6000),
      structured: env.QUORI_STRUCTURED_OUTPUTS !== 'false' },
    callback: botValid && env.QUORI_CALLBACKS_ENABLED !== 'false' ? { url: botURL, key: botKey } : null,
    limits: { minute: limit(env.QUORI_LIMIT_PER_MINUTE, 8, 100),
      hour: limit(env.QUORI_LIMIT_PER_HOUR, 60, 5000), day: limit(env.QUORI_LIMIT_PER_DAY, 200, 100000) },
  };
}
