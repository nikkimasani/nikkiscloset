// Weather via Open-Meteo (free, no key). Used to nudge outfit suggestions and plan the week.
export const BANDS = {
  cold: { label: 'Cold', emoji: '🥶', hint: 'Layer up' },
  cool: { label: 'Cool', emoji: '🧥', hint: 'A light layer' },
  mild: { label: 'Mild', emoji: '🙂', hint: 'Easy weather' },
  warm: { label: 'Warm', emoji: '😎', hint: 'Light fabrics' },
  hot: { label: 'Hot', emoji: '🥵', hint: 'Keep it breezy' },
};

/** Temperature (°C, daytime high) -> comfort band. */
export const bandFor = (hiC) => (hiC < 8 ? 'cold' : hiC < 16 ? 'cool' : hiC < 23 ? 'mild' : hiC < 29 ? 'warm' : 'hot');

export function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '❄️';
  return '⛈️';
}

/** Turn Open-Meteo's daily arrays into [{date, hiC, loC, rain, code, band}]. */
export function parseForecast(json) {
  const d = json?.daily;
  if (!d?.time) throw new Error('Weather service returned something unexpected.');
  return d.time.map((date, i) => ({
    date, hiC: d.temperature_2m_max[i], loC: d.temperature_2m_min[i], rain: d.precipitation_probability_max?.[i] ?? 0,
    code: d.weathercode?.[i] ?? 0, band: bandFor(d.temperature_2m_max[i]),
  }));
}

export async function fetchForecast({ lat, lon }, fetchImpl = fetch) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto&forecast_days=7`;
  const r = await fetchImpl(u);
  if (!r.ok) throw new Error('Could not load the forecast.');
  return parseForecast(await r.json());
}

export async function geocode(name, fetchImpl = fetch) {
  const r = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);
  if (!r.ok) throw new Error('Could not look that place up.');
  const hit = (await r.json()).results?.[0];
  if (!hit) throw new Error(`No place called “${name}”.`);
  return { lat: hit.latitude, lon: hit.longitude, name: [hit.name, hit.admin1].filter(Boolean).join(', ') };
}

export const toF = (c) => Math.round((c * 9) / 5 + 32);
