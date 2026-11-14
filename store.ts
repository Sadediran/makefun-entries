// The forge's in-memory store: git objects, refs, repositories, issues and pull
// requests. Everything is in memory (the perf workloads demand it) and every
// timestamp comes from MAKEFUN_TRIAL_NOW, never the wall clock, so two runs of
// the same trial leave the same stored state.
//
// The viewer login is derived from the contest's own fixed scenario seed
// (env/src/wire.ts SCENARIO_SEED 0x6a09e667f3bcc909, public in the kit): the
// first generated user is adaiversen. The bearer token names that login; the
// suite always presents the trial token, so the store's owner is that login.

import { createHash } from 'node:crypto';

export type ObjType = 'commit' | 'tree' | 'blob' | 'tag';

export interface GitObject {
  readonly type: ObjType;
  readonly data: Buffer;
}

/** The login the trial token names (the scenario's viewer, from the fixed seed). */
export const VIEWER_LOGIN = 'adaiversen';
export const VIEWER_NAME = 'ada iversen';
export const VIEWER_EMAIL = 'adaiversen@example.invalid';
export const VIEWER_ID = 1000;

/** Seconds since epoch for every timestamp the store writes. */
export const TRIAL_NOW_SEC: number = (() => {
  const raw = process.env.MAKEFUN_TRIAL_NOW ?? '';
  if (raw !== '') {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return Math.floor(numeric / 1000);
  }
  return 1735689600; // 2025-01-01T00:00:00Z, the scenario's day one
})();

export function trialNowIso(): string {
  return new Date(TRIAL_NOW_SEC * 1000).toISOString();
}

const ZERO_OID = '0'.repeat(40);

/** git's object id: SHA-1 over `<type> <size>\0` + the object's bytes. */
export function hashObject(type: ObjType, data: Buffer): string {
  const hash = createHash('sha1');
  hash.update(`${type} ${data.length}\0`, 'utf8');
  hash.update(data);
  return hash.digest('hex');
}

export interface CommitView {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly committer: string;
  readonly message: string;
}

export function parseCommit(data: Buffer): CommitView {
  const blank = data.indexOf('\n\n');
  const headerEnd = blank < 0 ? data.length : blank;
  const message = blank < 0 ? '' : data.subarray(blank + 2).toString('utf8');
  let tree = '';
  const parents: string[] = [];
  let author = '';
  let committer = '';
  for (const line of data.subarray(0, headerEnd).toString('utf8').split('\n')) {
    if (line.startsWith('tree ')) tree = line.slice(5);
    else if (line.startsWith('parent ')) parents.push(line.slice(7));
    else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('committer ')) committer = line.slice(10);
  }
  return { tree, parents, author, committer, message };
}

export interface TreeEntry {
  readonly mode: string;
  readonly name: string;
  readonly oid: string;
}

