# Node.js ↔ npm version map

A dependency-free GitHub Pages dashboard mapping every published Node.js release to its bundled npm version. A daily GitHub Actions workflow builds a static snapshot from:

- [Node.js release index](https://nodejs.org/dist/index.json)
- [Official Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)
- [npm packument](https://registry.npmjs.org/npm)

The dashboard hides end-of-life Node.js lines by default and highlights any newer npm major that has not shipped in a published Node.js release.

Run `node scripts/generate-data.mjs` to regenerate both the self-contained `index.html` and the reusable `data/versions.json` snapshot. The generated HTML embeds its data, styles, and JavaScript, so it can be opened directly without a web server.

## Deploy

1. Push the repository to GitHub with `main` as the default branch.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Run **Deploy daily version map** or wait for the next push/scheduled run.

The workflow deploys on every push to `main`, on manual dispatch, and daily at 06:17 UTC.
