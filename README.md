# Nikki's Closet 👗

A digital closet built from the clothes you actually own. Photograph each piece, and the app turns it into a model-ready cutout you can browse, try on, plan, and log.

## Run it
```bash
npm start        # http://localhost:5173  (no dependencies, no build step)
npm install      # only needed for tests (axe-core)
npm test         # headless-Chromium end-to-end + accessibility (axe) tests (needs Playwright)
```
On a phone, open the same URL on your network; "Add piece" opens the camera.

## What it does
- **Dress Up (home)** – a game-style dressing room: your model stands in a room, a floating mood gem and three meters (mood fit, colours, freshness) react to the outfit, a wardrobe tray at the bottom lets you tap pieces on, and quick buttons (Style me, Undress, Save, Wear today) sit beside the model. Pick a mood (occasion) to tune Style me and the meters.
- **Dress up** – your base model picture (`public/assets/avatar/base.png`, shown exactly as it is) wears your real photo cutouts, stacked in the right order (see "The base model" below).
- **Customize** – on Dress up: the room, and **Anchors** (a debug overlay showing the points your clothes snap to). The base picture is fixed art, so there are no face, hair or body sliders on it. In the apartment: avatar, skin tone and hair colour for the 3D character.
- **Plan tab** – set your city (free Open-Meteo forecast, no account): *Style me* then dresses for the weather (coats when cold or rainy, light pieces when hot). **Plan my week** drafts an outfit per day (re-roll, try on, or log it). **Pack for a trip** builds a mix-and-match capsule for N days and weather. **Wardrobe gaps** shows which occasions you can't yet dress for, and a **wishlist** collects what to buy (also fed from Inspo "you're missing…" results).
- **Cost per wear & insights** – add a price (and warmth) to a piece; cards show $/wear, and the Diary shows your best-value buys, what's worth wearing more, declutter candidates, and your outfit streak.
- **Look cards** – Dress Up → Looks → *Share this look as a picture* makes a 1080×1350 image (model facing front + the pieces). Opens the phone share sheet, or downloads.
- **Rooms & face** – Customize: seasonal rooms (auto by month, or pick pastel/studio/night/spring/autumn/winter), eye and lip colours, and an outfit-streak badge in the room.
- **Saved renders + budget** – a photoreal render you've paid for is saved and re-shown free (until you change the photo or a piece); set a monthly budget and the app refuses renders that would go over it.
- **Fast start** – the 3D code and models only download when you open the apartment; new photos are stored as WebP.
- **Wardrobe** – every piece shown on a hanger, on a shelf rail per category (tops, tank tops, bodysuits, bottoms, skirts, dresses, outerwear, shoes, bags, accessories). Filter by type, occasion (Work, Date Night, GNO, Casual, Brunch, Dinner…) or search.
- **Add piece** – upload a photo; the background is removed in your browser (adjustable strength), cropped, colour-detected, and tagged with a type and occasions.
- **Try On** – tap pieces to dress your model; dresses replace top+bottom automatically. Fine-tune each piece with size/position sliders.
- **My photo** – optional, for the photoreal try-on only: add a full-body photo under Me, and the AI render appears on it. (The old body-shape builder and pose detection were removed.)
- **OOTD Log** – calendar of what you wore each day, with per-item wear counts and "never worn" reminders.
- **Inspo** – drop in a Pinterest screenshot/image (drag, upload, or paste). It extracts the palette, rebuilds the closest outfit from your closet with colour-match %, and tells you what you're missing ("look for a sage-green top").

- **Back photo (optional)** on any piece: kept with the piece for a future back view.

## Adding pieces
**+ Add piece** opens one dialog: **Take photo**, **Choose photo**, **Paste** (a copied picture or product link; ⌘/Ctrl+V works too) or **From a link**. The on-device cutout shows instantly; with your passcode saved, the server cutout and auto-fill then run on their own (switch off in the dialog). An optional **Cut out on this device** button runs an AI model in the browser instead (about 45 MB the first time, from staticimgly.com; it lives in `public/lab/` with its own security policy; the library is AGPL-3.0, see `public/vendor/imgly/LICENSE.md`). `/api/product` reads a shop page's title, brand, price and picture on the server (https only, public hosts only, passcode required).
From other apps: Android/desktop installs get a Share-menu entry (PWA share target). iPhones use a Shortcut that opens `/?add=paste` or `/?add=link&u=…` (steps are in the Wardrobe tab).

