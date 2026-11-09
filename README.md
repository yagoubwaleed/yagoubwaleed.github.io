# yagoubwaleed.github.io

Personal research site, served by GitHub Pages at https://yagoubwaleed.github.io.

- `content.js` — all the text: sections, research items, pages. Edit this to change what the site says.
- `app.js` — the sidebar (icon rail + panel). Views live at `?p=section` or `?p=section/item`;
  opening one walks the character to that section's `place` in the village.
- `world.js` — the village (three.js from a CDN), rendered at low resolution and ordered-dithered.
  `BUILDINGS` and `SPOTS` near the top define the places the sidebar can send you to.
- `human.js` — the character model (`makeHuman(options)`): skin, hair colour and style (short, long, bun, bald),
  beard (goatee, full, none), clothing colours, height, build. Used for you and for NPCs.
- `dither.js` — the ordered-dither render pass (plus season colours and the hover outline).
- `settings.js` — the season picker and light/dark mode.
- To preview locally, serve the folder (ES modules don't load from `file://`): `python3 -m http.server` then open http://localhost:8000.
- `classic.html` — plain one-page version, linked from the game.

To update: edit, then `git commit -am "Update" && git push`.
