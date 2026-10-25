import { handleCutout } from '../lib/ai.js';
export const POST = (request) => handleCutout(request, process.env);
