/* =========================================================
   DompetKu — app.js
   Logika aplikasi: koneksi ke Apps Script, dashboard, grafik,
   riwayat, form tambah/edit/hapus.
   ========================================================= */
'use strict';

/* ---------- Helper dasar ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const LS = { cfg: 'dk_cfg', cache: 'dk_cache', sync: 'dk_sync' };
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* penyimpanan penuh/terblokir */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
};

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000) + 1;
const minIso = (a, b) => (a < b ? a : b);

const NF = new Intl.NumberFormat('id-ID');
const rp = n => (n < 0 ? '−' : '') + 'Rp ' + NF.format(Math.abs(Math.round(n)));
const rpShort = n => {
  const a = Math.abs(n);
  const f = (v, s) => (Math.round(v * 10) / 10).toString().replace('.', ',') + s;
  if (a >= 1e9) return f(n / 1e9, ' M');
  if (a >= 1e6) return f(n / 1e6, ' jt');
  if (a >= 1e3) return Math.round(n / 1e3) + ' rb';
  return NF.format(n);
};
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const fmtDate = s => { const d = parseIso(s); return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDayLong = s => {
  const t = today();
  if (s === t) return 'Hari ini';
  if (s === addDays(t, -1)) return 'Kemarin';
  const d = parseIso(s);
  return `${HARI[d.getDay()]}, ${fmtDate(s)}`;
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = [
  [/sppd|perjalanan dinas|dinas luar/i, '🧳'], [/\btpp\b|tambahan penghasilan|uang makan/i, '🏅'],
  [/gaji|fungsional/i, '💼'],
  [/makan|minum|kuliner|jajan|kopi|resto/i, '🍜'], [/transport|bensin|bbm|ojek|parkir|tol|kendaraan/i, '🚗'],
  [/belanja|groceries|dapur|sembako/i, '🛒'], [/tagihan|listrik|\bair\b|utilitas|pln|pdam/i, '💡'],
  [/pulsa|internet|wifi|kuota/i, '📶'], [/sehat|obat|dokter|medis|bpjs/i, '💊'],
  [/didik|sekolah|kursus|buku|kuliah/i, '📚'], [/hibur|film|game|liburan|wisata|langganan/i, '🎬'],
  [/keluarga|anak|orang ?tua|ibu|ayah/i, '👨‍👩‍👧'], [/sedekah|donasi|zakat|infa[qk]|amal/i, '🤲'],
  [/tabung|invest|reksa|saham|emas/i, '📈'], [/gaji|upah|honor/i, '💼'], [/tunjangan|tukin/i, '🧾'],
  [/bonus|thr/i, '🎁'], [/usaha|jual|bisnis|sampingan|freelance/i, '🏪'], [/hadiah|kado/i, '🎉'],
  [/cicil|kredit|hutang|utang|pinjam/i, '💳'], [/rumah|sewa|kos|kontrak/i, '🏠'],
  [/pakaian|baju|fashion|sepatu/i, '👕'], [/haji|umroh|ibadah/i, '🕋'], [/lain/i, '🔖']
];
const iconOf = c => (ICONS.find(([r]) => r.test(c)) || [0, '🏷️'])[1];

/* ---------- State ---------- */
const state = {
  cfg: store.get(LS.cfg, null),
  data: store.get(LS.cache, null),
  lastSync: store.get(LS.sync, 0),
  syncing: false,
  view: 'beranda',
  period: { preset: 'bulan', from: '', to: '' },
  hist: { q: '', type: 'semua', cat: '', from: '', to: '', limit: 60 },
  form: { mode: 'add', type: 'pengeluaran', cat: '', date: today(), id: null, oldType: null }
};

const allTx = () => state.data ? state.data.pemasukan.concat(state.data.pengeluaran) : [];
const byNewest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0));
const inRange = (t, r) => t.date >= r.from && t.date <= r.to;
const sumOf = list => list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
const persist = () => { store.set(LS.cache, state.data); };

/* =========================================================
   API ke Google Apps Script
   ========================================================= */
async function api(action, payload = {}, cfg = state.cfg) {
  if (!cfg) throw new Error('Aplikasi belum terhubung.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // menghindari preflight CORS
      body: JSON.stringify(Object.assign({ key: cfg.key, action }, payload)),
      redirect: 'follow',
      signal: ctrl.signal
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Server terlalu lama merespons. Coba lagi.' : 'Tidak ada koneksi internet atau URL tidak bisa dihubungi.');
  } finally { clearTimeout(timer); }
  let json;
  try { json = await res.json(); }
  catch (e) { throw new Error('Respons tidak dikenali. Pastikan URL berakhiran /exec dan akses Web App = "Siapa saja".'); }
  if (!json.ok) throw new Error(json.error || 'Terjadi kesalahan.');
  return json.data;
}

async function sync({ silent = false } = {}) {
  if (state.syncing) return;
  state.syncing = true;
  $('#refresh-btn').classList.add('spinning');
  if (!state.data) renderSkeleton();
  try {
    const data = await api('getAll');
    state.data = data;
    state.lastSync = Date.now();
    persist(); store.set(LS.sync, state.lastSync);
    renderAll();
    if (!silent) toast('Data diperbarui', 'ok');
  } catch (e) {
    if (!state.data) { state.data = { pemasukan: [], pengeluaran: [], kategori: { pemasukan: [], pengeluaran: [] } }; renderAll(); }
    toast(e.message, 'err', { label: 'Coba lagi', fn: () => sync() });
  } finally {
    state.syncing = false;
    $('#refresh-btn').classList.remove('spinning');
    renderSettings();
  }
}

/* =========================================================
   Periode
   ========================================================= */
