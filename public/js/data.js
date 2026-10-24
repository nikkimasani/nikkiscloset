// Taxonomy. Each clothing type maps to a mannequin "slot"; the slot decides where it's drawn
// and what it replaces (a dress occupies top + bottom).
export const OCCASIONS = [
  'Work / Office', 'Date Night', 'GNO', 'Casual Outing', 'Brunch', 'Dinner',
  'Workout', 'Travel', 'Formal / Event', 'Lounge',
];

export const OCCASION_EMOJI = {
  'Work / Office': '💼', 'Date Night': '🌹', GNO: '🥂', 'Casual Outing': '🛍️', Brunch: '🥐',
  Dinner: '🍽️', Workout: '🏋️', Travel: '✈️', 'Formal / Event': '✨', Lounge: '🛋️',
};

export const TYPES = {
  tops:        { label: 'Tops',        slot: 'top',    emoji: '👚' },
  tanks:       { label: 'Tank Tops',   slot: 'top',    emoji: '🎽' },
  bodysuits:   { label: 'Bodysuits',   slot: 'top',    emoji: '🩱' },
  bottoms:     { label: 'Bottoms',     slot: 'bottom', emoji: '👖' },
  skirts:      { label: 'Skirts',      slot: 'bottom', emoji: '🩳' },
  dresses:     { label: 'Dresses',     slot: 'dress',  emoji: '👗' },
  outerwear:   { label: 'Outerwear',   slot: 'outer',  emoji: '🧥' },
  shoes:       { label: 'Shoes',       slot: 'shoes',  emoji: '👠' },
  bags:        { label: 'Bags',        slot: 'bag',    emoji: '👜' },
  accessories: { label: 'Accessories', slot: 'acc',    emoji: '💍' },
};

export const SLOTS = ['dress', 'top', 'bottom', 'outer', 'shoes', 'bag', 'acc'];
export const SLOT_LABEL = { dress: 'Dress', top: 'Top', bottom: 'Bottom', outer: 'Outerwear', shoes: 'Shoes', bag: 'Bag', acc: 'Accessory' };

// Paint order, back to front.
export const Z = ['shoes', 'bottom', 'dress', 'top', 'outer', 'bag', 'acc'];

export const SKIN = ['#f6d9c4', '#eec3a0', '#d9a074', '#b97a50', '#8a5636', '#5d3a25'];
export const HAIR = ['#1f1612', '#4a2e1e', '#8a5a2b', '#d6b370', '#a8321f', '#3a3a46'];

export const slotOf = (type) => TYPES[type].slot;

/** Put an item into an outfit map, enforcing slot rules (dress vs. top/bottom). */
export function wear(outfit, item) {
  const next = { ...outfit };
  const slot = slotOf(item.type);
  if (next[slot] === item.id) { delete next[slot]; return next; } // tap again to take off
  next[slot] = item.id;
  if (slot === 'dress') { delete next.top; delete next.bottom; }
  if (slot === 'top' || slot === 'bottom') delete next.dress;
  return next;
}
