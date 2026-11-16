// The forge's HTTP server: git smart HTTP, REST v3, GraphQL v4 and MCP,
// all over one in-memory store. Every REST reply is application/json with a
// non-empty X-GitHub-Request-Id; errors carry a string message.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { handleInfoRefs, handleReceivePack, handleUploadPack } from './git.ts';
import { handleGraphQL } from './graphql.ts';
import { handleMcp } from './mcp.ts';
import {
  gid,
  parseCommit,
  Store,
  trialNowIso,
  VIEWER_EMAIL,
  VIEWER_ID,
  VIEWER_LOGIN,
  VIEWER_NAME,
  type Repo,
} from './store.ts';

const JSON_TYPE = 'application/json; charset=utf-8';
const EXPECTED_TOKEN = process.env.MAKEFUN_SHOP_TOKEN ?? '';

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 64 * 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : `${JSON.stringify(body)}\n`;
  res.writeHead(status, { 'content-type': JSON_TYPE, 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

function sendBuffer(res: ServerResponse, status: number, contentType: string, body: Buffer): void {
  res.writeHead(status, { 'content-type': contentType, 'content-length': body.length });
  res.end(body);
}

function pathOf(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  // Absolute-form (a proxy-style full URL): fall back to URL parsing.
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      return new URL(raw).pathname;
    } catch {
      return '/';
    }
  }
  const q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q);
  return path === '' ? '/' : path;
}

/**
 * The request's query string, parsed lazily: most requests (the read and
 * write workloads' issue calls, the git posts) carry no query at all, so
 * building URLSearchParams for every request is wasted work. The parsed
 * form is cached on the holder, so a request that reads it twice parses once.
 */
interface QueryHolder {
  readonly search: string;
  parsed: URLSearchParams | null;
}

function queryHolderOf(req: IncomingMessage): QueryHolder {
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  return { search: q < 0 ? '' : raw.slice(q + 1), parsed: null };
}

function queryOf(holder: QueryHolder): URLSearchParams {
  if (holder.parsed === null) holder.parsed = new URLSearchParams(holder.search);
  return holder.parsed;
}

function segmentsOf(path: string): string[] {
  const out: string[] = [];
  for (const s of path.split('/')) {
    if (s === '') continue;
    // Most segments carry no escape: skip decodeURIComponent unless one does.
    if (!s.includes('%')) {
      out.push(s);
      continue;
    }
    try {
      out.push(decodeURIComponent(s));
    } catch {
      out.push(s);
    }
  }
  return out;
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token === '' ? null : token;
}

function authorized(req: IncomingMessage): boolean {
  const token = bearerToken(req);
  if (token === null) return false;
  if (EXPECTED_TOKEN !== '' && token !== EXPECTED_TOKEN) return false;
  return true;
}

function parseIdent(line: string): { name: string; email: string; date: string } {
  // Ident lines look like "ada iversen <ada@example.invalid> 1735689600 +0000".
  const match = /^(.*?) <(.*?)> (\d+) ([+-]\d{4})$/.exec(line);
  if (match === null) return { name: line, email: '', date: trialNowIso() };
  const epoch = Number(match[3]);
  const date = Number.isFinite(epoch) ? new Date(epoch * 1000).toISOString() : trialNowIso();
  return { name: match[1] ?? '', email: match[2] ?? '', date };
}

function b64encode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function b64decode(text: string): string {
  return Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
}

