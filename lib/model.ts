// Token Radar v2: the fitted-curve radar.
//
// A pre-token protocol's implied value is what its token would be worth if the
// market priced it the way it prices the protocols whose tokens already trade
// — fitted, not assumed. The program fits a log-log size curve on the
// snapshot's own traded tokens, with small category, growth and seasoning
// tilts, and validates the fit out of sample before it trusts it:
//
//   log10(value) = a + b x log10(TVL) + category tilt
//                + growth tilt x clamped(change_7d) / 100
//                + age tilt x log10(age_days / 365)
//
// The curve is fitted by ridge regression (lambda 10) on traded-token
// families: protocols that share a base name (Aave V2/V3/V4) count once, with
// their TVLs summed, so one token never counts twice. CEX and bridge tokens
// are left out of the fit — an exchange token is priced on revenue, not TVL,
// and a bridge's TVL is pass-through — and so are degenerate comps whose
// market cap is more than 10x their TVL (a token lingering after its TVL left).
//
// Validation is printed on the board, not asserted: leave-one-family-out,
// a time split (fit pre-2024, test newer), and a walk-forward test, each
// against the flat multiple the curve replaces. Uncertainty comes from 200
// bootstrap refits with a fixed seed: every row carries a P25-P75 value band
// and a P10-P90 rank range.
//
// Coverage: the board ranks the 40 watchlist protocols, the above-floor
// pre-token protocols that pass the snapshot's own legitimacy signals, and the
// largest below-floor pre-token protocols by TVL. A protocol is set aside,
// with its reason stated, when its category is a bridge, exchange or staking
// product, its name ends in a version marker or carries wrapped/staked, it
// begins with an exchange's name, or it belongs to a multi-product family
// (two or more protocols sharing the same brand — the launch, if any, belongs
// to the family, not the deployment). No protocol name is ever special-cased:
// the same rules score every row, and the fit is recomputed from the snapshot
// on every run.
//
// Farm economics are netted to the dollar on a $1,000 deposit over 26 weeks:
// the slice is a 5% community airdrop pool shared pro-rata by deposit, with a
// fifth of TVL assumed to farm actively; costs are gas plus the T-bill return
// the deposit gives up; the verdict follows from the net dollars per hour and
// the break-even odds. The detail view shows the same plan sized to $100 and
// $10,000 deposits. Everything is deterministic: one seeded generator drives
// the bootstrap, and the program writes identical bytes on every run.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One protocol family: protocols sharing a base name, aggregated for the fit. */
export interface Family {
  name: string;
  slug: string;
  tvl: number;
  mcap: number | null;
  change_7d: number | null;
  listed_at: string | null;
  category: string | null;
  chains: string[];
}

/** The fitted model: coefficients the dashboard prints. */
export interface FittedModel {
  intercept: number;
  slope: number;
  growth_coef: number;
  age_coef: number;
  categories: string[];
  category_tilt: Record<string, number>;
  comp_count: number;
  lambda: number;
}

/** One validation test: the model's median miss against the flat multiple's. */
export interface ValidationTest {
  name: string;
  tested: number;
  model_median_miss: number;
  model_within_3x: number;
  flat_median_miss: number;
}

/** The farm plan for one deposit size. */
export interface FarmTier {
  deposit: number;
  slice_usd: number;
  costs_usd: number;
  break_even_odds: number;
  net_per_hour: number;
  verdict: string;
}

/** One board row: everything the dashboard and the dossier carry. */
export interface RadarRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  bucket: string;
  rank: number;
  implied_value_usd: number;
  value_p25_usd: number;
  value_p75_usd: number;
  rank_p10: number;
  rank_p90: number;
  farm_steps: string[];
  farm_1k: FarmTier;
  farm_100: FarmTier;
  farm_10k: FarmTier;
}

/** The gate's board row: the fields the scorer requires, plus the rich ones. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  tvl_usd: number;
  bucket: string;
  value_p25_usd: number;
  value_p75_usd: number;
  rank_p10: number;
  rank_p90: number;
  farm_verdict: string;
  farm_slice_usd: number;
  farm_costs_usd: number;
  farm_break_even_odds: number;
  farm_net_per_hour: number;
}

/** Everything the dashboard renders, in one object. */
export interface Radar {
  as_of: string;
  floor_usd: number;
  model: FittedModel;
  validation: ValidationTest[];
  loo_median_miss: number;
  loo_within_3x: number;
  flat_loo_median_miss: number;
  rows: RadarRow[];
  counts: Record<string, number>;
  set_aside: { reason: string; count: number; top: string[] }[];
  farm_assumptions: string[];
  formula: string;
  generated_by: string;
}

