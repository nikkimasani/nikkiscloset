// Vercel Function: POST /api/tryon (start) and GET /api/tryon?status=…&response=… (poll).
import { handleTryOn } from '../lib/tryon.js';
const run = (request) => handleTryOn(request, process.env);
export const GET = run;
export const POST = run;
