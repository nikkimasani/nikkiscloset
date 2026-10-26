# Nikki's Closet 👗

A digital closet built from the clothes you actually own. Photograph each piece, and the app turns it into a model-ready cutout you can browse, try on, plan, and log.


### Cutting out and fitting a piece

**+ Add piece → ✂️ Tap to select & fit** opens the editor: how the photo was taken (Flat lay / Hanger / Worn, each with a short tip), crop + straighten (four draggable corners, perspective-corrected) + automatic white balance, then tap-to-select: tap the garment (➕) and what to leave out (➖); the outline updates live, and a brush erases or restores. Selection is GrabCut (OpenCV) running in a Web Worker (`public/lab/segment-worker.js`, vendored `public/vendor/opencv/`, Apache-2.0) under its own security policy (it needs eval, and can reach no network). Nothing is uploaded.

Each piece then gets **landmarks** (neckline, shoulders, armpits, hems, sleeve ends; waistband, crotch and four leg hems for trousers; waist for dresses), suggested from its silhouette and draggable, with a live preview on the model. They are stored on the piece (`marks`, as fractions of the cutout). `config.json` holds the matching body points (armpits, crotch, waistband, arm lines) and the body outline is read from `base.png`'s own transparency. `garment.js` warps the landmarks onto those points with a thin-plate-spline mesh, then widens each row below the waist to the body outline plus ~5% ease (skirts and dresses hang straight from the hip; each trouser leg is fitted on its own), with a 1px feathered edge and a soft shadow. Layer order: base → bottoms → tops (tucked/untucked) → dresses → outerwear → hair → accessories. Shoes, bags and accessories are snapped, not warped.

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
- **Customize** – on Dress up: **Anchors** (a debug overlay showing the points your clothes snap to). The base picture is fixed art, so there are no face, hair or body sliders on it. The mannequin stands in front of the closet's three-way mirror (`public/assets/closet/mirror.jpg`).
- **Plan tab** – set your city (free Open-Meteo forecast, no account): *Style me* then dresses for the weather (coats when cold or rainy, light pieces when hot). **Plan my week** drafts an outfit per day (re-roll, try on, or log it). **Pack for a trip** builds a mix-and-match capsule for N days and weather. **Wardrobe gaps** shows which occasions you can't yet dress for, and a **wishlist** collects what to buy (also fed from Inspo "you're missing…" results).
- **Cost per wear & insights** – add a price (and warmth) to a piece; cards show $/wear, and the Diary shows your best-value buys, what's worth wearing more, declutter candidates, and your outfit streak.
- **Look cards** – Dress Up → Looks → *Share this look as a picture* makes a 1080×1350 image (model facing front + the pieces). Opens the phone share sheet, or downloads.
- **Saved renders + budget** – a photoreal render you've paid for is saved and re-shown free (until you change the photo or a piece); set a monthly budget and the app refuses renders that would go over it.
- **Fast start** – the selection engine (OpenCV, ~10 MB) only downloads the first time you tap to select offline; new photos are stored as WebP.
- **Wardrobe** – every piece shown on a hanger, on a shelf rail per category (tops, tank tops, bodysuits, bottoms, skirts, dresses, outerwear, shoes, bags, accessories). Filter by type, occasion (Work, Date Night, GNO, Casual, Brunch, Dinner…) or search.
- **Add piece** – one step per screen: photo → crop → tap to select → touch up → fit (see "Adding pieces").
- **Try On** – tap pieces to dress your model; dresses replace top+bottom automatically. Fine-tune each piece with size/position sliders.
- **My photo** – optional, for the photoreal try-on only: add a full-body photo under Me, and the AI render appears on it. (The old body-shape builder and pose detection were removed.)
- **OOTD Log** – calendar of what you wore each day, with per-item wear counts and "never worn" reminders.
- **Inspo** – drop in a Pinterest screenshot/image (drag, upload, or paste). It extracts the palette, rebuilds the closest outfit from your closet with colour-match %, and tells you what you're missing ("look for a sage-green top").

- **Back photo (optional)** on any piece: kept with the piece for a future back view.

