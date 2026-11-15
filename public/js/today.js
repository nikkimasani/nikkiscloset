// The Today tab: Vesti, your stylist, hands you a few looks for the day from your own wardrobe,
// for the weather and what's on (an event you added in Plan, or what you tell her in "Dressing for…").
// Love or pass on a look and she learns; swap any piece; try it on the model; or wear it (logged in the Diary).
import { OCCASIONS, SLOT_LABEL, slotOf, wornSlot } from './data.js';
import { BANDS, toF } from './weather.js';
import { dailyLooks, learn, parseAsk, pinLooks, swapPiece } from './stylist.js';
import { PINS } from './pins.js';
import { todayWeather, loadForecast } from './plan.js';

const ORDER = ['outer', 'top', 'dress', 'bottom', 'shoes', 'bag'];
export const prefsOf = (c) => { try { return JSON.parse(c.store.get('styleprefs', '{}')); } catch { return {}; } };
const savePrefs = (c, p) => c.store.set('styleprefs', JSON.stringify(p));


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
  const opts = { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, rain: b.rain, prefs: prefsOf(c), recent, n: 3 };
  const fromPins = pinLooks(S.items, PINS, opts); // outfits from her Pinterest boards, made from her wardrobe
  const more = fromPins.length < 3 ? dailyLooks(S.items, { ...opts, n: 3 - fromPins.length, recent: new Set([...recent, ...fromPins.flatMap((o) => idsOf(o.look))]) }) : [];
  S.today.looks = [...fromPins.map((o) => o.look), ...more];
  S.today.pins = [...fromPins.map((o) => o.pin.board), ...more.map(() => '')];
  S.today.seenPins = fromPins.map((o) => o.pin.id);
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
  const wx = b.f ? `<span class="chip on" aria-label="Today: ${toF(b.f.hiC)} degrees, ${BANDS[b.f.band].label}${b.f.rain >= 40 ? `, ${b.f.rain}% chance of rain` : ''}">${toF(b.f.hiC)}° · ${BANDS[b.f.band].label}${b.f.rain >= 40 ? ` · ${b.f.rain}% rain` : ''}</span>`
    : `<button class="chip" data-act="todaywx">Add your city</button>`;
  const looks = t.looks.map((o, i) => lookCard(c, o, i)).join('');
  $('#main').innerHTML = `<div class="today">
    <section class="t-hero"><p class="muted">${new Date().toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h2 class="view-title">Today</h2>
      <div class="chips">${wx}${b.event ? `<span class="chip">${esc(b.event.title || b.event.occasion)}</span>` : ''}</div></section>
    <section class="panel t-ask" aria-label="Ask your stylist"><label class="f" for="askq">What are you dressing for?</label>
      <div class="row"><input type="text" id="askq" class="grow" maxlength="80" placeholder="e.g. brunch with the girls, it’s hot" value="${esc(t.ask)}" enterkeyhint="go"><button class="primary" data-act="todayask">Style me</button></div>
      <div class="chips t-occ" role="group" aria-label="Or pick an occasion">${OCCASIONS.map((o) => `<button class="chip ${b.occasion === o ? 'on' : ''}" aria-pressed="${b.occasion === o}" data-act="todayocc" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></section>
    ${looks ? `<div class="t-looks">${looks}</div>` : S.items.length ? `<p class="muted">Not enough pieces for a full look yet. Add a top and a bottom, or a dress.</p>` : `<button class="primary" data-act="add">Add your first piece</button>`}
    ${looks ? '<div class="row t-more"><button class="ghost" data-act="todaymore">More looks</button></div>' : ''}
    <section class="panel t-next" aria-label="Planning ahead"><h3>Planning ahead</h3>
      <div class="row"><button class="ghost" data-act="todayplan" data-v="week">My week</button><button class="ghost" data-act="todayplan" data-v="pack">Pack for a trip</button><button class="ghost" data-act="todayplan" data-v="event">Add an event</button></div></section>
  </div>`;
  $('#askq')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); todayActs.todayask(c); } });
}

function lookCard(c, o, i) {
  const { esc, url, figure } = c, pieces = ORDER.filter((s) => o[s]).map((s) => [s, o[s]]);
  const ids = pieces.map(([, p]) => p.id), names = pieces.map(([, p]) => p.name).join(', '), board = c.S.today.pins?.[i];
  return `<article class="panel t-look" aria-label="Look ${i + 1}: ${esc(names)}">
    ${board ? `<p class="t-src muted">From your Pinterest · ${esc(BOARD_NAMES[board] || board.replace(/-/g, ' '))}</p>` : ''}
    <div class="t-fig" aria-hidden="true">${figure(ids, 'mini') || ''}</div>
    <div class="t-pieces">${pieces.map(([s, p]) => `<div class="t-piece"><img src="${url(p.id)}" alt="" loading="lazy"><span class="grow"><small class="muted">${esc(SLOT_LABEL[s] || s)}</small><br>${esc(p.name)}</span>
      <span class="t-btns"><button class="ghost t-swap" data-act="todayswap" data-i="${i}" data-v="${s}" aria-label="Swap the ${esc(p.name)}"><span aria-hidden="true">⟳</span></button>${DROPPABLE.includes(s) ? `<button class="ghost t-swap" data-act="todaydrop" data-i="${i}" data-v="${s}" aria-label="Remove the ${esc(p.name)}"><span aria-hidden="true">✕</span></button>` : ''}</span></div>`).join('')}</div>
    ${((adds) => adds ? `<div class="row t-adds">${adds}</div>` : '')(ADDABLE.filter((s) => !o[s] && c.S.items.some((it) => slotOf(it.type) === s)).map((s) => `<button class="ghost t-add" data-act="todayadd" data-i="${i}" data-v="${s}">Add ${ADD_LABEL[s]}</button>`).join(''))}
    <div class="row t-acts"><button class="primary" data-act="todaywear" data-i="${i}">Wear this today</button><button class="ghost" data-act="todaytry" data-i="${i}">Try it on</button>
      <button class="ghost" data-act="todaylove" data-i="${i}" aria-label="Love this look"><span aria-hidden="true">♥</span></button><button class="ghost" data-act="todaynope" data-i="${i}" aria-label="Not for me — show another"><span aria-hidden="true">✕</span></button></div>
  </article>`;
}

const idsOf = (o) => Object.values(o).map((p) => p.id);
const DROPPABLE = ['outer', 'bag', 'shoes'], ADDABLE = ['outer', 'shoes', 'bag'], ADD_LABEL = { outer: 'a jacket', shoes: 'shoes', bag: 'a bag' }; // (a top, bottom or dress can only be swapped)
const BOARD_NAMES = { statement: 'Statement', outfits: 'Outfits', 'stylish-corporate-outfit': 'Stylish corporate outfit' };
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
  todaydrop(c, el) { const o = { ...look(c, el) }; delete o[el.dataset.v]; c.S.today.looks[Number(el.dataset.i)] = o; renderToday(c); },
  todayadd(c, el) { const b = brief(c), i = Number(el.dataset.i); c.S.today.looks[i] = swapPiece(c.S.items, c.S.today.looks[i], el.dataset.v, { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, prefs: prefsOf(c) }); renderToday(c); },
  todaylove(c, el) { savePrefs(c, learn(prefsOf(c), idsOf(look(c, el)), true)); c.toast('Saved to your likes'); },
  todaynope(c, el) {
    const i = Number(el.dataset.i), b = brief(c);
    savePrefs(c, learn(prefsOf(c), idsOf(look(c, el)), false));
    const t = c.S.today, others = new Set(t.looks.flatMap(idsOf)), seen = (t.seenPins ||= []);
    const opts = { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, rain: b.rain, prefs: prefsOf(c), recent: others, n: 1 };
    const [p] = pinLooks(c.S.items, PINS.filter((x) => !seen.includes(x.id)), opts); // the next pin she hasn't seen today
    const fresh = p ? p.look : dailyLooks(c.S.items, opts)[0];
    t.pins ||= [];
    if (p) seen.push(p.pin.id);
    if (fresh) { t.looks[i] = fresh; t.pins[i] = p ? p.pin.board : ''; } else { t.looks.splice(i, 1); t.pins.splice(i, 1); }
    renderToday(c);
  },
  todaytry(c, el) { const o = look(c, el); c.S.outfit = Object.fromEntries(Object.values(o).map((p) => [wornSlot(p), p.id])); c.S.pop = true; c.go('tryon'); },
  async todaywear(c, el) {
    const o = look(c, el), ids = idsOf(o);
    await c.wearIds(c.iso(new Date()), ids); savePrefs(c, learn(prefsOf(c), ids, true));
    c.S.outfit = Object.fromEntries(Object.values(o).map((p) => [wornSlot(p), p.id]));
    c.toast('Logged in your Diary');
  },
  todaywx(c) { c.S.planTab = 'week'; c.go('plan'); setTimeout(() => c.$('#locq')?.focus(), 50); },
  todayplan(c, el) {
    const v = el.dataset.v; c.S.planTab = 'week'; c.go('plan');
    const sel = { week: '[aria-label="This week"]', pack: '#packdays', event: '#evtitle' }[v];
    setTimeout(() => { const n = c.$(sel); n?.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (n?.focus && v !== 'week') n.focus({ preventScroll: true }); }, 50);
  },
};
