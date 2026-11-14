# Tonkotsu Ramen — Tall Noodle Pull, Dripping Yolk — food-picture-01

## The picture

A bowl of tonkotsu ramen on a dark wooden table in a dim ramen shop,
shot close so the food fills the frame. Wooden chopsticks lift a tall,
glossy tangle of noodles high above the bowl, steam curling around
them. Below, the creamy broth holds charred chashu pork, a halved soft
egg with its molten yolk dripping down through the noodles, a sheet of
nori, chopped spring onions, sesame and a swirl of red chili oil. Warm
low light, shallow depth of field, droplets of broth glistening on the
noodles.

## Why this one

Every entry at the top of the board is the same shot — the tall ramen
noodle pull, steam, dark table, dripping egg — and the judge rewards it
with a 94% win rate. This picture follows that winning pattern with
its own image: the yolk dripping down through the lifted noodles is the
detail that stops the eye, and the full bowl underneath keeps the shot
rich rather than empty. It still reads at small sizes: noodles, steam,
egg, dark bowl.

## How the program works

`main.py` (Python 3, standard library only) takes `image.png` from the
same directory and copies it to `$MAKEFUN_OUTPUT_DIR/entry.png`
(defaulting to `/output/entry.png` when the variable is unset), creating
the output directory first if it does not exist. Before copying it
checks that the source is a whole JPEG or PNG under the 5 MB limit, and
after copying it compares the SHA-256 hash of the copy against the hash
of the source, raising an error and deleting the copy if they differ.
The output is fully deterministic — the same bytes every run.

The image is a 1920 x 1280 PNG, 2,281,625 bytes.
