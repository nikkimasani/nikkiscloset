// Cloudflare Worker: serves the static app (ASSETS) and the /api/tryon function.
import { handleTryOn } from '../lib/tryon.js';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/tryon') return handleTryOn(request, env);
    return env.ASSETS.fetch(request);
  },
};
