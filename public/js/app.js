import { all, get, put, del, uid } from './db.js';
import { lookCard, shareOrDownload } from './sharecard.js';
import { OCCASIONS, OCCASION_EMOJI, SEASONS, TYPES, SLOTS, SLOT_LABEL, SKIN, HAIR, HAIR_STYLES, BODY_TYPES, EYES, LIPS, ROOMS, seasonRoom, slotOf, wear } from './data.js';
import { loadImage, toCanvas, removeBackground, canvasToBlob, trimTransparent } from './cutout.js';
import { palette, colorName } from './color.js';
import { mannequinSVG } from './mannequin.js';
import { matchInspo, styleMe } from './stylist.js';
import { SAMPLES, sampleBlob } from './sample.js';
import { DEFAULT_BODY, HANDLES, fromLandmarks, fromProportions } from './body.js';
import { detectPose } from './pose.js';
import { outfitMeters } from './meters.js';
import { closetInsights, streak as wearStreak } from './insights.js';
import { webglOK } from './webgl.js';
import { syncState, connect as syncConnect, disconnect as syncDisconnect, syncNow } from './sync.js';
import { renderPlan, planActs, todayWeather, loadForecast, wishFromGap } from './plan.js';
import { BANDS, toF, weatherEmoji } from './weather.js';
import { PRICE, aiSteps, aiSignature, personImage, garmentImage, renderOutfit, categoryFor, cutoutAI, tagAI, pinAI, productAI } from './aitryon.js';
import { browserCut } from './browsercut.js';
import { guessType, tidyTitle, firstLink, deepLink } from './intake.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null || v === '' ? d : v; } catch { return d; } } /* '' means "unset" */, set: (k, v) => { try { localStorage.setItem(k, v); if (PREFS.includes(k)) localStorage.setItem('prefs_u', String(Date.now())); } catch { /* private mode */ } } };

const S = {
  items: [], outfits: [], wears: [], inspos: [], profile: null, plans: [], wishlist: [],
  loc: (() => { try { return JSON.parse(store.get('loc', 'null')); } catch { return null; } })(), forecast: null, weatherError: '',
  pack: { days: 3, band: 'auto', moods: [], result: null, checked: new Set() },
  urls: new Map(),
  view: 'tryon', mood: '', drawer: 'fit', lastTab: '',
  scene: store.get('scene', 'closet'), rail: '', basket: [], cas: false, casTab: 'skin', hallX: null, // walk-in closet or mirror; which rail is open; pieces grabbed; customizer panel
  filter: { type: 'all', occ: 'all', q: '' },
  outfit: {},                       // slot -> item id (the outfit on the mannequin)
  tab: 'tops', adjust: null,        // try-on picker tab, item being fitted
  skin: store.get('skin', SKIN[2]), hair: store.get('hair', HAIR[1]), hairStyle: store.get('hairstyle', 'long'),
  eyes: store.get('eyes', EYES[0]), lips: store.get('lips', LIPS[0]), room: store.get('room', 'auto'),
  shape: (() => { try { return JSON.parse(store.get('shape', 'null')); } catch { return null; } })(), shapeName: store.get('shapename', ''),
  month: new Date(), date: iso(new Date()),
  inspo: null,                      // working inspo draft
  ai: null, aiError: '', aiBusy: false, aiAbort: null, // fal.ai render of the current outfit
};

const itemById = (id) => S.items.find((i) => i.id === id);
const url = (key, blob) => { if (!S.urls.has(key) && blob) S.urls.set(key, URL.createObjectURL(blob)); return S.urls.get(key); };
const wearCounts = () => S.wears.reduce((m, w) => (w.itemIds.forEach((id) => (m[id] = (m[id] || 0) + 1)), m), {});

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

let lastFocus;
let modalSeq = 0; // bumps whenever a dialog opens or closes, so slow AI replies can tell they've gone stale
function openModal() {
  modalSeq++;
  lastFocus = document.activeElement;
  $('#modal').hidden = false;
  document.querySelectorAll('header, main').forEach((e) => (e.inert = true));
}
function closeModal() {
  modalSeq++;
  $('#modal').hidden = true;
  document.querySelectorAll('header, main').forEach((e) => (e.inert = false));
  lastFocus?.isConnected && lastFocus.focus();
}
/** Paint a dialog sheet, keeping keyboard focus on the same control across re-renders. */
function paintSheet(html, title) {
  const m = $('#modal'), prev = document.activeElement?.id;
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mtitle"><h2 id="mtitle" tabindex="-1">${title}</h2>${html}</div>`;
  (prev && m.querySelector('#' + CSS.escape(prev)) || $('#mtitle', m)).focus();
}

async function load() {
  let profiles;
  [S.items, S.outfits, S.wears, S.inspos, profiles, S.plans, S.wishlist] = await Promise.all(['items', 'outfits', 'wears', 'inspos', 'profile', 'plans', 'wishlist'].map(all));
  S.profile = profiles[0] || null;
  if (S.profile?.photo) url('profile', S.profile.photo);
  S.items.sort((a, b) => a.createdAt - b.createdAt);
  S.items.forEach((i) => { url(i.id, i.cutout); if (i.backCutout) url(i.id + ':back', i.backCutout); });
  S.inspos.forEach((n) => url('inspo:' + n.id, n.photo));
}

/** slot -> item objects for a {slot: id} map or an id list. */
function outfitItems(src) {
  const ids = Array.isArray(src) ? src : Object.values(src);
  const out = {};
  ids.map(itemById).filter(Boolean).forEach((i) => (out[slotOf(i.type)] = i));
  return out;
}
const currentBody = () => (!usingPhoto() && S.shape ? fromProportions(S.shape) : S.profile ? { W: S.profile.W, H: S.profile.H, pts: S.profile.pts } : DEFAULT_BODY);
const usingPhoto = () => !!(S.profile?.photo && S.profile.display === 'photo');
const aiFor = (items) => { const st = aiSteps(items); return S.ai && usingPhoto() && st.length && S.ai.sig === aiSignature(st) ? st.map(([slot]) => slot) : null; };
function mannequin(src, cls = '') {
  const items = outfitItems(src), done = aiFor(items); // AI result replaces the photo; only un-rendered pieces are layered on
  const rest = done ? Object.fromEntries(Object.entries(items).filter(([slot]) => !done.includes(slot))) : items;
  return mannequinSVG({ body: currentBody(), photoUrl: done ? S.ai.image : usingPhoto() ? url('profile') : '', skin: S.skin, hair: S.hair, hairStyle: S.hairStyle, face: { eyes: S.eyes, lips: S.lips }, items: rest, urls: S.urls, cls,
    label: done ? `Your photo wearing ${Object.values(items).map((i) => i.name).join(', ')}` : '' });
}
const hanger = '<svg class="hang" aria-hidden="true" viewBox="0 0 44 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M22 2a4 4 0 1 1 3 6.5L22 10 3 16h38L22 10"/></svg>';

