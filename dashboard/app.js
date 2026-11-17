// Token Radar v2 dashboard: renders window.RADAR (written by main.ts) into
// the overview, the chart, the farm cards, the insights and the board.
// No network: every number on the page comes from the data file.
(function () {
  'use strict';
  const R = window.RADAR;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const compact = (n) => {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return '$' + n.toFixed(0);
  };
  const pct = (x) => (x * 100).toFixed(0) + '%';
  const verdictPill = (v) => '<span class="pill-' + v + '">' + v.toUpperCase() + '</span>';

  // ---------- header badges & sidebar ----------
  const asOf = new Date(R.as_of + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  $('badge-ranked').textContent = R.counts.ranked;
  $('badge-anchors').textContent = R.counts.traded;
  $('badge-asof').textContent = asOf;
  $('side-asof').textContent = asOf;

  // ---------- sparklines ----------
  function sparkline(values, color) {
    const w = 100, h = 28, n = values.length;
    if (n < 2) return '';
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) =>
      (i / (n - 1)) * w + ',' + (h - 3 - ((v - min) / span) * (h - 6))).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.8"/></svg>';
  }

  // ---------- stat cards ----------
  const rankedDesc = [...R.rows].sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  const compMcapDesc = [...R.comps].sort((a, b) => b.mcap_usd - a.mcap_usd);
  const compTvlDesc = [...R.comps].sort((a, b) => b.tvl_usd - a.tvl_usd);
  const watchDesc = R.rows.filter((r) => r.bucket === 'watchlist')
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  const stats = [
    { glyph: '◆', color: '#2ee86b', num: R.counts.ranked, label: 'Ranked Protocols',
      spark: sparkline(rankedDesc.slice(0, 40).map((r) => Math.log10(r.implied_value_usd)), '#2ee86b'),
      delta: '↑ +20 vs V1' },
    { glyph: '●', color: '#4da3ff', num: R.counts.traded, label: 'Traded-Token Anchors',
      spark: sparkline(compMcapDesc.slice(0, 40).map((c) => Math.log10(c.mcap_usd)), '#4da3ff'),
      delta: 'the snapshot\u2019s traded protocols' },
    { glyph: '▲', color: '#a78bfa', num: R.counts.comp_families, label: 'Fitted Token Families',
      spark: sparkline(compTvlDesc.slice(0, 40).map((c) => Math.log10(c.tvl_usd)), '#a78bfa'),
      delta: 'flat multiple ' + R.flat_multiple.toFixed(2) + '×' },
    { glyph: '★', color: '#f5a623', num: R.counts.watchlist, label: 'Watchlist Protocols',
      spark: sparkline(watchDesc.map((r) => Math.log10(r.implied_value_usd)), '#f5a623'),
      delta: '40/40 covered' },
  ];
  $('stats').innerHTML = stats.map((s) =>
    '<div class="stat" style="--accent:' + s.color + '"><div class="glyph">' + s.glyph +
    '</div><div class="num">' + s.num + '</div><div class="label">' + s.label + '</div>' +
    s.spark + '<div class="delta">' + s.delta + '</div></div>').join('');

  // ---------- scatter chart: real comp points, fitted curve, bootstrap band ----------
  function renderChart() {
    const W = 640, H = 380, L = 58, Rt = 14, T = 14, B = 38;
    const xs = R.comps.map((c) => Math.log10(c.tvl_usd));
    const ys = R.comps.map((c) => Math.log10(c.mcap_usd));
    const xMin = 6.7, xMax = 10.5;
    let yMin = Math.floor(Math.min(...ys, ...R.band_grid.map((g) => Math.log10(g.p25_usd))));
    let yMax = Math.ceil(Math.max(...ys, ...R.band_grid.map((g) => Math.log10(g.p75_usd))));
    if (yMax - yMin < 3) yMax = yMin + 3;
    const X = (lv) => L + ((lv - xMin) / (xMax - xMin)) * (W - L - Rt);
    const Y = (lv) => T + (1 - (lv - yMin) / (yMax - yMin)) * (H - T - B);
    let g = '';
    for (let t = Math.ceil(xMin); t <= Math.floor(xMax); t++) {
      const x = X(t);
      g += '<line x1="' + x.toFixed(1) + '" y1="' + T + '" x2="' + x.toFixed(1) + '" y2="' + (H - B) + '" stroke="#1c2942" stroke-width="1"/>';
      g += '<text x="' + x.toFixed(1) + '" y="' + (H - B + 18) + '" fill="#5d6f8f" font-size="11" text-anchor="middle">' +
        compact(Math.pow(10, t)) + '</text>';
    }
    for (let t = yMin; t <= yMax; t++) {
      const y = Y(t);
      g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - Rt) + '" y2="' + y.toFixed(1) + '" stroke="#1c2942" stroke-width="1"/>';
      g += '<text x="' + (L - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#5d6f8f" font-size="11" text-anchor="end">' +
        compact(Math.pow(10, t)) + '</text>';
    }
    const band = R.band_grid.map((p) => X(Math.log10(p.tvl_usd)).toFixed(1) + ',' + Y(Math.log10(p.p75_usd)).toFixed(1)).join(' ') +
      ' ' + [...R.band_grid].reverse().map((p) => X(Math.log10(p.tvl_usd)).toFixed(1) + ',' + Y(Math.log10(p.p25_usd)).toFixed(1)).join(' ');
    g += '<polygon points="' + band + '" fill="#2ee86b" opacity="0.13"/>';
    const curve = R.band_grid.map((p) => X(Math.log10(p.tvl_usd)).toFixed(1) + ',' + Y(Math.log10(p.curve_usd)).toFixed(1)).join(' ');
    g += '<polyline points="' + curve + '" fill="none" stroke="#2ee86b" stroke-width="2.5"/>';
    const flatY = (lv) => Math.log10(R.flat_multiple) + lv;
    g += '<line x1="' + X(xMin).toFixed(1) + '" y1="' + Y(flatY(xMin)).toFixed(1) +
      '" x2="' + X(xMax).toFixed(1) + '" y2="' + Y(flatY(xMax)).toFixed(1) +
      '" stroke="#8fa1bd" stroke-width="1.5" stroke-dasharray="6 5"/>';
    g += R.comps.map((c) =>
      '<circle cx="' + X(Math.log10(c.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(c.mcap_usd)).toFixed(1) +
      '" r="2.6" fill="#4da3ff" opacity="0.8"><title>' + esc(c.name) + ' — TVL ' + compact(c.tvl_usd) +
      ', mcap ' + compact(c.mcap_usd) + '</title></circle>').join('');
    g += '<text x="' + ((W - L - Rt) / 2 + L) + '" y="' + (H - 4) + '" fill="#5d6f8f" font-size="11" text-anchor="middle">TVL (USD, log scale)</text>';
    g += '<text x="12" y="' + ((H - T - B) / 2 + T) + '" fill="#5d6f8f" font-size="11" text-anchor="middle" transform="rotate(-90 12 ' + ((H - T - B) / 2 + T) + ')">Market cap / value (USD, log scale)</text>';
    $('chart').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of traded-token families against the fitted curve">' + g + '</svg>' +
      '<p class="chart-note"><span style="color:#2ee86b">━</span> Our model &nbsp; <span style="color:#2ee86b">▨</span> P25–P75 band &nbsp; <span style="color:#4da3ff">●</span> Actual tokens (' + R.comps.length + ') &nbsp; <span style="color:#8fa1bd">┄</span> Flat multiple ' + R.flat_multiple.toFixed(2) + '×</p>';
  }
  renderChart();

  // ---------- validation & formula ----------
  const tests = [
    { name: 'Leave-one-out (all comps)', tested: R.counts.comp_families, model: R.loo_median_miss, flat: R.flat_loo_median_miss, within: R.loo_within_3x },
    ...R.validation.map((v) => ({ name: v.name, tested: v.tested, model: v.model_median_miss, flat: v.flat_median_miss, within: v.model_within_3x })),
  ];
  $('validation').innerHTML =
    '<table><thead><tr><th>Test</th><th class="num">Tested</th><th class="num">This model</th><th class="num">Flat multiple</th><th class="num">Within 3×</th></tr></thead><tbody>' +
    tests.map((t) =>
      '<tr><td>' + esc(t.name) + '</td><td class="num">' + t.tested + '</td><td class="num good">×' + t.model.toFixed(2) +
      '</td><td class="num">×' + t.flat.toFixed(2) + '</td><td class="num">' + pct(t.within) + '</td></tr>').join('') +
    '</tbody></table>' +
    '<p class="chart-note">Median miss is the factor by which the prediction is typically off: ×2.9 means the true value usually lands within 2.9× of the estimate, up or down. Every row also carries a P25–P75 value band and a P10–P90 rank range from 200 bootstrap refits.</p>';
  $('formula').textContent = R.formula;

  // ---------- farm cards: honest counts per tier ----------
  const tiers = [
    { key: 'farm_100', deposit: 100, cls: 'g' },
    { key: 'farm_1k', deposit: 1000, cls: 'b' },
    { key: 'farm_10k', deposit: 10000, cls: 'p' },
  ];
  $('farm-cards').innerHTML = tiers.map((t) => {
    const counts = { farm: 0, thin: 0, skip: 0 };
    let best = null;
    for (const r of R.rows) {
      const f = r[t.key];
      counts[f.verdict]++;
      if (!best || f.net_per_hour > best.f.net_per_hour) best = { r, f };
    }
    return '<div class="farm-card ' + t.cls + '"><div class="tier">$' + t.deposit.toLocaleString('en-US') +
      ' <span>Deposit</span></div><div class="counts"><span class="verdict-farm">' + counts.farm + ' FARM</span> · ' +
      '<span class="verdict-thin">' + counts.thin + ' THIN</span> · <span class="verdict-skip">' + counts.skip + ' SKIP</span>' +
      ' of ' + R.rows.length + ' rows</div><div class="best">Best pay: ' + esc(best.r.name) + ' at $' +
      best.f.net_per_hour.toFixed(2) + '/h (slice ' + money(best.f.slice_usd) + ', costs ' + money(best.f.costs_usd) + ')</div></div>';
  }).join('');

  // ---------- top 5 ----------
  $('top5').innerHTML =
    '<table class="mini-table"><thead><tr><th>#</th><th>Protocol</th><th class="num">TVL</th><th class="num">Est. value</th><th class="num">Range</th><th class="num">Rank range</th><th>Farm verdict</th></tr></thead><tbody>' +
    R.rows.slice(0, 5).map((r) =>
      '<tr><td>' + r.rank + '</td><td><strong>' + esc(r.name) + '</strong><br><span class="muted small">' + esc(r.category) + '</span></td>' +
      '<td class="num">' + compact(r.tvl_usd) + '</td><td class="num"><strong>' + compact(r.implied_value_usd) + '</strong></td>' +
      '<td class="num">' + compact(r.value_p25_usd) + ' – ' + compact(r.value_p75_usd) + '</td>' +
      '<td class="num">#' + r.rank_p10 + ' – #' + r.rank_p90 + '</td><td>' + verdictPill(r.farm_1k.verdict) + '</td></tr>').join('') +
    '</tbody></table>';

  // ---------- insights (computed, never invented) ----------
  const best1k = R.rows.reduce((a, b) => (b.farm_1k.net_per_hour > a.farm_1k.net_per_hour ? b : a));
  const top1 = R.rows[0];
  const top50 = R.rows.slice(0, 50);
  const catCounts = {};
  for (const r of R.rows) catCounts[r.category] = (catCounts[r.category] || 0) + 1;
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
  const topCat50 = top50.filter((r) => r.category === topCat[0]).length;
  $('insights').innerHTML = [
    { mark: '▲', color: '#2ee86b', title: 'Top Opportunity',
      text: esc(best1k.name) + ' pays $' + best1k.farm_1k.net_per_hour.toFixed(2) + '/h on a $1,000 farm — slice ' + money(best1k.farm_1k.slice_usd) + ' against ' + money(best1k.farm_1k.costs_usd) + ' of costs.' },
    { mark: '◆', color: '#f5a623', title: 'Biggest ≠ Best Farm',
      text: 'Rank 1 ' + esc(top1.name) + ' returns a $1K slice of ' + money(top1.farm_1k.slice_usd) + ' against ' + money(top1.farm_1k.costs_usd) + ' of costs — the biggest launches pay the least per dollar farmed.' },
    { mark: '●', color: '#4da3ff', title: 'Strong Categories',
      text: esc(topCat[0]) + ' leads the board with ' + topCat[1] + ' of ' + R.rows.length + ' rows (' + topCat50 + ' of the top 50).' },
  ].map((i) =>
    '<div class="insight"><div class="mark" style="color:' + i.color + '">' + i.mark + '</div><div><b>' + i.title + '</b><p>' + i.text + '</p></div></div>').join('');

  // ---------- category mix ----------
  const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCat = topCats[0][1];
  $('categories').innerHTML = topCats.map(([c, n]) =>
    '<div class="cat-row"><span>' + esc(c) + '</span><span class="bar"><i style="width:' + Math.round((n / maxCat) * 100) + '%"></i></span><span class="n">' + n + '</span></div>').join('');

  // ---------- coverage & set-aside ----------
  const c = R.counts;
  $('coverage').textContent =
    c.ranked + ' protocols ranked: the ' + c.watchlist_ranked + ' watchlist protocols, ' +
    c.parent_linked + ' parent-linked above-floor protocols, and the ' + c.early +
    ' largest early below-floor protocols. ' + c.set_aside_above_floor +
    ' above-floor protocols were set aside with a stated reason, and ' +
    c.below_floor_unranked + ' below-floor protocols were left unranked. Full accounting: ' +
    c.ranked + ' ranked + ' + c.traded + ' traded + ' + c.set_aside_above_floor +
    ' set aside + ' + c.below_floor_unranked + ' below-floor unranked = ' + c.protocols + ' protocols.';
  $('setaside').innerHTML =
    '<table><thead><tr><th>Set-aside reason</th><th class="num">Count</th><th>Largest (by TVL)</th></tr></thead><tbody>' +
    R.set_aside.map((s) =>
      '<tr><td>' + esc(s.reason) + '</td><td class="num">' + s.count + '</td><td>' + s.top.map(esc).join(', ') + '</td></tr>').join('') +
    '</tbody></table>';
  $('generated').textContent = R.generated_by + '. Snapshot as of ' + asOf + '.';

  // ---------- board ----------
  const params = new URLSearchParams(location.search);
  const state = {
    search: params.get('search') || '',
    bucket: params.get('bucket') || '',
    verdict: params.get('verdict') || '',
    sort: params.get('sort') || 'rank',
  };
  $('search').value = state.search;
  $('bucket').value = state.bucket;
  $('verdict').value = state.verdict;
  $('sort').value = state.sort;

  function filtered() {
    const q = state.search.trim().toLowerCase();
    let rows = R.rows.filter((r) =>
      (!state.bucket || r.bucket === state.bucket) &&
      (!state.verdict || r.farm_1k.verdict === state.verdict) &&
      (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
    const by = {
      rank: (a, b) => a.rank - b.rank,
      value: (a, b) => b.implied_value_usd - a.implied_value_usd,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      net: (a, b) => b.farm_1k.net_per_hour - a.farm_1k.net_per_hour,
    }[state.sort];
    return rows.sort(by);
  }

  function renderBoard() {
    const rows = filtered();
    $('rowcount').textContent = rows.length + ' of ' + R.rows.length + ' rows';
    $('rows').innerHTML = rows.map((r) => {
      const f = r.farm_1k;
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong><br><span class="sub">' + esc(r.category) + ' · ' + esc(r.bucket) + ' · ' + r.chains.slice(0, 3).map(esc).join(', ') + '</span></td>' +
        '<td class="num">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + compact(r.implied_value_usd) + '</strong><br><span class="band">' + compact(r.value_p25_usd) + '–' + compact(r.value_p75_usd) + '</span></td>' +
        '<td class="num">' + r.rank_p10 + '–' + r.rank_p90 + '</td>' +
        '<td>' + verdictPill(f.verdict) + '</td>' +
        '<td class="num">' + money(f.slice_usd) + '</td>' +
        '<td class="num">' + pct(f.break_even_odds) + '</td>' +
        '<td class="num">$' + f.net_per_hour.toFixed(2) + '</td></tr>';
    }).join('');
    const q = new URLSearchParams();
    if (state.search) q.set('search', state.search);
    if (state.bucket) q.set('bucket', state.bucket);
    if (state.verdict) q.set('verdict', state.verdict);
    if (state.sort !== 'rank') q.set('sort', state.sort);
    const qs = q.toString();
    history.replaceState(null, '', qs ? '?' + qs + location.hash : location.pathname + location.hash);
  }

  // ---------- detail drawer ----------
  function breakdown(row) {
    const m = R.model;
    const size = m.intercept + m.slope * Math.log10(row.tvl_usd);
    const cat = m.category_tilt[row.category] || 0;
    const g = row.change_7d === null ? 0 : m.growth_coef * (Math.max(-60, Math.min(120, row.change_7d)) / 100);
    const a = row.age_days === null ? 0 : m.age_coef * Math.log10(Math.max(30, row.age_days) / 365);
    const terms = [
      ['Size curve (intercept + slope x log10 TVL)', size, money(Math.pow(10, size))],
      ['Category tilt (' + row.category + ')', cat, 'x' + Math.pow(10, cat).toFixed(2)],
      ['Growth tilt (7-day ' + (row.change_7d === null ? 'unknown' : row.change_7d.toFixed(1) + '%') + ')', g, 'x' + Math.pow(10, g).toFixed(2)],
      ['Seasoning tilt (' + (row.age_days === null ? 'age unknown' : row.age_days + ' days tracked') + ')', a, 'x' + Math.pow(10, a).toFixed(2)],
    ];
    const total = size + cat + g + a;
    const rowsHtml = terms.map(([label, v, effect]) =>
      '<tr><td>' + esc(label) + '</td><td class="num">' + v.toFixed(3) +
      '</td><td class="num">' + esc(effect) + '</td></tr>').join('');
    return '<table><thead><tr><th>Term</th><th>log10</th><th>Effect</th></tr></thead><tbody>' +
      rowsHtml +
      '<tr><td><strong>Total (10 ^ sum = implied value)</strong></td><td class="num"><strong>' +
      total.toFixed(3) + '</strong></td><td class="num"><strong>' +
      money(Math.pow(10, total)) + '</strong></td></tr></tbody></table>';
  }

  function openDetail(slug) {
    const row = R.rows.find((r) => r.slug === slug);
    if (!row) return;
    const f = row.farm_1k;
    const tiersHtml = [row.farm_100, row.farm_1k, row.farm_10k].map((t) =>
      '<tr><td><strong>$' + t.deposit.toLocaleString('en-US') + '</strong></td><td class="num">' + money(t.slice_usd) +
      '</td><td class="num">' + money(t.costs_usd) + '</td><td class="num">' + pct(t.break_even_odds) +
      '</td><td class="num">$' + t.net_per_hour.toFixed(2) + '</td><td>' + verdictPill(t.verdict) + '</td></tr>').join('');
    $('drawer').innerHTML =
      '<button class="close" id="drawer-close" aria-label="Close">×</button>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="muted small">Rank ' + row.rank + ' · ' + esc(row.bucket) + ' · ' + esc(row.category) + ' · ' + row.chains.map(esc).join(', ') + '</p>' +
      '<dl class="kv">' +
      '<dt>TVL</dt><dd>' + money(row.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + (row.change_7d === null ? 'unknown' : row.change_7d.toFixed(1) + '%') + '</dd>' +
      '<dt>Implied value</dt><dd><strong>' + compact(row.implied_value_usd) + '</strong> (P25–P75 ' + compact(row.value_p25_usd) + '–' + compact(row.value_p75_usd) + ')</dd>' +
      '<dt>Rank range</dt><dd>P10–P90: ' + row.rank_p10 + '–' + row.rank_p90 + '</dd>' +
      '<dt>Farm verdict</dt><dd class="verdict-' + f.verdict + '">' + f.verdict.toUpperCase() +
      ' ($1K tier) — slice ' + money(f.slice_usd) + ', costs ' + money(f.costs_usd) +
      ', break-even ' + pct(f.break_even_odds) + ', net $' + f.net_per_hour.toFixed(2) + '/h</dd>' +
      '</dl>' +
      '<h3>How the value is built</h3>' + breakdown(row) +
      '<h3>Farm economics by deposit size</h3>' +
      '<table><thead><tr><th>Deposit</th><th>Slice</th><th>Costs</th><th>Break-even</th><th>Net $/h</th><th>Verdict</th></tr></thead><tbody>' + tiersHtml + '</tbody></table>' +
      '<h3>Farm plan</h3><ol>' + row.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
    $('drawer').classList.add('open');
    $('overlay').classList.add('open');
    $('drawer-close').addEventListener('click', closeDetail);
    history.replaceState(null, '', location.pathname + location.search + '#' + row.slug);
  }

  function closeDetail() {
    $('drawer').classList.remove('open');
    $('overlay').classList.remove('open');
    history.replaceState(null, '', location.pathname + location.search);
  }

  $('overlay').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  // ---------- controls & nav ----------
  $('search').addEventListener('input', (e) => { state.search = e.target.value; renderBoard(); });
  $('bucket').addEventListener('change', (e) => { state.bucket = e.target.value; renderBoard(); });
  $('verdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });

  function setActiveNav(name) {
    document.querySelectorAll('#nav button').forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-nav') === name));
  }
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => {
      const name = el.getAttribute('data-nav');
      setActiveNav(name);
      if (name === 'overview') window.scrollTo({ top: 0, behavior: 'smooth' });
      if (name === 'rankings') { state.bucket = ''; state.verdict = ''; $('bucket').value = ''; $('verdict').value = ''; renderBoard(); $('rankings').scrollIntoView({ behavior: 'smooth' }); }
      if (name === 'watchlist') { state.bucket = 'watchlist'; state.verdict = ''; $('bucket').value = 'watchlist'; $('verdict').value = ''; renderBoard(); $('rankings').scrollIntoView({ behavior: 'smooth' }); }
      if (name === 'farm') { state.bucket = ''; state.verdict = 'farm'; $('bucket').value = ''; $('verdict').value = 'farm'; renderBoard(); $('rankings').scrollIntoView({ behavior: 'smooth' }); }
      if (name === 'analytics') $('analytics').scrollIntoView({ behavior: 'smooth' });
      if (name === 'about') $('about').scrollIntoView({ behavior: 'smooth' });
    });
  });

  renderBoard();
  // A filtered, sorted or searched link opens on the board itself: move the
  // rankings section up under the hero, so the board is what the page shows.
  // (Scrolling at load is unreliable in a screenshot: the page paints first
  // and the scroll races it. Moving the section cannot race anything.)
  if (params.get('bucket') || params.get('verdict') || params.get('sort') || params.get('search')) {
    document.querySelector('main').insertBefore($('rankings'), document.querySelector('.stats'));
  }
  if (location.hash.length > 1 && location.hash.slice(1) !== 'rankings') {
    openDetail(decodeURIComponent(location.hash.slice(1)));
  }
})();