/** Parse a JSON request body; null when the body is empty. */
function parseJsonBody(body: Buffer): { ok: true; value: Record<string, unknown> | unknown[] | null } | { ok: false } {
  if (body.length === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(body.toString('utf8')) as unknown };
  } catch {
    return { ok: false };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pageParams(query: URLSearchParams): { perPage: number; page: number } {
  const perPageRaw = Number.parseInt(query.get('per_page') ?? '30', 10);
  const pageRaw = Number.parseInt(query.get('page') ?? '1', 10);
  return {
    perPage: Number.isFinite(perPageRaw) ? Math.min(100, Math.max(1, perPageRaw)) : 30,
    page: Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1,
  };
}

/** Slice a list into a page and build the Link header (next/last). */
function paginate<T>(
  items: readonly T[],
  queryHolder: QueryHolder,
  req: IncomingMessage,
  path: string,
): { page: T[]; link: string | null } {
  const query = queryOf(queryHolder);
  const { perPage, page } = pageParams(query);
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const start = (page - 1) * perPage;
  const pageItems = items.slice(start, start + perPage);
  if (page >= totalPages) return { page: pageItems, link: null };
  const build = (p: number): string => {
    const params = new URLSearchParams(query);
    params.set('page', String(p));
    params.set('per_page', String(perPage));
    const host = req.headers.host ?? 'localhost';
    return `http://${host}${path}?${params.toString()}`;
  };
  return { page: pageItems, link: `<${build(page + 1)}>; rel="next", <${build(totalPages)}>; rel="last"` };
}

// ---------------------------------------------------------------- REST

class Rest {
  private readonly store: Store;
  private readonly req: IncomingMessage;
  private readonly res: ServerResponse;

  constructor(store: Store, req: IncomingMessage, res: ServerResponse) {
    this.store = store;
    this.req = req;
    this.res = res;
  }

  private requestId(): string {
    return this.store.nextRequestId();
  }

  json(status: number, body: unknown, extra: Record<string, string> = {}): void {
    sendJson(this.res, status, body, { 'x-github-request-id': this.requestId(), ...extra });
  }

  /** Answer with a pre-serialised JSON string (with its trailing newline). */
  jsonRaw(status: number, text: string, extra: Record<string, string> = {}): void {
    this.res.writeHead(status, {
      'content-type': JSON_TYPE,
      'content-length': Buffer.byteLength(text),
      'x-github-request-id': this.requestId(),
      ...extra,
    });
    this.res.end(text);
  }

  /** Answer with a status and no body (e.g. 204), keeping the request id. */
  noContent(status: number): void {
    this.res.writeHead(status, { 'x-github-request-id': this.requestId(), 'content-length': 0 });
    this.res.end();
  }

  error(status: number, message: string): void {
    this.json(status, { message });
  }

  notFound(message = 'Not Found'): void {
    this.error(404, message);
  }

  /** The repository for /repos/{owner}/{name}..., or null after answering 404. */
  repo(owner: string, name: string): Repo | null {
    const repo = this.store.getRepo(owner, name);
    if (repo === null) {
      this.notFound('Not Found');
      return null;
    }
    return repo;
  }

  /** Resolve a ref name or commit oid to a commit oid, or null. */
  resolveRef(repo: Repo, ref: string | null): string | null {
    if (ref === null || ref === '') return repo.refs.get(`refs/heads/${repo.defaultBranch}`) ?? null;
    const branch = repo.refs.get(`refs/heads/${ref}`);
    if (branch !== undefined) return branch;
    const object = repo.objects.get(ref);
    if (object !== undefined && object.type === 'commit') return ref;
    return null;
  }

  /** Locate a file or directory inside a commit's tree. */
  lookupPath(
    repo: Repo,
    commitOid: string,
    path: string,
  ): { kind: 'file'; oid: string; data: Buffer } | { kind: 'dir'; entries: Array<{ name: string; path: string; oid: string; type: 'file' | 'dir' }> } | null {
    const segments = path === '' ? [] : path.split('/').filter((s) => s !== '');
    const commit = this.store.commitOf(repo, commitOid);
    if (commit === null) return null;
    let treeOid = commit.tree;
    for (let i = 0; i < segments.length; i += 1) {
      const tree = repo.objects.get(treeOid);
      if (tree === undefined || tree.type !== 'tree') return null;
      let found: { mode: string; name: string; oid: string } | undefined;
      for (const entry of tree.data.length > 0 ? parseTreeEntries(tree.data) : []) {
        if (entry.name === segments[i]) {
          found = entry;
          break;
        }
      }
      if (found === undefined) return null;
      const last = i === segments.length - 1;
      if (found.mode === '40000') {
        if (last) {
          const dirTree = repo.objects.get(found.oid);
          if (dirTree === undefined || dirTree.type !== 'tree') return null;
          const entries = parseTreeEntries(dirTree.data).map((entry) => ({
            name: entry.name,
            path: `${path}/${entry.name}`,
            oid: entry.oid,
            type: (entry.mode === '40000' ? 'dir' : 'file') as 'file' | 'dir',
          }));
          return { kind: 'dir', entries };
        }
        treeOid = found.oid;
      } else {
        if (!last) return null;
        const blob = repo.objects.get(found.oid);
        if (blob === undefined) return null;
        return { kind: 'file', oid: found.oid, data: blob.data };
      }
    }
    // The root directory itself.
    const root = repo.objects.get(treeOid);
    if (root === undefined || root.type !== 'tree') return null;
    const entries = parseTreeEntries(root.data).map((entry) => ({
      name: entry.name,
      path: entry.name,
      oid: entry.oid,
      type: (entry.mode === '40000' ? 'dir' : 'file') as 'file' | 'dir',
    }));
    return { kind: 'dir', entries };
  }
}

function parseTreeEntries(data: Buffer): Array<{ mode: string; name: string; oid: string }> {
  const entries: Array<{ mode: string; name: string; oid: string }> = [];
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const nul = data.indexOf(0x00, space + 1);
    entries.push({
      mode: data.subarray(offset, space).toString('ascii'),
      name: data.subarray(space + 1, nul).toString('utf8'),
      oid: data.subarray(nul + 1, nul + 21).toString('hex'),
    });
    offset = nul + 21;
  }
  return entries;
}