/** The model's design choices. Fitted numbers are never stored here: the fit
 *  runs on the snapshot at every run, and only these structural choices are fixed. */
export const MODEL = {
  ridge_lambda: 10,
  category_min_comps: 5,
  ratio_trim_high: 10,
  growth_floor: -60,
  growth_cap: 120,
  age_reference_days: 365,
  age_min_days: 30,
  bootstrap_refits: 200,
  bootstrap_seed: 20261114,
  target_rows: 198,
} as const;

/** Categories whose token value does not relate to TVL the way a pre-token
 *  protocol's would: exchanges, bridges, and staking/wrapped-BTC products.
 *  Stablecoin Wrapper is deliberately NOT here — the house's own watchlist
 *  includes Saturn, a Stablecoin Wrapper. */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'CEX',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Decentralized BTC',
  'Anchor BTC',
]);

/** Categories left out of the fit's comp set (a narrower set than the
 *  coverage exclusions: staking tokens still inform the curve through their
 *  category tilt, but exchange and bridge tokens do not). */
export const FIT_EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'CEX',
]);

export const EXCHANGES = new Set([
  'binance',
  'coinbase',
  'bybit',
  'kraken',
  'bitget',
  'okx',
  'bitfinex',
  'gemini',
]);

export const WRAPPED_WORDS = new Set(['wrapped', 'staked', 'staking']);

/** Farm economics: the stated assumptions, printed on the board. */
export const FARM = {
  pool_pct: 0.05,
  participation: 0.2,
  weeks: 26,
  hours: 3,
  tbill_apy: 0.04,
  gas_cheap_usd: 5,
  gas_eth_usd: 25,
  farm_net_per_hour: 5,
  farm_break_even: 0.5,
} as const;

/** Chains where a deposit, a claim and a weekly check cost about $5 in gas
 *  across the whole farm; anything else is priced as Ethereum mainnet. */
export const CHEAP_CHAINS = new Set([
  'Arbitrum',
  'Base',
  'Optimism',
  'Polygon',
  'BSC',
  'Solana',
  'Avalanche',
  'Blast',
  'Scroll',
  'Linea',
  'zkSync Era',
  'Mantle',
  'Mode',
  'Berachain',
  'Sonic',
  'Hyperliquid',
  'Unichain',
  'Abstract',
  'Sei',
  'Sui',
  'Aptos',
]);

const VERSION_RE = /\s+(v|V)\d+(\.\d+)?$/;
const DECIMAL_RE = /\s+\d+\.\d+$/;
const WORD_RE = /[a-z0-9]+/g;

/** The base name: the version marker stripped, for family grouping. */
export function baseName(name: string): string {
  return name.replace(VERSION_RE, '').replace(DECIMAL_RE, '').trim().toLowerCase();
}

/** Whether the name ends in a version marker (V2, v3, 2.0). */
export function hasVersionMarker(name: string): boolean {
  return VERSION_RE.test(name) || DECIMAL_RE.test(name);
}

/** The brand: the first distinctive name token, camelCase-aware, so
 *  "SparkLend" and "Spark Savings" share the brand "spark" while "Sentora
 *  Curator" stands alone as "sentora". */
export function brand(name: string): string {
  const first = name.split(/\s+/)[0] ?? name;
  const spaced = first
    .replace(/(?<=[a-z])(?=[A-Z])/g, ' ')
    .replace(/[.\-_]/g, ' ');
  const tokens = spaced.toLowerCase().match(WORD_RE);
  return tokens && tokens.length > 0 ? tokens[0]! : first.toLowerCase();
}