const PRESETS = [['hari', 'Hari ini'], ['minggu', 'Minggu ini'], ['bulan', 'Bulan ini'], ['tahun', 'Tahun ini'], ['custom', 'Custom']];

function periodRange(p = state.period) {
  const t = today(); const d = new Date();
  switch (p.preset) {
    case 'hari': return { from: t, to: t };
    case 'minggu': return { from: addDays(t, -((d.getDay() + 6) % 7)), to: t };
    case 'tahun': return { from: `${d.getFullYear()}-01-01`, to: t };
    case 'custom': {
      let f = p.from || t, to = p.to || t;
      if (f > to) [f, to] = [to, f];
      return { from: f, to };
    }
    default: return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, to: t };
  }
}

function prevRange(r, preset) {
  if (preset === 'bulan') {
    const f = parseIso(r.from), td = parseIso(r.to).getDate();
    const pf = new Date(f.getFullYear(), f.getMonth() - 1, 1);
    const last = new Date(f.getFullYear(), f.getMonth(), 0).getDate();
    return { from: iso(pf), to: iso(new Date(pf.getFullYear(), pf.getMonth(), Math.min(td, last))), label: 'bulan lalu' };
  }
  if (preset === 'tahun') {
    const y = parseIso(r.from).getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}${r.to.slice(4)}`, label: 'tahun lalu' };
  }
  const n = daysBetween(r.from, r.to);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1), label: preset === 'hari' ? 'kemarin' : preset === 'minggu' ? 'minggu lalu' : 'periode sebelumnya' };
}

function rangeLabel(r) {
  if (r.from === r.to) return fmtDayLong(r.from) === 'Hari ini' ? `Hari ini · ${fmtDate(r.from)}` : fmtDate(r.from);
  return `${fmtDate(r.from)} – ${fmtDate(r.to)}`;
}

function renderPeriodBars() {
  const p = state.period;
  $$('[data-period-bar]').forEach(bar => {
    bar.innerHTML = `
      <div class="chips">${PRESETS.map(([v, l]) => `<button class="chip ${p.preset === v ? 'active' : ''}" data-preset="${v}">${l}</button>`).join('')}</div>
      ${p.preset === 'custom' ? `
        <div class="custom-range">
          <label class="pill-date"><span>Dari</span><input type="date" data-pf value="${p.from}" max="${today()}"></label>
          <label class="pill-date"><span>Sampai</span><input type="date" data-pt value="${p.to}"></label>
        </div>` : ''}`;
  });
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  const v = b.dataset.preset;
  state.period.preset = v;
  if (v === 'custom' && !state.period.from) {
    state.period.from = addDays(today(), -29); state.period.to = today();
  }
  renderPeriodBars(); renderDashboard(); renderAnalysis();
});
document.addEventListener('change', e => {
  if (e.target.matches('[data-pf]')) state.period.from = e.target.value;
  else if (e.target.matches('[data-pt]')) state.period.to = e.target.value;
  else return;
  renderPeriodBars(); renderDashboard(); renderAnalysis();
});

/* =========================================================
   Render: Beranda
   ========================================================= */
function txHtml(t) {
  const isIn = t.type === 'pemasukan';
  const sub = t.note ? esc(t.note) : fmtDayLong(t.date);
  return `<button class="tx" data-id="${esc(t.id)}" data-type="${t.type}">
    <span class="tx-ico ${isIn ? 'in' : 'out'}" aria-hidden="true">${iconOf(t.category)}</span>
    <span class="tx-main"><span class="tx-cat">${esc(t.category)}</span><span class="tx-note">${sub}</span></span>
    <span class="tx-amt ${isIn ? 'in' : ''}">${isIn ? '+' : '−'}${rp(t.amount)}</span>
  </button>`;
}

function emptyHtml(icon, title, text, withBtn) {
  return `<div class="empty"><div class="empty-art">${icon}</div><h4>${title}</h4><p>${text}</p>
    ${withBtn ? '<button class="btn btn-primary" data-open-form>+ Tambah transaksi</button>' : ''}</div>`;
}

function renderSkeleton() {
  $('#recent-list').innerHTML = Array.from({ length: 4 }, () =>
    `<div class="tx"><span class="tx-ico skel"></span><span class="tx-main"><span class="skel" style="display:block;height:12px;width:55%"></span><span class="skel" style="display:block;height:10px;width:35%;margin-top:8px"></span></span></div>`).join('');
  $('#insights').innerHTML = Array.from({ length: 2 }, () => '<div class="insight skel"></div>').join('');
}

function renderDashboard() {
  if (!state.data) return;
  const r = periodRange();
  const tx = allTx().filter(t => inRange(t, r));
  const inc = sumOf(tx.filter(t => t.type === 'pemasukan'));
  const exp = sumOf(tx.filter(t => t.type === 'pengeluaran'));
  $('#sum-in').textContent = rp(inc);
  $('#sum-out').textContent = rp(exp);
  $('#sum-net').textContent = rp(inc - exp);
  $('#sum-range').textContent = rangeLabel(r);

  renderIncomeBreakdown(tx.filter(t => t.type === 'pemasukan'), inc);

  // ---- Insight
  const expTx = tx.filter(t => t.type === 'pengeluaran');
  const byCat = groupSum(expTx);
  const top = byCat[0];
  const days = Math.max(1, daysBetween(r.from, minIso(r.to, today())));
  const prev = prevRange(r, state.period.preset);
  const prevExp = sumOf(allTx().filter(t => t.type === 'pengeluaran' && inRange(t, prev)));
  let cmp;
  if (!prevExp && !exp) cmp = { v: 'Belum ada data', s: `Tidak ada pengeluaran ${prev.label}` };
  else if (!prevExp) cmp = { v: 'Belum ada pembanding', s: `${prev.label[0].toUpperCase() + prev.label.slice(1)}: Rp 0` };
  else {
    const pct = Math.round(((exp - prevExp) / prevExp) * 100);
    cmp = pct === 0
      ? { v: 'Sama persis', s: `dengan ${prev.label} (${rp(prevExp)})` }
      : { v: `<span class="${pct > 0 ? 'trend-up' : 'trend-down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% ${pct > 0 ? 'lebih boros' : 'lebih hemat'}</span>`, s: `dibanding ${prev.label} (${rp(prevExp)})` };
  }
  const ratio = inc > 0 ? Math.round(((inc - exp) / inc) * 100) : null;

  $('#insights').innerHTML = `
    <div class="insight">
      <span class="insight-ico">${top ? iconOf(top.name) : '🏷️'}</span>
      <p class="insight-label">Pengeluaran terbesar</p>
      <p class="insight-value">${top ? esc(top.name) : '—'}</p>
      <p class="insight-sub num">${top ? `${rp(top.total)} · ${Math.round(top.total / exp * 100)}%` : 'Belum ada pengeluaran'}</p>
    </div>
    <div class="insight">
      <span class="insight-ico">📅</span>
      <p class="insight-label">Rata-rata harian</p>
      <p class="insight-value">${rp(exp / days)}</p>
      <p class="insight-sub">dari ${days} hari</p>
    </div>
    <div class="insight wide">
      <span class="insight-ico">${prevExp && exp > prevExp ? '📈' : '📉'}</span>
      <div><p class="insight-label">Perbandingan pengeluaran</p><p class="insight-value">${cmp.v}</p><p class="insight-sub num">${cmp.s}</p></div>
    </div>
    <div class="insight wide">
      <span class="insight-ico">💰</span>
      <div><p class="insight-label">Porsi pemasukan yang tersisa</p>
      <p class="insight-value">${ratio == null ? '—' : ratio >= 0 ? `${ratio}% tersisa` : `<span class="trend-up">Defisit ${Math.abs(ratio)}%</span>`}</p>
      <p class="insight-sub">${ratio == null ? 'Belum ada pemasukan di periode ini' : ratio >= 20 ? 'Mantap, pertahankan!' : ratio >= 0 ? 'Masih aman, coba sisihkan lebih banyak' : 'Pengeluaran melebihi pemasukan'}</p></div>
    </div>`;

  // ---- Terbaru
  const recent = allTx().sort(byNewest).slice(0, 6);
  $('#recent-list').innerHTML = recent.length
    ? recent.map(txHtml).join('')
    : emptyHtml('🪙', 'Belum ada transaksi', 'Ketuk tombol + di bawah untuk mencatat transaksi pertamamu.', true);
}

