# Free Model Aggregator

One server that speaks two client wires — the OpenAI Chat Completions API
(`POST /v1/chat/completions`) and the Anthropic Messages API
(`POST /v1/messages`), each in JSON and in server-sent events — over the
ten simulated free-tier providers a trial's brief describes, and answers
every request with the best-rated free model that meets its requirements.

## How it works

- Reads the brief at `MAKEFUN_PROMPT_FILE`: the provider directory, the
  sealed quality table and the workload manifest.
- Probes each provider's catalog route in its own wire (OpenAI, Anthropic
  or Gemini) and builds one catalog, printed byte-for-byte by
  `python3 main.py --list` and registered with the env.
- `GET /v1/models` answers in the shape the auth header names
  (`Authorization: Bearer` → OpenAI list, `x-api-key` → Anthropic list),
  listing exactly the free models registered.
- Routing: for each request, the free models meeting its requirements
  (tools, vision, JSON mode, minimum context) are ranked by the quality
  table's `rating_milli`, ties spreading across providers by calls made so
  far. A JSON-mode request on the OpenAI wire never goes to an
  Anthropic-wire provider, whose wire cannot carry `response_format`.
- Failover: a provider that refuses (402/429/5xx) is counted and the
  request is answered by the next-best free model that meets it. A provider
  that refuses three calls in a row, or reaches the sealed table's maximum
  call count, is left alone for the rest of the trial.
- Translation is faithful both ways: the system prompt, user text and
  images, tool definitions and tool results, stop sequences, `max_tokens`
  and JSON mode are carried into the provider's wire untouched, and the
  provider's text, usage counts and stop reason are returned in the wire
  the client used, mapped (`end_turn` → `stop`, `max_tokens` → `length`,
  `tool_use` → `tool_calls`, `refusal` → `content_filter`).
- Deterministic: every choice is a function of the brief, the requests and
  the providers' answers so far — no wall clock, no unseeded randomness —
  so a replay leaves the same state export.

## Run

```sh
python3 main.py --list   # print the catalog and exit 0
python3 main.py          # serve the trial: register, answer, exit 0 when done
```

Python 3.13 standard library only; nothing is installed.
