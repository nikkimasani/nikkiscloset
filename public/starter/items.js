// The starter closet: pieces generated with fal (scripts/starter.mjs or Closet > Starter closet) so the app is useful before your own
// clothes are added. Style profile from Nikki's Pinterest boards: chic neutral casual + polished workwear. Add a row to add a piece;
// its id is made from its name, so keep names unique. Each row: [name, type, colours, warmth, occasions, extra detail for the prompt].
// warmth: light / all / warm. occasions: C casual, W work, D date night, B brunch, E event. The wider wardrobe is in wardrobe.js.
import { WARDROBE_ROWS, STAPLE_ROWS } from './wardrobe.js';
export const STYLE = 'chic neutral casual and polished workwear; cream, ivory, beige, camel, chocolate brown, black, white, olive, champagne and denim';
export const OCC = { C: 'Casual Outing', W: 'Work / Office', D: 'Date Night', B: 'Brunch', E: 'Formal / Event' };
/** A stable seed for each category. */
const SEEDS = { tops: 110000, bottoms: 220000, dresses: 330000, outerwear: 440000, shoes: 550000, bags: 660000, accessories: 770000 };
export const BATCHES = [['tops', 'Tops', '👚'], ['bottoms', 'Bottoms', '👖'], ['dresses', 'Dresses', '👗'], ['outerwear', 'Outerwear', '🧥'], ['shoes', 'Shoes', '👠'], ['bags', 'Bags', '👜'], ['accessories', 'Accessories', '💍']];