## The base model (Dress up)
`public/assets/avatar/base.png` is a picture of the model and is displayed unchanged at its own proportions; nothing in the code draws a body. Layer order: base picture → clothing → hair → accessories (hair is part of the picture for now).

`public/assets/avatar/config.json` holds the **anchor points** as plain coordinates over the picture (pixels of the 896 × 1776 file): neck, hairline, shoulders L/R, bust, waist, hips, knees, ankles and feet. The same file has a **rule per clothing category** (which width sizes it, where its top and bottom edges sit): shirts and coats are sized by the shoulders, trousers, skirts and dresses by the hips, shoes by the feet. Your cutouts are scaled to fit inside that box and centred on it. Turn on **Customize → Anchors → Show the points** to see the dots, width lines and each worn piece's box on the model, then edit the numbers in the config.

**Fit** is now for small tweaks only (nudge, size, turn, tuck): the position and size come from the points. Fits are remembered per piece and per base picture. Tapping the model selects the piece whose visible pixels you touched; the dashed box and the panel label ("Top: White tee", with its picture) always belong to that piece. Clothes get a feathered edge and a soft shadow so they sit on the body.

To use a different base picture: replace `base.png` (front-facing, arms slightly away from the body, transparent background, same file size or the same proportions), then move the points in `config.json` to match.

## My apartment (3D)
**Dress up → My apartment** is a little 3D studio you walk around as a rigged low-poly avatar (Kenney "Mini Characters", twelve to choose from at the Vanity). Walk with the on-screen stick, WASD/arrow keys, or tap the floor (it finds its way round furniture); drag to look around, or use the ⟲ ⟳ buttons. The camera follows from behind and above and stops short of furniture and walls, so it never ends up inside anything.
Step on a glowing circle (or tap its chip under the room) and that station's screen opens full-screen:
- **Wardrobe**: browse your real pieces by type and put them on the doll.
- **Vanity**: avatar, skin, hair, eyes, lips.
- **Mirror**: opens the 2D dress-up doll.
- **Bed**: log today's outfit and see your streak.
- **Desk**: opens the planner.
Furniture is KayKit "Furniture Bits" (CC0) and the avatar is Kenney's (CC0); about 1.7 MB of models in all (`public/assets/`, credits in `CREDITS.txt`), downloaded only when you open the apartment. Phones without WebGL, or with "flat" mode on, just get the 2D doll.