/* Rincian pemasukan per sumber (Gaji, TPP, SPPD, ...) */
function renderIncomeBreakdown(incTx, inc) {
  const cats = (state.data.kategori.pemasukan || []).slice();
  const sums = new Map(groupSum(incTx).map(x => [x.name, x.total]));
  const counts = new Map();
  incTx.forEach(t => counts.set(t.category, (counts.get(t.category) || 0) + 1));
  // Kategori di luar daftar (mis. ketik manual di sheet) tetap ditampilkan
  sums.forEach((v, k) => { if (!cats.includes(k)) cats.push(k); });
  const rows = cats
    .filter(c => sums.get(c) || !/^lain/i.test(c))   // "Lainnya" hanya tampil jika ada isinya
    .map(c => ({ name: c, total: sums.get(c) || 0, n: counts.get(c) || 0 }));
  if (!rows.length) { $('#income-card').hidden = true; return; }
  $('#income-card').hidden = false;
  $('#income-list').innerHTML = rows.map(r => `
    <div class="inc-row ${r.total ? '' : 'inc-empty'}">
      <span class="tx-ico in" aria-hidden="true">${iconOf(r.name)}</span>
      <div class="inc-main">
        <p class="inc-name">${esc(r.name)}</p>
        <p class="inc-sub">${r.total ? `${r.n}× · ${Math.round(r.total / inc * 100)}% dari pemasukan` : 'Belum diterima di periode ini'}</p>
        <div class="bar-track"><div class="bar-fill bar-in" style="width:${inc ? Math.max(r.total ? 2 : 0, r.total / inc * 100) : 0}%"></div></div>
      </div>
      <span class="inc-val">${r.total ? rp(r.total) : '—'}</span>
    </div>`).join('');
}

