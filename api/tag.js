import { handleTag } from '../lib/ai.js';
export const POST = (request) => handleTag(request, process.env);
