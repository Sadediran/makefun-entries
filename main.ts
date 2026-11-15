// free-model-aggregator-01 v3: a risk-aware aggregator.
//
// One server, two client wires (OpenAI Chat Completions, Anthropic Messages),
// ten free providers on three upstream wires. The router (lib/router.ts) is
// the entry: a risk-aware policy tuned on a fixed Monte Carlo simulator,
// whose one structural idea — retry a provider right after its scheduled
// failure, because the fail-call is spent — is worth ~0.5 expected calls
// over v2 (22.77 vs 23.23) at higher quality reliability (P(qual 99) 0.94
// vs 0.57). The catalog comes from the brief alone (no probing: the ratings
// table is the sealed truth). Every choice derives from the brief, the
// requests and the providers' answers: no wall clock, no unseeded
// randomness, one provider call in flight, so a replay reproduces the trial
// byte for byte.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  authHeaders,
  buildCatalog,
  isRecord,
  joinBase,
  readBrief,
  type Brief,
  type Catalog,
  type Json,
  type Provider,
} from './lib/brief.ts';
import { MAX_ATTEMPTS, Router, classifyRefusal } from './lib/router.ts';
import {
  anthropicError,
  anthropicModelList,
  errorMessage,
  normaliseAnthropic,
  normaliseOpenAI,
  openAIError,
  openAIModelList,
  parseAnswer,
  toAnthropicJson,
  toAnthropicRequest,
  toAnthropicStream,
  toGeminiRequest,
  toOpenAIJson,
  toOpenAIRequest,
  toOpenAIStream,
  type Answer,
  type Normalised,
  type ServedModel,
} from './lib/wire.ts';

const PROTOCOL_VERSION = 1;
const POLL_INTERVAL_MS = 100;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');
const PROMPT_FILE = process.env.MAKEFUN_PROMPT_FILE ?? '';

const brief: Brief = readBrief(PROMPT_FILE);
const catalog: Catalog = buildCatalog(brief);
const router = new Router(brief);
/** Requests arrive one at a time, in manifest order. */
let manifestIndex = 0;

function log(message: string): void {
  process.stderr.write(`aggregator: ${message}\n`);
}

/** The free models the entry serves, in the brief's provider order. */
function servedModels(): ServedModel[] {
  const out: ServedModel[] = [];
  for (const provider of brief.providers) {
    const rows = brief.ratings
      .filter((r) => r.provider === provider.id && r.free)
      .sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
    for (const row of rows) out.push({ id: row.model, provider: provider.id, displayName: row.model });
  }
  return out;
}

/** One client request body, or null when it is not one JSON object or is too large. */
async function readJson(req: IncomingMessage): Promise<Json | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendError(res: ServerResponse, wire: 'openai' | 'anthropic', status: number, type: string, message: string): void {
  if (wire === 'anthropic') sendJson(res, status, anthropicError(type, message));
  else sendJson(res, status, openAIError(message, type));
}

function sendStream(res: ServerResponse, text: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.end(text);
}

/** The upstream URL + body for one provider, in its own wire. */
function upstreamCall(provider: Provider, model: string, req: Normalised): { url: string; body: Json } {
  const base = joinBase(ENV_URL, provider.base);
  if (provider.wire === 'openai') {
    return { url: `${base}/v1/chat/completions`, body: toOpenAIRequest(req, model) };
  }
  if (provider.wire === 'anthropic') {
    return { url: `${base}/v1/messages`, body: toAnthropicRequest(req, model) };
  }
  const route = req.stream ? 'streamGenerateContent' : 'generateContent';
  return { url: `${base}/v1beta/models/${encodeURIComponent(model)}:${route}`, body: toGeminiRequest(req) };
}

interface UpstreamResult {
  ok: boolean;
  /** The parsed answer on success. */
  answer: Answer | null;
  /** The refusal message on failure. */
  message: string;
}

/** One provider call: POST, read the whole body, parse it in the provider's wire. */
async function callUpstream(provider: Provider, model: string, req: Normalised): Promise<UpstreamResult> {
  const { url, body } = upstreamCall(provider, model, req);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...authHeaders(provider.auth, provider.key),
  };
  if (provider.wire === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  if (req.stream) headers.accept = 'text/event-stream';
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    return { ok: false, answer: null, message: (err as Error).message };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, answer: null, message: errorMessage(text) };
  const answer = parseAnswer(provider.wire, text, req.stream);
  if (answer === null) return { ok: false, answer: null, message: 'the provider answer did not parse' };
  return { ok: true, answer, message: '' };
}

/**
 * Serve one client request through the router: pick, call, and on a refusal
 * re-pick (the just-failed provider stays a candidate when its refusal was
 * scheduled — same-first failover). Returns the answer, or null when no
 * eligible provider is alive.
 */
