// Token Radar v2 dashboard: renders window.RADAR (written by main.ts) with no
// network. The board is sortable and filterable; every row opens a detail view
// that recomputes the implied value from the fitted coefficients, so the
// arithmetic on the page is the same arithmetic the program ran.
(function () {
  const R = window.RADAR;
  if (!R) return;
  const rows = R.rows;
  const model = R.model;

  const $ = (id) => document.getElementById(id);
  const money = (n) => {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  };
  const money2 = (n) => '$' + n.toLocaleString('en-US');
  const pct = (n) => (n * 100).toFixed(0) + '%';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- header, model panel, method -------------------------------------
  $('meta').textContent =
    'Snapshot as of ' + R.as_of + ' · ' + R.counts.ranked + ' protocols ranked · ' +
    R.counts.watchlist_ranked + '/' + R.counts.watchlist + ' watchlist covered · ' +
    R.counts.comp_families + ' traded-token families fit the curve';
  $('formula').textContent = R.formula;
  const valBody = document.querySelector('#validation tbody');
  const looRow = ['Leave-one-out (all comps)', R.counts.comp_families,
    'x' + R.loo_median_miss.toFixed(2), 'x' + R.flat_loo_median_miss.toFixed(2),
    pct(R.loo_within_3x)];
  const allTests = [looRow].concat(R.validation.map((t) => [
    t.name, t.tested, 'x' + t.model_median_miss.toFixed(2),
    'x' + t.flat_median_miss.toFixed(2), pct(t.model_within_3x),
  ]));
  valBody.innerHTML = allTests.map((r) =>
    '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('');
  $('accounting').textContent =
    'Full snapshot accounting: ' + R.counts.protocols + ' protocols — ' +
    R.counts.ranked + ' ranked (' + R.counts.watchlist_ranked + ' watchlist, ' +
    R.counts.parent_linked + ' parent-linked above the floor, ' + R.counts.early + ' early), ' +
    R.counts.traded + ' already trade (they fit the curve, never ranked), ' +
    R.counts.set_aside_above_floor + ' set aside above the floor (' +
    R.set_aside.map((s) => s.reason + ' ' + s.count).join(', ') + '), and ' +
    R.counts.below_floor_unranked + ' below-floor protocols not ranked.';
  $('farm-notes').textContent = R.farm_assumptions.join(' ');
  $('generated').textContent = R.generated_by + '. Snapshot as of ' + R.as_of + '.';

  // ---- board ------------------------------------------------------------
  // Shareable views: ?bucket=&verdict=&sort= preset the controls, and
  // #<slug> opens a protocol's detail view on load.
  const params = new URLSearchParams(window.location.search);
  const state = {
    search: params.get('search') || '',
    bucket: params.get('bucket') || '',
    verdict: params.get('verdict') || '',
    sort: params.get('sort') || 'rank',
  };
  if (state.search) $('search').value = state.search;
  if (state.bucket) $('bucket').value = state.bucket;
  if (state.verdict) $('verdict').value = state.verdict;
  if (state.sort) $('sort').value = state.sort;
  const boardBody = document.querySelector('#board tbody');
  const countEl = $('count');

  function filtered() {
    const q = state.search.trim().toLowerCase();
    let list = rows.filter((r) =>
      (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q) ||
        r.category.toLowerCase().includes(q)) &&
      (!state.bucket || r.bucket === state.bucket) &&
      (!state.verdict || r.farm_1k.verdict === state.verdict));
    const by = {
      rank: (a, b) => a.rank - b.rank,
      value: (a, b) => b.implied_value_usd - a.implied_value_usd,
      tvl: (a, b) => b.tvl_usd - a.tvl_usd,
      net: (a, b) => b.farm_1k.net_per_hour - a.farm_1k.net_per_hour,
      slice: (a, b) => b.farm_1k.slice_usd - a.farm_1k.slice_usd,
    }[state.sort];
    return list.sort(by);
  }

  function renderBoard() {
    const list = filtered();
    countEl.textContent = list.length + ' of ' + rows.length + ' rows';
    boardBody.innerHTML = list.map((r) => {
      const f = r.farm_1k;
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong><br><span class="bucket">' +
        esc(r.category) + ' · ' + esc(r.bucket) + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong><br><span class="band">' +
        money(r.value_p25_usd) + '–' + money(r.value_p75_usd) + '</span></td>' +
        '<td class="num">' + r.rank_p10 + '–' + r.rank_p90 + '</td>' +
        '<td class="verdict-' + f.verdict + '">' + f.verdict.toUpperCase() + '</td>' +
        '<td class="num">' + money(f.slice_usd) + '</td>' +
        '<td class="num">' + pct(f.break_even_odds) + '</td>' +
        '<td class="num">$' + f.net_per_hour.toFixed(2) + '</td>' +
        '</tr>';
    }).join('');
  }

  boardBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  $('search').addEventListener('input', (e) => { state.search = e.target.value; renderBoard(); });
  $('bucket').addEventListener('change', (e) => { state.bucket = e.target.value; renderBoard(); });
  $('verdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });

  // ---- detail view ------------------------------------------------------
  function breakdown(row) {
    const size = model.intercept + model.slope * Math.log10(row.tvl_usd);
    const cat = model.category_tilt[row.category] || 0;
    const g = row.change_7d === null ? 0
      : model.growth_coef * (Math.max(-60, Math.min(120, row.change_7d)) / 100);
    const a = row.age_days === null ? 0
      : model.age_coef * (Math.log10(Math.max(row.age_days, 30)) - Math.log10(365));
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

  function tierRow(t) {
    return '<tr><td>' + money2(t.deposit) + '</td><td class="num">' + money(t.slice_usd) +
      '</td><td class="num">' + money(t.costs_usd) + '</td><td class="num">' + pct(t.break_even_odds) +
      '</td><td class="num">$' + t.net_per_hour.toFixed(2) + '</td>' +
      '<td class="verdict-' + t.verdict + '">' + t.verdict.toUpperCase() + '</td></tr>';
  }

  function showDetail(slug) {
    const row = rows.find((r) => r.slug === slug);
    if (!row) return;
    const f = row.farm_1k;
    $('detail-body').innerHTML =
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="bucket">Rank ' + row.rank + ' · ' + esc(row.bucket) + ' · ' + esc(row.category) +
      ' · ' + esc(row.chains.join(', ')) + '</p>' +
      '<dl class="kv">' +
      '<dt>TVL</dt><dd>' + money2(row.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + (row.change_7d === null ? 'unknown' : row.change_7d.toFixed(1) + '%') + '</dd>' +
      '<dt>Implied value</dt><dd><strong>' + money(row.implied_value_usd) + '</strong> ' +
      '(P25–P75 ' + money(row.value_p25_usd) + '–' + money(row.value_p75_usd) + ')</dd>' +
      '<dt>Rank range</dt><dd>P10–P90: ' + row.rank_p10 + '–' + row.rank_p90 + '</dd>' +
      '<dt>Farm verdict</dt><dd class="verdict-' + f.verdict + '">' + f.verdict.toUpperCase() +
      ' ($1K tier) — slice ' + money(f.slice_usd) + ', costs ' + money(f.costs_usd) +
      ', break-even ' + pct(f.break_even_odds) + ', net $' + f.net_per_hour.toFixed(2) + '/h</dd>' +
      '</dl>' +
      '<h3>How the value is built</h3>' + breakdown(row) +
      '<h3>Farm economics by deposit size</h3>' +
      '<table class="tiers"><thead><tr><th>Deposit</th><th>Slice</th><th>Costs</th><th>Break-even</th><th>Net $/h</th><th>Verdict</th></tr></thead><tbody>' +
      tierRow(row.farm_100) + tierRow(row.farm_1k) + tierRow(row.farm_10k) +
      '</tbody></table>' +
      '<h3>Farm plan</h3><ol>' +
      row.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') +
      '</ol>' +
      '<p class="note">Values are estimates from a fitted curve, not a prediction that a token launches or when. The snapshot is DefiLlama&rsquo;s record as of ' + R.as_of + '.</p>';
    $('detail').hidden = false;
  }

  $('close').addEventListener('click', () => { $('detail').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('detail').hidden = true;
  });

  renderBoard();
  const hashSlug = window.location.hash.replace(/^#/, '');
  if (hashSlug && rows.some((r) => r.slug === hashSlug)) showDetail(hashSlug);
})();
