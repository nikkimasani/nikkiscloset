# Nikki's Closet 👗

A digital closet built from the clothes you actually own. Photograph each piece, and the app turns it into a mannequin-ready cutout you can browse, try on, plan, and log.

## Run it
```bash
npm start        # http://localhost:5173  (no dependencies, no build step)
npm install      # only needed for tests (axe-core)
npm test         # headless-Chromium end-to-end + accessibility (axe) tests (needs Playwright)
```
On a phone, open the same URL on your network; "Add piece" opens the camera.

## What it does
- **Closet** – every piece shown on a hanger, on a shelf rail per category (tops, tank tops, bodysuits, bottoms, skirts, dresses, outerwear, shoes, bags, accessories). Filter by type, occasion (Work, Date Night, GNO, Casual, Brunch, Dinner…) or search.
- **Add piece** – upload a photo; the background is removed in your browser (adjustable strength), cropped, colour-detected, and tagged with a type and occasions.
- **Try On** – tap pieces to dress your model; dresses replace top+bottom automatically. Fine-tune each piece with size/position sliders.
- **Make it look like me** – upload a full-body photo. On-device pose detection (MediaPipe, bundled — no upload) finds your shoulders, hips, knees and ankles; you can drag or arrow-key the 11 points to correct them. Garments are then fitted to *your* measurements, either on a mannequin shaped like you or on your photo itself. No photo? Use the proportion sliders (shoulders, hips, torso, legs). **Style me** builds an outfit for an occasion, favouring pieces you rarely wear. Save looks.
- **OOTD Log** – calendar of what you wore each day, with per-item wear counts and "never worn" reminders.
- **Inspo** – drop in a Pinterest screenshot/image (drag, upload, or paste). It extracts the palette, rebuilds the closest outfit from your closet with colour-match %, and tells you what you're missing ("look for a sage-green top").

## Deploy
The app is static files in `public/` (no build step), so it deploys as-is. Both configs ship the same security headers (strict CSP; camera only for this site).
- **Vercel:** `npx vercel --prod` (uses `vercel.json`, output dir `public`) — or import the GitHub repo in the dashboard.
- **Cloudflare:** `npx wrangler deploy` (uses `wrangler.jsonc`, Workers static assets) — or connect the repo in Workers & Pages.
Your closet lives in each visitor's browser, so deploying doesn't expose your photos.

## Accessibility
Keyboard-operable throughout (including the body-point editor), labelled controls, `aria-pressed` state on filters, dialogs that trap focus and restore it on close, screen-reader text for outfits and calendar days, live-region announcements, visible focus, and reduced-motion support. Automated axe (WCAG 2.1 AA) checks run in `npm test`; a manual screen-reader pass is still worth doing.

## Notes & limits
- All data (photos included) lives in your browser's IndexedDB — nothing is uploaded. Clearing site data erases it; export/backup is a good next step.
- Cutout works best on a plain, contrasting background (bed sheet, wall). Busy backgrounds need a higher strength or a cleaner photo.
- Pinterest has no open API, so inspo is image-based (upload/paste); pin links are saved for reference.
- Try-on is **fitted 2D layering**, not cloth simulation: a flat photo of a garment can't drape, fold, or follow a bent arm. Fit is as good as your body points and the garment photo. For photoreal drape, add a generative try-on model behind a serverless function (see below).
- Pose detection needs a clear, front-facing, full-body photo; if it can't find you, you place the points by hand.

## Ideas for next
Backup/restore, accounts + sync, a serverless generative virtual-try-on endpoint (Vercel/Cloudflare function + a try-on model API) for photoreal drape, better garment segmentation, weather-aware suggestions.