/** The snapshot, parsed and checked. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('token radar: the snapshot carries no protocols or watchlist');
  }
  return doc;
}

/** Days from listed_at to the snapshot's as_of date, or null when unknown. */
export function ageDays(listed_at: string | null, as_of: string): number | null {
  if (!listed_at) return null;
  const start = Date.parse(listed_at.slice(0, 10));
  const end = Date.parse(as_of.slice(0, 10));
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/** Group the snapshot's protocols into families by base name, aggregating
 *  each family's TVL, its token's market cap (one member carries it), its
 *  TVL-weighted 7-day change, and its earliest listing date. */
export function buildFamilies(protocols: SnapshotProtocol[]): Family[] {
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of protocols) {
    const key = baseName(p.name);
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  const families: Family[] = [];
  for (const members of groups.values()) {
    let tvl = 0;
    let mcap: number | null = null;
    let weightedChange = 0;
    let changeWeight = 0;
    let earliest: string | null = null;
    let category: string | null = null;
    let largestTvl = -1;
    const chains = new Set<string>();
    for (const m of members) {
      tvl += m.tvl_usd;
      if (m.mcap_usd !== null && m.mcap_usd > 0 && mcap === null) mcap = m.mcap_usd;
      if (m.change_7d !== null) {
        weightedChange += m.tvl_usd * m.change_7d;
        changeWeight += m.tvl_usd;
      }
      if (m.listed_at !== null && (earliest === null || m.listed_at < earliest)) {
        earliest = m.listed_at;
      }
      if (m.tvl_usd > largestTvl) {
        largestTvl = m.tvl_usd;
        category = m.category;
      }
      for (const c of m.chains) chains.add(c);
    }
    const traded = members.find((m) => m.mcap_usd !== null && m.mcap_usd > 0);
    families.push({
      name: members[0]!.name,
      slug: members[0]!.slug,
      tvl,
      mcap,
      change_7d: changeWeight > 0 ? weightedChange / changeWeight : null,
      listed_at: earliest,
      category: traded ? traded.category : category,
      chains: [...chains].sort(),
    });
  }
  return families;
}


/** A deterministic generator: mulberry32. The bootstrap refits draw from this
 *  and nothing else, so two runs of the program agree byte for byte. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The comp set: traded families, minus exchange and bridge tokens, minus
 *  degenerate comps whose market cap is more than 10x their TVL. */
export function compSet(families: Family[]): Family[] {
  return families.filter((f) => {
    if (f.mcap === null || f.mcap <= 0 || f.tvl <= 0) return false;
    if (f.category !== null && FIT_EXCLUDED_CATEGORIES.has(f.category)) return false;
    if (f.mcap / f.tvl > MODEL.ratio_trim_high) return false;
    return true;
  });
}

/** Categories with at least `category_min_comps` comps, sorted for a stable order. */
export function modelCategories(comps: Family[]): string[] {
  const counts = new Map<string, number>();
  for (const f of comps) {
    const c = f.category ?? 'None';
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= MODEL.category_min_comps)
    .map(([c]) => c)
    .sort();
}

/** One row of the design matrix: intercept, log size, category dummies,
 *  clamped growth, log age. Missing growth or age contributes 0. */
function designRow(
  f: { tvl: number; category: string | null; change_7d: number | null; listed_at: string | null },
  cats: string[],
  as_of: string,
): number[] {
  const row: number[] = [1, Math.log10(f.tvl)];
  for (const c of cats) row.push((f.category ?? 'None') === c ? 1 : 0);
  const g = f.change_7d;
  row.push(
    g === null
      ? 0
      : Math.max(MODEL.growth_floor, Math.min(MODEL.growth_cap, g)) / 100,
  );
  const ad = ageDays(f.listed_at, as_of);
  row.push(
    ad === null ? 0 : Math.log10(Math.max(ad, MODEL.age_min_days)) - Math.log10(MODEL.age_reference_days),
  );
  return row;
}

/** Solve a small dense linear system by Gaussian elimination with partial
 *  pivoting. The normal-equations matrix is at most 10x10 here. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    const diag = m[col]![col]!;
    if (diag === 0) continue;
    for (let r = col + 1; r < n; r++) {
      const factor = m[r]![col]! / diag;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r]![n]!;
    for (let c = r + 1; c < n; c++) sum -= m[r]![c]! * x[c]!;
    x[r] = m[r]![r]! === 0 ? 0 : sum / m[r]![r]!;
  }
  return x;
}

/** Fit the ridge model on the comps: beta = (X'X + P)^-1 X'y, with lambda on
 *  every coefficient except the intercept and the size slope. */
export function fitModel(comps: Family[], cats: string[], as_of: string): FittedModel {
  const p = 2 + cats.length + 2;
  const xtx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty = new Array<number>(p).fill(0);
  for (const f of comps) {
    const row = designRow(f, cats, as_of);
    const y = Math.log10(f.mcap!);
    for (let i = 0; i < p; i++) {
      xty[i]! += row[i]! * y;
      for (let j = 0; j < p; j++) xtx[i]![j]! += row[i]! * row[j]!;
    }
  }
  for (let i = 2; i < p; i++) xtx[i]![i]! += MODEL.ridge_lambda;
  const beta = solve(xtx, xty);
  const category_tilt: Record<string, number> = {};
  cats.forEach((c, i) => {
    category_tilt[c] = beta[2 + i]!;
  });
  return {
    intercept: beta[0]!,
    slope: beta[1]!,
    growth_coef: beta[2 + cats.length]!,
    age_coef: beta[3 + cats.length]!,
    categories: cats,
    category_tilt,
    comp_count: comps.length,
    lambda: MODEL.ridge_lambda,
  };
}

/** The model's prediction for one protocol-shaped row. */
export function predict(
  model: FittedModel,
  f: { tvl: number; category: string | null; change_7d: number | null; listed_at: string | null },
  as_of: string,
): number {
  let v = model.intercept + model.slope * Math.log10(f.tvl);
  v += model.category_tilt[f.category ?? 'None'] ?? 0;
  if (f.change_7d !== null) {
    v += model.growth_coef * (Math.max(MODEL.growth_floor, Math.min(MODEL.growth_cap, f.change_7d)) / 100);
  }
  const ad = ageDays(f.listed_at, as_of);
  if (ad !== null) {
    v += model.age_coef * (Math.log10(Math.max(ad, MODEL.age_min_days)) - Math.log10(MODEL.age_reference_days));
  }
  return 10 ** v;
}

/** The median of a list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The median miss factor: 10 to the median absolute log error. */
function medianMiss(logErrors: number[]): number {
  return 10 ** median(logErrors.map((e) => Math.abs(e)));
}

/** The flat multiple over a set of families: median(mcap / TVL). */
function flatMultiple(comps: Family[]): number {
  return median(comps.map((f) => f.mcap! / f.tvl));
}

/** Leave-one-family-out validation: each family in turn is held out, the
 *  model refits on the rest, and the held-out token is predicted. */
export function looValidation(
  comps: Family[],
  cats: string[],
  as_of: string,
): { model_median_miss: number; model_within_3x: number; flat_median_miss: number } {
  const modelErrs: number[] = [];
  const flatErrs: number[] = [];
  const log3 = Math.log10(3);
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const held = comps[i]!;
    const model = fitModel(train, cats, as_of);
    modelErrs.push(Math.log10(held.mcap!) - Math.log10(predict(model, held, as_of)));
    flatErrs.push(Math.log10(held.mcap!) - Math.log10(flatMultiple(train) * held.tvl));
  }
  return {
    model_median_miss: medianMiss(modelErrs),
    model_within_3x: modelErrs.filter((e) => Math.abs(e) < log3).length / modelErrs.length,
    flat_median_miss: medianMiss(flatErrs),
  };
}

