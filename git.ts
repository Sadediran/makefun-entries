// Git smart HTTP: pkt-line framing, packfile read/write (OFS_DELTA and
// REF_DELTA), protocol v2 upload-pack (ls-refs, fetch), v0 upload-pack and
// v0 receive-pack with report-status. No git binary, no outside process:
// SHA-1 object ids, loose-object hashing and pack generation are all here.

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  hashObject,
  parseCommit,
  parseTag,
  parseTree,
  trialNowIso,
  type GitObject,
  type ObjType,
  type Repo,
  type Store,
  ZERO_OID,
} from './store.ts';

// ---------------------------------------------------------------- pkt-line

export function pktLine(payload: string | Buffer): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const header = Buffer.allocUnsafe(4);
  header.write((data.length + 4).toString(16).padStart(4, '0'), 0, 4, 'ascii');
  return Buffer.concat([header, data]);
}

export const pktFlush = (): Buffer => Buffer.from('0000', 'ascii');
export const pktDelim = (): Buffer => Buffer.from('0001', 'ascii');

export type Pkt =
  | { kind: 'data'; payload: Buffer }
  | { kind: 'flush' }
  | { kind: 'delim' }
  | { kind: 'response-end' };

const HEX4 = /^[0-9a-fA-F]{4}$/;

/** Decode pkt-lines from the head of a buffer; returns packets and the rest. */
export function decodePktLines(buf: Buffer): { packets: Pkt[]; rest: Buffer } {
  const packets: Pkt[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const head = buf.subarray(offset, offset + 4).toString('ascii');
    if (!HEX4.test(head)) throw new Error(`invalid pkt-line length ${JSON.stringify(head)}`);
    const length = Number.parseInt(head, 16);
    if (length === 0) {
      packets.push({ kind: 'flush' });
      offset += 4;
      continue;
    }
    if (length === 1) {
      packets.push({ kind: 'delim' });
      offset += 4;
      continue;
    }
    if (length === 2) {
      packets.push({ kind: 'response-end' });
      offset += 4;
      continue;
    }
    if (length < 4 || length > 65520 || offset + length > buf.length) throw new Error('truncated or oversized pkt-line');
    packets.push({ kind: 'data', payload: buf.subarray(offset + 4, offset + length) });
    offset += length;
  }
  if (offset !== buf.length) throw new Error('trailing bytes in pkt-line stream');
  return { packets, rest: Buffer.alloc(0) };
}

/** Decode pkt-lines until the first flush; everything after it is returned raw. */
export function decodeUntilFlush(buf: Buffer): { packets: Pkt[]; rest: Buffer } {
  const packets: Pkt[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const head = buf.subarray(offset, offset + 4).toString('ascii');
    if (!HEX4.test(head)) throw new Error(`invalid pkt-line length ${JSON.stringify(head)}`);
    const length = Number.parseInt(head, 16);
    if (length === 0) {
      packets.push({ kind: 'flush' });
      return { packets, rest: buf.subarray(offset + 4) };
    }
    if (length === 1) {
      packets.push({ kind: 'delim' });
      offset += 4;
      continue;
    }
    if (length === 2) {
      packets.push({ kind: 'response-end' });
      offset += 4;
      continue;
    }
    if (length < 4 || length > 65520 || offset + length > buf.length) throw new Error('truncated or oversized pkt-line');
    packets.push({ kind: 'data', payload: buf.subarray(offset + 4, offset + length) });
    offset += length;
  }
  throw new Error('pkt-line stream ended before flush');
}

function pktLinesOf(packets: readonly Pkt[]): string[] {
  const lines: string[] = [];
  for (const packet of packets) if (packet.kind === 'data') lines.push(packet.payload.toString('utf8'));
  return lines;
}

// ---------------------------------------------------------------- delta

