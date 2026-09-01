# Release procedure

English | [日本語](release.ja.md)

This document is for maintainers. As with the sibling tools, the normal npm publication path runs
from a maintainer workstation.

## Pre-release review

1. Confirm that `main` is current and contains no unintended changes.
2. Review the [README](../README.md), [getting-started guide](GUIDE.md),
   [advanced guide](ADVANCED.md), [CLI reference](CLI.md), and changelog.
3. Exercise representative CLI paths: one image, a directory bundle, transparency, previews, and
   `--check`. For a canonical project, remove `.gfx-image-tool/`, confirm the same header is rebuilt,
   and confirm cache absence alone lets `--check` succeed with a warning.
4. Open the web app in a Chromium browser and Firefox. Check multiple images, same-name replacement,
   transparency and backgrounds (including blink), the source-color eyedropper and its `source_key`
   export, zero transparency for an absent source key, final-result transparency details, converted
   previews, downloads, configuration drop/export, and both
   locales. Download a project ZIP and verify root `images.h` plus originals, `.imagesconfig`, and
   `.gitignore` under `images/`. Confirm report, previews, and `.gfx-image-tool/` are absent, then
   drop that ZIP into a fresh page and verify settings and originals are restored.
5. After pushing `main`, open <https://tanakamasayuki.github.io/GfxImageToolJs/> directly. Confirm
   that the deployed build has no missing assets or stale-cache behavior.

Automated checks:

```sh
npm run check
npm run build
npm run types
npm run smoke:dist
npm run build:site
npm pack --dry-run
git diff --check
git status --short
```

The package dry run should contain `bin`, `dist`, `docs`, `src`, `types`, the READMEs, changelog,
and license. It should not contain test fixtures, `web`, `site`, or native binaries. The web app is
delivered by GitHub Pages, not in the npm tarball.

## Changelog and version

Every change under `## Unreleased` in `CHANGELOG.md` has paired `(EN)` and `(JA)` entries. Confirm
that it is non-empty and describes all release changes.

`npm version` invokes:

- `preversion`: tests, type checking, locale checks, and releasability checks;
- `version`: synchronization of the package version, source `VERSION`, and changelog heading; and
- creation of the version commit and Git tag.

Choose the version that will actually be published, including for an initial release. If
`package.json` already contains that intended version, do not advance it accidentally. When a
change is needed, follow semantic versioning.

```sh
npm version patch              # use minor or major when appropriate
```

For an initial release whose `package.json` already contains the intended `0.1.0`, keep that version
and create the changelog heading, release commit, and tag with:

```sh
npm version 0.1.0 --allow-same-version
```

## Publish and push

Confirm npm authentication, package name, and publishing account before running:

```sh
npm publish --access public
git push --follow-tags
```

The `prepack` hook regenerates bundles and declarations. After publication, install from npm in a
separate temporary directory and verify the published version, root import, and
`gfx-image-tool --version`. Never store npm tokens or credentials in the repository.

## GitHub Actions

- `ci.yml`: checks, builds, declarations, distribution smoke test, site build, and package contents
  on `main` pushes and pull requests;
- `pages.yml`: deploys GitHub Pages on a `main` push or manual run; and
- `release.yml`: optional manual publication after npm Trusted Publishing is configured.

A tag push does not normally trigger `release.yml`. If publication moves to CI, use npm Trusted
Publishing and provenance.

## Post-release checks

- The intended version appears on the npm package page.
- The CLI starts after `npm install --global gfx-image-tool`.
- The Git tag points to the expected GitHub commit.
- The [web app](https://tanakamasayuki.github.io/GfxImageToolJs/) runs the current version.
- Changelog and English/Japanese documentation links open from their published locations.

Do not overwrite a broken published version. Fix the problem and publish a new patch version.
