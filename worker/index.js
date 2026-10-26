// Cloudflare Worker: serves the static app (ASSETS) and the /api/tryon function.
import { handleTryOn } from '../lib/tryon.js';
import { handlePin, handleTag, handleSegment, handleProduct, handleStarter } from '../lib/ai.js';

const ROUTES = { '/api/tryon': handleTryOn, '/api/tag': handleTag, '/api/segment': handleSegment, '/api/pin': handlePin, '/api/product': handleProduct, '/api/starter': handleStarter };

export default {
  async fetch(request, env) {
    const handler = ROUTES[new URL(request.url).pathname];
    if (handler) return handler(request, env);
    return env.ASSETS.fetch(request);
  },
};
