# yagoubwaleed.github.io

Personal research site, served by GitHub Pages at https://yagoubwaleed.github.io.

- `content.js` — all the text: sections, research items, pages. Edit this to change what the site says.
- `app.js` — the sidebar (icon rail + panel). Views live at `?p=section` or `?p=section/item`;
  
  beard (goatee, full, none), clothing colours, height, build. Used for you and for NPCs.
- `settings.js` — the season picker and light/dark mode.
- To preview locally, serve the folder (ES modules don't load from `file://`): `python3 -m http.server` then open http://localhost:8000.
- `classic.html` — plain one-page version, linked from the game.

To update: edit, then `git commit -am "Update" && git push`.
