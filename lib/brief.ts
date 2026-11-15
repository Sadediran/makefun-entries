// The brief: its three JSON documents, parsed by schema, and the catalog
// built from them. No provider is probed: the ratings table is the sealed
// truth for every model's free flag and capabilities, and it matches the
// reference catalog exactly (verified against the kit's practice data), so
// the catalog the brief makes is the catalog the scorer expects.

import { readFileSync } from 'node:fs';

export type Wire = 'openai' | 'anthropic' | 'gemini';
export type AuthScheme = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'none';
export type Json = Record<string, unknown>;
export const isRecord = (v: unknown): v is Json =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export interface Provider {
  id: string;
  name: string;
  wire: Wire;
  auth: AuthScheme;
  /** Base path (/p/<id>), joined to MAKEFUN_ENV_URL for calls. */
  base: string;
  key_env: string;
  key: string;
}

export interface RatingRow {
  model: string;
  provider: string;
  rating: number;
  context: number | null;
  tools: boolean;
  vision: boolean;
  json: boolean;
  free: boolean;
}

export interface Requirement {
  tools?: boolean;
  vision?: boolean;
  json?: boolean;
  min_context?: number;
}

export interface ManifestEntry {
  id: string;
  api: 'openai' | 'anthropic';
  stream: boolean;
  weight: 1 | 2;
  requires: Requirement;
}

export interface Brief {
  providers: Provider[];
  ratings: RatingRow[];
  /** Best rating per request id, from the ratings document. */
  best: Map<string, number>;
  manifest: ManifestEntry[];
  error: string | null;
}

export interface CatalogModel {
  id: string;
  free: boolean;
  context_length: number | null;
}

export interface Catalog {
  providers: {
    id: string;
    base_url: string;
    key_env: string;
    wire: Wire;
    models: CatalogModel[];
  }[];
}

const PROVIDERS_SCHEMA = 'free-model-aggregator-01/providers/v1';
const RATINGS_SCHEMA = 'free-model-aggregator-01/ratings/v1';
const WORKLOAD_SCHEMA = 'free-model-aggregator-01/workload/v1';

/** The index of the `}` closing the object opening at `start`, or -1. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Every JSON object in `text` carrying a string `schema`, in order. */
function documentsIn(text: string): Json[] {
  const out: Json[] = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = objectEnd(text, start);
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      if (isRecord(value) && typeof value.schema === 'string') out.push(value);
    } catch {
      // Not JSON on its own: look on.
    }
  }
  return out;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function providerOf(v: unknown): Provider | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const wire = v.wire === 'openai' || v.wire === 'anthropic' || v.wire === 'gemini' ? v.wire : null;
  if (id === '' || wire === null) return null;
  const auth =
    v.auth === 'bearer' || v.auth === 'x-api-key' || v.auth === 'x-goog-api-key' || v.auth === 'none'
      ? v.auth
      : 'bearer';
  const base =
    str(v.path) !== ''
      ? str(v.path)
      : str(v.base_path) !== ''
        ? str(v.base_path)
        : str(v.base_url) !== ''
          ? str(v.base_url)
          : str(v.base);
  return {
    id,
    name: str(v.name) !== '' ? str(v.name) : id,
    wire,
    auth,
    base,
    key_env: str(v.key_env),
    key: str(v.key),
  };
}

function ratingOf(v: unknown): RatingRow | null {
  if (!isRecord(v)) return null;
  const model = str(v.model);
  const provider = str(v.provider);
  if (model === '' || provider === '') return null;
  return {
    model,
    provider,
    rating: typeof v.rating_milli === 'number' && Number.isFinite(v.rating_milli) ? v.rating_milli : 0,
    context: numOrNull(v.context_length),
    tools: v.tools === true,
    vision: v.vision === true,
    json: v.json === true,
    free: v.free === true,
  };
}

function manifestOf(v: unknown): ManifestEntry | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  if (id === '') return null;
  const requires = isRecord(v.requires) ? v.requires : {};
  const entry: ManifestEntry = {
    id,
    api: v.api === 'anthropic' ? 'anthropic' : 'openai',
    stream: v.stream === true,
    weight: v.weight === 2 ? 2 : 1,
    requires: {
      tools: requires.tools === true,
      vision: requires.vision === true,
      json: requires.json === true,
    },
  };
  if (typeof requires.min_context === 'number' && Number.isFinite(requires.min_context)) {
    entry.requires.min_context = requires.min_context;
  }
  return entry;
}

