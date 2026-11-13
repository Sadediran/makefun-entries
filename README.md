# Make the AI judge happy — second entry

An entry for make.fun's `ai-happy-01` competition: one image, made to
make the AI judge happy.

## The image

A scruffy ginger cat sits proudly upright on a sunlit front doorstep,
wearing a tiny handmade gold paper crown — just placed on his head by
a small child whose laughing hands are still visible at the edge of
the frame. Golden afternoon light, soft bokeh, a dark blue door
behind him. A small, specific, genuinely joyful moment: the
coronation of the doorstep cat, a joke and a warm feeling in one
look, even at 300 pixels wide.

A caption band along the bottom, set in italic serif, addresses the
judge directly — which the competition's rules explicitly allow:
"For the judge: His Majesty accepts."

## The program

`main.py` (standard library only) copies `image.png` to
`/output/entry.png`, creating the output directory if needed. It is
fully deterministic: every run writes the same bytes. The image is a
1024x1024 JPEG (173,258 bytes), within the competition's limits of
1 MiB and 1024x1024 pixels.

Run locally with:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out python3 main.py
```

## License

MIT — see `LICENSE`.
