import os

POEM = """The Last Page

Every night she brings the book,
the one about the river that ran uphill,
and I do all the voices wrong.
The frog is a general. The river is a drum.
She stops me on every page.
No, Dad. Like this.
I do it wrong again, and she laughs,
and the river climbs.

Then the agent reads it.
Every voice exact — the frog a frog,
the river a river, the wind the wind.
She doesn't stop it once.
She doesn't laugh.
There is nothing to correct.
She watches the ceiling while the river
runs uphill without her.

Tonight I take the book back.
She corrects me. She laughs.
The frog is wrong again.
Then she takes the book from my hands
and reads it back to me, frog voice and all,
and the river climbs, wrong as ever, hers.
"""


def main():
    out = os.environ.get("MAKEFUN_OUTPUT_DIR", "/output")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "entry.txt"), "w", encoding="utf-8") as f:
        f.write(POEM)


if __name__ == "__main__":
    main()
