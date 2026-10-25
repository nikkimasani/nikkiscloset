// The Plan tab: weather, a 7-day outfit plan, packing lists, wardrobe gaps and a wishlist.
// Rendering + click handlers live here; app.js passes in a small context object (state, helpers, navigation).
import { OCCASIONS, OCCASION_EMOJI, TYPES, SLOT_LABEL, slotOf } from './data.js';
import { BANDS, bandFor, fetchForecast, geocode, toF, weatherEmoji } from './weather.js';
import { gapAnalysis } from './insights.js';
import { packingList, planWeek } from './planner.js';
import { styleMe } from './stylist.js';

const PLURAL = { dress: 'Dresses', top: 'Tops', bottom: 'Bottoms', outer: 'Outerwear', shoes: 'Shoes', bag: 'Bags' };
const SLOT_TO_TYPE = { top: 'tops', bottom: 'bottoms', dress: 'dresses', outer: 'outerwear', shoes: 'shoes', bag: 'bags' };
const day = (iso) => new Date(iso + 'T12:00:00');
const dayName = (iso, long) => day(iso).toLocaleDateString('default', { weekday: long ? 'long' : 'short', ...(long ? { month: 'short', day: 'numeric' } : {}) });

/** Next 7 days: from the forecast if we have one, else just dates (mild weather assumed). */
export function weekDays(c) {
  if (c.S.forecast?.length) return c.S.forecast.map((f) => ({ date: f.date, band: f.band, rain: f.rain, hiC: f.hiC, loC: f.loC, code: f.code }));
  return Array.from({ length: 7 }, (_, n) => { const d = new Date(); d.setDate(d.getDate() + n); return { date: c.iso(d), band: 'mild', rain: 0 }; });
}

export async function loadForecast(c, force = false) {
  const { S } = c;
  if (!S.loc) return;
  try {
    const cached = JSON.parse(sessionStorage.getItem('forecast') || 'null');
    if (!force && cached && cached.key === `${S.loc.lat},${S.loc.lon}` && Date.now() - cached.at < 3_600_000) { S.forecast = cached.days; return; }
  } catch { /* no cache */ }
  try {
    S.forecast = await fetchForecast(S.loc); S.weatherError = '';
    try { sessionStorage.setItem('forecast', JSON.stringify({ key: `${S.loc.lat},${S.loc.lon}`, at: Date.now(), days: S.forecast })); } catch { /* private mode */ }
  } catch (e) { S.weatherError = e.message; }
}

/** Today's weather in the shape Style me expects, or {} when we don't know. */
export const todayWeather = (c) => { const f = c.S.forecast?.find((d) => d.date === c.iso(new Date())); return f ? { band: f.band, rain: f.rain } : {}; };

/* ───────────────────────── render ───────────────────────── */
export function renderPlan(c) {
  const { S, esc, $ } = c;
  $('#main').innerHTML = `<h2 class="view-title sr-only">Plan</h2><div class="plan">${weatherCard(c)}${weekCard(c)}${packCard(c)}${gapsCard(c)}${wishCard(c)}</div>`;
  if (S.loc && !S.forecast && !S.weatherError && !S.forecastLoading) {
    S.forecastLoading = true;
    loadForecast(c).then(() => { S.forecastLoading = false; if (S.view === 'plan') renderPlan(c); });
  }
  void esc;
}