/** The time-split test: fit on families listed before 2024, test on newer ones. */
export function timeSplitValidation(
  comps: Family[],
  cats: string[],
  as_of: string,
): ValidationTest | null {
  const known = comps.filter((f) => f.listed_at !== null);
  const old = known.filter((f) => f.listed_at! < '2024-01-01');
  const next = known.filter((f) => f.listed_at! >= '2024-01-01');
  if (old.length < 10 || next.length < 5) return null;
  const model = fitModel(old, cats, as_of);
  const fm = flatMultiple(old);
  const modelErrs = next.map((f) => Math.log10(f.mcap!) - Math.log10(predict(model, f, as_of)));
  const flatErrs = next.map((f) => Math.log10(f.mcap!) - Math.log10(fm * f.tvl));
  const log3 = Math.log10(3);
  return {
    name: 'Time split (fit pre-2024, test newer)',
    tested: next.length,
    model_median_miss: medianMiss(modelErrs),
    model_within_3x: modelErrs.filter((e) => Math.abs(e) < log3).length / modelErrs.length,
    flat_median_miss: medianMiss(flatErrs),
  };
}

/** The walk-forward test: two expanding folds over listing date. */
export function walkForwardValidation(
  comps: Family[],
  cats: string[],
  as_of: string,
): ValidationTest | null {
  const known = comps
    .filter((f) => f.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const n = known.length;
  if (n < 20) return null;
  const folds: [Family[], Family[]][] = [
    [known.slice(0, Math.floor(n / 2)), known.slice(Math.floor(n / 2), Math.floor((3 * n) / 4))],
    [known.slice(0, Math.floor((3 * n) / 4)), known.slice(Math.floor((3 * n) / 4))],
  ];
  const modelErrs: number[] = [];
  const flatErrs: number[] = [];
  for (const [train, test] of folds) {
    const model = fitModel(train, cats, as_of);
    const fm = flatMultiple(train);
    for (const f of test) {
      modelErrs.push(Math.log10(f.mcap!) - Math.log10(predict(model, f, as_of)));
      flatErrs.push(Math.log10(f.mcap!) - Math.log10(fm * f.tvl));
    }
  }
  const log3 = Math.log10(3);
  return {
    name: 'Walk-forward (expanding folds)',
    tested: modelErrs.length,
    model_median_miss: medianMiss(modelErrs),
    model_within_3x: modelErrs.filter((e) => Math.abs(e) < log3).length / modelErrs.length,
    flat_median_miss: medianMiss(flatErrs),
  };
}

/** Bootstrap bands: refit on resampled comps (seeded) and collect, for every
 *  row, the P25-P75 value band and the P10-P90 rank range. */
export function bootstrapBands(
  comps: Family[],
  cats: string[],
  as_of: string,
  rows: { tvl: number; category: string | null; change_7d: number | null; listed_at: string | null }[],
): { p25: number[]; p75: number[]; rankP10: number[]; rankP90: number[] } {
  const rng = mulberry32(MODEL.bootstrap_seed);
  const n = rows.length;
  const valueSamples: number[][] = Array.from({ length: n }, () => []);
  const rankSamples: number[][] = Array.from({ length: n }, () => []);
  for (let b = 0; b < MODEL.bootstrap_refits; b++) {
    const sample: Family[] = [];
    for (let i = 0; i < comps.length; i++) {
      sample.push(comps[Math.floor(rng() * comps.length)]!);
    }
    const model = fitModel(sample, cats, as_of);
    const preds = rows.map((r) => predict(model, r, as_of));
    const order = preds
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v || rows[b.i]!.tvl - rows[a.i]!.tvl || a.i - b.i);
    order.forEach(({ i }, rank) => {
      rankSamples[i]!.push(rank + 1);
    });
    preds.forEach((v, i) => valueSamples[i]!.push(v));
  }
  const quantile = (values: number[], q: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  };
  return {
    p25: valueSamples.map((v) => quantile(v, 0.25)),
    p75: valueSamples.map((v) => quantile(v, 0.75)),
    rankP10: rankSamples.map((v) => quantile(v, 0.1)),
    rankP90: rankSamples.map((v) => quantile(v, 0.9)),
  };
}


