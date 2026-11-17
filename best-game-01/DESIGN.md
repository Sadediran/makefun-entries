# best-game-01 — SELECTED DESIGN BRIEF (build from this)

Status 15 Nov ~18:47 WAT: GLASSKEEP selected. GPT's retry call
delivered a complete proposal (18:45 WAT, $0.237744, inside the
$10 per-call cap Saheed set) and it beats Muse's Emberwatch on the
actual judging criteria — see collaboration/best-game-01/
comparison.md for the full deliberation. Emberwatch is filed as
the runner-up in muse-proposal.md. The build worker MUST re-read
this file at run time and build what it says here.

## The game: GLASSKEEP
Turn-based ricochet defence inside a jewel-toned stained-glass
watchtower. Clockwork moths advance on the tower's core; the keeper
routes a piercing beam through mirrors to destroy them before they
cross the red line. Six-wave runs, about four minutes each.

## Core loop
Each turn: make at most ONE mirror edit (drag a mirror to relocate
it, or click to flip its angle) → the beam preview updates live →
press FIRE (or Space) → the beam fires along its previewed path,
destroying moths it hits → surviving moths advance one tile →
next turn. Each moth crossing the bottom red line costs one of
three core hearts. Clear six waves to win; lose all hearts to lose.

## Systems (all must be real and working, not stubs)
- Board: 7x7 grid. Beam emitter fixed at the top; the red line is
  the bottom row. Mirrors start in a fixed layout; the player moves
  or flips them.
- Beam: ray-traced through mirror reflections. Preview and firing
  MUST use the identical rules (one shared function). Loop guard:
  stop on a repeated ray state. Damage once per enemy per shot.
  Bank shots (beam reflected off mirrors) and multi-kill chains
  score extra.
- 3 enemy types: ordinary moth (1 hit), armoured moth (2 hits),
  explosive moth (damages neighbouring moths when destroyed).
- Waves: six per run. Three tested six-wave schedules, chosen by
  seed at run start. Incoming moths are telegraphed (arrows +
  next-step ghosts) before they move.
- Upgrades: after waves 2 and 4, choose 1 of 3 — an extra mirror,
  wider explosions, or repair one heart.
- Scoring: kills + bank-shot bonus + multi-kill chain bonus +
  intact-core bonus at victory. Local best score saved (local
  storage, no network).
- Screens: explicit start, victory, defeat and retry screens (the
  judge checks for these). HUD: Wave x/6, Core hearts x/3, Score,
  edit budget. Undo allowed before firing. Sound toggle, mute.

## Controls
Mouse (drag mirrors, click to flip, click FIRE) + keyboard (Space
= fire, R = retry, U or Ctrl+Z = undo before firing). Touch
support is a bonus, not a requirement.

## The 4 screenshots — PNG or JPEG ONLY (see correction below)
Each ≤256 KiB, long side ≤1280, short side ≥480. Genuine captures
of the running game via a headless browser — never mock-ups, never
staged mechanics, never edited to misrepresent gameplay. The rules
permit 3 or 4 images in screenshots/ — the submission set holds 4.
Each shot communicates a DIFFERENT competitive strength (Saheed's
visual directive, 15 Nov 19:09 WAT):
1. 01-identity — VISUAL IDENTITY: the most impressive overall view
   of the stained-glass tower — the start screen, title prominent,
   START button clear, the full tower visible in its jewel-toned
   glory. (Also satisfies the house calibration: the judge's reasons
   name the title/start screen.)
2. 02-beam — CORE MECHANIC: the golden beam interacting with
   mirrors and reflections — a bent beam producing a multi-moth
   chain, mirror highlighted, reflection path unmistakable.
3. 03-tactics — GAMEPLAY DEPTH: a meaningful tactical situation
   with enemies — a mirror edit in progress, moths advancing,
   incoming arrows, HUD showing wave/hearts/score/edit budget.
4. 04-late — PROGRESSION: a later-wave situation (wave 5 or 6)
   demonstrating the completed gameplay experience — dense board,
   upgraded state, the game at full maturity.

SIX genuine screenshots are captured in total: the four primary
shots above PLUS one victory screenshot and one defeat screenshot.
The victory and defeat shots are supporting evidence for the
review package UNLESS the final selection (see the end-screen
directive below) places one of them in the submission set. The
final choice of which four images go in screenshots/ is decided at
final review by the Muse + GPT deliberation, justified against the
judge-calibration evidence — it is NOT decided by the builder
alone. The builder preserves all six captures and reports all six.