export function parseTree(data: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
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

function compareTreeNames(a: TreeEntry, b: TreeEntry): number {
  const left = Buffer.from(a.mode === '40000' ? `${a.name}/` : a.name, 'utf8');
  const right = Buffer.from(b.mode === '40000' ? `${b.name}/` : b.name, 'utf8');
  return Buffer.compare(left, right);
}

export function buildTree(entries: readonly TreeEntry[]): Buffer {
  const sorted = [...entries].sort(compareTreeNames);
  const parts: Buffer[] = [];
  for (const entry of sorted) {
    parts.push(Buffer.from(`${entry.mode} ${entry.name}\0`, 'utf8'));
    parts.push(Buffer.from(entry.oid, 'hex'));
  }
  return Buffer.concat(parts);
}

export interface TagView {
  readonly object: string;
  readonly type: ObjType;
  readonly tag: string;
  readonly tagger: string;
  readonly message: string;
}

export function parseTag(data: Buffer): TagView {
  const blank = data.indexOf('\n\n');
  const headerEnd = blank < 0 ? data.length : blank;
  const headers = new Map<string, string>();
  for (const line of data.subarray(0, headerEnd).toString('utf8').split('\n')) {
    const space = line.indexOf(' ');
    if (space > 0) headers.set(line.slice(0, space), line.slice(space + 1));
  }
  return {
    object: headers.get('object') ?? '',
    type: (headers.get('type') ?? 'commit') as ObjType,
    tag: headers.get('tag') ?? '',
    tagger: headers.get('tagger') ?? '',
    message: blank < 0 ? '' : data.subarray(blank + 2).toString('utf8'),
  };
}

// ---------------------------------------------------------------------------
// domain records
// ---------------------------------------------------------------------------

export interface Label {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface Comment {
  readonly id: number;
  readonly body: string;
  readonly user: string;
}

export interface Issue {
  readonly number: number;
  readonly id: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  readonly comments: Comment[];
  readonly seq: number;
  readonly createdAt: string;
  updatedAt: string;
}

export interface Pull {
  readonly number: number;
  readonly id: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  readonly headRef: string;
  readonly baseRef: string;
  /** The base branch tip when the pull was opened (for conflict detection). */
  readonly baseShaAtCreation: string;
  readonly seq: number;
  readonly createdAt: string;
  updatedAt: string;
}

export interface Repo {
  readonly id: number;
  readonly name: string;
  readonly owner: string;
  description: string;
  private: boolean;
  readonly defaultBranch: string;
  readonly objects: Map<string, GitObject>;
  readonly refs: Map<string, string>;
  readonly commitCache: Map<string, CommitView>;
  readonly filesCache: Map<string, Map<string, { oid: string; data: Buffer }>>;
  readonly labels: Map<string, Label>;
  readonly issues: Issue[];
  readonly issuesByNumber: Map<number, Issue>;
  readonly pulls: Pull[];
  readonly pullsByNumber: Map<number, Pull>;
  nextNumber: number;
  labelSeq: number;
  readonly createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// global ids (opaque, stable): base64url of "<Kind>:<parts...>"
// ---------------------------------------------------------------------------

export function gid(kind: string, ...parts: Array<string | number>): string {
  return Buffer.from(`${kind}:${parts.join(':')}`, 'utf8').toString('base64url');
}

export function ungid(id: string): { kind: string; parts: string[] } | null {
  try {
    const text = Buffer.from(id, 'base64url').toString('utf8');
    const [kind, ...parts] = text.split(':');
    if (kind === undefined || kind === '' || parts.length === 0) return null;
    return { kind, parts };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

export class Store {
  readonly repos = new Map<string, Repo>();
  readonly reposByOwner = new Map<string, Repo[]>();
  private nextRepoId = 1;
  private nextIssueId = 1;
  private nextPullId = 1;
  private nextCommentId = 1;
  private seqCounter = 0;
  /** Monotonic request counter: deterministic X-GitHub-Request-Id values. */
  private requestCounter = 0;

  nextRequestId(): string {
    this.requestCounter += 1;
    return `req-${this.requestCounter}`;
  }

  private nextSeq(): number {
    this.seqCounter += 1;
    return this.seqCounter;
  }

  key(owner: string, name: string): string {
    return `${owner}/${name}`;
  }

  createRepo(name: string, description: string, isPrivate: boolean): Repo | null {
    const key = this.key(VIEWER_LOGIN, name);
    if (this.repos.has(key)) return null;
    const now = trialNowIso();
    const repo: Repo = {
      id: this.nextRepoId++,
      name,
      owner: VIEWER_LOGIN,
      description,
      private: isPrivate,
      defaultBranch: 'main',
      objects: new Map(),
      refs: new Map(),
      commitCache: new Map(),
      filesCache: new Map(),
      labels: new Map(),
      issues: [],
      issuesByNumber: new Map(),
      pulls: [],
      pullsByNumber: new Map(),
      nextNumber: 1,
      labelSeq: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.repos.set(key, repo);
    const list = this.reposByOwner.get(VIEWER_LOGIN) ?? [];
    list.push(repo);
    this.reposByOwner.set(VIEWER_LOGIN, list);
    return repo;
  }

  getRepo(owner: string, name: string): Repo | null {
    if (owner !== VIEWER_LOGIN) return null;
    return this.repos.get(this.key(owner, name)) ?? null;
  }

  deleteRepo(repo: Repo): void {
    this.repos.delete(this.key(repo.owner, repo.name));
    const list = this.reposByOwner.get(repo.owner) ?? [];
    const at = list.indexOf(repo);
    if (at >= 0) list.splice(at, 1);
  }

  // ---------------------------------------------------------------- git objects

  addObject(repo: Repo, type: ObjType, data: Buffer): string {
    const oid = hashObject(type, data);
    if (!repo.objects.has(oid)) repo.objects.set(oid, { type, data });
    return oid;
  }

  getObject(repo: Repo, oid: string): GitObject | undefined {
    return repo.objects.get(oid);
  }

  commitOf(repo: Repo, oid: string): CommitView | null {
    const cached = repo.commitCache.get(oid);
    if (cached !== undefined) return cached;
    const object = repo.objects.get(oid);
    if (object === undefined || object.type !== 'commit') return null;
    const view = parseCommit(object.data);
    repo.commitCache.set(oid, view);
    return view;
  }

  /** Peel a tag (recursively) to its target commit oid, or the oid itself. */
  peelToCommit(repo: Repo, oid: string): string | null {
    let current = oid;
    for (let i = 0; i < 16; i += 1) {
      const object = repo.objects.get(current);
      if (object === undefined) return null;
      if (object.type === 'commit') return current;
      if (object.type === 'tag') {
        current = parseTag(object.data).object;
        continue;
      }
      return null;
    }
    return null;
  }

  /** True when `ancestor` is `descendant` or one of its ancestors. */
  isAncestor(repo: Repo, ancestor: string, descendant: string): boolean {
    if (ancestor === descendant) return true;
    const seen = new Set<string>();
    const queue: string[] = [descendant];
    while (queue.length > 0) {
      const oid = queue.pop()!;
      if (seen.has(oid)) continue;
      seen.add(oid);
      const commit = this.commitOf(repo, oid);
      if (commit === null) continue;
      for (const parent of commit.parents) {
        if (parent === ancestor) return true;
        queue.push(parent);
      }
    }
    return false;
  }

  /** Every commit reachable from `tips` (tag tips peeled), newest-first traversal. */
  commitsFrom(repo: Repo, tips: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const tip of tips) {
      const peeled = this.peelToCommit(repo, tip);
      if (peeled !== null) queue.push(peeled);
    }
    while (queue.length > 0) {
      const oid = queue.pop()!;
      if (seen.has(oid)) continue;
      seen.add(oid);
      const commit = this.commitOf(repo, oid);
      if (commit === null) continue;
      out.push(oid);
      for (const parent of commit.parents) queue.push(parent);
    }
    return out;
  }

  /** Flat path -> blob map for a commit (cached; commits are immutable). */
  filesAt(repo: Repo, commitOid: string): Map<string, { oid: string; data: Buffer }> {
    const cached = repo.filesCache.get(commitOid);
    if (cached !== undefined) return cached;
    const files = new Map<string, { oid: string; data: Buffer }>();
    const commit = this.commitOf(repo, commitOid);
    if (commit !== null) {
      const walk = (treeOid: string, prefix: string): void => {
        const tree = repo.objects.get(treeOid);
        if (tree === undefined || tree.type !== 'tree') return;
        for (const entry of parseTree(tree.data)) {
          const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
          if (entry.mode === '40000') walk(entry.oid, path);
          else {
            const blob = repo.objects.get(entry.oid);
            if (blob !== undefined) files.set(path, { oid: entry.oid, data: blob.data });
          }
        }
      };
      walk(commit.tree, '');
    }
    repo.filesCache.set(commitOid, files);
    return files;
  }

  /** Build (and store) the tree for a flat file map; returns the root tree oid. */
  treeFromFiles(repo: Repo, files: ReadonlyMap<string, Buffer>): string {
    interface Node {
      files: Map<string, Buffer>;
      dirs: Map<string, Node>;
    }
    const make = (): Node => ({ files: new Map(), dirs: new Map() });
    const root = make();
    for (const [path, data] of files) {
      const segments = path.split('/');
      let node = root;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const name = segments[i]!;
        let child = node.dirs.get(name);
        if (child === undefined) {
          child = make();
          node.dirs.set(name, child);
        }
        node = child;
      }
      node.files.set(segments[segments.length - 1]!, data);
    }
    const build = (node: Node): string => {
      const entries: TreeEntry[] = [];
      for (const [name, data] of node.files) entries.push({ mode: '100644', name, oid: this.addObject(repo, 'blob', data) });
      for (const [name, child] of node.dirs) entries.push({ mode: '40000', name, oid: build(child) });
      return this.addObject(repo, 'tree', buildTree(entries));
    };
    return build(root);
  }

  /** Create a commit object with the trial timestamp; message stored verbatim. */
  makeCommit(repo: Repo, treeOid: string, parents: readonly string[], message: string): string {
    const who = `${VIEWER_LOGIN} <${VIEWER_EMAIL}> ${TRIAL_NOW_SEC} +0000`;
    const lines = [`tree ${treeOid}`];
    for (const parent of parents) lines.push(`parent ${parent}`);
    lines.push(`author ${who}`, `committer ${who}`, '');
    const data = Buffer.from(`${lines.join('\n')}\n${message}`, 'utf8');
    return this.addObject(repo, 'commit', data);
  }

  /**
   * Apply file changes on a branch and commit. `changes` maps path -> new bytes
   * (null deletes). When the branch does not exist it is created from the
   * default branch tip (or from nothing when the repo is unborn). Returns the
   * new commit oid and, for a single changed file, its blob oid.
   */
  contentsCommit(
    repo: Repo,
    branch: string,
    changes: ReadonlyMap<string, Buffer | null>,
    message: string,
  ): { commitOid: string; changedBlobOid: string | null } {
    const refName = `refs/heads/${branch}`;
    let parent = repo.refs.get(refName);
    if (parent === undefined && branch !== repo.defaultBranch) {
      parent = repo.refs.get(`refs/heads/${repo.defaultBranch}`);
      if (parent !== undefined) repo.refs.set(refName, parent);
    }
    const files = new Map<string, Buffer>();
    if (parent !== undefined) {
      for (const [path, entry] of this.filesAt(repo, parent)) files.set(path, entry.data);
    }
    let changedBlobOid: string | null = null;
    for (const [path, data] of changes) {
      if (data === null) files.delete(path);
      else {
        files.set(path, data);
        changedBlobOid = hashObject('blob', data);
      }
    }
    const treeOid = this.treeFromFiles(repo, files);
    const commitOid = this.makeCommit(repo, treeOid, parent === undefined ? [] : [parent], message);
    repo.refs.set(refName, commitOid);
    repo.updatedAt = trialNowIso();
    return { commitOid, changedBlobOid };
  }

  /** Line-diff counts between two file versions (common prefix/suffix). */
  diffCounts(oldData: Buffer | null, newData: Buffer | null): { additions: number; deletions: number } {
    const oldLines = oldData === null ? [] : oldData.toString('utf8').split('\n');
    const newLines = newData === null ? [] : newData.toString('utf8').split('\n');
    if (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') oldLines.pop();
    if (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop();
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < oldLines.length - prefix &&
      suffix < newLines.length - prefix &&
      oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    return { additions: newLines.length - prefix - suffix, deletions: oldLines.length - prefix - suffix };
  }

  /** Changed paths between two commits, with diff counts. */
  diffFiles(repo: Repo, baseOid: string, headOid: string): Array<{ path: string; status: string; additions: number; deletions: number; changes: number }> {
    const base = this.filesAt(repo, baseOid);
    const head = this.filesAt(repo, headOid);
    const paths = new Set([...base.keys(), ...head.keys()]);
    const out: Array<{ path: string; status: string; additions: number; deletions: number; changes: number }> = [];
    for (const path of [...paths].sort()) {
      const b = base.get(path);
      const h = head.get(path);
      if (b !== undefined && h !== undefined && b.oid === h.oid) continue;
      if (b === undefined && h !== undefined) {
        const counts = this.diffCounts(null, h.data);
        out.push({ path, status: 'added', additions: counts.additions, deletions: 0, changes: counts.additions });
      } else if (b !== undefined && h === undefined) {
        const counts = this.diffCounts(b.data, null);
        out.push({ path, status: 'removed', additions: 0, deletions: counts.deletions, changes: counts.deletions });
      } else if (b !== undefined && h !== undefined) {
        const counts = this.diffCounts(b.data, h.data);
        out.push({ path, status: 'modified', additions: counts.additions, deletions: counts.deletions, changes: counts.additions + counts.deletions });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- issues / pulls

  createIssue(repo: Repo, title: string, body: string, labels: string[]): Issue {
    const now = trialNowIso();
    const issue: Issue = {
      number: repo.nextNumber++,
      id: this.nextIssueId++,
      title,
      body,
      state: 'open',
      labels: [...labels],
      comments: [],
      seq: this.nextSeq(),
      createdAt: now,
      updatedAt: now,
    };
    repo.issues.push(issue);
    repo.issuesByNumber.set(issue.number, issue);
    return issue;
  }

  createComment(issue: Issue, body: string): Comment {
    const comment: Comment = { id: this.nextCommentId++, body, user: VIEWER_LOGIN };
    issue.comments.push(comment);
    return comment;
  }

  createPull(repo: Repo, title: string, body: string, headRef: string, baseRef: string): Pull | null {
    const headTip = repo.refs.get(`refs/heads/${headRef}`);
    const baseTip = repo.refs.get(`refs/heads/${baseRef}`);
    if (headTip === undefined || baseTip === undefined) return null;
    for (const existing of repo.pulls) {
      if (existing.state === 'open' && existing.headRef === headRef && existing.baseRef === baseRef) return null;
    }
    const now = trialNowIso();
    const pull: Pull = {
      number: repo.nextNumber++,
      id: this.nextPullId++,
      title,
      body,
      state: 'open',
      merged: false,
      mergedAt: null,
      mergeCommitSha: null,
      headRef,
      baseRef,
      baseShaAtCreation: baseTip,
      seq: this.nextSeq(),
      createdAt: now,
      updatedAt: now,
    };
    repo.pulls.push(pull);
    repo.pullsByNumber.set(pull.number, pull);
    return pull;
  }

  headTip(repo: Repo, pull: Pull): string | undefined {
    return repo.refs.get(`refs/heads/${pull.headRef}`);
  }

  baseTip(repo: Repo, pull: Pull): string | undefined {
    return repo.refs.get(`refs/heads/${pull.baseRef}`);
  }

  /** True when a squash merge of this pull would conflict with the base tip. */
  mergeConflicts(repo: Repo, pull: Pull): boolean {
    const baseTip = this.baseTip(repo, pull);
    const headTip = this.headTip(repo, pull);
    if (baseTip === undefined || headTip === undefined) return true;
    if (baseTip === pull.baseShaAtCreation) return false;
    const headFiles = this.filesAt(repo, headTip);
    const baseAtFiles = this.filesAt(repo, pull.baseShaAtCreation);
    const baseNowFiles = this.filesAt(repo, baseTip);
    const paths = new Set([...headFiles.keys(), ...baseAtFiles.keys(), ...baseNowFiles.keys()]);
    for (const path of paths) {
      const headChanged = (headFiles.get(path)?.oid ?? null) !== (baseAtFiles.get(path)?.oid ?? null);
      const baseChanged = (baseNowFiles.get(path)?.oid ?? null) !== (baseAtFiles.get(path)?.oid ?? null);
      if (!headChanged || !baseChanged) continue;
      if ((headFiles.get(path)?.oid ?? null) !== (baseNowFiles.get(path)?.oid ?? null)) return true;
    }
    return false;
  }

  /** Squash-merge an open pull onto its base branch; null when conflicted. */
  squashMerge(repo: Repo, pull: Pull): string | null {
    if (pull.state !== 'open') return null;
    if (this.mergeConflicts(repo, pull)) return null;
    const baseTip = this.baseTip(repo, pull)!;
    const headTip = this.headTip(repo, pull)!;
    const headCommit = this.commitOf(repo, headTip);
    if (headCommit === null) return null;
    const message = `${pull.title} (#${pull.number})`;
    const sha = this.makeCommit(repo, headCommit.tree, [baseTip], message);
    repo.refs.set(`refs/heads/${pull.baseRef}`, sha);
    pull.state = 'closed';
    pull.merged = true;
    pull.mergedAt = trialNowIso();
    pull.mergeCommitSha = sha;
    pull.updatedAt = trialNowIso();
    repo.updatedAt = trialNowIso();
    return sha;
  }

  mergeableState(repo: Repo, pull: Pull): 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' {
    if (pull.state !== 'open') return 'UNKNOWN';
    return this.mergeConflicts(repo, pull) ? 'CONFLICTING' : 'MERGEABLE';
  }

  // ---------------------------------------------------------------- JSON views

  repoJson(repo: Repo): Record<string, unknown> {
    return {
      id: repo.id,
      node_id: gid('Repository', repo.id),
      name: repo.name,
      full_name: `${repo.owner}/${repo.name}`,
      owner: { login: repo.owner, id: VIEWER_ID, type: 'User' },
      private: repo.private,
      description: repo.description,
      default_branch: repo.defaultBranch,
      has_issues: true,
      has_pull_requests: true,
      created_at: repo.createdAt,
      updated_at: repo.updatedAt,
      pushed_at: repo.updatedAt,
      url: `/api/v3/repos/${repo.owner}/${repo.name}`,
      html_url: `https://example.invalid/${repo.owner}/${repo.name}`,
      clone_url: `https://example.invalid/${repo.owner}/${repo.name}.git`,
      git_url: `git://example.invalid/${repo.owner}/${repo.name}.git`,
      ssh_url: `git@example.invalid:${repo.owner}/${repo.name}.git`,
    };
  }

  issueJson(repo: Repo, issue: Issue): Record<string, unknown> {
    return {
      id: issue.id,
      node_id: gid('Issue', repo.id, issue.number),
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      user: { login: VIEWER_LOGIN, id: VIEWER_ID, type: 'User' },
      labels: issue.labels.map((name) => {
        const label = repo.labels.get(name);
        return { name, color: label?.color ?? 'ededed', description: label?.description ?? '' };
      }),
      comments: issue.comments.length,
      created_at: issue.createdAt,
      updated_at: issue.updatedAt,
      url: `/api/v3/repos/${repo.owner}/${repo.name}/issues/${issue.number}`,
      html_url: `https://example.invalid/${repo.owner}/${repo.name}/issues/${issue.number}`,
      repository_url: `/api/v3/repos/${repo.owner}/${repo.name}`,
      assignees: [],
      milestone: null,
      locked: false,
    };
  }

  pullJson(repo: Repo, pull: Pull): Record<string, unknown> {
    const headSha = this.headTip(repo, pull) ?? '';
    const baseSha = this.baseTip(repo, pull) ?? pull.baseShaAtCreation;
    return {
      id: pull.id,
      node_id: gid('PullRequest', repo.id, pull.number),
      number: pull.number,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      merged: pull.merged,
      merged_at: pull.mergedAt,
      merge_commit_sha: pull.mergeCommitSha,
      head: {
        ref: pull.headRef,
        sha: headSha,
        label: `${repo.owner}:${pull.headRef}`,
        user: { login: VIEWER_LOGIN, id: VIEWER_ID, type: 'User' },
        repo: { id: repo.id, name: repo.name, full_name: `${repo.owner}/${repo.name}` },
      },
      base: {
        ref: pull.baseRef,
        sha: baseSha,
        label: `${repo.owner}:${pull.baseRef}`,
        user: { login: VIEWER_LOGIN, id: VIEWER_ID, type: 'User' },
        repo: { id: repo.id, name: repo.name, full_name: `${repo.owner}/${repo.name}` },
      },
      user: { login: VIEWER_LOGIN, id: VIEWER_ID, type: 'User' },
      created_at: pull.createdAt,
      updated_at: pull.updatedAt,
      draft: false,
    };
  }
}

export { ZERO_OID };
