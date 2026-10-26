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

// How warm a piece is, used with the weather. 'all' fits anything.
export const SEASONS = [['light', '☀️ Light / summer'], ['all', '🍂 All-season'], ['warm', '❄️ Warm / winter']];

export const EYES = ['#2b1d17', '#5a3a22', '#2e6f4f', '#2f6fb3', '#6b7280', '#7a4cc2'];
export const LIPS = ['#c4505f', '#a8324a', '#e07a8a', '#7a2d3a', '#d9857a', '#f0a3b2'];
// Rooms: 'auto' follows the season. [label, emoji]
export const ROOMS = { pastel: ['Pastel bedroom', '🪴'], studio: ['Studio', '🪞'], night: ['Night in', '🌙'], spring: ['Spring', '🌷'], autumn: ['Autumn', '🍂'], winter: ['Winter', '🎄'] };
export const seasonRoom = (month /* 0-11 */) => (month >= 2 && month <= 4 ? 'spring' : month <= 7 && month >= 5 ? 'pastel' : month >= 8 && month <= 10 ? 'autumn' : 'winter');

export const SLOTS = ['dress', 'top', 'bottom', 'outer', 'shoes', 'bag', 'acc'];
export const SLOT_LABEL = { dress: 'Dress', top: 'Top', bottom: 'Bottom', outer: 'Outerwear', shoes: 'Shoes', bag: 'Bag', acc: 'Accessory' };

// Paint order, back to front.
export const Z = ['shoes', 'bottom', 'dress', 'top', 'outer', 'bag', 'acc'];

export const SKIN = ['#fbe3d3', '#f6d9c4', '#eec3a0', '#e0ac82', '#d9a074', '#c68a5e', '#b97a50', '#8a5636', '#6d4228', '#4a2c1a'];
export const HAIR = ['#1f1612', '#4a2e1e', '#7a4a26', '#a8321f', '#d6b370', '#efe3c0', '#3a3a46', '#c9c9d4', '#e8639a', '#7c4dff', '#2fa8e0', '#22b573'];
export const HAIR_STYLES = [['long', '💁‍♀️ Long'], ['bob', '👩 Bob'], ['pixie', '✂️ Pixie'], ['bun', '🎀 Bun'], ['pony', '🐴 Ponytail'], ['curly', '🌀 Curly']];
// Body types = presets for the five shape sliders (1 = default figure)
export const BODY_TYPES = {
  Petite: { shoulders: .95, hips: .98, torso: .92, legs: .86, build: .95 },
  Average: { shoulders: 1, hips: 1, torso: 1, legs: 1, build: 1 },
  Tall: { shoulders: 1, hips: 1, torso: 1.05, legs: 1.14, build: 1 },
  Athletic: { shoulders: 1.12, hips: .96, torso: 1, legs: 1.04, build: 1.06 },
  Pear: { shoulders: .94, hips: 1.18, torso: 1, legs: 1, build: 1.05 },
  Hourglass: { shoulders: 1.04, hips: 1.14, torso: .98, legs: 1, build: 1.04 },
  Curvy: { shoulders: 1.02, hips: 1.22, torso: .98, legs: .98, build: 1.16 },
  'Plus size': { shoulders: 1.06, hips: 1.3, torso: 1, legs: .98, build: 1.3 },
};

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

// The twelve ready-made 3D characters (see avatar.js); kept here so the app doesn't load the 3D code just to list them.
export const AVATARS = ['mini_female_a', 'mini_female_b', 'mini_female_c', 'mini_female_d', 'mini_female_e', 'mini_female_f', 'mini_male_a', 'mini_male_b', 'mini_male_c', 'mini_male_d', 'mini_male_e', 'mini_male_f'];
