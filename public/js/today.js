// The Today tab: Vesti, your stylist, hands you a few looks for the day from your own wardrobe,
// for the weather and what's on (an event you added in Plan, or what you tell her in "Dressing for…").
// Love or pass on a look and she learns; swap any piece; try it on the model; or wear it (logged in the Diary).
import { OCCASIONS, SLOT_LABEL, slotOf, wornSlot } from './data.js';
import { BANDS, toF } from './weather.js';
import { dailyLooks, learn, parseAsk, pinLooks, swapPiece, tuckFor } from './stylist.js';
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

const json = (c, k, d) => { try { return JSON.parse(c.store.get(k, '')) || d; } catch { return d; } };
const daysAgo = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

function build(c) {
  const { S } = c, b = brief(c), today = c.iso(new Date());
  const recent = new Set(S.wears.filter((w) => (Date.parse(today) - Date.parse(w.date)) / 864e5 < 3).flatMap((w) => w.itemIds)); // what she wore the last couple of days
  // pins and pieces she was shown lately wait their turn, so each day (and each "More looks") brings something new
  const shownAt = json(c, 'pinshown', {}), shown = Object.fromEntries(Object.entries(shownAt).map(([id, d]) => [id, daysAgo(today, d)]));
  for (const id of S.today.seenPins || []) shown[id] = 0;
  const seenAt = json(c, 'lookseen', {}), seenItems = new Set(Object.entries(seenAt).filter(([d]) => daysAgo(today, d) <= 2).flatMap(([, ids]) => ids));
  const opts = { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, rain: b.rain, prefs: prefsOf(c), recent, shown, seenItems, n: 3 };
  const fromPins = pinLooks(S.items, PINS, opts); // outfits from her Pinterest boards, made from her wardrobe
  const more = fromPins.length < 3 ? dailyLooks(S.items, { ...opts, n: 3 - fromPins.length, recent: new Set([...recent, ...fromPins.flatMap((o) => idsOf(o.look))]) }) : [];
  Object.assign(S.today, {
    looks: [...fromPins.map((o) => o.look), ...more], pins: [...fromPins.map((o) => o.pin), ...more.map(() => null)],
    tucks: [...fromPins.map((o) => o.tuck), ...more.map((o) => tuckFor(o))], missing: [...fromPins.map((o) => o.missing || []), ...more.map(() => [])], seenPins: [...new Set([...(S.today.seenPins || []), ...fromPins.map((o) => o.pin.id)])],
    date: today, band: b.band, key: lookKey(c),
  });
  for (const o of fromPins) shownAt[o.pin.id] = today;
  for (const [id, d] of Object.entries(shownAt)) if (daysAgo(today, d) > 30) delete shownAt[id];
  seenAt[today] = [...new Set([...(seenAt[today] || []), ...S.today.looks.flatMap(idsOf)])];
  for (const d of Object.keys(seenAt)) if (daysAgo(today, d) > 2) delete seenAt[d];
  c.store.set('pinshown', JSON.stringify(shownAt)); c.store.set('lookseen', JSON.stringify(seenAt));
  save(c);
}

/** What the looks were made for (the day and what she asked for): the same day and ask brings back the same looks, even after a reload. */
const lookKey = (c) => `${c.iso(new Date())}|${c.S.today.ask}|${c.S.today.occ}`;
function save(c) {
  const t = c.S.today;
  c.store.set('todaylooks', JSON.stringify({ key: t.key, band: t.band ?? null, looks: t.looks.map((o) => Object.fromEntries(Object.entries(o).map(([s, p]) => [s, p.id]))), pins: t.pins.map((p) => p?.id || ''), tucks: t.tucks, missing: t.missing || [], seenPins: t.seenPins }));
}
/** Today's looks as she last saw them (reopening the app shows the same ones at once, with nothing to work out). */
function restore(c) {
  const t = c.S.today, saved = json(c, 'todaylooks', null);
  if (!saved || saved.key !== lookKey(c)) return false;
  const byId = new Map(c.S.items.map((i) => [i.id, i])), pinById = new Map(PINS.map((p) => [p.id, p]));
  const looks = saved.looks.map((o) => Object.fromEntries(Object.entries(o).map(([s, id]) => [s, byId.get(id)])));
  if (!looks.length || looks.some((o) => Object.values(o).some((p) => !p))) return false; // (a piece was deleted since)
  Object.assign(t, { looks, pins: saved.pins.map((id) => pinById.get(id) || null), tucks: saved.tucks || [], missing: saved.missing || [], seenPins: saved.seenPins || [], date: c.iso(new Date()), band: saved.band ?? undefined, key: saved.key });
  return true;
}