function weatherCard(c) {
  const { S, esc } = c;
  const strip = S.forecast?.length ? `<div class="wx-strip" tabindex="0" role="region" aria-label="7-day forecast, scrolls sideways"><div class="wx-inner" role="list">${S.forecast.map((f) => `<div class="wx-day" role="listitem" aria-label="${dayName(f.date, true)}: ${toF(f.hiC)} degrees, ${BANDS[f.band].label}${f.rain >= 40 ? `, ${f.rain}% chance of rain` : ''}">
      <b>${dayName(f.date)}</b><span class="wx-ic" aria-hidden="true">${weatherEmoji(f.code)}</span><span>${toF(f.hiC)}°<small>/${toF(f.loC)}°</small></span><small>${BANDS[f.band].label}${f.rain >= 40 ? ` · 💧${f.rain}%` : ''}</small></div>`).join('')}</div></div>` : '';
  return `<section class="panel" aria-label="Weather"><h3>🌤 Weather</h3>
    <p class="muted">Tell me where you are and Style me, the week plan and packing lists will dress for the weather. Forecast comes from Open-Meteo (free, no account).</p>
    <div class="row"><label class="sr-only" for="locq">City</label><input type="text" id="locq" class="grow" placeholder="City, e.g. Houston" value="${esc(S.loc?.name || '')}" autocomplete="address-level2">
      <button class="ghost" data-act="wxcity">Set city</button><button class="ghost" data-act="wxgeo"><span aria-hidden="true">📍</span> Use my location</button></div>
    ${S.weatherError ? `<div class="gap" role="alert">${esc(S.weatherError)}</div>` : ''}
    ${S.loc && !S.forecast && !S.weatherError ? '<p class="muted" role="status">Loading the forecast…</p>' : ''}${strip}</section>`;
}

function weekCard(c) {
  const { S, esc, url, itemById } = c;
  const days = weekDays(c), plan = Object.fromEntries(S.plans.map((p) => [p.date, p]));
  const rows = days.map((d) => {
    const p = plan[d.date], items = (p?.itemIds || []).map(itemById).filter(Boolean);
    return `<div class="plan-day">
      <div class="plan-when"><b>${dayName(d.date, true)}</b><small>${d.hiC !== undefined ? `${weatherEmoji(d.code)} ${toF(d.hiC)}° · ${BANDS[d.band].label}` : 'no weather set'}</small></div>
      <div class="thumbs plan-items">${items.length ? items.map((i) => `<img src="${url(i.id)}" alt="${esc(i.name)}" title="${esc(i.name)}">`).join('') : '<span class="muted">Not planned</span>'}</div>
      ${items.length ? `<div class="plan-actions"><button class="ghost" data-act="planreroll" data-date="${d.date}" aria-label="Re-roll ${dayName(d.date, true)}">🎲</button><button class="ghost" data-act="plantry" data-date="${d.date}">Try on</button><button class="ghost" data-act="planwear" data-date="${d.date}">Wear</button></div>` : ''}
    </div>`;
  }).join('');
  return `<section class="panel" aria-label="This week"><h3>🗓 This week’s outfits</h3>
    <p class="muted">${S.mood ? `Planned for the mood “${esc(S.mood)}” (change it on Dress Up).` : 'Planned from your whole closet. Pick a mood on Dress Up to focus it.'} Pieces aren’t repeated if you have alternatives.</p>
    <button class="primary" data-act="planweek" ${S.items.length ? '' : 'disabled'}>✨ Plan my week</button>${S.plans.length ? ' <button class="ghost danger" data-act="planclear">Clear plan</button>' : ''}
    <div class="plan-list">${rows}</div></section>`;
}

