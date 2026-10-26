import { handleSegment } from '../lib/ai.js';
export const POST = (request) => handleSegment(request, process.env);
