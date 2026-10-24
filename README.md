# Nikki's Closet 👗

A digital closet built from the clothes you actually own. Photograph each piece, and the app turns it into a mannequin-ready cutout you can browse, try on, plan, and log.

## Run it
```bash
npm start        # http://localhost:5173  (no dependencies, no build step)
npm test         # headless-Chromium end-to-end test (needs Playwright)
```
On a phone, open the same URL on your network; "Add piece" opens the camera.

## What it does
- **Closet** – every piece shown on a hanger, on a shelf rail per category (tops, tank tops, bodysuits, bottoms, skirts, dresses, outerwear, shoes, bags, accessories). Filter by type, occasion (Work, Date Night, GNO, Casual, Brunch, Dinner…) or search.
- **Add piece** – upload a photo; the background is removed in your browser (adjustable strength), cropped, colour-detected, and tagged with a type and occasions.
- **Try On** – an SVG mannequin (skin/hair choices). Tap pieces to dress it; dresses replace top+bottom automatically. Fit each piece with size/position sliders. **Style me** builds an outfit for an occasion, favouring pieces you rarely wear. Save looks.
- **OOTD Log** – calendar of what you wore each day, with per-item wear counts and "never worn" reminders.
- **Inspo** – drop in a Pinterest screenshot/image (drag, upload, or paste). It extracts the palette, rebuilds the closest outfit from your closet with colour-match %, and tells you what you're missing ("look for a sage-green top").

## Notes & limits
- All data (photos included) lives in your browser's IndexedDB — nothing is uploaded. Clearing site data erases it; export/backup is a good next step.
- Cutout works best on a plain, contrasting background (bed sheet, wall). Busy backgrounds need a higher strength or a cleaner photo.
- Pinterest has no open API, so inspo is image-based (upload/paste); pin links are saved for reference.
- The mannequin is a flat 2D croquis; garments are layered cutouts, not 3D cloth simulation.

## Ideas for next
Backup/restore, AI-grade segmentation (e.g. an on-device model), weather-aware suggestions, sync across devices, 3D/photo-real try-on.
