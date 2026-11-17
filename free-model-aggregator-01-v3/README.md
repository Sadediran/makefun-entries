# free-model-aggregator-01 v3

A risk-aware free-model aggregator: one server, two client wires (OpenAI
Chat Completions, Anthropic Messages), ten free providers on three upstream
wires (openai, anthropic, gemini). Node 22, standard library only, no
dependencies, no model calls, no keys.

## The router (lib/router.ts)

A per-request risk-aware policy, tuned on a fixed Monte Carlo simulator
(2,000 random instances drawn faithfully to the kit's public generator).
Every pick costs weighted quality loss + 400 x P(the provider's next call
fails); the cheapest candidate wins inside a quality budget of 382 loss
units (the quality-99 boundary). Refusals are classified from the
provider's own message: budget/outage are permanent (dead); a scheduled
refusal is isolated — that fail-call is spent, so the provider's next call
is safer.

The one structural idea over v2 is **same-first failover**: a tried
provider that is not dead is ranked alongside untried providers by cost,
not held back as a last resort. Retrying a provider right after its
scheduled failure beats moving to a fresh provider's 2nd call, because
the fail-call is spent. Measured in the fixed simulator: expected calls
22.77 vs 23.23 for v2's policy, P(quality 99) 0.94 vs 0.57, and the tail
(25+ calls) collapses from 396 to 126 per 2,000 trials.

JSON-mode requests on the OpenAI client wire never ride an
anthropic-wire provider (the env's anthropic parser sets jsonMode false
always, so the echo_json check would fail and the request be invalid).

## Layout

- `main.ts` — the server: routes, the serving loop (pick, call, re-pick
  on refusal), register, /work polling, --list.
- `lib/brief.ts` — the brief's three documents, parsed by schema; the
  catalog built from the brief alone (no probing: the ratings table is
  the sealed truth and matches the reference catalog exactly).
- `lib/router.ts` — the risk model and the pick.
- `lib/wire.ts` — all six client x upstream translations, plus the
  client responses. Streaming is buffered: the upstream stream is read
  whole, then re-emitted as the client's own stream.

Deterministic: no wall clock, no unseeded randomness, one provider call
in flight, fixed tie-breaks — a replay reproduces the trial byte for byte.