/* ───────────────────────── router ───────────────────────── */
function go(view) {
  if (view !== S.view) window.scrollTo(0, 0); // each screen starts at the top
  S.view = view;
  document.querySelectorAll('#nav button').forEach((b) => {
    const on = b.dataset.view === view; b.classList.toggle('on', on);
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  render();
  const h = $('#main h2.view-title'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}
function render() {
  if (S.view !== 'tryon') { S.lastView = S.view; stage3d.exitWorld(); }
  ({ closet: renderCloset, tryon: renderTryon, plan: () => renderPlan(ctx), planner: renderPlanner, inspo: renderInspo })[S.view]();
}

/* ───────────────────────── closet ───────────────────────── */
function renderCloset() {
  const { type, occ, q } = S.filter;
  const counts = Object.fromEntries(Object.keys(TYPES).map((t) => [t, S.items.filter((i) => i.type === t).length]));
  const shown = S.items.filter((i) =>
    (type === 'all' || i.type === type) && (occ === 'all' || i.occasions.includes(occ)) &&
    (!q || (i.name + ' ' + (i.brand || '') + ' ' + (i.color?.name || '')).toLowerCase().includes(q.toLowerCase())));

  const rails = Object.keys(TYPES).map((t) => {
    const list = shown.filter((i) => i.type === t);
    if (!list.length) return '';
    return `<section class="rail" aria-label="${TYPES[t].label}"><h3 class="rail-h"><span aria-hidden="true">${TYPES[t].emoji}</span> ${TYPES[t].label} <small>${list.length}</small></h3>
      <div class="rail-row">${list.map(pieceCard).join('')}</div></section>`;
  }).join('');

  $('#main').innerHTML = `
    <h2 class="view-title sr-only">Your closet</h2>
    <div class="row">
      <input type="search" id="q" class="grow" aria-label="Search your closet" placeholder="Search your closet…" value="${esc(q)}" style="max-width:300px">
      <select id="occ" aria-label="Filter by occasion" style="width:auto"><option value="all">All occasions</option>${OCCASIONS.map((o) => `<option ${o === occ ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <span class="muted">${S.items.length} pieces</span>
    </div>
    <div class="chips" style="margin-top:12px" role="group" aria-label="Filter by type">
      <button class="chip ${type === 'all' ? 'on' : ''}" aria-pressed="${type === 'all'}" data-act="ftype" data-v="all">All</button>
      ${Object.entries(TYPES).map(([k, v]) => `<button class="chip ${type === k ? 'on' : ''}" aria-pressed="${type === k}" data-act="ftype" data-v="${k}">${v.label} · ${counts[k]}</button>`).join('')}
    </div>
    ${rails || emptyCloset()}
    ${addPanel()}
    <section class="panel" aria-label="Backup and restore"><h3>Backup &amp; restore</h3>
      <p class="muted">Your closet is stored in this browser only. Save a backup file so clearing your browser or changing phones doesn’t lose it.</p>
      <div class="row"><button class="ghost" data-act="export">⬇ Save backup</button><button class="ghost" data-act="restore">⬆ Restore backup</button>
      ${S.items.some((i) => i.sample) ? '<button class="ghost danger" data-act="rmsamples">Remove sample pieces</button>' : ''}</div>
      <input type="file" id="restore" accept=".json,application/json" hidden></section>
    ${syncPanel()}`;
  const qEl = $('#q');
  qEl.oninput = () => { S.filter.q = qEl.value; const p = qEl.selectionStart; renderCloset(); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); };
  $('#occ').onchange = (e) => { S.filter.occ = e.target.value; renderCloset(); };
}

function emptyCloset() {
  if (S.items.length) return `<div class="empty"><h2>Nothing here</h2><p class="muted">No pieces match those filters.</p></div>`;
  return `<div class="empty"><h2 class="view-title">Your closet is empty ✨</h2>
    <p class="muted">Snap a photo of each piece (flat on a bed or hanging on a plain wall works best) and add it.</p>
    <div class="row" style="justify-content:center;margin-top:14px">
      <button class="primary" data-act="add">+ Add your first piece</button>
      <button class="ghost" data-act="samples">Load a sample closet to explore</button></div></div>`;
}

function pieceCard(i) {
  const worn = wearCounts()[i.id] || 0;
  return `<article class="piece">${hanger}
    <button class="edit" data-act="edit" data-id="${i.id}" aria-label="Edit ${esc(i.name)}"><span aria-hidden="true">✎</span></button>
    <button class="img" data-act="tryit" data-id="${i.id}" aria-label="Try on ${esc(i.name)}"><img src="${url(i.id)}" alt=""></button>
    <div class="name">${esc(i.name)}</div>
    <div class="meta"><span class="dot" style="background:${i.color?.hex}"></span>${esc(i.color?.name || '')} · worn ${worn}×</div>
    ${i.price > 0 ? `<div class="meta price">${worn ? `$${(i.price / worn).toFixed(2)}/wear` : `$${i.price.toFixed(2)} · not worn yet`}</div>` : ''}</article>`;
}

/* ───────────────────────── add / edit modal ───────────────────────── */
function openItemModal(existing, preset = {}) {
  const d = {
    id: existing?.id || uid(), name: existing?.name || '', type: existing?.type || 'tops',
    occasions: [...(existing?.occasions || [])], brand: existing?.brand || '', color: existing?.color || null,
    price: existing?.price ?? '', bought: existing?.bought || '', season: existing?.season || 'all', ...(existing ? {} : { ...(preset.type && { type: preset.type }), ...(preset.name && { name: preset.name }), ...(preset.occasions && { occasions: preset.occasions }) }),
    tolerance: 42, keep: false, canvas: null, source: null, cutout: existing?.cutout || null, sample: existing?.sample, backCanvas: null, backBlob: existing?.backCutout || null, backUrl: '', pending: preset.intake || null, palette: [], linkOpen: false, busy: '', colors: existing?.colors || [],
  };
  const seq0 = (openModal(), modalSeq);
  const paint = () => {
    paintSheet(`
      <div class="intake" role="group" aria-label="Where is the photo?">
        <button type="button" class="srcbtn" id="srccam"><span aria-hidden="true">📷</span> Take photo</button>
        <button type="button" class="srcbtn" id="srcpick"><span aria-hidden="true">🖼️</span> Choose photo</button>
        <button type="button" class="srcbtn" id="srcpaste"><span aria-hidden="true">📋</span> Paste</button>
        <button type="button" class="srcbtn ${d.linkOpen ? 'on' : ''}" id="srclink" aria-expanded="${d.linkOpen}"><span aria-hidden="true">🔗</span> From a link</button>
      </div>
      <input type="file" id="file" accept="image/*" hidden><input type="file" id="camfile" accept="image/*" capture="environment" hidden>
      ${d.linkOpen ? `<div class="linkrow"><label class="f" for="plink2">Product page link</label>
        <div class="row"><input type="url" id="plink2" class="grow" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="https://shop.com/…" value="${esc(d.link || '')}"><button type="button" class="ghost" id="linkgo">Get picture</button></div>
        ${store.get('aipass', '') ? '' : '<label class="f" for="lpass">Passcode</label><input type="password" id="lpass" autocomplete="current-password">'}</div>` : ''}
      <div id="intakemsg" class="muted" role="status" aria-live="polite">${esc(d.busy || (d.source ? '' : 'A plain background works best. You can also paste a picture (Ctrl/⌘+V) or share a link.'))}</div>
      <div class="preview" style="margin-top:10px">
        <figure><div class="box">${d.source ? `<img src="${d.source}" alt="Your original photo">` : '<span class="muted">Original</span>'}</div><figcaption class="muted">Your photo</figcaption></figure>
        <figure><div class="box" id="cutbox">${d.cutoutUrl || (existing && url(existing.id)) ? `<img id="cutimg" src="${d.cutoutUrl || url(existing.id)}" alt="Background-removed preview">` : '<span class="muted">Cutout</span>'}</div><figcaption class="muted">Mannequin-ready cutout</figcaption></figure>
      </div>
      ${d.source ? `<label class="f" for="tol">Background removal strength: <span id="tolv">${d.tolerance}</span></label>
        <input type="range" id="tol" min="8" max="110" value="${d.tolerance}">
        <label class="row" style="margin-top:6px"><input type="checkbox" id="keep" ${d.keep ? 'checked' : ''}> Keep original background</label>
      <div class="aibox"><div class="muted"><b>✨ AI helpers</b> — cutout and details use a little of your fal credits. With your passcode saved they run on every new photo.</div>
        <label class="row" style="margin-top:6px"><input type="checkbox" id="aiauto" ${store.get('aiauto', '1') !== '0' ? 'checked' : ''}> Run automatically on new photos</label>
        <label class="f" for="mpass">Passcode</label><input type="password" id="mpass" autocomplete="current-password" value="${esc(store.get('aipass', ''))}">
        <div class="row" style="margin-top:8px"><button type="button" class="ghost" id="aicut">${d.aiCanvas ? 'Redo AI cutout' : 'Cleaner cutout'}</button>${d.aiCanvas ? '<button type="button" class="ghost" id="aiundo">Use the on-device cutout</button>' : ''}<button type="button" class="ghost" id="aitag">Auto-fill details</button></div>
        <div id="aimsg" class="muted" role="status" aria-live="polite">${esc([d.cutMsg, d.tagMsg].filter(Boolean).join(' '))}</div></div>
      <div class="aibox"><div class="muted"><b>🧠 Cut out on this device (optional)</b> — no passcode or credits. The first time it downloads an AI model (about 45 MB); your photo never leaves this phone.</div>
        <div class="row" style="margin-top:8px"><button type="button" class="ghost" id="devcut"${d.devBusy ? ' disabled' : ''}>Cut out on this device</button></div>
        <progress id="devbar" max="100" value="0" aria-label="Model download" ${d.devBusy ? '' : 'hidden'}></progress>
        <div id="devmsg" class="muted" role="status" aria-live="polite">${esc(d.devMsg || '')}</div></div>` : ''}
      <div class="backbox"><label class="f" for="backfile">Back photo (optional — shows on the back of the 3D model)</label>
        <input type="file" id="backfile" accept="image/*">
        ${d.backUrl || d.backBlob ? `<div class="row" style="margin-top:8px"><img class="backthumb" src="${d.backUrl || (existing && url(existing.id + ':back')) || ''}" alt="Back of the piece" width="56" height="56"><button type="button" class="ghost" id="backrm">Remove back photo</button></div>` : ''}</div>
      <label class="f" for="name">Name</label><input type="text" id="name" value="${esc(d.name)}" placeholder="e.g. Black satin cami">
      <div class="row"><div class="grow"><label class="f" for="type">Type${d.typeGuess ? ' <span class="muted">· guessed from the name, check it</span>' : ''}</label>
        <select id="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
        <div class="grow"><label class="f" for="brand">Brand (optional)</label><input type="text" id="brand" value="${esc(d.brand)}"></div></div>
      <div class="row"><div class="grow"><label class="f" for="price">Price paid, $ (optional)</label><input type="number" id="price" min="0" step="0.01" inputmode="decimal" value="${esc(String(d.price))}"></div>
        <div class="grow"><label class="f" for="bought">Bought on (optional)</label><input type="date" id="bought" value="${esc(d.bought)}"></div></div>
      <label class="f" for="season">Warmth (used with the weather)</label>
      <select id="season">${SEASONS.map(([k, l]) => `<option value="${k}" ${k === d.season ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="f" id="occl">Occasions</label>
      <div class="chips" id="occs" role="group" aria-labelledby="occl">${OCCASIONS.map((o) => `<button type="button" class="chip ${d.occasions.includes(o) ? 'on' : ''}" aria-pressed="${d.occasions.includes(o)}" data-o="${o}">${o}</button>`).join('')}</div>
      <label class="f" for="color">Main colour ${d.color ? `— ${esc(d.color.name)}` : ''}</label>
      <div class="swatches" role="group" aria-label="Colours found in the photo">${d.palette.map((c) => `<button type="button" class="swatch ${d.color?.hex === c.hex ? 'on' : ''}" data-hex="${c.hex}" style="background:${c.hex}" aria-label="${esc(colorName(c.hex))}" aria-pressed="${d.color?.hex === c.hex}"></button>`).join('')}<input type="color" id="color" value="${d.color?.hex || '#888888'}" aria-label="Pick any colour" style="width:44px;height:34px;padding:0;border:0;background:none"></div>
      <div class="row" style="margin-top:18px;justify-content:space-between">
        <span>${existing ? '<button class="ghost danger" id="rm">Delete</button>' : ''}</span>
        <span class="row"><button class="ghost" id="cancel">Cancel</button>${existing ? '' : '<button class="ghost" id="saveadd">Save &amp; add another</button>'}<button class="primary" id="save">Save to closet</button></span></div>`, existing ? 'Edit piece' : 'Add a piece');
    wire();
  };

  const recut = () => {
    if (!d.base) return;
    d.canvas = d.aiCanvas || (d.keep ? d.base : removeBackground(d.base, { tolerance: d.tolerance }));
    d.cutoutUrl = d.canvas.toDataURL('image/png');
    d.palette = palette(d.canvas, 4).filter((c) => c.share > 0.04);
    const pal = d.palette[0];
    if (pal && !d.colorPicked) d.color = { hex: pal.hex, name: colorName(pal.hex) };
  };

  function wire() {
    $('#cancel').onclick = closeModal;
    $('#occs').onclick = (e) => {
      const o = e.target.dataset.o; if (!o) return;
      d.occasions = d.occasions.includes(o) ? d.occasions.filter((x) => x !== o) : [...d.occasions, o];
      e.target.classList.toggle('on'); e.target.setAttribute('aria-pressed', d.occasions.includes(o));
    };
    $('#name').oninput = (e) => { d.name = e.target.value; d.autoName = false; };
    $('#brand').oninput = (e) => (d.brand = e.target.value);
    $('#price').oninput = (e) => (d.price = e.target.value);
    $('#bought').oninput = (e) => (d.bought = e.target.value);
    $('#season').onchange = (e) => (d.season = e.target.value);
    $('#type').onchange = (e) => { d.type = e.target.value; d.typeGuess = false; };
    $('#color').oninput = (e) => { d.color = { hex: e.target.value, name: colorName(e.target.value) }; d.colorPicked = true; };
    const ingestFile = async (f, meta = {}) => {
      try {
        const { img, url: u } = await loadImage(f);
        d.source = u; d.base = toCanvas(img); d.photoSeq = (d.photoSeq || 0) + 1; d.colorPicked = false; d.busy = ''; d.fromShop = !!meta.title; // a shop's own title and category beat the AI's guess
        const title = meta.title || f.name?.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 40) || '';
        if (!d.name.trim() || d.autoName) { d.name = meta.title ? tidyTitle(meta.title, meta.brand) : title; d.autoName = !!d.name; }
        if (meta.brand && !d.brand.trim()) d.brand = meta.brand;
        if (meta.price && d.price === '') d.price = String(meta.price);
        const guess = guessType(`${meta.title || ''} ${title}`);
        if (guess && !existing) { d.type = guess; d.typeGuess = true; }
        d.aiCanvas = null; d.cutMsg = d.tagMsg = '';
        recut(); paint(); autoAI();
      } catch (err) { toast(err.message); }
    };
    const fromData = async (dataUri, meta) => ingestFile(await (await fetch(dataUri)).blob(), meta);
    const say = (m) => { d.busy = m; const el = $('#intakemsg'); if (el) el.textContent = m; };
    $('#file').onchange = (e) => { const f = e.target.files[0]; if (f) ingestFile(f); };
    $('#camfile').onchange = (e) => { const f = e.target.files[0]; if (f) ingestFile(f); };
    $('#srcpick').onclick = () => $('#file').click();
    $('#srccam').onclick = () => $('#camfile').click();
    $('#srclink').onclick = () => { d.linkOpen = !d.linkOpen; paint(); if (d.linkOpen) $('#plink2').focus(); };
    const fetchLink = async (link) => {
      const pass = store.get('aipass', '') || $('#lpass')?.value.trim();
      if (!pass) { d.linkOpen = true; d.link = link; paint(); say('Enter your passcode to fetch links.'); $('#lpass')?.focus(); return; }
      store.set('aipass', pass); d.link = link; say('Opening the page…'); const seq = modalSeq;
      try {
        const r = await productAI(link, pass);
        if (seq !== modalSeq) return;
        d.linkOpen = false; await fromData(r.image, { title: r.title, brand: r.brand, price: r.price });
        toast(r.title ? `Got “${tidyTitle(r.title, r.brand)}” from ${r.host}` : `Got the picture from ${r.host}`);
      } catch (err) { if (seq === modalSeq) say(`${err.message} You can also save the picture and use Choose photo.`); }
    };
    if ($('#linkgo')) { $('#linkgo').onclick = () => { const l = firstLink($('#plink2').value); if (!l) return say('Paste a link that starts with https://'); fetchLink(l); }; $('#plink2').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#linkgo').click(); } }; }
    // Paste: ⌘/Ctrl+V anywhere in the dialog, or the button (iPhone Safari asks "Allow Paste" once per paste)
    const takeClipboard = async (items, text) => {
      const img = items.find((x) => x.type?.startsWith('image/'));
      if (img) return ingestFile(img);
      const l = firstLink(text); if (l) return fetchLink(l);
      say('Nothing usable on the clipboard. Copy a picture or a product link first, then tap Paste.');
    };
    $('#srcpaste').onclick = async () => {
      try {
        const clip = await navigator.clipboard.read(), files = [];
        for (const it of clip) { const t = it.types.find((x) => x.startsWith('image/')); if (t) files.push(new File([await it.getType(t)], 'pasted.png', { type: t })); }
        let text = ''; if (!files.length) { const tt = clip.flatMap((it) => (it.types.includes('text/plain') ? [it] : []))[0]; text = tt ? await (await tt.getType('text/plain')).text() : ''; }
        takeClipboard(files, text);
      } catch { try { takeClipboard([], await navigator.clipboard.readText()); } catch { say('Your browser blocked reading the clipboard. Press ⌘/Ctrl+V in this window, or use Choose photo.'); } }
    };
    if (!d.pasteHook) {
      d.pasteHook = (e) => {
        if (modalSeq !== seq0 || $('#modal').hidden) return document.removeEventListener('paste', d.pasteHook);
        if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'file' && !e.clipboardData?.files?.length) return; // normal typing paste
        e.preventDefault(); takeClipboard([...(e.clipboardData?.files || [])], e.clipboardData?.getData('text') || '');
      };
      document.addEventListener('paste', d.pasteHook);
    }
    // With a saved passcode, a new photo is cut out and described by the AI on its own (the on-device cutout shows first, instantly).
    const autoAI = () => {
      const pass = store.get('aipass', ''); if (!pass || store.get('aiauto', '1') === '0' || !d.base) return;
      d.autoRun?.(pass);
    };
    $('#backfile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const { img } = await loadImage(f);
        d.backCanvas = trimTransparent(removeBackground(toCanvas(img), { tolerance: d.tolerance }));
        d.backUrl = d.backCanvas.toDataURL('image/png'); d.backBlob = null; paint();
      } catch (err) { toast(err.message); }
    };
    if ($('#backrm')) $('#backrm').onclick = () => { d.backCanvas = null; d.backBlob = null; d.backUrl = ''; paint(); };
    if ($('#aiauto')) $('#aiauto').onchange = (e) => store.set('aiauto', e.target.checked ? '1' : '0');
    const mpass = () => { const v = $('#mpass').value.trim(); if (!v) { toast('Enter your passcode first'); return null; } store.set('aipass', v); return v; };
    const aiBusy = (msg) => { const el = $('#aimsg'); if (el) el.textContent = msg; if ($('#aicut')) $('#aicut').disabled = $('#aitag').disabled = !!msg.endsWith('…'); };
    const runCut = async (pass) => {
      aiBusy('Cutting it out…');
      const seq = modalSeq, photo = d.photoSeq;
      try {
        const img = new Image(); img.src = await cutoutAI(d.base, pass); await img.decode();
        if (seq !== modalSeq || photo !== d.photoSeq) return; // the dialog closed or a different photo was chosen meanwhile
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
        d.aiCanvas = trimTransparent(c); d.cutMsg = 'Done — AI cutout applied. Use the button below to go back if it looks worse.';
        recut(); paint();
      } catch (e) { if (seq === modalSeq) aiBusy(e.message); }
    };
    const runTag = async (pass) => {
      aiBusy('Looking at it…');
      const seq = modalSeq, photo = d.photoSeq;
      try {
        const t = await tagAI(d.base, pass), bits = [];
        if (seq !== modalSeq || photo !== d.photoSeq) return;
        if (t.name && !d.fromShop && (!d.name.trim() || d.autoName)) { d.name = t.name; d.autoName = false; bits.push(t.name); }
        if (t.type && !(d.fromShop && d.typeGuess)) { d.type = t.type; d.typeGuess = false; bits.push(TYPES[t.type].label); }
        if (t.season) d.season = t.season;
        if (t.occasions.length) { d.occasions = t.occasions; bits.push(t.occasions.join(', ')); }
        if (t.brand && !d.brand.trim()) d.brand = t.brand;
        d.tagMsg = bits.length ? `Filled in: ${bits.join(' · ')}. Check it and edit anything that’s off.` : 'The AI couldn’t tell much from that photo.';
        paint();
      } catch (e) { if (seq === modalSeq) aiBusy(e.message); }
    };
    if ($('#devcut')) $('#devcut').onclick = async () => {
      const seq = modalSeq, photo = d.photoSeq, bar = $('#devbar'), msg = $('#devmsg');
      d.devBusy = true; $('#devcut').disabled = true; bar.hidden = false; bar.removeAttribute('value'); msg.textContent = 'Starting…';
      try {
        const blob = await browserCut(await canvasToBlob(d.base, 'image/png'), (f, phase) => {
          if (seq !== modalSeq) return;
          if (phase === 'download') { bar.value = Math.round((f ?? 0) * 100); msg.textContent = `Downloading the model… ${Math.round((f ?? 0) * 100)}% (only the first time)`; }
          else { bar.removeAttribute('value'); msg.textContent = 'Cutting it out…'; }
        });
        if (seq !== modalSeq || photo !== d.photoSeq) return;
        const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(img.src);
        d.aiCanvas = trimTransparent(c); d.cutMsg = 'Done — on-device AI cutout applied. Use the button below to go back if it looks worse.'; d.devBusy = false; d.devMsg = '';
        recut(); paint();
      } catch (e) { d.devBusy = false; if (seq === modalSeq) { d.devMsg = e.message; paint(); } }
    };
    d.autoRun = async (pass) => { await Promise.all([runCut(pass), runTag(pass)]); };
    if ($('#aicut')) $('#aicut').onclick = () => { const pass = mpass(); if (pass) runCut(pass); };
    if ($('#aiundo')) $('#aiundo').onclick = () => { d.aiCanvas = null; d.cutMsg = ''; recut(); paint(); };
    if ($('#aitag')) $('#aitag').onclick = () => { const pass = mpass(); if (pass) runTag(pass); };
    $('.swatches').onclick = (e) => { const h = e.target.dataset?.hex; if (!h) return; d.color = { hex: h, name: colorName(h) }; d.colorPicked = true; paint(); };
    if (d.pending) { // opened from a deep link or a shared file
      const p = d.pending; d.pending = null;
      if (p.file) ingestFile(p.file);
      else if (p.mode === 'link') { d.linkOpen = true; d.link = p.url; if (p.url) fetchLink(p.url); else { paint(); $('#plink2')?.focus(); } }
      else if (p.mode === 'paste') { say('Tap Paste to bring in what you copied.'); $('#srcpaste').focus(); }
    }
    const tol = $('#tol');
    if (tol) {
      if (d.aiCanvas) { tol.disabled = true; $('#keep').disabled = true; }
      tol.oninput = () => { d.tolerance = +tol.value; $('#tolv').textContent = tol.value; recut(); $('#cutbox').innerHTML = `<img id="cutimg" src="${d.cutoutUrl}" alt="Background-removed preview">`; };
      $('#keep').onchange = (e) => { d.keep = e.target.checked; recut(); paint(); };
    }
    if ($('#rm')) $('#rm').onclick = async () => {
      if (!confirm(`Delete “${existing.name}” from your closet?`)) return;
      await removeItems([existing.id]);
      closeModal(); render();
    };
    const save = async (again) => {
      if (!d.canvas && !d.cutout) return toast('Add a photo first 📸');
      if (!d.name.trim()) return toast('Give it a name');
      const cutout = d.canvas ? await canvasToBlob(d.canvas, 'image/webp', 0.92) : d.cutout; // WebP keeps the transparency at a fraction of PNG's size (browsers without WebP encoding fall back to PNG)
      const backCutout = d.backCanvas ? await canvasToBlob(d.backCanvas, 'image/webp', 0.92) : d.backBlob || undefined;
      const item = {
        ...(existing || {}), backCutout, id: d.id, name: d.name.trim(), type: d.type, occasions: d.occasions, brand: d.brand.trim(),
        color: d.color || existing?.color, colors: d.palette.length ? d.palette.map((c) => c.hex) : existing?.colors, cutout, adj: existing?.adj || { scale: 1, dx: 0, dy: 0 },
        price: parseFloat(d.price) > 0 ? Math.round(parseFloat(d.price) * 100) / 100 : undefined, bought: d.bought || undefined, season: d.season,
        createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
      };
      await put('items', item);
      if (existing) { S.urls.delete(item.id); S.items = S.items.map((i) => (i.id === item.id ? item : i)); } else S.items.push(item);
      S.urls.delete(item.id + ':back'); if (backCutout) url(item.id + ':back', backCutout);
      url(item.id, item.cutout);
      if (preset.onSaved) await preset.onSaved(item);
      closeModal(); toast(existing ? 'Updated ✓' : again ? `Saved “${item.name}” ✓ — next one` : 'Added to your closet ✓'); render();
      if (again) openItemModal(undefined, { type: item.type });
    };
    $('#save').onclick = () => save(false);
    if ($('#saveadd')) $('#saveadd').onclick = () => save(true);
  }
  paint();
}

/** Delete pieces everywhere they're referenced: closet, current outfit, saved looks, and cached images. */
async function removeItems(ids) {
  const gone = new Set(ids);
  for (const id of ids) { await del('items', id); for (const key of [id, id + ':back']) { const u = S.urls.get(key); if (u) { URL.revokeObjectURL(u); S.urls.delete(key); } } }
  S.items = S.items.filter((i) => !gone.has(i.id));
  S.basket = S.basket.filter((id) => !gone.has(id));
  for (const k of Object.keys(S.outfit)) if (gone.has(S.outfit[k])) delete S.outfit[k];
  for (const o of [...S.outfits]) { // saved looks lose the piece; a look left empty is removed (diary history keeps its record)
    const kept = Object.fromEntries(Object.entries(o.outfit).filter(([, v]) => !gone.has(v)));
    if (!Object.keys(kept).length) { await del('outfits', o.id); S.outfits = S.outfits.filter((x) => x.id !== o.id); }
    else if (Object.keys(kept).length !== Object.keys(o.outfit).length) { o.outfit = kept; await put('outfits', o); }
  }
}

/* ───────────────────────── cloud sync ───────────────────────── */
let syncMsg = '';
/** Ways to get pieces in from other apps. iPhones can't use the web "share to app" feature, so this explains a Shortcut instead. */
function addPanel() {
  const base = location.origin;
  return `<section class="panel" aria-label="Add from other apps"><h3>Add from other apps</h3>
    <p class="muted">Tap <b>+ Add</b>, then <b>Paste</b> to bring in a copied picture or product link, or <b>From a link</b> to type one in.</p>
    <details><summary>iPhone: add from the Share menu (Shortcut)</summary>
      <p class="muted">iPhones can’t share straight into a web app, so make a one-time Shortcut. It takes about two minutes:</p>
      <ol class="muted steps">
        <li>Open the <b>Shortcuts</b> app, tap <b>+</b>, and name it “Add to Closet”.</li>
        <li>Tap the <b>ⓘ</b> button and turn on <b>Show in Share Sheet</b>. Under accepted types keep <b>Images</b>, <b>URLs</b> and <b>Text</b>.</li>
        <li>For pictures: add <b>Copy to Clipboard</b> (input: Shortcut Input), then add <b>Open URLs</b> and enter <code>${esc(base)}/?add=paste</code>. When the closet opens, tap <b>Paste</b> and allow it.</li>
        <li>For product pages: add <b>URL Encode</b> (input: Shortcut Input), then <b>Open URLs</b> with <code>${esc(base)}/?add=link&amp;u=</code> followed by the encoded text. The link is fetched automatically (needs your passcode saved once).</li>
        <li>Then in Safari, Photos, Pinterest or a shop app: tap <b>Share → Add to Closet</b>.</li>
      </ol>
      <p class="muted">I can’t ship a ready-made Shortcut file (Apple requires them to be signed), and I haven’t been able to try this on a real iPhone, so tell me if a step differs on your iOS version.</p>
    </details>
    <details><summary>Android / desktop: install the app to share into it</summary>
      <p class="muted">After you install this app (browser menu → <b>Install</b>), it appears in the Share menu for pictures and links.</p></details></section>`;
}

function syncPanel() {
  const st = syncState();
  return `<section class="panel" aria-label="Cloud sync"><h3>Cloud sync</h3>
    ${st.on
    ? `<p class="muted">Connected. Your closet, outfits and photos sync between your devices${st.last ? ` · last synced ${new Date(st.last).toLocaleString()}` : ''}.</p>
       <div class="row"><button class="ghost" data-act="syncnow">⟳ Sync now</button><button class="ghost danger" data-act="syncoff">Disconnect</button></div>`
    : `<p class="muted">Keep your closet on every phone and computer. Enter your private sync key — it works like a password, so anyone with it can see your closet.</p>
       <label class="f" for="synckey">Sync key</label><input id="synckey" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="word-word-word-…"></label>
       <div class="row"><button class="ghost" data-act="syncconnect">Connect &amp; sync</button></div>`}
    <p class="muted" id="syncmsg" role="status">${esc(syncMsg)}</p></section>`;
}
async function runSync() {
  syncMsg = 'Syncing…'; const m = $('#syncmsg'); if (m) m.textContent = syncMsg;
  try {
    const r = await syncNow();
    syncMsg = `Synced ✓ (${r.pulled} from the cloud, ${r.pushed} sent)`;
    if (r.pulled || r.removed) { try { sessionStorage.setItem('synced', syncMsg); } catch { /* private mode */ } location.reload(); return true; }
  } catch (e) { syncMsg = e.message || 'Sync failed — check your connection'; if (S.view === 'closet') render(); return false; }
  if (S.view === 'closet') render();
  return true;
}

/* ───────────────────────── backup & restore ───────────────────────── */
const STORES = ['items', 'outfits', 'wears', 'inspos', 'profile', 'plans', 'wishlist']; // renders are a cache, so they're not backed up
const PREFS = ['skin', 'hair', 'hairstyle', 'shape', 'shapename', 'eyes', 'lips', 'room', 'budget'];
const blobToData = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const packRecord = async (rec) => Object.fromEntries(await Promise.all(Object.entries(rec).map(async ([k, v]) => [k, v instanceof Blob ? { __blob: await blobToData(v) } : v])));
const unpackRecord = async (rec) => Object.fromEntries(await Promise.all(Object.entries(rec).map(async ([k, v]) => [k, v && typeof v.__blob === 'string' ? await (await fetch(v.__blob)).blob() : v])));

async function exportBackup() {
  const stores = {};
  for (const name of STORES) stores[name] = await Promise.all((await all(name)).map(packRecord));
  const prefs = Object.fromEntries(PREFS.map((k) => [k, store.get(k, '')]).filter(([, v]) => v)); // only what was actually customized
  const file = new Blob([JSON.stringify({ app: 'nikkis-closet', version: 1, exportedAt: new Date().toISOString(), stores, prefs })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = `nikkis-closet-backup-${iso(new Date())}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Saved a backup of ${S.items.length} piece${S.items.length === 1 ? '' : 's'}`);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== 'nikkis-closet' || typeof data.stores !== 'object') throw new Error('That doesn’t look like a Nikki’s Closet backup.');
    if (!confirm('Restore this backup? Anything with the same ID is replaced; everything else on this device is kept.')) return;
    let n = 0;
    for (const name of STORES) for (const rec of data.stores[name] || []) { await put(name, await unpackRecord(rec)); if (name === 'items') n++; }
    for (const [k, v] of Object.entries(data.prefs || {})) if (PREFS.includes(k) && v) store.set(k, String(v));
    try { sessionStorage.setItem('restored', String(n)); } catch { /* private mode */ }
    location.reload(); // rebuild all state from what's now stored
  } catch (e) { toast(e.message || 'Could not read that file'); }
}

async function loadSamples() {
  for (const s of SAMPLES) {
    const cutout = await sampleBlob(s);
    const item = {
      id: uid(), name: s.name, type: s.type, occasions: s.occasions, brand: '', sample: true, season: s.season || 'all',
      color: { hex: s.hex, name: colorName(s.hex) }, cutout, adj: { scale: 1, dx: 0, dy: 0 }, createdAt: Date.now(),
    };
    await put('items', item); S.items.push(item); url(item.id, cutout);
  }
  toast('Sample closet loaded — swap in your real pieces anytime'); render();
}

/* ───────────────────────── my model (photo + proportions) ───────────────────────── */
function openModelModal() {
  const prof = S.profile;
  const d = {
    W: prof?.W || DEFAULT_BODY.W, H: prof?.H || DEFAULT_BODY.H,
    pts: structuredClone(prof?.pts || DEFAULT_BODY.pts),
    photo: prof?.photo || null, photoUrl: prof?.photo ? url('profile') : '', canvas: null,
    display: prof?.display || 'mannequin', warnings: [], busy: false,
    prop: { shoulders: 1, hips: 1, torso: 1, legs: 1 },
  };
  openModal();
  const body = () => ({ W: d.W, H: d.H, pts: d.pts });
  const preview = () => mannequinSVG({ body: body(), photoUrl: '', skin: S.skin, hair: S.hair, items: {}, urls: S.urls, label: 'Preview of your proportions' });

  const paint = () => {
    const sl = (k, l) => `<label class="f" for="p-${k}">${l}</label><input type="range" id="p-${k}" data-prop="${k}" min="0.75" max="1.3" step="0.01" value="${d.prop[k]}">`;
    paintSheet(`
      <p class="muted">For the most accurate try-on, upload a full-body photo: stand facing the camera, arms slightly away from your sides, whole body in frame (shoes included), fitted or neutral clothes, plain background, phone held at hip height. <b>The photo never leaves this device.</b></p>
      <label class="f" for="mfile">Full-body photo</label>
      <input type="file" id="mfile" accept="image/*">
      <div id="mstatus" class="muted" role="status" aria-live="polite">${d.busy ? 'Finding your body points…' : ''}</div>
      ${d.warnings.map((w) => `<div class="gap" role="alert">${esc(w)}</div>`).join('')}
      <div class="mgrid">
        <div>${d.photoUrl ? `<p class="muted" id="caldesc">Drag the dots onto your joints, or focus one and use the arrow keys (Shift = bigger steps).</p><svg id="cal" class="cal-svg" viewBox="0 0 ${d.W} ${d.H}" aria-describedby="caldesc"><image href="${d.photoUrl}" width="${d.W}" height="${d.H}"/></svg>` : '<div class="empty" style="padding:30px 10px">Upload a photo to place your body points, or just use the sliders →</div>'}</div>
        <div><div class="stage" id="mprev" style="padding:6px">${preview()}</div>
          <details style="margin-top:8px" ${d.photoUrl ? '' : 'open'}><summary>Adjust proportions by hand</summary>
            ${sl('shoulders', 'Shoulders')}${sl('hips', 'Hips')}${sl('torso', 'Torso length')}${sl('legs', 'Leg length')}
            <p class="muted">${d.photoUrl ? 'Using these replaces the photo-based points.' : ''}</p></details></div>
      </div>
      <fieldset style="border:0;padding:0;margin:12px 0 0"><legend class="f">Show me as</legend>
        <label class="row"><input type="radio" name="disp" value="mannequin" ${d.display === 'mannequin' ? 'checked' : ''}> Mannequin shaped like me</label>
        <label class="row"><input type="radio" name="disp" value="photo" ${d.display === 'photo' ? 'checked' : ''} ${d.photoUrl ? '' : 'disabled'}> My photo (most realistic)</label></fieldset>
      <div class="row" style="margin-top:16px;justify-content:space-between">
        <span>${prof ? '<button class="ghost danger" id="mreset">Remove my model</button>' : ''}</span>
        <span class="row"><button class="ghost" id="mcancel">Cancel</button><button class="primary" id="msave">Save</button></span></div>`, 'Make it look like me');
    wire();
  };

  function refreshPreview() { $('#mprev').innerHTML = preview(); }

  function drawCal() {
    const svg = $('#cal'); if (!svg) return;
    svg.querySelectorAll('.cal-el').forEach((n) => n.remove());
    const p = d.pts, r = Math.max(5, d.W * 0.013);
    const line = (a, b) => `<line class="cal-el skel" x1="${p[a][0]}" y1="${p[a][1]}" x2="${p[b][0]}" y2="${p[b][1]}" stroke-width="${r * 0.35}"/>`;
    const lines = [['shL', 'shR'], ['hipL', 'hipR'], ['shL', 'hipL'], ['shR', 'hipR'], ['hipL', 'knL'], ['knL', 'anL'], ['hipR', 'knR'], ['knR', 'anR'], ['shL', 'wrL'], ['shR', 'wrR']].map(([a, b]) => line(a, b)).join('');
    const dots = HANDLES.map(([k, label]) => `<circle class="cal-el handle" data-k="${k}" cx="${p[k][0]}" cy="${p[k][1]}" r="${r}" tabindex="0" role="button" aria-label="${label}: use arrow keys to move"/>`).join('');
    svg.insertAdjacentHTML('beforeend', lines + dots);
  }

  function moveHandle(k, x, y) {
    d.pts[k] = [Math.max(0, Math.min(d.W, x)), Math.max(0, Math.min(d.H, y))];
    const svg = $('#cal'), el = svg.querySelector(`[data-k="${k}"]`);
    drawCal(); // lines + dots are cheap to redraw; restore focus on the same dot
    if (document.activeElement === document.body || document.activeElement === el) svg.querySelector(`[data-k="${k}"]`)?.focus();
    refreshPreview();
  }

  function wire() {
    $('#mcancel').onclick = closeModal;
    document.querySelectorAll('[name=disp]').forEach((r) => (r.onchange = () => (d.display = r.value)));
    document.querySelectorAll('[data-prop]').forEach((r) => (r.oninput = () => {
      d.prop[r.dataset.prop] = +r.value;
      Object.assign(d, fromProportions(d.prop)); d.photo = null; d.photoUrl = ''; d.display = 'mannequin';
      refreshPreview();
    }));
    $('#mfile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      d.busy = true; d.warnings = []; $('#mstatus').textContent = 'Finding your body points… (first time takes a few seconds)';
      try {
        const { img } = await loadImage(f);
        const canvas = toCanvas(img, 1000);
        d.canvas = canvas; d.W = canvas.width; d.H = canvas.height;
        d.photoUrl = canvas.toDataURL('image/jpeg', 0.9);
        d.display = 'photo';
        let lm = null;
        try { lm = await detectPose(canvas); } catch (err) { console.warn(err); d.warnings.push('Automatic detection isn’t available in this browser — place the dots by hand.'); }
        if (lm) { const r = fromLandmarks(lm, d.W, d.H); d.pts = r.body.pts; d.warnings.push(...r.warnings); }
        else {
          if (!d.warnings.length) d.warnings.push('I couldn’t find a full body in that photo. Drag the dots onto your joints, or try a clearer photo.');
          const k = d.H / DEFAULT_BODY.H, ox = d.W / 2 - 150 * k;
          d.pts = Object.fromEntries(Object.entries(DEFAULT_BODY.pts).map(([n, [x, y]]) => [n, [x * k + ox, y * k]]));
        }
      } catch (err) { d.warnings = [err.message]; }
      d.busy = false; paint(); drawCal();
    };
    const svg = $('#cal');
    if (svg) {
      drawCal();
      let drag = null;
      const toSvg = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
      svg.onpointerdown = (e) => { const k = e.target.dataset?.k; if (!k) return; drag = k; svg.setPointerCapture(e.pointerId); e.preventDefault(); };
      svg.onpointermove = (e) => { if (!drag) return; const p = toSvg(e); moveHandle(drag, p.x, p.y); };
      svg.onpointerup = svg.onpointercancel = () => (drag = null);
      svg.onkeydown = (e) => {
        const k = e.target.dataset?.k; if (!k) return;
        const step = (e.shiftKey ? 10 : 2) * (d.W / 600), v = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!v) return; e.preventDefault(); moveHandle(k, d.pts[k][0] + v[0], d.pts[k][1] + v[1]);
      };
    }
    $('#msave').onclick = async () => {
      let photo = d.photo;
      if (d.photoUrl && d.canvas) photo = await canvasToBlob(d.canvas, 'image/jpeg', 0.9);
      const rec = { id: 'me', rev: Date.now(), W: d.W, H: d.H, pts: d.pts, photo: d.photoUrl ? photo : null, display: d.photoUrl ? d.display : 'mannequin' };
      await put('profile', rec); S.profile = rec;
      S.urls.delete('profile'); if (rec.photo) url('profile', rec.photo);
      S.shape = null; S.shapeName = ''; store.set('shape', ''); store.set('shapename', ''); // the new model replaces any body-type preset
      closeModal(); toast('Your model is saved ✓'); render();
    };
    if ($('#mreset')) $('#mreset').onclick = async () => {
      if (!confirm('Remove your saved photo and proportions?')) return;
      await del('profile', 'me'); S.profile = null; S.urls.delete('profile'); closeModal(); render();
    };
  }
  paint();
}