/** How many protocols share each brand, over the whole snapshot. */
function brandCounts(protocols: SnapshotProtocol[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of protocols) {
    const b = brand(p.name);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return counts;
}

/** Why a pre-token protocol is set aside, or null when it is rankable.
 *  The first matching reason wins, and the reason is stated on the board. */
export function exclusionReason(
  p: SnapshotProtocol,
  brands: Map<string, number>,
): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    return `category ${p.category}`;
  }
  if (hasVersionMarker(p.name)) return 'version marker';
  const words = new Set((p.name.toLowerCase().match(WORD_RE) ?? []) as string[]);
  for (const w of words) {
    if (WRAPPED_WORDS.has(w)) return 'wrapped/staked product';
  }
  const first = (p.name.split(/\s+/)[0] ?? '').toLowerCase();
  if (EXCHANGES.has(first)) return 'exchange';
  if ((brands.get(brand(p.name)) ?? 0) > 1) return 'multi-product family';
  return null;
}

/** Gas for the whole farm: $5 when any chain is cheap, else $25 (Ethereum). */
function gasCost(chains: string[]): number {
  return chains.some((c) => CHEAP_CHAINS.has(c)) ? FARM.gas_cheap_usd : FARM.gas_eth_usd;
}

/** The farm plan for one deposit size, netted to the dollar. */
export function farmTier(
  implied_value_usd: number,
  tvl_usd: number,
  chains: string[],
  deposit: number,
): FarmTier {
  const slice_usd =
    FARM.pool_pct * implied_value_usd * (deposit / (tvl_usd * FARM.participation));
  const costs_usd = gasCost(chains) + deposit * FARM.tbill_apy * (FARM.weeks / 52);
  const break_even_odds = slice_usd > 0 ? costs_usd / slice_usd : 99;
  const net_per_hour = (slice_usd - costs_usd) / FARM.hours;
  let verdict = 'thin';
  if (net_per_hour > FARM.farm_net_per_hour && break_even_odds < FARM.farm_break_even) {
    verdict = 'farm';
  } else if (net_per_hour < 0 || break_even_odds > 1) {
    verdict = 'skip';
  }
  return { deposit, slice_usd, costs_usd, break_even_odds, net_per_hour, verdict };
}

