# Maneka's Picks

- `portrait-visor.jpg`: her photograph in an amber visor, 2576 by 2113,
  shown whole on manekas-picks.html. The trailer plays in the visor. Made by
  `python3 scripts/retouch-portrait.py` from the original
  (scripts/source/portrait-visor-original.jpg, not published): the generated
  line texture on skin and cloth taken out, every blemish healed, and the
  fine pores and grain of a high-resolution camera in their place.
- `visor-mask.png`, `visor-frame.png`, `visor-shine.png`: the film's mask, the
  frame laid back over it (with the corner pads taken out) and the glass's
  own reflections, for the box 906 to 1676 across and 644 to 918 down (the
  `.mp-lens` rule on the page). `portrait-wall.png`: the wall behind her, at
  half size, the mask the drifting type is drawn through. All made by
  `python3 scripts/build-visor-mask.py`, run after the retouch.
- `animals-raghu-rai-cover.jpg` and `orange-dogs-cover.jpg`: the covers of
  the two books on the page, Animals (Raghu Rai and Maneka Gandhi,
  HarperCollins India) and Orange Dogs (Deepak Virwani). Fetched by
  `npm run media:films` (DEPLOY.command runs it) from Amazon's image host,
  the addresses in `BOOKS` in scripts/fetch-founder-films.js. If Amazon does
  not answer, save each cover from its Amazon page under its name by hand.
  Until a cover is here its book shows a lettered cover.
