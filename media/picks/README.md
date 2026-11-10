# Maneka's Picks

- `portrait-visor.jpg`: her photograph in an amber visor, 2576 by 2113,
  shown whole on manekas-picks.html. The trailer plays in the visor.
- `visor-mask.png`: the amber glass, read from the photograph by its colour
  and held 4 pixels inside it, for the box 925 to 1664 across and 663 to 899
  down (the `.mp-lens` rule on the page). Nothing of the film shows outside
  it. `visor-shine.png`: the visor's own reflections and sheen, laid over the
  film. Both are made by `python3 scripts/build-visor-mask.py`; a different
  photograph needs that run again and the box measured again.
- `animals-raghu-rai-cover.jpg` and `orange-dogs-cover.jpg`: the covers of
  the two books on the page, Animals (Raghu Rai and Maneka Gandhi,
  HarperCollins India) and Orange Dogs (Deepak Virwani). Fetched by
  `npm run media:films` (DEPLOY.command runs it) from Amazon's image host,
  the addresses in `BOOKS` in scripts/fetch-founder-films.js. If Amazon does
  not answer, save each cover from its Amazon page under its name by hand.
  Until a cover is here its book shows a lettered cover.