export function applyDelta(base: Buffer, delta: Buffer): Buffer {
  let offset = 0;
  const readSize = (): number => {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (offset >= delta.length) throw new Error('delta size varint truncated');
      const byte = delta[offset++]!;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(byte & 0x80)) break;
    }
    return value;
  };
  const sourceSize = readSize();
  const targetSize = readSize();
  if (sourceSize !== base.length) throw new Error('delta base size mismatch');
  const out = Buffer.allocUnsafe(targetSize);
  let written = 0;
  while (offset < delta.length) {
    const op = delta[offset++]!;
    if (op & 0x80) {
      let copyOffset = 0;
      let copySize = 0;
      let shift = 0;
      for (let bit = 0; bit < 4; bit += 1) {
        if (op & (1 << bit)) copyOffset += delta[offset++]! * 2 ** shift;
        shift += 8;
      }
      shift = 0;
      for (let bit = 4; bit < 7; bit += 1) {
        if (op & (1 << bit)) copySize += delta[offset++]! * 2 ** shift;
        shift += 8;
      }
      if (copySize === 0) copySize = 0x10000;
      base.copy(out, written, copyOffset, copyOffset + copySize);
      written += copySize;
    } else if (op !== 0) {
      const literal = op & 0x7f;
      delta.copy(out, written, offset, offset + literal);
      offset += literal;
      written += literal;
    } else {
      throw new Error('delta opcode 0');
    }
  }
  if (written !== targetSize) throw new Error('delta size mismatch');
  return out;
}

// ---------------------------------------------------------------- packfile

const TYPE_CODE: Readonly<Record<ObjType, number>> = { commit: 1, tree: 2, blob: 3, tag: 4 };
const CODE_TYPE: Readonly<Record<number, ObjType>> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };

function readVarintSize(buffer: Buffer, start: number): { size: number; next: number; first: number } {
  let byte = buffer[start]!;
  const first = byte;
  let size = byte & 0x0f;
  let shift = 4;
  let offset = start + 1;
  while (byte & 0x80) {
    byte = buffer[offset++]!;
    size += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  }
  return { size, next: offset, first };
}

function readOfsBase(buffer: Buffer, start: number): { baseOffset: number; next: number } {
  let byte = buffer[start]!;
  let offset = start + 1;
  let value = byte & 0x7f;
  while (byte & 0x80) {
    byte = buffer[offset++]!;
    value = (value + 1) * 128 + (byte & 0x7f);
  }
  return { baseOffset: value, next: offset };
}

function inflateAt(buffer: Buffer, offset: number): { data: Buffer; next: number } {
  const result = inflateSync(buffer.subarray(offset), { info: true }) as unknown as {
    buffer: Buffer;
    engine: { bytesWritten: number };
  };
  return { data: result.buffer, next: offset + result.engine.bytesWritten };
}