function packCard(c) {
  const { S, esc, url } = c;
  const p = S.pack, r = p.result;
  const group = (slot, list) => list.length ? `<h4>${PLURAL[slot]} <small class="muted">(${list.length})</small></h4>${list.map((i) => `<label class="pack-item"><input type="checkbox" data-act="packcheck" data-id="${i.id}" ${p.checked.has(i.id) ? 'checked' : ''}><img src="${url(i.id)}" alt=""><span>${esc(i.name)}</span></label>`).join('')}` : '';
  return `<section class="panel" aria-label="Packing list"><h3>🧳 Pack for a trip</h3>
    <div class="row"><div><label class="f" for="packdays">Days</label><input type="number" id="packdays" min="1" max="30" value="${p.days}" style="width:90px"></div>
      <div class="grow"><label class="f" for="packband">Weather</label><select id="packband"><option value="auto" ${p.band === 'auto' ? 'selected' : ''}>${S.forecast?.length ? 'From my forecast' : 'Mild (set a city above for real weather)'}</option>${Object.entries(BANDS).map(([k, b]) => `<option value="${k}" ${p.band === k ? 'selected' : ''}>${b.emoji} ${b.label}</option>`).join('')}</select></div></div>
    <p class="muted" id="packmoodl" style="margin:10px 0 4px">What will you be doing? (optional)</p>
    <div class="chips" role="group" aria-labelledby="packmoodl">${OCCASIONS.map((o) => `<button class="chip ${p.moods.includes(o) ? 'on' : ''}" aria-pressed="${p.moods.includes(o)}" data-act="packmood" data-v="${esc(o)}"><span aria-hidden="true">${OCCASION_EMOJI[o]}</span> ${o}</button>`).join('')}</div>
    <button class="primary" data-act="packbuild" style="margin-top:12px" ${S.items.length ? '' : 'disabled'}>Build my packing list</button>
    ${r ? `<div class="pack-result" aria-live="polite"><p><b>${r.outfits}</b> different outfit${r.outfits === 1 ? '' : 's'} from ${Object.values(r.list).flat().length} pieces.</p>
      ${r.missing.length ? `<div class="gap">You don’t have enough ${r.missing.map((m) => `${PLURAL[m.slot].toLowerCase()} (${m.found}/${m.wanted})`).join(', ')} for these conditions — pack what you have or add to your wishlist.</div>` : ''}
      ${['dress', 'top', 'bottom', 'outer', 'shoes', 'bag'].map((s) => group(s, r.list[s])).join('')}
      <button class="ghost" data-act="packcopy" style="margin-top:10px">Copy list</button></div>` : ''}</section>`;
}

function gapsCard(c) {
  const { S, esc } = c;
  const rows = gapAnalysis(S.items).filter((g) => g.missing.length && (g.total > 0 || S.items.length === 0));
  const typeFor = (m) => (m === 'a top' ? 'tops' : m === 'a bottom' ? 'bottoms' : m === 'shoes' ? 'shoes' : null);
  return `<section class="panel" aria-label="Wardrobe gaps"><h3>🔍 Wardrobe gaps</h3>
    ${S.items.length ? (rows.length ? '<p class="muted">Occasions where you can’t yet put together a full outfit from what you own:</p>' : '<p class="muted">Nice — every occasion you’ve tagged has a full outfit.</p>') : '<p class="muted">Add some pieces and tag their occasions to see what you’re missing.</p>'}
    ${rows.map((g) => `<div class="gap-row"><div><b><span aria-hidden="true">${OCCASION_EMOJI[g.occasion]}</span> ${g.occasion}</b><small class="muted"> — ${g.have.tops} top${g.have.tops === 1 ? '' : 's'} · ${g.have.bottoms} bottom${g.have.bottoms === 1 ? '' : 's'} · ${g.have.dresses} dress${g.have.dresses === 1 ? '' : 'es'} · ${g.have.outerwear} outer · ${g.have.shoes} shoes</small>
      <div>Missing ${g.missing.join(' and ')}${g.have.dresses ? '' : g.missing.some((m) => m !== 'shoes') ? ' (or a dress)' : ''}</div></div>
      <div class="chips">${g.missing.map(typeFor).filter(Boolean).map((t) => `<button class="chip" data-act="wishgapadd" data-type="${t}" data-occ="${esc(g.occasion)}">+ ${TYPES[t].label}</button>`).join('')}</div></div>`).join('')}</section>`;
}

