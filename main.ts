// news-image-01 entry (Node 22, standard library only): the program copies
// the front-page image beside it to /output/entry.png. The image is drawn by
// draw.py in this repository: a one-page newspaper front page summing up
// Friday 13 November 2026 — Ukraine peace talks lead, plus the Gulf, Nvidia,
// the Microsoft outage, Gaza, Delhi's smog and Washington, with five more
// stories in the footer strip.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
copyFileSync(new URL('./entry.png', import.meta.url), join(outDir, 'entry.png'));
