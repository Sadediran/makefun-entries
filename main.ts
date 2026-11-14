// Entry <-> env lifecycle for github-core-clone-01.
//
// This process is the forge's server, not a script that finishes: it stays
// up for the whole trial. The suite scores the server app.ts builds; this
// file only owns the handshake with the env that runs beside it:
//
//   1. MAKEFUN_ENV_URL names the env's origin. Without it there is nothing
//      to talk to, so the process exits 1 at once.
//   2. Bind an ephemeral port (listen(0): the kernel picks one). Never bind
//      8080 — the env owns it, and on the one-pod layout it shares loopback.
//   3. POST {"port": N} to $MAKEFUN_ENV_URL/register. The env records the
//      address the request came from plus N as the base URL and dials it
//      from then on. The first register wins; a 409 means another entry
//      already registered, and this process keeps waiting like any other.
//   4. Poll GET $MAKEFUN_ENV_URL/done until it answers {"done": true}.
//      The env answers at once ({"done": false} while the suite runs), so
//      this is a poll, never a long-held request.
//   5. Close the server and exit 0. The harness then stops the env, which
//      writes the export the scorer reads.
//
// main.ts imports its own server and nothing else: no package, no Node
// built-in beyond what app.ts needs, no model call.

import { createApp } from './app.ts';

/** The env's origin, with any trailing slashes stripped. */
const envOrigin = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');

if (envOrigin === '') {
  process.stderr.write('[entry] MAKEFUN_ENV_URL is not set: there is no env to register with\n');
  process.exit(1);
}

/** Longest a single register or done request may run before it is dropped. */
const REQUEST_BUDGET_MS = 30_000;
/** First pause between retries, and the longest pause allowed. */
const RETRY_FIRST_MS = 250;
const RETRY_CEILING_MS = 2_000;

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Pause after the `n`th failed attempt: exponential, capped at the ceiling. */
function backoffMs(n: number): number {
  return Math.min(RETRY_CEILING_MS, RETRY_FIRST_MS * 2 ** Math.min(n, 8));
}

/**
 * Tell the env which port the forge bound, retrying until it accepts. 200
 * is the normal answer and 409 means a first register already won (not
 * this process's to fix), so both return. 400/405 are contract errors and
 * end the program; anything else is retried, since the env may still be
 * starting.
 */
async function announcePort(port: number): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    let fatal = false;
    try {
      const reply = await fetch(`${envOrigin}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port }),
        signal: AbortSignal.timeout(REQUEST_BUDGET_MS),
      });
      if (reply.status === 200 || reply.status === 409) return;
      if (reply.status === 400 || reply.status === 405) {
        fatal = true;
        throw new Error(`register answered HTTP ${reply.status}: ${await reply.text()}`);
      }
    } catch (err) {
      if (fatal) throw err;
    }
    await pause(backoffMs(attempt));
  }
}

/** Keep asking GET /done until the env answers {"done": true}; never return early. */
async function awaitDone(): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const reply = await fetch(`${envOrigin}/done`, { signal: AbortSignal.timeout(REQUEST_BUDGET_MS) });
      if (reply.ok) {
        const payload = (await reply.json()) as { done?: unknown };
        if (payload.done === true) return;
      }
    } catch {
      // The env is not answering yet, or the poll timed out: it is not
      // done, so poll again.
    }
    await pause(backoffMs(attempt));
  }
}

/** Bind the port, announce it, then wait for the env: the whole life of the process. */
async function run(): Promise<void> {
  const server = createApp();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });
  const bound = server.address();
  if (bound === null || typeof bound === 'string') {
    throw new Error('the server did not bind an ephemeral TCP port');
  }
  process.stdout.write(`[entry] listening on port ${bound.port}\n`);

  await announcePort(bound.port);
  process.stdout.write('[entry] registered; waiting for the env to say done\n');

  await awaitDone();
  server.close();
  process.stdout.write('[entry] done\n');
}

try {
  await run();
  process.exit(0);
} catch (err) {
  process.stderr.write(`[entry] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
