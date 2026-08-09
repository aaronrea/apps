# apps

Personal, one-off static web apps. Each app lives in its own subdirectory and
they're all served from the same GitHub Pages site.

| App | Directory | What it is |
| --- | --- | --- |
| Signal | [`signal-radio/`](signal-radio/) | Personal internet radio PWA (101X, The Bone, The Zone, DEF CON) |

The root `index.html` is a plain landing page linking to each app — add a list
item there when you add a sibling app.

No build step, no dependencies, no backend. Everything is vanilla
HTML/CSS/JS and every path in every app is **relative**, because GitHub Pages
project sites serve from `https://<user>.github.io/<repo>/`, not from the
domain root.

## Run it locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

A service worker needs a secure context — `http://localhost` counts, so
registration works locally. Opening `index.html` via `file://` does **not**
work (no service worker, no fetch).

## Publish to GitHub Pages

The repo already exists at `github.com/aaronrea/apps`. To publish:

1. **Push** to `main`:

   ```bash
   git push -u origin main
   ```

   (If you're starting from a fresh repo instead: `gh repo create aaronrea/apps
   --public --source=. --push`, or create it in the GitHub UI and
   `git remote add origin git@github.com:aaronrea/apps.git` first.)

2. **Enable Pages**: repo → **Settings** → **Pages** → *Build and deployment* →
   Source: **Deploy from a branch** → Branch: **`main`**, folder: **`/ (root)`**
   → **Save**.

3. Wait ~1 minute for the first build, then open:

   - Landing page: `https://aaronrea.github.io/apps/`
   - Signal: `https://aaronrea.github.io/apps/signal-radio/`

Pages serves over HTTPS, which is what the service worker, "Add to Home
Screen", and background audio all require.

## iOS install test

From Safari on the phone, open the Signal URL → Share → **Add to Home Screen**.
Launch it from the home screen icon (not from Safari) to get the standalone,
no-browser-chrome window, then start a station and lock the phone to check the
lock-screen controls.