/* ───────────────────────── AI try-on (fal.ai) ───────────────────────── */
/* Saved renders + monthly budget: re-showing an outfit you've already rendered is free; spending is capped by a budget you set. */
const aiKey = (steps) => [S.profile?.rev || 0, ...steps.map(([slot, it]) => `${slot}:${it.id}@${it.updatedAt || it.createdAt}`)].join('|');
const monthKey = () => iso(new Date()).slice(0, 7);
function spent() { try { const s = JSON.parse(store.get('spend', 'null')); return s?.m === monthKey() ? s.n : 0; } catch { return 0; } } // pieces rendered this month
const addSpent = (n) => store.set('spend', JSON.stringify({ m: monthKey(), n: spent() + n }));
const budget = () => { const b = parseFloat(store.get('budget', '5')); return b >= 0 ? b : 5; };

/** If this exact outfit (same photo, same pieces) was rendered before, show it for free. Runs once per outfit. */
async function restoreCachedRender() {
  const steps = aiSteps(outfitItems(S.outfit));
  if (!usingPhoto() || !steps.length || aiFor(outfitItems(S.outfit))) return;
  const key = aiKey(steps);
  if (S.aiChecked === key) return;
  S.aiChecked = key;
  const rec = await get('renders', key);
  if (rec && S.aiChecked === key && S.view === 'tryon') { S.ai = { sig: aiSignature(steps), image: rec.image }; S.aiFromCache = true; renderTryon(); }
}