// ---------------------------------------------------------------- the app

export function createApp(): Server {
  const store = new Store();

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const path = pathOf(req);
    const queryHolder = queryHolderOf(req);
    const segments = segmentsOf(path);

    try {
      // Health probe: no auth.
      if (method === 'GET' && path === '/healthz') {
        sendJson(res, 200, { ok: true });
        return;
      }

      // Git smart HTTP: /{owner}/{repo}.git/...
      if (segments.length >= 2 && segments[1]!.endsWith('.git')) {
        const owner = segments[0]!;
        const repoName = segments[1]!.slice(0, -'.git'.length);
        const repo = store.getRepo(owner, repoName);
        const sub = segments.slice(2).join('/');
        const gitProtocol = req.headers['git-protocol'];
        if (method === 'GET' && sub === 'info/refs') {
          const service = queryOf(queryHolder).get('service') ?? '';
          const answer = handleInfoRefs(store, repo, service, gitProtocol);
          sendBuffer(res, answer.status, answer.contentType, answer.body);
          return;
        }
        if (method === 'POST' && sub === 'git-upload-pack') {
          const body = await readBody(req);
          const answer = handleUploadPack(store, repo, body, gitProtocol);
          sendBuffer(res, answer.status, answer.contentType, answer.body);
          return;
        }
        if (method === 'POST' && sub === 'git-receive-pack') {
          const body = await readBody(req);
          const answer = handleReceivePack(store, repo, body);
          sendBuffer(res, answer.status, answer.contentType, answer.body);
          return;
        }
        sendJson(res, 404, { message: 'Not Found' });
        return;
      }

      // GraphQL v4.
      if (path === '/api/graphql') {
        if (method !== 'POST') {
          sendJson(res, 405, { message: 'Method Not Allowed' });
          return;
        }
        if (!authorized(req)) {
          sendJson(res, 401, { message: 'Unauthorized' });
          return;
        }
        const body = await readBody(req);
        const parsed = parseJsonBody(body);
        if (!parsed.ok) {
          sendJson(res, 400, { data: null, errors: [{ message: 'The request body is not valid JSON.' }] });
          return;
        }
        const answer = handleGraphQL(store, parsed.value);
        sendJson(res, answer.status, answer.body);
        return;
      }

      // MCP.
      if (path === '/mcp') {
        if (method === 'DELETE') {
          sendJson(res, 200, {});
          return;
        }
        if (method !== 'POST') {
          sendJson(res, 405, { message: 'Method Not Allowed' });
          return;
        }
        if (!authorized(req)) {
          sendJson(res, 401, { message: 'Unauthorized' });
          return;
        }
        const body = await readBody(req);
        const answer = handleMcp(store, body);
        if (answer.body === '') {
          res.writeHead(answer.status, { 'content-length': 0 });
          res.end();
          return;
        }
        const headers: Record<string, string> = {};
        if (answer.sessionId !== undefined) headers['mcp-session-id'] = answer.sessionId;
        sendJson(res, answer.status, answer.body, headers);
        return;
      }

      // REST v3: everything under /api/v3 needs the bearer token.
      if (segments[0] === 'api' && segments[1] === 'v3') {
        if (!authorized(req)) {
          sendJson(res, 401, { message: 'Unauthorized' }, { 'x-github-request-id': store.nextRequestId() });
          return;
        }
        const rest = new Rest(store, req, res);
        const api = segments.slice(2);
        const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);
        const parsed = parseJsonBody(body);
        if (!parsed.ok) {
          rest.error(400, 'Problems parsing JSON');
          return;
        }
        const input = asRecord(parsed.value);
        await handleRest(rest, store, method, api, queryHolder, input, req, path);
        return;
      }

      sendJson(res, 404, { message: 'Not Found' });
    } catch (err) {
      // A handler must never take the server down with it.
      try {
        if (!res.headersSent) sendJson(res, 500, { message: err instanceof Error ? err.message : 'Internal Server Error' });
        else res.end();
      } catch {
        // The socket is already gone.
      }
    }
  });
}