/** Read a packfile; `resolveBase` supplies thin-pack bases the pack omits. */
export function readPack(pack: Buffer, resolveBase?: (oid: string) => GitObject | undefined): Map<string, GitObject> {
  if (pack.length < 32 || pack.subarray(0, 4).toString('ascii') !== 'PACK') throw new Error('not a packfile');
  const version = pack.readUInt32BE(4);
  if (version !== 2 && version !== 3) throw new Error(`unsupported pack version ${version}`);
  const count = pack.readUInt32BE(8);
  const trailerStart = pack.length - 20;
  interface Raw {
    offset: number;
    typeCode: number;
    size: number;
    data: Buffer;
    baseOffset?: number;
    baseOid?: string;
  }
  const raw: Raw[] = [];
  const byOffset = new Map<number, Raw>();
  let offset = 12;
  for (let i = 0; i < count; i += 1) {
    const entryOffset = offset;
    const header = readVarintSize(pack, offset);
    offset = header.next;
    const typeCode = (header.first >> 4) & 0x07;
    const entry: Raw = { offset: entryOffset, typeCode, size: header.size, data: Buffer.alloc(0) };
    if (typeCode === 6) {
      const base = readOfsBase(pack, offset);
      offset = base.next;
      entry.baseOffset = entryOffset - base.baseOffset;
    } else if (typeCode === 7) {
      entry.baseOid = pack.subarray(offset, offset + 20).toString('hex');
      offset += 20;
    } else if (!CODE_TYPE[typeCode]) {
      throw new Error(`unknown pack type code ${typeCode}`);
    }
    const inflated = inflateAt(pack.subarray(0, trailerStart), offset);
    if (inflated.data.length !== header.size) throw new Error('pack entry size mismatch');
    entry.data = inflated.data;
    offset = inflated.next;
    raw.push(entry);
    byOffset.set(entryOffset, entry);
  }
  if (offset !== trailerStart) throw new Error('pack trailing bytes');
  const objects = new Map<string, GitObject>();
  const resolved = new Map<number, { type: ObjType; data: Buffer; oid: string }>();
  const resolving = new Set<number>();
  const resolve = (entry: Raw): { type: ObjType; data: Buffer; oid: string } => {
    const done = resolved.get(entry.offset);
    if (done !== undefined) return done;
    if (resolving.has(entry.offset)) throw new Error('delta cycle');
    resolving.add(entry.offset);
    let type: ObjType;
    let data: Buffer;
    if (entry.typeCode === 6) {
      const baseEntry = byOffset.get(entry.baseOffset!);
      if (baseEntry === undefined) throw new Error('ofs-delta base missing');
      const base = resolve(baseEntry);
      type = base.type;
      data = applyDelta(base.data, entry.data);
    } else if (entry.typeCode === 7) {
      const baseEntry = [...resolved.values()].find((r) => r.oid === entry.baseOid);
      if (baseEntry !== undefined) {
        type = baseEntry.type;
        data = applyDelta(baseEntry.data, entry.data);
      } else {
        const external = resolveBase?.(entry.baseOid!);
        if (external === undefined) throw new Error('ref-delta base missing');
        type = external.type;
        data = applyDelta(external.data, entry.data);
      }
    } else {
      type = CODE_TYPE[entry.typeCode]!;
      data = entry.data;
    }
    const oid = hashObject(type, data);
    const out = { type, data, oid };
    resolved.set(entry.offset, out);
    resolving.delete(entry.offset);
    return out;
  };
  for (const entry of raw) {
    const r = resolve(entry);
    if (!objects.has(r.oid)) objects.set(r.oid, { type: r.type, data: r.data });
  }
  return objects;
}

function writePackObjectHeader(type: ObjType, size: number): Buffer {
  const code = TYPE_CODE[type];
  const bytes: number[] = [];
  let remaining = size;
  let first = (code << 4) | (remaining & 0x0f);
  remaining = Math.floor(remaining / 16);
  while (remaining > 0) {
    bytes.push(first | 0x80);
    first = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(first);
  return Buffer.from(bytes);
}

/** Build a packfile from plain objects (no deltas); trailer is SHA-1 of the rest. */
export function writePack(objects: Iterable<GitObject>): Buffer {
  const list = [...objects];
  const parts: Buffer[] = [];
  const header = Buffer.allocUnsafe(12);
  header.write('PACK', 0, 4, 'ascii');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(list.length, 8);
  parts.push(header);
  for (const object of list) {
    parts.push(writePackObjectHeader(object.type, object.data.length));
    parts.push(deflateSync(object.data));
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, createHash('sha1').update(body).digest()]);
}

// ---------------------------------------------------------------- ref helpers

export interface RefLine {
  oid: string;
  name: string;
  peeled?: string;
  symrefTarget?: string;
  unborn?: boolean;
}