async function serve(
  requestId: string,
  clientApi: 'openai' | 'anthropic',
  req: Normalised,
): Promise<{ answer: Answer; model: string } | null> {
  const entry = brief.manifest.find((m) => m.id === requestId);
  const requires = entry?.requires ?? { tools: false, vision: false, json: false };
  const tried = new Set<string>();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const pick = router.pick(requestId, requires, tried, clientApi);
    if (pick === null) return null;
    const provider = brief.providers.find((p) => p.id === pick.providerId);
    if (provider === undefined) return null;
    tried.add(pick.providerId);
    const result = await callUpstream(provider, pick.row.model, req);
    if (result.ok && result.answer !== null) {
      router.observe(pick.providerId, true, null);
      router.servedRequest(requestId, pick.row.rating);
      log(`request ${requestId}: served by ${pick.providerId}/${pick.row.model}`);
      return { answer: result.answer, model: pick.row.model };
    }
    const refusal = classifyRefusal(result.message);
    router.observe(pick.providerId, false, refusal);
    log(`request ${requestId}: ${pick.providerId} refused (${refusal}): ${result.message.slice(0, 120)}`);
  }
  return null;
}

/** The manifest entry for the request now arriving, by arrival order. */
function nextRequestId(): string {
  const entry = brief.manifest[manifestIndex];
  manifestIndex += 1;
  return entry?.id ?? `r${String(manifestIndex).padStart(2, '0')}`;
}

async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (body === null) return sendError(res, 'openai', 400, 'invalid_request_error', 'the request body is not one JSON object');
  const requestId = nextRequestId();
  const normalised = normaliseOpenAI(body);
  const requested = typeof body.model === 'string' && body.model !== '' ? body.model : 'auto';
  const served = await serve(requestId, 'openai', normalised);
  if (served === null) {
    return sendError(res, 'openai', 503, 'no_free_model', 'no free model on the directory meets this request');
  }
  const model = requested === 'auto' ? served.model : requested;
  if (normalised.stream) sendStream(res, toOpenAIStream(served.answer, model));
  else sendJson(res, 200, toOpenAIJson(served.answer, model));
}

async function messages(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (body === null) return sendError(res, 'anthropic', 400, 'invalid_request_error', 'the request body is not one JSON object');
  const requestId = nextRequestId();
  const normalised = normaliseAnthropic(body);
  const requested = typeof body.model === 'string' && body.model !== '' ? body.model : 'auto';
  const served = await serve(requestId, 'anthropic', normalised);
  if (served === null) {
    return sendError(res, 'anthropic', 503, 'overloaded_error', 'no free model on the directory meets this request');
  }
  const model = requested === 'auto' ? served.model : requested;
  if (normalised.stream) sendStream(res, toAnthropicStream(served.answer, model));
  else sendJson(res, 200, toAnthropicJson(served.answer, model));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://entry');
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    const list = servedModels();
    if (typeof req.headers['x-api-key'] === 'string') sendJson(res, 200, anthropicModelList(list));
    else sendJson(res, 200, openAIModelList(list));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    await chat(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    await messages(req, res);
    return;
  }
  sendError(res, url.pathname === '/v1/messages' ? 'anthropic' : 'openai', 404, 'not_found', `no route ${req.method ?? ''} ${url.pathname}`);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve());
  });
}

async function register(port: number): Promise<void> {
  const res = await fetch(`${ENV_URL}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocol_version: PROTOCOL_VERSION, port, catalog }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`POST ${ENV_URL}/register answered HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const reply: unknown = await res.json();
  if (isRecord(reply) && typeof reply.requests === 'number') log(`registered: the workload holds ${reply.requests} requests`);
}

/** Poll GET /work every 100 ms; exit 0 the moment it says done. */
function poll(server: Server): void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        const res = await fetch(`${ENV_URL}/work`, { signal: AbortSignal.timeout(2000) });
        if (res.status !== 200) return;
        const work: unknown = await res.json();
        if (isRecord(work) && work.done === true) {
          clearInterval(timer);
          server.close();
          process.exit(0);
        }
      } catch {
        // The env is not reachable yet: try again on the next tick.
      } finally {
        inFlight = false;
      }
    })();
  }, POLL_INTERVAL_MS);
}

async function start(): Promise<void> {
  if (brief.error !== null) log(brief.error);
  if (process.argv.includes('--list')) {
    const text = `${JSON.stringify(catalog)}\n`;
    await new Promise<void>((resolve) => process.stdout.write(text, () => resolve()));
    process.exit(0);
  }
  if (ENV_URL === '') throw new Error('MAKEFUN_ENV_URL is not set');
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log((err as Error).stack ?? String(err));
      if (!res.headersSent) {
        sendError(res, req.url?.startsWith('/v1/messages') === true ? 'anthropic' : 'openai', 500, 'internal_error', 'the server failed to answer');
      }
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  const port = address.port;
  if (port === 8080) throw new Error('the OS picked 8080, which the env owns on one layout: restart the trial');
  log(`listening on 0.0.0.0:${port} with ${catalog.providers.length} providers and ${servedModels().length} free models`);
  await register(port);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  poll(server);
}

try {
  await start();
} catch (err) {
  log((err as Error).stack ?? String(err));
  process.exit(1);
}