const ROWS = {
  tops: [
    ['Black strapless tube top', 'tops', 'black', 'light', 'CDB', 'fitted stretch knit tube top'],
    ['Brown leopard corset top', 'tops', 'brown', 'light', 'DB', 'structured corset top with boning, brown leopard print'],
    ['Cream crochet cami', 'tanks', 'cream', 'light', 'CB', 'hand-crochet camisole with thin straps'],
    ['White ribbed tank', 'tanks', 'white', 'light', 'C', 'fitted ribbed cotton tank top'],
    ['Oatmeal knit sweater vest', 'tops', 'oatmeal,beige', 'all', 'CW', 'V-neck knit sweater vest'],
    ['Butter-yellow corset top', 'tops', 'butter yellow', 'light', 'DB', 'structured satin corset top with thin straps'],
    ['Black halter bodysuit', 'bodysuits', 'black', 'all', 'DE', 'fitted halter-neck bodysuit'],
    ['White square-neck bodysuit', 'bodysuits', 'white', 'all', 'CWB', 'fitted short-sleeve square-neck bodysuit'],
    ['Navy halter top', 'tops', 'navy', 'light', 'DB', 'fitted halter-neck top'],
    ['White crisp button-down', 'tops', 'white', 'all', 'WC', 'crisp cotton poplin button-down shirt, long sleeves'],
    ['Ivory satin cami', 'tanks', 'ivory', 'light', 'DWE', 'bias-cut satin camisole with thin straps'],
    ['Black scoop-neck long-sleeve bodysuit', 'bodysuits', 'black', 'all', 'CWD', 'fitted long-sleeve scoop-neck bodysuit'],
    ['Cream cable-knit sweater', 'tops', 'cream', 'warm', 'C', 'chunky cable-knit crewneck sweater'],
    ['Camel ribbed turtleneck', 'tops', 'camel', 'warm', 'WC', 'fitted ribbed knit turtleneck, long sleeves'],
    ['Olive scoop tank', 'tanks', 'olive', 'light', 'C', 'fitted scoop-neck tank top'],
    ['White off-shoulder sweater', 'tops', 'white', 'warm', 'CD', 'soft knit off-the-shoulder sweater, long sleeves'],
    ['Black fitted tee', 'tops', 'black', 'all', 'C', 'fitted crewneck cotton t-shirt, short sleeves'],
    ['Champagne satin blouse', 'tops', 'champagne', 'all', 'WE', 'long-sleeve satin blouse with buttons'],
    ['Beige twist-front top', 'tops', 'beige', 'all', 'CB', 'fitted short-sleeve top with a twist detail at the front'],
    ['Chocolate ribbed tank', 'tanks', 'chocolate brown', 'light', 'C', 'fitted ribbed tank top'],
  ],
  bottoms: [
    ['Light-wash wide-leg jeans', 'bottoms', 'light denim', 'all', 'CB', 'high-waisted wide-leg jeans, light blue wash'],
    ['Medium-wash straight jeans', 'bottoms', 'medium denim', 'all', 'C', 'high-waisted straight-leg jeans, medium blue wash'],
    ['Dark-wash wide-leg jeans', 'bottoms', 'dark denim', 'all', 'CW', 'high-waisted wide-leg jeans, dark indigo wash'],
    ['Light-wash cuffed straight jeans', 'bottoms', 'light denim', 'all', 'C', 'straight-leg jeans with cuffed hems, light wash'],
    ['Distressed skinny jeans', 'bottoms', 'medium denim', 'all', 'C', 'high-waisted skinny jeans with ripped knees'],
    ['Dark denim maxi skirt', 'skirts', 'dark denim', 'all', 'CB', 'ankle-length denim maxi skirt with a front slit, dark wash'],
    ['Light denim maxi skirt', 'skirts', 'light denim', 'all', 'CB', 'ankle-length denim maxi skirt with a front slit, light wash'],
    ['Champagne satin slip skirt', 'skirts', 'champagne', 'all', 'DE', 'bias-cut satin midi slip skirt'],
    ['Black satin midi skirt', 'skirts', 'black', 'all', 'DWE', 'satin midi skirt'],
    ['Black tailored trousers', 'bottoms', 'black', 'all', 'W', 'tailored straight-leg trousers with a pressed crease'],
    ['White wide-leg trousers', 'bottoms', 'white', 'light', 'WB', 'high-waisted wide-leg tailored trousers'],
    ['Camel wide-leg trousers', 'bottoms', 'camel', 'all', 'W', 'high-waisted wide-leg tailored trousers'],
    ['Beige pleated trousers', 'bottoms', 'beige', 'all', 'W', 'pleated straight-leg trousers'],
    ['Olive cargo pants', 'bottoms', 'olive', 'all', 'C', 'straight-leg cargo-style pants with side pockets'],
    ['Cream linen pants', 'bottoms', 'cream', 'light', 'CB', 'relaxed wide-leg linen pants with a drawstring waist'],
    ['Black flare pants', 'bottoms', 'black', 'all', 'WD', 'high-waisted flared pants'],
    ['Black leather mini skirt', 'skirts', 'black', 'all', 'D', 'faux leather mini skirt'],
    ['Cream knit midi skirt', 'skirts', 'cream', 'warm', 'CB', 'ribbed knit midi skirt'],
    ['White denim straight jeans', 'bottoms', 'white', 'light', 'CB', 'high-waisted straight-leg white jeans'],
    ['Black bike shorts', 'bottoms', 'black', 'light', 'C', 'high-waisted mid-thigh bike shorts'],
  ],
  dresses: [
    ['Black slip midi dress', 'dresses', 'black', 'all', 'DE', 'bias-cut satin slip midi dress with thin straps'],
    ['Champagne satin slip maxi', 'dresses', 'champagne', 'light', 'E', 'satin slip maxi dress with thin straps'],
    ['Black strapless mini dress', 'dresses', 'black', 'all', 'DE', 'fitted strapless mini dress'],
    ['White linen sundress', 'dresses', 'white', 'light', 'CB', 'linen midi sundress with thin straps'],
    ['Olive ribbed midi dress', 'dresses', 'olive', 'all', 'C', 'fitted ribbed knit midi dress, sleeveless'],
    ['Camel sweater dress', 'dresses', 'camel', 'warm', 'CW', 'knit sweater dress with long sleeves, knee length'],
    ['Black bodycon midi dress', 'dresses', 'black', 'all', 'DE', 'fitted bodycon midi dress'],
    ['Ivory square-neck midi dress', 'dresses', 'ivory', 'light', 'BE', 'square-neck midi dress with short puff sleeves'],
    ['Chocolate satin cowl dress', 'dresses', 'chocolate brown', 'all', 'DE', 'satin midi dress with a cowl neckline and thin straps'],
    ['Black one-shoulder dress', 'dresses', 'black', 'all', 'DE', 'fitted one-shoulder midi dress'],
    ['Cream crochet maxi dress', 'dresses', 'cream', 'light', 'CB', 'crochet maxi dress with thin straps'],
    ['Navy halter midi dress', 'dresses', 'navy', 'light', 'DE', 'halter-neck midi dress'],
    ['Beige shirt dress', 'dresses', 'beige', 'all', 'WC', 'belted button-front shirt dress, knee length'],
    ['White strapless corset mini', 'dresses', 'white', 'light', 'DE', 'strapless corset mini dress'],
    ['Black wrap dress', 'dresses', 'black', 'all', 'WD', 'wrap midi dress with long sleeves'],
    ['Red slip mini dress', 'dresses', 'red', 'light', 'D', 'satin slip mini dress with thin straps'],
    ['Emerald satin midi dress', 'dresses', 'emerald green', 'all', 'E', 'satin midi slip dress'],
    ['Black long-sleeve mini dress', 'dresses', 'black', 'all', 'D', 'fitted long-sleeve mini dress'],
    ['Taupe ribbed maxi dress', 'dresses', 'taupe', 'all', 'C', 'fitted ribbed knit maxi dress, sleeveless'],
    ['White eyelet mini dress', 'dresses', 'white', 'light', 'CB', 'cotton eyelet mini dress with thin straps'],
  ],
  outerwear: [
    ['Oversized beige blazer', 'outerwear', 'beige', 'all', 'WC', 'oversized single-breasted blazer'],
    ['Black tailored blazer', 'outerwear', 'black', 'all', 'WE', 'tailored single-breasted blazer'],
    ['Camel wool coat', 'outerwear', 'camel', 'warm', 'WC', 'long wool overcoat'],
    ['Classic trench coat', 'outerwear', 'beige', 'all', 'WC', 'double-breasted belted trench coat'],
    ['Cream cardigan', 'outerwear', 'cream', 'all', 'C', 'soft knit button-front cardigan'],
    ['Black leather moto jacket', 'outerwear', 'black', 'all', 'CD', 'leather biker jacket with zips'],
    ['Light-wash denim jacket', 'outerwear', 'light denim', 'all', 'C', 'classic denim jacket, light wash'],
    ['Chocolate suede jacket', 'outerwear', 'chocolate brown', 'all', 'C', 'suede jacket'],
    ['White linen blazer', 'outerwear', 'white', 'light', 'WB', 'relaxed linen blazer'],
    ['Grey plaid blazer', 'outerwear', 'grey', 'all', 'W', 'plaid wool blazer'],
    ['Black wool coat', 'outerwear', 'black', 'warm', 'WE', 'long wool overcoat'],
    ['Cream teddy coat', 'outerwear', 'cream', 'warm', 'C', 'fluffy teddy fleece coat'],
    ['Olive utility jacket', 'outerwear', 'olive', 'all', 'C', 'cotton utility jacket with chest pockets'],
    ['Beige knit duster', 'outerwear', 'beige', 'all', 'C', 'long open-front knit duster cardigan'],
    ['Black cropped blazer', 'outerwear', 'black', 'all', 'WD', 'cropped tailored blazer'],
    ['Camel cropped jacket', 'outerwear', 'camel', 'all', 'C', 'cropped wool jacket'],
    ['Brown leather blazer', 'outerwear', 'brown', 'all', 'WD', 'leather blazer'],
    ['Ivory tweed jacket', 'outerwear', 'ivory', 'all', 'WE', 'boucle tweed jacket with gold buttons'],
    ['Black puffer jacket', 'outerwear', 'black', 'warm', 'C', 'quilted puffer jacket'],
    ['Oatmeal shirt jacket', 'outerwear', 'oatmeal,beige', 'all', 'C', 'oversized wool-blend shirt jacket'],
  ],
  shoes: [
    ['Brown leather slides', 'shoes', 'brown', 'light', 'C', 'flat leather slide sandals'],
    ['Nude slingback heels', 'shoes', 'nude,beige', 'all', 'WE', 'pointed-toe slingback heels'],
    ['Black pointed pumps', 'shoes', 'black', 'all', 'WE', 'pointed-toe stiletto pumps'],
    ['Gold strappy heeled sandals', 'shoes', 'gold', 'light', 'DE', 'metallic gold strappy heeled sandals'],
    ['White leather sneakers', 'shoes', 'white', 'all', 'C', 'minimal white leather sneakers'],
    ['Black kitten heels', 'shoes', 'black', 'all', 'W', 'pointed-toe kitten heels'],
    ['Tan mules', 'shoes', 'tan', 'all', 'CW', 'leather block-heel mules'],
    ['White pointed kitten heels', 'shoes', 'white', 'all', 'WB', 'pointed-toe kitten heels'],
    ['Black knee-high boots', 'shoes', 'black', 'warm', 'CD', 'leather knee-high boots with a block heel'],
    ['Brown ankle boots', 'shoes', 'brown', 'warm', 'C', 'leather ankle boots'],
    ['Nude block-heel sandals', 'shoes', 'nude,beige', 'light', 'BW', 'block-heel strappy sandals'],
    ['Black strappy heels', 'shoes', 'black', 'all', 'DE', 'strappy stiletto sandals'],
    ['Cream ballet flats', 'shoes', 'cream', 'all', 'CW', 'leather ballet flats'],
    ['Gold flat sandals', 'shoes', 'gold', 'light', 'C', 'metallic flat thong sandals'],
    ['Black loafers', 'shoes', 'black', 'all', 'WC', 'leather penny loafers'],
    ['Beige knee-high boots', 'shoes', 'beige', 'warm', 'C', 'suede knee-high boots'],
    ['Clear-strap heels', 'shoes', 'clear,nude', 'light', 'DE', 'heels with clear PVC straps'],
    ['Brown platform sandals', 'shoes', 'brown', 'light', 'C', 'leather platform sandals'],
    ['White mules', 'shoes', 'white', 'light', 'CB', 'leather heeled mules'],
    ['Black ankle boots', 'shoes', 'black', 'warm', 'CW', 'leather heeled ankle boots'],
  ],
  bags: [
    ['Brown leather shoulder bag', 'bags', 'brown', 'all', 'CW', 'leather shoulder bag'],
    ['Brown crescent bag', 'bags', 'brown', 'all', 'CB', 'leather crescent-shaped shoulder bag'],
    ['Chocolate woven tote', 'bags', 'chocolate brown', 'all', 'CB', 'woven leather tote bag'],
    ['Black top-handle bag', 'bags', 'black', 'all', 'WE', 'structured leather top-handle bag'],
    ['Beige quilted crossbody', 'bags', 'beige', 'all', 'CB', 'quilted leather crossbody bag with a chain strap'],
    ['White shoulder bag', 'bags', 'white', 'light', 'CB', 'leather shoulder bag'],
    ['Red mini crossbody', 'bags', 'red', 'all', 'D', 'mini leather crossbody bag'],
    ['Black clutch', 'bags', 'black', 'all', 'DE', 'leather envelope clutch'],
    ['Gold metallic clutch', 'bags', 'gold', 'all', 'E', 'metallic gold clutch'],
    ['Tan bucket bag', 'bags', 'tan', 'all', 'C', 'leather drawstring bucket bag'],
    ['Black leather tote', 'bags', 'black', 'all', 'W', 'large structured leather tote'],
    ['Cream baguette bag', 'bags', 'cream', 'all', 'BD', 'leather baguette shoulder bag'],
    ['Cognac saddle bag', 'bags', 'cognac,brown', 'all', 'C', 'leather saddle bag'],
    ['Straw beach tote', 'bags', 'straw,beige', 'light', 'C', 'woven straw tote with leather handles'],
    ['Black chain-strap bag', 'bags', 'black', 'all', 'DE', 'quilted leather bag with a gold chain strap'],
    ['Olive hobo bag', 'bags', 'olive', 'all', 'C', 'slouchy leather hobo bag'],
    ['White woven clutch', 'bags', 'white', 'light', 'BE', 'woven leather clutch'],
    ['Brown belt bag', 'bags', 'brown', 'all', 'C', 'leather belt bag'],
    ['Beige structured tote', 'bags', 'beige', 'all', 'W', 'structured leather tote'],
    ['Black mini bag', 'bags', 'black', 'all', 'D', 'mini leather top-handle bag'],
  ],
  accessories: [
    ['Chunky gold hoops', 'accessories', 'gold', 'all', 'CDBWE', 'chunky gold hoop earrings, a pair'],
    ['Gold dome earrings', 'accessories', 'gold', 'all', 'WB', 'gold dome stud earrings, a pair'],
    ['Gold drop earrings', 'accessories', 'gold', 'all', 'DE', 'gold drop earrings, a pair'],
    ['Layered gold necklaces', 'accessories', 'gold', 'all', 'CDB', 'three layered fine gold chain necklaces'],
    ['Gold pendant necklace', 'accessories', 'gold', 'all', 'CWB', 'fine gold chain necklace with a small pendant'],
    ['Gold watch', 'accessories', 'gold', 'all', 'W', "women's gold wristwatch with a link bracelet"],
    ['Gold cuff bracelet', 'accessories', 'gold', 'all', 'DE', 'polished gold cuff bracelet'],
    ['Gold chain bracelet', 'accessories', 'gold', 'all', 'CB', 'gold chain link bracelet'],
    ['Tortoiseshell sunglasses', 'accessories', 'tortoiseshell,brown', 'light', 'CB', 'tortoiseshell acetate sunglasses'],
    ['Black cat-eye sunglasses', 'accessories', 'black', 'light', 'CB', 'black cat-eye sunglasses'],
    ['Brown oversized sunglasses', 'accessories', 'brown', 'light', 'C', 'oversized brown sunglasses'],
    ['Brown leather belt', 'accessories', 'brown', 'all', 'CW', 'leather belt with a gold buckle'],
    ['Black leather belt', 'accessories', 'black', 'all', 'WC', 'black leather belt with a gold buckle'],
    ['Cream silk scarf', 'accessories', 'cream', 'all', 'WB', 'silk square scarf, cream with a subtle pattern'],
    ['Tortoiseshell claw clip', 'accessories', 'tortoiseshell,brown', 'all', 'C', 'tortoiseshell hair claw clip'],
    ['Gold rings set', 'accessories', 'gold', 'all', 'CDB', 'set of five stacking gold rings'],
    ['Pearl earrings', 'accessories', 'ivory', 'all', 'WE', 'pearl stud earrings, a pair'],
    ['Black headband', 'accessories', 'black', 'all', 'C', 'padded black headband'],
    ['Gold anklet', 'accessories', 'gold', 'light', 'CB', 'fine gold chain anklet'],
    ['Beige bucket hat', 'accessories', 'beige', 'light', 'C', 'cotton bucket hat'],
  ],
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Which body point an accessory or bag snaps to (accRules in assets/avatar/config.json), from its name. */
export function accKindOf(name, type) {
  const n = name.toLowerCase();
  if (type === 'bags') return /clutch/.test(n) ? 'clutch' : /top-handle|tote|mini bag|bucket/.test(n) ? 'handbag' : 'shoulderbag';
  if (type !== 'accessories') return undefined;
  return [[/earring|hoops/, 'earrings'], [/necklace/, 'necklace'], [/watch/, 'watch'], [/bracelet|cuff/, 'bracelet'], [/ring/, 'rings'], [/anklet/, 'anklet'],
    [/sunglasses/, 'sunglasses'], [/hat/, 'hat'], [/headband/, 'headband'], [/clip/, 'clip'], [/belt/, 'belt'], [/scarf/, 'scarf']].find(([re]) => re.test(n))?.[1];
}
/** Every starter piece: { id, batch, name, type, acc?, colors, season, occasions, detail, seed }. */
const taken = new Set(Object.keys(ROWS).flatMap((b) => [...ROWS[b], ...(WARDROBE_ROWS[b] || [])].map(([name]) => slug(name))));
const staples = (batch) => (STAPLE_ROWS[batch] || []).filter(([name]) => !taken.has(slug(name))); // (a colour a named row already has is skipped)
export const ITEMS = Object.entries(ROWS).map(([batch, rows]) => [batch, [...rows, ...(WARDROBE_ROWS[batch] || []), ...staples(batch)]]).flatMap(([batch, rows], b) => rows.map(([name, type, colors, season, occ, detail], k) => ({
  id: 'starter-' + slug(name), batch, name, type, acc: accKindOf(name, type), colors: colors.split(','), season, occasions: [...occ].map((c) => OCC[c]), detail,
  seed: SEEDS[batch] + k, // a stable seed per category (plus the piece's place in it), so a batch looks like one set and remakes are repeatable
})));
export const starterItem = (id) => ITEMS.find((i) => i.id === id) || null;
/** The seed for a piece's n-th try: the stable one first, then a fixed step for each automatic or manual remake. */
export const seedFor = (it, attempt = 0) => (it.seed + attempt * 7919) % 2147483647;

const SMALL = new Set(['shoes', 'bags', 'accessories']);
/** The picture size (used by fal; Cloudflare's FLUX.1 schnell always makes 1024x1024): portrait for clothing, square for the rest. */
export const sizeFor = (it) => (SMALL.has(it.type) ? { width: 1024, height: 1024 } : { width: 1024, height: 1365 });
/** The fixed style every picture ends with, so the set looks consistent. FLUX schnell tends to draw whatever a prompt names, even after
 *  "no", so the prompt only describes what we want: words like mannequin, model, person or dress form never appear (a test checks this). */
export const STYLE_SUFFIX = 'centered, entire item visible with margin on all sides, plain pure white background, soft even lighting, sharp focus, true-to-life colour';
/** White, cream and other light pieces are made on plain grey instead: on white their edges can't be told from the background, so the
 *  cut-out came out shredded. (Grey pieces stay on white.) */
export const LIGHT_COLOURS = /white|cream|ivory|oatmeal|beige|champagne|clear|nude|butter|taupe|straw|silver|pearl/;
export const onGrey = (it) => it.colors.some((c) => LIGHT_COLOURS.test(c)) && !it.colors.some((c) => /grey|gray/.test(c));
const suffix = (it) => (onGrey(it) ? STYLE_SUFFIX.replace('plain pure white background', 'plain solid medium grey background') : STYLE_SUFFIX);
/** Cloudflare's filter can refuse a prompt for lingerie-sounding words ("slip"), so the prompt describes those pieces without them. */
export const tame = (t) => t.replace(/\bslip (midi |maxi |mini )?dress\b/gi, (m, l) => `${l || ''}dress`).replace(/\bslip skirt\b/gi, 'skirt').replace(/\bslip\b ?/gi, '').replace(/thin straps/gi, 'spaghetti straps').replace(/\s+/g, ' ').trim();
/** Pieces that need to hold their shape in a flat lay (corsets, tube tops, bustiers). */
export const structured = (it) => /corset|tube|bustier|strapless/i.test(`${it.name} ${it.detail}`);
export function promptFor(it) {
  const what = tame(`${it.colors.join(' and ')} ${it.detail}`);
  if (SMALL.has(it.type)) return `Product photo of ${what}, viewed from the front at a slight angle, ${suffix(it)}`;
  return `Flat lay product photo of ${what}, laid flat and neatly arranged, viewed from directly above${structured(it) ? ', flat lay, front view, structured shape' : ''}, ${suffix(it)}`;
}
export const FORBIDDEN_WORDS = /mannequin|\bmodel\b|person|dress form|hanger/i;