function groupSum(list) {
  const m = new Map();
  list.forEach(t => m.set(t.category, (m.get(t.category) || 0) + t.amount));
  return Array.from(m, ([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

/* =========================================================
   Render: Riwayat
   ========================================================= */
function renderHistoryFilters() {
  const sel = $('#h-cat');
  const cats = Array.from(new Set(allTx().map(t => t.category)
    .concat(state.data ? state.data.kategori.pengeluaran.concat(state.data.kategori.pemasukan) : []))).sort((a, b) => a.localeCompare(b, 'id'));
  sel.innerHTML = '<option value="">Semua kategori</option>' + cats.map(c => `<option ${c === state.hist.cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function renderHistory() {
  if (!state.data) return;
  const h = state.hist;
  const q = h.q.trim().toLowerCase();
  const qNum = q.replace(/[^\d]/g, '');
  let list = allTx().filter(t =>
    (h.type === 'semua' || t.type === h.type) &&
    (!h.cat || t.category === h.cat) &&
    (!h.from || t.date >= h.from) && (!h.to || t.date <= h.to) &&
    (!q || t.category.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || (qNum && String(Math.round(t.amount)).includes(qNum)))
  ).sort(byNewest);

  const total = list.length;
  const inc = sumOf(list.filter(t => t.type === 'pemasukan'));
  const exp = sumOf(list.filter(t => t.type === 'pengeluaran'));
  $('#h-meta').textContent = total ? `${total} transaksi · masuk ${rp(inc)} · keluar ${rp(exp)}` : '';

  if (!total) {
    const filtered = q || h.cat || h.from || h.to || h.type !== 'semua';
    $('#history-list').innerHTML = `<div class="card">${filtered
      ? emptyHtml('🔍', 'Tidak ditemukan', 'Tidak ada transaksi yang cocok. Coba ubah kata kunci atau filter.')
      : emptyHtml('🧾', 'Riwayat masih kosong', 'Transaksi yang kamu catat akan muncul di sini.', true)}</div>`;
    $('#h-more').hidden = true;
    return;
  }

  const shown = list.slice(0, h.limit);
  const groups = [];
  shown.forEach(t => {
    const g = groups[groups.length - 1];
    if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
  });
  $('#history-list').innerHTML = groups.map(g => {
    const net = sumOf(g.items.filter(t => t.type === 'pemasukan')) - sumOf(g.items.filter(t => t.type === 'pengeluaran'));
    return `<div class="day-group"><div class="day-head"><span>${fmtDayLong(g.date)}</span><span class="num">${net >= 0 ? '+' : ''}${rp(net)}</span></div>
      <div class="card list-card">${g.items.map(txHtml).join('')}</div></div>`;
  }).join('');
  $('#h-more').hidden = total <= h.limit;
}

let searchTimer;
$('#h-search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.hist.q = e.target.value; state.hist.limit = 60; renderHistory(); }, 150);
});
$('#h-type').addEventListener('click', e => {
  const b = e.target.closest('.seg'); if (!b) return;
  $$('#h-type .seg').forEach(s => s.classList.toggle('active', s === b));
  state.hist.type = b.dataset.v; state.hist.limit = 60; renderHistory();
});
$('#h-cat').addEventListener('change', e => { state.hist.cat = e.target.value; renderHistory(); });
$('#h-from').addEventListener('change', e => { state.hist.from = e.target.value; renderHistory(); });
$('#h-to').addEventListener('change', e => { state.hist.to = e.target.value; renderHistory(); });
$('#h-more').addEventListener('click', () => { state.hist.limit += 60; renderHistory(); });

/* =========================================================
   Render: Analisis (grafik SVG ringan, tanpa library)
   ========================================================= */
function niceMax(v) {
  if (v <= 0) return 100000;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
function barPath(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function renderAnalysis() {
  if (!state.data) return;
  const r = periodRange();
  const expTx = state.data.pengeluaran.filter(t => inRange(t, r));
  renderCategoryChart(expTx);
  renderIncomeChart(state.data.pemasukan.filter(t => inRange(t, r)));
  renderTrendChart(r);
  renderCompareChart(r);
}

function renderCategoryChart(expTx) {
  const total = sumOf(expTx);
  $('#cat-total').textContent = total ? `Total ${rp(total)}` : '';
  let rows = groupSum(expTx);
  if (!rows.length) {
    $('#chart-cat').innerHTML = emptyHtml('📊', 'Belum ada pengeluaran', 'Belum ada pengeluaran di periode ini.');
    return;
  }
  if (rows.length > 7) {
    const rest = rows.slice(6);
    rows = rows.slice(0, 6).concat([{ name: `Lainnya (${rest.length} kategori)`, total: sumOf(rest.map(x => ({ amount: x.total }))), other: true }]);
  }
  const max = rows[0].total;
  $('#chart-cat').innerHTML = rows.map((x, i) => `
    <div class="bar-row">
      <span class="bar-ico" aria-hidden="true">${x.other ? '➕' : iconOf(x.name)}</span>
      <div>
        <p class="bar-name">${esc(x.name)} <span>${Math.round(x.total / total * 100)}%</span></p>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, x.total / max * 100)}%;animation-delay:${i * 40}ms"></div></div>
      </div>
      <span class="bar-val">${rp(x.total)}</span>
    </div>`).join('');
}

function renderIncomeChart(incTx) {
  const total = sumOf(incTx);
  $('#inc-total').textContent = total ? `Total ${rp(total)}` : '';
  const rows = groupSum(incTx);
  if (!rows.length) {
    $('#chart-inc').innerHTML = emptyHtml('💼', 'Belum ada pemasukan', 'Belum ada pemasukan di periode ini.');
    return;
  }
  const counts = new Map();
  incTx.forEach(t => counts.set(t.category, (counts.get(t.category) || 0) + 1));
  const max = rows[0].total;
  $('#chart-inc').innerHTML = rows.map((x, i) => {
    const n = counts.get(x.name);
    return `<div class="bar-row">
      <span class="bar-ico" aria-hidden="true">${iconOf(x.name)}</span>
      <div>
        <p class="bar-name">${esc(x.name)} <span>${Math.round(x.total / total * 100)}%</span></p>
        <div class="bar-track"><div class="bar-fill bar-in" style="width:${Math.max(2, x.total / max * 100)}%;animation-delay:${i * 40}ms"></div></div>
        <p class="bar-note">${n}× diterima${n > 1 ? ` · rata-rata ${rp(x.total / n)}` : ''}</p>
      </div>
      <span class="bar-val">${rp(x.total)}</span>
    </div>`;
  }).join('');
}

function renderTrendChart(r) {
  let from = r.from;
  const to = r.to;
  let span = daysBetween(from, to);
  if (span < 7) { from = addDays(to, -6); span = 7; }
  const monthly = span > 62;
  const buckets = [];
  if (monthly) {
    const f = parseIso(from), t = parseIso(to);
    for (let d = new Date(f.getFullYear(), f.getMonth(), 1); d <= t; d.setMonth(d.getMonth() + 1)) {
      buckets.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: BULAN[d.getMonth()], full: `${BULAN_PANJANG[d.getMonth()]} ${d.getFullYear()}`, v: 0 });
    }
  } else {
    for (let s = from; s <= to; s = addDays(s, 1)) {
      const d = parseIso(s);
      buckets.push({ key: s, label: String(d.getDate()), full: `${HARI[d.getDay()]}, ${fmtDate(s)}`, v: 0 });
    }
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  state.data.pengeluaran.forEach(t => {
    if (t.date < from || t.date > to) return;
    const i = idx.get(monthly ? t.date.slice(0, 7) : t.date);
    if (i != null) buckets[i].v += t.amount;
  });
  $('#trend-title').textContent = monthly ? 'Tren pengeluaran bulanan' : 'Tren pengeluaran harian';
  $('#trend-sub').textContent = `${fmtDate(from)} – ${fmtDate(to)}`;

  const box = $('#chart-trend');
  if (!buckets.some(b => b.v > 0)) {
    box.innerHTML = emptyHtml('📉', 'Belum ada data', 'Tren muncul setelah ada pengeluaran di rentang ini.');
    return;
  }
  const W = 340, H = 190, L = 44, R = 10, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(...buckets.map(b => b.v)));
  const n = buckets.length;
  const x = i => L + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = v => T + ih - (v / max) * ih;
  const pts = buckets.map((b, i) => [x(i), y(b.v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${T + ih}L${x(0).toFixed(1)},${T + ih}Z`;
  const ticks = [0, .5, 1].map(f => max * f);
  const step = Math.ceil(n / 6);
  const labels = buckets.map((b, i) => (i % step === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < step / 2)
    ? `<text class="axis-text" x="${x(i)}" y="${H - 6}" text-anchor="middle">${b.label}</text>` : '').join('');

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik tren pengeluaran">
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366f1" stop-opacity=".22"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(v => `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${rpShort(v)}</text>`).join('')}
    <path d="${area}" fill="url(#ga)"/>
    <path d="${line}" fill="none" stroke="#6366f1" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${labels}
    <line class="hover-line" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="#94a3b8" stroke-dasharray="3 3" opacity="0"/>
    <circle class="hover-dot" r="5" fill="#6366f1" stroke="#fff" stroke-width="2" opacity="0"/>
    <rect x="${L}" y="0" width="${iw}" height="${H}" fill="transparent" class="hit"/>
  </svg><div class="tooltip"></div>`;

  attachHover(box, W, (px) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : ((px - L) / iw) * (n - 1))));
    const b = buckets[i];
    return { x: x(i), y: y(b.v), html: `${b.full}<br><b>${rp(b.v)}</b>`, line: true };
  });
}

function renderCompareChart(r) {
  const end = parseIso(r.to);
  const months = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(end.getFullYear(), end.getMonth() - k, 1);
    months.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: BULAN[d.getMonth()], full: `${BULAN_PANJANG[d.getMonth()]} ${d.getFullYear()}`, inc: 0, exp: 0 });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  allTx().forEach(t => {
    const i = idx.get(t.date.slice(0, 7));
    if (i == null) return;
    if (t.type === 'pemasukan') months[i].inc += t.amount; else months[i].exp += t.amount;
  });
  const box = $('#chart-compare');
  if (!months.some(m => m.inc || m.exp)) {
    box.innerHTML = emptyHtml('⚖️', 'Belum ada data', 'Grafik perbandingan muncul setelah ada transaksi.');
    return;
  }
  const W = 340, H = 190, L = 44, R = 6, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(...months.map(m => Math.max(m.inc, m.exp))));
  const gw = iw / months.length;
  const bw = Math.min(16, (gw - 14) / 2);
  const y = v => T + ih - (v / max) * ih;
  const ticks = [0, .5, 1].map(f => max * f);
  const bars = months.map((m, i) => {
    const cx = L + gw * i + gw / 2;
    return `<path d="${barPath(cx - bw - 1, y(m.inc), bw, T + ih - y(m.inc), 4)}" fill="var(--in)"/>
      <path d="${barPath(cx + 1, y(m.exp), bw, T + ih - y(m.exp), 4)}" fill="var(--out)"/>
      <text class="axis-text" x="${cx}" y="${H - 6}" text-anchor="middle">${m.label}</text>`;
  }).join('');

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik pemasukan dibanding pengeluaran per bulan">
    ${ticks.map(v => `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${rpShort(v)}</text>`).join('')}
    ${bars}
    <rect x="${L}" y="0" width="${iw}" height="${H}" fill="transparent" class="hit"/>
  </svg><div class="tooltip"></div>`;

  attachHover(box, W, (px) => {
    const i = Math.max(0, Math.min(months.length - 1, Math.floor((px - L) / gw)));
    const m = months[i];
    return {
      x: L + gw * i + gw / 2, y: y(Math.max(m.inc, m.exp)),
      html: `${m.full}<br><i style="background:var(--in)"></i>Masuk <b>${rp(m.inc)}</b><br><i style="background:var(--out)"></i>Keluar <b>${rp(m.exp)}</b><br>Selisih <b>${rp(m.inc - m.exp)}</b>`
    };
  });
}

function attachHover(box, W, pick) {
  const svg = $('svg', box), tip = $('.tooltip', box), hit = $('.hit', box);
  const hl = $('.hover-line', box), hd = $('.hover-dot', box);
  const show = ev => {
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / W;
    const px = (ev.clientX - rect.left) / scale;
    const p = pick(px);
    tip.innerHTML = p.html;
    const left = Math.max(70, Math.min(rect.width - 70, p.x * scale));
    tip.style.left = left + 'px';
    tip.style.top = Math.max(40, p.y * scale) + 'px';
    tip.classList.add('show');
    if (hl) { hl.setAttribute('x1', p.x); hl.setAttribute('x2', p.x); hl.setAttribute('opacity', 1); }
    if (hd) { hd.setAttribute('cx', p.x); hd.setAttribute('cy', p.y); hd.setAttribute('opacity', 1); }
  };
  const hide = () => { tip.classList.remove('show'); if (hl) hl.setAttribute('opacity', 0); if (hd) hd.setAttribute('opacity', 0); };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
  box.addEventListener('touchend', () => setTimeout(hide, 1800), { passive: true });
}

/* =========================================================
   Setelan
   ========================================================= */
function renderSettings() {
  const c = state.cfg;
  $('#set-status').textContent = c ? (navigator.onLine ? '🟢 Terhubung' : '🟠 Offline') : '⚪ Belum terhubung';
  $('#set-url').textContent = c ? c.url.replace(/(macros\/s\/.{6}).*(.{6}\/exec)$/, '$1…$2') : '—';
  $('#set-sync').textContent = state.lastSync ? new Date(state.lastSync).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  $('#set-count').textContent = state.data ? `${NF.format(allTx().length)} transaksi` : '—';
}

$('#set-test').addEventListener('click', async e => {
  const b = e.currentTarget; setLoading(b, true);
  try { await api('ping'); toast('Koneksi aman & berfungsi ✓', 'ok'); }
  catch (err) { toast(err.message, 'err'); }
  finally { setLoading(b, false); }
});
$('#set-change').addEventListener('click', () => showOnboard(true));
$('#set-logout').addEventListener('click', () => {
  confirmDialog({
    title: 'Putuskan koneksi?',
    body: 'Kunci rahasia dan data sementara akan dihapus dari HP ini. Data di Google Sheets tetap aman.',
    yes: 'Putuskan',
    onYes: async () => {
      store.del(LS.cfg); store.del(LS.cache); store.del(LS.sync);
      state.cfg = null; state.data = null; state.lastSync = 0;
      showOnboard(false);
    }
  });
});

/* =========================================================
   Form tambah / edit transaksi
   ========================================================= */
const QUICK = { pengeluaran: [10000, 20000, 50000, 100000, 250000], pemasukan: [100000, 500000, 1000000, 5000000] };
const amountInput = $('#tx-amount');

function sortedCats(type) {
  const base = (state.data && state.data.kategori[type]) || [];
  const freq = new Map();
  const since = addDays(today(), -120);
  (state.data ? state.data[type] : []).forEach(t => { if (t.date >= since) freq.set(t.category, (freq.get(t.category) || 0) + 1); });
  const list = base.slice();
  if (state.form.cat && !list.includes(state.form.cat)) list.push(state.form.cat);
  // Kategori yang sering dipakai tampil duluan; "Lainnya" selalu di akhir
  // Pemasukan mengikuti urutan di sheet Kategori (Gaji, TPP, SPPD); pengeluaran diurutkan dari yang paling sering
  if (type === 'pemasukan') return list;
  return list.map((c, i) => ({ c, i, f: freq.get(c) || 0 }))
    .sort((a, b) => (/^lain/i.test(a.c) - /^lain/i.test(b.c)) || (b.f - a.f) || (a.i - b.i))
    .map(x => x.c);
}

function renderFormType() {
  const f = state.form;
  $('#tx-type').dataset.v = f.type;
  $$('#tx-type .tt').forEach(b => b.classList.toggle('active', b.dataset.v === f.type));
  $('#tx-cats').innerHTML = sortedCats(f.type).map(c =>
    `<button type="button" class="cat ${c === f.cat ? 'active' : ''}" data-cat="${esc(c)}"><span class="e" aria-hidden="true">${iconOf(c)}</span>${esc(c)}</button>`).join('')
    || '<p class="muted small">Belum ada kategori. Tambahkan di sheet "Kategori".</p>';
  $('#quick-amounts').innerHTML = QUICK[f.type].map(v => `<button type="button" class="chip" data-q="${v}">${rpShort(v)}</button>`).join('');
}

function renderFormDate() {
  const f = state.form, t = today();
  $('#tx-date').value = f.date;
  $('#tx-date').max = addDays(t, 365);
  $$('.date-row [data-date]').forEach(b => b.classList.toggle('active', addDays(t, Number(b.dataset.date)) === f.date));
  $('.chip-date').classList.toggle('active', f.date !== t && f.date !== addDays(t, -1));
}

function setAmount(v) { amountInput.value = v ? NF.format(v) : ''; }
function getAmount() { return Number(amountInput.value.replace(/\D/g, '')) || 0; }

function openForm(tx) {
  const f = state.form;
  if (tx) Object.assign(f, { mode: 'edit', type: tx.type, cat: tx.category, date: tx.date, id: tx.id, oldType: tx.type });
  else Object.assign(f, { mode: 'add', cat: '', date: today(), id: null, oldType: null });
  $('#tx-title').textContent = tx ? 'Edit Transaksi' : 'Tambah Transaksi';
  $('#tx-save .btn-label').textContent = tx ? 'Simpan perubahan' : 'Simpan';
  $('#tx-delete').hidden = !tx;
  setAmount(tx ? tx.amount : 0);
  f.autoFilled = false; $('#amount-hint').textContent = '';
  $('#tx-note').value = tx ? tx.note : '';
  clearErrors();
  renderFormType(); renderFormDate();
  $('#tx-overlay').hidden = false;
  const sheet = $('#tx-sheet');
  sheet.classList.remove('closing'); sheet.hidden = false; sheet.scrollTop = 0;
  if (!tx) amountInput.focus({ preventScroll: true }); // langsung siap ketik nominal
  history.pushState({ sheet: true }, '');
}

function closeForm(fromPop) {
  const sheet = $('#tx-sheet');
  if (sheet.hidden) return;
  sheet.classList.add('closing');
  $('#tx-overlay').hidden = true;
  document.activeElement && document.activeElement.blur();
  setTimeout(() => { sheet.hidden = true; sheet.classList.remove('closing'); }, 230);
  if (!fromPop && history.state && history.state.sheet) history.back();
}
window.addEventListener('popstate', () => { if (!$('#confirm').hidden) closeConfirm(); closeForm(true); });

function clearErrors() {
  $('#err-amount').textContent = ''; $('#err-cat').textContent = '';
  $('#amount-field').classList.remove('invalid');
}

amountInput.addEventListener('input', () => {
  state.form.autoFilled = false; $('#amount-hint').textContent = '';
  const digits = amountInput.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
  amountInput.value = digits ? NF.format(Number(digits)) : '';
  if (digits) { $('#err-amount').textContent = ''; $('#amount-field').classList.remove('invalid'); }
});

$('#tx-type').addEventListener('click', e => {
  const b = e.target.closest('.tt'); if (!b || b.dataset.v === state.form.type) return;
  state.form.type = b.dataset.v; state.form.cat = '';
  if (state.form.autoFilled) { setAmount(0); state.form.autoFilled = false; }
  $('#amount-hint').textContent = '';
  renderFormType();
});
function lastAmountOf(type, cat) {
  const list = (state.data ? state.data[type] : []).filter(t => t.category === cat).sort(byNewest);
  return list.length ? list[0].amount : 0;
}

$('#tx-cats').addEventListener('click', e => {
  const b = e.target.closest('.cat'); if (!b) return;
  state.form.cat = b.dataset.cat;
  // Pemasukan rutin (gaji, TPP, SPPD): isi nominal terakhir bila nominal kosong/masih hasil isi otomatis
  const f = state.form;
  if (f.type === 'pemasukan' && f.mode === 'add' && (!getAmount() || f.autoFilled)) {
    const last = lastAmountOf('pemasukan', f.cat);
    if (last) {
      setAmount(last); f.autoFilled = true; clearErrors();
      $('#amount-hint').textContent = 'Diisi dari pencatatan terakhir. Ubah jika jumlahnya berbeda.';
    } else if (f.autoFilled) { setAmount(0); f.autoFilled = false; $('#amount-hint').textContent = ''; }
  }
  $$('#tx-cats .cat').forEach(c => c.classList.toggle('active', c === b));
  $('#err-cat').textContent = '';
});
$('#quick-amounts').addEventListener('click', e => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  setAmount(Number(b.dataset.q)); clearErrors();
});
$$('.date-row [data-date]').forEach(b => b.addEventListener('click', () => { state.form.date = addDays(today(), Number(b.dataset.date)); renderFormDate(); }));
$('#tx-date').addEventListener('change', e => { if (e.target.value) { state.form.date = e.target.value; renderFormDate(); } });

$('#tx-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#tx-save');
  if (btn.classList.contains('loading')) return;
  const f = state.form;
  const amount = getAmount();
  let ok = true;
  clearErrors();
  if (!amount || amount <= 0) {
    $('#err-amount').textContent = 'Nominal wajib diisi dan harus lebih dari 0.';
    $('#amount-field').classList.add('invalid'); ok = false;
  }
  if (!f.cat) { $('#err-cat').textContent = 'Pilih salah satu kategori.'; ok = false; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { toast('Tanggal tidak valid.', 'err'); ok = false; }
  if (!ok) { if (navigator.vibrate) navigator.vibrate(30); return; }

  const tx = { type: f.type, amount, category: f.cat, date: f.date, note: $('#tx-note').value.trim() };
  setLoading(btn, true);
  try {
    if (f.mode === 'add') {
      const res = await api('add', { tx });
      state.data[tx.type].push(Object.assign({ id: res.id, createdAt: res.createdAt }, tx));
    } else {
      await api('update', { tx: Object.assign({ id: f.id, oldType: f.oldType }, tx) });
      const old = state.data[f.oldType].find(t => t.id === f.id);
      const createdAt = old ? old.createdAt : Date.now();
      state.data[f.oldType] = state.data[f.oldType].filter(t => t.id !== f.id);
      state.data[tx.type].push(Object.assign({ id: f.id, createdAt }, tx));
    }
    persist();
    closeForm();
    renderAll();
    toast(`${tx.type === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'} ${rp(amount)} ${f.mode === 'add' ? 'tersimpan' : 'diperbarui'} ✓`, 'ok');
  } catch (err) {
    toast('Gagal menyimpan: ' + err.message, 'err', { label: 'Coba lagi', fn: () => $('#tx-form').requestSubmit() });
  } finally {
    setLoading(btn, false);
  }
});

$('#tx-delete').addEventListener('click', () => {
  const f = state.form;
  const t = state.data[f.oldType].find(x => x.id === f.id);
  if (!t) return;
  confirmDialog({
    title: 'Hapus transaksi?',
    body: `${t.category} · ${rp(t.amount)} · ${fmtDate(t.date)}. Baris ini juga akan dihapus dari Google Sheets dan tidak bisa dibatalkan.`,
    yes: 'Ya, hapus',
    onYes: async () => {
      await api('delete', { id: t.id, type: t.type });
      state.data[t.type] = state.data[t.type].filter(x => x.id !== t.id);
      persist(); closeForm(); renderAll();
      toast('Transaksi dihapus', 'ok');
    }
  });
});

$('#tx-close').addEventListener('click', () => closeForm());
$('#tx-overlay').addEventListener('click', () => closeForm());
$('#fab').addEventListener('click', () => openForm());
document.addEventListener('click', e => {
  if (e.target.closest('[data-open-form]')) { openForm(); return; }
  const row = e.target.closest('.tx[data-id]');
  if (row && state.data) {
    const t = state.data[row.dataset.type].find(x => x.id === row.dataset.id);
    if (t) openForm(t);
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#confirm').hidden) closeConfirm(); else closeForm();
});

/* =========================================================
   Dialog konfirmasi, toast, loading
   ========================================================= */
let confirmHandler = null;
function confirmDialog({ title, body, yes, onYes }) {
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  $('#confirm-yes .btn-label').textContent = yes || 'Ya';
  confirmHandler = onYes;
  $('#confirm-overlay').hidden = false; $('#confirm').hidden = false;
  $('#confirm-no').focus();
}
function closeConfirm() { $('#confirm-overlay').hidden = true; $('#confirm').hidden = true; confirmHandler = null; }
$('#confirm-no').addEventListener('click', closeConfirm);
$('#confirm-overlay').addEventListener('click', closeConfirm);
$('#confirm-yes').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!confirmHandler || b.classList.contains('loading')) return;
  setLoading(b, true);
  try { await confirmHandler(); closeConfirm(); }
  catch (err) { toast('Gagal: ' + err.message, 'err'); }
  finally { setLoading(b, false); }
});

