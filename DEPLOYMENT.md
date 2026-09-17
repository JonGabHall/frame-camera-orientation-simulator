# Publishing to GitHub Pages

This repository is configured to publish the static production build through GitHub Pages. The
workflow at `.github/workflows/deploy-pages.yml` builds the site and publishes `dist/` whenever
`main` is updated. It does not require a backend or a separate hosting configuration.

## One-time repository setup

1. Create a GitHub repository for this project and push this folder to its `main` branch.
2. In the repository's **Settings** > **Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** from the Actions tab.
4. Review the completed deployment from the Pages settings before sharing it.

The workflow uses the repository's configured Pages URL. This project deliberately does not store
or advertise that URL in its source or documentation.

## Local production check

```powershell
npm.cmd ci
npm.cmd run build
```

The build produces `dist/`. Vite is configured with a relative base path, so the built assets and
local 3D models resolve correctly from a GitHub Pages project site.

## ArcGIS API key

The satellite basemap currently works without `VITE_ARCGIS_API_KEY`, but a public deployment can
be more reliable with a referrer-restricted ArcGIS API key. Copy `.env.example` to `.env`, set the
key before building, and keep `.env` out of version control. A client-side key is not a secret;
limit it to the Pages domain and only the privileges the application needs.

## Deployment check

- Confirm the 3D scene, satellite basemap, and local aircraft and camera models load.
- Change a parameter and select **Generate**; check all three views update together.
- Check the app at a project-site path, not just at a domain root.
- Keep Esri attribution visible in the 3D view.