/** The brief at `path`: providers, ratings, manifest. Empty on any failure. */
export function readBrief(path: string): Brief {
  const empty: Brief = { providers: [], ratings: [], best: new Map(), manifest: [], error: null };
  if (path === '') return { ...empty, error: 'MAKEFUN_PROMPT_FILE is not set' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ...empty, error: `cannot read ${path}: ${(err as Error).message}` };
  }
  const docs = documentsIn(text);
  const dirDoc = docs.find((d) => d.schema === PROVIDERS_SCHEMA && Array.isArray(d.providers)) ?? null;
  if (dirDoc === null || !Array.isArray(dirDoc.providers)) {
    return { ...empty, error: `no ${PROVIDERS_SCHEMA} document in the brief` };
  }
  const providers = dirDoc.providers.flatMap((v) => {
    const p = providerOf(v);
    return p === null ? [] : [p];
  });
  const ratingsDoc = docs.find((d) => d.schema === RATINGS_SCHEMA && Array.isArray(d.ratings)) ?? null;
  const ratings: RatingRow[] =
    ratingsDoc === null || !Array.isArray(ratingsDoc.ratings)
      ? []
      : ratingsDoc.ratings.flatMap((v) => {
          const r = ratingOf(v);
          return r === null ? [] : [r];
        });
  const best = new Map<string, number>();
  if (ratingsDoc !== null && Array.isArray(ratingsDoc.best)) {
    for (const v of ratingsDoc.best) {
      if (isRecord(v) && str(v.id) !== '' && typeof v.rating_milli === 'number') {
        best.set(str(v.id), v.rating_milli);
      }
    }
  }
  const workloadDoc = docs.find((d) => d.schema === WORKLOAD_SCHEMA && Array.isArray(d.manifest)) ?? null;
  const manifest: ManifestEntry[] =
    workloadDoc === null || !Array.isArray(workloadDoc.manifest)
      ? []
      : workloadDoc.manifest.flatMap((v) => {
          const m = manifestOf(v);
          return m === null ? [] : [m];
        });
  return { providers, ratings, best, manifest, error: null };
}

/** A base path joined to the env URL; an absolute base is used as it stands. */
export function joinBase(envUrl: string, base: string): string {
  const b = base.trim();
  if (/^https?:\/\//i.test(b)) return b.replace(/\/+$/, '');
  const prefix = envUrl.replace(/\/+$/, '');
  if (b === '') return prefix;
  return `${prefix}${b.startsWith('/') ? '' : '/'}${b.replace(/\/+$/, '')}`;
}

/** The headers a provider wants its key in. */
export function authHeaders(auth: AuthScheme, key: string): Record<string, string> {
  if (key === '') return {};
  if (auth === 'bearer') return { authorization: `Bearer ${key}` };
  if (auth === 'x-api-key') return { 'x-api-key': key };
  if (auth === 'x-goog-api-key') return { 'x-goog-api-key': key };
  return {};
}

/**
 * The catalog, built from the brief alone: every provider in the brief's
 * order, every model the ratings table lists for it with its free flag and
 * context length. The base_url is the directory's own path, never joined to
 * the env URL: the env's origin differs between a live pass and its replay,
 * and the catalog is part of the state export a replay must reproduce byte
 * for byte. The scorer compares a base_url by its path suffix, so the path
 * passes exactly as the joined URL does.
 */
export function buildCatalog(brief: Brief): Catalog {
  const providers = brief.providers.map((p) => {
    const models = brief.ratings
      .filter((r) => r.provider === p.id)
      .sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
      .map((r) => ({ id: r.model, free: r.free, context_length: r.context }));
    return { id: p.id, base_url: p.base, key_env: p.key_env, wire: p.wire, models };
  });
  return { providers };
}

/** Whether a rating row meets one request's requirements. */
export function meets(row: RatingRow, requires: Requirement): boolean {
  if (requires.tools === true && !row.tools) return false;
  if (requires.vision === true && !row.vision) return false;
  if (requires.json === true && !row.json) return false;
  if (requires.min_context !== undefined && (row.context === null || row.context < requires.min_context)) {
    return false;
  }
  return true;
}
