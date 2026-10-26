import { handleStarter } from '../lib/ai.js';
export const POST = (request) => handleStarter(request, process.env);