function setLoading(btn, on) { btn.classList.toggle('loading', on); btn.disabled = on; }

function toast(msg, type = 'info', action) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-ico">${type === 'ok' ? '✓' : type === 'err' ? '!' : 'i'}</span><span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) $('button', el).addEventListener('click', () => { dismiss(); action.fn(); });
  const wrap = $('#toasts');
  while (wrap.children.length > 2) wrap.firstChild.remove();
  wrap.appendChild(el);
  let gone = false;
  function dismiss() { if (gone) return; gone = true; el.classList.add('hide'); setTimeout(() => el.remove(), 260); }
  setTimeout(dismiss, type === 'err' ? 6000 : 2600);
  el.addEventListener('click', e => { if (e.target.tagName !== 'BUTTON') dismiss(); });
}

/* =========================================================
   Navigasi & layar
   ========================================================= */
function go(view) {
  state.view = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#appbar-title').textContent = $('#view-' + view).dataset.title;
  window.scrollTo({ top: 0 });
  if (view === 'riwayat') { renderHistoryFilters(); renderHistory(); }
  if (view === 'analisis') renderAnalysis();
  if (view === 'setelan') renderSettings();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto); });
$('#refresh-btn').addEventListener('click', () => sync());

function greet() {
  const h = new Date().getHours();
  return h < 11 ? 'Selamat pagi ☀️' : h < 15 ? 'Selamat siang 🌤️' : h < 18 ? 'Selamat sore 🌇' : 'Selamat malam 🌙';
}