export function renderToday(c) {
  const { S, esc, $ } = c;
  S.today ||= { looks: [], ask: '', occ: '', date: '', pins: [], tucks: [] };
  const waiting = S.loc && !S.forecast && !S.weatherError; // (her city is set but today's weather hasn't come yet: wait for it, briefly, rather than show looks that change under her)
  if (waiting && !S.forecastLoading) {
    S.forecastLoading = true;
    setTimeout(() => { S.forecastLoading = false; if (S.view === 'today' && !S.forecast) { S.weatherError ||= 'slow'; renderToday(c); } }, 4000);
    loadForecast(c).then(() => { S.forecastLoading = false; if (S.view === 'today') renderToday(c); });
  }
  if (S.today.date !== c.iso(new Date()) || !S.today.looks.length) {
    if (!restore(c)) {
      if (waiting) { $('#main').innerHTML = '<div class="today"><p class="muted t-wait" role="status">Picking today’s looks…</p></div>'; return; }
      build(c);
    }
  }
  const b = brief(c), t = S.today;
  const wx = b.f ? `<span class="chip on" aria-label="Today: ${toF(b.f.hiC)} degrees, ${BANDS[b.f.band].label}${b.f.rain >= 40 ? `, ${b.f.rain}% chance of rain` : ''}">${toF(b.f.hiC)}° · ${BANDS[b.f.band].label}${b.f.rain >= 40 ? ` · ${b.f.rain}% rain` : ''}</span>`
    : `<button class="chip" data-act="todaywx">Add your city</button>`;
  const looks = t.looks.map((o, i) => lookCard(c, o, i)).join('');
  $('#main').innerHTML = `<div class="today">
    <section class="t-hero"><p class="muted">${new Date().toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h2 class="view-title">Today</h2>
      <div class="chips">${wx}${b.event ? `<span class="chip">${esc(b.event.title || b.event.occasion)}</span>` : ''}</div>${S.importing ? `<p class="muted findcount" id="impstat">Adding your wardrobe: ${S.importing.done.toLocaleString()} of ${S.importing.total.toLocaleString()} pieces…</p>` : ''}</section>
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
  const ids = pieces.map(([, p]) => p.id), names = pieces.map(([, p]) => p.name).join(', '), pin = c.S.today.pins?.[i], board = pin?.board, tuck = c.S.today.tucks?.[i];
  const tk = o.top && o.bottom && typeof tuck === 'boolean' ? (tuck ? '1' : '0') : '';
  return `<article class="panel t-look" aria-label="Look ${i + 1}: ${esc(names)}">
    ${board ? `<p class="t-src muted">From your Pinterest · ${esc(BOARD_NAMES[board] || board.replace(/-/g, ' '))} · <a href="https://www.pinterest.com/pin/${encodeURIComponent(pin.id)}/" target="_blank" rel="noopener">See the pin</a></p>
      <p class="t-recipe muted"><small>The pin: ${esc(pin.pieces.map((x) => x.name.toLowerCase()).join(', ').replace(/^./, (m) => m.toUpperCase()))}</small>${c.S.today.missing?.[i]?.length ? `<br><small class="t-gap">Not in your wardrobe yet: ${esc(c.S.today.missing[i].map((m) => m.toLowerCase()).join(', '))}</small>` : ''}</p>` : ''}
    <div class="t-fig" aria-hidden="true" data-fig="${esc(ids.join(','))}"${tk ? ` data-tuck="${tk}"` : ''}>${figure(ids, 'mini', tk ? { tuck: tk === '1' } : {}) || ''}</div>
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
/** Trying on or wearing a look tucks its top in (or not) on the model just as the look showed it. */
const tuckAsLook = async (c, el) => { const o = look(c, el), t = c.S.today.tucks?.[Number(el.dataset.i)]; if (o.top && o.bottom && typeof t === 'boolean') await c.setTuck?.(o.top, t); };

export const todayActs = {
  todayask(c) { const q = c.$('#askq'); c.S.today.ask = q ? q.value.trim() : ''; c.S.today.occ = ''; build(c); renderToday(c); },
  todayocc(c, el) { const t = c.S.today; t.occ = t.occ === el.dataset.v ? '' : el.dataset.v; t.ask = ''; build(c); renderToday(c); },
  todaymore(c) { build(c); renderToday(c); },
  todayswap(c, el) {
    const b = brief(c), i = Number(el.dataset.i), t = c.S.today;
    t.looks[i] = swapPiece(c.S.items, t.looks[i], el.dataset.v, { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, prefs: prefsOf(c) });
    if (['top', 'bottom'].includes(el.dataset.v)) (t.tucks ||= [])[i] = tuckFor(t.looks[i]); // (a new top or bottom: tucked in or not as suits it)
    save(c); renderToday(c);
  },
  todaydrop(c, el) { const o = { ...look(c, el) }; delete o[el.dataset.v]; c.S.today.looks[Number(el.dataset.i)] = o; save(c); renderToday(c); },
  todayadd(c, el) { const b = brief(c), i = Number(el.dataset.i); c.S.today.looks[i] = swapPiece(c.S.items, c.S.today.looks[i], el.dataset.v, { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, prefs: prefsOf(c) }); save(c); renderToday(c); },
  todaylove(c, el) { savePrefs(c, learn(prefsOf(c), idsOf(look(c, el)), true)); c.toast('Saved to your likes'); },
  todaynope(c, el) {
    const i = Number(el.dataset.i), b = brief(c);
    savePrefs(c, learn(prefsOf(c), idsOf(look(c, el)), false));
    const t = c.S.today, others = new Set(t.looks.flatMap(idsOf)), seen = (t.seenPins ||= []);
    const today = c.iso(new Date()), shown = Object.fromEntries(Object.entries(json(c, 'pinshown', {})).map(([id, d]) => [id, daysAgo(today, d)]));
    const opts = { occasion: b.occasion, wearCounts: c.wearCounts(), band: b.band, rain: b.rain, prefs: prefsOf(c), recent: others, shown, n: 1 };
    const [p] = pinLooks(c.S.items, PINS.filter((x) => !seen.includes(x.id)), opts); // the next pin she hasn't seen today
    const fresh = p ? p.look : dailyLooks(c.S.items, opts)[0];
    t.pins ||= []; t.tucks ||= []; t.missing ||= [];
    if (p) seen.push(p.pin.id);
    if (fresh) { t.looks[i] = fresh; t.pins[i] = p ? p.pin : null; t.tucks[i] = p ? p.tuck : tuckFor(fresh); t.missing[i] = p ? p.missing || [] : []; } else { t.looks.splice(i, 1); t.pins.splice(i, 1); t.tucks.splice(i, 1); t.missing.splice(i, 1); }
    save(c); renderToday(c);
  },
  async todaytry(c, el) { const o = look(c, el); await tuckAsLook(c, el); c.S.outfit = Object.fromEntries(Object.values(o).map((p) => [wornSlot(p), p.id])); c.S.pop = true; c.go('tryon'); },
  async todaywear(c, el) {
    const o = look(c, el), ids = idsOf(o);
    await tuckAsLook(c, el);
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
