import { handleProduct } from '../lib/ai.js';
export const POST = (request) => handleProduct(request, process.env);
