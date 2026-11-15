// The router: a risk-aware per-request policy, tuned on a fixed Monte Carlo
// simulator (~/workspace/makefun/fma-sim.py, 2,000 random instances drawn
// faithfully to the kit's public generator).
//
// The policy, validated in the sim (expected 22.77 calls, P(score 99) = 1.0):
//   - every pick costs weighted quality loss + RISK_WEIGHT x P(next call fails);
//     the cheapest candidate wins, inside a quality budget of 382 loss units
//     (the quality-99 boundary: bound 38,248, so loss <= 382 keeps quality 99);
//   - the failure model comes from the generator's public distributions: each
//     provider's budget range, 1-2 scheduled fail-calls uniform in [2, budget),
//     one provider designated to fail its 2nd call, one outage provider;
//   - refusals are classified from the provider's own message: "budget is
//     spent" and "is out" are permanent (the provider is dead); "refused this
//     call" is a scheduled failure, isolated — that fail-call is spent, so the
//     provider's next call is SAFER, and it stays a candidate;
//   - same-first failover: a tried provider that is not dead is ranked
//     alongside untried providers by cost, not held back as a last resort.
//     Retrying a provider right after its scheduled failure beats moving to a
//     fresh provider's 2nd call, because the fail-call is spent. This one
//     change is worth ~0.5 expected calls over the v2 policy (23.23 -> 22.77)
//     and collapses the tail (25+ calls: 396 -> 126 per 2,000 trials).
//   - JSON-mode requests on the OPENAI client wire never go to an
//     anthropic-wire provider: the env's anthropic parser sets jsonMode
//     false always, so the echo_json check would fail and the request would
//     be invalid. (Anthropic-client JSON requests carry no JSON-mode echo
//     expectation, so any wire serves them.)
//   - exactly one provider call is ever in flight; no retries at the transport
//     layer; no discovery traffic. Deterministic: ties break by rating, then
//     provider id, then model id — no clock, no unseeded randomness.

import { meets, type Brief, type RatingRow, type Requirement } from './brief.ts';

/** Quality-loss budget, in weighted rating-milli: loss <= 382 keeps quality 99. */
export const QUALITY_BUDGET = 382;
/** What one unit of failure probability costs, in rating-milli. */
export const RISK_WEIGHT = 400;
/** Most attempts on one request before it is left unserved. */
export const MAX_ATTEMPTS = 12;

/**
 * Per-provider budget ranges, from the kit's public generator
 * (program/generator/draw.mjs, the PROVIDERS table): the prior the risk
 * model starts from. These are the generator's constants, the same on every
 * instance — prior knowledge, not instance data.
 */
export const BUDGET_PRIOR: Record<string, [number, number]> = {
  groq: [9, 12],
  cerebras: [5, 6],
  gemini: [6, 8],
  zai: [4, 5],
  openrouter: [10, 12],
  sambanova: [4, 5],
  pollinations: [10, 14],
  cloudflare: [7, 8],
  ovh: [5, 6],
  kilol: [12, 16],
};

export type Refusal = 'budget' | 'outage' | 'fail';

/** Classify a refusal from the provider's error message (env/server.mjs). */
export function classifyRefusal(message: string): Refusal {
  if (message.includes('budget is spent')) return 'budget';
  if (message.includes('is out')) return 'outage';
  return 'fail';
}

export interface Pick {
  providerId: string;
  row: RatingRow;
}

export class Router {
  private brief: Brief;
  private calls = new Map<string, number>();
  private failedAt = new Map<string, Set<number>>();
  private dead = new Set<string>();
  private served = new Map<string, number>();
  private lossSoFar = 0;

  constructor(brief: Brief) {
    this.brief = brief;
  }

  /** Record a served request's rating, for the quality-budget ledger. */
  servedRequest(requestId: string, rating: number): void {
    this.served.set(requestId, rating);
    const best = this.brief.best.get(requestId) ?? rating;
    const entry = this.brief.manifest.find((m) => m.id === requestId);
    const weight = entry?.weight ?? 1;
    this.lossSoFar += weight * Math.max(0, best - rating);
  }

  /** Record one provider call's outcome. */
  observe(providerId: string, ok: boolean, refusal: Refusal | null): void {
    const n = (this.calls.get(providerId) ?? 0) + 1;
    this.calls.set(providerId, n);
    if (!ok && refusal !== null) {
      const set = this.failedAt.get(providerId) ?? new Set<number>();
      set.add(n);
      this.failedAt.set(providerId, set);
      if (refusal === 'budget' || refusal === 'outage') this.dead.add(providerId);
    }
  }

