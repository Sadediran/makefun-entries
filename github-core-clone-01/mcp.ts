// MCP over Streamable HTTP (JSON-RPC 2.0): the 2026-07-28 revision via
// server/discover, plus the legacy initialize handshake. Six tools act on
// the same store as REST, so a repository or issue created here reads back
// over /api/v3 unchanged.

import {
  trialNowIso,
  VIEWER_LOGIN,
  type Repo,
  type Store,
} from './store.ts';

export const MCP_SERVER_NAME = 'github-core-clone';
export const MCP_SERVER_VERSION = '1.0.0';
export const SUPPORTED_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'create_repo',
    description: 'Create a repository owned by the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        private: { type: 'boolean', description: 'Whether the repository is private' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_repo',
    description: 'Get a repository by owner and name.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_issue',
    description: 'Create an issue in a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body' },
      },
      required: ['owner', 'repo', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_issues',
    description: 'List issues in a repository, optionally filtered by state.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', description: 'Issue state: open, closed or all' },
      },
      required: ['owner', 'repo'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_pull_request',
    description: 'Open a pull request from a head branch into a base branch.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Pull request title' },
        body: { type: 'string', description: 'Pull request body' },
        head: { type: 'string', description: 'Head branch name' },
        base: { type: 'string', description: 'Base branch name' },
      },
      required: ['owner', 'repo', 'title', 'head', 'base'],
      additionalProperties: false,
    },
  },
  {
    name: 'merge_pull_request',
    description: 'Squash-merge a pull request onto its base branch.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
        pull_number: { type: 'integer', description: 'Pull request number' },
      },
      required: ['owner', 'repo', 'pull_number'],
      additionalProperties: false,
    },
  },
];

const REQUIRED_ARGS: Record<string, string[]> = {
  create_repo: ['name'],
  get_repo: ['owner', 'repo'],
  create_issue: ['owner', 'repo', 'title'],
  list_issues: ['owner', 'repo'],
  create_pull_request: ['owner', 'repo', 'title', 'head', 'base'],
  merge_pull_request: ['owner', 'repo', 'pull_number'],
};

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function okResult(value: unknown): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { content: [{ type: 'text', text }], structuredContent: value };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function repoOf(store: Store, owner: unknown, repoName: unknown): Repo | null {
  if (typeof owner !== 'string' || typeof repoName !== 'string') return null;
  return store.getRepo(owner, repoName);
}

