# Tonkotsu Ramen — Tall Wavy Noodle Pull, Droplets Falling — food-picture-01

## The picture

A bowl of tonkotsu ramen on a dark slate table in a dim ramen shop,
shot close so the food fills the frame. Wooden chopsticks lift a tall,
wavy tangle of glossy noodles high above the bowl, steam curling
around them, with droplets of broth caught falling back into the bowl
below. The creamy broth holds charred chashu pork, a sheet of nori,
chopped spring onions and a halved soft egg whose golden yolk runs
into the broth, with a swirl of red chili oil across the surface.
Warm low light, shallow depth of field, the noodles shining wet.

## Why this one

Every entry at the top of the board is the same shot — the tall ramen
noodle pull, steam, dark table, dripping egg — and the judge rewards
it with a 94% win rate. Our v2 drew from that pattern with a straight
noodle lift and a dripping yolk and scored 88.4% in development, no
better than the cheeseburger it replaced. This is a second draw from
the same winning pattern with a different image: wavier, glossier
noodles, broth droplets frozen mid-fall, and the yolk running into
the broth rather than hanging in the air. It still reads at small
sizes: noodles, steam, egg, dark bowl.

## The limits

The rules cap the picture at 1 MiB (1,048,576 bytes) and 1024 by 1024
pixels; anything over either is gated invalid and takes no prize. This
image is a 1024 x 683 JPEG, 140,554 bytes — inside both limits with
room to spare.

## How the program works

`main.py` (Python 3, standard library only) takes `image.png` from the
same directory and copies it to `$MAKEFUN_OUTPUT_DIR/entry.png`
(defaulting to `/output/entry.png` when the variable is unset), creating
the output directory first if it does not exist. Before copying it
checks that the source is a whole JPEG or PNG under the 1 MiB limit
and no larger than 1024x1024 pixels, reading the dimensions from the
file's own header (the PNG IHDR chunk or the JPEG start-of-frame
marker). After copying it compares the SHA-256 hash of the copy
against the hash of the source, raising an error and deleting the
copy if they differ. The output is fully deterministic — the same
bytes every run.
