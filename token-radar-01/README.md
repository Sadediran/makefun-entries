# Token Radar — pre-token protocols ranked by implied value

A make.fun entry for the `token-radar-01` bounty. The program reads the sealed
DefiLlama snapshot, prices every pre-token protocol by the market's own yardstick — the
median market-cap-to-TVL of the listed protocols in its category — and renders a
filterable dashboard with a farm plan for each protocol.

## Model (radar-peer-1)

```
implied = round( TVL x peer multiple
               x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
               x (0.6 + min(age_days, 1095) / 1095 x 0.4)
               x (1 + 0.03 x min(chains - 1, 5)) )
```

The peer multiple is the median `mcap_usd / tvl_usd` of the listed protocols in the
row's own category (at least 3 peers; otherwise the global median across all listed
protocols), winsorised to 0.005–1.5. No protocol name is special-cased. The board covers
all 40 watchlist protocols plus the 160 largest pre-token protocols below the $50M
floor, excluding wrapped, staked and bridged products of tokens that already trade.
Live-token protocols are set aside with their market caps shown, never mixed into the
ranking.

Honesty rules: a protocol "records no token" — the snapshot says so, it is not proof
it has none. Implied value is this radar's own estimate, not a price, and nothing here
predicts whether or when a token launches.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22+, standard library only. `main.ts` writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` to the output directory.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the outputs
- `lib/model.ts` — the peer-multiple model, the board builder and the farm plans
- `vendor/makefun-board.ts` — the vendored make.fun dossier library
- `dashboard/` — the static page (index.html, app.css, app.js; no network, no framework)
- `screenshots/` — the board, a protocol's detail view and a filtered view
