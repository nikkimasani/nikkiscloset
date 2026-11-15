// The Today tab: Vesti, your stylist, hands you a few looks for the day from your own wardrobe,
// for the weather and what's on (an event you added in Plan, or what you tell her in "Dressing for…").
// Love or pass on a look and she learns; swap any piece; try it on the model; or wear it (logged in the Diary).
import { OCCASIONS, OCCASION_EMOJI, SLOT_LABEL, wornSlot } from './data.js';
import { BANDS, toF, weatherEmoji } from './weather.js';
import { dailyLooks, learn, parseAsk, swapPiece } from './stylist.js';
import { todayWeather, loadForecast } from './plan.js';

const ORDER = ['outer', 'top', 'dress', 'bottom', 'shoes', 'bag'];
export const prefsOf = (c) => { try { return JSON.parse(c.store.get('styleprefs', '{}')); } catch { return {}; } };
const savePrefs = (c, p) => c.store.set('styleprefs', JSON.stringify(p));

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

/** What today is about: what she typed, else today's event from Plan, else nothing in particular. */
function brief(c) {
  const { S } = c, t = S.today, today = c.iso(new Date());
  const event = (S.events || []).find((e) => e.date === today);
  const wx = todayWeather(c), f = S.forecast?.find((d) => d.date === today);
  const ask = t.ask ? parseAsk(t.ask) : null;
  return {
    occasion: t.occ || ask?.occasion || event?.occasion || '',
    band: ask?.band || wx.band, rain: ask?.rain || wx.rain || 0, event, f,
  };
}

function build(c) {
  const { S } = c, b = brief(c), today = c.iso(new Date());
  const recent = new Set(S.wears.filter((w) => (Date.parse(today) - Date.parse(w.date)) / 864e5 < 3).flatMap((w) => w.itemIds)); // what she wore the last couple of days
  S.today.looks = dailyLooks(S.items, { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, rain: b.rain, prefs: prefsOf(c), recent, n: 3 });
  S.today.date = today;
}

export function renderToday(c) {
  const { S, esc, $ } = c;
  S.today ||= { looks: [], ask: '', occ: '', date: '' };
  if (S.today.date !== c.iso(new Date()) || !S.today.looks.length) build(c);
  const b = brief(c), t = S.today;
  if (S.loc && !S.forecast && !S.weatherError && !S.forecastLoading) {
    S.forecastLoading = true;
    loadForecast(c).then(() => { S.forecastLoading = false; if (S.view === 'today') { build(c); renderToday(c); } });
  }
  const wx = b.f ? `<span class="chip on" aria-label="Today: ${toF(b.f.hiC)} degrees, ${BANDS[b.f.band].label}${b.f.rain >= 40 ? `, ${b.f.rain}% chance of rain` : ''}"><span aria-hidden="true">${weatherEmoji(b.f.code)}</span> ${toF(b.f.hiC)}° · ${BANDS[b.f.band].label}${b.f.rain >= 40 ? ` · 💧${b.f.rain}%` : ''}</span>`
    : `<button class="chip" data-act="todaywx"><span aria-hidden="true">📍</span> Add your city for weather-smart looks</button>`;
  const why = [b.occasion && `${OCCASION_EMOJI[b.occasion] || ''} ${b.occasion}`, b.event?.title && `for ${esc(b.event.title)}`].filter(Boolean).join(' ');
  const looks = t.looks.map((o, i) => lookCard(c, o, i)).join('');
  $('#main').innerHTML = `<div class="today">
    <section class="t-hero"><p class="muted">${new Date().toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h2 class="view-title">${greeting()} ✨</h2>
      <p class="t-lede">${S.items.length ? `Here’s what I’d wear today${why ? ` — ${why}` : ''}.` : 'Add a few pieces to your wardrobe and I’ll style you every day.'}</p>
      <div class="chips">${wx}${b.event ? `<span class="chip"><span aria-hidden="true">📌</span> ${esc(b.event.title || b.event.occasion)}</span>` : ''}</div></section>
    <section class="panel t-ask" aria-label="Ask your stylist"><label class="f" for="askq">What are you dressing for?</label>
      <div class="row"><input type="text" id="askq" class="grow" maxlength="80" placeholder="e.g. brunch with the girls, it’s hot" value="${esc(t.ask)}" enterkeyhint="go"><button class="primary" data-act="todayask">Style me</button></div>
      <div class="chips t-occ" role="group" aria-label="Or pick an occasion">${OCCASIONS.map((o) => `<button class="chip ${b.occasion === o ? 'on' : ''}" aria-pressed="${b.occasion === o}" data-act="todayocc" data-v="${esc(o)}"><span aria-hidden="true">${OCCASION_EMOJI[o]}</span> ${esc(o)}</button>`).join('')}</div></section>
    ${looks ? `<div class="t-looks">${looks}</div>` : S.items.length ? `<p class="muted">I couldn’t put a full look together yet — add a top and a bottom, or a dress.</p>` : `<button class="primary" data-act="add"><span aria-hidden="true">＋</span> Add your first piece</button>`}
    ${looks ? '<div class="row t-more"><button class="ghost" data-act="todaymore"><span aria-hidden="true">🔄</span> Show me different looks</button></div>' : ''}
    <section class="panel t-next" aria-label="Planning ahead"><h3>Planning ahead</h3>
      <div class="row"><button class="ghost" data-act="todayplan" data-v="week"><span aria-hidden="true">🗓️</span> My week</button><button class="ghost" data-act="todayplan" data-v="pack"><span aria-hidden="true">🧳</span> Pack for a trip</button><button class="ghost" data-act="todayplan" data-v="event"><span aria-hidden="true">📌</span> Add an event</button></div></section>
  </div>`;
  $('#askq')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); todayActs.todayask(c); } });
}

