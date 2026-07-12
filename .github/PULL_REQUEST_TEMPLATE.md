## What's this?

<!-- One or two sentences. For a new game: the elevator pitch. -->

## Screenshot

<!-- From your dev harness (public/dev-<key>.html) — required for game PRs. -->

## Checklist (game PRs)

- [ ] `meta.js` / `screen.js` / `controller.js` under one unique key in `public/games/<key>/`
- [ ] Script tags added to **both** HTMLs at the `▼ Register new games here` marker
- [ ] `onDisconnect` handled, `stop()` clears timers
- [ ] Settings declared in `meta.js` (no hand-rolled settings UI)
- [ ] German UI strings with emoji, host rematch on the end screen
- [ ] `public/dev-<key>.html` harness included
- [ ] `npm test` is green