/** The deposit step, shaped by the protocol's category. */
function depositStep(
  name: string,
  category: string,
  chain: string,
  deposit: number,
): string {
  const d = `$${deposit.toLocaleString('en-US')}`;
  switch (category) {
    case 'Lending':
      return `Lend ${d} of USDC into ${name}'s ${chain} market; the deposit itself earns the points, so no separate staking step is needed.`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Deposit ${d} into ${name}'s highest-yield ${chain} vault and leave it compounding; withdrawing early resets the points clock.`;
    case 'Dexs':
      return `Provide ${d} of liquidity to ${name}'s busiest ${chain} pool and hold the LP position; trading fees stack on top of the airdrop.`;
    case 'RWA':
      return `Buy ${d} of ${name}'s tokenised ${chain} product and hold it in your wallet; the position accrues yield and points together.`;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return `Deposit ${d} into ${name}'s curated ${chain} vault; the curator allocates it, and your share of the vault is your share of the drop.`;
    case 'CDP':
      return `Open a ${chain} vault on ${name} with ${d} of collateral and mint against it; keep the ratio above 200% so a dip never liquidates you.`;
    case 'Prediction Market':
      return `Take ${d} of positions across ${name}'s ${chain} markets over the next month; activity, not an idle balance, earns the points here.`;
    case 'Derivatives':
      return `Open a small hedged ${chain} position on ${name} with ${d} of margin and hold it; volume and open interest count toward the drop.`;
    case 'Farm':
      return `Stake ${d} in ${name}'s ${chain} farm; the stake earns yield while the points accrue, and both pay at the token launch.`;
    default:
      return `Deposit ${d} into ${name} on ${chain} and leave it working; the position itself is the farm.`;
  }
}

/** Eight farm steps for one row, specific to the protocol, its chains, its
 *  category and its verdict. Every step runs 20-600 characters. */
export function farmSteps(row: RadarRow): string[] {
  const name = row.name;
  const chain = row.chains[0] ?? 'its home chain';
  const second = row.chains[1];
  const weeks = FARM.weeks;
  const verdict = row.farm_1k.verdict;
  const money = (n: number): string =>
    n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
  const deposit = verdict === 'skip' ? 10_000 : 1_000;
  const steps: string[] = [];
  if (verdict === 'skip') {
    if (row.farm_10k.verdict === 'skip') {
      steps.push(
        `Verdict is SKIP at every deposit size — even $10,000 returns a slice of ${money(row.farm_10k.slice_usd)} against ${money(row.farm_10k.costs_usd)} of costs. Farm it only if you already hold a position here; the steps below are the plan in that case.`,
      );
    } else {
      steps.push(
        `Verdict is SKIP at $1,000 — the slice (${money(row.farm_1k.slice_usd)}) trails the costs (${money(row.farm_1k.costs_usd)}). The steps below size the farm to $10,000, where the slice is ${money(row.farm_10k.slice_usd)} against ${money(row.farm_10k.costs_usd)} of costs.`,
      );
    }
  } else {
    steps.push(
      `Farm ${name} with $${deposit.toLocaleString('en-US')} on ${chain}: open the app, connect a fresh farming wallet, and keep this address separate from your main holdings.`,
    );
  }
  steps.push(depositStep(name, row.category, chain, deposit));
  steps.push(
    `Check ${name}'s points page every Sunday and screenshot the balance monthly; your share grows with deposit x time, so the deposit stays untouched for the full ${weeks} weeks.`,
  );
  if (second) {
    steps.push(
      `If ${name} runs a second market or a points program on ${second}, put 20% of the deposit there — a second surface doubles the ways the drop can find you.`,
    );
  } else {
    steps.push(
      `If ${name} runs quests or a referral program, take the weekly quest and invite one real user — quests pay points the deposit alone never earns.`,
    );
  }
  steps.push(
    `Timeline: deposit in week 1, first review in week 4, decide at week 13 whether to top up or hold, and reassess at week ${weeks}.`,
  );
  steps.push(
    `Watch ${name}'s TVL and announcements weekly: a 50% TVL fall, a hack, or a pause is your cue to exit — see the stop rule below.`,
  );
  steps.push(
    `Stop rule: exit if ${name}'s TVL falls 50% from your entry, if the team pauses deposits, or at week ${weeks}, whichever comes first; never add to a falling position.`,
  );
  steps.push(
    `If ${name} announces a token, claim in the first week: unclaimed airdrops usually expire, and the first claim window has the cheapest gas.`,
  );
  return steps;
}

