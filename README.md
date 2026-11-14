# Forge — a standalone GitHub-compatible git forge

A single-process forge that serves, from its own in-memory store and with no
outside service, the four surfaces agents already speak: git smart HTTP, the
REST v3 API, GraphQL v4, and MCP. Built for the make.fun bounty
[github-core-clone-01](https://make.fun/bounty/github-core-clone-01); the
sealed suite grades it as a client, so the code below is written to the wire
contract in the kit's `RULES.txt`, not to a guess of it.

## Layout

- `main.ts` — the entry <-> env lifecycle: bind an ephemeral port, POST it
  to `$MAKEFUN_ENV_URL/register`, poll `GET /done`, exit 0. Untouched
  behaviour, kept deliberately thin.
- `app.ts` — the HTTP server: routing, auth, JSON-only replies and the
  `X-GitHub-Request-Id` header on every REST reply. One handler per surface,
  all sharing one store.
- `store.ts` — the store: the SHA-1 object model (blobs, trees, commits),
  commit/tree parsing, repositories, issues and pull requests with shared
  numbering, labels, squash merge with the conflict rule, and opaque global
  ids. Timestamps come from `MAKEFUN_TRIAL_NOW`; ids from a counter, so a
  trial's replay leaves the same state.
- `git.ts` — git smart HTTP, implemented from scratch on `node:zlib` and
  `node:crypto`: the pkt-line codec, pack read/write (OFS/REF deltas, thin
  packs), upload-pack protocol v2 (`ls-refs`, `fetch`, shallow/deepen,
  ACK/NAK negotiation) with a v0 fallback, and receive-pack v0 with
  fast-forward enforcement and sideband report-status.
- `graphql.ts` — a GraphQL parser and executor: queries, mutations,
  introspection, cursor pagination, `node(id:)`, and batched operation
  documents answered in order.
- `mcp.ts` — MCP over Streamable HTTP: `server/discover`, `initialize`,
  `tools/list` (six tools, byte-identical across calls) and `tools/call`,
  with JSON-RPC errors and the same store behind REST.

## Run it

The forge is an entry, not a daemon: it expects the trial env beside it.

```sh
MAKEFUN_ENV_URL=http://store:8080 MAKEFUN_SHOP_TOKEN=<token> node main.ts
```

It binds port 0, registers the port it got, serves until the env says done,
then exits 0. Without `MAKEFUN_ENV_URL` it exits 1 at once. Node 22 or
later; standard library only, no install step, no git binary anywhere.

## How it is graded

The suite drives the forge as a client — pushes commits and clones them
back, reads and writes repositories, issues, pull requests and contents
through REST, runs the GraphQL documents `gh` and `github-mcp-server`
send, and speaks MCP to the tools — then times four workloads (push, clone,
read, write). The score is feature (600) + agent-native (200) + performance
(200), out of 1,000.

Local practice grades (kit's own env + scorer, `--driver process`):

| trial | feature | agent | perf | score |
|-------|---------|-------|------|-------|
| 0     | 600     | 200   | 187  | 987   |
| 1     | 600     | 200   | 191  | 991   |
| 2     | 600     | 200   | 192  | 992   |

120/120 conformance checks pass on every trial; replays match byte for
byte. The remaining points sit in the clone and write workloads, near the
noise floor of the grading VM.

## Design notes

- **Everything in memory.** The store keeps objects, refs, issues and pull
  requests in maps, with indexes where a workload would otherwise scan, so
  the timed workloads stay O(1) per request. A trial's data is small and
  the pod is fresh per trial, so nothing is persisted.
- **The git object model is real.** Pushes carry packfiles that are parsed
  object by object, deltas resolved, and objects stored by SHA-1; clones
  are answered with freshly built packs containing exactly the objects the
  client lacks. No git binary is involved at any point.
- **One store, four surfaces.** REST, GraphQL and MCP read and write the
  same repositories, issues and pull requests, with ids unchanged across
  reads — a repository created over MCP reads back over REST as the same
  object.
- **Deterministic.** Nothing that reaches stored state or an exported
  answer depends on the wall clock or unseeded randomness, so a final
  trial's replay leaves the same state export byte for byte.