function aiPanel() {
  const steps = aiSteps(outfitItems(S.outfit)), cost = (steps.length * PRICE).toFixed(2);
  const rendered = !!aiFor(outfitItems(S.outfit)), left = budget() - spent() * PRICE;
  const why = !usingPhoto() ? 'Switch to “My photo” above (and set up your model) to use this.' : !steps.length ? 'Pick a top, bottom, dress or jacket first.' : '';
  return `<div class="panel"><h3>Photoreal try-on <span class="muted">(AI · uses your fal.ai credits)</span></h3>
    <p class="muted">Renders the real drape of your piece${steps.length > 1 ? 's' : ''} on your photo. Shoes, bags and accessories are layered on afterwards.${steps.length ? ` About <b>$${cost}</b> for ${steps.length} piece${steps.length > 1 ? 's' : ''}.` : ''}</p>
    <p class="muted">This month: <b>${spent()}</b> piece${spent() === 1 ? '' : 's'} rendered ≈ <b>$${(spent() * PRICE).toFixed(2)}</b> of your <label class="sr-only" for="aibudget">monthly budget in dollars</label>$<input type="number" id="aibudget" min="0" step="1" value="${budget()}" style="width:80px;display:inline-block;min-height:36px;padding:4px 8px"> budget.${rendered && S.aiFromCache ? ' <b>Showing a saved render — free.</b>' : ''}${left < PRICE ? ' <b>Budget used up — raise it to render more.</b>' : ''}</p>
    <label class="f" for="aipass">Passcode</label>
    <input type="password" id="aipass" autocomplete="current-password" value="${esc(store.get('aipass', ''))}">
    <div class="row" style="margin-top:8px">
      ${S.aiBusy ? '<button class="ghost" data-act="aicancel">Cancel</button>' : `<button class="primary" data-act="${rendered ? 'airefresh' : 'airender'}" ${why ? 'disabled' : ''}>${rendered ? 'Render again (new cost)' : '✨ Render on my photo'}</button>`}
      ${rendered && !S.aiBusy ? '<button class="ghost" data-act="aiclear">Back to quick preview</button>' : ''}
    </div>
    <div id="aistatus" class="muted" role="status" aria-live="polite">${why && !S.aiBusy ? esc(why) : ''}${S.aiBusy ? 'Working…' : ''}</div>
    ${S.aiError ? `<div class="gap" role="alert">${esc(S.aiError)}</div>` : ''}</div>`;
}

async function runAIRender(force = false) {
  const items = outfitItems(S.outfit), steps = aiSteps(items);
  if (!force) { // a render you've already paid for is free to show again
    const rec = await get('renders', aiKey(steps));
    if (rec) { S.ai = { sig: aiSignature(steps), image: rec.image }; S.aiFromCache = true; S.aiChecked = aiKey(steps); toast('Showing your saved render — free'); return renderTryon(); }
  }
  const pass = $('#aipass').value.trim();
  if (!pass) return toast('Enter your passcode first');
  store.set('aipass', pass);
  if ((spent() + steps.length) * PRICE > budget() + 1e-9) return toast(`That would go over your $${budget()} monthly budget — raise it above to continue`);
  if (!confirm(`Render ${steps.length} piece${steps.length > 1 ? 's' : ''} with fal.ai? That's about $${(steps.length * PRICE).toFixed(2)} of your credits.`)) return;
  const key = aiKey(steps); // keyed on what was asked for, even if the model photo or a piece changes while it renders
  S.aiAbort = new AbortController(); S.aiBusy = true; S.aiError = ''; renderTryon();
  try {
    const prepared = await Promise.all(steps.map(async ([slot, it]) => ({ category: categoryFor(slot), garment: await garmentImage(it.cutout) })));
    const image = await renderOutfit({
      person: await personImage(S.profile.photo), steps: prepared, passcode: pass, signal: S.aiAbort.signal,
      onProgress: (m) => { const el = $('#aistatus'); if (el) el.textContent = m; },
      onPiece: () => addSpent(1), // each finished piece has already cost credits, even if a later one fails
    });
    S.ai = { sig: aiSignature(steps), image }; S.aiFromCache = false; toast('Rendered ✓');
    S.aiChecked = key;
    await put('renders', { id: key, image, at: Date.now() });
    const all2 = (await all('renders')).sort((a, b) => b.at - a.at); for (const old of all2.slice(40)) await del('renders', old.id); // keep the 40 most recent
  } catch (e) { if (e.name !== 'AbortError') S.aiError = e.message; else toast('Cancelled'); }
  S.aiBusy = false; S.aiAbort = null; if (S.view === 'tryon') renderTryon();
}

/* ───────────────────────── try on ───────────────────────── */
// The 3D engine (~650 KB) is only downloaded the first time a 3D model is actually shown; until then this stand-in answers.
let engine = null, enginePromise = null;
const loadEngine = () => (enginePromise ||= import('./stage3d.js').then((m) => (engine = m.stage3d)));
const stage3d = {
  get usable() { return engine ? engine.usable : webglOK; },
  get loaded() { return !!engine; },
  attach: (el) => engine?.attach(el), setModel: (m) => engine?.setModel(m), setOutfit: (i, u) => engine?.setOutfit(i, u),
  turn: (d) => engine?.turn(d), setLabel: (t) => engine?.setLabel(t), setRole: () => engine?.setRole(),
  snapshot: () => engine?.snapshot() ?? null, debug: () => engine?.debug(),
  enterWorld: (o) => engine?.enterWorld(o), exitWorld: () => engine?.exitWorld(), setMove: (x, y) => engine?.setMove(x, y), setFraming: (o) => engine?.setFraming(o), rotateCam: (d) => engine?.rotateCam(d), pop: () => engine?.pop(), walkToStation: (t) => engine?.walkToStation(t),
};