/** The board, the radar, and the validation — everything from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const as_of = snapshot.as_of;
  const families = buildFamilies(snapshot.protocols);
  const comps = compSet(families);
  const cats = modelCategories(comps);
  const model = fitModel(comps, cats, as_of);
  const loo = looValidation(comps, cats, as_of);
  const validation: ValidationTest[] = [];
  const ts = timeSplitValidation(comps, cats, as_of);
  if (ts) validation.push(ts);
  const wf = walkForwardValidation(comps, cats, as_of);
  if (wf) validation.push(wf);

  const brands = brandCounts(snapshot.protocols);
  const watchlistSet = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter(
    (p) => p.mcap_usd === null || p.mcap_usd <= 0,
  );
  const watchlistRows = preToken.filter((p) => watchlistSet.has(p.slug));
  const aboveFloor = preToken.filter(
    (p) => !watchlistSet.has(p.slug) && p.tvl_usd >= snapshot.floor_usd,
  );
  const belowFloor = preToken.filter(
    (p) => !watchlistSet.has(p.slug) && p.tvl_usd < snapshot.floor_usd,
  );
  const rankableAbove = aboveFloor.filter((p) => exclusionReason(p, brands) === null);
  const setAsideList = aboveFloor.filter((p) => exclusionReason(p, brands) !== null);
  const rankableBelow = belowFloor
    .filter((p) => exclusionReason(p, brands) === null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd);
  const earlyCount = Math.max(
    0,
    MODEL.target_rows - watchlistRows.length - rankableAbove.length,
  );
  const early = rankableBelow.slice(0, earlyCount);

  const picked: { p: SnapshotProtocol; bucket: string }[] = [
    ...watchlistRows.map((p) => ({ p, bucket: 'watchlist' })),
    ...rankableAbove.map((p) => ({ p, bucket: 'parent-linked' })),
    ...early.map((p) => ({ p, bucket: 'early' })),
  ];

  const scored = picked
    .map(({ p, bucket }) => ({
      p,
      bucket,
      value: predict(
        model,
        { tvl: p.tvl_usd, category: p.category, change_7d: p.change_7d, listed_at: p.listed_at },
        as_of,
      ),
    }))
    .sort(
      (a, b) =>
        b.value - a.value ||
        b.p.tvl_usd - a.p.tvl_usd ||
        (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
    );
  const bands = bootstrapBands(
    comps,
    cats,
    as_of,
    scored.map((s) => ({
      tvl: s.p.tvl_usd,
      category: s.p.category,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
    })),
  );

  const rows: RadarRow[] = scored.map((s, i) => {
    const p = s.p;
    const implied = Math.max(1, Math.round(s.value));
    const row: RadarRow = {
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorized',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p.listed_at, as_of),
      bucket: s.bucket,
      rank: i + 1,
      implied_value_usd: implied,
      value_p25_usd: Math.max(1, Math.round(bands.p25[i]!)),
      value_p75_usd: Math.max(1, Math.round(bands.p75[i]!)),
      rank_p10: Math.max(1, Math.round(bands.rankP10[i]!)),
      rank_p90: Math.max(1, Math.round(bands.rankP90[i]!)),
      farm_steps: [],
      farm_1k: farmTier(implied, p.tvl_usd, p.chains, 1000),
      farm_100: farmTier(implied, p.tvl_usd, p.chains, 100),
      farm_10k: farmTier(implied, p.tvl_usd, p.chains, 10000),
    };
    row.farm_steps = farmSteps(row);
    return row;
  });

  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
    category: r.category,
    tvl_usd: r.tvl_usd,
    bucket: r.bucket,
    value_p25_usd: r.value_p25_usd,
    value_p75_usd: r.value_p75_usd,
    rank_p10: r.rank_p10,
    rank_p90: r.rank_p90,
    farm_verdict: r.farm_1k.verdict,
    farm_slice_usd: Math.round(r.farm_1k.slice_usd * 100) / 100,
    farm_costs_usd: Math.round(r.farm_1k.costs_usd * 100) / 100,
    farm_break_even_odds: Math.round(r.farm_1k.break_even_odds * 1000) / 1000,
    farm_net_per_hour: Math.round(r.farm_1k.net_per_hour * 100) / 100,
  }));

  const reasonGroups = new Map<string, SnapshotProtocol[]>();
  for (const p of setAsideList) {
    const reason = exclusionReason(p, brands)!;
    const list = reasonGroups.get(reason);
    if (list) list.push(p);
    else reasonGroups.set(reason, [p]);
  }
  const set_aside = [...reasonGroups.entries()]
    .map(([reason, list]) => ({
      reason,
      count: list.length,
      top: list
        .sort((a, b) => b.tvl_usd - a.tvl_usd)
        .slice(0, 5)
        .map((p) => p.slug),
    }))
    .sort((a, b) => b.count - a.count);

  const fmt = (n: number, digits = 2): string => n.toFixed(digits);
  const signed = (n: number): string => (n >= 0 ? `+ ${fmt(n)}` : `- ${fmt(-n)}`);
  const formula =
    `log10(value) = ${fmt(model.intercept)} ${signed(model.slope)} x log10(TVL)` +
    ` + category tilt (${Object.entries(model.category_tilt)
      .filter(([, t]) => Math.abs(t) >= 0.05)
      .map(([c, t]) => `${c} ${t >= 0 ? '+' : ''}${fmt(t)}`)
      .join(', ')})` +
    ` ${signed(model.growth_coef)} x growth/100 ${signed(model.age_coef)} x log10(age/365d)`;

  const radar: Radar = {
    as_of,
    floor_usd: snapshot.floor_usd,
    model,
    validation,
    loo_median_miss: loo.model_median_miss,
    loo_within_3x: loo.model_within_3x,
    flat_loo_median_miss: loo.flat_median_miss,
    rows,
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      traded: snapshot.protocols.length - preToken.length,
      pre_token: preToken.length,
      ranked: rows.length,
      watchlist_ranked: watchlistRows.length,
      parent_linked: rankableAbove.length,
      early: early.length,
      set_aside_above_floor: setAsideList.length,
      below_floor_unranked: belowFloor.length - early.length,
      comp_families: comps.length,
    },
    set_aside,
    farm_assumptions: [
      `Airdrop pool: ${(FARM.pool_pct * 100).toFixed(0)}% of the implied value, the conservative end of the usual 5-15% community airdrop.`,
      `Participation: ${(FARM.participation * 100).toFixed(0)}% of TVL actively farms points; the rest is passive, so the slice is the deposit's share of the farming fifth.`,
      `Horizon: ${FARM.weeks} weeks, ${FARM.hours} hours of attention (1 hour to set up, about 5 minutes a week).`,
      `Costs: gas ($${FARM.gas_cheap_usd} on a cheap chain, $${FARM.gas_eth_usd} on Ethereum mainnet) plus the ${(FARM.tbill_apy * 100).toFixed(0)}% T-bill return the deposit gives up.`,
      'Verdict: FARM when the net pay beats $5/hour and the break-even odds sit under 50%; SKIP when the net pay is negative or the break-even odds pass 100%; THIN in between.',
    ],
    formula,
    generated_by: 'Token Radar v2 — fitted log-log size curve on the snapshot’s traded tokens',
  };
  return { board, radar };
}

/** The gate's own checks, run before anything is written: ranks 1..N, values
 *  non-rising, whole positive values, farm steps in range, full watchlist. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows: hand in at least 100`;
  if (board.length > 4000) return `the board holds ${board.length} rows: at most 4,000`;
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (const row of board) {
    if (seen.has(row.slug)) return `the board ranks ${row.slug} twice`;
    seen.add(row.slug);
    if (row.rank !== board.indexOf(row) + 1) return `row ${row.slug} carries rank ${row.rank} out of order`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) {
      return `row ${row.slug} carries an implied value that is not a positive whole number`;
    }
    if (row.implied_value_usd > 1e14) return `row ${row.slug} carries an implied value above $100T`;
    if (row.implied_value_usd > prev) return `the implied value rises at ${row.slug}`;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} carries ${row.farm_steps.length} farm steps: hand in 3-12`;
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) {
        return `row ${row.slug} carries a farm step of ${step.length} characters: keep each 20-600`;
      }
    }
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) return `the board misses watchlist protocols: ${missing.slice(0, 5).join(', ')}`;
  const first = board[0]!.implied_value_usd;
  if (board.every((r) => r.implied_value_usd === first)) {
    return 'every row carries the same implied value';
  }
  return null;
}

/** The dashboard's data file: one global the page reads, no network. */
export function dataScript(radar: Radar): string {
  return `// Token Radar v2 data: the ranked board, the fitted model, the validation\n// and the farm plans, written by main.ts from the sealed snapshot.\nwindow.RADAR = ${JSON.stringify(radar)};\n`;
}