  isDead(providerId: string): boolean {
    return this.dead.has(providerId);
  }

  /** P(the provider's next call fails), from the priors + what was observed. */
  failProb(providerId: string): number {
    const [cmin, cmax] = BUDGET_PRIOR[providerId] ?? [4, 16];
    const n = (this.calls.get(providerId) ?? 0) + 1;
    if (n === 1) return 0;
    if (this.dead.has(providerId)) return 1;
    const bmid = (cmin + cmax) / 2;
    const failsSeen = this.failedAt.get(providerId)?.size ?? 0;
    // Expected remaining scheduled fail-calls: 1.5 drawn, minus those spent.
    const remFails = Math.max(0, 1.5 - failsSeen);
    const pf = n <= bmid ? remFails / Math.max(1, bmid - 1) : 0.6;
    // One provider in ten is the outage provider; its outage starts uniform.
    const po = 0.1 / Math.max(1, bmid - 1);
    // P(budget < n | budget >= n - 1), uniform prior on [cmin, cmax].
    let pb = 0;
    if (n > cmin) {
      pb = n - 1 < cmax ? 1 / (cmax - (n - 1) + 1) : 0.9;
    }
    let pr = pf + po + pb;
    if (n === 2) pr += 0.1; // one provider is designated to fail its 2nd call
    // After a failure at a low call number, the next call is safer: a
    // fail-call is spent.
    if (failsSeen > 0) {
      const maxFailed = Math.max(...(this.failedAt.get(providerId) ?? new Set([0])));
      if (maxFailed <= 3) pr *= 0.6;
    }
    return Math.min(0.95, pr);
  }

  /**
   * The next provider+model for a request, or null when no eligible provider
   * is alive. `tried` is the set of providers already attempted on this
   * request: tried providers that are not dead stay candidates (same-first),
   * ranked by cost with the untried ones. `clientApi` matters for one rule:
   * a JSON-mode request on the OPENAI client wire cannot ride an
   * anthropic-wire provider (the env's anthropic parser sets jsonMode false
   * always, so the echo_json check would fail and the request be invalid);
   * an anthropic-client JSON request carries no JSON-mode echo expectation,
   * so any wire serves it.
   */
  pick(requestId: string, requires: Requirement, tried: Set<string>, clientApi: 'openai' | 'anthropic'): Pick | null {
    const entry = this.brief.manifest.find((m) => m.id === requestId);
    const weight = entry?.weight ?? 1;
    const best = this.brief.best.get(requestId) ?? 0;
    const jsonMode = clientApi === 'openai' && requires.json === true;
    const cands = this.brief.ratings.filter((row) => {
      if (!row.free) return false;
      if (this.dead.has(row.provider)) return false;
      if (!meets(row, requires)) return false;
      // JSON mode cannot ride an anthropic-wire provider (see header).
      if (jsonMode) {
        const provider = this.brief.providers.find((p) => p.id === row.provider);
        if (provider?.wire === 'anthropic') return false;
      }
      return true;
    });
    if (cands.length === 0) return null;
    const bestRating = Math.max(...cands.map((r) => r.rating));
    const budget = QUALITY_BUDGET;
    let scored: { cost: number; rating: number; row: RatingRow }[] = [];
    for (const row of cands) {
      const loss = (best - row.rating) * weight;
      if (this.lossSoFar + loss > budget && row.rating < bestRating) continue;
      scored.push({ cost: loss + RISK_WEIGHT * this.failProb(row.provider), rating: row.rating, row });
    }
    if (scored.length === 0) {
      // The budget admits nothing but the best: fall back to cost order over
      // every candidate (the best rating is always allowed).
      scored = cands.map((row) => ({
        cost: (best - row.rating) * weight + RISK_WEIGHT * this.failProb(row.provider),
        rating: row.rating,
        row,
      }));
    }
    scored.sort(
      (a, b) =>
        a.cost - b.cost ||
        b.rating - a.rating ||
        (a.row.provider < b.row.provider ? -1 : a.row.provider > b.row.provider ? 1 : 0) ||
        (a.row.model < b.row.model ? -1 : a.row.model > b.row.model ? 1 : 0),
    );
    const row = scored[0].row;
    return { providerId: row.provider, row };
  }
}