// 3D when the device supports WebGL (and the user hasn't chosen flat); the 2D SVG mannequin is the fallback.
const use3D = () => !usingPhoto() && stage3d.usable && store.get('flat', '') !== '1';
async function setShape(shape, name) {
  S.shape = shape; S.shapeName = name;
  store.set('shape', JSON.stringify(shape)); store.set('shapename', name);
  if (S.profile?.display === 'photo') { S.profile.display = 'mannequin'; await put('profile', S.profile); } // a body type customizes the mannequin, not the photo
}
function stageHTML() {
  return use3D() ? '' : mannequin(S.outfit);
}
function outfitLabel() {
  const names = Object.values(outfitItems(S.outfit)).map((i) => i.name);
  return `3D model ${names.length ? 'wearing ' + names.join(', ') : 'with no clothes selected'}. Use the turn buttons to rotate.`;
}
function mountStage() {
  const el = $('#stage'); if (!el) return;
  if (!use3D()) { el.innerHTML = stageHTML(); return; }
  if (!stage3d.loaded) { // show the flat model right away while the 3D engine downloads, then swap
    el.innerHTML = mannequin(S.outfit);
    loadEngine().then(() => { if ($('#stage') && use3D()) mountStage(); }).catch(() => { store.set('flat', '1'); renderTryon(); });
    return;
  }
  el.replaceChildren();
  stage3d.attach(el);
  stage3d.setModel({ body: currentBody(), skin: S.skin, hair: S.hair, hairStyle: S.hairStyle, face: { eyes: S.eyes, lips: S.lips } });
  stage3d.setOutfit(outfitItems(S.outfit), S.urls);
  stage3d.setRole(); stage3d.setLabel(outfitLabel());
}
function refreshStage() {
  const s = $('#stage'); if (!s) return;
  if (use3D() && stage3d.loaded) { stage3d.setOutfit(outfitItems(S.outfit), S.urls); stage3d.setLabel(outfitLabel()); } else s.innerHTML = use3D() ? mannequin(S.outfit) : stageHTML();
}

const DRAWERS = [['fit', '📏 Fit'], ['looks', '💾 Looks'], ['ai', '✨ Photoreal'], ['me', '🧍 Me']];

function metersHTML(worn) {
  const m = outfitMeters(worn, S.mood, wearCounts());
  const bar = (label, v) => `<div class="meter"><span>${label}</span><div class="bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v ?? 0}"><i style="width:${v ?? 0}%"></i></div></div>`;
  return `<div class="meters" role="group" aria-label="Outfit meters">${bar('Mood fit', S.mood ? m?.fit : null)}${bar('Colours', m?.harmony)}${bar('Fresh', m?.fresh)}</div>`;
}

const SHAPE_SLIDERS = [['shoulders', 'Shoulders', .8, 1.25], ['hips', 'Hips', .8, 1.35], ['torso', 'Torso length', .85, 1.15], ['legs', 'Leg length', .8, 1.2], ['build', 'Build (soft ↔ full)', .85, 1.4]];
const CAS_TABS = [['skin', 'Skin', '🧑'], ['hair', 'Hair', '🎨'], ['style', 'Style', '💇'], ['eyes', 'Eyes', '👁️'], ['lips', 'Lips', '💋'], ['body', 'Body', '🧍'], ['room', 'Room', '🏠']];
/** The "create-a-sim" style picker: docked inside the model's box, one category at a time, options in a single scrolling strip. */
function casHTML() {
  const close = '<button class="cas-x" data-act="casclose" aria-label="Close customizer"><span aria-hidden="true">✕</span></button>';
  if (usingPhoto()) return `<div class="cas" role="region" aria-label="Customize your model"><p class="muted">You’re showing your own photo. Switch to the mannequin under <b>Me</b> to customize it.</p>${close}</div>`;
  const shape = S.shape || BODY_TYPES.Average;
  const sw = (list, cur, act, label) => `<div class="swatches" role="group" aria-label="${label}">${list.map((c, n) => `<button class="sw ${c === cur ? 'on' : ''}" aria-pressed="${c === cur}" data-act="${act}" data-v="${c}" style="background:${c}" aria-label="${label} ${n + 1}"></button>`).join('')}
    <label class="sw custom" title="Pick any colour"><span class="sr-only">Custom ${label.toLowerCase()}</span><input type="color" id="custom-${act}" value="${cur}"></label></div>`;
  const chip = (act, v, label, on) => `<button class="chip ${on ? 'on' : ''}" aria-pressed="${on}" data-act="${act}" data-v="${v}">${label}</button>`;
  const panes = {
    skin: sw(SKIN, S.skin, 'skin', 'Skin tone'),
    hair: sw(HAIR, S.hair, 'hair', 'Hair colour'),
    style: HAIR_STYLES.map(([k, l]) => chip('hairstyle', k, l, S.hairStyle === k)).join(''),
    eyes: sw(EYES, S.eyes, 'eyes', 'Eye colour'),
    lips: sw(LIPS, S.lips, 'lips', 'Lip colour'),
    room: [['auto', 'Follow the season'], ...Object.entries(ROOMS).map(([k, [l, e]]) => [k, `${e} ${l}`])].map(([k, l]) => chip('room', k, l, S.room === k)).join(''),
    body: Object.keys(BODY_TYPES).map((k) => chip('bodytype', k, k, !!S.shape && S.shapeName === k)).join('')
      + SHAPE_SLIDERS.map(([k, l, a, b]) => `<label class="mini" for="sh-${k}"><span>${l}</span><input type="range" id="sh-${k}" data-shape="${k}" min="${a}" max="${b}" step="0.01" value="${shape[k]}"></label>`).join(''),
  };
  return `<div class="cas" role="region" aria-label="Customize your model">
    <div class="cas-tabs" role="group" aria-label="What to change">${CAS_TABS.map(([k, l, e]) => `<button class="${S.casTab === k ? 'on' : ''}" aria-pressed="${S.casTab === k}" data-act="cas" data-v="${k}"><span aria-hidden="true">${e}</span><small>${l}</small></button>`).join('')}
      <button data-act="resetlook" aria-label="Reset appearance"><span aria-hidden="true">↺</span><small>Reset</small></button>${close}</div>
    <div class="cas-opts">${panes[S.casTab] || panes.skin}</div></div>`;
}

function weatherLine() {
  const w = S.forecast?.find((d) => d.date === iso(new Date()));
  return w
    ? `<p class="wxline" role="status"><span aria-hidden="true">${weatherEmoji(w.code)}</span> ${toF(w.hiC)}°F today${S.loc?.name ? ' in ' + esc(S.loc.name) : ''} · ${BANDS[w.band].label}. <b>Style me</b> dresses for it.</p>`
    : '<p class="wxline"><button class="link" data-act="gowx">Set your city</button> and Style me will dress for the weather.</p>';
}

function drawerHTML(worn, fit) {
  if (S.drawer === 'looks') return `<div class="row"><input type="text" id="lookname" aria-label="Look name" placeholder="Name this look (optional)" class="grow">
      <button class="ghost" data-act="savelook">💾 Save</button></div>
      <button class="primary wide" data-act="wearToday">📅 I’m wearing this today</button>
      <button class="ghost wide" data-act="sharecard" style="margin-top:8px">📸 Share this look as a picture</button>
      ${S.outfits.length ? `<h3>Saved looks</h3><div class="chips">${S.outfits.map((o) => `<span class="chip"><button class="bare" data-act="loadlook" data-id="${o.id}">${esc(o.name)}${o.occasion ? ' · ' + esc(o.occasion) : ''}</button> <button class="bare danger" data-act="dellook" data-id="${o.id}" aria-label="Delete look ${esc(o.name)}"><span aria-hidden="true">×</span></button></span>`).join('')}</div>` : '<p class="muted">Saved looks show up here.</p>'}`;
  if (S.drawer === 'ai') return aiPanel();
  if (S.drawer === 'me') return `<div class="row" role="group" aria-label="Model">
        <button class="chip ${usingPhoto() ? '' : 'on'}" aria-pressed="${!usingPhoto()}" data-act="display" data-v="mannequin" ${S.profile ? '' : 'disabled'}>${S.profile ? 'Mannequin shaped like me' : 'Default mannequin'}</button>
        <button class="chip ${usingPhoto() ? 'on' : ''}" aria-pressed="${usingPhoto()}" data-act="display" data-v="photo" ${S.profile?.photo ? '' : 'disabled'}>My photo</button></div>
      ${stage3d.usable && !usingPhoto() ? `<label class="row" style="margin-top:12px"><input type="checkbox" id="flat" ${store.get('flat', '') === '1' ? 'checked' : ''}> Flat 2D view (lighter on battery)</label>` : ''}
      <button class="primary wide" data-act="setup">${S.profile ? 'Edit my model' : '✨ Make it look like me'}</button>`;
  return Object.keys(worn).length
    ? `<div class="chips">${SLOTS.filter((s) => worn[s]).map((s) => `<button class="chip ${fit?.id === worn[s].id ? 'on' : ''}" aria-pressed="${fit?.id === worn[s].id}" data-act="fit" data-id="${worn[s].id}">${SLOT_LABEL[s]}: ${esc(worn[s].name)}</button>`).join('')}</div>
      ${fit ? `<p class="muted">Fine-tune “${esc(fit.name)}”</p>${[['scale', 'Size', 0.5, 1.8, 0.02], ['dx', 'Left / right', -60, 60, 1], ['dy', 'Up / down', -80, 80, 1]].map(([k, l, a, b, st]) => `<label class="f" for="adj-${k}">${l}</label><input type="range" id="adj-${k}" data-adj="${k}" min="${a}" max="${b}" step="${st}" value="${fit.adj[k]}">`).join('')}
        <button class="ghost" data-act="resetfit" data-id="${fit.id}" style="margin-top:8px">Reset</button>` : '<p class="muted">Tap a piece you’re wearing to adjust how it sits.</p>'}`
    : '<p class="muted">Pick pieces from the wardrobe below to dress your model.</p>';
}

const sceneBar = () => `<div class="scenebar" role="group" aria-label="Where to dress up">
  <button class="${S.scene === 'closet' ? 'on' : ''}" aria-pressed="${S.scene === 'closet'}" data-act="scene" data-v="closet"><span aria-hidden="true">🚪</span> Walk-in closet</button>
  <button class="${S.scene === 'mirror' ? 'on' : ''}" aria-pressed="${S.scene === 'mirror'}" data-act="scene" data-v="mirror"><span aria-hidden="true">🪞</span> Mirror</button></div>`;

function picksPanel() {
  const items = S.basket.map(itemById).filter(Boolean);
  if (!items.length) return '';
  return `<section class="tray picks" aria-label="Pieces you grabbed from the closet"><h3>🧺 From your closet</h3>
    <div class="tray-row">${items.map((i) => { const on = S.outfit[slotOf(i.type)] === i.id; return `<button class="pick ${on ? 'on' : ''}" aria-pressed="${on}" data-act="wear" data-id="${i.id}"><img src="${url(i.id)}" alt=""><span>${esc(i.name)}</span><small>${SLOT_LABEL[slotOf(i.type)]}</small></button>`; }).join('')}</div>
    <div class="row"><button class="ghost" data-act="mix"><span aria-hidden="true">🔀</span> Mix my picks</button><button class="ghost" data-act="scene" data-v="closet"><span aria-hidden="true">🚪</span> Back to the closet</button></div></section>`;
}

/* ───────────────────────── walk-in closet ───────────────────────── */
const SECTION_TYPES = Object.keys(TYPES);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function hallHTML() {
  return `<div class="hall" id="hall" role="group" aria-label="Wardrobe sections. Choose one to walk over to it."><div class="hall-track">
    ${SECTION_TYPES.map((t) => { const list = S.items.filter((i) => i.type === t); return `<button class="cabinet" data-act="section" data-v="${t}" aria-label="${TYPES[t].label}, ${list.length} piece${list.length === 1 ? '' : 's'}. Walk over.">
      <span class="cab-plate"><span aria-hidden="true">${TYPES[t].emoji}</span> ${TYPES[t].label}</span>
      <span class="cab-rail" aria-hidden="true">${list.slice(0, 3).map((i) => `<img src="${url(i.id)}" alt="">`).join('') || '<em>empty</em>'}</span>
      <small class="cab-count">${list.length}</small></button>`; }).join('')}
    <div class="walker" id="walker" aria-hidden="true">${mannequin(S.outfit)}</div></div></div>`;
}

function railHTML(type) {
  const t = TYPES[type], list = S.items.filter((i) => i.type === type);
  return `<div class="railview" role="region" aria-labelledby="railh">
    <div class="rail-head"><button class="ghost" data-act="hall"><span aria-hidden="true">←</span> Closet</button><h3 id="railh">${t.emoji} ${t.label} <small>(${list.length})</small></h3>
      <span class="row" role="group" aria-label="Walk to another section"><button class="ghost" data-act="railnav" data-v="-1" aria-label="Previous section"><span aria-hidden="true">◀</span></button><button class="ghost" data-act="railnav" data-v="1" aria-label="Next section"><span aria-hidden="true">▶</span></button></span></div>
    <div class="rail-bar" aria-hidden="true"></div>
    ${list.length ? `<div class="rail-row" role="group" aria-label="${t.label}. Tap pieces to grab them.">${list.map((it) => { const on = S.basket.includes(it.id); return `<button class="hanger ${on ? 'on' : ''}" aria-pressed="${on}" data-act="grab" data-id="${it.id}"><span class="hook" aria-hidden="true"></span><img src="${url(it.id)}" alt=""><span class="hname">${esc(it.name)}</span><span class="tick" aria-hidden="true">${on ? '✓' : '+'}</span></button>`; }).join('')}</div>`
    : `<p class="muted tray-empty">Nothing in ${t.label.toLowerCase()} yet — <button class="link" data-act="add">add one</button>.</p>`}</div>`;
}

