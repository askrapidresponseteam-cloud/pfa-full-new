# Maneka's Picks

- `portrait-visor.jpg`: her photograph in an amber visor, 2576 by 2113,
  shown whole on manekas-picks.html. The trailer plays in the visor.
- `visor-mask.png`: the amber glass, read from the photograph by its colour
  and held 4 pixels inside it, for the box 925 to 1664 across and 663 to 899
  down (the `.mp-lens` rule on the page). Nothing of the film shows outside
  it. `visor-shine.png`: the visor's own reflections and sheen, laid over the
  film. Both are made by `python3 scripts/build-visor-mask.py`; a different
  photograph needs that run again and the box measured again.
- `animals-raghu-rai-cover.jpg`: the cover of Animals by Raghu Rai
  (HarperCollins India), the book on the page. Fetched by
  `npm run media:films` from the Amazon page its Buy on Amazon button opens
  (DEPLOY.command runs it). If Amazon does not answer a script, save the
  cover from that page under this name by hand. Until it is here the page
  shows a lettered cover.
