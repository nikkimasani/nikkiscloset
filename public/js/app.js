import { all, get, put, del, uid } from './db.js';
import { lookCard, shareOrDownload } from './sharecard.js';
import { OCCASIONS, OCCASION_EMOJI, SEASONS, TYPES, SLOTS, SLOT_LABEL, slotOf, wear } from './data.js';
import { SECTIONS, HOTSPOTS, sectionOf, layoutSection, artBox, trackLayout, bindCloset } from './closet.js';
import { loadImage, toCanvas, removeBackground, canvasToBlob, trimTransparent } from './cutout.js';
import { palette, colorName } from './color.js';
import { matchInspo, styleMe } from './stylist.js';
import { outfitMeters } from './meters.js';
import { closetInsights, streak as wearStreak } from './insights.js';
import { syncState, connect as syncConnect, disconnect as syncDisconnect, syncNow } from './sync.js';
import { renderPlan, planActs, todayWeather, loadForecast, wishFromGap } from './plan.js';
import { BANDS, toF, weatherEmoji } from './weather.js';
import { PRICE, aiSteps, aiSignature, personImage, garmentImage, renderOutfit, categoryFor, tagAI, pinAI, productAI } from './aitryon.js';
import { fitItem, fitSignature, baseUnder } from './fitting.js';
import { openCutEditor, MODES } from './editor.js';
import { groupOf } from './landmarks.js';
import * as starter from './starter.js';
import * as wearAI from './wear.js';
import { BATCHES as STARTER_BATCHES, ITEMS as STARTER_ITEMS, seedFor } from '../starter/items.js';
import { loadPack, dollSVG, hairOf, fitOf, garmentTransform, isTuckable, imageRect } from './doll.js';
import { guessType, tidyTitle, firstLink, deepLink } from './intake.js';
import { initial as gameInitial, rollOver, pickTheme, rateOutfit, applyRating, spendEnergy, endDay, themeLine, SOURCE_NOTE, PHASES, CATALOG, catalogItem, owns, buy, usePhoto } from './game.js';
import { BACKGROUNDS, POSES, composePhoto, photoBlob } from './photo.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null || v === '' ? d : v; } catch { return d; } } /* '' means "unset" */, set: (k, v) => { try { localStorage.setItem(k, v); if (PREFS.includes(k)) localStorage.setItem('prefs_u', String(Date.now())); } catch { /* private mode */ } } };

let dollFailed = false;
let dollPack = null; // the base picture and its anchor points (null while loading or if it can't be loaded)
const S = {
  items: [], outfits: [], wears: [], inspos: [], profile: null, plans: [], wishlist: [],
  loc: (() => { try { return JSON.parse(store.get('loc', 'null')); } catch { return null; } })(), forecast: null, weatherError: '',
  pack: { days: 3, band: 'auto', moods: [], result: null, checked: new Set() },
  urls: new Map(), fits: new Map(), fitBoxes: new Map(), bases: new Map(), fitMask: new Map(), fitBlobs: new Map(), fitSig: new Map(), fitPending: new Set(),
  view: 'tryon', mood: '', drawer: 'fit', lastTab: '',
  scene: store.get('scene', 'doll') === 'doll' ? 'doll' : 'closet', // 'doll' = Dress up (the mannequin at the mirror); 'closet' = the walk-in closet
  game: (() => { try { return { ...gameInitial(), ...JSON.parse(store.get('game', '{}')) }; } catch { return gameInitial(); } })(),
  events: (() => { try { const e = JSON.parse(store.get('events', '[]')); return Array.isArray(e) ? e : []; } catch { return []; } })(), cas: false, casTab: 'hair', hairStyle: store.get('hairstyle', 'none'), hairColor: store.get('haircolor', 'natural'), dbgPts: store.get('dbgpts', '') === '1', meta: new Map(), // walk-in closet or mirror; which rail is open; pieces grabbed; customizer panel
  filter: { type: 'all', occ: 'all', q: '', src: 'all' },
  outfit: {},                       // slot -> item id (the outfit on the mannequin)
  tab: 'tops', adjust: null,        // try-on picker tab, item being fitted
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
  modalSeq++; S.photoOpen = false;
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
  loadPack().then((p) => { dollPack = p; dollFailed = !p; if (S.view === 'tryon' && S.scene === 'doll') renderTryon(); }); // don't hold up the first screen on the doll's art
  [S.items, S.outfits, S.wears, S.inspos, profiles, S.plans, S.wishlist] = await Promise.all(['items', 'outfits', 'wears', 'inspos', 'profile', 'plans', 'wishlist'].map(all));
  S.profile = profiles[0] || null;
  if (S.profile?.photo) url('profile', S.profile.photo);
  // starter pieces that aren't Ready never reach the closet or the model: they stay in the database until remade (their batch makes them again)
  S.starterReview = S.items.filter((i) => starter.isStarter(i) && !i.ready);
  S.items = S.items.filter((i) => !starter.isStarter(i) || (i.ready && store.get('hidestarter', '') !== '1')); // (hidden ones stay in the database, backups and sync)
  for (const i of S.items) if (starter.isStarter(i) && !i.placedFromAnchors) { delete i.fit; i.adj = { scale: 1, dx: 0, dy: 0 }; i.placedFromAnchors = 1; put('items', i); } // one-time: drop saved drag offsets so starter pieces sit by the body points
  S.items.sort((a, b) => a.createdAt - b.createdAt);
  S.items.forEach((i) => { url(i.id, i.cutout); if (i.backCutout) url(i.id + ':back', i.backCutout); });
  S.inspos.forEach((n) => url('inspo:' + n.id, n.photo));
  Promise.all(S.items.map(analyseItem)).then(() => { if (S.view === 'tryon' && dollPack) mountStage(); });
  recheckStarters(); // the dashed selection box and tap-to-select need each cutout's real bounds
  importPreloaded();
}

/** The preloaded wardrobe (public/starter/made/, made once by the preload workflow): pieces this closet doesn't have yet are added as
 *  Ready starter pieces, replacing flat-lay versions made earlier. One you removed stays removed; hidden starter pieces aren't added. */
async function importPreloaded() {
  if (store.get('hidestarter', '') === '1') return;
  let idx; try { const r = await fetch('/starter/made/index.json', { cache: 'no-cache' }); if (!r.ok) return; idx = await r.json(); } catch { return; }
  if (!idx?.pieces || String(idx.version) === store.get('preloaded', '')) return;
  let removed; try { removed = new Set(JSON.parse(store.get('starter_removed', '[]'))); } catch { removed = new Set(); }
  const pack = dollPack || await loadPack(); if (!pack) return;
  let added = 0;
  for (const [sid, p] of Object.entries(idx.pieces)) {
    const it = STARTER_ITEMS.find((x) => x.id === sid); if (!it || removed.has(sid)) continue;
    if (S.items.some((i) => i.starterId === sid && (i.worn || p.kind !== 'worn' || !starter.isStarter(i)))) continue; // (already here, or one you own)
    try {
      const cutout = await (await fetch(`/starter/made/${sid}.webp?v=${idx.version}`)).blob(); let worn;
      if (p.kind === 'worn') { // where it sits on her: the piece drawn at its place on a picture the size of the model
        const { img, url: u } = await loadImage(cutout), c = document.createElement('canvas'); c.width = pack.size[0]; c.height = pack.size[1];
        c.getContext('2d').drawImage(img, p.box.x, p.box.y, p.box.w, p.box.h); URL.revokeObjectURL(u); worn = await canvasToBlob(c, 'image/png'); c.width = 0;
      }
      const older = S.items.filter((i) => i.starterId === sid && starter.isStarter(i)); if (older.length) await removeItems(older.map((i) => i.id));
      const item = { ...starter.toItem(it, { ready: true, color: p.color, colors: p.colors, cutout, worn }, undefined), id: `pre-${sid}`, placedFromAnchors: 1, preloaded: true };
      await put('items', item); S.items.push(item); url(item.id, item.cutout); analyseItem(item); added++;
    } catch { /* this one is tried again next time */ return; }
  }
  store.set('preloaded', String(idx.version));
  if (added) { render(); toast(`${added} starter piece${added === 1 ? '' : 's'} added to your closet ✓`); }
}

/** Starter pieces approved by an older, looser check are checked again with today's (dress-form scraps, wrong colour) and get their
 *  sleeves from the list. A piece that now fails is cleaned; if it still fails it leaves the closet and the model (its batch remakes it). */
async function recheckStarters() {
  const old = S.items.filter((i) => starter.isStarter(i) && ((i.checkVersion || 1) < starter.CHECK_VERSION || !i.cutout?.size) && i.original); if (!old.length) return; // (and any whose picture didn't save)
  let dropped = 0;
  for (const item of old) {
    const it = STARTER_ITEMS.find((x) => x.id === item.starterId); if (!it) continue;
    try {
      let done = await starter.process(item.original, it); if (!done.check.ok) done = await starter.processCleaned(item.original, it, done.check);
      const sl = starter.sleevesOf(it), sleeves = sl !== undefined && groupOf(it.type) ? sl : item.sleeves;
      if (done.check.ok) Object.assign(item, { cutout: done.cutout, color: done.color, colors: done.colors, sleeves, marks: undefined, checkVersion: starter.CHECK_VERSION }); // landmarks found again, with the sleeves
      else { Object.assign(item, { ready: false, review: done.check.reasons, checkVersion: starter.CHECK_VERSION }); dropped++; }
      await put('items', item);
      if (!item.ready) { S.items = S.items.filter((i) => i.id !== item.id); for (const k of Object.keys(S.outfit)) if (S.outfit[k] === item.id) delete S.outfit[k]; S.starterReview = [...(S.starterReview || []), item]; }
      else { URL.revokeObjectURL(S.urls.get(item.id) || ''); S.urls.delete(item.id); url(item.id, item.cutout); S.meta.delete(item.id); S.fitSig.delete(item.id); await analyseItem(item); }
    } catch { /* leave it as it was */ }
  }
  render(); if (dropped) toast(`${dropped} starter piece${dropped === 1 ? '' : 's'} didn’t pass the new check and went back for remaking`);
}

/** Look at a cutout once: its size, where the visible part is, and a small see-through map so a tap picks the piece you actually touched. */
async function analyseItem(item) {
  if (!item?.cutout) return;
  try {
    const { img, url: u } = await loadImage(item.cutout); URL.revokeObjectURL(u);
    const iw = img.naturalWidth, ih = img.naturalHeight, N = 64, c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data, mask = new Uint8Array(N * N); let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 40) { mask[y * N + x] = 1; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    S.meta.set(item.id, x1 < 0 ? { iw, ih, bx: 0, by: 0, bw: 1, bh: 1, mask, N } : { iw, ih, bx: x0 / N, by: y0 / N, bw: (x1 - x0 + 1) / N, bh: (y1 - y0 + 1) / N, mask, N });
  } catch { /* an unreadable picture just keeps the full box */ }
}

/** slot -> item objects for a {slot: id} map or an id list. */
function outfitItems(src) {
  const ids = Array.isArray(src) ? src : Object.values(src);
  const out = {};
  ids.map(itemById).filter(Boolean).forEach((i) => { out[slotOf(i.type)] = i; queueFit(i); });
  return out;
}

/** The base picture to show under these items: base.png, or (under a short skirt or dress) base.png with the shorts below the hem hidden. */
function baseFor(items) {
  const parts = Object.values(items).filter((i) => (i.type === 'dresses' || i.type === 'skirts') && S.fitBlobs.has(i.id));
  if (!parts.length || !dollPack) return '';
  const key = parts.map((i) => i.id + S.fitSig.get(i.id)).join('|');
  if (S.bases.has(key)) return S.bases.get(key) || '';
  S.bases.set(key, null);
  baseUnder(dollPack, parts.map((i) => S.fitBlobs.get(i.id))).then((u) => { S.bases.set(key, u); if (u) (S.view === 'tryon' ? mountStage() : render()); }).catch(() => {});
  return '';
}

/** A quarter-size see-through map of a fitted picture, so a tap picks the piece you touched. */
async function maskFromBlob(blob) {
  const { img, url: u } = await loadImage(blob); URL.revokeObjectURL(u);
  const w = Math.round(img.naturalWidth / 4), h = Math.round(img.naturalHeight / 4), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { data[y * w + x] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const k = img.naturalWidth / w;
  return { w, h, data, box: x1 < 0 ? null : { x: x0 * k, y: y0 * k, w: (x1 - x0 + 1) * k, h: (y1 - y0 + 1) * k } };
}

/** Fit a worn piece to the body in the background (landmarks are suggested the first time and kept on the piece); the figure redraws when it's ready. */
function queueFit(item) {
  if (!dollPack || !(groupOf(item.type) || item.worn) || !item.cutout) return;
  const sig = fitSignature(item, dollPack), key = item.id + sig;
  if (S.fitSig.get(item.id) === sig || S.fitPending.has(key)) return;
  S.fitPending.add(key);
  fitItem(item, dollPack).then(async (r) => {
    S.fitPending.delete(key);
    if (!r) return;
    const old = S.fits.get(item.id); if (old) setTimeout(() => URL.revokeObjectURL(old), 5000); // (after the figure has redrawn with the new one)
    const fm = await maskFromBlob(r.blob); S.fitMask.set(item.id, fm); if (fm.box) S.fitBoxes.set(item.id, fm.box); S.fits.set(item.id, r.url); S.fitBlobs.set(item.id, r.blob); S.fitSig.set(item.id, sig);
    if (!item.marks && r.marks) { item.marks = r.marks; S.fitSig.set(item.id, fitSignature(item, dollPack)); await put('items', item); }
    clearTimeout(S.fitTimer); S.fitTimer = setTimeout(() => (S.view === 'tryon' ? mountStage() : render()), 60);
  }).catch(() => S.fitPending.delete(key));
}
const usingPhoto = () => !!(S.profile?.photo && S.profile.display === 'photo');
const aiFor = (items) => { const st = aiSteps(items); return S.ai && usingPhoto() && st.length && S.ai.sig === aiSignature(st) ? st.map(([slot]) => slot) : null; };
/** The model wearing an outfit, small (calendar days, inspo matches). */
/** Your chosen hairstyle and colour, ready for dollSVG. */
const hairMarks = () => { try { return JSON.parse(store.get('hairmarks', '{}')); } catch { return {}; } }; // your own "Adjust fit" landmarks, per style
const myHair = () => hairOf(dollPack, S.hairStyle, S.hairColor, hairMarks());
function figure(src, cls = '') { return dollPack ? dollSVG({ pack: dollPack, items: outfitItems(src), urls: S.urls, hair: myHair(), fits: S.fits, base: baseFor(outfitItems(src)), fitBoxes: S.fitBoxes, meta: S.meta, cls }) : ''; }
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
  if (S.view !== 'tryon') S.lastView = S.view;
  document.body.classList.toggle('wic-on', S.view === 'tryon' && S.scene === 'closet');
  if (S.view !== 'tryon' || S.scene === 'closet') document.body.classList.remove('dsheet');
  ({ closet: renderCloset, tryon: renderTryon, plan: () => renderPlan(ctx), planner: renderPlanner, inspo: renderInspo })[S.view]();
}