function basketPanel() {
  if (!S.items.length) return emptyCloset(); // first visit: add a piece or load the sample closet
  const items = S.basket.map(itemById).filter(Boolean);
  return `<section class="tray basket" aria-label="Your picks"><h3>🧺 Your picks <small>(${items.length})</small></h3>
    ${items.length ? `<div class="chips">${items.map((i) => `<span class="chip"><img class="bthumb" src="${url(i.id)}" alt=""> ${esc(i.name)} <button class="bare danger" data-act="ungrab" data-id="${i.id}" aria-label="Put back ${esc(i.name)}"><span aria-hidden="true">×</span></button></span>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="primary grow" data-act="tryon"><span aria-hidden="true">🪞</span> Try on</button><button class="ghost" data-act="clearbasket">Put all back</button></div>`
    : '<p class="muted">Walk to a section and tap pieces to grab them — as many as you like. Then try them on in front of the mirror.</p>'}</section>`;
}

const hudHTML = (n) => `<span class="basketbadge" role="status"><span aria-hidden="true">🧺</span> ${n} picked</span>
  <button class="primary" data-act="tryon" ${n ? '' : 'disabled'}><span aria-hidden="true">🪞</span> Try on</button>`;

/* ── the 3D walk-in world ── */
const STATION_COLORS = { tops: '#ff7aa8', tanks: '#ff9a6b', bodysuits: '#c76bff', bottoms: '#5aa9ff', skirts: '#ff8fd0', dresses: '#ff5c93', outerwear: '#b08358', shoes: '#ffb13b', bags: '#2fb892', accessories: '#7a8cff', mirror: '#9b6bff' };
const worldOn = () => S.scene === 'closet' && use3D();
function worldStations() {
  return [...SECTION_TYPES.map((t) => ({ type: t, label: TYPES[t].label, emoji: TYPES[t].emoji, color: STATION_COLORS[t], thumbs: S.items.filter((i) => i.type === t).slice(0, 5).map((i) => url(i.id)) })),
    { type: 'mirror', label: 'Try on', emoji: '🪞', color: STATION_COLORS.mirror, thumbs: [] }];
}
function worldNear(type) { // the avatar stepped onto (or off) a pad
  if (!type) { S.rail = ''; S.dismiss = ''; } else if (S.dismiss !== type) S.rail = type;
  if (worldOn()) updateWorldUI();
}
function mirrorPanel(n) {
  return `<div class="railview mirrorpanel" role="region" aria-labelledby="mirh"><div class="rail-head"><h3 id="mirh">🪞 Try-on mirror</h3><button class="ghost" data-act="hall">Keep walking</button></div>
    <p class="muted">${n ? `You picked ${n} piece${n === 1 ? '' : 's'}. Ready to see ${n === 1 ? 'it' : 'them'} on?` : 'Grab a few pieces from the racks first, then come back here.'}</p>
    <button class="primary wide" data-act="tryon" ${n ? '' : 'disabled'}><span aria-hidden="true">🪞</span> Try on</button></div>`;
}
function updateWorldUI() {
  const n = S.basket.length, focus = document.activeElement?.dataset;
  const hud = $('.closet-hud'); if (hud) hud.innerHTML = hudHTML(n);
  const rail = $('#wrail'); if (!rail) return;
  const oldRow = rail.querySelector('.rail-row'), keep = oldRow && S.lastRail === S.rail ? oldRow.scrollLeft : 0;
  rail.innerHTML = S.rail === 'mirror' ? mirrorPanel(n) : S.rail ? railHTML(S.rail) : '';
  rail.hidden = !S.rail; S.lastRail = S.rail;
  const row = rail.querySelector('.rail-row'); if (row) row.scrollLeft = keep;
  $('.room.world').classList.toggle('railopen', !!S.rail); stage3d.setFraming(!!S.rail);
  $('#whint').textContent = S.rail ? '' : 'Drag the stick, or tap the floor, to walk to a wardrobe.';
  $('#wbasket').innerHTML = basketPanel();
  document.querySelectorAll('.world-jump button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.rail)));
  if (focus?.act) document.querySelector(`#main [data-act="${focus.act}"]${focus.id ? `[data-id="${focus.id}"]` : focus.v ? `[data-v="${focus.v}"]` : ''}`)?.focus({ preventScroll: true });
}
function bindJoystick() {
  const j = $('#joy'); if (!j) return;
  const knob = j.firstElementChild; let pid = null;
  const set = (e) => {
    const r = j.getBoundingClientRect(), R = r.width / 2 - 14; let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy); if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; stage3d.setMove(dx / R, -dy / R);
  };
  j.onpointerdown = (e) => { pid = e.pointerId; j.setPointerCapture(pid); set(e); e.preventDefault(); };
  j.onpointermove = (e) => { if (e.pointerId === pid) set(e); };
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; knob.style.transform = ''; stage3d.setMove(0, 0); };
  j.onpointerup = end; j.onpointercancel = end;
}
function mountWorld() {
  const el = $('#stage'); if (!el) return;
  if (!stage3d.loaded) {
    el.innerHTML = '<p class="muted loading">Opening your closet…</p>';
    loadEngine().then(() => { if ($('#stage') && worldOn()) mountWorld(); }).catch(() => { store.set('flat', '1'); renderTryon(); });
    return;
  }
  el.replaceChildren(); stage3d.attach(el);
  stage3d.setModel({ body: currentBody(), skin: S.skin, hair: S.hair, hairStyle: S.hairStyle, face: { eyes: S.eyes, lips: S.lips } });
  stage3d.setOutfit(outfitItems(S.outfit), S.urls);
  stage3d.setRole(); stage3d.setLabel('Your walk-in closet. Use the stick or the arrow keys to walk, or the buttons below to jump to a wardrobe.');
  stage3d.enterWorld({ stations: worldStations(), onNear: worldNear });
}
function renderWorld() {
  if ($('.room.world')) {
    const sig = S.items.map((i) => i.id + i.type).join();
    if (sig !== S.worldSig && stage3d.loaded) { S.worldSig = sig; stage3d.enterWorld({ stations: worldStations(), onNear: worldNear, keep: true }); } // pieces were added or removed: restock the racks
    return updateWorldUI();
  }
  S.worldSig = S.items.map((i) => i.id + i.type).join();
  const roomKey = S.room === 'auto' || !ROOMS[S.room] ? seasonRoom(new Date().getMonth()) : S.room;
  S.rail = ''; S.dismiss = '';
  $('#main').innerHTML = `<h2 class="view-title sr-only">Walk-in closet</h2>
  <div class="dress">
    <div class="dress-left">
      ${sceneBar()}
      <div class="room closet-scene world theme-${roomKey}">
        <div class="stage" id="stage"></div>
        <div class="closet-hud"></div>
        <p class="world-hint" id="whint" role="status"></p>
        <div class="joy" id="joy" aria-hidden="true"><span class="joy-knob"></span></div>
        <div class="camrot" role="group" aria-label="Look around"><button data-act="camrot" data-v="-1" aria-label="Look left"><span aria-hidden="true">⟲</span></button><button data-act="camrot" data-v="1" aria-label="Look right"><span aria-hidden="true">⟳</span></button></div>
        <div class="world-rail" id="wrail" hidden></div>
      </div>
      <div class="world-jump" role="group" aria-label="Walk to a wardrobe">${[...SECTION_TYPES, 'mirror'].map((t) => `<button class="chip" aria-pressed="false" data-act="gostation" data-v="${t}"><span aria-hidden="true">${t === 'mirror' ? '🪞' : TYPES[t].emoji}</span> ${t === 'mirror' ? 'Mirror' : TYPES[t].label}</button>`).join('')}</div>
    </div>
    <div class="dress-right" id="wbasket"></div>
  </div>`;
  S.lastView = 'tryon'; S.lastRail = '';
  mountWorld(); updateWorldUI(); bindJoystick();
}

function renderWalkIn() {
  if (worldOn()) return renderWorld();
  stage3d.exitWorld();
  if (S.rail && !TYPES[S.rail]) S.rail = '';
  const roomKey = S.room === 'auto' || !ROOMS[S.room] ? seasonRoom(new Date().getMonth()) : S.room;
  const oldRow = $('.rail-row'), keepX = oldRow && S.lastRail === S.rail ? oldRow.scrollLeft : 0, keepY = S.view === S.lastView ? window.scrollY : 0;
  const focus = document.activeElement?.dataset, n = S.basket.length;
  $('#main').innerHTML = `<h2 class="view-title sr-only">Walk-in closet</h2>
  <div class="dress">
    <div class="dress-left">
      ${sceneBar()}
      <div class="room closet-scene theme-${roomKey}">
        <div class="closet-hud">${hudHTML(n)}</div>
        ${S.rail ? railHTML(S.rail) : hallHTML()}
      </div>
    </div>
    <div class="dress-right">${basketPanel()}</div>
  </div>`;
  S.lastRail = S.rail; S.lastView = 'tryon';
  const row = $('.rail-row'); if (row) row.scrollLeft = keepX;
  const hall = $('#hall'), w = $('#walker');
  if (hall && w) { // stand where we last stopped
    const cab = (S.hallType && hall.querySelector(`[data-v="${S.hallType}"]`)) || hall.querySelector('.cabinet');
    const x = S.hallType ? cab.offsetLeft + cab.offsetWidth / 2 : 70;
    w.style.left = x + 'px'; S.hallX = x;
    if (S.hallType) hall.scrollLeft = Math.max(0, x - hall.clientWidth / 2);
  }
  window.scrollTo(0, keepY);
  if (focus?.act) $(`#main [data-act="${focus.act}"]${focus.id ? `[data-id="${focus.id}"]` : focus.v ? `[data-v="${focus.v}"]` : ''}`)?.focus({ preventScroll: true });
}

/** Walk the avatar over to a section, then open its rail. */
function walkTo(type) {
  S.hallType = type;
  const hall = $('#hall'), cab = hall?.querySelector(`[data-v="${type}"]`), w = $('#walker');
  const open = () => { S.rail = type; renderWalkIn(); };
  if (!cab || !w || reducedMotion()) return open();
  const x = cab.offsetLeft + cab.offsetWidth / 2;
  w.classList.toggle('left', x < (parseFloat(w.style.left) || 0)); w.classList.add('walking'); w.style.left = x + 'px';
  hall.scrollTo({ left: Math.max(0, x - hall.clientWidth / 2), behavior: 'smooth' });
  clearTimeout(S.walkT); S.walkT = setTimeout(open, 850);
}

function renderTryon() { return S.scene === 'closet' ? renderWalkIn() : renderMirror(); }