## The daily challenge
Each day has a theme: from an **event** you add in Plan (it becomes that day's dress code), else the **mood** you picked on Dress up, else a very cold or hot forecast, else a surprise. A banner shows the theme, your coins, streak, **energy** (changing the outfit costs a little; tired means fewer coins) and **mood** (set by your last rating). In the apartment a bouncing arrow points to where to go next: Wardrobe, then Mirror, then Bed.
**Rate my look** scores the outfit out of 100 and says why, using only your own tags: fits the theme (occasion tags, 35), right for the weather (warmth tags vs the forecast, 20), colours work together (25), a complete outfit (10), fresh pieces you rarely wear (10). Stars are 90/75/58/40+; coins are 10 + 8 per star + 2 per streak day (up to 7), reduced when energy is low. You are only paid for improving on your best rating that day. **End the day** at the bed logs the outfit (streak) and closes the day; a new date brings a new theme. Coins, theme and history are saved on the device and included in backup and cloud sync. (What coins unlock comes next.)

## The shop and build mode
Coins from the daily challenge buy things in the **🛍️ Shop** (button on the game banner): furniture (rugs, plants, lamps, chairs, tables, a bookcase, a cabinet, an armchair), room colours (Rose is free; Sage, Lilac and Dusk are bought), and hairstyles (Long, Bob and Pixie are free; Bun, Ponytail and Curly are bought, and a style you were already wearing stays yours). Furniture goes into storage; open **🔨 Build** in your apartment to place it. Tap a piece to pick it up, tap the floor (or use the arrows) to move it, **Turn** rotates a quarter turn, **Put away** returns it to storage. A piece can't go through a wall, on top of other furniture, on a station's circle, or where it would cut you off from a station. What you own and where it stands is saved with the game (and backs up and syncs). The catalogue and prices are in `public/js/game.js` (`CATALOG`); add a model name from `public/assets/furniture` to offer more.

## Photo mode and the lookbook
On the Dress up screen, **📸 Photo** shows the doll in front of a backdrop (Blush and Studio are free; Sunset, Garden, Night city and Confetti are bought in the shop) in a pose (Stand is free; Chic tilt, Walk, Twirl and Pop are bought), captioned with today's challenge and your stars. **Save to my lookbook** attaches the picture to today's Diary entry (creating the entry if you haven't logged one, so it counts toward your streak). The Diary has a **Lookbook** grid of all your photos; open one to share it or remove it. Photos are stored with the Diary entry, so they back up and sync with it. The poses are simple 2D tilts, leans and flips of the doll, not new drawings. Backdrops and poses live in `public/js/photo.js` (add one there and an entry in `CATALOG` to sell it).

## Cloud sync (optional)
- **Wardrobe → Cloud sync**: enter your private sync key to keep pieces, photos, outfits, diary and appearance in step across devices. Newest edit wins; deletes sync too. Nothing is uploaded until a key is entered.
- Backend is a dedicated Supabase project (`sync_records`, `sync_blobs`). There are no accounts: row-level security only allows requests whose `x-sync-key` header hashes to the stored SHA-256 (the key itself is never stored). The URL and publishable key in `public/js/sync.js` are public by design. Treat the sync key like a password; to rotate it, update the hash in `sync_config`.
- Photos are stored in the cloud as base64 rows; the free tier is plenty for a closet.

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

## AI helpers (fal.ai, same key + passcode)
Besides photoreal try-on, three more passcode-protected endpoints use your fal credits (all fail closed without `FAL_KEY` + `APP_PASSCODE`):
- **Cleaner cutout** (`/api/cutout`) – Add piece → *AI helpers* → *Cleaner cutout* removes busy backgrounds the on-device tool can't. Model: `fal-ai/imageutils/rembg` (override with `FAL_CUTOUT_MODEL`).
- **Auto-fill details** (`/api/tag`) – reads the photo and fills in name, type, warmth and occasions for you to check. Model: `fal-ai/any-llm/vision` (`FAL_VISION_MODEL`, `FAL_VISION_LLM`).
- **Pinterest import** (`/api/pin`) – paste a pin link on the Inspo tab; the server fetches the picture (Pinterest hosts only, redirects re-checked). If Pinterest blocks it, upload the picture instead.
As with try-on, the fal request/response fields come from fal's public docs and are tested against a mock, not the live API; fal's own error text is shown if a field name is off.

## Accessibility
Keyboard-operable throughout, labelled controls, `aria-pressed` state on filters, dialogs that trap focus and restore it on close, screen-reader text for outfits and calendar days, live-region announcements, visible focus, and reduced-motion support. Automated axe (WCAG 2.1 AA) checks run in `npm test`; a manual screen-reader pass is still worth doing.

## Notes & limits
- All data (photos included) lives in your browser's IndexedDB — nothing is uploaded unless you turn on cloud sync. Clearing site data erases it; export/backup is a good next step.
- Cutout works best on a plain, contrasting background (bed sheet, wall). Busy backgrounds need a higher strength or a cleaner photo.
- Pinterest has no open API, so inspo is image-based (upload/paste); pin links are saved for reference.
- The apartment avatar is a ready-made character: it wears its own outfit, not your photos (clothes are tried on the 2D doll), and its look is limited to skin and hair colour plus twelve characters. Real device performance is untested; there is a Low-quality fallback that turns off the mirror's live reflection on weak phones.
- The photoreal try-on is an AI render of your pieces on your photo (it uses your fal.ai credits); the quick model preview is fitted 2D layering, not cloth simulation: a flat photo of a garment can't drape or fold.

## Ideas for next
Backup/restore, accounts + sync, a serverless generative virtual-try-on endpoint (Vercel/Cloudflare function + a try-on model API) for photoreal drape, better garment segmentation, weather-aware suggestions.