function wishCard(c) {
  const { S, esc } = c;
  const safe = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  return `<section class="panel" aria-label="Wishlist"><h3>🛍️ Wishlist</h3>
    ${S.wishlist.length ? S.wishlist.map((w) => `<div class="logrow"><span class="dot" style="background:${esc(w.hex || '#888')}"></span><span class="grow"><b>${esc(TYPES[w.type]?.label || w.type)}</b>${w.note ? ` — ${esc(w.note)}` : ''}${w.occasion ? ` <small class="muted">for ${esc(w.occasion)}</small>` : ''}${w.budget ? ` <small class="muted">· up to $${esc(String(w.budget))}</small>` : ''}${safe(w.link) ? ` · <a href="${esc(safe(w.link))}" target="_blank" rel="noopener noreferrer">link</a>` : ''}</span>
      <button class="ghost" data-act="wishgot" data-id="${w.id}">Got it</button><button class="ghost danger" data-act="wishdel" data-id="${w.id}" aria-label="Remove from wishlist"><span aria-hidden="true">×</span></button></div>`).join('') : '<p class="muted">Nothing yet. Add what you’re hunting for, or tap “+” on a gap above or on an inspo match.</p>'}
    <details style="margin-top:10px"><summary>Add something</summary>
      <div class="row" style="margin-top:8px"><div><label class="f" for="wtype">Type</label><select id="wtype">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
        <div><label class="f" for="whex">Colour</label><input type="color" id="whex" value="#5ad1ff" style="width:60px;height:44px;padding:0;border:0;background:none"></div></div>
      <label class="f" for="wnote2">What are you looking for?</label><input type="text" id="wnote2" placeholder="e.g. sage-green linen shirt">
      <div class="row"><div class="grow"><label class="f" for="wbudget">Budget $ (optional)</label><input type="number" id="wbudget" min="0" step="1" inputmode="decimal"></div>
        <div class="grow"><label class="f" for="wlink">Link (optional)</label><input type="url" id="wlink" placeholder="https://…"></div></div>
      <button class="primary" data-act="wishadd" style="margin-top:10px">Add to wishlist</button></details></section>`;
}

/* ───────────────────────── actions ───────────────────────── */
const outfitFromIds = (c, ids) => Object.fromEntries(ids.map(c.itemById).filter(Boolean).map((i) => [slotOf(i.type), i.id]));

async function savePlan(c, date, outfit) {
  const rec = { id: date, date, itemIds: Object.values(outfit).map((i) => i.id), createdAt: Date.now() };
  await c.put('plans', rec);
  c.S.plans = c.S.plans.filter((p) => p.date !== date).concat(rec);
}