function callTool(store: Store, name: string, args: Record<string, unknown>): { result: ToolResult } | { rpcError: { code: number; message: string } } {
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) {
    return { rpcError: { code: -32601, message: `Unknown tool: ${name}` } };
  }
  const required = REQUIRED_ARGS[name] ?? [];
  const missing = required.filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
  if (missing.length > 0) {
    return { rpcError: { code: -32602, message: `Missing required argument(s): ${missing.join(', ')}` } };
  }
  switch (name) {
    case 'create_repo': {
      const repoName = String(args.name);
      const repo = store.createRepo(repoName, typeof args.description === 'string' ? args.description : '', args.private === true);
      if (repo === null) return { result: errorResult(`Repository ${VIEWER_LOGIN}/${repoName} already exists.`) };
      return { result: okResult(store.repoJson(repo)) };
    }
    case 'get_repo': {
      const repo = repoOf(store, args.owner, args.repo);
      if (repo === null) return { result: errorResult(`Repository ${String(args.owner)}/${String(args.repo)} not found.`) };
      return { result: okResult(store.repoJson(repo)) };
    }
    case 'create_issue': {
      const repo = repoOf(store, args.owner, args.repo);
      if (repo === null) return { result: errorResult(`Repository ${String(args.owner)}/${String(args.repo)} not found.`) };
      const issue = store.createIssue(repo, String(args.title), typeof args.body === 'string' ? args.body : '', []);
      return { result: okResult(store.issueJson(repo, issue)) };
    }
    case 'list_issues': {
      const repo = repoOf(store, args.owner, args.repo);
      if (repo === null) return { result: errorResult(`Repository ${String(args.owner)}/${String(args.repo)} not found.`) };
      const state = typeof args.state === 'string' ? args.state.toLowerCase() : 'open';
      const list = repo.issues.filter((issue) => state === 'all' || issue.state === state);
      return { result: okResult(list.map((issue) => store.issueJson(repo, issue))) };
    }
    case 'create_pull_request': {
      const repo = repoOf(store, args.owner, args.repo);
      if (repo === null) return { result: errorResult(`Repository ${String(args.owner)}/${String(args.repo)} not found.`) };
      const pull = store.createPull(
        repo,
        String(args.title),
        typeof args.body === 'string' ? args.body : '',
        String(args.head),
        String(args.base),
      );
      if (pull === null) {
        return { result: errorResult('Could not create pull request: the head branch does not exist or a pull request is already open.') };
      }
      return { result: okResult(store.pullJson(repo, pull)) };
    }
    case 'merge_pull_request': {
      const repo = repoOf(store, args.owner, args.repo);
      if (repo === null) return { result: errorResult(`Repository ${String(args.owner)}/${String(args.repo)} not found.`) };
      const number = typeof args.pull_number === 'number' ? args.pull_number : Number(args.pull_number);
      const pull = repo.pullsByNumber.get(number);
      if (pull === undefined) return { result: errorResult(`Pull request #${number} not found.`) };
      if (pull.state !== 'open') return { result: errorResult(`Pull request #${number} is already ${pull.state}.`) };
      const sha = store.squashMerge(repo, pull);
      if (sha === null) return { result: errorResult(`Pull request #${number} conflicts with the base branch and cannot be merged.`) };
      return { result: okResult({ number: pull.number, merged: true, sha, state: 'closed', message: 'Pull request successfully merged' }) };
    }
    default:
      return { rpcError: { code: -32601, message: `Unknown tool: ${name}` } };
  }
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: string | number | null, code: number, message: string, data?: unknown): Record<string, unknown> {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

/**
 * Handle one POST /mcp body. `rawBody` is the exact request bytes: a body
 * that is not JSON answers HTTP 400 with JSON-RPC -32700.
 */
export function handleMcp(store: Store, rawBody: Buffer): { status: number; body: unknown; sessionId?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: rpcError(null, -32700, 'Parse error: the request body is not valid JSON.') };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 400, body: rpcError(null, -32600, 'Invalid Request: expected a JSON-RPC object.') };
  }
  const request = parsed as JsonRpcRequest;
  const id = request.id === undefined ? null : request.id;
  const method = request.method ?? '';
  const params = (request.params ?? {}) as Record<string, unknown>;

  // Notifications carry no id and get no JSON-RPC answer.
  if (id === null && method.startsWith('notifications/')) {
    return { status: 202, body: '' };
  }

  if (method === 'server/discover') {
    return {
      status: 200,
      body: rpcResult(id, {
        supportedVersions: [...SUPPORTED_VERSIONS],
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        capabilities: { tools: {} },
        instructions: 'A GitHub-compatible git forge: repositories, issues, pull requests, git smart HTTP, GraphQL and MCP tools.',
      }),
    };
  }
  if (method === 'initialize') {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
    const negotiated = SUPPORTED_VERSIONS.includes(requested) ? requested : '2025-11-25';
    return {
      status: 200,
      body: rpcResult(id, {
        protocolVersion: negotiated,
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      }),
      sessionId: 'session-1',
    };
  }
  if (method === 'ping') {
    return { status: 200, body: rpcResult(id, {}) };
  }
  if (method === 'tools/list') {
    // A fixed array, serialized the same way every time.
    return { status: 200, body: rpcResult(id, { tools: TOOLS }) };
  }
  if (method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name : '';
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const outcome = callTool(store, toolName, args);
    if ('rpcError' in outcome) {
      return { status: 200, body: rpcError(id, outcome.rpcError.code, outcome.rpcError.message) };
    }
    return { status: 200, body: rpcResult(id, outcome.result) };
  }
  if (method.startsWith('notifications/')) {
    return { status: 202, body: '' };
  }
  return { status: 200, body: rpcError(id, -32601, `Method not found: ${method}`) };
}
