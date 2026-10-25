// Cloudflare Worker: serves the static app (ASSETS) and the /api/tryon function.
import { handleTryOn } from '../lib/tryon.js';
import { handleCutout, handlePin, handleTag } from '../lib/ai.js';

const ROUTES = { '/api/tryon': handleTryOn, '/api/cutout': handleCutout, '/api/tag': handleTag, '/api/pin': handlePin };

export default {
  async fetch(request, env) {
    const handler = ROUTES[new URL(request.url).pathname];
    if (handler) return handler(request, env);
    return env.ASSETS.fetch(request);
  },
};
