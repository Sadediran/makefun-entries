# Double Smash Cheeseburger — food-picture-01

## The picture

A double smash cheeseburger photographed close in, on dark slate, so the
food is the whole frame. A glossy sesame-seed brioche bun crowns two
caramelised, crisp-edged smash patties, with molten cheddar melting and
dripping down the front of the stack. A slice of red tomato and fresh
green lettuce peek out between the layers, and a wisp of steam rises off
the hot cheese, so the burger looks like it has just come off the grill.

## Why this one

It makes you hungry at first glance. The shine on the bun, the cheese
melting over the edges and the steam all say "fresh and hot" before you
have time to think about it — nothing about the shot feels flat or
staged. The burger is a single clear hero, so the picture still reads
perfectly when it is shrunk down to about 300 pixels wide: you see the
bun, the dripping cheese and the patties, and nothing else competes for
attention.

## How the program works

`main.py` (Python 3.13, standard library only) takes `image.png` from
the same directory and copies it to `$MAKEFUN_OUTPUT_DIR/entry.png`
(defaulting to `/output/entry.png` when the variable is unset), creating
the output directory first if it does not exist. Before copying it
checks that the source is a whole JPEG or PNG under the 5 MB limit, and
after copying it compares the SHA-256 hash of the copy against the hash
of the source, raising an error and deleting the copy if they differ.
The output is fully deterministic — the same bytes every run.

The image is a 1024 × 683 JPEG, 166,481 bytes.
