# Contributing to Party Hub

Thanks for wanting to add to game night! The most valuable contribution is a **new game**
— the platform exists so that adding one is a single evening of fun, not a framework
study.

## Ground rules

- **Vanilla JavaScript, no build step, no runtime dependencies.** Edit → reload → play.
  (The only vendored library is three.js for games that truly need 3D.)
- **Player-facing text is German, with emoji.** Docs, code comments and commit messages
  are English.
- **Games are self-contained** in `public/games/<key>/` and talk to the shell only
  through the documented API — never patch the shell for one game. If you genuinely need
  a new shell capability, open an issue first.
- Keep rounds **2–6 minutes** and keep everyone busy — eliminated players get ghost
  roles or spectate-with-purpose, end screens offer a host rematch.

## Dev setup

```bash
npm install
npm start          # screen: /screen.html, controller: /controller.html
npm test           # JSDOM end-to-end tests — must stay green
```

Playtest with real phones on your Wi-Fi, or open several controller tabs on your desktop
(each browser tab is its own player).

## Adding a game

1. Read the **[game developer guide](public/games/README.md)** — anatomy, lifecycle,
   shell API, conventions.
2. Copy **[public/games/_template/](public/games/_template/)** to
   `public/games/<yourkey>/` and rename the key in all three files.
3. Add the script tags to `public/screen.html` **and** `public/controller.html` at the
   `▼ Register new games here` marker (exact one-line `<script src="…"></script>` form —
   the test runner depends on it).
4. Build your game. Steal freely from the 19 existing ones — particles, glow sprites,
   analog pads, swipe gestures, beat timing: it's all in the tree.
5. Copy `_template/dev.html` to `public/dev-<yourkey>.html`, add dumb bots, and use
   `?sim=<ms>` fast-forwarding to tune and screenshot your game headlessly.
6. Run `npm test`. If your game logic is deterministic, consider a `test-<yourkey>.js`
   modeled on `test-categories.js`.

## Pull requests

- One game (or one focused change) per PR.
- Fill in the PR template — it's the checklist from the guide.
- Include at least one screenshot from your dev harness. We merge on
  "works, follows the conventions, is fun" — polish can iterate afterwards.
- Balance numbers are honest guesses until real humans play; say so in the PR and keep
  tunables as named constants near the top of `screen.js`.

## Bugs & ideas

Open an issue with reproduction steps (player count, game, what you did on the phone).
For platform ideas (shell, server, input methods), describe the game that needs it —
capabilities follow games here, not the other way around.
