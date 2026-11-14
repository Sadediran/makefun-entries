// GraphQL v4: a small recursive-descent parser for the documents gh and
// github-mcp-server actually send, plus an executor over the store. Supports
// variables, aliases, inline fragments, named fragments, input objects,
// enum literals, nulls, __type/__schema introspection and batched bodies
// (a JSON array of operation documents answers an array, in order).

import {
  gid,
  trialNowIso,
  ungid,
  VIEWER_ID,
  VIEWER_LOGIN,
  type Issue,
  type Pull,
  type Repo,
  type Store,
} from './store.ts';

// ---------------------------------------------------------------- parser

type ValueNode =
  | { kind: 'variable'; name: string }
  | { kind: 'string'; value: string }
  | { kind: 'int'; value: number }
  | { kind: 'float'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'enum'; value: string }
  | { kind: 'list'; values: ValueNode[] }
  | { kind: 'object'; fields: Array<{ name: string; value: ValueNode }> };

export interface Selection {
  alias?: string;
  name: string;
  args: Array<{ name: string; value: ValueNode }>;
  selections?: Selection[];
  /** Inline fragment: the type condition, or null for a plain field. */
  fragmentOn?: string;
  /** Named fragment spread. */
  fragmentName?: string;
}

export interface Operation {
  type: 'query' | 'mutation';
  name?: string;
  variables: Record<string, ValueNode | undefined>;
  selections: Selection[];
}

