# Audit — Oct 2026

Scope: whole app (UI, 3D, data layer, AI endpoint, deploy config, tests, accessibility, docs).
Method: static analysis (ESLint), an adversarial browser probe (hostile input, awkward sequences, phone viewport),
a security read of `lib/tryon.js` and the CSP, and the existing e2e/axe suite. 72 automated checks now pass.

## Bugs found and fixed
| # | Problem | Impact | Fix |
|---|---|---|---|
| 1 | The ✎ Edit button on wardrobe pieces sat under the piece's picture | Tapping it *tried the piece on* — pieces couldn't be edited or deleted | raised above the picture |
| 2 | Opening a screen kept the previous screen's scroll position | Dress Up opened half-way down the page | each screen starts at the top |
| 3 | Deleting a piece left its id in saved looks and in the current outfit | Ghost entries; "Wear today" could log a piece that no longer exists | one `removeItems()` cleans closet, outfit, saved looks, cached images; loading a look / logging a wear ignores missing pieces |
| 4 | Re-doing "Make it look like me" didn't override an earlier body-type preset | The new body was silently ignored | saving a model clears the preset |
| 5 | Removed pieces' images were never released | Slow memory growth | object URLs revoked on delete |
| 6 | Wrong AI passcodes were answered instantly | Easier to brute-force | 400 ms delay per wrong guess |
| 7 | (earlier in the build) a scrolling row stretched the page wider than a phone; Inspo preview overlapped its buttons | covered buttons | fixed and covered by tests |

## Loose ends closed
- **Backup & restore** (Wardrobe → bottom): one JSON file with every piece, image, look, diary entry and appearance setting. Your closet no longer depends on one browser.
- **Remove sample pieces** button (the sample closet was previously permanent).
- **Installable app**: web manifest, icons, service worker (updates load immediately; 3D/pose files cached for offline). Works on iOS/Android home screens.
- **Automatic tests on GitHub** for every PR/push (`.github/workflows/test.yml`).
- Removed unused imports/variables; ESLint is clean.

## Checked and fine
- Hostile item names (`<img onerror>`) are escaped everywhere — no script execution (now a test).
- The AI endpoint fails closed without `FAL_KEY` + `APP_PASSCODE`, only talks to fal's queue (SSRF-guarded), and never caches.
- CSP is strict (no remote scripts, no inline script); camera allowed for this site only.
- axe (WCAG 2.1 AA) passes on every screen, dialog, the 3D view and the Customize tab.

## Known limits (not bugs, but worth knowing)
- Your data lives in the browser (IndexedDB). Use Backup regularly until sync exists.
- The fal.ai request fields are from public docs and tested against a mock; the first real render is the real test.
- 3D garments are wrapped cutouts: no cloth folds, backs mirror fronts, shoes/bags are roughest. Photo mode and Diary thumbnails are 2D.
- Background removal needs a plain backdrop; busy backgrounds need manual strength tuning.
- The AI passcode is kept in the browser's localStorage (fine for a personal app; use a long passphrase).
- No manual screen-reader pass has been done yet (automated checks only).
- Not verifiable from the build environment: the live Vercel `/api/tryon` response and real-device performance.

## Ideas, roughly by value
**Make it safer / cheaper**
1. ✅ *Done (sync-key based, no accounts)* **Cloud sync + sign-in** (e.g. Supabase) so the closet follows you across phone/laptop and survives a cleared browser.
2. **Cache AI renders** per photo+piece so re-viewing an outfit never re-bills; add a daily render cap on the server.
3. Compress stored images (WebP) and lazy-load the 3D engine for a faster first load.

**Smarter closet**
4. **Auto-tag photos** (type, colour, season, occasion, formality) with a vision model instead of filling forms by hand.
5. **Better cutouts** with an AI segmentation model so messy backgrounds work.
6. ✅ *Done (back photo)* Front *and* back photos per piece so the 3D back isn't a mirror; per-type 3D shapes with sleeves.
7. Price + purchase date → **cost per wear**, "haven't worn in 90 days" nudges, declutter/donate list.

**Planning**
8. **Weather-aware suggestions** (free Open-Meteo, no key) and a 7-day outfit planner.
9. **Calendar-aware**: look at tomorrow's events (Google Calendar) and propose outfits per event/dress code.
10. **Packing lists** for trips: pick days + weather → capsule of mix-and-match pieces.

**Inspo + shopping**
11. Paste a Pinterest/Instagram link → fetch the image server-side (no screenshots); import a whole board.
12. Turn "you're missing a sage-green top" into a **wishlist** with budget and links; outfit-gap analytics ("you own 9 tops but 1 bottom for Work").

**Social / fun**
13. Save/share a **look card** (3D snapshot + item list) as an image; "ask a friend" poll link.
14. Seasonal rooms/backgrounds, more hair/face options, outfit-of-the-week streaks with the mood gem.

**Quality**
15. Manual screen-reader + real-device pass; unit tests for colour/stylist logic; visual-regression screenshots in CI.
