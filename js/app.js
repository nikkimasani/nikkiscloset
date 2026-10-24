import { all, put, del, uid } from './db.js';
import { OCCASIONS, TYPES, SLOTS, SLOT_LABEL, SKIN, HAIR, slotOf, wear } from './data.js';
import { loadImage, toCanvas, removeBackground, canvasToBlob } from './cutout.js';
import { palette, colorName, hexDist } from './color.js';
import { mannequinSVG } from './mannequin.js';
import { matchInspo, styleMe, colorScore } from './stylist.js';
import { SAMPLES, sampleBlob } from './sample.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

const S = {
  items: [], outfits: [], wears: [], inspos: [],
  urls: new Map(),
  view: 'closet',
  filter: { type: 'all', occ: 'all', q: '' },
  outfit: {},                       // slot -> item id (the outfit on the mannequin)
  tab: 'tops', adjust: null,        // try-on picker tab, item being fitted
  skin: store.get('skin', SKIN[1]), hair: store.get('hair', HAIR[1]),
  month: new Date(), date: iso(new Date()),
  inspo: null,                      // working inspo draft
};

const itemById = (id) => S.items.find((i) => i.id === id);
const url = (key, blob) => { if (!S.urls.has(key) && blob) S.urls.set(key, URL.createObjectURL(blob)); return S.urls.get(key); };
const wearCounts = () => S.wears.reduce((m, w) => (w.itemIds.forEach((id) => (m[id] = (m[id] || 0) + 1)), m), {});

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2400);
}

async function load() {
  [S.items, S.outfits, S.wears, S.inspos] = await Promise.all(['items', 'outfits', 'wears', 'inspos'].map(all));
  S.items.sort((a, b) => a.createdAt - b.createdAt);
  S.items.forEach((i) => url(i.id, i.cutout));
  S.inspos.forEach((n) => url('inspo:' + n.id, n.photo));
}

/** slot -> item objects for a {slot: id} map or an id list. */
function outfitItems(src) {
  const ids = Array.isArray(src) ? src : Object.values(src);
  const out = {};
  ids.map(itemById).filter(Boolean).forEach((i) => (out[slotOf(i.type)] = i));
  return out;
}
const mannequin = (src, cls = '') => mannequinSVG({ skin: S.skin, hair: S.hair, items: outfitItems(src), urls: S.urls, cls });
const hanger = '<svg class="hang" viewBox="0 0 44 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M22 2a4 4 0 1 1 3 6.5L22 10 3 16h38L22 10"/></svg>';