interface Token {
  kind: 'name' | 'string' | 'int' | 'float' | 'punct' | 'ellipsis';
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') {
      i += 1;
      continue;
    }
    if (ch === '#') {
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }
    if (input.startsWith('...', i)) {
      tokens.push({ kind: 'ellipsis', value: '...' });
      i += 3;
      continue;
    }
    if ('{}()[]:!=$@&|'.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch });
      i += 1;
      continue;
    }
    if (ch === '"') {
      let value = '';
      i += 1;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          const esc = input[i + 1]!;
          value += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === 'r' ? '\r' : esc;
          i += 2;
        } else {
          value += input[i]!;
          i += 1;
        }
      }
      i += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (/[0-9-]/.test(ch)) {
      let j = i;
      if (input[j] === '-') j += 1;
      let isFloat = false;
      while (j < input.length && /[0-9.]/.test(input[j]!)) {
        if (input[j] === '.') isFloat = true;
        j += 1;
      }
      tokens.push({ kind: isFloat ? 'float' : 'int', value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j]!)) j += 1;
      tokens.push({ kind: 'name', value: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`unexpected character ${JSON.stringify(ch)} in GraphQL document`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (token === undefined) throw new Error('unexpected end of GraphQL document');
    this.pos += 1;
    return token;
  }

  private expectPunct(value: string): void {
    const token = this.next();
    if (token.kind !== 'punct' || token.value !== value) throw new Error(`expected ${value}, got ${token.value}`);
  }

  private expectName(value?: string): string {
    const token = this.next();
    if (token.kind !== 'name') throw new Error(`expected a name, got ${token.value}`);
    if (value !== undefined && token.value !== value) throw new Error(`expected ${value}, got ${token.value}`);
    return token.value;
  }

  private isPunct(value: string): boolean {
    const token = this.peek();
    return token !== undefined && token.kind === 'punct' && token.value === value;
  }

  parseDocument(): { operations: Operation[]; fragments: Record<string, { on: string; selections: Selection[] }> } {
    const operations: Operation[] = [];
    const fragments: Record<string, { on: string; selections: Selection[] }> = {};
    while (this.pos < this.tokens.length) {
      const token = this.peek()!;
      if (token.kind === 'punct' && token.value === '{') {
        operations.push({ type: 'query', variables: {}, selections: this.parseSelectionSet() });
        continue;
      }
      if (token.kind === 'name' && (token.value === 'query' || token.value === 'mutation')) {
        const type = this.next().value as 'query' | 'mutation';
        let name: string | undefined;
        const next = this.peek();
        if (next !== undefined && next.kind === 'name') name = this.next().value;
        const variables: Record<string, ValueNode | undefined> = {};
        if (this.isPunct('(')) {
          this.next();
          while (!this.isPunct(')')) {
            this.expectPunct('$');
            const varName = this.expectName();
            this.expectPunct(':');
            this.parseType();
            if (this.isPunct('=')) {
              this.next();
              variables[varName] = this.parseValue();
            } else {
              variables[varName] = undefined;
            }
          }
          this.expectPunct(')');
        }
        operations.push({ type, name, variables, selections: this.parseSelectionSet() });
        continue;
      }
      if (token.kind === 'name' && token.value === 'fragment') {
        this.next();
        const fragName = this.expectName();
        this.expectName('on');
        const on = this.expectName();
        fragments[fragName] = { on, selections: this.parseSelectionSet() };
        continue;
      }
      throw new Error(`unexpected token ${token.value} in GraphQL document`);
    }
    return { operations, fragments };
  }

  private parseType(): void {
    if (this.isPunct('[')) {
      this.next();
      this.parseType();
      this.expectPunct(']');
    } else {
      this.expectName();
    }
    if (this.isPunct('!')) this.next();
  }

  parseSelectionSet(): Selection[] {
    this.expectPunct('{');
    const selections: Selection[] = [];
    while (!this.isPunct('}')) {
      selections.push(this.parseSelection());
    }
    this.expectPunct('}');
    return selections;
  }

  private parseSelection(): Selection {
    if (this.peek()?.kind === 'ellipsis') {
      this.next();
      const token = this.peek();
      if (token !== undefined && token.kind === 'name' && token.value === 'on') {
        this.next();
        const on = this.expectName();
        return { name: '', args: [], selections: this.parseSelectionSet(), fragmentOn: on };
      }
      const name = this.expectName();
      return { name: '', args: [], fragmentName: name };
    }
    let name = this.expectName();
    let alias: string | undefined;
    if (this.isPunct(':')) {
      this.next();
      alias = name;
      name = this.expectName();
    }
    const args: Array<{ name: string; value: ValueNode }> = [];
    if (this.isPunct('(')) {
      this.next();
      while (!this.isPunct(')')) {
        const argName = this.expectName();
        this.expectPunct(':');
        args.push({ name: argName, value: this.parseValue() });
      }
      this.expectPunct(')');
    }
    // Directives: parse and ignore (@skip/@include are not sent by the suite).
    while (this.isPunct('@')) {
      this.next();
      this.expectName();
      if (this.isPunct('(')) {
        this.next();
        while (!this.isPunct(')')) {
          this.expectName();
          this.expectPunct(':');
          this.parseValue();
        }
        this.expectPunct(')');
      }
    }
    let selections: Selection[] | undefined;
    if (this.isPunct('{')) selections = this.parseSelectionSet();
    return { alias, name, args, selections };
  }

  parseValue(): ValueNode {
    const token = this.next();
    if (token.kind === 'string') return { kind: 'string', value: token.value };
    if (token.kind === 'int') return { kind: 'int', value: Number.parseInt(token.value, 10) };
    if (token.kind === 'float') return { kind: 'float', value: Number.parseFloat(token.value) };
    if (token.kind === 'punct' && token.value === '$') return { kind: 'variable', name: this.expectName() };
    if (token.kind === 'punct' && token.value === '[') {
      const values: ValueNode[] = [];
      while (!this.isPunct(']')) values.push(this.parseValue());
      this.expectPunct(']');
      return { kind: 'list', values };
    }
    if (token.kind === 'punct' && token.value === '{') {
      const fields: Array<{ name: string; value: ValueNode }> = [];
      while (!this.isPunct('}')) {
        const name = this.expectName();
        this.expectPunct(':');
        fields.push({ name, value: this.parseValue() });
      }
      this.expectPunct('}');
      return { kind: 'object', fields };
    }
    if (token.kind === 'name') {
      if (token.value === 'true') return { kind: 'boolean', value: true };
      if (token.value === 'false') return { kind: 'boolean', value: false };
      if (token.value === 'null') return { kind: 'null' };
      return { kind: 'enum', value: token.value };
    }
    throw new Error(`unexpected value token ${token.value}`);
  }
}

function resolveValue(node: ValueNode, variables: Record<string, unknown>): unknown {
  switch (node.kind) {
    case 'variable':
      return variables[node.name];
    case 'string':
    case 'int':
    case 'float':
    case 'boolean':
      return node.value;
    case 'null':
      return null;
    case 'enum':
      return node.value;
    case 'list':
      return node.values.map((v) => resolveValue(v, variables));
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const field of node.fields) out[field.name] = resolveValue(field.value, variables);
      return out;
    }
  }
}

// ---------------------------------------------------------------- schema