// ---------------------------------------------------------------- REST routes

async function handleRest(
  rest: Rest,
  store: Store,
  method: string,
  api: string[],
  queryHolder: QueryHolder,
  input: Record<string, unknown>,
  req: IncomingMessage,
  path: string,
): Promise<void> {
  // API root.
  if (api.length === 0) {
    if (method === 'GET') {
      rest.json(200, { current_user_url: '/api/v3/user', rate_limit_url: '/api/v3/rate_limit' }, { 'x-oauth-scopes': 'repo, read:org' });
      return;
    }
    rest.notFound();
    return;
  }

  if (api[0] === 'meta' && api.length === 1) {
    if (method === 'GET') {
      rest.json(200, { installed_version: '1.0.0', version: '1.0.0' });
      return;
    }
    rest.notFound();
    return;
  }

  if (api[0] === 'user' && api.length === 1) {
    if (method === 'GET') {
      rest.json(200, { login: VIEWER_LOGIN, id: VIEWER_ID, name: VIEWER_NAME, email: VIEWER_EMAIL, type: 'User' });
      return;
    }
    rest.notFound();
    return;
  }

  if (api[0] === 'user' && api[1] === 'repos') {
    if (method === 'GET') {
      const repos = store.reposByOwner.get(VIEWER_LOGIN) ?? [];
      const { page, link } = paginate(repos, queryHolder, req, path);
      const extra: Record<string, string> = {};
      if (link !== null) extra.link = link;
      rest.json(200, page.map((repo) => store.repoJson(repo)), extra);
      return;
    }
    if (method === 'POST') {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (name === '') {
        rest.error(422, 'Repository name is required');
        return;
      }
      const repo = store.createRepo(
        name,
        typeof input.description === 'string' ? input.description : '',
        input.private === true,
      );
      if (repo === null) {
        rest.error(422, `Repository ${VIEWER_LOGIN}/${name} already exists`);
        return;
      }
      rest.json(201, store.repoJson(repo));
      return;
    }
    rest.notFound();
    return;
  }

  if (api[0] === 'repos' && api.length >= 3) {
    const owner = api[1]!;
    const repoName = api[2]!;
    const repo = rest.repo(owner, repoName);
    if (repo === null) return;
    const tail = api.slice(3);

    // GET/PATCH/DELETE /repos/{o}/{r}
    if (tail.length === 0) {
      if (method === 'GET') {
        rest.json(200, store.repoJson(repo));
        return;
      }
      if (method === 'PATCH') {
        if (typeof input.description === 'string') repo.description = input.description;
        if (typeof input.private === 'boolean') repo.private = input.private;
        repo.updatedAt = trialNowIso();
        rest.json(200, store.repoJson(repo));
        return;
      }
      if (method === 'DELETE') {
        store.deleteRepo(repo);
        rest.noContent(204);
        return;
      }
      rest.notFound();
      return;
    }

    // Branches.
    if (tail[0] === 'branches') {
      if (tail.length === 1 && method === 'GET') {
        const branches = [...repo.refs.keys()]
          .filter((name) => name.startsWith('refs/heads/'))
          .map((name) => name.slice('refs/heads/'.length))
          .sort()
          .map((name) => ({ name, commit: { sha: repo.refs.get(`refs/heads/${name}`) ?? '' }, protected: false }));
        rest.json(200, branches);
        return;
      }
      if (tail.length === 2 && method === 'GET') {
        const sha = repo.refs.get(`refs/heads/${tail[1]}`);
        if (sha === undefined) {
          rest.notFound('Branch not found');
          return;
        }
        rest.json(200, { name: tail[1], commit: { sha }, protected: false });
        return;
      }
      rest.notFound();
      return;
    }

    // Commits.
    if (tail[0] === 'commits' && tail.length === 1 && method === 'GET') {
      const tip = rest.resolveRef(repo, queryOf(queryHolder).get('sha'));
      if (tip === null) {
        rest.json(200, []);
        return;
      }
      const commits = store.commitsFrom(repo, [tip]);
      const { page } = paginate(commits, queryHolder, req, path);
      rest.json(
        200,
        page.map((sha) => {
          const commit = parseCommit(repo.objects.get(sha)!.data);
          return {
            sha,
            commit: {
              message: commit.message,
              author: parseIdent(commit.author),
              committer: parseIdent(commit.committer),
            },
            author: { login: VIEWER_LOGIN },
            committer: { login: VIEWER_LOGIN },
            parents: commit.parents.map((p) => ({ sha: p })),
          };
        }),
      );
      return;
    }

    // Git refs.
    if (tail[0] === 'git' && tail[1] === 'refs') {
      if (method === 'POST' && tail.length === 2) {
        const ref = typeof input.ref === 'string' ? input.ref : '';
        const sha = typeof input.sha === 'string' ? input.sha : '';
        if (!ref.startsWith('refs/') || sha === '') {
          rest.error(422, 'Invalid ref or sha');
          return;
        }
        if (repo.refs.has(ref)) {
          rest.error(422, `Reference ${ref} already exists`);
          return;
        }
        const object = repo.objects.get(sha);
        if (object === undefined || object.type !== 'commit') {
          rest.error(422, 'Object does not exist');
          return;
        }
        repo.refs.set(ref, sha);
        rest.json(201, { ref, object: { sha, type: 'commit' } });
        return;
      }
      if (method === 'GET' && tail.length === 2) {
        const refs = [...repo.refs.entries()].map(([ref, sha]) => ({ ref, object: { sha, type: 'commit' } }));
        rest.json(200, refs);
        return;
      }
      if (method === 'GET' && tail.length >= 3) {
        const refName = `refs/${tail.slice(2).join('/')}`;
        const sha = repo.refs.get(refName);
        if (sha === undefined) {
          rest.notFound('Reference not found');
          return;
        }
        rest.json(200, { ref: refName, object: { sha, type: 'commit' } });
        return;
      }
      rest.notFound();
      return;
    }

    // Contents.
    if (tail[0] === 'contents') {
      const contentPath = tail.slice(1).join('/');
      if (method === 'GET') {
        const tip = rest.resolveRef(repo, queryOf(queryHolder).get('ref'));
        if (tip === null) {
          rest.notFound('Not Found');
          return;
        }
        const found = rest.lookupPath(repo, tip, contentPath);
        if (found === null) {
          rest.notFound('Not Found');
          return;
        }
        if (found.kind === 'file') {
          rest.json(200, {
            type: 'file',
            encoding: 'base64',
            size: found.data.length,
            name: contentPath.split('/').pop() ?? contentPath,
            path: contentPath,
            content: found.data.toString('base64'),
            sha: found.oid,
          });
          return;
        }
        rest.json(
          200,
          found.entries.map((entry) => ({ type: entry.type, name: entry.name, path: entry.path, sha: entry.oid })),
        );
        return;
      }
      if (method === 'PUT') {
        const branch = typeof input.branch === 'string' && input.branch !== '' ? input.branch : repo.defaultBranch;
        const message = typeof input.message === 'string' ? input.message : `Update ${contentPath}`;
        const contentB64 = typeof input.content === 'string' ? input.content : '';
        const data = Buffer.from(contentB64.replace(/\s+/g, ''), 'base64');
        const tip = repo.refs.get(`refs/heads/${branch}`);
        let exists = false;
        let currentOid: string | null = null;
        if (tip !== undefined) {
          const found = rest.lookupPath(repo, tip, contentPath);
          if (found !== null && found.kind === 'file') {
            exists = true;
            currentOid = found.oid;
          }
        }
        if (exists && typeof input.sha === 'string' && input.sha.toLowerCase() !== (currentOid ?? '').toLowerCase()) {
          rest.error(409, 'sha does not match the current file');
          return;
        }
        const { commitOid, changedBlobOid } = store.contentsCommit(repo, branch, new Map([[contentPath, data]]), message);
        rest.json(exists ? 200 : 201, {
          content: {
            name: contentPath.split('/').pop() ?? contentPath,
            path: contentPath,
            sha: changedBlobOid ?? '',
            size: data.length,
            type: 'file',
            encoding: 'base64',
            content: data.toString('base64'),
          },
          commit: { sha: commitOid },
        });
        return;
      }
      if (method === 'DELETE') {
        const branch = typeof input.branch === 'string' && input.branch !== '' ? input.branch : repo.defaultBranch;
        const tip = repo.refs.get(`refs/heads/${branch}`);
        if (tip === undefined) {
          rest.notFound('Not Found');
          return;
        }
        const found = rest.lookupPath(repo, tip, contentPath);
        if (found === null || found.kind !== 'file') {
          rest.notFound('Not Found');
          return;
        }
        if (typeof input.sha === 'string' && input.sha.toLowerCase() !== found.oid.toLowerCase()) {
          rest.error(409, 'sha does not match the current file');
          return;
        }
        const message = typeof input.message === 'string' ? input.message : `Delete ${contentPath}`;
        const { commitOid } = store.contentsCommit(repo, branch, new Map([[contentPath, null]]), message);
        rest.json(200, { commit: { sha: commitOid } });
        return;
      }
      rest.notFound();
      return;
    }

    // Labels.
    if (tail[0] === 'labels') {
      if (method === 'POST' && tail.length === 1) {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (name === '') {
          rest.error(422, 'Label name is required');
          return;
        }
        const existing = repo.labels.get(name);
        if (existing !== undefined) {
          rest.json(201, { id: existing.id, name: existing.name, color: existing.color, description: existing.description });
          return;
        }
        const label = {
          id: repo.labelSeq++,
          name,
          color: typeof input.color === 'string' ? input.color : 'ededed',
          description: typeof input.description === 'string' ? input.description : '',
        };
        repo.labels.set(name, label);
        rest.json(201, { id: label.id, name: label.name, color: label.color, description: label.description });
        return;
      }
      if (method === 'GET' && tail.length === 1) {
        rest.json(200, [...repo.labels.values()].map((label) => ({ id: label.id, name: label.name, color: label.color, description: label.description })));
        return;
      }
      rest.notFound();
      return;
    }

    // Issues.
    if (tail[0] === 'issues') {
      if (tail.length === 1) {
        if (method === 'POST') {
          const title = typeof input.title === 'string' ? input.title : '';
          if (title === '') {
            rest.error(422, 'Issue title is required');
            return;
          }
          const rawLabels = Array.isArray(input.labels) ? input.labels : [];
          const labels: string[] = [];
          for (const entry of rawLabels) {
            const name = typeof entry === 'string' ? entry : typeof entry === 'object' && entry !== null ? String((entry as Record<string, unknown>).name ?? '') : '';
            if (name === '') continue;
            if (!repo.labels.has(name)) {
              rest.error(422, `Label "${name}" does not exist`);
              return;
            }
            labels.push(name);
          }
          const issue = store.createIssue(repo, title, typeof input.body === 'string' ? input.body : '', labels);
          rest.json(201, store.issueJson(repo, issue));
          return;
        }
        if (method === 'GET') {
          const state = (queryOf(queryHolder).get('state') ?? 'open').toLowerCase();
          let list = [...repo.issues];
          if (state !== 'all') list = list.filter((issue) => issue.state === state);
          const sort = queryOf(queryHolder).get('sort') ?? 'created';
          const direction = (queryOf(queryHolder).get('direction') ?? 'desc').toLowerCase();
          if (sort === 'created') {
            list.sort((a, b) => (direction === 'asc' ? a.number - b.number : b.number - a.number));
          }
          const { page, link } = paginate(list, queryHolder, req, path);
          const extra: Record<string, string> = {};
          if (link !== null) extra.link = link;
          rest.json(200, page.map((issue) => store.issueJson(repo, issue)), extra);
          return;
        }
        rest.notFound();
        return;
      }
      const number = Number(tail[1]);
      if (!Number.isInteger(number)) {
        rest.notFound();
        return;
      }
      if (tail.length === 2) {
        const issue = repo.issuesByNumber.get(number);
        if (issue === undefined) {
          rest.notFound('Issue not found');
          return;
        }
        if (method === 'GET') {
          rest.jsonRaw(200, store.issueJsonString(repo, issue));
          return;
        }
        if (method === 'PATCH') {
          if (typeof input.state === 'string' && (input.state === 'open' || input.state === 'closed')) issue.state = input.state;
          if (typeof input.title === 'string') issue.title = input.title;
          if (typeof input.body === 'string') issue.body = input.body;
          issue.updatedAt = trialNowIso();
          issue.jsonCache = null; // title, body, state or updatedAt changed
          rest.json(200, store.issueJson(repo, issue));
          return;
        }
        rest.notFound();
        return;
      }
      if (tail[2] === 'comments') {
        const issue = repo.issuesByNumber.get(number);
        if (issue === undefined) {
          rest.notFound('Issue not found');
          return;
        }
        if (method === 'POST') {
          const body = typeof input.body === 'string' ? input.body : '';
          const comment = store.createComment(issue, body);
          rest.json(201, {
            id: comment.id,
            node_id: gid('IssueComment', repo.id, comment.id),
            body: comment.body,
            user: { login: VIEWER_LOGIN, id: VIEWER_ID, type: 'User' },
            created_at: trialNowIso(),
            updated_at: trialNowIso(),
          });
          return;
        }
        if (method === 'GET') {
          rest.json(
            200,
            issue.comments.map((comment) => ({
              id: comment.id,
              node_id: gid('IssueComment', repo.id, comment.id),
              body: comment.body,
              user: { login: VIEWER_LOGIN, id: VIEWER_ID, type: 'User' },
              created_at: trialNowIso(),
              updated_at: trialNowIso(),
            })),
          );
          return;
        }
        rest.notFound();
        return;
      }
      rest.notFound();
      return;
    }

    // Pull requests.
    if (tail[0] === 'pulls') {
      if (tail.length === 1) {
        if (method === 'POST') {
          const head = typeof input.head === 'string' ? input.head : '';
          const base = typeof input.base === 'string' ? input.base : '';
          if (head === '' || base === '') {
            rest.error(422, 'head and base are required');
            return;
          }
          if (repo.refs.get(`refs/heads/${head}`) === undefined) {
            rest.error(422, `Head branch ${head} does not exist`);
            return;
          }
          if (repo.refs.get(`refs/heads/${base}`) === undefined) {
            rest.error(422, `Base branch ${base} does not exist`);
            return;
          }
          const pull = store.createPull(repo, typeof input.title === 'string' ? input.title : '', typeof input.body === 'string' ? input.body : '', head, base);
          if (pull === null) {
            rest.error(422, 'A pull request is already open for this head and base');
            return;
          }
          rest.json(201, store.pullJson(repo, pull));
          return;
        }
        if (method === 'GET') {
          const state = (queryOf(queryHolder).get('state') ?? 'open').toLowerCase();
          let list = [...repo.pulls];
          if (state !== 'all') list = list.filter((pull) => pull.state === state);
          list.sort((a, b) => b.number - a.number);
          const { page, link } = paginate(list, queryHolder, req, path);
          const extra: Record<string, string> = {};
          if (link !== null) extra.link = link;
          rest.json(200, page.map((pull) => store.pullJson(repo, pull)), extra);
          return;
        }
        rest.notFound();
        return;
      }
      const number = Number(tail[1]);
      if (!Number.isInteger(number)) {
        rest.notFound();
        return;
      }
      const pull = repo.pullsByNumber.get(number);
      if (tail.length === 2) {
        if (pull === undefined) {
          rest.notFound('Pull request not found');
          return;
        }
        if (method === 'GET') {
          rest.json(200, store.pullJson(repo, pull));
          return;
        }
        rest.notFound();
        return;
      }
      if (tail[2] === 'files' && method === 'GET') {
        if (pull === undefined) {
          rest.notFound('Pull request not found');
          return;
        }
        const headTip = store.headTip(repo, pull) ?? pull.baseShaAtCreation;
        const files = store.diffFiles(repo, pull.baseShaAtCreation, headTip);
        rest.json(
          200,
          files.map((file) => ({
            filename: file.path,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
          })),
        );
        return;
      }
      if (tail[2] === 'commits' && method === 'GET') {
        if (pull === undefined) {
          rest.notFound('Pull request not found');
          return;
        }
        const headTip = store.headTip(repo, pull);
        const baseTip = store.baseTip(repo, pull) ?? pull.baseShaAtCreation;
        const headCommits = headTip === undefined ? [] : store.commitsFrom(repo, [headTip]);
        const baseSet = new Set(store.commitsFrom(repo, [baseTip]));
        const only = headCommits.filter((sha) => !baseSet.has(sha));
        rest.json(
          200,
          only.map((sha) => {
            const commit = parseCommit(repo.objects.get(sha)!.data);
            return { sha, commit: { message: commit.message } };
          }),
        );
        return;
      }
      if (tail[2] === 'merge' && method === 'PUT') {
        if (pull === undefined) {
          rest.notFound('Pull request not found');
          return;
        }
        if (pull.state !== 'open') {
          rest.error(405, 'Pull request is already closed');
          return;
        }
        if (store.mergeConflicts(repo, pull)) {
          rest.error(405, 'Pull request cannot be merged: it conflicts with the base branch');
          return;
        }
        const sha = store.squashMerge(repo, pull);
        if (sha === null) {
          rest.error(405, 'Pull request cannot be merged');
          return;
        }
        rest.json(200, { sha, merged: true, message: 'Pull request successfully merged' });
        return;
      }
      rest.notFound();
      return;
    }

    rest.notFound();
    return;
  }

  rest.notFound();
}