function renderMirror() {
  stage3d.exitWorld();
  if (S.items.length && !S.items.some((i) => i.type === S.tab)) S.tab = S.items[0].type; // land on a shelf that has something
  const old = $('.tray-row'), keepX = old && S.lastTab === S.tab ? old.scrollLeft : 0, keepY = S.view === S.lastView ? window.scrollY : 0;
  const worn = outfitItems(S.outfit);
  const roomKey = S.room === 'auto' || !ROOMS[S.room] ? seasonRoom(new Date().getMonth()) : S.room;
  const stk = wearStreak(S.wears, iso(new Date()));
  const m = outfitMeters(worn, S.mood, wearCounts());
  const fit = S.adjust && itemById(S.adjust) && Object.values(S.outfit).includes(S.adjust) ? itemById(S.adjust) : null;
  const pickList = S.items.filter((i) => i.type === S.tab), counts = wearCounts();
  $('#main').innerHTML = `<h2 class="view-title sr-only">Dress up</h2>
  <div class="dress">
    <div class="dress-left">
      ${sceneBar()}
      <div class="room mirror ${S.cas ? 'cas-open' : ''} ${usingPhoto() ? 'photo' : ''} ${use3D() ? 'is3d' : ''} theme-${roomKey}" style="--gem:${m ? `hsl(${Math.round(20 + m.overall * 1.7)} 90% 60%)` : '#7fd8ff'}">
        <div class="wall" aria-hidden="true"><div class="window"></div><div class="art"></div><div class="plant">${ROOMS[roomKey][1]}</div></div>
        <div class="floor" aria-hidden="true"></div><div class="rug" aria-hidden="true"></div>
        <div class="gem" aria-hidden="true"></div>
        <div class="stage" id="stage">${stageHTML()}</div>
        ${stk ? `<div class="streakbadge" role="status" aria-label="${stk}-day outfit streak"><span aria-hidden="true">🔥</span> ${stk}</div>` : ''}
        ${use3D() ? `<div class="turnbar" role="group" aria-label="Turn the model"><button data-act="turn" data-v="-1" aria-label="Turn left"><span aria-hidden="true">◀</span></button><button data-act="turn" data-v="0">Front</button><button data-act="turn" data-v="1" aria-label="Turn right"><span aria-hidden="true">▶</span></button></div>` : ''}
        ${S.cas ? casHTML() : ''}
      </div>
      <div class="tools" role="group" aria-label="Quick actions">
        <button class="${S.cas ? 'on' : ''}" aria-pressed="${S.cas}" data-act="drawer" data-v="look"><span aria-hidden="true">🎨</span>Customize</button>
        <button data-act="styleme"><span aria-hidden="true">🎲</span>Style me</button>
        <button data-act="clear"><span aria-hidden="true">🧺</span>Undress</button>
        <button data-act="savelook"><span aria-hidden="true">💾</span>Save</button>
        <button class="go" data-act="wearToday"><span aria-hidden="true">📅</span>Wear today</button>
      </div>
      ${metersHTML(worn)}
      <div class="moods" role="group" aria-label="Mood: what’s the occasion?">
        ${OCCASIONS.map((o) => `<button class="chip ${S.mood === o ? 'on' : ''}" aria-pressed="${S.mood === o}" data-act="mood" data-v="${esc(o)}"><span aria-hidden="true">${OCCASION_EMOJI[o]}</span> ${o}</button>`).join('')}
      </div>
      ${weatherLine()}
    </div>
    <div class="dress-right">
      ${picksPanel()}
      <section class="tray" aria-label="Wardrobe">
        <div class="tabs" role="group" aria-label="Clothing type">${Object.entries(TYPES).map(([k, v]) => `<button class="tab ${S.tab === k ? 'on' : ''}" aria-pressed="${S.tab === k}" data-act="tab" data-v="${k}"><span aria-hidden="true">${v.emoji}</span>${v.label}</button>`).join('')}</div>
        ${S.items.length ? `<div class="tray-row">${pickList.length ? pickList.map((i) => `<button class="pick ${S.outfit[slotOf(i.type)] === i.id ? 'on' : ''}" aria-pressed="${S.outfit[slotOf(i.type)] === i.id}" data-act="wear" data-id="${i.id}"><img src="${url(i.id)}" alt=""><span>${esc(i.name)}</span><small>${counts[i.id] ? `worn ${counts[i.id]}×` : 'new'}</small></button>`).join('') : `<p class="muted tray-empty">No ${TYPES[S.tab].label.toLowerCase()} yet — <button class="link" data-act="add">add one</button>.</p>`}</div>` : emptyCloset()}
      </section>
      <section class="drawer" aria-label="Outfit options">
        <div class="seg" role="group" aria-label="Options">${DRAWERS.map(([k, l]) => `<button class="${S.drawer === k ? 'on' : ''}" aria-pressed="${S.drawer === k}" data-act="drawer" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="drawer-body">${drawerHTML(worn, fit)}</div>
      </section>
    </div></div>`;
  S.lastTab = S.tab; S.lastView = 'tryon';
  mountStage(); restoreCachedRender();
  const row = $('.tray-row'); if (row) row.scrollLeft = keepX;
  window.scrollTo(0, keepY);
  $('#main').querySelectorAll('[data-adj]').forEach((r) => {
    r.oninput = () => { fit.adj[r.dataset.adj] = +r.value; refreshStage(); };
    r.onchange = () => put('items', fit);
  });
  if (S.pop) { S.pop = false; sparkle(); }
}

/** A little burst of sparkles when something goes on. */
function sparkle() {
  const st = $('#stage'); if (!st || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 7; i++) {
    const s = document.createElement('span');
    s.className = 'spark'; s.setAttribute('aria-hidden', 'true'); s.textContent = '✨';
    s.style.cssText = `left:${15 + Math.random() * 70}%;top:${10 + Math.random() * 70}%;animation-delay:${i * 60}ms`;
    s.onanimationend = () => s.remove(); st.append(s);
  }
}

/** Log an outfit for a given day from explicit piece ids (used by the week plan). */
async function wearIds(date, ids) {
  const w = { id: uid(), date, itemIds: ids, occasion: S.mood, note: '', createdAt: Date.now() };
  await put('wears', w); S.wears.push(w);
}

async function logWear(date, occasion = '', note = '') {
  const ids = Object.values(S.outfit).filter(itemById);
  if (!ids.length) return toast('Dress the mannequin first');
  const w = { id: uid(), date, itemIds: ids, occasion, note, createdAt: Date.now() };
  if (aiFor(outfitItems(S.outfit))) { w.render = await (await fetch(S.ai.image)).blob(); url('render:' + w.id, w.render); }
  await put('wears', w); S.wears.push(w);
  toast(`Logged for ${date} ✓`);
}

async function makeLookCard() {
  const worn = outfitItems(S.outfit), list = SLOTS.map((s) => worn[s]).filter(Boolean);
  if (!list.length) return toast('Dress the model first');
  const name = $('#lookname')?.value.trim();
  const blob = await lookCard({
    title: name || (S.mood ? `${OCCASION_EMOJI[S.mood]} ${S.mood} look` : 'My look'),
    sub: new Date().toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' }),
    items: list.map((i) => ({ name: i.name, url: url(i.id) })),
    model: use3D() && stage3d.loaded ? stage3d.snapshot() : null,
  });
  const r = await shareOrDownload(blob, `look-${iso(new Date())}.png`, 'My look');
  if (r !== 'cancelled') toast(r === 'shared' ? 'Shared ✓' : 'Look picture saved');
}

/* ───────────────────────── insights ───────────────────────── */
const money = (n) => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;
function insightsHTML(ins) {
  const row = (i, right) => `<div class="logrow"><img src="${url(i.id)}" style="width:32px;height:32px;object-fit:contain;background:var(--tile);border-radius:6px" alt=""> <span class="grow">${esc(i.name)}</span><b>${right}</b></div>`;
  return `<div class="panel"><h3>Closet insights</h3>
    ${ins.pricedCount ? `<p class="muted">${ins.pieces} pieces · <b>${money(ins.value)}</b> invested${ins.avgCostPerWear !== null ? ` · average <b>${money(ins.avgCostPerWear)}</b> per wear` : ''}</p>` : '<p class="muted">Add what you paid for a piece (✎ Edit) to see cost per wear and your best-value buys.</p>'}
    ${ins.bestValue.length ? `<div class="muted">Best value so far</div>${ins.bestValue.map((b) => row(b.item, `${money(b.cpw)}/wear`)).join('')}` : ''}
    ${ins.wearMore.length ? `<div class="muted" style="margin-top:8px">Worth wearing more — you paid for these</div>${ins.wearMore.map((i) => row(i, money(i.price))).join('')}` : ''}
    ${ins.dormant.length ? `<div class="muted" style="margin-top:8px">Declutter check — not worn in 90+ days</div>${ins.dormant.map((d) => row(d.item, d.never ? 'never worn' : `${d.days} days`)).join('')}` : ''}</div>`;
}

/* ───────────────────────── OOTD log ───────────────────────── */
function renderPlanner() {
  const y = S.month.getFullYear(), mo = S.month.getMonth();
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - first.getDay());
  const today = iso(new Date());
  const cells = Array.from({ length: 42 }, (_, n) => {
    const d = new Date(start); d.setDate(start.getDate() + n);
    const k = iso(d), ws = S.wears.filter((w) => w.date === k);
    const last = ws[ws.length - 1];
    return `<button class="day ${d.getMonth() !== mo ? 'off' : ''} ${k === S.date ? 'sel' : ''} ${k === today ? 'today' : ''}" aria-pressed="${k === S.date}" aria-label="${d.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}${ws.length ? `, ${ws.length} outfit${ws.length > 1 ? 's' : ''} logged` : ''}${k === today ? ', today' : ''}" data-act="pickday" data-v="${k}"><b aria-hidden="true">${d.getDate()}</b>${last ? (last.render ? `<img class="render" src="${url('render:' + last.id, last.render)}" alt="">` : mannequin(last.itemIds, 'mini')) : ''}</button>`;
  }).join('');
  const dayWears = S.wears.filter((w) => w.date === S.date);
  const counts = wearCounts();
  const top = [...S.items].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0)).filter((i) => counts[i.id]).slice(0, 3);
  const never = S.items.filter((i) => !counts[i.id] && !['accessories'].includes(i.type)).slice(0, 6);
  const todayIso = iso(new Date()), st = wearStreak(S.wears, todayIso), ins = closetInsights(S.items, S.wears, todayIso);
  $('#main').innerHTML = `<div class="planner"><div>
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <button class="ghost" data-act="month" data-v="-1" aria-label="Previous month">‹</button><h2 class="view-title">${S.month.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2><button class="ghost" data-act="month" data-v="1" aria-label="Next month">›</button></div>
    <div class="cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="dow" aria-hidden="true">${d}</div>`).join('')}${cells}</div></div>
    <div>
      ${st ? `<p class="streak" role="status"><span aria-hidden="true">🔥</span> <b>${st}-day outfit streak</b> — keep it going!</p>` : ''}
      <div class="panel" style="margin-top:0"><h3>${new Date(S.date + 'T12:00').toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
        ${dayWears.map((w) => `<div class="logrow">${w.render ? `<img class="render-thumb" src="${url('render:' + w.id, w.render)}" alt="Photo of this outfit">` : ''}<div class="thumbs">${w.itemIds.map(itemById).filter(Boolean).map((i) => `<img src="${url(i.id)}" alt="${esc(i.name)}" title="${esc(i.name)}">`).join('')}</div>
          <div class="grow muted">${esc(w.occasion || '')}${w.note ? ' — ' + esc(w.note) : ''}</div>
          <button class="ghost danger" data-act="delwear" data-id="${w.id}" aria-label="Delete this entry"><span aria-hidden="true">×</span></button></div>`).join('') || '<p class="muted">Nothing logged for this day.</p>'}
        <h3 style="margin-top:14px">Log an outfit</h3>
        <p class="muted">Uses whatever is on the mannequin in Try On (${Object.keys(S.outfit).length} pieces).</p>
        <select id="wocc" aria-label="Occasion"><option value="">Occasion</option>${OCCASIONS.map((o) => `<option>${o}</option>`).join('')}</select>
        <input type="text" id="wnote" aria-label="Note" placeholder="Note (e.g. got compliments!)" style="margin-top:6px">
        <div class="row" style="margin-top:8px"><button class="primary" data-act="logday">Log it</button><button class="ghost" data-act="tab-tryon">Edit outfit</button></div></div>
      ${insightsHTML(ins)}
      <div class="panel"><h3>Closet stats</h3>
        <div class="muted">Most worn</div>${top.map((i) => `<div class="logrow"><img src="${url(i.id)}" style="width:32px;height:32px;object-fit:contain" alt=""> <span class="grow">${esc(i.name)}</span><b>${counts[i.id]}×</b></div>`).join('') || '<div class="muted">Log some outfits to see this.</div>'}
        ${never.length ? `<div class="muted" style="margin-top:10px">Never worn — give them a turn:</div><div class="thumbs" style="margin-top:4px">${never.map((i) => `<img src="${url(i.id)}" title="${esc(i.name)}" alt="${esc(i.name)}">`).join('')}</div>` : ''}</div>
    </div></div>`;
}

/* ───────────────────────── inspo ───────────────────────── */
function renderInspo() {
  const d = S.inspo;
  $('#main').innerHTML = `<div class="inspo"><div>
    <h2 class="view-title sr-only">Inspo</h2>
    <div class="drop" id="drop" tabindex="0" role="button" aria-label="${d ? 'Replace inspo image' : 'Upload an inspo image'}">${d ? `<img src="${d.url}" alt="Your inspo image">` : '<h3>Drop a Pinterest pic here</h3><p class="muted">Click to upload, drag in, or paste (Ctrl/⌘+V) a screenshot or saved image.</p>'}</div>
    <input type="file" id="ifile" accept="image/*" hidden>
    <label class="f" for="plink">Pin link (optional — kept so you can find it again)</label>
    <input type="url" id="plink" placeholder="https://pinterest.com/pin/…" value="${esc(d?.link || '')}">
    <details class="aibox" style="margin-top:8px"><summary>✨ Fetch the picture from this link (uses your passcode)</summary>
      <label class="f" for="ipass">Passcode</label><input type="password" id="ipass" autocomplete="current-password" value="${esc(store.get('aipass', ''))}">
      <button type="button" class="ghost" data-act="pinfetch" style="margin-top:8px">Fetch from Pinterest</button><div id="pinmsg" class="muted" role="status" aria-live="polite"></div></details>
    <label class="f" for="iocc">Occasion</label>
    <select id="iocc"><option value="">Any</option>${OCCASIONS.map((o) => `<option ${d?.occasion === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <label class="f" id="iwl">Pieces you can see in the photo</label>
    <div class="chips" id="iwant" role="group" aria-labelledby="iwl">${['dress', 'top', 'bottom', 'outer', 'shoes', 'bag'].map((s) => `<button class="chip ${(d?.wanted || ['top', 'bottom', 'shoes']).includes(s) ? 'on' : ''}" aria-pressed="${(d?.wanted || ['top', 'bottom', 'shoes']).includes(s)}" data-s="${s}">${SLOT_LABEL[s]}</button>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="primary" data-act="saveinspo" ${d ? '' : 'disabled'}>📌 Save inspo</button></div>
    ${S.inspos.length ? `<h3 style="margin-top:16px">Saved inspo</h3><div class="inspo-saved">${S.inspos.map((n) => `<button class="thumbbtn" data-act="loadinspo" data-id="${n.id}" aria-label="Open saved inspo${n.occasion ? ' for ' + esc(n.occasion) : ''}"><img src="${url('inspo:' + n.id)}" alt=""></button>`).join('')}</div>` : ''}
  </div><div id="iresult" aria-live="polite">${d ? '' : '<div class="empty"><h2>Shop your own closet</h2><p class="muted">Upload an outfit you love. I’ll pull its colour palette and rebuild the closest look from pieces you already own — and tell you what’s missing.</p></div>'}</div></div>`;

  const drop = $('#drop'), file = $('#ifile');
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
  file.onchange = () => file.files[0] && setInspoFile(file.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); f && setInspoFile(f); };
  $('#plink').oninput = (e) => d && (d.link = e.target.value);
  $('#iocc').onchange = (e) => { if (d) { d.occasion = e.target.value; showMatch(); } };
  $('#iwant').onclick = (e) => {
    const s = e.target.dataset.s; if (!s || !d) return;
    d.wanted = d.wanted.includes(s) ? d.wanted.filter((x) => x !== s) : [...d.wanted, s];
    e.target.classList.toggle('on'); e.target.setAttribute('aria-pressed', d.wanted.includes(s)); showMatch();
  };
  if (d) showMatch();
}

async function setInspoFile(file, extra = {}) {
  try {
    const { img, url: u } = await loadImage(file);
    const raw = toCanvas(img, 700), canvas = document.createElement('canvas'); // flatten onto white so transparent PNGs still have colours
    canvas.width = raw.width; canvas.height = raw.height;
    const cg = canvas.getContext('2d'); cg.fillStyle = '#fff'; cg.fillRect(0, 0, canvas.width, canvas.height); cg.drawImage(raw, 0, 0);
    S.inspo = { blob: file, url: u, palette: palette(canvas, 5, 18), link: '', occasion: '', wanted: ['top', 'bottom', 'shoes'], ...extra };
    renderInspo();
  } catch (e) { toast(e.message); }
}

function showMatch() {
  const d = S.inspo, el = $('#iresult'); if (!d || !el) return;
  const { picks, gaps } = matchInspo(S.items, d.palette, { wanted: d.wanted, occasion: d.occasion, wearCounts: wearCounts() });
  d.picks = Object.fromEntries(Object.entries(picks).map(([s, p]) => [s, p.item.id]));
  const rows = SLOTS.filter((s) => picks[s]).map((s) => `<div class="match"><img src="${url(picks[s].item.id)}" alt=""><div><b>${esc(picks[s].item.name)}</b><div class="muted">${SLOT_LABEL[s]} · ${esc(picks[s].item.color?.name || '')}</div></div><span class="score" aria-label="${picks[s].color} percent colour match">${picks[s].color}%</span></div>`).join('');
  el.innerHTML = `<div class="row" style="align-items:flex-start;gap:20px">
    <div style="flex:0 0 220px"><div class="stage">${mannequin(d.picks)}</div></div>
    <div class="grow" style="min-width:240px"><h3>Inspo palette</h3>
      <div class="pal">${d.palette.map((p) => `<span style="background:${p.hex};flex:${Math.max(p.share, .08)}">${colorName(p.hex)}</span>`).join('')}</div>
      <h3>Your closest look</h3>${rows || '<p class="muted">Nothing in your closet is close enough yet.</p>'}
      ${gaps.map((g) => `<div class="gap">🛍️ You’re missing a <b>${SLOT_LABEL[g.slot].toLowerCase()}</b> like this — look for something in <b>${colorName(g.hex)}</b>. <button class="chip" data-act="wishgap" data-slot="${g.slot}" data-hex="${g.hex}">+ Wishlist</button></div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="primary" data-act="tryinspo" ${rows ? '' : 'disabled'}>Try this on</button></div>
    </div></div>`;
}

/* ───────────────────────── events ───────────────────────── */
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('#nav button');
  if (nav) return go(nav.dataset.view);
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, id, v } = el.dataset;
  if (el.tagName !== 'INPUT') e.preventDefault(); // let checkboxes toggle
  switch (act) {
    case 'add': return openItemModal();
    case 'samples': return loadSamples();
    case 'edit': return openItemModal(itemById(id));
    case 'ftype': S.filter.type = v; return renderCloset();
    case 'tryit': { const it = itemById(id); S.outfit = wear(S.outfit, it); S.tab = it.type; S.adjust = it.id; S.pop = true; S.scene = 'mirror'; return go('tryon'); }
    case 'tab': S.tab = v; return renderTryon();
    case 'scene': clearTimeout(S.walkT); S.scene = v; store.set('scene', v); S.cas = false; return renderTryon();
    case 'section': return walkTo(v);
    case 'hall': if (worldOn()) { S.dismiss = S.rail; S.rail = ''; return updateWorldUI(); } S.rail = ''; return renderWalkIn();
    case 'gostation': S.dismiss = ''; stage3d.walkToStation(v); return;
    case 'railnav': { const k = SECTION_TYPES.length, next = SECTION_TYPES[(SECTION_TYPES.indexOf(S.rail) + (+v) + k) % k]; if (worldOn()) { S.dismiss = ''; stage3d.walkToStation(next); return; } S.rail = next; S.hallType = next; return renderWalkIn(); }
    case 'camrot': stage3d.rotateCam(+v); return;
    case 'grab': { const adding = !S.basket.includes(id); S.basket = adding ? [...S.basket, id] : S.basket.filter((x) => x !== id); if (adding && worldOn()) stage3d.pop(); return renderWalkIn(); }
    case 'ungrab': S.basket = S.basket.filter((x) => x !== id); return renderWalkIn();
    case 'clearbasket': S.basket = []; return renderWalkIn();
    case 'tryon': {
      let o = {}; for (const bid of S.basket) { const it = itemById(bid); if (it) o = wear(o, it); }
      S.outfit = o; S.scene = 'mirror'; store.set('scene', 'mirror'); S.pop = true; S.adjust = null; return renderTryon();
    }
    case 'mix': {
      const by = {}; S.basket.map(itemById).filter(Boolean).forEach((i) => (by[slotOf(i.type)] ||= []).push(i));
      const pick = (a) => a[Math.floor(Math.random() * a.length)], next = {};
      if (by.dress && (!(by.top || by.bottom) || Math.random() < 0.5)) next.dress = pick(by.dress).id;
      else { if (by.top) next.top = pick(by.top).id; if (by.bottom) next.bottom = pick(by.bottom).id; }
      for (const sl of ['outer', 'shoes', 'bag', 'acc']) if (by[sl]) next[sl] = pick(by[sl]).id;
      S.outfit = next; S.adjust = null; S.pop = true; return renderTryon();
    }
    case 'cas': S.casTab = v; return renderTryon();
    case 'casclose': S.cas = false; return renderTryon();
    case 'wear': S.outfit = wear(S.outfit, itemById(id)); S.adjust = id; S.pop = true; return renderTryon();
    case 'turn': return stage3d.turn(+v);
    case 'eyes': S.eyes = v; store.set('eyes', v); return renderTryon();
    case 'lips': S.lips = v; store.set('lips', v); return renderTryon();
    case 'room': S.room = v; store.set('room', v); return renderTryon();
    case 'hairstyle': S.hairStyle = v; store.set('hairstyle', v); return renderTryon();
    case 'bodytype': await setShape({ ...BODY_TYPES[v] }, v); return renderTryon();
    case 'resetlook': S.skin = SKIN[2]; S.hair = HAIR[1]; S.hairStyle = 'long'; S.shape = null; S.shapeName = ''; S.eyes = EYES[0]; S.lips = LIPS[0]; S.room = 'auto'; ['skin', 'hair', 'hairstyle', 'shape', 'shapename', 'eyes', 'lips', 'room'].forEach((k) => store.set(k, '')); return renderTryon();
    case 'export': return exportBackup();
    case 'restore': return $('#restore').click();
    case 'syncconnect': { const k = $('#synckey').value; if (!k.trim()) return toast('Enter your sync key first'); syncConnect(k); if (!(await runSync())) { syncDisconnect(); render(); } return; }
    case 'syncnow': return runSync();
    case 'syncoff': if (confirm('Disconnect? Your closet stays on this device; the cloud copy is left as it is.')) { syncDisconnect(); syncMsg = ''; render(); } return;
    case 'rmsamples': {
      const ids = S.items.filter((i) => i.sample).map((i) => i.id);
      if (!ids.length || !confirm(`Remove the ${ids.length} sample pieces? Your own pieces stay.`)) return;
      await removeItems(ids); toast('Sample pieces removed'); return render();
    }
    case 'wishgap': await wishFromGap(ctx, el.dataset.slot, el.dataset.hex, S.inspo?.occasion); return showMatch();
    case 'sharecard': return makeLookCard();
    case 'gowx': return go('plan');
    case 'mood': S.mood = S.mood === v ? '' : v; return renderTryon();
    case 'drawer': if (v === 'look') S.cas = !S.cas; else S.drawer = v; return renderTryon();
    case 'fit': S.adjust = id; return renderTryon();
    case 'resetfit': { const it = itemById(id); it.adj = { scale: 1, dx: 0, dy: 0 }; await put('items', it); return renderTryon(); }
    case 'airender': return runAIRender();
    case 'airefresh': return runAIRender(true);
    case 'aicancel': return S.aiAbort?.abort();
    case 'aiclear': S.ai = null; return renderTryon();
    case 'display': S.profile.display = v; await put('profile', S.profile); return renderTryon();
    case 'setup': return openModelModal();
    case 'skin': S.skin = v; store.set('skin', v); return renderTryon();
    case 'hair': S.hair = v; store.set('hair', v); return renderTryon();
    case 'clear': S.outfit = {}; return renderTryon();
    case 'styleme': {
      const o = S.mood;
      if (!S.items.length) return toast('Add some pieces first');
      const r = styleMe(S.items, o, wearCounts(), todayWeather(ctx));
      if (!Object.keys(r).length) return toast(`Nothing tagged for ${o} yet`);
      S.outfit = Object.fromEntries(Object.entries(r).map(([s, i]) => [s, i.id]));
      S.pop = true; return renderTryon();
    }
    case 'savelook': {
      if (!Object.keys(S.outfit).length) return toast('Dress the mannequin first');
      const occ = S.mood;
      const o = { id: uid(), name: $('#lookname')?.value.trim() || `Look ${S.outfits.length + 1}`, occasion: occ, outfit: { ...S.outfit } };
      await put('outfits', o); S.outfits.push(o); toast('Look saved ✓'); return renderTryon();
    }
    case 'loadlook': S.outfit = Object.fromEntries(Object.entries(S.outfits.find((o) => o.id === id).outfit).filter(([, v]) => itemById(v))); return renderTryon();
    case 'dellook': await del('outfits', id); S.outfits = S.outfits.filter((o) => o.id !== id); return renderTryon();
    case 'wearToday': S.date = iso(new Date()); S.month = new Date(); await logWear(S.date, S.mood); return renderTryon();
    case 'tab-tryon': return go('tryon');
    case 'month': S.month = new Date(S.month.getFullYear(), S.month.getMonth() + +v, 1); return renderPlanner();
    case 'pickday': S.date = v; return renderPlanner();
    case 'logday': await logWear(S.date, $('#wocc').value, $('#wnote').value.trim()); return renderPlanner();
    case 'delwear': await del('wears', id); S.wears = S.wears.filter((w) => w.id !== id); return renderPlanner();
    case 'saveinspo': {
      const d = S.inspo; if (!d) return;
      const link = /^https?:\/\//i.test(d.link) ? d.link : '';
      const photoCanvas = toCanvas((await loadImage(d.blob)).img, 600);
      const n = { id: d.id || uid(), photo: await canvasToBlob(photoCanvas, 'image/jpeg', 0.85), palette: d.palette, link, occasion: d.occasion, wanted: d.wanted, createdAt: Date.now() };
      await put('inspos', n); S.inspos = S.inspos.filter((x) => x.id !== n.id).concat(n); url('inspo:' + n.id, n.photo);
      toast('Inspo saved ✓'); return renderInspo();
    }
    case 'loadinspo': { const n = S.inspos.find((x) => x.id === id); return setInspoFile(n.photo, { id: n.id, link: n.link, occasion: n.occasion, wanted: n.wanted, palette: n.palette }); }
    case 'pinfetch': {
      const link = $('#plink').value.trim(), pass = $('#ipass').value.trim(), msg = $('#pinmsg');
      if (!link || !pass) { msg.textContent = 'Paste the pin link and enter your passcode.'; return; }
      store.set('aipass', pass); msg.textContent = 'Fetching…';
      try {
        const blob = await (await fetch(await pinAI(link, pass))).blob();
        return setInspoFile(new File([blob], 'pin.jpg', { type: blob.type }), { link });
      } catch (e) { msg.textContent = e.message; return; }
    }
    case 'tryinspo': S.outfit = { ...S.inspo.picks }; S.scene = 'mirror'; return go('tryon');
    default: if (planActs[act]) return planActs[act](ctx, el);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (/^custom-(skin|hair|eyes|lips)$/.test(t.id)) { const k = t.id.slice(7); S[k] = t.value; store.set(k, t.value); mountStage(); }
  if (t.dataset?.shape) { // live: reshape the model while dragging, save when released
    S.shape = { ...(S.shape || BODY_TYPES.Average), [t.dataset.shape]: +t.value }; S.shapeName = 'Custom';
    store.set('shape', JSON.stringify(S.shape)); store.set('shapename', 'Custom'); mountStage();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'aibudget') { store.set('budget', String(Math.max(0, parseFloat(e.target.value) || 0))); renderTryon(); return; }
  if (e.target.id === 'restore' && e.target.files[0]) { importBackup(e.target.files[0]); e.target.value = ''; return; }
  if (/^custom-(skin|hair|eyes|lips)$/.test(e.target.id) || e.target.dataset?.shape) renderTryon(); if (e.target.id === 'flat') { store.set('flat', e.target.checked ? '1' : ''); renderTryon(); } });

document.addEventListener('paste', (e) => {
  if (S.view !== 'inspo') return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) setInspoFile(f);
});
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

/** /?add=paste|link|photo (from an iOS Shortcut) or /?add=shared (a file or link shared into the installed app). */
async function openFromLink() {
  const dl = deepLink(location.search);
  if (!dl) return;
  history.replaceState(null, '', location.pathname);
  if (dl.mode === 'shared') {
    let file = null;
    try { const c = await caches.open('closet-share'); const r = await c.match('/shared/photo'); if (r) { file = new File([await r.blob()], 'shared.png', { type: r.headers.get('content-type') || 'image/png' }); await c.delete('/shared/photo'); } } catch { /* no cache access */ }
    return openItemModal(undefined, { intake: file ? { file } : { mode: 'link', url: dl.url } });
  }
  openItemModal(undefined, { intake: dl });
}

// helpers handed to the Plan tab
const ctx = { S, $, esc, url, toast, put, del, uid, iso, store, itemById, mannequin, wearCounts, go, wearIds, openItemModal: (x, p) => openItemModal(x, p) };

(async () => {
  await load();
  loadForecast(ctx).then(() => { if (S.view === 'tryon') renderTryon(); }); // so "Style me" and the weather chip know today's weather
  render();
  window.__closet = S; // handy for debugging
  window.__stage3d = stage3d;
  try { const m = sessionStorage.getItem('synced'); if (m) { sessionStorage.removeItem('synced'); syncMsg = m; toast(m); } } catch { /* private mode */ }
  if (syncState().on) runSync(); // pick up changes from other devices
  openFromLink();
  try { const n = sessionStorage.getItem('restored'); if (n) { sessionStorage.removeItem('restored'); toast(`Restored ${n} piece${n === '1' ? '' : 's'} from your backup`); } } catch { /* private mode */ }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {}); // lets it install as an app and open offline
})();