/** Field names each type exposes (validation + introspection). */
const TYPE_FIELDS: Record<string, string[]> = {
  Query: ['viewer', 'repository', 'node', '__type', '__schema'],
  User: ['id', 'login', 'name', 'email'],
  Repository: [
    'id', 'databaseId', 'name', 'nameWithOwner', 'owner', 'defaultBranchRef',
    'viewerPermission', 'hasIssuesEnabled', 'issue', 'issues', 'pullRequests',
    'pullRequest', 'url', 'description', 'private', 'createdAt', 'updatedAt',
  ],
  Ref: ['name', 'prefix'],
  Issue: ['id', 'number', 'title', 'body', 'state', 'url', 'createdAt', 'updatedAt', 'author', 'labels', 'comments'],
  IssueConnection: ['nodes', 'pageInfo', 'totalCount'],
  PageInfo: ['hasNextPage', 'hasPreviousPage', 'startCursor', 'endCursor'],
  PullRequest: [
    'id', 'number', 'title', 'body', 'state', 'merged', 'mergeable',
    'headRefName', 'baseRefName', 'headRef', 'baseRef', 'files', 'url',
    'createdAt', 'mergedAt', 'author',
  ],
  PullRequestConnection: ['nodes', 'pageInfo', 'totalCount'],
  PullRequestChangedFileConnection: ['nodes', 'pageInfo', 'totalCount'],
  PullRequestChangedFile: ['path', 'filename', 'additions', 'deletions', 'changes', 'status'],
  Mutation: ['createIssue', 'closeIssue', 'createPullRequest', 'mergePullRequest', 'addComment'],
  Label: ['id', 'name', 'color', 'description'],
  IssueComment: ['id', 'body', 'author'],
  __Type: ['name', 'kind', 'fields', 'enumValues', 'description'],
  __Field: ['name', 'description', 'args', 'type'],
  __EnumValue: ['name', 'description'],
  __InputValue: ['name', 'description', 'type'],
  __Schema: ['types', 'queryType', 'mutationType', 'description'],
};

const TYPE_KINDS: Record<string, string> = {
  Query: 'OBJECT', User: 'OBJECT', Repository: 'OBJECT', Ref: 'OBJECT',
  Issue: 'OBJECT', IssueConnection: 'OBJECT', PageInfo: 'OBJECT',
  PullRequest: 'OBJECT', PullRequestConnection: 'OBJECT',
  PullRequestChangedFileConnection: 'OBJECT', PullRequestChangedFile: 'OBJECT',
  Mutation: 'OBJECT', Label: 'OBJECT', IssueComment: 'OBJECT',
  __Type: 'OBJECT', __Field: 'OBJECT', __EnumValue: 'OBJECT',
  __InputValue: 'OBJECT', __Schema: 'OBJECT',
  IssueState: 'ENUM', OrderDirection: 'ENUM', IssueOrderField: 'ENUM',
  MergeableState: 'ENUM', PullRequestState: 'ENUM', PullRequestMergeMethod: 'ENUM',
  RepositoryPermission: 'ENUM', SearchType: 'ENUM',
};

const ENUM_VALUES: Record<string, string[]> = {
  SearchType: ['ISSUE', 'PULL_REQUEST', 'REPOSITORY', 'USER', 'DISCUSSION', 'COMMIT'],
  IssueState: ['OPEN', 'CLOSED'],
  OrderDirection: ['ASC', 'DESC'],
  IssueOrderField: ['CREATED_AT', 'UPDATED_AT', 'COMMENTS'],
  MergeableState: ['MERGEABLE', 'CONFLICTING', 'UNKNOWN'],
  PullRequestState: ['OPEN', 'CLOSED', 'MERGED'],
  PullRequestMergeMethod: ['MERGE', 'SQUASH', 'REBASE'],
  RepositoryPermission: ['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE', 'READ'],
};

// ---------------------------------------------------------------- executor

interface Ctx {
  store: Store;
}

type AnyRecord = Record<string, unknown>;

function cursorOf(offset: number): string {
  return Buffer.from(`cursor:${offset}`, 'utf8').toString('base64url');
}

function offsetOf(cursor: unknown): number {
  if (typeof cursor !== 'string' || cursor === '') return 0;
  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    const match = /^cursor:(\d+)$/.exec(text);
    if (match !== null) return Number.parseInt(match[1]!, 10);
  } catch {
    return 0;
  }
  return 0;
}

function repoObject(store: Store, repo: Repo): AnyRecord {
  return { __typename: 'Repository', __repo: repo, id: gid('Repository', repo.id), databaseId: repo.id, name: repo.name };
}

function issueObject(store: Store, repo: Repo, issue: Issue): AnyRecord {
  return { __typename: 'Issue', __repo: repo, __issue: issue, id: gid('Issue', repo.id, issue.number), number: issue.number };
}

function pullObject(store: Store, repo: Repo, pull: Pull): AnyRecord {
  return { __typename: 'PullRequest', __repo: repo, __pull: pull, id: gid('PullRequest', repo.id, pull.number), number: pull.number };
}

function argsOf(selection: Selection, variables: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const arg of selection.args) out[arg.name] = resolveValue(arg.value, variables);
  return out;
}

class Executor {
  private errors: Array<{ message: string }> = [];
  private readonly ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  get errorList(): Array<{ message: string }> {
    return this.errors;
  }

