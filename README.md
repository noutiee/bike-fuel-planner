# Bike Fuel Planner — PWA

This folder contains a complete installable Progressive Web App (PWA) of your bike fueling calculator.

## Files
- `index.html` — the app UI + logic (gels round-up then shave from bottles, summary popup, copy-to-clipboard)
- `manifest.json` — PWA metadata (name, icons, theme)
- `sw.js` — service worker for offline caching
- `icons/icon-192.png`, `icons/icon-512.png` — app icons

## Quick deploy: GitHub Pages
1. Create a new **public** GitHub repository, e.g., `bike-fuel-planner`.
2. Upload the contents of this folder to the repo root.
3. In the repo settings, enable **Pages** → Source: `Deploy from a branch` → Branch: `main` → `/root` → Save.
4. Pages will give you a URL like `https://<user>.github.io/bike-fuel-planner/`.
5. Open that URL on iPhone Safari → Share → **Add to Home Screen** (ensure **Open as Web App** is on if shown).

## Quick deploy: Netlify (drag & drop)
1. Go to https://app.netlify.com/drop
2. Drag this folder to deploy. Netlify returns a public URL.
3. Open that URL on iPhone Safari → Share → **Add to Home Screen**.

## Notes
- PWAs require **HTTPS** and a **manifest** to be installable. Service worker enables offline caching.
- On iPhone, install is user‑initiated via **Share → Add to Home Screen**.
- To update, redeploy the files; users will get the new version on next load.
