// GLASSKEEP v2 — "The Four Towers": entry program for make.fun best-game-01.
//
// Hands the game in: copies game/ and screenshots/ from this repository into
// the output directory and writes dossier.json with the kit's buildDossier.
// Runs on Node 22+ with the standard library only, no network, no install.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The dossier caps are the competition's own gate numbers: the text cap, the
// screenshot count and byte caps, and the game/ entry and byte caps.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function main(): void {
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const gameSrc = join(repoRoot, 'game');
  const shotsSrc = join(repoRoot, 'screenshots');

  if (!existsSync(gameSrc)) throw new Error('main.ts: game/ is missing from the repository');
  if (!existsSync(shotsSrc)) throw new Error('main.ts: screenshots/ is missing from the repository');

  // Start from a clean output directory so a stale file can never leak in.
  // Clear its CONTENTS, never the directory itself: in the grader /output is
  // a volume mounted on a read-only root filesystem, so removing /output
  // itself fails (EACCES on its read-only parent) and the run exits non-zero.
  // v2.1's rmSync(outDir) did exactly that and was rejected for run_completes.
  mkdirSync(outDir, { recursive: true });
  for (const entry of readdirSync(outDir)) {
    rmSync(join(outDir, entry), { recursive: true, force: true });
  }
  cpSync(gameSrc, join(outDir, 'game'), { recursive: true });
  cpSync(shotsSrc, join(outDir, 'screenshots'), { recursive: true });

  // The dossier is built from the output copy itself, so it always describes
  // exactly what was handed in.
  const dossier = buildDossier(outDir, DOSSIER_CAPS);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`main.ts: wrote ${outDir} (dossier.json ${dossier.length} bytes)`);
}

main();