## Adding pieces
**+ Add piece**, one step per screen (big buttons, nothing scrolls sideways):
1. **Photo**: how it was taken (Flat lay recommended, Hanger, Worn) with a short tip, then **Take photo**, **Choose photo**, **Paste** (⌘/Ctrl+V works too) or **From a link** (`/api/product` reads a shop page's title, brand, price and picture on the server; https only, public hosts only, passcode required).
2. **Crop** first: a shop screenshot is noticed and cropped to its product photo (the status bar, the app's buttons and the text under the photo are left out); drag the four corners to adjust. Corners on the item's own corners straighten a photo taken at an angle; white balance evens out the colour cast.
3. **Select**: the whole cropped picture fits the screen. Toggle **➕ Keep** (green dots) / **➖ Remove** (red dots), **Undo**, **Clear**, pinch to zoom; the outline updates live. A red dot is placed for you on a dress form when one is found. **SAM 2 on fal** does the selecting when your passcode is saved (`/api/segment`, model `fal-ai/sam2/image`, override with `FAL_SEGMENT_MODEL`); otherwise, or if it fails, **GrabCut** runs on the phone (`public/lab/segment-worker.js` with vendored OpenCV, Apache-2.0, its own security policy because OpenCV needs eval; it can reach no network). The details screen says which engine was used.
4. **Touch up** (optional): 🧽 Erase / 🖌️ Restore brush.
5. **Fit**: the landmarks (below), then name, type, occasions and the rest. Your cropped original is kept with the piece; **Redo the selection** and **Fit landmarks** are on the piece's edit screen.
From other apps: Android/desktop installs get a Share-menu entry (PWA share target). iPhones use a Shortcut that opens `/?add=paste` or `/?add=link&u=…` (steps are in the Wardrobe tab).

## The base model (Dress up)
`public/assets/avatar/base.png` is a picture of the model and is displayed unchanged at its own proportions; nothing in the code draws a body. Layer order: base picture → clothing → hair → accessories (hair is part of the picture for now).

`public/assets/avatar/config.json` holds the **anchor points** as plain coordinates over the picture (pixels of the 896 × 1776 file): neck, hairline, shoulders L/R, bust, waist, hips, knees, ankles and feet. The same file has a **rule per clothing category** (which width sizes it, where its top and bottom edges sit): shirts and coats are sized by the shoulders, trousers, skirts and dresses by the hips, shoes by the feet. Your cutouts are scaled to fit inside that box and centred on it. Turn on **Customize → Anchors → Show the points** to see the dots, width lines and each worn piece's box on the model, then edit the numbers in the config.

**Fit** is now for small tweaks only (nudge, size, turn, tuck): the position and size come from the points. Fits are remembered per piece and per base picture. Tapping the model selects the piece whose visible pixels you touched; the dashed box and the panel label ("Top: White tee", with its picture) always belong to that piece. Clothes get a feathered edge and a soft shadow so they sit on the body.

To use a different base picture: replace `base.png` (front-facing, arms slightly away from the body, transparent background, same file size or the same proportions), then move the points in `config.json` to match.

## The walk-in closet
**Dress up → Walk-in closet** is a full-screen luxury closet made of five photographed backgrounds (`public/assets/closet/`: overview panorama, rails, shoe and bag wall, vanity and jewelry island, mirror). Your real cutouts hang on the rails (Tops, Bottoms, Dresses, Coats) and stand on the lit shelves (Shoes, Bags) and the jewelry trays, each section with a count; an empty one offers **+ Add pieces**. There is no character: swipe left/right to move along the walls (one section per swipe), tap a label on the overview or the section strip at the bottom to glide there, pinch to look a little closer; the arrow keys work too. Tap a piece for its card (photo, tags, **Add to outfit**). The **Mirror** opens Dress up, where your mannequin stands in front of the three-way mirror: the mannequin is the only picture of you in the app. A thin top bar has back, coins and the Shop; today's challenge is a small pill (tap for details). Layout and positions are in `public/js/closet.js`.

## The daily challenge
Each day has a theme: from an **event** you add in Plan (it becomes that day's dress code), else the **mood** you picked on Dress up, else a very cold or hot forecast, else a surprise. A banner shows the theme, your coins, streak, **energy** (changing the outfit costs a little; tired means fewer coins) and **mood** (set by your last rating).
**Rate my look** scores the outfit out of 100 and says why, using only your own tags: fits the theme (occasion tags, 35), right for the weather (warmth tags vs the forecast, 20), colours work together (25), a complete outfit (10), fresh pieces you rarely wear (10). Stars are 90/75/58/40+; coins are 10 + 8 per star + 2 per streak day (up to 7), reduced when energy is low. You are only paid for improving on your best rating that day. **End the day** on the banner logs the outfit (streak) and closes the day; a new date brings a new theme. Coins, theme and history are saved on the device and included in backup and cloud sync. (What coins unlock comes next.)

## The shop
Coins from the daily challenge buy backdrops and poses for 📸 Photo mode in the **🛍️ Shop**. The catalogue and prices are in `public/js/game.js` (`CATALOG`).

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
- **Tap-to-select** (`/api/segment`) – SAM 2 point prompts (➕ = label 1, ➖ = label 0) from the Select step; the mask comes back and is applied on the phone.
- **Auto-fill details** (`/api/tag`) – reads the photo and fills in name, type, warmth and occasions for you to check. Model: `fal-ai/any-llm/vision` (`FAL_VISION_MODEL`, `FAL_VISION_LLM`).
- **Pinterest import** (`/api/pin`) – paste a pin link on the Inspo tab; the server fetches the picture (Pinterest hosts only, redirects re-checked). If Pinterest blocks it, upload the picture instead.
As with try-on, the fal request/response fields come from fal's public docs and are tested against a mock, not the live API; fal's own error text is shown if a field name is off.

## Accessibility
Keyboard-operable throughout, labelled controls, `aria-pressed` state on filters, dialogs that trap focus and restore it on close, screen-reader text for outfits and calendar days, live-region announcements, visible focus, and reduced-motion support. Automated axe (WCAG 2.1 AA) checks run in `npm test`; a manual screen-reader pass is still worth doing.

## Notes & limits
- All data (photos included) lives in your browser's IndexedDB — nothing is uploaded unless you turn on cloud sync. Clearing site data erases it; export/backup is a good next step.
- Selection works best on a plain, contrasting background (bed sheet, wall). The offline engine (GrabCut) needs more ➖ taps on busy photos than SAM 2 does.
- Pinterest has no open API, so inspo is image-based (upload/paste); pin links are saved for reference.
- The photoreal try-on is an AI render of your pieces on your photo (it uses your fal.ai credits); the quick model preview is fitted 2D layering, not cloth simulation: a flat photo of a garment can't drape or fold.

## Ideas for next
Backup/restore, accounts + sync, a serverless generative virtual-try-on endpoint (Vercel/Cloudflare function + a try-on model API) for photoreal drape, better garment segmentation, weather-aware suggestions.