function lookCard(c, o, i) {
  const { esc, url, figure } = c, pieces = ORDER.filter((s) => o[s]).map((s) => [s, o[s]]);
  const ids = pieces.map(([, p]) => p.id), names = pieces.map(([, p]) => p.name).join(', ');
  return `<article class="panel t-look" aria-label="Look ${i + 1}: ${esc(names)}">
    <div class="t-fig" aria-hidden="true">${figure(ids, 'mini') || ''}</div>
    <div class="t-pieces">${pieces.map(([s, p]) => `<div class="t-piece"><img src="${url(p.id)}" alt="" loading="lazy"><span class="grow"><small class="muted">${esc(SLOT_LABEL[s] || s)}</small><br>${esc(p.name)}</span>
      <button class="ghost t-swap" data-act="todayswap" data-i="${i}" data-v="${s}" aria-label="Swap the ${esc(p.name)}"><span aria-hidden="true">⟳</span></button></div>`).join('')}</div>
    <div class="row t-acts"><button class="primary" data-act="todaywear" data-i="${i}">Wear this today</button><button class="ghost" data-act="todaytry" data-i="${i}">Try it on</button>
      <button class="ghost" data-act="todaylove" data-i="${i}" aria-label="Love this look"><span aria-hidden="true">♥</span></button><button class="ghost" data-act="todaynope" data-i="${i}" aria-label="Not for me — show another"><span aria-hidden="true">✕</span></button></div>
  </article>`;
}

const idsOf = (o) => Object.values(o).map((p) => p.id);
const look = (c, el) => c.S.today.looks[Number(el.dataset.i)];

export const todayActs = {
  todayask(c) { const q = c.$('#askq'); c.S.today.ask = q ? q.value.trim() : ''; c.S.today.occ = ''; build(c); renderToday(c); },
  todayocc(c, el) { const t = c.S.today; t.occ = t.occ === el.dataset.v ? '' : el.dataset.v; t.ask = ''; build(c); renderToday(c); },
  todaymore(c) { build(c); renderToday(c); },
  todayswap(c, el) {
    const b = brief(c), i = Number(el.dataset.i);
    c.S.today.looks[i] = swapPiece(c.S.items, c.S.today.looks[i], el.dataset.v, { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, prefs: prefsOf(c) });
    renderToday(c);
  },
  todaylove(c, el) { savePrefs(c, learn(prefsOf(c), idsOf(look(c, el)), true)); c.toast('Noted — I’ll style you like this more ♥'); },
  todaynope(c, el) {
    const i = Number(el.dataset.i), b = brief(c);
    savePrefs(c, learn(prefsOf(c), idsOf(look(c, el)), false));
    const others = new Set(c.S.today.looks.flatMap(idsOf));
    const [fresh] = dailyLooks(c.S.items, { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, rain: b.rain, prefs: prefsOf(c), recent: others, n: 1 });
    if (fresh) c.S.today.looks[i] = fresh; else c.S.today.looks.splice(i, 1);
    renderToday(c); c.toast('Got it — here’s another');
  },
  todaytry(c, el) { const o = look(c, el); c.S.outfit = Object.fromEntries(Object.values(o).map((p) => [wornSlot(p), p.id])); c.S.pop = true; c.go('tryon'); },
  async todaywear(c, el) {
    const o = look(c, el), ids = idsOf(o);
    await c.wearIds(c.iso(new Date()), ids); savePrefs(c, learn(prefsOf(c), ids, true));
    c.S.outfit = Object.fromEntries(Object.values(o).map((p) => [wornSlot(p), p.id]));
    c.toast('Logged in your Diary ✓ Have a great day!');
  },
  todaywx(c) { c.S.planTab = 'week'; c.go('plan'); setTimeout(() => c.$('#locq')?.focus(), 50); },
  todayplan(c, el) {
    const v = el.dataset.v; c.S.planTab = 'week'; c.go('plan');
    const sel = { week: '[aria-label="This week"]', pack: '#packdays', event: '#evtitle' }[v];
    setTimeout(() => { const n = c.$(sel); n?.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (n?.focus && v !== 'week') n.focus({ preventScroll: true }); }, 50);
  },
};
