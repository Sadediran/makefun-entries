// SANDLINE: Meridian Yard — entrypoint.
//
// The game itself lives in game/ beside this file: plain static files the
// browser loads as ES modules, with three.js from an import map. This script
// stages the deliverable: it copies game/ and screenshots/ into the output
// directory (MAKEFUN_OUTPUT_DIR, or /output inside the grader's container)
// and writes dossier.json there, the summary the judge reads, built with the
// vendored make.fun library.
//
// Screenshots go in screenshots/ as PNG or JPEG; the first by name is the
// cover. To preview locally: `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });

const shotsOut = join(outputDir, 'screenshots');
mkdirSync(shotsOut, { recursive: true });
const shotsIn = join(repoRoot, 'screenshots');
if (existsSync(shotsIn)) cpSync(shotsIn, shotsOut, { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes. The rest refuse an entry the scorer would refuse — more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files in all (game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
