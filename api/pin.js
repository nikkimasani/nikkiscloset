import { handlePin } from '../lib/ai.js';
export const POST = (request) => handlePin(request, process.env);
