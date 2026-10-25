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
- **Dress Up (home)** – a game-style dressing room: your model stands in a room, a floating mood gem and three meters (mood fit, colours, freshness) react to the outfit, a wardrobe tray at the bottom lets you tap pieces on, and quick buttons (Style me, Undress, Save, Wear today) sit beside the model. Pick a mood (occasion) to tune Style me and the meters.
- **3D model** – the mannequin is a real 3D figure (Three.js, bundled) built from your proportions. Drag it or use ◀ Front ▶ to turn it. Each garment photo is inflated into a rounded 3D volume that follows its own outline (slim sleeves and pant legs, fuller torsos and skirts), lit and shaded, so you can see it from every angle. Falls back to the flat 2D mannequin if the device has no WebGL (or by choice under Dress Up → Me).
- **Customize your model** – Dress Up → 🎨 Customize: 10 skin tones + any colour, 12 hair colours + any colour, 6 hair styles (long, bob, pixie, bun, ponytail, curly), 8 body types (petite → plus size) and sliders for shoulders, hips, torso, legs and build. Saved on the device; works on the 3D and flat models.
- **Wardrobe** – every piece shown on a hanger, on a shelf rail per category (tops, tank tops, bodysuits, bottoms, skirts, dresses, outerwear, shoes, bags, accessories). Filter by type, occasion (Work, Date Night, GNO, Casual, Brunch, Dinner…) or search.
- **Add piece** – upload a photo; the background is removed in your browser (adjustable strength), cropped, colour-detected, and tagged with a type and occasions.
- **Try On** – tap pieces to dress your model; dresses replace top+bottom automatically. Fine-tune each piece with size/position sliders.
- **Make it look like me** – upload a full-body photo. On-device pose detection (MediaPipe, bundled — no upload) finds your shoulders, hips, knees and ankles; you can drag or arrow-key the 11 points to correct them. Garments are then fitted to *your* measurements, either on a mannequin shaped like you or on your photo itself. No photo? Use the proportion sliders (shoulders, hips, torso, legs). **Style me** builds an outfit for an occasion, favouring pieces you rarely wear. Save looks.
- **OOTD Log** – calendar of what you wore each day, with per-item wear counts and "never worn" reminders.
- **Inspo** – drop in a Pinterest screenshot/image (drag, upload, or paste). It extracts the palette, rebuilds the closest outfit from your closet with colour-match %, and tells you what you're missing ("look for a sage-green top").

## Backup & installing
- **Wardrobe → Backup & restore** saves/restores everything (pieces, images, looks, diary, appearance) as one file.
- The app is installable (Share → Add to Home Screen on iPhone; Install on Android/desktop Chrome) and opens offline after the first visit.
- `npm test` runs automatically on every pull request (`.github/workflows/test.yml`). See `docs/AUDIT.md` for the latest audit, known limits and ideas.

## Deploy
The app is static files in `public/` plus one serverless function (no build step), so it deploys as-is. Both configs ship the same security headers (strict CSP; camera only for this site).
- **Vercel:** `npx vercel --prod` (uses `vercel.json`, output dir `public`) — or import the GitHub repo in the dashboard.
- **Cloudflare:** `npx wrangler deploy` (uses `wrangler.jsonc`, Workers static assets) — or connect the repo in Workers & Pages.
Your closet lives in each visitor's browser, so deploying doesn't expose your photos.

## Photoreal try-on (fal.ai)
The quick preview is geometric layering. For real fabric drape, **Try On → Photoreal try-on** sends your photo and each garment (on white) to a fal.ai virtual try-on model (`fal-ai/fashn/tryon/v1.5`) through a small serverless function, chaining pieces one after another. Shoes, bags, accessories and jackets-over-a-top are layered on afterwards. About $0.075 per piece, billed to your fal account; the app shows the cost and asks before spending. Renders you log to the OOTD calendar keep their photo.

Setup — the key lives **only** in server env vars, never in the repo or browser:
```bash
# local
FAL_KEY=… APP_PASSCODE=pick-a-passphrase npm start
# Vercel
npx vercel env add FAL_KEY && npx vercel env add APP_PASSCODE
# Cloudflare
npx wrangler secret put FAL_KEY && npx wrangler secret put APP_PASSCODE
```
`APP_PASSCODE` is required (the function refuses to run without it) so strangers who find your URL can't spend your credits; enter it once in the app (remembered on that device). Code: `lib/tryon.js` (shared), `api/tryon.js` (Vercel), `worker/index.js` (Cloudflare).
The fal request/response fields were written from fal's public docs and tested against a mock, not the live API — the first real render is the real test, and fal's own error text is shown if a field name is off.

## Accessibility
Keyboard-operable throughout (including the body-point editor), labelled controls, `aria-pressed` state on filters, dialogs that trap focus and restore it on close, screen-reader text for outfits and calendar days, live-region announcements, visible focus, and reduced-motion support. Automated axe (WCAG 2.1 AA) checks run in `npm test`; a manual screen-reader pass is still worth doing.

## Notes & limits
- All data (photos included) lives in your browser's IndexedDB — nothing is uploaded. Clearing site data erases it; export/backup is a good next step.
- Cutout works best on a plain, contrasting background (bed sheet, wall). Busy backgrounds need a higher strength or a cleaner photo.
- Pinterest has no open API, so inspo is image-based (upload/paste); pin links are saved for reference.
- The 3D view inflates flat garment photos into volumes; it has depth and lighting but **no cloth simulation** (no folds or drape; sleeves don't bend with the arms), the back of a garment mirrors its front, and outlines can look slightly rough up close. Shoes and bags are the roughest pieces. Your own photo ("My photo") stays 2D.
- Try-on in photo mode is **fitted 2D layering**, not cloth simulation: a flat photo of a garment can't drape, fold, or follow a bent arm. Fit is as good as your body points and the garment photo. For photoreal drape, add a generative try-on model behind a serverless function (see below).
- Pose detection needs a clear, front-facing, full-body photo; if it can't find you, you place the points by hand.

## Ideas for next
Backup/restore, accounts + sync, a serverless generative virtual-try-on endpoint (Vercel/Cloudflare function + a try-on model API) for photoreal drape, better garment segmentation, weather-aware suggestions.