function sortedRefs(repo: Repo): Array<{ name: string; oid: string }> {
  return [...repo.refs.entries()].map(([name, oid]) => ({ name, oid })).sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Peel an annotated tag ref to its commit, or undefined. */
function peelRef(store: Store, repo: Repo, oid: string): string | undefined {
  const object = repo.objects.get(oid);
  if (object === undefined || object.type !== 'tag') return undefined;
  return store.peelToCommit(repo, oid) ?? undefined;
}

const AGENT = 'github-core-clone/1.0';
const V0_UPLOAD_CAPS =
  `symref=HEAD:refs/heads/main multi_ack multi_ack_detailed thin-pack side-band side-band-64k ofs-delta shallow deepen-since deepen-not filter agent=${AGENT} object-format=sha1`;
const V0_RECEIVE_CAPS = `report-status side-band-64k delete-refs ofs-delta quiet agent=${AGENT} object-format=sha1`;

function v0Advertisement(store: Store, repo: Repo, service: 'git-upload-pack' | 'git-receive-pack'): Buffer {
  const caps = service === 'git-upload-pack' ? V0_UPLOAD_CAPS : V0_RECEIVE_CAPS;
  return rebuildV0(store, repo, service, caps);
}

function rebuildV0(store: Store, repo: Repo, service: 'git-upload-pack' | 'git-receive-pack', caps: string): Buffer {
  const parts: Buffer[] = [pktLine(`# service=${service}\n`), pktFlush()];
  const refs = sortedRefs(repo);
  if (refs.length === 0) {
    parts.push(pktLine(`${ZERO_OID} capabilities^{}\0${caps}\n`));
  } else {
    const headOid = repo.refs.get(`refs/heads/${repo.defaultBranch}`) ?? ZERO_OID;
    parts.push(pktLine(`${headOid} HEAD\0${caps}\n`));
    for (const ref of refs) {
      parts.push(pktLine(`${ref.oid} ${ref.name}\n`));
      const peeled = ref.name.startsWith('refs/tags/') ? peelRef(store, repo, ref.oid) : undefined;
      if (peeled !== undefined) parts.push(pktLine(`${peeled} ${ref.name}^{}\n`));
    }
  }
  parts.push(pktFlush());
  return Buffer.concat(parts);
}

function v2Advertisement(): Buffer {
  return Buffer.concat([
    pktLine('version 2\n'),
    pktLine(`agent=${AGENT}\n`),
    pktLine('ls-refs=unborn\n'),
    pktLine('fetch=shallow wait-for-done filter\n'),
    pktLine('object-format=sha1\n'),
    pktFlush(),
  ]);
}

// ---------------------------------------------------------------- fetch computation

interface FetchPlan {
  /** Objects to send, in walk order. */
  objects: GitObject[];
  shallow: string[];
  unshallow: string[];
  acks: string[];
}

/**
 * Work out what a fetch sends. `depth` limits commit generations from the
 * wants (depth 1 = the tips only). `shallow` is the client's current shallow
 * boundary: those commits are included but their parents are not traversed,
 * and a boundary that is now fully included becomes unshallow.
 */
function planFetch(
  store: Store,
  repo: Repo,
  wants: readonly string[],
  haves: readonly string[],
  depth: number | undefined,
  shallowBoundaries: readonly string[],
): FetchPlan {
  const shallowSet = new Set(shallowBoundaries);
  // Included commits with their distance from a want.
  const included = new Map<string, number>();
  const queue: Array<{ oid: string; dist: number }> = [];
  for (const want of wants) {
    const object = repo.objects.get(want);
    if (object === undefined) continue;
    if (object.type === 'tag') {
      const peeled = store.peelToCommit(repo, want);
      if (peeled !== null) queue.push({ oid: peeled, dist: 0 });
    } else if (object.type === 'commit') {
      queue.push({ oid: want, dist: 0 });
    }
  }
  while (queue.length > 0) {
    const { oid, dist } = queue.pop()!;
    const known = included.get(oid);
    if (known !== undefined && known <= dist) continue;
    included.set(oid, dist);
    if (depth !== undefined && dist >= depth - 1) continue;
    if (shallowSet.has(oid) && dist > 0) continue;
    const commit = store.commitOf(repo, oid);
    if (commit === null) continue;
    for (const parent of commit.parents) queue.push({ oid: parent, dist: dist + 1 });
  }
  const shallow: string[] = [];
  const unshallow: string[] = [];
  for (const [oid, dist] of included) {
    const commit = store.commitOf(repo, oid);
    if (commit === null || commit.parents.length === 0) continue;
    const parentsIncluded = commit.parents.every((p) => included.has(p));
    if (depth !== undefined) {
      if (dist === depth - 1 && !parentsIncluded) shallow.push(oid);
      if (shallowSet.has(oid) && parentsIncluded) unshallow.push(oid);
    } else if (shallowSet.has(oid)) {
      shallow.push(oid);
    }
  }
  // Objects reachable from the included commits (plus tag objects for wants).
  const wanted = new Set<string>();
  const addTree = (treeOid: string): void => {
    const stack: string[] = [treeOid];
    const seenTrees = new Set<string>();
    while (stack.length > 0) {
      const oid = stack.pop()!;
      if (seenTrees.has(oid)) continue;
      seenTrees.add(oid);
      const tree = repo.objects.get(oid);
      if (tree === undefined || tree.type !== 'tree') continue;
      wanted.add(oid);
      for (const entry of parseTree(tree.data)) {
        if (entry.mode === '40000') stack.push(entry.oid);
        else wanted.add(entry.oid);
      }
    }
  };
  for (const want of wants) {
    const object = repo.objects.get(want);
    if (object === undefined) continue;
    wanted.add(want);
    if (object.type === 'tag') {
      const peeled = store.peelToCommit(repo, want);
      if (peeled !== null) wanted.add(peeled);
    }
  }
  for (const oid of included.keys()) {
    wanted.add(oid);
    const commit = store.commitOf(repo, oid);
    if (commit !== null) addTree(commit.tree);
  }
  // What the client already holds: full closure of the haves, stopping at
  // shallow boundaries (a shallow clone does not hold their parents).
  const held = new Set<string>();
  const heldCommits = new Set<string>();
  const hQueue: string[] = [];
  for (const have of haves) {
    const object = repo.objects.get(have);
    if (object === undefined) continue;
    if (object.type === 'commit') hQueue.push(have);
    else if (object.type === 'tag') {
      held.add(have);
      const peeled = store.peelToCommit(repo, have);
      if (peeled !== null) hQueue.push(peeled);
    } else held.add(have);
  }
  while (hQueue.length > 0) {
    const oid = hQueue.pop()!;
    if (heldCommits.has(oid)) continue;
    heldCommits.add(oid);
    held.add(oid);
    if (shallowSet.has(oid)) continue;
    const commit = store.commitOf(repo, oid);
    if (commit === null) continue;
    held.add(commit.tree);
    const stack: string[] = [commit.tree];
    const seenTrees = new Set<string>();
    while (stack.length > 0) {
      const treeOid = stack.pop()!;
      if (seenTrees.has(treeOid)) continue;
      seenTrees.add(treeOid);
      const tree = repo.objects.get(treeOid);
      if (tree === undefined || tree.type !== 'tree') continue;
      held.add(treeOid);
      for (const entry of parseTree(tree.data)) {
        if (entry.mode === '40000') stack.push(entry.oid);
        else held.add(entry.oid);
      }
    }
    for (const parent of commit.parents) hQueue.push(parent);
  }
  // ACKs: haves that are ancestors of (or equal to) a want.
  const acks: string[] = [];
  const fullReachable = new Set<string>();
  const rQueue: string[] = [];
  for (const want of wants) {
    const peeled = repo.objects.get(want)?.type === 'tag' ? store.peelToCommit(repo, want) : want;
    if (peeled !== null && peeled !== undefined) rQueue.push(peeled);
  }
  while (rQueue.length > 0) {
    const oid = rQueue.pop()!;
    if (fullReachable.has(oid)) continue;
    fullReachable.add(oid);
    const commit = store.commitOf(repo, oid);
    if (commit === null) continue;
    for (const parent of commit.parents) rQueue.push(parent);
  }
  for (const have of haves) if (fullReachable.has(have) && repo.objects.has(have)) acks.push(have);

  const objects: GitObject[] = [];
  for (const oid of wanted) {
    if (held.has(oid)) continue;
    const object = repo.objects.get(oid);
    if (object !== undefined) objects.push(object);
  }
  return { objects, shallow, unshallow, acks };
}

function sidebandPack(pack: Buffer): Buffer {
  const parts: Buffer[] = [];
  const CHUNK = 60000;
  for (let offset = 0; offset < pack.length; offset += CHUNK) {
    const chunk = pack.subarray(offset, Math.min(pack.length, offset + CHUNK));
    parts.push(pktLine(Buffer.concat([Buffer.from([1]), chunk])));
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- ls-refs

function lsRefsResponse(store: Store, repo: Repo, args: readonly string[]): Buffer {
  const peel = args.includes('peel');
  const symrefs = args.includes('symrefs');
  const unborn = args.includes('unborn');
  const prefixes = args.filter((a) => a.startsWith('ref-prefix ')).map((a) => a.slice('ref-prefix '.length));
  const keep = (name: string): boolean => prefixes.length === 0 || prefixes.some((p) => name.startsWith(p));
  const parts: Buffer[] = [];
  const headOid = repo.refs.get(`refs/heads/${repo.defaultBranch}`);
  if (repo.refs.size === 0) {
    if (unborn && keep('HEAD')) parts.push(pktLine('unborn HEAD symref-target:refs/heads/main\n'));
    parts.push(pktFlush());
    return Buffer.concat(parts);
  }
  if (keep('HEAD') && symrefs) {
    parts.push(pktLine(`${headOid ?? ZERO_OID} HEAD symref-target:refs/heads/${repo.defaultBranch}\n`));
  } else if (keep('HEAD')) {
    parts.push(pktLine(`${headOid ?? ZERO_OID} HEAD\n`));
  }
  for (const ref of sortedRefs(repo)) {
    if (!keep(ref.name)) continue;
    let line = `${ref.oid} ${ref.name}`;
    if (ref.name.startsWith('refs/tags/') && peel) {
      const peeled = peelRef(store, repo, ref.oid);
      if (peeled !== undefined) line += ` peeled:${peeled}`;
    }
    parts.push(pktLine(`${line}\n`));
  }
  parts.push(pktFlush());
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- the handlers

export interface GitResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

function notFoundJson(): GitResponse {
  return { status: 404, contentType: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify({ message: 'Not Found' }) + '\n', 'utf8') };
}

function badRequest(): GitResponse {
  return { status: 400, contentType: 'text/plain; charset=utf-8', body: Buffer.from('bad request', 'utf8') };
}

export function handleInfoRefs(
  store: Store,
  repo: Repo | null,
  service: string,
  gitProtocol: string | undefined,
): GitResponse {
  if (repo === null) return notFoundJson();
  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') return notFoundJson();
  const contentType = `application/x-${service}-advertisement`;
  if (service === 'git-upload-pack' && gitProtocol === 'version=2') {
    return { status: 200, contentType, body: v2Advertisement() };
  }
  return { status: 200, contentType, body: v0Advertisement(store, repo, service) };
}

function fetchV2Response(store: Store, repo: Repo, args: readonly string[]): Buffer {
  const wants: string[] = [];
  const haves: string[] = [];
  const shallow: string[] = [];
  let depth: number | undefined;
  let done = false;
  for (const line of args) {
    if (line.startsWith('want ')) wants.push(line.slice(5).trim());
    else if (line.startsWith('have ')) haves.push(line.slice(8).trim());
    else if (line.startsWith('shallow ')) shallow.push(line.slice(8).trim());
    else if (line.startsWith('deepen ')) depth = Number.parseInt(line.slice(7).trim(), 10);
    else if (line === 'done') done = true;
  }
  const plan = planFetch(store, repo, wants, haves, depth, shallow);
  const pack = writePack(plan.objects);
  const parts: Buffer[] = [];
  // Section shape follows git's own fetch-pack state machine (fetch-pack.c):
  // the acknowledgments section is read only when the client sent haves. When
  // it sent 'done' with no haves (a fresh clone) git goes straight to the
  // packfile section and dies on an 'acknowledgments' header, so no haves
  // means no acknowledgments section at all. Haves without 'done' is a
  // negotiation round: acknowledgments only, flush-terminated, no packfile
  // yet. Haves with 'done': acknowledgments + 'ready', then the packfile.
  if (haves.length > 0) {
    parts.push(pktLine('acknowledgments\n'));
    if (plan.acks.length > 0) {
      for (const ack of plan.acks) parts.push(pktLine(`ACK ${ack}\n`));
    } else {
      parts.push(pktLine('NAK\n'));
    }
    if (done) parts.push(pktLine('ready\n'));
    if (!done) {
      parts.push(pktFlush());
      return Buffer.concat(parts);
    }
    parts.push(pktDelim());
  }
  if (plan.shallow.length > 0 || plan.unshallow.length > 0) {
    parts.push(pktLine('shallow-info\n'));
    for (const oid of plan.shallow) parts.push(pktLine(`shallow ${oid}\n`));
    for (const oid of plan.unshallow) parts.push(pktLine(`unshallow ${oid}\n`));
    parts.push(pktDelim());
  }
  parts.push(pktLine('packfile\n'));
  parts.push(sidebandPack(pack));
  parts.push(pktFlush());
  return Buffer.concat(parts);
}

function fetchV0Response(store: Store, repo: Repo, args: readonly string[]): Buffer {
  const wants: string[] = [];
  const haves: string[] = [];
  const shallow: string[] = [];
  let depth: number | undefined;
  let done = false;
  for (const line of args) {
    if (line.startsWith('want ')) {
      const rest = line.slice(5).trim();
      wants.push(rest.split(' ')[0]!);
    } else if (line.startsWith('have ')) haves.push(line.slice(5).trim());
    else if (line.startsWith('shallow ')) shallow.push(line.slice(8).trim());
    else if (line.startsWith('deepen ')) depth = Number.parseInt(line.slice(7).trim(), 10);
    else if (line === 'done') done = true;
  }
  const plan = planFetch(store, repo, wants, haves, depth, shallow);
  const parts: Buffer[] = [];
  if (plan.acks.length > 0) {
    for (const ack of plan.acks) parts.push(pktLine(`ACK ${ack}\n`));
  } else {
    parts.push(pktLine('NAK\n'));
  }
  // A negotiation round (haves, no 'done'): acknowledgments only, then a
  // flush; the client sends another request. The packfile is sent only once
  // the client says 'done' (or sent nothing to negotiate over).
  if (haves.length > 0 && !done) {
    parts.push(pktFlush());
    return Buffer.concat(parts);
  }
  const pack = writePack(plan.objects);
  for (const oid of plan.shallow) parts.push(pktLine(`shallow ${oid}\n`));
  for (const oid of plan.unshallow) parts.push(pktLine(`unshallow ${oid}\n`));
  parts.push(sidebandPack(pack));
  parts.push(pktFlush());
  return Buffer.concat(parts);
}

export function handleUploadPack(
  store: Store,
  repo: Repo | null,
  body: Buffer,
  gitProtocol: string | undefined,
): GitResponse {
  if (repo === null) return notFoundJson();
  const contentType = 'application/x-git-upload-pack-result';
  try {
    if (gitProtocol === 'version=2') {
      const { packets } = decodePktLines(body);
      const lines = pktLinesOf(packets);
      const commandLine = (lines[0] ?? '').replace(/\n$/, '');
      // Args are the data lines after the first delim packet.
      const argLines: string[] = [];
      let pastDelim = false;
      for (const packet of packets) {
        if (packet.kind === 'delim') {
          pastDelim = true;
          continue;
        }
        if (pastDelim && packet.kind === 'data') argLines.push(packet.payload.toString('utf8').replace(/\n$/, ''));
      }
      if (commandLine === 'command=ls-refs') {
        return { status: 200, contentType, body: lsRefsResponse(store, repo, argLines) };
      }
      if (commandLine === 'command=fetch') {
        return { status: 200, contentType, body: fetchV2Response(store, repo, argLines) };
      }
      return badRequest();
    }
    // v0: wants section, flush, haves/done section, flush.
    const { packets } = decodePktLines(body);
    const lines = pktLinesOf(packets);
    return { status: 200, contentType, body: fetchV0Response(store, repo, lines) };
  } catch {
    return badRequest();
  }
}

export function handleReceivePack(store: Store, repo: Repo | null, body: Buffer): GitResponse {
  if (repo === null) return notFoundJson();
  const contentType = 'application/x-git-receive-pack-result';
  try {
    const { packets, rest } = decodeUntilFlush(body);
    const lines = pktLinesOf(packets);
    interface Command {
      oldOid: string;
      newOid: string;
      ref: string;
      caps: string;
    }
    const commands: Command[] = [];
    let sideband = false;
    for (const line of lines) {
      const trimmed = line.replace(/\n$/, '');
      const nul = trimmed.indexOf('\0');
      const caps = nul >= 0 ? trimmed.slice(nul + 1) : '';
      const head = nul >= 0 ? trimmed.slice(0, nul) : trimmed;
      const parts = head.split(' ');
      if (parts.length !== 3) throw new Error('bad receive-pack command');
      if (caps.includes('side-band-64k')) sideband = true;
      commands.push({ oldOid: parts[0]!, newOid: parts[1]!, ref: parts[2]!, caps });
    }
    if (commands.length === 0) throw new Error('no commands');
    // Unpack: store every object the pack carries (even for refused refs).
    let unpackOk = true;
    if (rest.length > 0) {
      const objects = readPack(rest, (oid) => repo.objects.get(oid));
      for (const [oid, object] of objects) {
        if (hashObject(object.type, object.data) !== oid) throw new Error('pack object hash mismatch');
        if (!repo.objects.has(oid)) repo.objects.set(oid, object);
      }
    }
    const reportLines: string[] = ['unpack ok'];
    for (const command of commands) {
      const current = repo.refs.get(command.ref);
      let ok = false;
      let reason = '';
      if (command.newOid === ZERO_OID) {
        // Delete.
        if (current === undefined) {
          reason = 'non-fast-forward';
        } else if (command.oldOid !== ZERO_OID && command.oldOid !== current) {
          reason = 'non-fast-forward';
        } else {
          repo.refs.delete(command.ref);
          ok = true;
        }
      } else if (command.oldOid === ZERO_OID) {
        // Create.
        if (current !== undefined) {
          reason = 'non-fast-forward';
        } else if (!repo.objects.has(command.newOid)) {
          reason = 'non-fast-forward';
        } else {
          repo.refs.set(command.ref, command.newOid);
          ok = true;
        }
      } else {
        // Update: old must match and new must descend from old.
        if (current === undefined || current !== command.oldOid) {
          reason = 'non-fast-forward';
        } else if (!repo.objects.has(command.newOid)) {
          reason = 'non-fast-forward';
        } else if (!store.isAncestor(repo, command.oldOid, command.newOid)) {
          reason = 'non-fast-forward';
        } else {
          repo.refs.set(command.ref, command.newOid);
          ok = true;
        }
      }
      reportLines.push(ok ? `ok ${command.ref}` : `ng ${command.ref} ${reason}`);
    }
    repo.updatedAt = trialNowIso(); // trial time, never the wall clock
    // The report is a stream of pkt-lines terminated by a flush *inside* the
    // sideband payload (git's receive-pack.c: packet_buf_flush, then
    // send_sideband band 1, then a final outer packet_flush). The client's
    // sideband demuxer forwards the band-1 bytes verbatim, and its report
    // reader dies with "the remote end hung up unexpectedly" if the inner
    // stream ends at EOF instead of a flush.
    const inner = Buffer.concat([...reportLines.map((line) => pktLine(`${line}\n`)), pktFlush()]);
    let out: Buffer;
    if (sideband) {
      const parts: Buffer[] = [];
      const CHUNK = 60000;
      for (let offset = 0; offset < inner.length; offset += CHUNK) {
        const chunk = inner.subarray(offset, Math.min(inner.length, offset + CHUNK));
        parts.push(pktLine(Buffer.concat([Buffer.from([1]), chunk])));
      }
      parts.push(pktFlush());
      out = Buffer.concat(parts);
    } else {
      out = inner;
    }
    return { status: 200, contentType, body: out };
  } catch {
    return badRequest();
  }
}
