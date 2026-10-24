// Game-style outfit meters: how well the look fits the chosen mood, whether its colours work together,
// and how "fresh" (rarely worn) the pieces are.
import { toLab, unhex } from './color.js';

const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function outfitMeters(bySlot, mood, counts = {}) {
  const list = Object.values(bySlot);
  if (!list.length) return null;

  const fit = mood ? Math.round((100 * list.filter((i) => i.occasions?.includes(mood)).length) / list.length) : null;

  // Colour harmony: neutrals go with anything; coloured pieces should be close (analogous) or opposite (complementary).
  const hues = list.map((i) => { const [, a, b] = toLab(unhex(i.color?.hex || '#808080')); return { c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }; })
    .filter((x) => x.c > 22).map((x) => x.h);
  let harmony = 100;
  if (hues.length > 1) {
    const spread = Math.max(...hues.flatMap((h, i) => hues.slice(i + 1).map((g) => hueGap(h, g))));
    harmony = spread <= 45 ? 100 : spread >= 150 ? 90 : spread <= 100 ? 70 : 50;
    if (hues.length > 2 && spread > 100) harmony = 40;
  }

  const fresh = Math.round(list.reduce((s, i) => s + 100 / (1 + (counts[i.id] || 0)), 0) / list.length);
  const parts = [harmony, fresh, ...(fit === null ? [] : [fit])];
  return { fit, harmony, fresh, overall: Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) };
}