/* ───────────────────────── closet ───────────────────────── */
function renderCloset() {
  const { type, occ, q, src } = S.filter;
  const counts = Object.fromEntries(Object.keys(TYPES).map((t) => [t, S.items.filter((i) => i.type === t).length]));
  const shown = S.items.filter((i) =>
    (type === 'all' || i.type === type) && (occ === 'all' || i.occasions.includes(occ)) && (src === 'all' || (src === 'starter') === starter.isStarter(i)) &&
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
    ${S.items.some(starter.isStarter) ? `<div class="chips srcchips" style="margin-top:12px" role="group" aria-label="Whose pieces">${[['all', 'All'], ['mine', 'Mine'], ['starter', 'Starter']].map(([k, l]) => `<button class="chip ${src === k ? 'on' : ''}" aria-pressed="${src === k}" data-act="fsrc" data-v="${k}">${l} · ${S.items.filter((i) => k === 'all' || (k === 'starter') === starter.isStarter(i)).length}</button>`).join('')}</div>` : ''}
    <div class="chips" style="margin-top:12px" role="group" aria-label="Filter by type">
      <button class="chip ${type === 'all' ? 'on' : ''}" aria-pressed="${type === 'all'}" data-act="ftype" data-v="all">All</button>
      ${Object.entries(TYPES).map(([k, v]) => `<button class="chip ${type === k ? 'on' : ''}" aria-pressed="${type === k}" data-act="ftype" data-v="${k}">${v.label} · ${counts[k]}</button>`).join('')}
    </div>
    ${rails || emptyCloset()}
    ${addPanel()}
    ${starterPanel()}
    <section class="panel" aria-label="Backup and restore"><h3>Backup &amp; restore</h3>
      <p class="muted">Your closet is stored in this browser only. Save a backup file so clearing your browser or changing phones doesn’t lose it.</p>
      <div class="row"><button class="ghost" data-act="export">⬇ Save backup</button><button class="ghost" data-act="restore">⬆ Restore backup</button>
      ${S.items.some((i) => i.sample) ? '<button class="ghost danger" data-act="rmsamples">Remove old sample pieces</button>' : ''}</div>
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
      <button class="primary" data-act="add">+ Add your first piece</button></div></div>`;
}

function pieceCard(i) {
  const worn = wearCounts()[i.id] || 0;
  return `<article class="piece ${starter.isStarter(i) ? 'is-starter' : ''}">${hanger}${starter.isStarter(i) ? '<span class="starterbadge">Starter</span>' : ''}
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
    const pick = !d.canvas && (!existing || d.newPhoto); // step 1: where the photo comes from
    if (pick) {
      const m = MODES[d.capture || 'flat'];
      paintSheet(`${preset.type && TYPES[d.type] ? `<p class="muted" id="addingtype">Adding: <b>${esc(TYPES[d.type].label)}</b>${d.name ? ` · ${esc(d.name)}` : ''}</p>` : ''}
      <div class="modechips" role="radiogroup" aria-label="How is the photo taken?">${Object.entries(MODES).map(([k, v]) => `<button type="button" role="radio" aria-checked="${(d.capture || 'flat') === k}" class="${(d.capture || 'flat') === k ? 'on' : ''}" data-mode="${k}"><span aria-hidden="true">${v.icon}</span> ${v.label.replace(' / mirror photo', '')}${v.rec ? '<small>Recommended</small>' : ''}</button>`).join('')}</div>
      <div class="tipbox"><h3>Tips: ${esc(m.label.toLowerCase())}</h3><ul>${m.tip.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="intake addsrc" role="group" aria-label="Where is the photo?">
        <button type="button" class="srcbtn" id="srccam"><span aria-hidden="true">📷</span> Take photo</button>
        <button type="button" class="srcbtn" id="srcpick"><span aria-hidden="true">🖼️</span> Choose photo</button>
        <button type="button" class="srcbtn" id="srcpaste"><span aria-hidden="true">📋</span> Paste</button>
        <button type="button" class="srcbtn ${d.linkOpen ? 'on' : ''}" id="srclink" aria-expanded="${d.linkOpen}"><span aria-hidden="true">🔗</span> From a link</button>
      </div>
      <input type="file" id="file" accept="image/*" hidden><input type="file" id="camfile" accept="image/*" capture="environment" hidden>
      ${d.linkOpen ? `<div class="linkrow"><label class="f" for="plink2">Product page or Pinterest pin link(s)</label>
        <div class="row"><textarea id="plink2" class="grow" rows="2" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="A shop page or Pinterest pin. Paste several (one per line) to add them one after another.">${esc(d.link || '')}</textarea><button type="button" class="ghost" id="linkgo">Get picture</button></div>
        ${store.get('aipass', '') ? '' : '<label class="f" for="lpass">Passcode</label><input type="password" id="lpass" autocomplete="current-password">'}</div>` : ''}
      <div id="intakemsg" class="muted" role="status" aria-live="polite">${esc(d.busy || 'Screenshots from shopping apps work too: you’ll crop to the product next. You can also paste (Ctrl/⌘+V) or share a link.')}</div>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="ghost" id="cancel">Cancel</button></div>`, existing ? 'New photo' : 'Add a piece');
      return wirePick();
    }
    const cut = d.cutoutUrl || (existing && url(existing.id));
    paintSheet(`
      <div class="cutprev"><img id="cutimg" src="${cut}" alt="The cut-out piece">
        <div class="col">${d.source || existing?.original ? '<button type="button" class="ghost" id="tapcut">✂️ Redo the selection</button>' : ''}
          ${groupOf(d.type) ? '<button type="button" class="ghost" id="editmarks">📍 Fit landmarks</button>' : ''}
          <button type="button" class="ghost" id="newphoto">📷 Use a new photo</button>
          ${d.engine ? `<span class="muted">${d.engine === 'sam2' ? 'Selected with SAM 2' : 'Selected on this device'}</span>` : ''}</div></div>
      <div class="aibox"><div class="muted"><b>✨ Auto-fill</b> — name, type and occasions from the photo (a little of your fal credit). With your passcode saved it runs on every new piece.</div>
        <label class="row" style="margin-top:6px"><input type="checkbox" id="aiauto" ${store.get('aiauto', '1') !== '0' ? 'checked' : ''}> Run automatically</label>
        <label class="f" for="mpass">Passcode</label><input type="password" id="mpass" autocomplete="current-password" value="${esc(store.get('aipass', ''))}">
        <div class="row" style="margin-top:8px"><button type="button" class="ghost" id="aitag">Auto-fill details</button></div>
        <div id="aimsg" class="muted" role="status" aria-live="polite">${esc(d.tagMsg || '')}</div></div>
      <div class="backbox"><label class="f" for="backfile">Back photo (optional)</label>
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
      <div class="cswatches" role="group" aria-label="Colours found in the photo">${d.palette.map((c) => `<button type="button" class="cswatch ${d.color?.hex === c.hex ? 'on' : ''}" data-hex="${c.hex}" style="background:${c.hex}" aria-label="${esc(colorName(c.hex))}" aria-pressed="${d.color?.hex === c.hex}"></button>`).join('')}<input type="color" id="color" value="${d.color?.hex || '#888888'}" aria-label="Pick any colour" style="width:44px;height:34px;padding:0;border:0;background:none"></div>
      <div class="row" style="margin-top:18px;justify-content:space-between">
        <span class="row">${existing ? `<button class="ghost danger" id="rm">${starter.isStarter(existing) ? 'Remove' : 'Delete'}</button>` : ''}${starter.isStarter(existing) ? '<button class="ghost" id="ownit">✓ I own this</button>' : ''}</span>
        <span class="row"><button class="ghost" id="cancel">Cancel</button>${existing ? '' : '<button class="ghost" id="saveadd">Save &amp; add another</button>'}<button class="primary" id="save">Save to closet</button></span></div>`, existing ? 'Edit piece' : 'Add a piece');
    wire();
  };

  /** The colours of the cut-out piece (its main colour is suggested unless you picked one). */
  const recolour = () => {
    if (!d.canvas) return;
    d.palette = palette(d.canvas, 4).filter((c) => c.share > 0.04);
    const pal = d.palette[0];
    if (pal && !d.colorPicked) d.color = { hex: pal.hex, name: colorName(pal.hex) };
  };

  const say = (m) => { d.busy = m; const el = $('#intakemsg'); if (el) el.textContent = m; };
  /** A photo came in: crop it, select the piece, fit it (the editor), then the details. */
  const ingestFile = async (f, meta = {}) => {
    try {
      const { img, url: u } = await loadImage(f);
      d.source = u; d.base = toCanvas(img); d.photoSeq = (d.photoSeq || 0) + 1; d.colorPicked = false; d.busy = ''; d.fromShop = !!meta.title; // a shop's own title and category beat the AI's guess
      const title = meta.title || f.name?.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 40) || '';
      if (!d.name.trim() || d.autoName) { d.name = meta.title ? tidyTitle(meta.title, meta.brand) : /^(pasted|image|img|photo|screenshot)\b/i.test(title) ? '' : title; d.autoName = !!d.name; }
      if (meta.brand && !d.brand.trim()) d.brand = meta.brand;
      if (meta.price && d.price === '') d.price = String(meta.price);
      const guess = guessType(`${meta.title || ''} ${title}`);
      if (guess && !existing) { d.type = guess; d.typeGuess = true; }
      d.tagMsg = '';
      await runEditor(f);
    } catch (err) { toast(err.message); }
  };
  const runEditor = async (blob) => {
    const r = await openCutEditor({ blob, name: d.name, type: d.type, capture: d.capture, sleeves: d.sleeves });
    if (!r) return paint(); // back to where the photo comes from
    await adopt(r, true); autoAI();
  };
  const adopt = async (r, withCut) => {
    d.type = r.type; d.marks = r.marks; d.marksType = r.type; d.sleeves = r.sleeves; d.capture = r.capture; d.marksSet = true; d.newPhoto = false;
    if (withCut) {
      const img = new Image(); img.src = URL.createObjectURL(r.cutout); await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(img.src);
      d.canvas = c; d.original = r.original; d.engine = r.engine; d.cutoutUrl = c.toDataURL('image/png'); recolour();
    }
    paint();
  };
  // With a saved passcode, a new piece is described by the AI on its own.
  const autoAI = () => { const pass = store.get('aipass', ''); if (pass && store.get('aiauto', '1') !== '0' && d.canvas) runTag(pass); };
  const aiBusy = (msg) => { const el = $('#aimsg'); if (el) el.textContent = msg; if ($('#aitag')) $('#aitag').disabled = !!msg.endsWith('…'); };
  const runTag = async (pass) => {
    aiBusy('Looking at it…');
    const seq = modalSeq, photo = d.photoSeq;
    try {
      const t = await tagAI(d.canvas || d.base, pass), bits = [];
      if (seq !== modalSeq || photo !== d.photoSeq) return;
      if (t.name && !d.fromShop && (!d.name.trim() || d.autoName)) { d.name = t.name; d.autoName = false; bits.push(t.name); }
      if (t.type && !(d.fromShop && d.typeGuess) && !d.marksSet) { d.type = t.type; d.typeGuess = false; bits.push(TYPES[t.type].label); }
      if (t.season) d.season = t.season;
      if (t.occasions.length) { d.occasions = t.occasions; bits.push(t.occasions.join(', ')); }
      if (t.brand && !d.brand.trim()) d.brand = t.brand;
      d.tagMsg = bits.length ? `Filled in: ${bits.join(' · ')}. Check it and edit anything that’s off.` : 'The AI couldn’t tell much from that photo.';
      paint();
    } catch (e) { if (seq === modalSeq) aiBusy(e.message); }
  };
  const fromData = async (dataUri, meta) => ingestFile(await (await fetch(dataUri)).blob(), meta);
  const fetchLink = async (link) => {
    const pass = store.get('aipass', '') || $('#lpass')?.value.trim();
    if (!pass) { d.linkOpen = true; d.link = link; paint(); say('Enter your passcode to fetch links.'); $('#lpass')?.focus(); return; }
    store.set('aipass', pass); d.link = link; say('Opening the page…'); const seq = modalSeq;
    try {
      if (/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/i.test(new URL(link).hostname)) { // a pin is inspiration, not a piece: it opens in Inspo, where its pieces can be made for the model
        const image = await pinAI(link, pass); if (seq !== modalSeq) return;
        const blob = await (await fetch(image)).blob(); closeModal(); go('inspo');
        toast('Pins are inspiration: make pieces like these for your model here'); return setInspoFile(new File([blob], 'pin.jpg', { type: blob.type }), { link });
      }
      const r = await productAI(link, pass);
      if (seq !== modalSeq) return;
      d.linkOpen = false; toast(r.title ? `Got “${tidyTitle(r.title, r.brand)}” from ${r.host}` : `Got the picture from ${r.host}`);
      await fromData(r.image, { title: r.title, brand: r.brand, price: r.price });
    } catch (err) { if (seq === modalSeq) say(`${err.message} You can also save the picture and use Choose photo.`); }
  };
  // Paste: ⌘/Ctrl+V anywhere in the dialog, or the button (iPhone Safari asks "Allow Paste" once per paste)
  const takeClipboard = async (items, text) => {
    const img = items.find((x) => x.type?.startsWith('image/'));
    if (img) return ingestFile(img);
    const l = firstLink(text); if (l) return fetchLink(l);
    say('Nothing usable on the clipboard. Copy a picture or a product link first, then tap Paste.');
  };
  if (!d.pasteHook) {
    d.pasteHook = (e) => {
      if (modalSeq !== seq0 || $('#modal').hidden) return document.removeEventListener('paste', d.pasteHook);
      if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'file' && !e.clipboardData?.files?.length) return; // normal typing paste
      e.preventDefault(); takeClipboard([...(e.clipboardData?.files || [])], e.clipboardData?.getData('text') || '');
    };
    document.addEventListener('paste', d.pasteHook);
  }

  function wirePick() {
    $('#cancel').onclick = () => (existing && d.newPhoto ? (d.newPhoto = false, paint()) : closeModal());
    document.querySelectorAll('.modechips [data-mode]').forEach((b) => (b.onclick = () => { d.capture = b.dataset.mode; paint(); $(`.modechips [data-mode="${d.capture}"]`)?.focus(); }));
    $('#file').onchange = (e) => { const f = e.target.files[0]; if (f) ingestFile(f); };
    $('#camfile').onchange = (e) => { const f = e.target.files[0]; if (f) ingestFile(f); };
    $('#srcpick').onclick = () => $('#file').click();
    $('#srccam').onclick = () => $('#camfile').click();
    $('#srclink').onclick = () => { d.linkOpen = !d.linkOpen; paint(); if (d.linkOpen) $('#plink2').focus(); };
    if ($('#linkgo')) { $('#linkgo').onclick = () => {
      const all = [...new Set(($('#plink2').value.match(/https?:\/\/[^\s<>"')]+/gi) || []).map((x) => x.replace(/[.,;!?]+$/, '')))];
      if (!all.length) return say('Paste a link that starts with https://');
      d.queue = all.slice(1); if (d.queue.length) toast(`${all.length} links: you’ll add them one after another`);
      fetchLink(all[0]); }; $('#plink2').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#linkgo').click(); } }; }
    $('#srcpaste').onclick = async () => {
      try {
        const clip = await navigator.clipboard.read(), files = [];
        for (const it of clip) { const t = it.types.find((x) => x.startsWith('image/')); if (t) files.push(new File([await it.getType(t)], 'pasted.png', { type: t })); }
        let text = ''; if (!files.length) { const tt = clip.flatMap((it) => (it.types.includes('text/plain') ? [it] : []))[0]; text = tt ? await (await tt.getType('text/plain')).text() : ''; }
        takeClipboard(files, text);
      } catch { try { takeClipboard([], await navigator.clipboard.readText()); } catch { say('Your browser blocked reading the clipboard. Press ⌘/Ctrl+V in this window, or use Choose photo.'); } }
    };
    if (d.pending) { // opened from a deep link or a shared file
      const p = d.pending; d.pending = null;
      if (p.file) ingestFile(p.file);
      else if (p.mode === 'link') { d.linkOpen = true; d.link = p.url; d.queue = p.queue || []; if (p.url) fetchLink(p.url); else { paint(); $('#plink2')?.focus(); } }
      else if (p.mode === 'paste') { say('Tap Paste to bring in what you copied.'); $('#srcpaste').focus(); }
    }
  }

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
    $('#type').onchange = (e) => { d.type = e.target.value; d.typeGuess = false; if (d.marksSet && groupOf(d.type) !== groupOf(d.marksType)) d.marksSet = false; paint(); };
    $('#color').oninput = (e) => { d.color = { hex: e.target.value, name: colorName(e.target.value) }; d.colorPicked = true; };
    $('#backfile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const { img } = await loadImage(f);
        d.backCanvas = trimTransparent(removeBackground(toCanvas(img), { tolerance: 42 }));
        d.backUrl = d.backCanvas.toDataURL('image/png'); d.backBlob = null; paint();
      } catch (err) { toast(err.message); }
    };
    if ($('#backrm')) $('#backrm').onclick = () => { d.backCanvas = null; d.backBlob = null; d.backUrl = ''; paint(); };
    if ($('#aiauto')) $('#aiauto').onchange = (e) => store.set('aiauto', e.target.checked ? '1' : '0');
    const mpass = () => { const v = $('#mpass').value.trim(); if (!v) { toast('Enter your passcode first'); return null; } store.set('aipass', v); return v; };
    if ($('#aitag')) $('#aitag').onclick = () => { const pass = mpass(); if (pass) runTag(pass); };
    $('#newphoto').onclick = () => { d.newPhoto = true; d.canvas = null; d.cutoutUrl = ''; paint(); };
    if ($('#tapcut')) $('#tapcut').onclick = async () => runEditor(d.source ? await (await fetch(d.source)).blob() : existing.original);
    $('#editmarks') && ($('#editmarks').onclick = async () => {
      const r = await openCutEditor({ start: 'marks', name: d.name, cutout: d.canvas ? await canvasToBlob(d.canvas, 'image/png') : existing.cutout, type: d.type, marks: d.marksSet ? d.marks : existing?.type === d.type ? existing.marks : null, sleeves: d.marksSet ? d.sleeves : existing?.sleeves, capture: d.capture || existing?.capture });
      if (r) await adopt(r, false);
    });
    $('.cswatches').onclick = (e) => { const h = e.target.dataset?.hex; if (!h) return; d.color = { hex: h, name: colorName(h) }; d.colorPicked = true; paint(); };
    if ($('#ownit')) $('#ownit').onclick = async () => { // a starter piece becomes yours: same picture and tags, no longer marked Starter
      const it = { ...existing, source: 'own', updatedAt: Date.now() }; await put('items', it); S.items = S.items.map((i) => (i.id === it.id ? it : i));
      closeModal(); render(); toast(`“${it.name}” is yours now ✓`);
    };
    if ($('#rm')) $('#rm').onclick = async () => {
      if (!confirm(`Delete “${existing.name}” from your closet?`)) return;
      await removeItems([existing.id], { byYou: true });
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
        marks: d.marksSet ? d.marks || undefined : existing && existing.type === d.type ? existing.marks : undefined, // landmarks are suggested again if the category changed
        sleeves: d.marksSet ? d.sleeves : existing?.sleeves, capture: d.capture || existing?.capture, original: d.original || existing?.original,
      };
      await put('items', item);
      if (existing) { S.urls.delete(item.id); S.items = S.items.map((i) => (i.id === item.id ? item : i)); } else S.items.push(item);
      S.urls.delete(item.id + ':back'); if (backCutout) url(item.id + ':back', backCutout);
      url(item.id, item.cutout); S.meta.delete(item.id); await analyseItem(item);
      if (preset.onSaved) await preset.onSaved(item);
      closeModal(); render();
      if (d.queue?.length) { const [next, ...rest] = d.queue; toast(`Saved “${item.name}” ✓ — ${d.queue.length} to go`); return openItemModal(undefined, { intake: { mode: 'link', url: next, queue: rest } }); }
      toast(existing ? 'Updated ✓' : again ? `Saved “${item.name}” ✓ — next one` : 'Added to your closet ✓');
      if (again) openItemModal(undefined, { type: item.type });
    };
    $('#save').onclick = () => save(false);
    if ($('#saveadd')) $('#saveadd').onclick = () => save(true);
  }
  paint();
}

/** Delete pieces everywhere they're referenced: closet, current outfit, saved looks, and cached images. */
async function removeItems(ids, { byYou = false } = {}) {
  const gone = new Set(ids);
  if (byYou) { // a preloaded piece you remove stays removed
    let removed; try { removed = JSON.parse(store.get('starter_removed', '[]')); } catch { removed = []; }
    const sids = S.items.filter((i) => gone.has(i.id) && i.starterId).map((i) => i.starterId); if (sids.length) store.set('starter_removed', JSON.stringify([...new Set([...removed, ...sids])]));
  }
  for (const id of ids) { await del('items', id); for (const key of [id, id + ':back']) { const u = S.urls.get(key); if (u) { URL.revokeObjectURL(u); S.urls.delete(key); } } }
  S.items = S.items.filter((i) => !gone.has(i.id));
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
/** Closet > Starter closet: generate the starter pieces one batch (category) at a time on Cloudflare's free tier, with the neuron budget shown. */
function starterPanel() {
  const all = S.items.filter(starter.isStarter).length, hidden = store.get('hidestarter', '') === '1', each = starter.NEURONS_EACH, used = Math.round(starter.usedToday());
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  return `<section class="panel" aria-label="Starter closet"><h3>Starter closet</h3>
    <p class="muted">A wardrobe made for your model from your style profile (chic neutral casual + polished workwear). Clothes and shoes are drawn on her, wearing them, so they fit her exactly and swap in and out in Dress Up; bags and accessories are product photos. The whole wardrobe comes preloaded once it’s made (pieces are added automatically, no neurons used on your phone); the buttons below remake a category or fill gaps. Pieces made earlier as flat photos are remade on her when you open their category. For more ideas, open a pin in <b>Inspo</b> and make the pieces in it. Each is marked <span class="starterbadge inline">Starter</span>; tap one to keep it as yours (<b>I own this</b>) or remove it.</p>
    <p class="muted">Made with Cloudflare Workers AI on the free tier: about ${each} neurons a picture, ${fmt(each * 20)} a batch of 20, ${fmt(each * STARTER_ITEMS.length)} for all ${STARTER_ITEMS.length} (free: ${fmt(starter.DAILY_FREE)} a day). <b>Used today: ${fmt(used)}</b>. If the day’s allowance runs out, progress is kept and the batch carries on after 00:00 UTC. Needs your passcode.</p>
    <div class="starterbatches">${STARTER_BATCHES.map(([k, l, e]) => { const left = starter.missingIn(k, S.items).length, n = STARTER_ITEMS.filter((i) => i.batch === k).length;
      return `<button class="ghost" data-act="starterbatch" data-v="${k}" ${left && !hidden ? '' : 'disabled'}><span aria-hidden="true">${e}</span> ${l} <small>${left ? `${left} to make · ~${fmt(left * each)} neurons` : `all ${n} in`}</small></button>`; }).join('')}</div>
    ${(() => { const r = S.items.filter(starter.isStarter).length, rv = (S.starterReview || []).length; return `<p class="starterready" role="status"><b>${r} of ${STARTER_ITEMS.length} ready</b> · ${rv} need review (kept off the model; open their category to remake them) · ${STARTER_ITEMS.length - r - rv} not made yet</p>${rv ? `<button class="ghost danger" data-act="rmstarterreview">Delete the ${rv} that need review</button>` : ''}`; })()}
    <label class="check"><input type="checkbox" data-act="hidestarter" ${hidden ? 'checked' : ''}> Hide all starter pieces${all || hidden ? '' : ' (none yet)'}</label></section>`;
}

/** Does a starter piece go on the mannequin? Clothing must warp onto the body; shoes need the feet box, bags and accessories a body point. */
async function starterFits(it, done) {
  if (done.worn) return { ok: true }; // made on the model
  const pack = dollPack || await loadPack(); if (!pack) return { ok: false };
  if (groupOf(it.type)) { const r = await fitItem({ id: it.id, type: it.type, name: it.name, cutout: done.cutout }, pack).catch(() => null); if (r) URL.revokeObjectURL(r.url); return { ok: !!r, marks: r?.marks }; }
  return { ok: it.type === 'shoes' ? !!pack.anchors?.shoes : !!(it.acc && pack.accRules?.[it.acc]) };
}

/** One batch: make the pieces still missing (reusing pictures saved earlier), check each one (remade automatically up to twice if it fails)
 *  and try it on the mannequin, then show them in a review grid (tap one to make it again) and add them only when approved.
 *  At the daily limit it pauses, keeps what's made, and carries on after 00:00 UTC. Each tile only ever shows its own picture. */
async function openStarterBatch(batch) {
  const pass = store.get('aipass', '') || prompt('Your passcode (the APP_PASSCODE set in Vercel):')?.trim();
  if (!pass) return; store.set('aipass', pass);
  const list = starter.missingIn(batch, S.items), label = STARTER_BATCHES.find(([k]) => k === batch)?.[1] || batch, log = [];
  const tiles = new Map(list.map((it) => [it.id, { it, state: 'wait', url: '', done: null, original: null, err: '', fresh: false, attempt: 0 }]));
  await starter.refreshUsage(pass); // today's count from the server, so a batch never starts past the free allowance
  openModal(); const seq = modalSeq, closed = () => modalSeq !== seq; let resetAt = 0, timer = 0; // (Esc or Cancel closes it; what's made is kept)
  const left = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const note = (t, e) => { const line = { piece: t.it.id, ...e }; log.push(line); console.info('[starter]', line); };
  const tile = (t) => {
    const busy = t.state === 'run' || (t.state === 'wait' && !resetAt), r = t.done?.ready;
    const pic = t.url ? `<img src="${t.url}" alt="">` : `<span class="spin" aria-hidden="true">${t.state === 'err' ? '⚠️' : t.state === 'wait' && resetAt ? '🌙' : '⏳'}</span>`;
    const tag = t.state === 'ok' ? (r ? '<b class="ok">✓ Ready</b>' : `<b class="rev">Needs review</b><em>${esc(t.done.why.join('; '))}</em>`) : t.state === 'err' ? `<b class="rev">Failed · Retry</b><em>${esc(t.err)}</em>` : t.state === 'run' && t.attempt ? `<em>remaking (try ${t.attempt + 1})</em>` : '';
    return `<button class="startertile ${t.state} ${t.state === 'ok' ? (r ? 'ready' : 'review') : ''}" data-id="${t.it.id}" ${busy ? 'disabled' : ''} aria-label="${esc(t.it.name)}${t.state === 'ok' ? (r ? ', ready' : ', needs review') + ', tap to make it again' : t.state === 'err' ? ', failed, tap to retry' : ', in progress'}">${pic}<small>${esc(t.it.name)}</small>${tag}</button>`;
  };
  const paint = () => {
    if (closed()) return clearTimeout(timer);
    const T = [...tiles.values()], made = T.filter((t) => t.state === 'ok'), ready = made.filter((t) => t.done.ready).length, busy = T.some((t) => t.state === 'run' || (t.state === 'wait' && !resetAt));
    const status = resetAt ? `<p class="limitnote" role="status">⏸ Today’s free Cloudflare allowance is used up. ${made.length} of ${tiles.size} made and saved; the rest carry on after 00:00 UTC (in ${left(resetAt - Date.now())}). You can approve these now or leave this open.</p>` : '';
    paintSheet(`${status}<p class="muted">${busy ? `Making ${label.toLowerCase()}… ` : ''}<b>${ready} ready</b>, ${made.length - ready} need review, ${T.length - made.length} to go. Clothes and shoes are drawn on your model, wearing them, and only the piece is kept, so it fits her exactly; bags and accessories are product photos (checked for a plain background and an AI look for mannequins). Tap a picture to make it again. Only <b>ready</b> pieces are added when you approve; the rest stay here to remake. <span class="nowrap">Neurons used today: ${Math.round(starter.usedToday()).toLocaleString('en-US')} of ${starter.DAILY_FREE.toLocaleString('en-US')}.</span></p>
      <div class="startergrid">${T.map(tile).join('')}</div>
      <details class="starterlog"><summary>Log (${log.length})</summary><ol>${log.map((l) => `<li><code>${esc(l.piece)}</code> try ${l.attempt + 1} · seed ${l.seed} · ${l.from === 'saved' ? 'saved picture reused' : l.from === 'cleaned' ? 'cutout cleaned (skin, form and stray parts removed)' : `HTTP ${l.status}${l.bytes ? ` · ${Math.round(l.bytes / 1024)} KB` : ''}${l.ms ? ` · ${(l.ms / 1000).toFixed(1)}s` : ''}`}${l.key ? ` · saved as <code>${esc(l.key)}</code>` : ''} · ${l.error ? `error: ${esc(l.error)}` : l.check ? (l.check.ok ? 'check passed' : 'check failed: ' + esc(l.check.reasons.join('; '))) : ''}${l.fits === undefined ? '' : l.fits ? ' · fits' : ' · does not fit'}${l.prompt ? `<br><small>${esc(l.prompt)}</small>` : ''}</li>`).join('')}</ol></details>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="ghost" id="sbcancel">${made.length ? 'Later' : 'Cancel'}</button><button class="primary" id="sbok" ${ready && !T.some((t) => t.state === 'run') ? '' : 'disabled'}>Approve · add ${ready} ready</button></div>`, `Starter ${label.toLowerCase()}`);
    $('#sbcancel').onclick = () => closeModal();
    $('#sbok').onclick = async () => {
      const add = [...tiles.values()].filter((t) => t.state === 'ok' && t.done.ready); closeModal(); clearTimeout(timer); // pieces that need review stay out (their pictures are kept: open the batch again to remake them)
      for (const t of add) { const item = { ...starter.toItem(t.it, t.done, t.original), ...(t.done.marks && { marks: t.done.marks }), placedFromAnchors: 1 }; await put('items', item); S.items.push(item); url(item.id, item.cutout); analyseItem(item); starter.dropDraft(t.it.id); starter.dropDraft('wear:' + t.it.id); }
      const older = S.items.filter((i) => starter.isStarter(i) && !i.worn && add.some((t) => t.done.worn && t.it.id === i.starterId)); // flat-lay versions made before pieces were drawn on the model
      for (const o of older) { await del('items', o.id); S.items = S.items.filter((x) => x.id !== o.id); for (const k of Object.keys(S.outfit)) if (S.outfit[k] === o.id) delete S.outfit[k]; }
      const replaced = (S.starterReview || []).filter((r) => add.some((t) => t.it.id === r.starterId)); // the earlier versions that needed review
      for (const r of replaced) await del('items', r.id); S.starterReview = (S.starterReview || []).filter((r) => !replaced.includes(r));
      S.filter.src = 'starter'; render(); toast(`Added ${add.length} starter ${label.toLowerCase()} ✓`);
    };
    $('#modal').querySelectorAll('.startertile').forEach((b) => (b.onclick = () => { const t = tiles.get(b.dataset.id); if (t.state === 'wait' || t.state === 'run') return; if (t.state === 'ok') t.attempt++; t.state = 'wait'; t.fresh = true; queue.push(t); pump(); paint(); }));
  };
  const makeWorn = async (t) => { // clothing and shoes: drawn on the model, the piece kept, remade at most twice automatically
    const pack = dollPack || await loadPack(); if (!pack) throw new Error('The model picture didn’t load. Try again.');
    for (let auto = 0; ; auto++) {
      let blob = !t.fresh && await starter.draftOf('wear:' + t.it.id), info;
      if (blob) info = { attempt: t.attempt, seed: 0, from: 'saved', key: `/starter-draft/wear:${t.it.id}` };
      else {
        if (!starter.canGenerate()) throw new starter.DailyLimit(starter.nextReset());
        ({ blob, info } = await wearAI.drawWorn(t.it, pass, pack).catch((e) => { if (e.limit) { starter.setUsed(e.used ?? starter.DAILY_FREE); throw new starter.DailyLimit(e.resetAt || starter.nextReset()); } note(t, { attempt: t.attempt, seed: 0, ...(e.info || {}), error: e.message }); throw e; }));
        info = { ...info, attempt: t.attempt, seed: 0, key: `/starter-draft/wear:${t.it.id}` }; if (Number.isFinite(info.used)) starter.setUsed(info.used);
        await starter.saveDraft('wear:' + t.it.id, blob);
      }
      const done = await wearAI.extractWorn(blob, t.it, pack);
      if (!done.check.ok && auto < 2) { note(t, { ...info, check: done.check }); t.attempt++; t.fresh = true; paint(); continue; }
      done.ready = done.check.ok && !!done.worn; done.why = done.check.reasons;
      if (!done.worn) throw new Error(done.check.reasons.join('; ') || 'The piece couldn’t be found in the picture. Tap to try again.');
      note(t, { ...info, check: done.check });
      return { blob, done };
    }
  };
  const make = async (t) => { // one piece: its own picture, checked, remade at most twice automatically, then tried on the mannequin
    if (wearAI.isWornType(t.it.type)) return makeWorn(t);
    for (let auto = 0; ; auto++) {
      let blob = !t.fresh && await starter.draftOf(t.it.id), info;
      if (blob) info = { attempt: t.attempt, seed: seedFor(t.it, t.attempt), from: 'saved', key: `/starter-draft/${t.it.id}` };
      else ({ blob, info } = await starter.generate(t.it, pass, { attempt: t.attempt }).catch((e) => { if (!(e instanceof starter.DailyLimit)) note(t, { ...(e.info || { attempt: t.attempt }), error: e.message }); throw e; }));
      let done = await starter.process(blob, t.it);
      if (done.check.ok) { const why = starter.lookReasons(await starter.look(blob, t.it, pass)); if (why.length) done.check = { ok: false, reasons: why }; } // the AI look, once the pixel checks pass
      if (!done.check.ok && auto < 2) { note(t, { ...info, check: done.check }); t.attempt++; t.fresh = true; paint(); continue; }
      if (!done.check.ok) { note(t, { ...info, check: done.check }); done = await starter.processCleaned(blob, t.it, done.check); info = { ...info, from: 'cleaned' }; // last resort: clean the cutout, then check it again
        if (done.check.ok) { const why = starter.lookReasons(await starter.look(done.canvas, t.it, pass)); if (why.length) done.check = { ok: false, reasons: why.map((r) => `after clean-up: ${r}`) }; } } // (and the AI looks at the cleaned cutout)
      const fit = done.check.ok ? await starterFits(t.it, done) : { ok: false };
      done.ready = done.check.ok && fit.ok; done.marks = fit.marks; done.why = [...done.check.reasons, ...(done.check.ok && !fit.ok ? ['does not fit the mannequin'] : [])];
      note(t, { ...info, check: done.check, fits: done.check.ok ? fit.ok : undefined });
      return { blob, done };
    }
  };
  const queue = [...tiles.values()]; let running = 0;
  const pause = (at) => { resetAt = at; clearTimeout(timer); timer = setTimeout(() => { resetAt = 0; pump(); paint(); }, Math.max(1000, at - Date.now() + 60000)); }; // a minute after the reset
  const pump = () => { while (running < 3 && queue.length && !closed() && !resetAt) { const t = queue.shift(); running++; t.state = 'run'; t.err = '';
    make(t).then(({ blob, done }) => { t.original = blob; t.done = done; if (t.url) URL.revokeObjectURL(t.url); t.url = URL.createObjectURL(done.cutout); t.state = 'ok'; t.fresh = false; })
      .catch((e) => { if (e instanceof starter.DailyLimit) { t.state = 'wait'; queue.unshift(t); pause(e.resetAt); return; } if (t.url) { URL.revokeObjectURL(t.url); t.url = ''; } t.done = null; t.state = 'err'; t.err = e.message; if (/passcode/i.test(e.message)) store.set('aipass', ''); })
      .finally(() => { running--; pump(); paint(); }); } };
  pump(); paint();
}

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
const PREFS = ['budget', 'game', 'events', 'hairstyle', 'haircolor', 'hairmarks'];
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

/* ───────────────────────── my photo (for the photoreal try-on) ───────────────────────── */
function openModelModal() {
  const prof = S.profile, d = { canvas: null, photoUrl: prof?.photo ? url('profile') : '', display: prof?.display || 'model' };
  openModal();
  const paint = () => {
    paintSheet(`
      <p class="muted">The photoreal try-on renders your pieces on a photo of you. Use a full-body photo: stand facing the camera, arms slightly away from your sides, whole body in frame, plain background, phone held at hip height.</p>
      <label class="f" for="mfile">Full-body photo</label>
      <input type="file" id="mfile" accept="image/*">
      <div id="mstatus" class="muted" role="status" aria-live="polite"></div>
      ${d.photoUrl ? `<div class="stage" style="padding:6px;margin-top:8px"><img class="myphoto" src="${d.photoUrl}" alt="Your photo"></div>` : ''}
      <fieldset style="border:0;padding:0;margin:12px 0 0"><legend class="f">Show me as</legend>
        <label class="row"><input type="radio" name="disp" value="model" ${d.display !== 'photo' ? 'checked' : ''}> The model</label>
        <label class="row"><input type="radio" name="disp" value="photo" ${d.display === 'photo' ? 'checked' : ''} ${d.photoUrl ? '' : 'disabled'}> My photo (the photoreal try-on shows here)</label></fieldset>
      <div class="row" style="margin-top:16px;justify-content:space-between">
        <span>${prof ? '<button class="ghost danger" id="mreset">Remove my photo</button>' : ''}</span>
        <span class="row"><button class="ghost" id="mcancel">Cancel</button><button class="primary" id="msave">Save</button></span></div>`, 'My photo');
    $('#mcancel').onclick = closeModal;
    document.querySelectorAll('[name=disp]').forEach((r) => (r.onchange = () => (d.display = r.value)));
    $('#mfile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const { img } = await loadImage(f); d.canvas = toCanvas(img, 1000); d.photoUrl = d.canvas.toDataURL('image/jpeg', 0.9); d.display = 'photo'; paint(); } catch (err) { $('#mstatus').textContent = err.message; }
    };
    $('#msave').onclick = async () => {
      const photo = d.canvas ? await canvasToBlob(d.canvas, 'image/jpeg', 0.9) : prof?.photo || null;
      const rec = { id: 'me', rev: d.canvas ? Date.now() : prof?.rev || Date.now(), W: d.canvas?.width || prof?.W || 0, H: d.canvas?.height || prof?.H || 0, photo, display: photo ? d.display : 'model' };
      await put('profile', rec); S.profile = rec;
      S.urls.delete('profile'); if (rec.photo) url('profile', rec.photo);
      closeModal(); toast('Saved ✓'); render();
    };
    if ($('#mreset')) $('#mreset').onclick = async () => {
      if (!confirm('Remove your saved photo?')) return;
      await del('profile', 'me'); S.profile = null; S.urls.delete('profile'); closeModal(); render();
    };
  };
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
const dollOn = () => S.scene === 'doll' && !dollFailed && !usingPhoto();
function stageHTML() {
  if (usingPhoto()) {
    const items = outfitItems(S.outfit), done = aiFor(items);
    return `<img class="myphoto" src="${done ? S.ai.image : url('profile')}" alt="${done ? `Your photo wearing ${Object.values(items).map((i) => i.name).join(', ')}` : 'Your photo'}">`;
  }
  if (dollFailed) return '<p class="muted dollhint" role="alert">The model picture couldn’t load. Check your connection and reload.</p>';
  if (!dollPack) return '<p class="muted dollhint" role="status">Getting the model ready…</p>';
  return dollSVG({ pack: dollPack, items: outfitItems(S.outfit), urls: S.urls, hair: myHair(), fits: S.fits, base: baseFor(outfitItems(S.outfit)), fitBoxes: S.fitBoxes, meta: S.meta, debug: S.dbgPts, selected: S.adjust && Object.values(S.outfit).includes(S.adjust) ? S.adjust : '' });
}
function mountStage() { if (S.scene === 'closet' && S.view === 'tryon') return wicRefresh(); const el = $('#stage'); if (el) el.innerHTML = stageHTML(); }
const refreshStage = mountStage;

const DRAWERS = [['fit', '📏 Fit'], ['looks', '💾 Looks'], ['ai', '✨ Photoreal'], ['me', '🧍 Me']];

function metersHTML(worn) {
  const m = outfitMeters(worn, S.mood, wearCounts());
  const bar = (label, v) => `<div class="meter"><span>${label}</span><div class="bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v ?? 0}"><i style="width:${v ?? 0}%"></i></div></div>`;
  return `<div class="meters" role="group" aria-label="Outfit meters">${bar('Mood fit', S.mood ? m?.fit : null)}${bar('Colours', m?.harmony)}${bar('Fresh', m?.fresh)}</div>`;
}

const CAS_TABS = [['hair', 'Hair', '💇'], ['anchors', 'Anchors', '📍']];
/** The "create-a-sim" style picker: docked inside the model's box, one category at a time, options in a single scrolling strip. */
function casHTML() {
  const close = '<button class="cas-x" data-act="casclose" aria-label="Close customizer"><span aria-hidden="true">✕</span></button>';
  if (usingPhoto()) return `<div class="cas" role="region" aria-label="Customize your model"><p class="muted">You’re showing your own photo. Switch back to the model under <b>Me</b> to customize it.</p>${close}</div>`;
  // The base picture is fixed art: hair is your own hairstyle pictures laid over it; the anchor points are coordinates over it.
  const tabs = dollPack?.hair ? ['hair', 'anchors'] : ['anchors'];
  if (!tabs.includes(S.casTab)) S.casTab = tabs[0];
  const pts = dollPack?.points || {};
  const panes = {
    hair: hairPickerHTML(),
    anchors: `<div class="anchors"><button class="chip ${S.dbgPts ? 'on' : ''}" aria-pressed="${!!S.dbgPts}" data-act="dbgpts"><span aria-hidden="true">📍</span> Show the points on the model</button>
      <p class="muted">Clothes snap to these points: shoulders and hips set the size, the waist, neck and feet set the position. They are coordinates over the picture, kept in <code>assets/avatar/config.json</code>.</p>
      <details><summary>All ${Object.keys(pts).length} points and their coordinates</summary><ul class="ptlist">${Object.entries(pts).map(([k, [x, y]]) => `<li><span>${k}</span> <b>${x}, ${y}</b></li>`).join('')}</ul></details></div>`,
  };
  return `<div class="cas" role="region" aria-label="Customize your model">
    <div class="cas-tabs" role="group" aria-label="What to change">${CAS_TABS.filter(([k]) => tabs.includes(k)).map(([k, l, e]) => `<button class="${S.casTab === k ? 'on' : ''}" aria-pressed="${S.casTab === k}" data-act="cas" data-v="${k}"><span aria-hidden="true">${e}</span><small>${l}</small></button>`).join('')}${close}</div>
    <div class="cas-opts">${panes[S.casTab] || panes[tabs[0]]}</div></div>`;
}

/** "Adjust fit" for a hairstyle: drag its four landmarks on the picture (crown, hairline, temples); the head preview follows. Saved per style. */
function openHairFit(styleId) {
  const st = dollPack?.hair?.styles.find((s) => s.id === styleId); if (!st?.marks) return;
  const saved = hairMarks(), start = { ...st.marks, ...(saved[styleId] || {}) }, marks = JSON.parse(JSON.stringify(start));
  const LBL = { crown: 'Crown', hairline: 'Hairline', templeL: 'Temple', templeR: 'Temple' }, [iw, ih] = st.size;
  openModal();
  const preview = () => { const h = hairOf(dollPack, styleId, S.hairColor, { [styleId]: marks }), P = dollPack.points;
    return dollSVG({ pack: dollPack, items: {}, urls: new Map(), hair: h, cls: 'hairprev', label: 'Head preview' }).replace(/viewBox="[^"]*"/, `viewBox="${P.crown[0] - 230} ${P.crown[1] - 120} 460 520"`); };
  const dot = (k) => `<button type="button" class="hfdot ${k}" data-k="${k}" style="left:${(100 * marks[k][0]) / iw}%;top:${(100 * marks[k][1]) / ih}%" aria-label="${LBL[k]} (drag to move)"><span>${LBL[k]}</span></button>`;
  paintSheet(`<p class="muted">Drag the dots onto the hair: <b>Crown</b> at the top of the head, <b>Hairline</b> at the top of the face opening, the two <b>Temples</b> on the opening's edges at eyebrow height. The preview follows.</p>
    <div class="hairfit"><div class="hfpic" style="aspect-ratio:${iw}/${ih}"><img src="${dollPack.base}hair/${styleId}.png${dollPack.version ? `?v=${dollPack.version}` : ''}" alt="">${Object.keys(LBL).map(dot).join('')}</div><div class="hfprev" id="hfprev">${preview()}</div></div>
    <div class="row" style="margin-top:12px;justify-content:space-between"><button class="ghost" id="hfreset">Suggested</button><span class="row"><button class="ghost" id="hfcancel">Cancel</button><button class="primary" id="hfsave">Save</button></span></div>`, `Fit: ${esc(st.name)}`);
  const pic = $('.hfpic'), refresh = () => { $('#hfprev').innerHTML = preview(); };
  pic.querySelectorAll('.hfdot').forEach((d) => {
    d.onpointerdown = (e) => { d.setPointerCapture(e.pointerId); e.preventDefault(); };
    d.onpointermove = (e) => { if (!d.hasPointerCapture(e.pointerId)) return; const r = pic.getBoundingClientRect(), u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), v = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      marks[d.dataset.k] = [Math.round(u * iw * 10) / 10, Math.round(v * ih * 10) / 10]; d.style.left = `${u * 100}%`; d.style.top = `${v * 100}%`; refresh(); };
  });
  $('#hfreset').onclick = () => { Object.assign(marks, JSON.parse(JSON.stringify(st.marks))); pic.querySelectorAll('.hfdot').forEach((d) => { d.style.left = `${(100 * marks[d.dataset.k][0]) / iw}%`; d.style.top = `${(100 * marks[d.dataset.k][1]) / ih}%`; }); refresh(); };
  $('#hfcancel').onclick = () => closeModal();
  $('#hfsave').onclick = () => { const all = hairMarks(); if (JSON.stringify(marks) === JSON.stringify(st.marks)) delete all[styleId]; else all[styleId] = marks; store.set('hairmarks', JSON.stringify(all)); closeModal(); renderTryon(); toast('Hair fit saved ✓'); };
}

/** Hairstyle and hair colour chips (the customizer and the vanity use the same ones). */
function hairPickerHTML() {
  const h = dollPack?.hair; if (!h) return '';
  const v = dollPack.version ? `?v=${dollPack.version}` : '';
  return `<div class="hairpick"><div class="opt-row" role="group" aria-label="Hairstyle">${h.styles.map((s) => `<button class="hairchip ${S.hairStyle === s.id ? 'on' : ''}" aria-pressed="${S.hairStyle === s.id}" data-act="hairstyle" data-v="${s.id}">${s.id === 'none' ? '<span class="th none" aria-hidden="true">✕</span>' : `<span class="th"><img src="${dollPack.base}hair/${s.id}.png${v}" alt="" draggable="false"></span>`}<small>${s.name}</small></button>`).join('')}</div>
    ${S.hairStyle !== 'none' ? `<button class="chip hairadjust" data-act="hairfit" data-v="${S.hairStyle}"><span aria-hidden="true">✋</span> Adjust fit</button>` : ''}
    <div class="opt-row swatches" role="group" aria-label="Hair colour">${h.colors.map((c) => `<button class="hairsw ${S.hairColor === c.id ? 'on' : ''}" aria-pressed="${S.hairColor === c.id}" data-act="haircolor" data-v="${c.id}" style="--sw:${c.sw}" ${S.hairStyle === 'none' ? 'disabled' : ''}><i aria-hidden="true"></i><small>${c.name}</small></button>`).join('')}</div></div>`;
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
        <button class="chip ${usingPhoto() ? '' : 'on'}" aria-pressed="${!usingPhoto()}" data-act="display" data-v="model">The model</button>
        <button class="chip ${usingPhoto() ? 'on' : ''}" aria-pressed="${usingPhoto()}" data-act="display" data-v="photo" ${S.profile?.photo ? '' : 'disabled'}>My photo</button></div>
      <button class="primary wide" data-act="setup">${S.profile ? 'Change my photo' : '📷 Add my photo (for the photoreal try-on)'}</button>`;
  return Object.keys(worn).length
    ? `<div class="chips">${SLOTS.filter((s) => worn[s]).map((s) => `<button class="chip ${fit?.id === worn[s].id ? 'on' : ''}" aria-pressed="${fit?.id === worn[s].id}" data-act="fit" data-id="${worn[s].id}">${SLOT_LABEL[s]}: ${esc(worn[s].name)}</button>`).join('')}</div>
      ${fit ? `<p class="muted">Fine-tune “${esc(fit.name)}”</p>${[['scale', 'Size', 0.5, 1.8, 0.02], ['dx', 'Left / right', -60, 60, 1], ['dy', 'Up / down', -80, 80, 1]].map(([k, l, a, b, st]) => `<label class="f" for="adj-${k}">${l}</label><input type="range" id="adj-${k}" data-adj="${k}" min="${a}" max="${b}" step="${st}" value="${fit.adj[k]}">`).join('')}
        <button class="ghost" data-act="resetfit" data-id="${fit.id}" style="margin-top:8px">Reset</button>` : '<p class="muted">Tap a piece you’re wearing to adjust how it sits.</p>'}`
    : '<p class="muted">Pick pieces from the wardrobe below to dress your model.</p>';
}

const sceneBar = () => `<div class="scenebar" role="group" aria-label="Where to be">
  <button class="on" aria-pressed="true" data-act="scene" data-v="doll"><span aria-hidden="true">🪞</span> Dress up</button>
  <button aria-pressed="false" data-act="scene" data-v="closet"><span aria-hidden="true">✨</span> Walk-in closet</button></div>`;

/* ───────────────────────── the daily challenge ───────────────────────── */
const saveGame = () => store.set('game', JSON.stringify(S.game));
const todayBand = () => todayWeather(ctx).band || '';
/** Start today's challenge if it's a new date (or the first run). */
function ensureDay() {
  const date = iso(new Date());
  if (S.game.day?.date === date) return retheme(); // mood or forecast may have arrived since this morning
  S.events = S.events.filter((e) => e.date >= iso(new Date(Date.now() - 7 * 864e5))); // forget old events
  S.game = rollOver(S.game, date, () => pickTheme({ date, events: S.events, mood: S.mood, band: todayBand() }));
  // Written without the "prefs changed" stamp: an automatic rollover must not look newer than cloud settings that the startup sync is about to pull.
  try { localStorage.setItem('game', JSON.stringify(S.game)); localStorage.setItem('events', JSON.stringify(S.events)); } catch { /* private mode */ }
}
/** The theme follows its inputs (event, mood, forecast) until you've been rated. A random theme stays put unless something better turns up. */
function retheme() {
  const d = S.game.day; if (!d || d.stars || d.ended) return;
  const theme = pickTheme({ date: d.date, events: S.events, mood: S.mood, band: todayBand() });
  if (d.theme.source === 'random' && theme.source === 'random') return;
  if (JSON.stringify(theme) === JSON.stringify(d.theme)) return;
  S.game = { ...S.game, day: { ...d, theme } }; saveGame();
}
const streakNow = () => wearStreak(S.wears, iso(new Date()));
const hasOutfit = () => Object.keys(S.outfit).some((k) => itemById(S.outfit[k]));

function gameBarHTML(big) {
  const d = S.game.day; if (!d) return '';
  const [em, label] = PHASES[d.phase] || PHASES.challenge, stk = streakNow();
  const msg = d.phase === 'done' ? 'Day done. See you tomorrow!' : d.phase === 'evening' ? `You scored ${d.stars}★. Tap End the day to finish.` : hasOutfit() ? 'Looking good? Rate it at the mirror.' : 'Get dressed!';
  return `<div class="gamebar ${big ? 'big' : ''} ${S.gbOpen ? 'open' : ''}" role="region" aria-label="Today’s challenge">
    ${big ? '' : `<div class="gb-pillrow"><button class="gb-pill" data-act="gbpill" aria-expanded="${!!S.gbOpen}"><span aria-hidden="true">${em}</span> ${esc(themeLine(d.theme))} <span class="gb-coins"><span aria-hidden="true">🪙</span> ${S.game.coins}<span class="sr-only"> coins</span></span><span class="gb-caret" aria-hidden="true">▾</span></button>${d.phase === 'done' ? '' : `<button class="gb-ratebtn" data-act="rate" ${hasOutfit() ? '' : 'disabled'}><span aria-hidden="true">⭐</span> Rate</button>`}<button class="gb-closet" data-act="scene" data-v="closet" aria-label="Walk-in closet"><span aria-hidden="true">✨</span></button></div>`}
    <div class="gb-top"><span class="gb-phase"><span aria-hidden="true">${em}</span> ${label}</span><span class="gb-stats"><span title="Coins"><span aria-hidden="true">🪙</span> <b>${S.game.coins}</b><span class="sr-only"> coins</span></span><button class="gb-shop" data-act="shop"><span aria-hidden="true">🛍️</span> Shop</button>${stk ? `<span title="Streak"><span aria-hidden="true">🔥</span> <b>${stk}</b><span class="sr-only">-day streak</span></span>` : ''}</span></div>
    <div class="gb-theme">Theme: <b>${esc(themeLine(d.theme))}</b> — ${msg}</div>
    <div class="gb-meta"><small>${SOURCE_NOTE[d.theme.source]}</small>
      <span class="gb-meter" role="meter" aria-label="Energy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${d.energy}"><span aria-hidden="true">⚡</span><i style="width:${d.energy}%"></i></span>
      <span class="gb-meter mood" role="meter" aria-label="Mood" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${d.mood}"><span aria-hidden="true">${d.mood >= 70 ? '😄' : d.mood >= 40 ? '🙂' : '😐'}</span><i style="width:${d.mood}%"></i></span></div>
    ${d.phase === 'done' ? '' : `<button class="primary gb-rate" data-act="rate" ${hasOutfit() ? '' : 'disabled'}><span aria-hidden="true">⭐</span> Rate my look</button>`}${d.phase === 'evening' ? `<button class="ghost gb-end" data-act="endday"><span aria-hidden="true">🌙</span> End the day (log this outfit)</button>` : ''}</div>`;
}
const refreshGame = () => { document.querySelectorAll('.gamebar').forEach((b) => (b.outerHTML = gameBarHTML(b.classList.contains('big')))); if (S.scene === 'closet' && S.view === 'tryon') wicRefresh(); };

function rateNow() {
  ensureDay();
  const d = S.game.day, worn = outfitItems(S.outfit), rating = rateOutfit({ worn, theme: d.theme, band: todayBand(), counts: wearCounts() });
  if (!rating) return toast('Dress the doll first');
  const { game, paid } = applyRating(S.game, rating, { streak: streakNow() }); S.game = game; saveGame();
  openModal();
  paintSheet(`<div class="reveal" role="status"><div class="stars" role="img" aria-label="${rating.stars} out of 5 stars">${[1, 2, 3, 4, 5].map((n) => `<span class="star ${n <= rating.stars ? 'on' : ''}" style="--i:${n}" aria-hidden="true">★</span>`).join('')}</div>
    <p class="score"><b>${rating.score}</b>/100 for “${esc(d.theme.title)}”</p>
    <p class="coins-earned">${paid ? `+<b>${paid}</b> <span aria-hidden="true">🪙</span> coins` : 'No new coins: you already earned these today. Beat your best for more.'}</p>
    <ul class="parts">${rating.parts.map((p) => `<li><span>${esc(p.label)}</span><span class="pbar" aria-hidden="true"><i style="width:${(100 * p.got) / p.max}%"></i></span><b>${p.got}/${p.max}</b><small>${esc(p.note)}</small></li>`).join('')}</ul>
    <p class="muted">${esc(rating.tip)}</p>
    <div class="row" style="margin-top:12px"><button class="ghost" id="rwclose">Keep dressing</button><button class="primary grow" id="rwbed">🌙 Finish the day</button></div>
    ${reducedMotion() ? '' : `<div class="confetti" aria-hidden="true">${Array.from({ length: rating.stars * 8 }, (_, i) => `<span style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--c:${['#ff5c93', '#ffd23f', '#5ad1ff', '#9b6bff', '#2fb892'][i % 5]}"></span>`).join('')}</div>`}</div>`, 'Your look');
  $('#rwclose').onclick = () => { closeModal(); refreshGame(); if (S.view === 'tryon') renderTryon(); };
  $('#rwbed').onclick = () => { closeModal(); refreshGame(); $('.gb-end')?.focus(); };
  refreshGame();
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;



/* ───────────────────────── photo mode and the lookbook ───────────────────────── */
const photoPick = () => ({ bg: S.game.photo?.bg || 'blush', pose: S.game.photo?.pose || 'stand' });
function photoCanvas() {
  const d = S.game.day, { bg, pose } = photoPick(), stars = d?.stars ? ` · ${'★'.repeat(d.stars)}` : '';
  return composePhoto({ doll: S.photoDoll, bg, pose, title: d ? themeLine(d.theme) : 'My look', sub: new Date().toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' }) + stars });
}
function paintPhoto() {
  const pick = photoPick(), chip = (act, kind, k, label) => { const c = catalogItem(`${kind}:${k}`), lock = c && !owns(S.game, c.id); return `<button class="chip ${pick[kind] === k ? 'on' : ''}" aria-pressed="${pick[kind] === k}" data-act="${act}" data-v="${k}">${lock ? `🔒 ${esc(label)} · 🪙${c.price}` : esc(label)}</button>`; };
  paintSheet(`<canvas id="phcanvas" class="phcanvas" width="720" height="960" role="img" aria-label="Preview of your photo"></canvas>
    <h3>Backdrop</h3><div class="chips" role="group" aria-label="Backdrop">${Object.entries(BACKGROUNDS).map(([k, b]) => chip('phbg', 'bg', k, b.name)).join('')}</div>
    <h3>Pose</h3><div class="chips" role="group" aria-label="Pose">${Object.entries(POSES).map(([k, b]) => chip('phpose', 'pose', k, b.name)).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="primary grow" data-act="phtake"><span aria-hidden="true">📸</span> Save to my lookbook</button><button class="ghost" data-act="phshare">Share</button></div>
    <div class="row" style="margin-top:8px"><button class="ghost grow" id="phclose">Close</button></div>`, 'Photo mode');
  $('#phcanvas').getContext('2d').drawImage(photoCanvas(), 0, 0);
  $('#phclose').onclick = closeModal;
}
async function openPhoto() {
  if (!hasOutfit()) return toast('Dress the doll first');
  const c = await dollCanvas(); if (!c) return toast('The doll isn’t ready yet. Try again in a moment.');
  S.photoDoll = c; if ($('#modal').hidden) openModal(); S.photoOpen = true; paintPhoto();
}
async function photoSave() {
  const blob = await photoBlob(photoCanvas()), today = iso(new Date());
  let w = [...S.wears].reverse().find((x) => x.date === today);
  if (!w) { await logWear(today, S.mood); w = [...S.wears].reverse().find((x) => x.date === today); }
  if (!w) return;
  if (S.urls.has('photo:' + w.id)) { URL.revokeObjectURL(S.urls.get('photo:' + w.id)); S.urls.delete('photo:' + w.id); }
  w.photo = blob; await put('wears', w); url('photo:' + w.id, blob);
  toast('Saved to your lookbook ✓ (Diary)');
}
const lookbook = () => S.wears.filter((w) => w.photo).sort((a, b) => b.createdAt - a.createdAt);
function lookbookHTML() {
  const list = lookbook();
  return `<div class="panel"><h3>Lookbook</h3>${list.length ? `<div class="lookbook">${list.map((w) => `<button class="lb" data-act="lbopen" data-id="${w.id}" aria-label="Open the photo from ${esc(w.date)}"><img src="${url('photo:' + w.id, w.photo)}" alt=""></button>`).join('')}</div>` : '<p class="muted">Photos you take in 📸 Photo mode (on the Dress up screen) are kept here.</p>'}</div>`;
}
function lookbookOpen(id) {
  const w = S.wears.find((x) => x.id === id); if (!w?.photo) return;
  openModal();
  paintSheet(`<img class="lbbig" src="${url('photo:' + w.id, w.photo)}" alt="Your look from ${esc(w.date)}">
    <div class="row" style="margin-top:10px"><button class="primary grow" data-act="lbshare" data-id="${w.id}">Share</button><button class="ghost danger" data-act="lbdel" data-id="${w.id}">Remove photo</button></div>
    <div class="row" style="margin-top:8px"><button class="ghost grow" id="lbclose">Close</button></div>`, `Look from ${esc(w.date)}`);
  $('#lbclose').onclick = closeModal;
}

/* ───────────────────────── the shop and build mode ───────────────────────── */
const SHOP_TABS = [['bg', '🖼️ Backdrops'], ['pose', '🧍 Poses']];
function showShop(tab = S.shopTab || 'bg', focus = '') {
  if (!SHOP_TABS.some(([k]) => k === tab)) tab = 'bg';
  S.shopTab = tab;
  if ($('#modal').hidden) openModal();
  const g = S.game, card = (c) => {
    const mine = owns(g, c.id), cur = (g.photo || {})[c.kind] === c.id.slice(c.kind.length + 1);
    const act = mine ? `<button class="${cur ? 'ghost' : 'primary'}" data-act="shopuse" data-v="${c.id}" aria-pressed="${cur}">${cur ? 'In use ✓' : 'Use'}</button>`
      : `<button class="primary" data-act="shopbuy" data-v="${c.id}" ${g.coins < c.price ? 'aria-disabled="true"' : ''}>Buy · 🪙 ${c.price}</button>`;
    return `<li class="shopcard"><span class="se" aria-hidden="true">${c.emoji}</span><span class="sn">${esc(c.name)}${mine && c.price ? '<small>Yours</small>' : ''}</span>${act}</li>`;
  };
  paintSheet(`<p class="shopcoins" role="status">You have <b>🪙 ${g.coins}</b> coins. Earn more by rating your look each day.</p>
    <div class="tabs" role="tablist" aria-label="Shop sections">${SHOP_TABS.map(([k, l]) => `<button role="tab" class="chip" aria-selected="${tab === k}" data-act="shoptab" data-v="${k}">${l}</button>`).join('')}</div>
    <ul class="shoplist">${CATALOG.filter((c) => c.kind === tab).map(card).join('')}</ul>
    <p class="muted">Used in 📸 Photo mode on the Dress up screen.</p>
    <div class="row" style="margin-top:12px"><button class="ghost grow" id="shopclose">Close</button></div>`, 'Shop');
  $('#shopclose').onclick = () => { const back = S.photoOpen; closeModal(); if (back) openPhoto(); };
  if (focus) $(`#modal [data-act][data-v="${CSS.escape(focus)}"]`)?.focus();
}
function shopBuy(id) {
  const r = buy(S.game, id); if (!r.ok) return toast(r.reason);
  S.game = r.game; saveGame(); refreshGame(); toast(`Bought ${catalogItem(id).name} ✓`); showShop(S.shopTab, id);
}
function shopUse(id) {
  const c = catalogItem(id); if (!c || !owns(S.game, id)) return;
  if (['bg', 'pose'].includes(c.kind)) { S.game = usePhoto(S.game, id); saveGame(); }
  showShop(S.shopTab, id);
}

/* ───────────────────────── the walk-in closet ───────────────────────── */
let wic = null; // the closet's navigation (closet.js), while it is on screen
const itemRatio = (it) => { const m = S.meta.get(it.id); return m?.iw && m?.ih ? (m.bw * m.iw) / (m.bh * m.ih) : 0.8; };
const piecesIn = (sec) => (sec.types ? S.items.filter((i) => sec.types.includes(i.type)) : []);
/** One section's panel: its photographed background, your pieces placed on it, and its label. */
function wicPanel(sec, W, H, x) {
  const b = artBox(sec, W, H), pct = (v, of) => `${(100 * v) / of}%`, [iw, ih] = [b.w / b.s, b.h / b.s], list = piecesIn(sec), worn = new Set(Object.values(S.outfit));
  let inner = '';
  if (sec.k === 'overview') {
    inner = Object.entries(HOTSPOTS).map(([k, [hx, hy]]) => { const t = sectionOf(k), n = piecesIn(t).length;
      return `<button class="wic-hot" style="left:${pct(hx, iw)};top:${pct(hy, ih)}" data-act="wicgo" data-v="${k}"><span aria-hidden="true">${t.emoji}</span> ${t.label}${t.types ? ` <small>${n}</small>` : ''}</button>`; }).join('');
  } else if (sec.types) {
    inner = layoutSection(sec, list.map((i) => ({ id: i.id, ar: itemRatio(i) }))).map((p) => { const it = itemById(p.id);
      return `${p.hanger ? `<span class="wic-hanger" aria-hidden="true" style="left:${pct(p.hanger[0], iw)};top:${pct(p.hanger[1] - 6, ih)}"></span>` : ''}<button class="wic-item ${worn.has(it.id) ? 'worn' : ''} ${starter.isStarter(it) ? 'is-starter' : ''}" style="left:${pct(p.x, iw)};top:${pct(p.y, ih)};width:${pct(p.w, iw)};height:${pct(p.h, ih)}" data-act="wicitem" data-id="${it.id}" aria-label="${esc(it.name)}${worn.has(it.id) ? ' (in your outfit)' : ''}"><img src="${url(it.id)}" alt="" draggable="false"></button>`; }).join('');
  } else if (sec.k === 'mirror') {
    const fig = dollPack ? dollSVG({ pack: dollPack, items: outfitItems(S.outfit), urls: S.urls, hair: myHair(), fits: S.fits, base: baseFor(outfitItems(S.outfit)), fitBoxes: S.fitBoxes, meta: S.meta, cls: 'wic-doll', label: 'You, in the mirror' }) : '';
    inner = `<button class="wic-mirrorfig" data-act="wicmirror" aria-label="Open the mirror to dress up">${fig}</button>`;
  }
  const n = list.length;
  const label = sec.k === 'overview' ? '' : `<div class="wic-label"><b>${sec.emoji} ${sec.label}</b>${sec.types ? ` · ${n} ${n === 1 ? 'piece' : 'pieces'}` : ''}</div>`;
  const note = sec.types && !n ? `<div class="wic-empty"><p>No ${sec.label.toLowerCase()} here yet.</p><button class="wic-btn" data-act="add" data-v="${sec.types[0]}">+ Add pieces</button></div>`
    : sec.k === 'mirror' ? '<div class="wic-empty low"><button class="wic-btn" data-act="wicmirror">🪞 Dress up in the mirror</button></div>'
    : sec.k === 'vanity' ? `<div class="wic-empty low wic-vanity">${hairPickerHTML()}<button class="wic-btn" data-act="wichair">🪞 Try hair in the mirror</button></div>` : '';
  return `<section class="wic-panel" data-k="${sec.k}" style="left:${x}px;width:${b.pw}px" aria-label="${sec.label}">
    <div class="wic-art" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background-image:url(/assets/closet/${sec.bg}.jpg)">${inner}</div>${label}${note}</section>`;
}
/** The top bar, the challenge pill and the tip: drawn over the closet, never over the strip. */
function wicChrome() {
  const bar = $('.wic-chrome'); if (!bar) return;
  const d = S.game.day, open = !!S.wicPill;
  bar.innerHTML = `<div class="wic-top"><button class="wic-round" data-act="wicmirror" aria-label="Back to dress up"><span aria-hidden="true">←</span></button>
      <span class="wic-coins" role="status"><span aria-hidden="true">🪙</span> ${S.game.coins}<span class="sr-only"> coins</span></span>
      <button class="wic-round wide" data-act="shop"><span aria-hidden="true">🛍️</span> Shop</button></div>
    ${d ? `<div class="wic-pillbox"><button class="wic-pill" data-act="wicpill" aria-expanded="${open}" aria-controls="wicpillcard">${esc(themeLine(d.theme))}</button>
      ${open ? `<div class="wic-pillcard" id="wicpillcard"><p>Today’s challenge: <b>${esc(d.theme.title)}</b>. ${d.stars ? `You scored ${d.stars}★.` : hasOutfit() ? 'Rate your look in the mirror.' : 'Pick pieces, then rate the look in the mirror.'}</p><button class="wic-btn" data-act="wicmirror">🪞 To the mirror</button></div>` : ''}</div>` : ''}
    ${store.get('wictip', '') ? '' : '<div class="wic-tip" role="status">Swipe to move along the walls, or tap a section. Pinch to look closer. <button class="wic-x" data-act="wictip" aria-label="Got it">✕</button></div>'}`;
}
function wicStrip(cur) {
  const strip = $('.wic-strip'); if (!strip) return;
  strip.querySelectorAll('button').forEach((b) => { const on = b.dataset.v === cur; b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'location') : b.removeAttribute('aria-current'); if (on) b.scrollIntoView?.({ block: 'nearest', inline: 'center' }); });
}
/** Lay the panels out for the current screen size (and redraw the pieces). */
function wicRefresh() {
  const view = $('.wic-view'); if (!view) return;
  const W = view.clientWidth, H = view.clientHeight, { at, total } = trackLayout(W, H), cur = wic?.current() || S.wicAt || 'overview', x = wic?.x();
  view.querySelector('.wic-track').style.width = `${total}px`;
  view.querySelector('.wic-track').innerHTML = SECTIONS.map((s) => wicPanel(s, W, H, at[s.k].x)).join('');
  wic = bindCloset(view, { start: cur, startX: wic && W === S.wicW ? x : null, onSection: (k) => { S.wicAt = k; wicStrip(k); } });
  S.wicW = W; wicChrome();
}
function renderWalkIn() {
  document.body.classList.add('wic-on'); S.lastView = 'tryon';
  $('#main').innerHTML = `<h2 class="view-title sr-only">Your walk-in closet</h2>
  <div class="wic">
    <div class="wic-view" tabindex="0" role="region" aria-label="Walk-in closet. Use the left and right arrow keys, or the sections below, to move.">
      <div class="wic-zoom"><div class="wic-track"></div></div>
    </div>
    <div class="wic-chrome"></div>
    <nav class="wic-strip" aria-label="Closet sections">${SECTIONS.map((s) => `<button data-act="wicgo" data-v="${s.k}"><span aria-hidden="true">${s.emoji}</span>${s.label}</button>`).join('')}</nav>
  </div>`;
  wic = null; wicRefresh();
}
/** An item's card: its photo, tags and "Add to outfit". */
function wicCard(id) {
  const it = itemById(id); if (!it) return;
  const worn = Object.values(S.outfit).includes(id), n = wearCounts()[id] || 0;
  openModal();
  paintSheet(`<div class="wic-card"><img src="${url(id)}" alt="${esc(it.name)}">
    <div class="chips">${[TYPES[it.type]?.label, it.color?.name, SEASONS.find(([k]) => k === it.season)?.[1], ...(it.occasions || [])].filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    <p class="muted">${n ? `Worn ${n}×` : 'Not worn yet'}${it.brand ? ` · ${esc(it.brand)}` : ''}</p></div>
    <div class="row" style="margin-top:12px"><button class="ghost" id="wcclose">Close</button><button class="ghost" id="wcedit">Edit</button><button class="primary grow" id="wcadd" ${worn ? 'disabled' : ''}>${worn ? 'In your outfit ✓' : '+ Add to outfit'}</button></div>`, esc(it.name));
  $('#wcclose').onclick = closeModal;
  $('#wcedit').onclick = () => { closeModal(); openItemModal(it); };
  $('#wcadd').onclick = () => {
    S.outfit = wear(S.outfit, it); S.adjust = id; if (S.game.day) { S.game = spendEnergy(S.game, 3); saveGame(); }
    closeModal(); toast(`${it.name} is in your outfit. See it in the mirror 🪞`); wicRefresh();
  };
}
addEventListener('resize', () => { if (S.view === 'tryon' && S.scene === 'closet') { clearTimeout(S.wicRz); S.wicRz = setTimeout(wicRefresh, 150); } });

function renderTryon() { ensureDay(); if (S.scene === 'closet') return renderWalkIn(); document.body.classList.remove('wic-on'); return renderMirror(); }

/** The header's and the bottom bar's heights, for the phone layout (the model fits between them and an open sheet). */
function layoutVars() {
  const r = document.documentElement.style, h = document.querySelector('header.top')?.getBoundingClientRect().height || 64, n = $('#nav')?.getBoundingClientRect().height || 80;
  r.setProperty('--top-h', `${Math.round(h)}px`); r.setProperty('--nav-h', `${Math.round(n)}px`);
}
addEventListener('resize', () => layoutVars());

function renderMirror() {
  if (dollOn() && S.drawer === 'fit') S.drawer = 'looks'; // the doll's fit controls sit right under it instead
  if (S.items.length && !S.items.some((i) => i.type === S.tab)) S.tab = S.items[0].type; // land on a shelf that has something
  const old = $('.tray-row'), keepX = old && S.lastTab === S.tab ? old.scrollLeft : 0, keepY = S.view === S.lastView ? window.scrollY : 0;
  const worn = outfitItems(S.outfit);
  const stk = wearStreak(S.wears, iso(new Date()));
  const m = outfitMeters(worn, S.mood, wearCounts());
  const fit = S.adjust && itemById(S.adjust) && Object.values(S.outfit).includes(S.adjust) ? itemById(S.adjust) : null;
  const pickList = S.items.filter((i) => i.type === S.tab), counts = wearCounts();
  $('#main').innerHTML = `<h2 class="view-title sr-only">Dress up</h2>
  <div class="dress ${dollOn() ? 'dollmode' : ''}">
    <div class="dress-left">
      ${sceneBar()}
      ${dollOn() ? gameBarHTML(false) : ''}
      <div class="room ${dollOn() ? 'dollroom' : 'mirror'} ${S.cas ? 'cas-open' : ''} ${usingPhoto() ? 'photo' : ''}" style="--gem:${m ? `hsl(${Math.round(20 + m.overall * 1.7)} 90% 60%)` : '#7fd8ff'}">
        <div class="gem" aria-hidden="true"></div>
        <div class="stage" id="stage">${stageHTML()}</div>
        ${stk ? `<div class="streakbadge" role="status" aria-label="${stk}-day outfit streak"><span aria-hidden="true">🔥</span> ${stk}</div>` : ''}
        ${dollOn() ? `${Object.keys(worn).length ? `<button class="dolltoggle" data-act="dfit" aria-expanded="${!!S.fitOpen}" aria-controls="dollbar"><span aria-hidden="true">✋</span> Fit</button>` : ''}` : ''}
        ${S.dbgPts && dollOn() ? '<button class="dbgchip" data-act="dbgpts"><span aria-hidden="true">📍</span> Hide points</button>' : ''}
        ${S.cas ? casHTML() : ''}
        ${dollOn() ? dollBarHTML(fit) : ''}
      </div>
      ${dollOn() ? dollFitHTML(worn, fit) : ''}
      <div class="tools" role="group" aria-label="Quick actions">
        <button class="${S.cas ? 'on' : ''}" aria-pressed="${S.cas}" data-act="drawer" data-v="look"><span aria-hidden="true">🎨</span>Customize</button>
        <button data-act="styleme"><span aria-hidden="true">🎲</span>Style me</button>
        <button data-act="clear"><span aria-hidden="true">🧺</span>Undress</button>
        <button data-act="savelook"><span aria-hidden="true">💾</span>Save</button>
        ${dollOn() ? '<button data-act="photo"><span aria-hidden="true">📸</span>Photo</button>' : ''}
        <button class="go" data-act="wearToday"><span aria-hidden="true">📅</span>Wear today</button>
      </div>
      ${metersHTML(worn)}
      <div class="moods" role="group" aria-label="Mood: what’s the occasion?">
        ${OCCASIONS.map((o) => `<button class="chip ${S.mood === o ? 'on' : ''}" aria-pressed="${S.mood === o}" data-act="mood" data-v="${esc(o)}"><span aria-hidden="true">${OCCASION_EMOJI[o]}</span> ${o}</button>`).join('')}
      </div>
      ${weatherLine()}
    </div>
    <div class="dress-right">
      <section class="tray" aria-label="Wardrobe">
        <div class="tabs" role="group" aria-label="Clothing type">${Object.entries(TYPES).map(([k, v]) => `<button class="tab ${S.tab === k ? 'on' : ''}" aria-pressed="${S.tab === k}" data-act="tab" data-v="${k}"><span aria-hidden="true">${v.emoji}</span>${v.label}</button>`).join('')}</div>
        ${S.items.length ? `<div class="tray-row">${pickList.length ? pickList.map((i) => `<button class="pick ${S.outfit[slotOf(i.type)] === i.id ? 'on' : ''} ${starter.isStarter(i) ? 'is-starter' : ''}" aria-pressed="${S.outfit[slotOf(i.type)] === i.id}" data-act="wear" data-id="${i.id}"><img src="${url(i.id)}" alt=""><span>${esc(i.name)}</span><small>${counts[i.id] ? `worn ${counts[i.id]}×` : 'new'}</small></button>`).join('') : `<p class="muted tray-empty">No ${TYPES[S.tab].label.toLowerCase()} yet — <button class="link" data-act="add">add one</button>.</p>`}</div>` : emptyCloset()}
      </section>
      <section class="drawer" aria-label="Outfit options">
        <div class="seg" role="group" aria-label="Options">${DRAWERS.filter(([k]) => !(dollOn() && k === 'fit')).map(([k, l]) => `<button class="${S.drawer === k ? 'on' : ''}" aria-pressed="${S.drawer === k}" data-act="drawer" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="drawer-body">${drawerHTML(worn, fit)}</div>
      </section>
    </div></div>`;
  S.lastTab = S.tab; S.lastView = 'tryon';
  // on a phone, Hair / Anchors / Fit open as a bottom sheet and the model shrinks to fit above it (never cropped)
  document.body.classList.toggle('dsheet', !!(dollOn() && (S.cas || (S.fitOpen && fit))));
  layoutVars();
  mountStage(); restoreCachedRender();
  if (dollOn()) bindDollGestures($('#stage'));
  const row = $('.tray-row'); if (row) row.scrollLeft = keepX;
  window.scrollTo(0, keepY);
  $('#main').querySelectorAll('[data-adj]').forEach((r) => {
    r.oninput = () => { fit.adj[r.dataset.adj] = +r.value; refreshStage(); };
    r.onchange = () => put('items', fit);
  });
  if (S.pop) { S.pop = false; sparkle(); }
}


/* ───────────────────────── the 2D doll: fitting ───────────────────────── */
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let fitTimer = 0;
/** Change how one piece sits on the doll (remembered per art pack), moving it on screen straight away. */
function setFit(item, patch) {
  const f = { ...fitOf(item, dollPack), ...patch };
  f.scale = clampN(f.scale, 0.4, 2.2); f.rot = clampN(f.rot, -45, 45); f.dx = clampN(f.dx, -260, 260); f.dy = clampN(f.dy, -300, 300);
  item.fit = { ...(item.fit || {}), [dollPack.id]: f };
  const g = $(`#stage .gar[data-id="${item.id}"]`);
  if (g) g.setAttribute('transform', garmentTransform(dollPack.anchors[item.type], f));
  clearTimeout(fitTimer); fitTimer = setTimeout(() => put('items', item), 350);
  return f;
}
const selectedItem = () => (S.adjust && Object.values(S.outfit).includes(S.adjust) ? itemById(S.adjust) : null);

/** The fit buttons: a compact bar docked at the bottom of the doll's box, so it stays in view while you scroll the wardrobe. */
function dollBarHTML(fit) {
  if (!dollPack || !S.fitOpen || !fit) return '<div id="dollbar" class="dollbar" hidden></div>';
  const f = fitOf(fit, dollPack), worn = outfitItems(S.outfit);
  const b = (act, v, label, aria) => `<button type="button" class="fb" data-act="${act}" data-v="${v}" data-hold aria-label="${aria}"><span aria-hidden="true">${label}</span></button>`;
  return `<div id="dollbar" class="dollbar" role="group" aria-label="Fit ${esc(fit.name)}">
    <div class="dbname"><img class="dbthumb" src="${url(fit.id)}" alt=""><span>${SLOT_LABEL[slotOf(fit.type)]}: <b>${esc(fit.name)}</b> · drag it on the model, or nudge</span><button type="button" class="fb done" data-act="dfitdone" aria-label="Done fitting">✓ Done</button></div>
    ${Object.keys(worn).length > 1 ? `<div class="chips dbpieces" role="group" aria-label="Piece to fit">${SLOTS.filter((x) => worn[x]).map((x) => `<button type="button" class="chip ${fit.id === worn[x].id ? 'on' : ''}" aria-pressed="${fit.id === worn[x].id}" data-act="fit" data-id="${worn[x].id}">${SLOT_LABEL[x]}: ${esc(worn[x].name)}</button>`).join('')}</div>` : ''}
    <div class="dbrow">${b('dnudge', 'x:-3', '◀', 'Move left')}${b('dnudge', 'x:3', '▶', 'Move right')}${b('dnudge', 'y:-3', '▲', 'Move up')}${b('dnudge', 'y:3', '▼', 'Move down')}${b('dsize', '-0.03', '−', 'Smaller')}${b('dsize', '0.03', '+', 'Bigger')}${b('drot', '-2', '⟲', 'Rotate left')}${b('drot', '2', '⟳', 'Rotate right')}
      ${isTuckable(fit, dollPack) && worn.bottom ? `<button type="button" class="fb wide" data-act="dtuck" aria-pressed="${f.tuck}">${f.tuck ? 'Tucked in' : 'Untucked'}</button>` : ''}<button type="button" class="fb wide" data-act="dreset">↺ Reset</button></div></div>`;
}
/** Which piece you're fitting: one chip per piece on the doll. */
function dollFitHTML(worn, fit) {
  if (!dollPack) return '<div id="dollfit"></div>';
  if (!Object.keys(worn).length) return '<p class="muted dollhint" id="dollfit">Pick something from the wardrobe below to dress the doll.</p>';
  return `<div class="dollfit" id="dollfit" role="group" aria-label="Pieces on the doll">
    <div class="chips dfpieces">${SLOTS.filter((x) => worn[x]).map((x) => `<button class="chip ${fit?.id === worn[x].id && S.fitOpen ? 'on' : ''}" aria-pressed="${fit?.id === worn[x].id && S.fitOpen}" data-act="fit" data-id="${worn[x].id}">${SLOT_LABEL[x]}: ${esc(worn[x].name)}</button>`).join('')}</div></div>`;
}
function refreshDollFit() {
  const worn = outfitItems(S.outfit), fit = selectedItem(), bar = $('#dollbar'), chips = $('#dollfit');
  if (bar) bar.outerHTML = dollBarHTML(fit);
  if (chips) chips.outerHTML = dollFitHTML(worn, fit);
  $('.dolltoggle')?.setAttribute('aria-expanded', String(!!S.fitOpen));
  $('#stage')?.classList.toggle('fitting', !!fit && !!S.fitOpen);
  document.body.classList.toggle('dsheet', !!(dollOn() && (S.cas || (S.fitOpen && fit)))); // (on a phone the Fit controls are a bottom sheet)
}

/** The piece you actually touched: the topmost garment with a visible pixel under the finger (not just a box that happens to cover it). */
function garmentAt(stage, x, y) {
  const svg = stage.querySelector('svg.doll'); if (!svg || !dollPack) return null;
  for (const g of [...svg.querySelectorAll('.gar')].reverse()) { // topmost first
    const it = itemById(g.dataset.id), a = it && dollPack.anchors[it.type], m = g.getScreenCTM(); if (!a || !m) continue;
    const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const p = pt.matrixTransform(m.inverse()), meta = S.meta.get(it.id), fm = S.fitMask.get(it.id);
    if (fm && g.querySelector('image')?.getAttribute('width') == dollPack.size[0]) { // a fitted piece: look at its picture on the body
      const cx = Math.floor(p.x / dollPack.size[0] * fm.w), cy = Math.floor(p.y / dollPack.size[1] * fm.h);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = cx + dx, Y = cy + dy; if (X >= 0 && Y >= 0 && X < fm.w && Y < fm.h && fm.data[Y * fm.w + X]) return g; }
      continue;
    }
    if (!meta?.mask) { if (p.x >= 0 && p.x <= a.w && p.y >= 0 && p.y <= a.h) return g; continue; } // not analysed yet: the whole box is the best guess
    const r = imageRect(a, meta), u = (p.x - r.x) / r.w, v = (p.y - r.y) / r.h; if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    const N = meta.N, cx = Math.min(N - 1, Math.floor(u * N)), cy = Math.min(N - 1, Math.floor(v * N));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = cx + dx, Y = cy + dy; if (X >= 0 && Y >= 0 && X < N && Y < N && meta.mask[Y * N + X]) return g; }
  }
  return null;
}

/** Drag the selected piece on the doll; pinch (two fingers) to resize and turn it. */
function bindDollGestures(stage) {
  if (!stage) return;
  stage.classList.toggle('fitting', !!selectedItem() && !!S.fitOpen);
  const pts = new Map(); let g = null;
  const start = () => {
    const it = selectedItem(); if (!it || !pts.size) return (g = null);
    const [a, b] = [...pts.values()], f = fitOf(it, dollPack);
    g = { it, f, cx: b ? (a.x + b.x) / 2 : a.x, cy: b ? (a.y + b.y) / 2 : a.y, d: b ? Math.hypot(b.x - a.x, b.y - a.y) : 0, ang: b ? Math.atan2(b.y - a.y, b.x - a.x) : 0 };
  };
  stage.onpointerdown = (e) => {
    const gar = garmentAt(stage, e.clientX, e.clientY);
    if (gar && (gar.dataset.id !== S.adjust || !S.fitOpen)) { S.adjust = gar.dataset.id; S.fitOpen = true; stage.innerHTML = stageHTML(); refreshDollFit(); }
    if (!selectedItem() || !S.fitOpen) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); stage.setPointerCapture(e.pointerId); start();
  };
  stage.onpointermove = (e) => {
    if (!g || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const svg = stage.querySelector('svg'), k = svg?.getScreenCTM()?.a; if (!k) return;
    const [a, b] = [...pts.values()], cx = b ? (a.x + b.x) / 2 : a.x, cy = b ? (a.y + b.y) / 2 : a.y, move = { dx: g.f.dx + (cx - g.cx) / k, dy: g.f.dy + (cy - g.cy) / k };
    if (b && g.d) setFit(g.it, { ...move, scale: g.f.scale * (Math.hypot(b.x - a.x, b.y - a.y) / g.d), rot: g.f.rot + ((Math.atan2(b.y - a.y, b.x - a.x) - g.ang) * 180) / Math.PI });
    else setFit(g.it, move);
  };
  const up = (e) => { pts.delete(e.pointerId); if (g) { clearTimeout(fitTimer); put('items', g.it); } start(); };
  stage.onpointerup = up; stage.onpointercancel = up;
}

// hold a fit button to keep nudging
let holdT = 0;
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest?.('[data-hold]'); if (!b || e.button) return;
  const fire = () => doFitAction(b.dataset.act, b.dataset.v);
  fire(); clearTimeout(holdT); holdT = setTimeout(function again() { fire(); holdT = setTimeout(again, 55); }, 380);
});
for (const t of ['pointerup', 'pointercancel', 'pointerleave']) document.addEventListener(t, () => clearTimeout(holdT), true);

function doFitAction(act, v) {
  const it = selectedItem(); if (!it || !dollOn()) return;
  const f = fitOf(it, dollPack);
  if (act === 'dnudge') { const [ax, n] = v.split(':'); setFit(it, ax === 'x' ? { dx: f.dx + +n } : { dy: f.dy + +n }); }
  else if (act === 'dsize') setFit(it, { scale: f.scale + +v });
  else if (act === 'drot') setFit(it, { rot: f.rot + +v });
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

/** The doll as a picture (for share cards): its cutouts are inlined first, because an SVG drawn as an image can't load blob: URLs. */
async function dollCanvas() {
  if (!dollOn() || !dollPack) return null;
  const items = outfitItems(S.outfit), urls = new Map();
  const fits = new Map();
  for (const it of Object.values(items)) { urls.set(it.id, await blobToData(it.cutout)); if (S.fitBlobs.has(it.id)) fits.set(it.id, await blobToData(S.fitBlobs.get(it.id))); }
  const bodyFile = dollPack.layers.body, baseData = await blobToData(await (await fetch(baseFor(items) || dollPack.files[bodyFile])).blob()); // an SVG drawn as an image can't fetch files either
  let hair = myHair(); if (hair) hair = { ...hair, href: await blobToData(await (await fetch(hair.href)).blob()) }; // (an SVG drawn as an image can't fetch files)
  const svg = dollSVG({ pack: { ...dollPack, files: { ...dollPack.files, [bodyFile]: baseData } }, items, urls, fits, hair });
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  try { await img.decode(); } catch { return null; }
  const [, , w, h] = dollPack.view, c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function makeLookCard() {
  const worn = outfitItems(S.outfit), list = SLOTS.map((s) => worn[s]).filter(Boolean);
  if (!list.length) return toast('Dress the model first');
  const name = $('#lookname')?.value.trim();
  const blob = await lookCard({
    title: name || (S.mood ? `${OCCASION_EMOJI[S.mood]} ${S.mood} look` : 'My look'),
    sub: new Date().toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' }),
    items: list.map((i) => ({ name: i.name, url: url(i.id) })),
    model: await dollCanvas(),
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
    return `<button class="day ${d.getMonth() !== mo ? 'off' : ''} ${k === S.date ? 'sel' : ''} ${k === today ? 'today' : ''}" aria-pressed="${k === S.date}" aria-label="${d.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}${ws.length ? `, ${ws.length} outfit${ws.length > 1 ? 's' : ''} logged` : ''}${k === today ? ', today' : ''}" data-act="pickday" data-v="${k}"><b aria-hidden="true">${d.getDate()}</b>${last ? (last.render ? `<img class="render" src="${url('render:' + last.id, last.render)}" alt="">` : figure(last.itemIds, 'mini')) : ''}</button>`;
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
        ${dayWears.map((w) => `<div class="logrow">${w.photo ? `<button class="lb" data-act="lbopen" data-id="${w.id}" aria-label="Open the photo"><img src="${url('photo:' + w.id, w.photo)}" alt=""></button>` : ''}${w.render ? `<img class="render-thumb" src="${url('render:' + w.id, w.render)}" alt="Photo of this outfit">` : ''}<div class="thumbs">${w.itemIds.map(itemById).filter(Boolean).map((i) => `<img src="${url(i.id)}" alt="${esc(i.name)}" title="${esc(i.name)}">`).join('')}</div>
          <div class="grow muted">${esc(w.occasion || '')}${w.note ? ' — ' + esc(w.note) : ''}</div>
          <button class="ghost danger" data-act="delwear" data-id="${w.id}" aria-label="Delete this entry"><span aria-hidden="true">×</span></button></div>`).join('') || '<p class="muted">Nothing logged for this day.</p>'}
        <h3 style="margin-top:14px">Log an outfit</h3>
        <p class="muted">Uses whatever is on the mannequin in Try On (${Object.keys(S.outfit).length} pieces).</p>
        <select id="wocc" aria-label="Occasion"><option value="">Occasion</option>${OCCASIONS.map((o) => `<option>${o}</option>`).join('')}</select>
        <input type="text" id="wnote" aria-label="Note" placeholder="Note (e.g. got compliments!)" style="margin-top:6px">
        <div class="row" style="margin-top:8px"><button class="primary" data-act="logday">Log it</button><button class="ghost" data-act="tab-tryon">Edit outfit</button></div></div>
      ${lookbookHTML()}
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

/** Inspo: the pieces an AI sees in the picture, each with a button that draws it on the model and adds it to the closet. */
function ideasHTML(d) {
  if (!d.ideas) return `<p class="muted">An AI lists the pieces in this picture; tap one to have it made for your model (about ${Math.round(wearAI.WEAR_NEURONS + 12)} neurons each, free tier). The pin’s own picture is never put on her.</p><button class="ghost" data-act="inspoideas">✨ What’s in this look?</button>`;
  if (d.ideas.busy) return '<p class="muted" role="status">Looking at the picture…</p>';
  if (d.ideas.error) return `<p class="muted" role="alert">${esc(d.ideas.error)}</p><button class="ghost" data-act="inspoideas">Try again</button>`;
  if (!d.ideas.length) return '<p class="muted">No pieces found in this picture.</p>';
  return `<div class="ideas">${d.ideas.map((p, k) => `<div class="idea"><div><b>${esc(p.name)}</b><div class="muted">${esc(SLOT_LABEL[slotOf(p.type)] || p.type)} · ${esc(p.detail)}</div>${p.error ? `<div class="muted" role="alert">${esc(p.error)}</div>` : ''}</div>
    ${p.made ? '<b class="ok">✓ In your closet</b>' : `<button class="ghost" data-act="makeidea" data-v="${k}" ${p.busy ? 'disabled' : ''}>${p.busy ? 'Making…' : 'Make it for the model'}</button>`}</div>`).join('')}</div>`;
}
const paintIdeas = () => { const el = $('#ideas'); if (el && S.inspo) el.innerHTML = ideasHTML(S.inspo); };
/** One piece drawn on the model and added to the closet (remade up to twice if the piece can't be found in the picture). */
async function makePieceForModel(piece, pass, { occasion = '' } = {}) {
  const pack = dollPack || await loadPack(); if (!pack) throw new Error('The model picture didn’t load. Try again.');
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { blob, info } = await wearAI.drawWorn(piece, pass, pack); if (Number.isFinite(info.used)) starter.setUsed(info.used);
    const done = await wearAI.extractWorn(blob, piece, pack); last = done;
    if (!done.check.ok || !done.worn) continue;
    const item = { id: uid(), source: 'starter', starterId: `inspo-${uid()}`, made: 'model', ready: true, name: piece.name, type: piece.type, occasions: occasion ? [occasion] : [], season: 'all', brand: '',
      color: done.color, colors: done.colors, tags: { colors: piece.colors }, cutout: done.cutout, worn: done.worn, original: blob, adj: { scale: 1, dx: 0, dy: 0 }, checkVersion: starter.CHECK_VERSION, createdAt: Date.now(), updatedAt: Date.now() };
    await put('items', item); S.items.push(item); url(item.id, item.cutout); analyseItem(item);
    return item;
  }
  throw new Error(`It didn’t come out right (${(last?.check.reasons || []).join('; ')}). Try again.`);
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
    <div style="flex:0 0 220px"><div class="stage">${figure(d.picks)}</div></div>
    <div class="grow" style="min-width:240px"><h3>Inspo palette</h3>
      <div class="pal">${d.palette.map((p) => `<span style="background:${p.hex};flex:${Math.max(p.share, .08)}">${colorName(p.hex)}</span>`).join('')}</div>
      <h3>Your closest look</h3>${rows || '<p class="muted">Nothing in your closet is close enough yet.</p>'}
      <h3>Make pieces like these</h3>
      <div id="ideas">${ideasHTML(d)}</div>
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
    case 'add': return openItemModal(undefined, TYPES[v] ? { type: v } : {});
    case 'edit': return openItemModal(itemById(id));
    case 'ftype': S.filter.type = v; return renderCloset();
    case 'fsrc': S.filter.src = v; return renderCloset();
    case 'rmstarterreview': { const bad = S.starterReview || []; if (!bad.length || !confirm(`Delete ${bad.length} starter piece${bad.length === 1 ? '' : 's'} that need review? You can make them again from Starter closet.`)) return; for (const b of bad) await del('items', b.id); S.starterReview = []; render(); return toast(`Deleted ${bad.length} ✓`); }
    case 'starterbatch': return openStarterBatch(v);
    case 'hidestarter': store.set('hidestarter', store.get('hidestarter', '') === '1' ? '' : '1'); return location.reload();
    case 'tryit': { const it = itemById(id); S.outfit = wear(S.outfit, it); S.tab = it.type; S.adjust = it.id; S.pop = true; S.scene = 'doll'; return go('tryon'); }
    case 'dnudge': case 'dsize': case 'drot': if (e.detail === 0) doFitAction(act, v); return; // a mouse/touch press is handled on pointerdown (so holding repeats); this is the keyboard
    case 'dfit': S.fitOpen = !S.fitOpen; if (S.fitOpen && !selectedItem()) S.adjust = Object.values(S.outfit)[0] || null; $('#stage').innerHTML = stageHTML(); refreshDollFit(); return;
    case 'dfitdone': S.fitOpen = false; $('#stage').innerHTML = stageHTML(); refreshDollFit(); return;
    case 'dtuck': { const it = selectedItem(); if (!it) return; setFit(it, { tuck: !fitOf(it, dollPack).tuck }); await put('items', it); return renderTryon(); }
    case 'dreset': { const it = selectedItem(); if (!it) return; const rest = { ...(it.fit || {}) }; delete rest[dollPack.id]; it.fit = rest; await put('items', it); return renderTryon(); }
    case 'tab': S.tab = v; return renderTryon();
    case 'scene': S.scene = v; store.set('scene', v); S.cas = false; renderTryon(); window.scrollTo(0, 0); return;
    case 'wicgo': return wic?.glide(v, !!el.dataset.hot);
    case 'wicitem': return wicCard(id);
    case 'wicmirror': S.scene = 'doll'; store.set('scene', 'doll'); renderTryon(); window.scrollTo(0, 0); return;
    case 'wicpill': S.wicPill = !S.wicPill; return wicChrome();
    case 'wictip': store.set('wictip', '1'); return $('.wic-tip')?.remove();
    case 'cas': S.casTab = v; return renderTryon();
    case 'casclose': S.cas = false; return renderTryon();
    case 'hairfit': return openHairFit(v);
    case 'gbpill': S.gbOpen = !S.gbOpen; return refreshGame();
    case 'hairstyle': case 'haircolor': { const k = act === 'hairstyle' ? 'hairStyle' : 'hairColor'; S[k] = v; store.set(act, v); return S.scene === 'closet' && S.view === 'tryon' ? wicRefresh() : renderTryon(); }
    case 'wichair': S.scene = 'doll'; store.set('scene', 'doll'); S.cas = true; S.casTab = 'hair'; renderTryon(); window.scrollTo(0, 0); return;
    case 'wear': S.outfit = wear(S.outfit, itemById(id)); S.adjust = id; S.pop = true; if (S.game.day) { S.game = spendEnergy(S.game, 3); saveGame(); } return renderTryon();
    case 'dbgpts': S.dbgPts = !S.dbgPts; store.set('dbgpts', S.dbgPts ? '1' : ''); if (S.dbgPts) S.cas = false; /* get the panel out of the way so the points are visible */ return renderTryon();
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
    case 'fit': S.adjust = id; if (dollOn()) S.fitOpen = !(S.fitOpen && S.adjust === id && el.getAttribute('aria-pressed') === 'true'); return renderTryon();
    case 'resetfit': { const it = itemById(id); it.adj = { scale: 1, dx: 0, dy: 0 }; await put('items', it); return renderTryon(); }
    case 'airender': return runAIRender();
    case 'airefresh': return runAIRender(true);
    case 'aicancel': return S.aiAbort?.abort();
    case 'aiclear': S.ai = null; return renderTryon();
    case 'display': if (S.profile) { S.profile.display = v; await put('profile', S.profile); } return renderTryon();
    case 'setup': return openModelModal();
    case 'clear': S.outfit = {}; return renderTryon();
    case 'styleme': {
      const o = S.mood;
      if (!S.items.length) return toast('Add some pieces first');
      const r = styleMe(S.items, o, wearCounts(), todayWeather(ctx));
      if (!Object.keys(r).length) return toast(`Nothing tagged for ${o} yet`);
      S.outfit = Object.fromEntries(Object.entries(r).map(([s, i]) => [s, i.id]));
      S.pop = true; if (S.game.day) { S.game = spendEnergy(S.game, 8); saveGame(); } return renderTryon();
    }
    case 'rate': return rateNow();
    case 'photo': return openPhoto();
    case 'phbg': case 'phpose': { const kind = act === 'phbg' ? 'bg' : 'pose'; if (!owns(S.game, `${kind}:${v}`)) return showShop(kind); S.game = usePhoto(S.game, `${kind}:${v}`); saveGame(); return paintPhoto(); }
    case 'phtake': return photoSave();
    case 'phshare': { const b = await photoBlob(photoCanvas()), r = await shareOrDownload(b, `look-${iso(new Date())}.jpg`, 'My look'); return r !== 'cancelled' && toast(r === 'shared' ? 'Shared ✓' : 'Photo saved'); }
    case 'lbopen': return lookbookOpen(id);
    case 'lbshare': { const w = S.wears.find((x) => x.id === id); if (!w?.photo) return; const r = await shareOrDownload(w.photo, `look-${w.date}.jpg`, 'My look'); return r !== 'cancelled' && toast(r === 'shared' ? 'Shared ✓' : 'Photo saved'); }
    case 'lbdel': { const w = S.wears.find((x) => x.id === id); if (!w) return; delete w.photo; await put('wears', w); URL.revokeObjectURL(S.urls.get('photo:' + id) || ''); S.urls.delete('photo:' + id); closeModal(); return renderPlanner(); }
    case 'shop': return showShop(S.shopTab || 'furn');
    case 'shoptab': return showShop(v);
    case 'shopbuy': return shopBuy(v);
    case 'shopuse': return shopUse(v);
    case 'endday': {
      if (!hasOutfit()) return toast('Dress the doll first');
      S.date = iso(new Date()); S.month = new Date(); if (!S.wears.some((w) => w.date === S.date)) await logWear(S.date, S.mood);
      S.game = endDay(S.game); saveGame(); refreshGame(); return;
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
    case 'inspoideas': {
      const d = S.inspo; if (!d) return;
      const pass = store.get('aipass', '') || prompt('Your passcode (the APP_PASSCODE set in Vercel):')?.trim(); if (!pass) return; store.set('aipass', pass);
      d.ideas = { busy: true }; paintIdeas();
      try {
        const c = toCanvas((await loadImage(d.blob)).img, 512), img = c.toDataURL('image/jpeg', 0.85);
        const r = await fetch('/api/starter', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-passcode': pass }, body: JSON.stringify({ describe: true, image: img }) });
        const j = await r.json().catch(() => ({})); if (Number.isFinite(j.used)) starter.setUsed(j.used);
        if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
        d.ideas = j.pieces || [];
      } catch (e) { d.ideas = { error: e.message }; if (/passcode/i.test(e.message)) store.set('aipass', ''); }
      return paintIdeas();
    }
    case 'makeidea': {
      const d = S.inspo, p = d?.ideas?.[+v]; if (!p || p.busy) return;
      const pass = store.get('aipass', ''); if (!pass) return;
      p.busy = true; p.error = ''; paintIdeas();
      try { await makePieceForModel(p, pass, { occasion: d.occasion }); p.made = true; toast(`${p.name} added to your closet ✓`); }
      catch (e) { p.error = e.message; }
      p.busy = false; return paintIdeas();
    }
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
    case 'tryinspo': S.outfit = { ...S.inspo.picks }; S.scene = 'doll'; return go('tryon');
    default: if (planActs[act]) return planActs[act](ctx, el);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (/^custom-(skin|hair)$/.test(t.id)) { const k = t.id.slice(7); S[k] = t.value; store.set(k, t.value); mountStage(); }
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
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!$('#modal').hidden) closeModal();  });

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
const ctx = { S, $, esc, url, toast, put, del, uid, iso, store, itemById, figure, wearCounts, go, wearIds, afterEvent: () => retheme(), openItemModal: (x, p) => openItemModal(x, p) };

(async () => {
  await load();
  loadForecast(ctx).then(() => { if (S.view === 'tryon') renderTryon(); }); // so "Style me" and the weather chip know today's weather
  render();
  window.__closet = S; // handy for debugging
  Object.defineProperty(window, '__wic', { get: () => wic });
  try { const m = sessionStorage.getItem('synced'); if (m) { sessionStorage.removeItem('synced'); syncMsg = m; toast(m); } } catch { /* private mode */ }
  if (syncState().on) runSync(); // pick up changes from other devices
  openFromLink();
  try { const n = sessionStorage.getItem('restored'); if (n) { sessionStorage.removeItem('restored'); toast(`Restored ${n} piece${n === '1' ? '' : 's'} from your backup`); } } catch { /* private mode */ }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {}); // lets it install as an app and open offline
})();
