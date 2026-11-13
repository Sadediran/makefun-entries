# Make the AI judge happy

An entry for make.fun's `ai-happy-01` competition: one image, made to
make the AI judge happy.

## The image

A grandfather laughing with his eyes crinkled shut while his toddler
grandchild — party hat on — gleefully smears birthday-cake frosting
onto his nose. Golden afternoon light, a candle-lit birthday cake
softly blurred behind them. A small, specific, genuinely joyful
moment: the kind of warmth that lands in one look, even at 300 pixels
wide.

## The program

`main.py` (standard library only) copies `image.png` to
`/output/entry.png`, creating the output directory if needed. It is
fully deterministic: every run writes the same bytes. The image is a
1024x1024 JPEG (198,401 bytes), within the competition's limits of
1 MiB and 1024x1024 pixels.

Run locally with:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out python3 main.py
```

## License

MIT — see `LICENSE`.
