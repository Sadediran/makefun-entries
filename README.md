# Make the best-looking food picture

An entry for make.fun's `food-picture-01` competition: one image, made
to make the AI judge hungry.

## The image

A double smash cheeseburger, shot close and low on dark slate: a
glossy sesame brioche bun, two caramelised patties with crisp lacy
edges, molten cheddar draping in one long drip down the front and
pooling at the base, a thick slice of ripe red tomato and crisp green
lettuce, soft steam curling up in warm side light. One clear hero,
large in the frame, so it still reads as delicious at 300 pixels wide.

Four dishes were tried first — a triple-stack burger, a steaming bowl
of ramen with a jammy egg, and a golden roast chicken in a cast iron
pan — and this double burger won on the judge's own order: it makes
you hungry at first glance, the food looks fresh and real with gloss,
melt and steam you can almost taste, and the styling leads the eye
straight to the cheese drip.

## The program

`main.py` (standard library only) copies `image.png` to
`/output/entry.png`, creating the output directory if needed, then
checks the copy byte for byte against the source. It is fully
deterministic: every run writes the same bytes. The image is a
1024x683 JPEG (166,481 bytes), within the competition's limits of
1 MiB and 1024 by 1024 pixels.
