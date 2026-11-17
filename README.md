# Token Radar v2 — fitted-curve launch radar

Build the best token launch radar (make.fun `token-radar-01`).

A pre-token protocol's implied value is what its token would be worth if the
market priced it the way it prices the protocols whose tokens already trade —
fitted, not assumed. The program fits a log-log size curve on the snapshot's
own traded tokens, grouped into families so one token never counts twice,
with small category, growth and seasoning tilts fitted by ridge regression,
and validates the fit out of sample before it trusts it.

## What it hands in

- `main.ts` — the program (Node 22, standard library only). Reads the sealed
  snapshot, fits the curve, scores every rankable pre-token protocol, writes
  `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and
  writes `dossier.json`.
- `lib/model.ts` — the model: family grouping, the ridge fit, leave-one-out /
  time-split / walk-forward validation, 200 bootstrap refits for the value
  bands and rank ranges, the coverage rules, and the netted farm economics.
- `dashboard/` — a static page (no network): the board, a detail view for
  every protocol, the fitted formula, the validation numbers, and the farm
  plan. `data.js` (written beside it) carries the rows.
- `screenshots/` — the board, a protocol's detail view, and a filtered view.

## The model

`log10(value) = intercept + slope × log10(TVL) + category tilt + growth tilt + age tilt`,
fitted on 97 traded-token families (CEX and bridge tokens excluded, degenerate
comps with market cap over 10× TVL excluded). Validation is printed on the
board: leave-one-out, time-split and walk-forward median misses, each against
the flat multiple the curve replaces.

## Coverage

198 rows: the 40 watchlist protocols, 24 parent-linked above-floor protocols,
and 134 early below-floor protocols. 203 above-floor protocols are set aside
with stated reasons (multi-product family, bridge/CEX/staking category,
version marker, wrapped/staked product, exchange). Full snapshot accounting
is printed on the board.

## Farm economics

Netted to the dollar on a $1,000 deposit over 26 weeks: the slice is a 5%
community airdrop pool shared pro-rata by deposit, with a fifth of TVL
assumed to farm actively; costs are gas plus the T-bill return the deposit
gives up. The detail view shows the same plan sized to $100 and $10,000.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

The program runs twice in the grader and must write identical bytes both
times; it does — one seeded generator drives the bootstrap, and nothing in
the output depends on the clock or the environment.