CORRECTION TO GPT'S PROPOSAL: GPT specified WebP screenshots. The
rules allow PNG or JPEG ONLY — WebP would fail the screenshots
gate. Use PNG or JPEG (JPEG is safer for the 256 KiB cap on the
busy play shot; check each file's size after capture).

## Sound
WebAudio synthesised only (glass chimes on fire/hit, crack on moth
destruction, win sting, defeat toll). User-enabled, with a mute
toggle. No audio assets, no network.

## Tech and structure
Vanilla JS + Canvas 2D, NO libraries (the judge's outline shows our
code only; every line authored in-session). One file per job:
game/index.html (small semantic shell: title, HUD, controls,
outcome panels), game/style.css (responsive layout, jewel palette,
oversized typography, interaction states), game/main.js (lifecycle
controller: input, screens, local-best persistence), game/rules.js
(authoritative deterministic turns, ray tracing, damage, scoring,
outcomes), game/content.js (three six-wave schedules, enemy
definitions, upgrade data), game/render.js (procedural
stained-glass board, readable pieces, previews, combat effects),
game/audio.js (synthesised cues + mute). Static files under game/;
target total under 1 MiB. index.html ≤1 MiB; game/ ≤48 MiB, ≤993
files; no network requests anywhere.

## Visual signature
The golden beam against the jewel-toned stained glass IS the
game's signature — it must be the arresting thing in the cover and
play screenshots. Mirrors must read clearly as mirrors (bright
reflective faces); moths must read as clockwork (brass + gears,
not blobs). The red line must be unmissable.

## Hard rules (from RULES.txt — re-read it in full before building)
- Kit: ~/workspace/makefun/best-game-01-kit/ — RULES.txt is 410 lines.
- Build in a FRESH session started at/after the 19:00 WAT opening
  (thinking_in_window). Run kit init FIRST in the empty repo for the
  anchor line (thinking_fresh). Source-bundle entry. Redact Saheed's
  full name from the bundle.
- NEVER submit without Saheed's explicit approval of the prepared
  entry. Prepare the package, run check, report for approval, STOP.
- Do NOT copy the kit starter (dodge-and-collect = house game #2).
- The entry must be genuinely playable and winnable: verify ALL
  THREE schedules are winnable (scripted or manual playthrough in
  a real browser) before presenting. Test every mirror orientation,
  crossing and boundary case.

## Mandatory QA and finalist readiness (Saheed, 15 Nov 18:56 WAT)

The game must satisfy BOTH screenshot-based judging AND extended
live gameplay evaluation (the top 5 are played live by the make.fun
team for up to 60 minutes). Before presenting the final package,
the builder MUST complete all nine checks below and report the
evidence for each. Do not present a package that skips any of them.

1. RAY TRACING — verify the complete system: multiple mirrors,
   reflection angles, boundary conditions, beam collision detection.
   Preview and firing MUST use one shared function (identical
   rules). Test every mirror orientation, crossing and boundary
   case; confirm the loop guard stops repeated ray states and that
   damage applies once per enemy per shot.
2. ALL SIX WAVES — test every wave and demonstrate that a skilled
   player can complete the game WITHOUT exploiting bugs. Record the
   winning route for each of the three schedules.
3. ENEMY TYPES AND STATE — verify all three enemy types behave
   correctly (ordinary 1-hit, armoured 2-hit, explosive splash on
   death) and that damage, hearts and turn progression stay
   consistent across a full run. No desync between HUD and state.
4. REPEATED FULL-GAME RUNS — play multiple complete runs (all three
   schedules) to find softlocks, unfair difficulty spikes, broken
   interactions and repetitive gameplay. Report what you found,
   including any run that felt repetitive — do not hide it.
5. IMMEDIATE COMPREHENSION — the game must communicate its
   mechanics at once, without lengthy explanations: the start
   screen's three-step rules, a first-turn hint (drag/flip/fire),
   and the always-visible beam preview must be enough for a new
   player to play correctly on turn one.
6. SCREENSHOTS — four strategically selected PNG/JPEG shots
   (spec in the section above) covering, across the set: strongest
   visual identity, the core mechanic, tactical decision-making,
   and gameplay progression. Each shot must show a distinct thing.
7. EXTENDED PLAY — test beyond the initial four-minute run: replay
   across all three schedules, chase local bests and chain records,
   and judge honestly whether the game holds up over repeated
   plays. The replay layer (3 schedules + local bests + chain
   optimisation + intact-core bonus) is what carries extended play
   — verify it works and report any thinness found.
8. DETERMINISM — preserve deterministic behaviour wherever
   possible so the judge can reproduce the same gameplay conditions:
   seeded schedules, deterministic turn rules, no unseeded
   randomness affecting gameplay. Same seed → same run.
9. HONESTY — do NOT conceal unfinished mechanics and do NOT use
   screenshots that misrepresent actual gameplay. Every screenshot
   is a genuine capture of the running game. If something is not
   working, report it as a limitation — never hide it behind a
   staged image.

PRESENT FOR APPROVAL: the completed build, test evidence for all
nine checks, the four screenshots, known limitations and remaining
risks. NO submission, publication or final competition entry
without Saheed's explicit authorisation.

## MASTER DIRECTIVE — FIRST-PLACE OBJECTIVE (Saheed, 15 Nov 19:02 WAT)

The objective is FIRST PLACE on the leaderboard. Merely completing
the assignment, satisfying minimum requirements or producing a
functional game is NOT sufficient. Every decision is evaluated
against its contribution to winning. Optimise for: originality and
creative distinction; visual impact and screenshot quality;
gameplay quality and engagement; technical reliability; ease of
understanding; memorability and judge appeal.

### Development standard (adds to the approved concept + the nine
### QA requirements above — it does not replace them)
- Exceptional visual hierarchy: the beam, the mirrors, the moths
  and the red line must each read instantly, in that order of
  importance.
- Clear, satisfying beam-reflection feedback on every shot (flash,
  sound, visible chain).
- Smooth, purposeful animations — nothing decorative that slows
  play or obscures state.
- Strong tactical decisions: every turn must offer a real choice
  (clear today's threat vs set up tomorrow's bank shot).
- Responsive controls: every input answers at once.
- Meaningful progression across six waves (new enemy mixes, rising
  pressure, the two upgrade choices as real turning points).
- Balanced enemy behaviour (no wave that is trivial, none that is
  unfair).
- A memorable visual identity, consistent across all four
  screenshots.
- Do NOT introduce unnecessary features that increase development
  risk or undermine deterministic gameplay. Scope stays frozen.

### Graphics and detail standard (Saheed, 15 Nov 19:06 WAT)
EVERYTHING — graphics and all details — must be TOP-NOTCH. This
is a pass/fail-level standard, not a nice-to-have.
- No placeholder art, no flat coloured blocks, no default fonts,
  no rough edges anywhere. Every screen (start, play, defeat,
  victory) must look finished and deliberate.
- The stained glass must look genuinely crafted: leaded panes,
  jewel tones with depth and variation, light falling through the
  window — not solid rectangles. The board itself must be beautiful
  at a glance.
- Moths must read as clockwork: brass bodies, visible gear/wing
  detail, distinct silhouettes per enemy type (armoured visibly
  plated, explosive visibly volatile).
- The beam must GLOW: a bright core with a soft halo, a visible
  flash on every reflection and every hit, a satisfying crack
  effect when a moth is destroyed.
- Typography: oversized, confident, consistent; the HUD must be
  legible at screenshot size (~300px wide) as well as full size.
- Polish the small things too: hover states, button feedback,
  heart icons, the red line's warning glow, the victory dawn light.
  A judge notices details — so does a player in a 60-minute review.
- If a visual element cannot be made genuinely good within the
  scope, simplify it to something clean rather than shipping a
  rough version. Clean and confident beats busy and unfinished.

### Evidence standard
A feature is NOT complete because its implementation exists.
Require OBSERVABLE evidence. Never report PASS without supporting
evidence. Record failures, corrections, retests and unresolved
limitations. The verification list is the nine QA checks above,
plus: all three schedules tested; repeated full-game runs succeed;
no softlocks or unavoidable unfair losses; extended gameplay
remains engaging; deterministic behaviour preserved; screenshots
accurately represent the actual game.

### What happens after this build (parent's work, not the builder's)
- Independent critical review by Muse AND GPT (two-agent
  deliberation: independent analysis, challenge weak assumptions,
  compare alternatives on explicit criteria, resolve by evidence —
  agreement without critical examination is NOT validation).
- Competitive review scorecard (internal weights, NOT official):
  Visual presentation 25%, Originality 20%, Gameplay and
  engagement 20%, Technical execution 20%, Judge accessibility and
  memorability 15%. Each agent gives individual scores, strongest
  and weakest features, specific improvements, remaining risks and
  an honest competitive-readiness assessment.
- Final optimisation: the three biggest weaknesses are identified
  and only safe, justified improvements within the approved scope
  are implemented, with affected tests repeated after every change
  and the screenshots reassessed. Do NOT destabilise a verified
  build for cosmetic experimentation.
- Final package presented to Saheed: the finished game, technical
  verification evidence, extended-play results, four authentic
  PNG/JPEG screenshots, independent Muse and GPT evaluations, the
  competitive scorecard, known limitations and remaining risks,
  recommended final improvements, and a clear SUBMIT or DO NOT
  SUBMIT recommendation.

### Financial and operational restrictions (unchanged)
- $10 individual GPT cap, $25 cumulative budget cap. No additional
  paid expenditure without authorisation.
- No submission, publication or external commitment without
  Saheed's explicit approval. Saheed retains final decision-making
  authority.

FINAL PRINCIPLE: do not confuse completion with excellence,
confidence with evidence, or agreement with correctness.

## MASTER VISUAL EXCELLENCE DIRECTIVE (Saheed, 15 Nov 19:09 WAT)

Visual quality is a PASS/FAIL release requirement. The game must
NOT look like a prototype, template, unfinished indie project or
basic web-game experiment. The objective is a visually exceptional,
professionally art-directed game capable of competing with the
strongest entries on the leaderboard.

### 1. Overall art direction
One coherent, premium visual identity. The experience must
communicate: gothic fantasy; intricate stained-glass craftsmanship;
elegant medieval architecture; magical golden illumination;
mechanical clockwork creatures; atmospheric depth and visual
richness. Every element belongs to the same artistic world. Avoid
generic AI-game aesthetics, inconsistent art styles, excessive
visual clutter and cheap-looking effects.

### 2. Environment and stained glass
The stained-glass tower must be a visual masterpiece: intricate
geometric and ornamental glass patterns; beautiful jewel-tone
colour combinations; detailed leaded-glass divisions; convincing
translucent glass effects; carefully designed architectural frames;
atmospheric lighting and shadows; layered environmental depth;
reflections and illumination that respond appropriately to
gameplay. NO plain coloured backgrounds or flat geometric
substitutes.

### 3. Characters and enemy design
Moths must look like carefully designed mechanical creatures:
distinctive clockwork anatomy; detailed brass and metallic
components; articulated wings; recognisable silhouettes;
appropriate movement animations; distinct visual characteristics
for each enemy type; clear visual communication of enemy states.
Enemies must remain recognisable against the background.

### 4. Beam and visual effects
The golden beam is the signature feature: clear beam trajectories;
beautiful golden illumination; controlled bloom and glow;
convincing mirror-reflection effects; impact animations; subtle
particles and light effects; distinct feedback when enemies are
hit; visually understandable reflection paths. Visual effects must
NEVER obscure important gameplay information or misrepresent the
actual ray-tracing calculations.

### 5. Complete user interface
Every screen gets the same design attention as the gameplay
environment: main menu; instructions and tutorial; gameplay HUD;
wave indicators; hearts and health; mirror controls; turn
indicators; beam preview; pause screen; victory screen; defeat
screen; restart and progression screens. Intentional typography,
consistent iconography, premium buttons, excellent spacing, clear
information hierarchy. NO default fonts, unfinished controls,
generic browser buttons or inconsistent interface elements.

### 6. Animation and interaction polish
All interactive elements feel responsive and deliberate: smooth
transitions; carefully timed animations; satisfying mirror
movement; immediate interaction feedback; natural enemy movement;
appropriate attack and impact animations; polished menu
transitions; clear feedback for successful and unsuccessful
actions. Do NOT sacrifice performance or deterministic gameplay
for unnecessary visual effects.

### 7. Visual quality assurance (before declaring visual PASS)
Inspect EVERY screen at the actual intended display resolution.
Check for: pixelation; blurry assets; misaligned elements; broken
proportions; inconsistent typography; poor contrast; text
overflow; unfinished artwork; missing animations; visual glitches;
clipping and overlapping; performance degradation; poor scaling.
Record ACTUAL EVIDENCE for every critical check. Never report
visual PASS without supporting evidence.

### 8. Independent visual evaluation (parent's work, after the build)
Muse and GPT independently assess the completed visual
presentation using this internal visual scorecard (NOT official
criteria): Environment and artwork 25%; Character and enemy design
15%; Lighting and visual effects 20%; UI and typography 20%;
Animation and transitions 10%; Overall artistic consistency 10%.
GPT must NOT claim to have visually inspected images it cannot
access — it assesses the design evidence and screenshot
descriptions; the actual pixels are inspected by Muse (who can
read the image files) and by Saheed at approval.

### 9. Mandatory release gate
Visual quality is evaluated SEPARATELY from technical gameplay
quality. A technically functional game with mediocre graphics is
NOT ready. A visually beautiful game with broken mechanics is NOT
ready. BOTH must pass. If any significant visual weakness remains:
identify it; recommend a specific improvement; assess
implementation and regression risks; implement ONLY safe
improvements; retest affected functionality; reassess the finished
result. Do not introduce unnecessary scope or destabilise the
verified build.

FINAL INSTRUCTION: no placeholder graphics. No flat, lifeless
environments. No default typography. No unfinished screens. No
rough visual edges. No fake polish. Every screen, asset, animation,
effect and interaction must demonstrate deliberate craftsmanship.

## FINAL SCREENSHOT STRATEGY & END-SCREEN QUALITY DIRECTIVE
## (Saheed, 15 Nov 19:13 WAT)

A polished gameplay experience is incomplete without polished
victory and defeat experiences. Both end screens must exist, look
professional, function correctly and be verified.

### Victory screen — mandatory quality verification
Fully designed, implemented and tested: a memorable completion
presentation; elegant visual effects; consistent stained-glass art
direction; clear victory messaging; appropriate completion
statistics (score breakdown, chain record, intact-core bonus, saved
best); a polished replay/restart option; smooth transitions. The
player must feel rewarded for completing all six waves. Capture at
least one genuine victory screenshot for the supporting evidence
package.

### Defeat screen — mandatory quality verification
Equal design attention: a deliberate visual composition; clear
defeat messaging; consistent typography and visual identity;
appropriate feedback on the failed run (wave reached, score, local
best); a polished retry/restart option; smooth transitions. It must
look like an intentional part of the game, not an error screen.
Capture at least one genuine defeat screenshot for supporting
evidence.

### End-screen functional testing (verify both independently)
- Victory triggers ONLY after legitimate completion (all six waves
  cleared). Defeat triggers ONLY under the correct loss conditions
  (all three hearts lost). No accidental premature endings.
- Restart resets the game correctly; replay does not preserve
  unintended previous state (score, hearts, wave, mirrors, upgrades
  all reset).
- No broken controls or softlocks on either end screen.
- No incorrect wave, score or health information on either screen.
Record evidence for each test.

### Judge calibration and screenshot selection (final review)
Review the actual judging requirements and the calibration
evidence before finalising the four-image set. Do NOT assume four
gameplay-oriented images automatically satisfy every judging
expectation. KNOWN CALIBRATION EVIDENCE (from RULES.txt): more
than four in five of the judge's reasons named a start, title, end
or restart screen — end screens matter to the judge's assessment.
The final selection weighs that evidence against the competitive
strength of each gameplay shot; the live question is whether the
victory screen should displace the late-wave progression shot as
the fourth image. The selection is decided at final review by Muse
and GPT independently challenging it, and the justification is
presented to Saheed with the package.

### Final screenshot integrity
All six screenshots: from the actual completed game; PNG or JPEG;
real implemented mechanics; no fabricated or staged gameplay; no
misleading post-processing; captured at an appropriate resolution;
each clearly demonstrating its intended feature.

### Final review requirements
Present: (1) the four proposed primary screenshots; (2) the
supporting victory and defeat screenshots; (3) end-screen
functional test evidence; (4) a justification for the final
screenshot selection; (5) any remaining visual or gameplay
limitations. Muse and GPT independently challenge the screenshot
selection and explain whether it maximises judge appeal.

### FINAL RELEASE CONDITION
Do not submit until the technical gate, the visual gate AND the
competition-readiness review have ALL passed. Saheed retains final
submission authority.
