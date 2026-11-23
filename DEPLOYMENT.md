# Publishing

This repository is configured to publish the static production build through GitHub Pages. The
workflow at `.github/workflows/deploy-pages.yml` builds the site and publishes `dist/` whenever
`main` is updated. The site does not require a backend. GitHub Pages must be enabled in the
repository settings; pushing to GitHub does not deploy to S3.

## One-time repository setup

1. Create a GitHub repository for this project and push this folder to its `main` branch.
2. In the repository's **Settings** > **Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** from the Actions tab.
4. Review the completed deployment from the Pages settings before sharing it.

The workflow uses the repository's configured Pages URL. This project deliberately does not store
or advertise that URL in its source or documentation.

## Local production check

Install Node.js 22 and npm, then run:

```powershell
npm.cmd ci
npm.cmd run build
```

The build produces `dist/`. Vite is configured with a relative base path, so the built assets and
local 3D models resolve correctly from a GitHub Pages project site or S3 prefix. Upload the contents
of `dist/`, not the source files: the source `index.html` references a Vite development entry point.

## Publishing to S3

The GitHub Pages workflow does not update S3. On Windows, run the deployment script from the
repository root with Node.js, installed project dependencies, and the AWS CLI available:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-s3.ps1 -Profile YOUR_PROFILE
```

Replace `YOUR_PROFILE` with the AWS CLI profile for the intended account, or omit `-Profile` to use
the normal AWS credential chain. If the profile uses IAM Identity Center, sign in with
`aws sso login --profile YOUR_PROFILE` first. The default destination is
`s3://esri-jhall-public/apps/frame-camera-simulator/`; pass `-Destination` with a different S3
prefix ending in `/` to change it. Add `-WhatIf` to run the tests and build without uploading.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-s3.ps1 -Profile YOUR_PROFILE -WhatIf
```

The script runs the tests and production build, uploads assets before `index.html`, and stops if a
step fails. It does not delete old objects or change bucket permissions. The profile needs permission
to list the destination prefix and upload objects. Ensure the site serves `index.html`, JavaScript
modules, and model files with suitable content types and public access. If a CDN is used, refresh or
invalidate cached `index.html` according to its configuration. Test the public site, including record
lookup and both local models, after publishing.

## ArcGIS API key

The satellite basemap currently works without `VITE_ARCGIS_API_KEY`, but a public deployment can
be more reliable with a referrer-restricted ArcGIS API key. Copy `.env.example` to `.env`, set the
key before building, and keep `.env` out of version control. A client-side key is not a secret;
limit it to the intended hosting origins and only the privileges the application needs. The GitHub
Pages workflow does not currently inject this key; configure the build separately if one is needed.

## Deployment check

- Confirm the 3D scene, satellite basemap, and local aircraft and camera models load.
- Change a parameter and select **Generate**; check all three views update together.
- Check the app at a project-site path, not just at a domain root.
- Keep Esri attribution visible in the 3D view.