/* ───────────────────────── router ───────────────────────── */
function go(view) {
  S.view = view;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  render();
}
function render() { ({ closet: renderCloset, tryon: renderTryon, planner: renderPlanner, inspo: renderInspo })[S.view](); }

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
    return `<section class="rail"><h2>${TYPES[t].emoji} ${TYPES[t].label} <small>${list.length}</small></h2>
      <div class="rail-row">${list.map(pieceCard).join('')}</div></section>`;
  }).join('');

  $('#main').innerHTML = `
    <div class="row">
      <input type="search" id="q" class="grow" placeholder="Search your closet…" value="${esc(q)}" style="max-width:300px">
      <select id="occ" style="width:auto"><option value="all">All occasions</option>${OCCASIONS.map((o) => `<option ${o === occ ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <span class="muted">${S.items.length} pieces</span>
    </div>
    <div class="chips" style="margin-top:12px">
      <button class="chip ${type === 'all' ? 'on' : ''}" data-act="ftype" data-v="all">All</button>
      ${Object.entries(TYPES).map(([k, v]) => `<button class="chip ${type === k ? 'on' : ''}" data-act="ftype" data-v="${k}">${v.label} · ${counts[k]}</button>`).join('')}
    </div>
    ${rails || emptyCloset()}`;
  const qEl = $('#q');
  qEl.oninput = () => { S.filter.q = qEl.value; const p = qEl.selectionStart; renderCloset(); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); };
  $('#occ').onchange = (e) => { S.filter.occ = e.target.value; renderCloset(); };
}

function emptyCloset() {
  if (S.items.length) return `<div class="empty"><h2>Nothing here</h2><p class="muted">No pieces match those filters.</p></div>`;
  return `<div class="empty"><h2>Your closet is empty ✨</h2>
    <p class="muted">Snap a photo of each piece (flat on a bed or hanging on a plain wall works best) and add it.</p>
    <div class="row" style="justify-content:center;margin-top:14px">
      <button class="primary" data-act="add">+ Add your first piece</button>
      <button class="ghost" data-act="samples">Load a sample closet to explore</button></div></div>`;
}

function pieceCard(i) {
  const worn = wearCounts()[i.id] || 0;
  return `<article class="piece">${hanger}
    <button class="edit" data-act="edit" data-id="${i.id}" aria-label="Edit ${esc(i.name)}">✎</button>
    <div class="img" data-act="tryit" data-id="${i.id}" title="Try on"><img src="${url(i.id)}" alt="${esc(i.name)}"></div>
    <div class="name">${esc(i.name)}</div>
    <div class="meta"><span class="dot" style="background:${i.color?.hex}"></span>${esc(i.color?.name || '')} · worn ${worn}×</div></article>`;
}

/* ───────────────────────── add / edit modal ───────────────────────── */
function openItemModal(existing) {
  const d = {
    id: existing?.id || uid(), name: existing?.name || '', type: existing?.type || 'tops',
    occasions: [...(existing?.occasions || [])], brand: existing?.brand || '', color: existing?.color || null,
    tolerance: 42, keep: false, canvas: null, source: null, cutout: existing?.cutout || null, sample: existing?.sample,
  };
  const m = $('#modal');
  m.hidden = false;
  const paint = () => {
    m.innerHTML = `<div class="sheet" role="dialog" aria-label="${existing ? 'Edit piece' : 'Add piece'}">
      <h2>${existing ? 'Edit piece' : 'Add a piece'}</h2>
      <label class="f">Photo (any plain background works best)</label>
      <input type="file" id="file" accept="image/*" capture="environment">
      <div class="preview" style="margin-top:10px">
        <figure><div class="box">${d.source ? `<img src="${d.source}" alt="Original">` : '<span class="muted">Original</span>'}</div><figcaption class="muted">Your photo</figcaption></figure>
        <figure><div class="box" id="cutbox">${d.cutoutUrl || (existing && url(existing.id)) ? `<img id="cutimg" src="${d.cutoutUrl || url(existing.id)}" alt="Cutout">` : '<span class="muted">Cutout</span>'}</div><figcaption class="muted">Mannequin-ready cutout</figcaption></figure>
      </div>
      ${d.source ? `<label class="f">Background removal strength: <span id="tolv">${d.tolerance}</span></label>
        <input type="range" id="tol" min="8" max="110" value="${d.tolerance}">
        <label class="row" style="margin-top:6px"><input type="checkbox" id="keep" ${d.keep ? 'checked' : ''}> Keep original background</label>` : ''}
      <label class="f">Name</label><input type="text" id="name" value="${esc(d.name)}" placeholder="e.g. Black satin cami">
      <div class="row"><div class="grow"><label class="f">Type</label>
        <select id="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
        <div class="grow"><label class="f">Brand (optional)</label><input type="text" id="brand" value="${esc(d.brand)}"></div></div>
      <label class="f">Occasions</label>
      <div class="chips" id="occs">${OCCASIONS.map((o) => `<button type="button" class="chip ${d.occasions.includes(o) ? 'on' : ''}" data-o="${o}">${o}</button>`).join('')}</div>
      <label class="f">Main colour ${d.color ? `— ${esc(d.color.name)}` : ''}</label>
      <input type="color" id="color" value="${d.color?.hex || '#888888'}" style="width:70px;height:34px;padding:0;border:0;background:none">
      <div class="row" style="margin-top:18px;justify-content:space-between">
        <span>${existing ? '<button class="ghost danger" id="rm">Delete</button>' : ''}</span>
        <span class="row"><button class="ghost" id="cancel">Cancel</button><button class="primary" id="save">Save to closet</button></span></div>
    </div>`;
    wire();
  };

  const recut = () => {
    if (!d.base) return;
    d.canvas = d.keep ? d.base : removeBackground(d.base, { tolerance: d.tolerance });
    d.cutoutUrl = d.canvas.toDataURL('image/png');
    const pal = palette(d.canvas, 1)[0];
    if (pal) d.color = { hex: pal.hex, name: colorName(pal.hex) };
  };

  function wire() {
    $('#cancel').onclick = () => (m.hidden = true);
    $('#occs').onclick = (e) => {
      const o = e.target.dataset.o; if (!o) return;
      d.occasions = d.occasions.includes(o) ? d.occasions.filter((x) => x !== o) : [...d.occasions, o];
      e.target.classList.toggle('on');
    };
    $('#name').oninput = (e) => (d.name = e.target.value);
    $('#brand').oninput = (e) => (d.brand = e.target.value);
    $('#type').onchange = (e) => (d.type = e.target.value);
    $('#color').oninput = (e) => (d.color = { hex: e.target.value, name: colorName(e.target.value) });
    $('#file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const { img, url: u } = await loadImage(f);
        d.source = u; d.base = toCanvas(img);
        if (!d.name) d.name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 40);
        recut(); paint();
      } catch (err) { toast(err.message); }
    };
    const tol = $('#tol');
    if (tol) {
      tol.oninput = () => { d.tolerance = +tol.value; $('#tolv').textContent = tol.value; recut(); $('#cutbox').innerHTML = `<img id="cutimg" src="${d.cutoutUrl}" alt="Cutout">`; };
      $('#keep').onchange = (e) => { d.keep = e.target.checked; recut(); paint(); };
    }
    if ($('#rm')) $('#rm').onclick = async () => {
      if (!confirm(`Delete “${existing.name}” from your closet?`)) return;
      await del('items', existing.id);
      S.items = S.items.filter((i) => i.id !== existing.id);
      for (const k of Object.keys(S.outfit)) if (S.outfit[k] === existing.id) delete S.outfit[k];
      m.hidden = true; render();
    };
    $('#save').onclick = async () => {
      if (!d.canvas && !d.cutout) return toast('Add a photo first 📸');
      if (!d.name.trim()) return toast('Give it a name');
      const cutout = d.canvas ? await canvasToBlob(d.canvas) : d.cutout;
      const item = {
        ...(existing || {}), id: d.id, name: d.name.trim(), type: d.type, occasions: d.occasions, brand: d.brand.trim(),
        color: d.color || existing?.color, cutout, adj: existing?.adj || { scale: 1, dx: 0, dy: 0 },
        createdAt: existing?.createdAt || Date.now(),
      };
      await put('items', item);
      if (existing) { S.urls.delete(item.id); S.items = S.items.map((i) => (i.id === item.id ? item : i)); } else S.items.push(item);
      url(item.id, item.cutout);
      m.hidden = true; toast(existing ? 'Updated ✓' : 'Added to your closet ✓'); render();
    };
  }
  paint();
}

async function loadSamples() {
  for (const s of SAMPLES) {
    const cutout = await sampleBlob(s);
    const item = {
      id: uid(), name: s.name, type: s.type, occasions: s.occasions, brand: '', sample: true,
      color: { hex: s.hex, name: colorName(s.hex) }, cutout, adj: { scale: 1, dx: 0, dy: 0 }, createdAt: Date.now(),
    };
    await put('items', item); S.items.push(item); url(item.id, cutout);
  }
  toast('Sample closet loaded — swap in your real pieces anytime'); render();
}

/* ───────────────────────── try on ───────────────────────── */
function stageHTML() {
  return mannequin(S.outfit);
}
function refreshStage() { const s = $('#stage'); if (s) s.innerHTML = stageHTML(); }

function renderTryon() {
  const worn = outfitItems(S.outfit);
  const pickList = S.items.filter((i) => i.type === S.tab);
  const fit = S.adjust && itemById(S.adjust) && Object.values(S.outfit).includes(S.adjust) ? itemById(S.adjust) : null;
  $('#main').innerHTML = `<div class="tryon">
    <div>
      <div class="stage" id="stage">${stageHTML()}</div>
      <div class="row" style="margin-top:10px;justify-content:space-between">
        <div class="swatches" title="Skin tone">${SKIN.map((c) => `<button class="sw ${c === S.skin ? 'on' : ''}" data-act="skin" data-v="${c}" style="background:${c}" aria-label="Skin tone"></button>`).join('')}</div>
        <div class="swatches" title="Hair">${HAIR.map((c) => `<button class="sw ${c === S.hair ? 'on' : ''}" data-act="hair" data-v="${c}" style="background:${c}" aria-label="Hair colour"></button>`).join('')}</div>
      </div>
    </div>
    <div>
      <div class="row">
        <select id="styleocc" style="width:auto"><option value="">Any occasion</option>${OCCASIONS.map((o) => `<option>${o}</option>`).join('')}</select>
        <button class="primary" data-act="styleme">✨ Style me</button>
        <button class="ghost" data-act="clear">Clear</button>
      </div>
      <div class="chips" style="margin-top:12px">${Object.entries(TYPES).map(([k, v]) => `<button class="chip ${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${v.label}</button>`).join('')}</div>
      <div class="picker-grid">${pickList.length ? pickList.map((i) => `<button class="pick ${S.outfit[slotOf(i.type)] === i.id ? 'on' : ''}" data-act="wear" data-id="${i.id}"><img src="${url(i.id)}" alt=""><span>${esc(i.name)}</span></button>`).join('') : `<p class="muted" style="grid-column:1/-1">No ${TYPES[S.tab].label.toLowerCase()} yet — <a href="#" data-act="add">add one</a>.</p>`}</div>

      <div class="panel"><h3>Wearing</h3>
        ${Object.keys(worn).length ? `<div class="chips">${SLOTS.filter((s) => worn[s]).map((s) => `<button class="chip ${fit?.id === worn[s].id ? 'on' : ''}" data-act="fit" data-id="${worn[s].id}">${SLOT_LABEL[s]}: ${esc(worn[s].name)}</button>`).join('')}</div>` : '<p class="muted">Tap pieces above to dress the mannequin.</p>'}
        ${fit ? `<div style="margin-top:10px"><div class="muted">Fit “${esc(fit.name)}” on the mannequin</div>
          ${[['scale', 'Size', 0.5, 1.8, 0.02], ['dx', 'Left / right', -60, 60, 1], ['dy', 'Up / down', -80, 80, 1]].map(([k, l, a, b, st]) => `<label class="f">${l}</label><input type="range" data-adj="${k}" min="${a}" max="${b}" step="${st}" value="${fit.adj[k]}">`).join('')}
          <button class="ghost" data-act="resetfit" data-id="${fit.id}" style="margin-top:6px">Reset</button></div>` : ''}
      </div>

      <div class="panel"><h3>Save or wear this look</h3>
        <div class="row"><input type="text" id="lookname" placeholder="Look name (optional)" class="grow">
        <select id="lookocc" style="width:auto"><option value="">Occasion</option>${OCCASIONS.map((o) => `<option>${o}</option>`).join('')}</select></div>
        <div class="row" style="margin-top:8px"><button class="ghost" data-act="savelook">💾 Save look</button>
        <button class="primary" data-act="wearToday">👗 I’m wearing this today</button></div>
        ${S.outfits.length ? `<h3 style="margin-top:14px">Saved looks</h3><div class="chips">${S.outfits.map((o) => `<span class="chip"><button class="ghost" style="border:0;padding:0" data-act="loadlook" data-id="${o.id}">${esc(o.name)}${o.occasion ? ' · ' + esc(o.occasion) : ''}</button> <button class="ghost danger" style="border:0;padding:0 0 0 6px" data-act="dellook" data-id="${o.id}" aria-label="Delete look">×</button></span>`).join('')}</div>` : ''}
      </div>
    </div></div>`;
  $('#main').querySelectorAll('[data-adj]').forEach((r) => {
    r.oninput = async () => { fit.adj[r.dataset.adj] = +r.value; refreshStage(); };
    r.onchange = () => put('items', fit);
  });
}

async function logWear(date, occasion = '', note = '') {
  const ids = Object.values(S.outfit);
  if (!ids.length) return toast('Dress the mannequin first');
  const w = { id: uid(), date, itemIds: ids, occasion, note, createdAt: Date.now() };
  await put('wears', w); S.wears.push(w);
  toast(`Logged for ${date} ✓`);
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
    return `<button class="day ${d.getMonth() !== mo ? 'off' : ''} ${k === S.date ? 'sel' : ''} ${k === today ? 'today' : ''}" data-act="pickday" data-v="${k}"><b>${d.getDate()}</b>${last ? mannequin(last.itemIds, 'mini') : ''}</button>`;
  }).join('');
  const dayWears = S.wears.filter((w) => w.date === S.date);
  const counts = wearCounts();
  const top = [...S.items].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0)).filter((i) => counts[i.id]).slice(0, 3);
  const never = S.items.filter((i) => !counts[i.id] && !['accessories'].includes(i.type)).slice(0, 6);
  $('#main').innerHTML = `<div class="planner"><div>
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <button class="ghost" data-act="month" data-v="-1">‹</button><h2>${S.month.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2><button class="ghost" data-act="month" data-v="1">›</button></div>
    <div class="cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div></div>
    <div>
      <div class="panel" style="margin-top:0"><h3>${new Date(S.date + 'T12:00').toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
        ${dayWears.map((w) => `<div class="logrow"><div class="thumbs">${w.itemIds.map(itemById).filter(Boolean).map((i) => `<img src="${url(i.id)}" alt="${esc(i.name)}" title="${esc(i.name)}">`).join('')}</div>
          <div class="grow muted">${esc(w.occasion || '')}${w.note ? ' — ' + esc(w.note) : ''}</div>
          <button class="ghost danger" data-act="delwear" data-id="${w.id}" aria-label="Delete entry">×</button></div>`).join('') || '<p class="muted">Nothing logged for this day.</p>'}
        <h3 style="margin-top:14px">Log an outfit</h3>
        <p class="muted">Uses whatever is on the mannequin in Try On (${Object.keys(S.outfit).length} pieces).</p>
        <select id="wocc"><option value="">Occasion</option>${OCCASIONS.map((o) => `<option>${o}</option>`).join('')}</select>
        <input type="text" id="wnote" placeholder="Note (e.g. got compliments!)" style="margin-top:6px">
        <div class="row" style="margin-top:8px"><button class="primary" data-act="logday">Log it</button><button class="ghost" data-act="tab-tryon">Edit outfit</button></div></div>
      <div class="panel"><h3>Closet stats</h3>
        <div class="muted">Most worn</div>${top.map((i) => `<div class="logrow"><img src="${url(i.id)}" style="width:32px;height:32px;object-fit:contain" alt=""> <span class="grow">${esc(i.name)}</span><b>${counts[i.id]}×</b></div>`).join('') || '<div class="muted">Log some outfits to see this.</div>'}
        ${never.length ? `<div class="muted" style="margin-top:10px">Never worn — give them a turn:</div><div class="thumbs" style="margin-top:4px">${never.map((i) => `<img src="${url(i.id)}" title="${esc(i.name)}" alt="${esc(i.name)}">`).join('')}</div>` : ''}</div>
    </div></div>`;
}

/* ───────────────────────── inspo ───────────────────────── */
function renderInspo() {
  const d = S.inspo;
  $('#main').innerHTML = `<div class="inspo"><div>
    <div class="drop" id="drop" tabindex="0">${d ? `<img src="${d.url}" alt="Inspo">` : '<h3>Drop a Pinterest pic here</h3><p class="muted">Click to upload, drag in, or paste (Ctrl/⌘+V) a screenshot or saved image.</p>'}</div>
    <input type="file" id="ifile" accept="image/*" hidden>
    <label class="f">Pin link (optional — kept so you can find it again)</label>
    <input type="url" id="plink" placeholder="https://pinterest.com/pin/…" value="${esc(d?.link || '')}">
    <label class="f">Occasion</label>
    <select id="iocc"><option value="">Any</option>${OCCASIONS.map((o) => `<option ${d?.occasion === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <label class="f">Pieces you can see in the photo</label>
    <div class="chips" id="iwant">${['dress', 'top', 'bottom', 'outer', 'shoes', 'bag'].map((s) => `<button class="chip ${(d?.wanted || ['top', 'bottom', 'shoes']).includes(s) ? 'on' : ''}" data-s="${s}">${SLOT_LABEL[s]}</button>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="primary" data-act="saveinspo" ${d ? '' : 'disabled'}>📌 Save inspo</button></div>
    ${S.inspos.length ? `<h3 style="margin-top:16px">Saved inspo</h3><div class="inspo-saved">${S.inspos.map((n) => `<img src="${url('inspo:' + n.id)}" data-act="loadinspo" data-id="${n.id}" alt="Saved inspo" title="${esc(n.occasion || '')}">`).join('')}</div>` : ''}
  </div><div id="iresult">${d ? '' : '<div class="empty"><h2>Shop your own closet</h2><p class="muted">Upload an outfit you love. I’ll pull its colour palette and rebuild the closest look from pieces you already own — and tell you what’s missing.</p></div>'}</div></div>`;

  const drop = $('#drop'), file = $('#ifile');
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => e.key === 'Enter' && file.click();
  file.onchange = () => file.files[0] && setInspoFile(file.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); f && setInspoFile(f); };
  $('#plink').oninput = (e) => d && (d.link = e.target.value);
  $('#iocc').onchange = (e) => { if (d) { d.occasion = e.target.value; showMatch(); } };
  $('#iwant').onclick = (e) => {
    const s = e.target.dataset.s; if (!s || !d) return;
    d.wanted = d.wanted.includes(s) ? d.wanted.filter((x) => x !== s) : [...d.wanted, s];
    e.target.classList.toggle('on'); showMatch();
  };
  if (d) showMatch();
}

async function setInspoFile(file, extra = {}) {
  try {
    const { img, url: u } = await loadImage(file);
    const canvas = toCanvas(img, 700);
    S.inspo = { blob: file, url: u, palette: palette(canvas, 5, 18), link: '', occasion: '', wanted: ['top', 'bottom', 'shoes'], ...extra };
    renderInspo();
  } catch (e) { toast(e.message); }
}

function showMatch() {
  const d = S.inspo, el = $('#iresult'); if (!d || !el) return;
  const { picks, gaps } = matchInspo(S.items, d.palette, { wanted: d.wanted, occasion: d.occasion, wearCounts: wearCounts() });
  d.picks = Object.fromEntries(Object.entries(picks).map(([s, p]) => [s, p.item.id]));
  const rows = SLOTS.filter((s) => picks[s]).map((s) => `<div class="match"><img src="${url(picks[s].item.id)}" alt=""><div><b>${esc(picks[s].item.name)}</b><div class="muted">${SLOT_LABEL[s]} · ${esc(picks[s].item.color?.name || '')}</div></div><span class="score">${picks[s].color}%</span></div>`).join('');
  el.innerHTML = `<div class="row" style="align-items:flex-start;gap:20px">
    <div style="flex:0 0 220px"><div class="stage">${mannequin(d.picks)}</div></div>
    <div class="grow" style="min-width:240px"><h3>Inspo palette</h3>
      <div class="pal">${d.palette.map((p) => `<span style="background:${p.hex};flex:${Math.max(p.share, .08)}">${colorName(p.hex)}</span>`).join('')}</div>
      <h3>Your closest look</h3>${rows || '<p class="muted">Nothing in your closet is close enough yet.</p>'}
      ${gaps.map((g) => `<div class="gap">🛍️ You’re missing a <b>${SLOT_LABEL[g.slot].toLowerCase()}</b> like this — look for something in <b>${colorName(g.hex)}</b>.</div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="primary" data-act="tryinspo" ${rows ? '' : 'disabled'}>Try this on</button></div>
    </div></div>`;
}

/* ───────────────────────── events ───────────────────────── */
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('#nav button');
  if (nav) return go(nav.dataset.view);
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, id, v } = el.dataset;
  e.preventDefault();
  switch (act) {
    case 'add': return openItemModal();
    case 'samples': return loadSamples();
    case 'edit': return openItemModal(itemById(id));
    case 'ftype': S.filter.type = v; return renderCloset();
    case 'tryit': { const it = itemById(id); S.outfit = wear(S.outfit, it); S.tab = it.type; S.adjust = it.id; return go('tryon'); }
    case 'tab': S.tab = v; return renderTryon();
    case 'wear': S.outfit = wear(S.outfit, itemById(id)); S.adjust = id; return renderTryon();
    case 'fit': S.adjust = id; return renderTryon();
    case 'resetfit': { const it = itemById(id); it.adj = { scale: 1, dx: 0, dy: 0 }; await put('items', it); return renderTryon(); }
    case 'skin': S.skin = v; store.set('skin', v); return renderTryon();
    case 'hair': S.hair = v; store.set('hair', v); return renderTryon();
    case 'clear': S.outfit = {}; return renderTryon();
    case 'styleme': {
      const o = $('#styleocc').value;
      if (!S.items.length) return toast('Add some pieces first');
      const r = styleMe(S.items, o, wearCounts());
      if (!Object.keys(r).length) return toast(`Nothing tagged for ${o} yet`);
      S.outfit = Object.fromEntries(Object.entries(r).map(([s, i]) => [s, i.id]));
      return renderTryon();
    }
    case 'savelook': {
      if (!Object.keys(S.outfit).length) return toast('Dress the mannequin first');
      const occ = $('#lookocc').value;
      const o = { id: uid(), name: $('#lookname').value.trim() || `Look ${S.outfits.length + 1}`, occasion: occ, outfit: { ...S.outfit } };
      await put('outfits', o); S.outfits.push(o); toast('Look saved ✓'); return renderTryon();
    }
    case 'loadlook': S.outfit = { ...S.outfits.find((o) => o.id === id).outfit }; return renderTryon();
    case 'dellook': await del('outfits', id); S.outfits = S.outfits.filter((o) => o.id !== id); return renderTryon();
    case 'wearToday': S.date = iso(new Date()); S.month = new Date(); await logWear(S.date, $('#lookocc').value); return;
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
    case 'tryinspo': S.outfit = { ...S.inspo.picks }; return go('tryon');
  }
});

document.addEventListener('paste', (e) => {
  if (S.view !== 'inspo') return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) setInspoFile(f);
});
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

(async () => {
  await load();
  render();
  window.__closet = S; // handy for debugging
})();
