# Playing online (Render)

Party Hub is built for one room, but the same server works over the internet: host it
somewhere public, let **one** person open the screen and share it via Discord / Zoom /
Teams screen sharing, and everybody else joins with their phone through the public URL.
Cozy and turn-based games (Wauwau-WG, Spion, Stadt Land Fluss, Drawing, Fake Artist)
handle the stream delay well; twitchy ones (Reaktionsduell, Racer) suffer from it.

## Deploy on Render (free plan)

1. Sign up at [render.com](https://render.com) — "Sign in with GitHub" connects the repo
   access in one go (grant access to this repository).
2. **New → Web Service**, pick the repository, then:

   | Field | Value |
   |---|---|
   | Branch | the branch to play (e.g. `main`) |
   | Region | Frankfurt (EU Central) — closest to German players |
   | Runtime | Node |
   | Build Command | `npm install --omit=dev` |
   | Start Command | `npm start` |
   | Instance Type | Free |

3. Deploy. The service gets a URL like `https://party-hub-xyz.onrender.com`. Pushing to
   the chosen branch redeploys automatically.

Nothing else is needed: the server reads `PORT` from the environment, the client
switches to `wss://` on HTTPS, and there is no database. A free instance sleeps after
15 minutes without visitors — the first request then takes about a minute.

## Playing a round from home

1. The host opens `https://<your-app>.onrender.com/` → **📺 Ich bin der Bildschirm**
   and shares that browser tab in the video call.
2. Everybody else opens the same URL on their phone → **📱 Mitspielen** (or scans the
   lobby QR code straight off the shared screen).
3. Only one screen exists per server: opening the screen on a second device takes it
   over. That's why `/` is a landing page and not the screen itself.

## Good to know

- **No password.** Anyone with the URL can join. Fine for a private round; don't post it.
- **One party per server.** All visitors share the same lobby.
- **Restarts reset the lobby.** A redeploy or a sleeping instance drops the current game
  (phones reconnect, names are remembered on each phone).
- **Wauwau-WG dogs are per address.** A dog lives in the phone's browser storage for the
  site it was adopted on, so dogs from the home Wi-Fi (`192.168.…:3000`) don't appear
  online and vice versa.
