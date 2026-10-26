// Pure helpers for adding a piece: guess its category from words, tidy a shop's page title, and pull a link out of pasted text.
const RULES = [ // order matters: the more specific words win ("denim skirt" is a skirt, "sweater dress" is a dress)
  ['bodysuits', /\bbody ?suits?\b/], ['tanks', /\b(tank|cami|camisole|bralette|bandeau|tube top|crop top)s?\b/],
  ['dresses', /\b(dress(es)?|gowns?|jumpsuits?|rompers?|playsuits?|maxi|midi dress)\b/], ['skirts', /\b(skirts?|skorts?)\b/],
  ['outerwear', /\b(jackets?|coats?|blazers?|parkas?|trench(es)?|puffers?|vests?|gilets?|cardigans?|windbreakers?|bombers?|shackets?|capes?|ponchos?)\b/],
  ['bottoms', /\b(jeans?|pants?|trousers?|leggings?|shorts?|joggers?|sweatpants|chinos?|culottes?|cargos?|slacks)\b/],
  ['shoes', /\b(shoes?|sneakers?|trainers?|boots?|heels?|sandals?|loafers?|flats?|pumps?|slippers?|mules?|clogs?|oxfords?|stilettos?|wedges?)\b/],
  ['bags', /\b(bags?|totes?|purses?|clutch(es)?|backpacks?|handbags?|crossbody|satchels?|wallets?)\b/],
  ['accessories', /\b(belts?|scarf|scarves|hats?|caps?|beanies?|necklaces?|earrings?|rings?|bracelets?|sunglasses|watch(es)?|gloves?|jewell?ery|headbands?|scrunchies?|hair clips?)\b/],
  ['tops', /\b(tops?|tees?|t-?shirts?|shirts?|blouses?|sweaters?|jumpers?|sweatshirts?|hoodies?|knits?|pullovers?|turtlenecks?|polos?|tunics?)\b/],
];
/** Category key from a name or page title, or null when nothing in it says. */
export function guessType(text) {
  const t = String(text || '').toLowerCase().replace(/[_-]+/g, ' ');
  for (const [type, re] of RULES) if (re.test(t)) return type;
  return null;
}

/** "Satin Cami Top | ZARA United States" -> "Satin Cami Top" */
export function tidyTitle(title, brand = '') {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  t = t.split(/\s+[|–—]\s+|\s+-\s+|\s+·\s+/)[0];
  t = t.replace(/^(buy|shop)\s+/i, '');
  if (brand && t.toLowerCase().startsWith(brand.toLowerCase() + ' ')) t = t.slice(brand.length + 1);
  return t.slice(0, 40).trim();
}

/** The first web link in some pasted text (a share sheet often sends "Check this out https://…"), or ''. */
export function firstLink(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"')]+/i);
  return m ? m[0].replace(/[.,;!?]+$/, '') : '';
}

/** What a deep link asks for: /?add=paste, /?add=link&u=https://…, /?add=photo, or /?add=shared (a share-target hand-off). */
export function deepLink(search) {
  const q = new URLSearchParams(search), add = q.get('add');
  if (!['paste', 'link', 'photo', 'shared'].includes(add)) return null;
  return { mode: add, url: firstLink(q.get('u') || q.get('url') || q.get('text') || '') };
}