export const planActs = {
  async wxcity(c) {
    const q = c.$('#locq').value.trim();
    if (!q) return c.toast('Type a city first');
    try { c.S.loc = await geocode(q); c.store.set('loc', JSON.stringify(c.S.loc)); c.S.forecast = null; c.S.weatherError = ''; } catch (e) { c.S.weatherError = e.message; }
    renderPlan(c);
  },
  wxgeo(c) {
    if (!navigator.geolocation) return c.toast('This browser can’t share its location');
    navigator.geolocation.getCurrentPosition((pos) => {
      c.S.loc = { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3), name: 'My location' };
      c.store.set('loc', JSON.stringify(c.S.loc)); c.S.forecast = null; c.S.weatherError = ''; renderPlan(c);
    }, () => { c.S.weatherError = 'Couldn’t get your location — type a city instead.'; renderPlan(c); }, { timeout: 10_000 });
  },
  async planweek(c) {
    const days = weekDays(c), plan = planWeek(c.S.items, days, c.wearCounts(), c.S.mood);
    for (const p of plan) if (Object.keys(p.outfit).length) await savePlan(c, p.date, p.outfit);
    c.toast('Week planned ✨'); renderPlan(c);
  },
  async planreroll(c, el) {
    const d = weekDays(c).find((x) => x.date === el.dataset.date);
    const others = new Set(c.S.plans.filter((p) => p.date !== d.date).flatMap((p) => p.itemIds));
    const outfit = styleMe(c.S.items, c.S.mood, c.wearCounts(), { band: d.band, rain: d.rain, avoid: others });
    if (Object.keys(outfit).length) await savePlan(c, d.date, outfit);
    renderPlan(c);
  },
  async planclear(c) { for (const p of c.S.plans) await c.del('plans', p.id); c.S.plans = []; renderPlan(c); },
  plantry(c, el) { const p = c.S.plans.find((x) => x.date === el.dataset.date); c.S.outfit = outfitFromIds(c, p.itemIds); c.S.pop = true; c.go('tryon'); },
  async planwear(c, el) {
    const p = c.S.plans.find((x) => x.date === el.dataset.date);
    await c.wearIds(el.dataset.date, p.itemIds.filter(c.itemById));
    c.toast(`Logged for ${el.dataset.date} ✓`);
  },
  packmood(c, el) { const m = c.S.pack.moods, v = el.dataset.v; c.S.pack.moods = m.includes(v) ? m.filter((x) => x !== v) : [...m, v]; renderPlan(c); },
  packbuild(c) {
    const p = c.S.pack;
    p.days = Math.max(1, Math.min(30, parseInt(c.$('#packdays').value, 10) || 3)); p.band = c.$('#packband').value;
    const f = c.S.forecast?.slice(0, p.days);
    const band = p.band === 'auto' ? (f?.length ? bandFor(f.reduce((s, d) => s + d.hiC, 0) / f.length) : 'mild') : p.band;
    const rain = p.band === 'auto' && f?.length ? Math.max(...f.map((d) => d.rain)) : 0;
    p.result = packingList(c.S.items, { days: p.days, moods: p.moods, band, rain });
    p.checked = new Set(); renderPlan(c);
  },
  packcheck(c, el) { const s = c.S.pack.checked; el.checked ? s.add(el.dataset.id) : s.delete(el.dataset.id); },
  async packcopy(c) {
    const r = c.S.pack.result, lines = ['Packing list', ...['dress', 'top', 'bottom', 'outer', 'shoes', 'bag'].flatMap((s) => r.list[s].map((i) => `☐ ${i.name} (${SLOT_LABEL[s].toLowerCase()})`))];
    try { await navigator.clipboard.writeText(lines.join('\n')); c.toast('Packing list copied'); } catch { c.toast('Couldn’t copy — select the list instead'); }
  },
  async wishadd(c) {
    const note = c.$('#wnote2').value.trim(), link = c.$('#wlink').value.trim();
    if (!note) return c.toast('Say what you’re looking for');
    const w = { id: c.uid(), type: c.$('#wtype').value, hex: c.$('#whex').value, note, budget: parseFloat(c.$('#wbudget').value) || undefined, link: /^https?:\/\//i.test(link) ? link : '', createdAt: Date.now() };
    await c.put('wishlist', w); c.S.wishlist.push(w); c.toast('Added to your wishlist'); renderPlan(c);
  },
  async wishgapadd(c, el) {
    const w = { id: c.uid(), type: el.dataset.type, hex: '#888888', note: '', occasion: el.dataset.occ, createdAt: Date.now() };
    await c.put('wishlist', w); c.S.wishlist.push(w); c.toast('Added to your wishlist'); renderPlan(c);
  },
  async wishdel(c, el) { await c.del('wishlist', el.dataset.id); c.S.wishlist = c.S.wishlist.filter((w) => w.id !== el.dataset.id); renderPlan(c); },
  async wishgot(c, el) {
    const w = c.S.wishlist.find((x) => x.id === el.dataset.id);
    await c.del('wishlist', w.id); c.S.wishlist = c.S.wishlist.filter((x) => x.id !== w.id);
    c.openItemModal(null, { type: w.type, name: w.note || '', occasions: w.occasion ? [w.occasion] : [] });
  },
};

/** For the Inspo screen: turn a "you're missing…" result into a wishlist entry. */
export async function wishFromGap(c, slot, hex, occasion) {
  const w = { id: c.uid(), type: SLOT_TO_TYPE[slot] || 'tops', hex, note: 'like my inspo', occasion: occasion || '', createdAt: Date.now() };
  await c.put('wishlist', w); c.S.wishlist.push(w); c.toast('Added to your wishlist');
}