  /** Expand fragment spreads and inline fragments for one selection list. */
  private expand(
    selections: Selection[],
    fragments: Record<string, { on: string; selections: Selection[] }>,
    runtimeType: string,
  ): Selection[] {
    const out: Selection[] = [];
    for (const selection of selections) {
      if (selection.fragmentName !== undefined) {
        const fragment = fragments[selection.fragmentName];
        if (fragment !== undefined) out.push(...this.expand(fragment.selections, fragments, runtimeType));
        continue;
      }
      if (selection.fragmentOn !== undefined) {
        if (selection.fragmentOn === runtimeType || runtimeType === 'Node') {
          out.push(...this.expand(selection.selections ?? [], fragments, runtimeType));
        }
        continue;
      }
      out.push(selection);
    }
    return out;
  }

  executeSelections(
    typeName: string,
    parent: AnyRecord | null,
    selections: Selection[],
    variables: Record<string, unknown>,
    fragments: Record<string, { on: string; selections: Selection[] }>,
  ): AnyRecord | null {
    if (parent === null) return null;
    const runtimeType = (parent.__typename as string | undefined) ?? typeName;
    const expanded = this.expand(selections, fragments, runtimeType);
    const out: AnyRecord = {};
    for (const selection of expanded) {
      const fieldName = selection.name;
      const key = selection.alias ?? fieldName;
      if (fieldName === '__typename') {
        out[key] = runtimeType;
        continue;
      }
      const known = TYPE_FIELDS[runtimeType] ?? TYPE_FIELDS[typeName];
      if (known === undefined || !known.includes(fieldName)) {
        this.errors.push({ message: `Cannot query field "${fieldName}" on type "${runtimeType}".` });
        continue;
      }
      const args = argsOf(selection, variables);
      const value = this.resolveField(runtimeType, parent, fieldName, args);
      if (selection.selections !== undefined && selection.selections.length > 0) {
        out[key] = this.resolveSub(value, selection, variables, fragments);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  private resolveSub(
    value: unknown,
    selection: Selection,
    variables: Record<string, unknown>,
    fragments: Record<string, { on: string; selections: Selection[] }>,
  ): unknown {
    if (value === null || value === undefined) return null;
    const childType = childTypeOf(selection.name);
    if (Array.isArray(value)) {
      return value.map((item) =>
        item !== null && typeof item === 'object'
          ? this.executeSelections(childType, item as AnyRecord, selection.selections!, variables, fragments)
          : item,
      );
    }
    if (typeof value === 'object') {
      return this.executeSelections(childType, value as AnyRecord, selection.selections!, variables, fragments);
    }
    return value;
  }

  private resolveField(typeName: string, parent: AnyRecord, field: string, args: Record<string, unknown>): unknown {
    const store = this.ctx.store;
    switch (typeName) {
      case 'Query': {
        if (field === 'viewer') return { __typename: 'User', login: VIEWER_LOGIN, id: gid('User', VIEWER_ID) };
        if (field === 'repository') {
          const repo = store.getRepo(String(args.owner ?? ''), String(args.name ?? ''));
          return repo === null ? null : repoObject(store, repo);
        }
        if (field === 'node') {
          const decoded = typeof args.id === 'string' ? ungid(args.id) : null;
          if (decoded === null) return null;
          if (decoded.kind === 'Repository') {
            const id = Number(decoded.parts[0]);
            const repo = [...store.repos.values()].find((r) => r.id === id) ?? null;
            return repo === null ? null : repoObject(store, repo);
          }
          if (decoded.kind === 'Issue') {
            const repo = [...store.repos.values()].find((r) => r.id === Number(decoded.parts[0])) ?? null;
            const issue = repo?.issuesByNumber.get(Number(decoded.parts[1]));
            return repo !== null && issue !== undefined ? issueObject(store, repo, issue) : null;
          }
          if (decoded.kind === 'PullRequest') {
            const repo = [...store.repos.values()].find((r) => r.id === Number(decoded.parts[0])) ?? null;
            const pull = repo?.pullsByNumber.get(Number(decoded.parts[1]));
            return repo !== null && pull !== undefined ? pullObject(store, repo, pull) : null;
          }
          return null;
        }
        if (field === '__type') {
          const name = String(args.name ?? '');
          if (!(name in TYPE_FIELDS) && !(name in TYPE_KINDS)) return null;
          return { __typename: '__Type', __typeName: name };
        }
        if (field === '__schema') return { __typename: '__Schema' };
        return null;
      }
      case 'User': {
        if (field === 'login') return parent.login;
        if (field === 'id') return parent.id;
        if (field === 'name') return 'ada iversen';
        if (field === 'email') return 'adaiversen@example.invalid';
        return null;
      }
      case 'Repository': {
        const repo = parent.__repo as Repo;
        if (field === 'id') return parent.id;
        if (field === 'databaseId') return repo.id;
        if (field === 'name') return repo.name;
        if (field === 'nameWithOwner') return `${repo.owner}/${repo.name}`;
        if (field === 'owner') return { __typename: 'User', login: repo.owner, id: gid('User', VIEWER_ID) };
        if (field === 'defaultBranchRef') return { __typename: 'Ref', name: repo.defaultBranch };
        if (field === 'viewerPermission') return 'ADMIN';
        if (field === 'hasIssuesEnabled') return true;
        if (field === 'description') return repo.description;
        if (field === 'private') return repo.private;
        if (field === 'url') return `https://example.invalid/${repo.owner}/${repo.name}`;
        if (field === 'createdAt' || field === 'updatedAt') return repo.createdAt;
        if (field === 'issue') {
          const issue = repo.issuesByNumber.get(Number(args.number));
          return issue === undefined ? null : issueObject(store, repo, issue);
        }
        if (field === 'issues') return this.issueConnection(repo, args);
        if (field === 'pullRequests') return this.pullConnection(repo, args);
        if (field === 'pullRequest') {
          const pull = repo.pullsByNumber.get(Number(args.number));
          return pull === undefined ? null : pullObject(store, repo, pull);
        }
        return null;
      }
      case 'Ref': {
        if (field === 'name') return parent.name;
        if (field === 'prefix') return 'refs/heads/';
        return null;
      }
      case 'Issue': {
        const repo = parent.__repo as Repo;
        const issue = parent.__issue as Issue;
        if (field === 'id') return parent.id;
        if (field === 'number') return issue.number;
        if (field === 'title') return issue.title;
        if (field === 'body') return issue.body;
        if (field === 'state') return issue.state === 'open' ? 'OPEN' : 'CLOSED';
        if (field === 'url') return `https://example.invalid/${repo.owner}/${repo.name}/issues/${issue.number}`;
        if (field === 'createdAt') return issue.createdAt;
        if (field === 'updatedAt') return issue.updatedAt;
        if (field === 'author') return { __typename: 'User', login: VIEWER_LOGIN, id: gid('User', VIEWER_ID) };
        if (field === 'labels') {
          return issue.labels.map((name) => ({ __typename: 'Label', name, color: repo.labels.get(name)?.color ?? 'ededed', description: '' }));
        }
        if (field === 'comments') {
          return {
            __typename: 'IssueConnection',
            __nodes: issue.comments.map((c) => ({ __typename: 'IssueComment', id: gid('IssueComment', repo.id, c.id), body: c.body })),
            __total: issue.comments.length,
          };
        }
        return null;
      }
      case 'IssueConnection':
      case 'PullRequestConnection':
      case 'PullRequestChangedFileConnection': {
        if (field === 'nodes') return (parent.__nodes as unknown[]) ?? [];
        if (field === 'totalCount') return (parent.__total as number) ?? ((parent.__nodes as unknown[]) ?? []).length;
        if (field === 'pageInfo') return parent.__pageInfo ?? { __typename: 'PageInfo', hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null };
        return null;
      }
      case 'PageInfo': {
        if (field === 'hasNextPage') return parent.hasNextPage ?? false;
        if (field === 'hasPreviousPage') return parent.hasPreviousPage ?? false;
        if (field === 'startCursor') return parent.startCursor ?? null;
        if (field === 'endCursor') return parent.endCursor ?? null;
        return null;
      }
      case 'PullRequest': {
        const repo = parent.__repo as Repo;
        const pull = parent.__pull as Pull;
        if (field === 'id') return parent.id;
        if (field === 'number') return pull.number;
        if (field === 'title') return pull.title;
        if (field === 'body') return pull.body;
        if (field === 'state') return pull.merged ? 'MERGED' : pull.state === 'open' ? 'OPEN' : 'CLOSED';
        if (field === 'merged') return pull.merged;
        if (field === 'mergeable') return store.mergeableState(repo, pull);
        if (field === 'headRefName') return pull.headRef;
        if (field === 'baseRefName') return pull.baseRef;
        if (field === 'headRef') return { __typename: 'Ref', name: pull.headRef };
        if (field === 'baseRef') return { __typename: 'Ref', name: pull.baseRef };
        if (field === 'url') return `https://example.invalid/${repo.owner}/${repo.name}/pull/${pull.number}`;
        if (field === 'createdAt') return pull.createdAt;
        if (field === 'mergedAt') return pull.mergedAt;
        if (field === 'author') return { __typename: 'User', login: VIEWER_LOGIN, id: gid('User', VIEWER_ID) };
        if (field === 'files') {
          const headTip = store.headTip(repo, pull) ?? pull.baseShaAtCreation;
          const files = store.diffFiles(repo, pull.baseShaAtCreation, headTip);
          const first = typeof args.first === 'number' ? args.first : files.length;
          const nodes = files.slice(0, first).map((f) => ({
            __typename: 'PullRequestChangedFile',
            path: f.path, filename: f.path, additions: f.additions, deletions: f.deletions, changes: f.changes, status: f.status,
          }));
          return { __typename: 'PullRequestChangedFileConnection', __nodes: nodes, __total: files.length, __pageInfo: { __typename: 'PageInfo', hasNextPage: files.length > first, hasPreviousPage: false, startCursor: null, endCursor: null } };
        }
        return null;
      }
      case 'PullRequestChangedFile': {
        if (field === 'path' || field === 'filename') return parent.path;
        if (field === 'additions') return parent.additions ?? 0;
        if (field === 'deletions') return parent.deletions ?? 0;
        if (field === 'changes') return parent.changes ?? 0;
        if (field === 'status') return parent.status ?? 'modified';
        return null;
      }
      case 'Mutation': {
        return this.resolveMutation(field, args);
      }
      case '__Type': {
        const name = parent.__typeName as string;
        if (field === 'name') return name;
        if (field === 'kind') return TYPE_KINDS[name] ?? 'OBJECT';
        if (field === 'description') return null;
        if (field === 'fields') {
          const fields = TYPE_FIELDS[name];
          if (fields === undefined) return null;
          return fields.map((f) => ({ __typename: '__Field', name: f }));
        }
        if (field === 'enumValues') {
          const values = ENUM_VALUES[name];
          if (values === undefined) return null;
          return values.map((v) => ({ __typename: '__EnumValue', name: v }));
        }
        return null;
      }
      case '__Field': {
        if (field === 'name') return parent.name;
        if (field === 'description') return null;
        if (field === 'args') return [];
        if (field === 'type') return { __typename: '__Type', __typeName: 'String' };
        return null;
      }
      case '__EnumValue': {
        if (field === 'name') return parent.name;
        if (field === 'description') return null;
        return null;
      }
      case '__InputValue': {
        if (field === 'name') return parent.name;
        if (field === 'description') return null;
        if (field === 'type') return { __typename: '__Type', __typeName: 'String' };
        return null;
      }
      case '__Schema': {
        if (field === 'types') {
          return Object.keys(TYPE_FIELDS).map((name) => ({ __typename: '__Type', __typeName: name }));
        }
        if (field === 'queryType') return { __typename: '__Type', __typeName: 'Query' };
        if (field === 'mutationType') return { __typename: '__Type', __typeName: 'Mutation' };
        if (field === 'description') return null;
        return null;
      }
      case 'Label': {
        if (field === 'id') return gid('Label', String(parent.name ?? ''));
        if (field === 'name') return parent.name;
        if (field === 'color') return parent.color;
        if (field === 'description') return parent.description ?? '';
        return null;
      }
      case 'IssueComment': {
        if (field === 'id') return parent.id;
        if (field === 'body') return parent.body;
        if (field === 'author') return { __typename: 'User', login: VIEWER_LOGIN, id: gid('User', VIEWER_ID) };
        return null;
      }
      // Mutation payloads and edges are transparent wrappers over the objects
      // resolveMutation stored on them.
      case 'CreateIssuePayload':
      case 'CloseIssuePayload':
      case 'CreatePullRequestPayload':
      case 'MergePullRequestPayload':
      case 'AddCommentPayload':
      case 'IssueCommentEdge': {
        if (field === 'issue') return parent.issue ?? null;
        if (field === 'pullRequest') return parent.pullRequest ?? null;
        if (field === 'commentEdge') return parent.commentEdge ?? null;
        if (field === 'node') return parent.node ?? null;
        if (field === 'cursor') return parent.cursor ?? null;
        if (field === 'clientMutationId') return parent.clientMutationId ?? null;
        return null;
      }
      default:
        return null;
    }
  }

  private issueConnection(repo: Repo, args: Record<string, unknown>): AnyRecord {
    let list = [...repo.issues];
    const states = args.states as string[] | undefined;
    if (states !== undefined && states.length > 0) {
      const wanted = new Set(states.map((s) => String(s).toUpperCase()));
      list = list.filter((issue) => wanted.has(issue.state === 'open' ? 'OPEN' : 'CLOSED'));
    }
    const orderBy = args.orderBy as { field?: string; direction?: string } | undefined;
    if (orderBy !== undefined && String(orderBy.direction ?? '').toUpperCase() === 'DESC') {
      list.sort((a, b) => b.number - a.number);
    } else {
      list.sort((a, b) => a.number - b.number);
    }
    const offset = offsetOf(args.after);
    const first = typeof args.first === 'number' ? args.first : list.length;
    const page = list.slice(offset, offset + first);
    const end = offset + page.length;
    return {
      __typename: 'IssueConnection',
      __nodes: page.map((issue) => issueObject(this.ctx.store, repo, issue)),
      __total: list.length,
      __pageInfo: {
        __typename: 'PageInfo',
        hasNextPage: end < list.length,
        hasPreviousPage: offset > 0,
        startCursor: page.length > 0 ? cursorOf(offset) : null,
        endCursor: page.length > 0 ? cursorOf(end) : null,
      },
    };
  }

  private pullConnection(repo: Repo, args: Record<string, unknown>): AnyRecord {
    let list = [...repo.pulls];
    const states = args.states as string[] | undefined;
    if (states !== undefined && states.length > 0) {
      const wanted = new Set(states.map((s) => String(s).toUpperCase()));
      list = list.filter((pull) => wanted.has(pull.merged ? 'MERGED' : pull.state === 'open' ? 'OPEN' : 'CLOSED'));
    }
    const offset = offsetOf(args.after);
    const first = typeof args.first === 'number' ? args.first : list.length;
    const page = list.slice(offset, offset + first);
    const end = offset + page.length;
    return {
      __typename: 'PullRequestConnection',
      __nodes: page.map((pull) => pullObject(this.ctx.store, repo, pull)),
      __total: list.length,
      __pageInfo: {
        __typename: 'PageInfo',
        hasNextPage: end < list.length,
        hasPreviousPage: offset > 0,
        startCursor: page.length > 0 ? cursorOf(offset) : null,
        endCursor: page.length > 0 ? cursorOf(end) : null,
      },
    };
  }

  private resolveMutation(field: string, args: Record<string, unknown>): unknown {
    const store = this.ctx.store;
    const input = (args.input ?? {}) as Record<string, unknown>;
    if (field === 'createIssue') {
      const decoded = typeof input.repositoryId === 'string' ? ungid(input.repositoryId) : null;
      const repo = decoded?.kind === 'Repository' ? [...store.repos.values()].find((r) => r.id === Number(decoded.parts[0])) ?? null : null;
      if (repo === null) {
        this.errors.push({ message: 'Repository not found.' });
        return null;
      }
      const issue = store.createIssue(repo, String(input.title ?? ''), String(input.body ?? ''), []);
      return { __typename: 'CreateIssuePayload', issue: issueObject(store, repo, issue) };
    }
    if (field === 'closeIssue') {
      const decoded = typeof input.issueId === 'string' ? ungid(input.issueId) : null;
      const repo = decoded?.kind === 'Issue' ? [...store.repos.values()].find((r) => r.id === Number(decoded.parts[0])) ?? null : null;
      const issue = repo?.issuesByNumber.get(Number(decoded?.parts[1]));
      if (repo === null || repo === undefined || issue === undefined) {
        this.errors.push({ message: 'Issue not found.' });
        return null;
      }
      issue.state = 'closed';
      issue.updatedAt = trialNowIso();
      return { __typename: 'CloseIssuePayload', issue: issueObject(store, repo, issue) };
    }
    if (field === 'createPullRequest') {
      const decoded = typeof input.repositoryId === 'string' ? ungid(input.repositoryId) : null;
      const repo = decoded?.kind === 'Repository' ? [...store.repos.values()].find((r) => r.id === Number(decoded.parts[0])) ?? null : null;
      if (repo === null) {
        this.errors.push({ message: 'Repository not found.' });
        return null;
      }
      const pull = store.createPull(
        repo,
        String(input.title ?? ''),
        String(input.body ?? ''),
        String(input.headRefName ?? ''),
        String(input.baseRefName ?? ''),
      );
      if (pull === null) {
        this.errors.push({ message: 'Could not create pull request: the head branch does not exist or a pull request is already open.' });
        return null;
      }
      return { __typename: 'CreatePullRequestPayload', pullRequest: pullObject(store, repo, pull) };
    }
    if (field === 'mergePullRequest') {
      const decoded = typeof input.pullRequestId === 'string' ? ungid(input.pullRequestId) : null;
      const repo = decoded?.kind === 'PullRequest' ? [...store.repos.values()].find((r) => r.id === Number(decoded.parts[0])) ?? null : null;
      const pull = repo?.pullsByNumber.get(Number(decoded?.parts[1]));
      if (repo === null || repo === undefined || pull === undefined) {
        this.errors.push({ message: 'Pull request not found.' });
        return null;
      }
      const sha = store.squashMerge(repo, pull);
      if (sha === null) {
        this.errors.push({ message: 'Pull request cannot be merged: it conflicts with the base branch.' });
        return null;
      }
      return { __typename: 'MergePullRequestPayload', pullRequest: pullObject(store, repo, pull) };
    }
    if (field === 'addComment') {
      const decoded = typeof input.subjectId === 'string' ? ungid(input.subjectId) : null;
      const repo = decoded?.kind === 'Issue' ? [...store.repos.values()].find((r) => r.id === Number(decoded.parts[0])) ?? null : null;
      const issue = repo?.issuesByNumber.get(Number(decoded?.parts[1]));
      if (repo === null || repo === undefined || issue === undefined) {
        this.errors.push({ message: 'Issue not found.' });
        return null;
      }
      const comment = store.createComment(issue, String(input.body ?? ''));
      return {
        __typename: 'AddCommentPayload',
        commentEdge: {
          __typename: 'IssueCommentEdge',
          node: { __typename: 'IssueComment', id: gid('IssueComment', repo.id, comment.id), body: comment.body },
        },
      };
    }
    return null;
  }
}

function childTypeOf(field: string): string {
  switch (field) {
    case 'viewer':
    case 'owner':
    case 'author':
      return 'User';
    case 'repository':
    case 'node':
      return 'Repository';
    case 'issue':
      return 'Issue';
    case 'issues':
      return 'IssueConnection';
    case 'pullRequests':
      return 'PullRequestConnection';
    case 'pullRequest':
      return 'PullRequest';
    case 'files':
      return 'PullRequestChangedFileConnection';
    case 'nodes':
      return 'Node';
    case 'pageInfo':
      return 'PageInfo';
    case 'defaultBranchRef':
    case 'headRef':
    case 'baseRef':
      return 'Ref';
    case '__type':
      return '__Type';
    case '__schema':
      return '__Schema';
    case 'fields':
      return '__Field';
    case 'enumValues':
      return '__EnumValue';
    case 'types':
    case 'queryType':
    case 'mutationType':
      return '__Type';
    case 'createIssue':
    case 'closeIssue':
    case 'createPullRequest':
    case 'mergePullRequest':
    case 'addComment':
      return 'MutationPayload';
    case 'commentEdge':
      return 'IssueCommentEdge';
    case 'comment':
      return 'IssueComment';
    default:
      return 'Unknown';
  }
}

// Mutation payloads and edges are transparent wrappers: their fields resolve
// through the objects they hold, so the executor needs their field lists.
const EXTRA_TYPE_FIELDS: Record<string, string[]> = {
  CreateIssuePayload: ['issue', 'clientMutationId'],
  CloseIssuePayload: ['issue', 'clientMutationId'],
  CreatePullRequestPayload: ['pullRequest', 'clientMutationId'],
  MergePullRequestPayload: ['pullRequest', 'clientMutationId'],
  AddCommentPayload: ['commentEdge', 'clientMutationId'],
  IssueCommentEdge: ['node', 'cursor'],
  MutationPayload: ['issue', 'pullRequest', 'commentEdge'],
  Node: ['id'],
};

function runOperation(
  store: Store,
  operation: Operation,
  fragments: Record<string, { on: string; selections: Selection[] }>,
  variables: Record<string, unknown>,
): { data: unknown; errors?: Array<{ message: string }> } {
  const executor = new Executor({ store });
  const rootType = operation.type === 'mutation' ? 'Mutation' : 'Query';
  const root: AnyRecord = { __typename: rootType };
  const data = executor.executeSelections(rootType, root, operation.selections, variables, fragments);
  if (executor.errorList.length > 0) {
    return { data: null, errors: executor.errorList };
  }
  return { data };
}

/** Execute one GraphQL body (object or batched array). */
export function handleGraphQL(store: Store, body: unknown): { status: number; body: unknown } {
  const runOne = (doc: unknown): unknown => {
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
      return { data: null, errors: [{ message: 'Invalid GraphQL request: expected an object with a query.' }] };
    }
    const record = doc as Record<string, unknown>;
    const query = record.query;
    if (typeof query !== 'string' || query.trim() === '') {
      return { data: null, errors: [{ message: 'GraphQL request has no query.' }] };
    }
    const variables = (record.variables ?? {}) as Record<string, unknown>;
    let parsed: { operations: Operation[]; fragments: Record<string, { on: string; selections: Selection[] }> };
    try {
      parsed = new Parser(tokenize(query)).parseDocument();
    } catch (err) {
      return { data: null, errors: [{ message: err instanceof Error ? err.message : 'Could not parse the GraphQL document.' }] };
    }
    if (parsed.operations.length === 0) {
      return { data: null, errors: [{ message: 'GraphQL document has no operation.' }] };
    }
    // One operation per document in the suite; an operationName picks among several.
    let operation = parsed.operations[0]!;
    const operationName = record.operationName;
    if (typeof operationName === 'string' && operationName !== '') {
      operation = parsed.operations.find((op) => op.name === operationName) ?? operation;
    }
    const result = runOperation(store, operation, parsed.fragments, variables);
    return result;
  };
  if (Array.isArray(body)) {
    return { status: 200, body: body.map(runOne) };
  }
  return { status: 200, body: runOne(body) };
}

// Register the transparent payload/edge types so validation accepts them.
for (const [name, fields] of Object.entries(EXTRA_TYPE_FIELDS)) {
  TYPE_FIELDS[name] = fields;
}