function renderAll() {
  $('#appbar-sub').textContent = greet();
  renderPeriodBars();
  renderDashboard();
  if (state.view === 'riwayat') { renderHistoryFilters(); renderHistory(); }
  if (state.view === 'analisis') renderAnalysis();
  renderSettings();
}

function showOnboard(prefill) {
  $('#app').hidden = true;
  $('#onboard').hidden = false;
  $('#cfg-url').value = prefill && state.cfg ? state.cfg.url : '';
  $('#cfg-key').value = prefill && state.cfg ? state.cfg.key : '';
  $('#onboard-error').textContent = '';
}
function showApp() {
  $('#onboard').hidden = true;
  $('#app').hidden = false;
  renderAll();
}

$('#onboard-form').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('#cfg-url').value.trim();
  const key = $('#cfg-key').value.trim();
  const err = $('#onboard-error');
  err.textContent = '';
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    err.textContent = 'URL harus diawali https://script.google.com/ dan diakhiri /exec.'; return;
  }
  if (key.length < 10) { err.textContent = 'Kunci rahasia belum diisi dengan benar.'; return; }
  const btn = $('#onboard-btn'); setLoading(btn, true);
  try {
    await api('ping', {}, { url, key });
    const changed = !state.cfg || state.cfg.url !== url;
    state.cfg = { url, key }; store.set(LS.cfg, state.cfg);
    if (changed) { state.data = null; store.del(LS.cache); }
    showApp();
    toast('Berhasil terhubung ke Google Sheets 🎉', 'ok');
    sync({ silent: true });
  } catch (e2) {
    err.textContent = e2.message;
  } finally { setLoading(btn, false); }
});

/* ---------- Start ---------- */
function start() {
  if (!state.cfg) { showOnboard(false); return; }
  showApp();
  if (!state.data) renderSkeleton();
  sync({ silent: true });
  // Pintasan "Tambah transaksi" dari ikon aplikasi (tekan lama ikon di Android)
  if (new URLSearchParams(location.search).has('tambah')) {
    history.replaceState(null, '', location.pathname);
    openForm();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.cfg && Date.now() - state.lastSync > 120000) sync({ silent: true });
});
window.addEventListener('online', renderSettings);
window.addEventListener('offline', renderSettings);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
start();
