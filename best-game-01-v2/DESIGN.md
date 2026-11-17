# GLASSKEEP v2 — "The Four Towers" — Build Brief (Sun 15 Nov 2026 ~22:42 WAT)

**Competition:** make.fun best-game-01, "Make the best game". $1,000 pot (1st $400 / 2nd $200 / 3rd $120 / 4th-10th $40). Deadline **Wed 18 Nov 2026 19:00 WAT** (18:00 UTC). Entry fee $0.00. Submission title: **GLASSKEEP** (subtitle "The Four Towers" in the dossier only).
**Target:** TOP 5. v1 scored 75.70% (rank 95 of 1,767). The judge's verdicts on v1 (read in full) praise originality and completeness but kill us on **"one board and one mode"** — depth means CONTENT BREADTH AND VARIETY. This v2 exists to answer that phrase.
**Repo:** `~/workspace/makefun/entries/best-game-01-v2/` (NEW directory — do NOT copy any file from the v1 repo `~/workspace/makefun/entries/best-game-01/`. Author EVERY line in this session from this brief. Lines first seen in a READ can never become authored — so do not open v1's files to copy them. You may read the KIT only.)
**Kit:** `~/workspace/makefun/best-game-01-kit/` — re-read RULES.txt IN FULL before building, and verify every hard number below against it as it stands now.

## HARD RULES (verify against RULES.txt before building)
- Static files under game/, no build step, NO network requests (no fonts, no images from the web, no fetch/XHR).
- game/ ≤ 993 files+dirs, 48 MiB; index.html ≤ 1 MiB.
- Screenshots: 3-4 PNG/JPEG, each ≤ 256 KiB, long side ≤ 1280, short side ≥ 480; FIRST by name is the cover.
- Keyboard+mouse. Complete game: goal, rules, responsive controls, win/lose/score, start + restart, HUD — all shown in screenshots. Original only.
- main.ts copies game/ + screenshots/ to /output and writes dossier.json via buildDossier (vendor/makefun-game.ts UNCHANGED, byte-identical to kit). Dossier text ≤ 163,840 bytes.
- The judge sees: a JPEG contact sheet of the 4 screenshots + a short source outline, in 1,536 input tokens. Criteria in order: (1) complete game, (2) fun and depth, (3) feel and polish, (4) look and originality, (5) structure.

## THE GAME
Turn-based ricochet defence in a stained-glass watchtower. The player defends FOUR towers. Each tower is a distinct 7x7 board. One mirror edit per turn (flip a mirror's angle or move a mirror to an empty cell), then FIRE: a golden beam leaves the emitter, ricochets through mirrors, and kills moths in its path. Moths advance one tile per shot toward the bottom line; a moth reaching it costs a heart (Grand Moth costs 2). Clear all assaults in a tower to defend it; defend all four to win the campaign.

### The four towers (all selectable from the start; escalating difficulty)
Same 7x7 grid for all; each tower is a DISTINCT LAYOUT defined in data: different mirror starting positions, different emitter column, different buttress (opaque, beam-blocking) cells, different spawn lanes. Each tower has its own palette and enemy mix.
1. **Ember Tower** — red/gold, gentle. 3 assaults (3, 4, 5 moths). Guardian: **The Ember Warden** (assault 3).
2. **Verdigris Tower** — green/teal, normal. 3 assaults (4, 5, 6 moths). Guardian: **The Verdigris Warden**.
3. **Gilt Tower** — gold/white, hard. 3 assaults (5, 6, 7 moths). Guardian: **The Gilt Warden**.
4. **Sable Tower** — deep violet/dark, brutal. 3 assaults (6, 7, 8 moths). Final boss: **THE GRAND MOTH** (assault 3).
- Region-select map screen: the four towers with name, palette, difficulty, best grade, defended state, and the campaign total (towers defended 0/4). Each tower shows its best grade once played.
- Per-tower state persists in localStorage: best grade, best score, defended or not, campaign total. A reset option clears it. Determinism: runs are deterministic PER SEED (seeded assault schedules); localStorage holds only best records, never run randomness.

### Assaults
- Each tower: 3 assaults. Assaults 1-2 are moth waves; assault 3 adds the Guardian/Grand Moth alongside a smaller moth group.
- Assaults are seeded schedules (fixed per tower, data-driven). No unseeded randomness anywhere.
- Between assaults: the Embers craft screen (see Economy) and, after assaults 1 and 2, the relic draft (see Relics).

### Enemy types (4 + bosses)
- **Silk Moth** — 1 HP, 10 pts. Standard.
- **Iron Moth** — 2 HP, 25 pts. Armoured (needs two beam hits; track damage per moth per shot — damage once per enemy per shot, as v1).
- **Powder Moth** — 1 HP, 15 pts. On death, bursts and wounds adjacent moths for 1 (chain reactions allowed, loop-guarded).
- **Warden Moth** — 3 HP, 30 pts. SHIELDS adjacent moths: moths adjacent (orthogonal) to a living Warden take NO beam damage until the Warden is destroyed. Show the shield visually (a faint ring on shielded moths).
- **Guardians** (towers 1-3, assault 3) — named, 4 HP, 50 pts, health bar shown, costs 1 heart on breach.
- **THE GRAND MOTH** (Sable, assault 3) — named, 6 HP, 100 pts, large sprite, health bar shown, costs 2 hearts on breach. (No summoning — keep the boss rule simple and testable.)
- All moths advance exactly one tile per shot. No moth is faster. Moth sprites must be BIGGER than v1's, with distinct wing patterns and colours per type (readable at screenshot size — v1's moths read as bees).

### Economy — Embers (per tower run; starts at 0 each tower)
- Earn: +1 per Silk killed, +2 per Iron/Warden killed, +2 per Powder killed, +5 per Guardian, +10 per Grand Moth, +5 per assault cleared.
- Spend between assaults (craft screen, 3 options, each purchasable once per gap):
  1. **Mend the Core** — +1 heart, 8 Embers.
  2. **Spare Mirror** — +1 mirror on the board (placed on a chosen empty cell), 10 Embers.
  3. **Reinforce the Tower** — +1 max heart (max 5 hearts), 6 Embers.
- Unspent Embers convert to score at tower end: +10 score per Ember. Show the Ember count in the HUD at all times.

### Relics — draft after assaults 1 and 2 (pick 1 of 3, from a pool of 9)
Relics are passive bonuses for the rest of the tower run. Shown in the HUD as a relic list. All must be implemented as modifiers on existing rules (no new core systems):
1. **Gilded Lens** — the beam deals +1 damage to the first moth it hits each shot.
2. **Amber Charm** — +2 Embers per assault cleared.
3. **Iron Sash** — +1 max heart.
4. **Powder Keg** — Powder bursts wound for 2 instead of 1.
5. **Swift Glass** — +1 mirror edit per turn (2 edits instead of 1).
6. **Ember Heart** — start each assault with +3 Embers.
7. **Silver Thread** — +5 extra score per chain kill.
8. **Warden's Bane** — Warden moths lose their shield (adjacent moths unshielded).
9. **Dawn Prism** — the beam's first reflection deals +1 damage.
- Draft screen: 3 cards, each with name, icon, and one-line effect. Pick 1 by click/tap. The draft must be deterministic per seed (same seed = same offered relics).

### Scoring and grades
- Kill scores as above; +5 per reflection banked; +20 per extra chain kill; +10 per unspent Ember at tower end; +50 intact-heart bonus per heart standing at tower end.
- Per-tower grade (S/A/B/C) from score + hearts standing + turns used; thresholds in data, shown on the victory screen. Campaign grade from the four tower grades.
- Best score and best grade per tower persist in localStorage.

### Screens (ALL polished to the same standard — see Visual Directive)
Start/title (title prominent, START clear, systems enumerated, sound toggle) → region-select map → gameplay (HUD: tower, assault, turn, hearts, score, Embers, relics, best) → craft screen → draft screen → pause (resume + restart) → per-tower victory (grade, stats, relics used, Embers earned/spent, next tower) → campaign victory (all 4 defended: total score, total grade, per-tower grades, build recap) → defeat (run feedback, retry). Restart resets the tower run correctly; replay preserves no unintended state.

### Controls
Tap/click a mirror to flip; drag a mirror to move it; tap FIRE; Undo (one edit back); keyboard: arrows/WASD move selection, F fire, U undo, P pause, M mute. Touch-first (Saheed plays on his phone).

### Beam and trace rules (verify by unit test)
- ONE shared trace function used by both the preview line and the actual FIRE (the preview must never lie).
- Beam travels from the emitter through mirrors (each mirror reflects once per pass); loop guard (max bounces, e.g. 64); damage once per enemy per shot; Powder bursts chain with a loop guard; Warden shields checked before damage; Dawn Prism / Gilded Lens modifiers applied in the documented order.
- No network, no secrets, no wallet code. No debug handle that changes rules (a read-only state inspector is acceptable; v1's window.GLASSKEEP was reviewed harmless — keep the same policy: read-only, no rule changes).

### Files (12-15 single-job modules — the judge reads file count as scope)
game/index.html, game/style.css, game/main.js (bootstrap + screen flow), game/rules.js (trace + combat), game/content.js (towers, layouts, enemies, relics data), game/economy.js (Embers + crafts), game/draft.js (relic draft), game/boss.js (Guardians + Grand Moth), game/render.js (board rendering), game/towers.js (region map + campaign state), game/save.js (localStorage bests/grades), game/audio.js (WebAudio-synthesised, no files), game/particles.js (VFX), game/ui.js (HUD + overlays). Plus main.ts + vendor/makefun-game.ts (kit, unchanged). main.ts copies game/ + screenshots/ and writes dossier.json.

### Dossier text (main.ts)
Enumerate the systems explicitly (the judge infers systems from the dossier): "4 TOWERS · 12 ASSAULTS · 4 MOTHS + THE GRAND MOTH · 9 RELICS · 3 EMBER CRAFTS". Name each tower, each enemy type with its rule, each relic with its effect, the economy, the grades. Keep the dossier text under the 163,840-byte cap.

## MANDATORY QA DIRECTIVE (Saheed, 15 Nov ~18:56 WAT — applies in full to v2)
Nine checks WITH EVIDENCE (write ~/workspace/makefun/qa-best-game-01-v2/QA-REPORT.md):
1. Ray-tracing verified (shared preview/fire function, loop guard, damage once per enemy per shot; Warden shields; Powder chains).
2. ALL FOUR towers winnable without exploits; winning routes recorded for all four towers (autoplay through the real UI).
3. All four enemy types + Guardians + Grand Moth + HUD/state consistency; all 9 relics functional (unit test each).
4. Repeated full runs across all four towers; honest reporting including repetitive runs.
5. Mechanics communicated immediately (start rules, first-turn hint, always-visible preview, per-tower intro card).
6. Four strategic PNG/JPEG screenshots (see Screenshot Strategy) + 2 supporting (start + defeat).
7. Extended play beyond the first run (multiple full campaigns).
8. Deterministic behaviour (seeded schedules, no unseeded randomness; replay the same seed to identical results).
9. No concealed unfinished mechanics, no misleading screenshots.
Present build + evidence + screenshots + limitations + risks for explicit approval. NO SUBMISSION — the parent submits only after Saheed approves the finished package.

## MASTER DIRECTIVE — FIRST-PLACE OBJECTIVE (Saheed, 15 Nov ~19:02 WAT)
The objective is FIRST PLACE (Saheed's target: TOP 5). Merely completing the assignment is NOT sufficient. Optimise originality, visual impact/screenshot quality, gameplay quality, technical reliability, ease of understanding, memorability/judge appeal. Scope stays frozen — no unnecessary features that increase risk or undermine determinism. Evidence standard: never report PASS without supporting evidence; record failures, corrections, retests, unresolved limitations. Do NOT fabricate competitor information. "Do not confuse completion with excellence, confidence with evidence, or agreement with correctness."

## MASTER VISUAL EXCELLENCE DIRECTIVE (Saheed, 15 Nov ~19:09 WAT)
Visual quality is a PASS/FAIL release requirement, evaluated SEPARATELY from technical quality — both must pass. The game must NOT look like a prototype/template.
- Art direction: gothic fantasy, intricate stained-glass craftsmanship, elegant medieval architecture, magical golden illumination, clockwork creatures, atmospheric depth. NO plain coloured backgrounds (v1's flat dark margins are FIXED: each tower has a background illustration — a tower silhouette / stained-glass window scene — in the margins), NO flat geometric substitutes, NO placeholder art, NO default fonts (system serif + CSS letterspacing/weight/colour for the title treatment — no font downloads, no network).
- Enemies: distinctive clockwork anatomy, brass/metallic detail, distinct silhouettes per type, clear state communication (damage, shield, boss health bars).
- Beam/VFX: golden illumination, controlled bloom, mirror-reflection effects, impact feedback — VFX must NEVER obscure gameplay info or misrepresent the ray tracing.
- UI: EVERY screen (menu, map, instructions, HUD, craft, draft, pause, victory, defeat, restart) gets the same attention — intentional typography, premium buttons, clear hierarchy.
- Animation: smooth, purposeful, never at the cost of performance or determinism.
- Victory and defeat screens must exist, be polished to the same standard, and be verified in QA.

## FINAL SCREENSHOT STRATEGY (Saheed, 15 Nov ~19:13 WAT)
SIX genuine screenshots captured — 4 primary + 1 start + 1 defeat (the extra two are supporting evidence; the rules permit max 4 in screenshots/).
1. **COVER (must be GAMEPLAY — the judge called v1's cover "a wall of instruction text"):** a beam shot mid-assault, golden beam through mirrors, chain feedback visible.
2. **Region-select map:** the four towers, campaign total, best grades — the breadth, in one frame.
3. **Depth:** the relic draft (3 cards) OR the Grand Moth boss assault (health bar, named boss). Choose whichever reads better at screenshot size; record why.
4. **Progression:** campaign victory with total grade, per-tower grades, run stats.
5. Supporting: start/title screen. 6. Supporting: defeat screen.
- All 4 submitted shots must show DISTINCT game states (the judge criticised v1: "only two small screenshots show actual play"). Header fully visible in every frame (v1's framing fix: capture at a size that shows the whole game area; verify by viewing each shot).
- Screenshot integrity: actual game only, PNG/JPEG, real mechanics, no fabrication/staging/misleading post-processing.

## FINAL RELEASE CONDITION
Do not submit until the technical gate, the visual gate AND the competition-readiness review have ALL passed. Saheed retains final submission authority. The builder's job ends at a PREPARED package: repo + QA report + screenshots + evidence + limitations + risks. The parent verifies, evaluates (independent Muse + GPT review), and presents the package to Saheed for submit approval.

## DELIVERABLES (from the builder session)
1. Repo `~/workspace/makefun/entries/best-game-01-v2/` (git init, repo-local identity Saheed <saheed222215@gmail.com>, main.ts + vendor + game/ + screenshots/; commit with a clear message).
2. `~/workspace/makefun/qa-best-game-01-v2/QA-REPORT.md` (all 9 checks with evidence).
3. Six screenshots (4 in screenshots/, 2 supporting in evidence/ under the QA dir).
4. `check` run passing (kit check, with the transcripts bundle — the PARENT handles bundling after the build; the builder must keep its session file available and must NOT delete anything).
5. A build report: what was built, what was tested, what failed and was fixed, what remains unverified, the risks.
