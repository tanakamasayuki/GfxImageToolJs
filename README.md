# Gfx Image Tool

English | [日本語](README.ja.md)

**Try it in your browser:** <https://tanakamasayuki.github.io/GfxImageToolJs/>

Convert PNG, JPEG, GIF, BMP, supported WebP, or RGBA pixels into embedded pixel arrays and ready-to-include
C/C++ headers. The same JavaScript core powers a private browser workspace, a reproducible CLI,
and a library API.

Images remain inside the browser when using the web app.

## Why use it?

Desktop image files are not usually laid out as embedded display libraries expect. Firmware also
has tight flash budgets, limited color formats, and different ways to represent transparency.
Gfx Image Tool lets you preview the actual converted pixels, choose a compatible target, and
optimize an entire image set—including TinyGFX decoder cost—before generating source code.

New to palettes, RGB565, dithering, or color keys? Start with the
**[beginner-friendly guide](docs/GUIDE.md)**. For format and optimizer details, see the
**[advanced guide](docs/ADVANCED.md)**.

## Quick start

### Browser workspace

Open the [web app](https://tanakamasayuki.github.io/GfxImageToolJs/), add one or more images, select
the target graphics library, compare original and converted previews, and download:

- one rebuildable project ZIP containing original images under `images/`, the bundled `.h`,
  configuration, report, and previews;
- the bundled project `.h` or selected image header separately;
- converted and side-by-side comparison PNGs;
- `.imagesconfig` for CLI reproduction.

The web app can reopen its own project ZIP. Inside the archive, `generated/` and `previews/` are
configured output directories and are excluded from subsequent input scans.

Project defaults and per-image overrides are supported. TinyGFX images are optimized as a set. For
opaque artwork, the per-image eyedropper can turn an exact source color into transparency; the same
operation is reproducible as `source_key = RRGGBB` in `.imagesconfig`.

### CLI

Node.js 20 or later is required.

```sh
npm install --global gfx-image-tool
gfx-image-tool inspect icon.png --target tinygfx
gfx-image-tool build icon.png --target tinygfx --out icon.h
```

For a reproducible directory project:

```sh
gfx-image-tool init ./images
gfx-image-tool build ./images
gfx-image-tool build ./images --check
```

Directory projects bundle their images into `generated/images.h` by default. Set
`output_mode = split` in `.imagesconfig` for per-image headers. Relative CLI `--out` and `--preview`
paths use the current working directory; relative configuration paths use the project root.

```sh
gfx-image-tool build ./images --target tinygfx \
  --preview ./previews --preview-layout both
```

Generated manifests track header and preview output. Commit those hidden manifest files with
generated assets so `--check` can detect sources that were removed.

## Formats and targets

Generic formats:

- 1bpp: `bitmap1-msb`, `bitmap1-lsb`, `bitmap1-vertical`, `mask1-msb`
- low/color-indexed: `gray8`, `indexed8`, `rgb332`
- direct color: `rgb565le`, `rgb565be`, `rgb888`

Monochrome output supports Floyd–Steinberg and 2×2/4×4/8×8 Bayer dithering.

Targets: `generic-c`, `adafruit-gfx`, `u8g2`, `lovyangfx`, `arduino-gfx`, `tft-espi`, and
`tinygfx`. A target constrains compatible formats and emits matching declarations and usage notes.

## TinyGFX

TinyGFX `auto` evaluates `raw565`, `rle565`, `rlepal4`, `bitmap1h`, and `bitmap1v`. A directory or
browser project minimizes image data plus the fixed cost of the decoder set, rather than selecting
each image in isolation. Source transparency is preserved by default with an automatically selected,
collision-free color key.
TinyGFX bitmap formats draw one foreground color while zero bits preserve the destination. Automatic
mode therefore uses them only when that operation preserves the source exactly; choose monochrome
mode explicitly when background/foreground conversion is intended.

```cpp
#include <TinyGFX/Image.h>
#include "images.h"

lcd.drawImage(&img_iconRef, 10, 10);
```

The generated header and report contain the exact symbol names and target-specific usage notes.

## JavaScript API

```js
import { createImage, encodeImage, emitCSource } from 'gfx-image-tool';

const image = createImage(1, 1, [255, 0, 0, 255]);
const encoded = encodeImage(image, 'rgb565be');
const { source } = emitCSource(encoded, 'generic-c', { name: 'redPixel' });
```

Use `gfx-image-tool/node` for the optional Node image decoder adapter and
`gfx-image-tool/browser` for browser decoding.

## Documentation

- [Documentation index](docs/README.md) ([日本語](docs/README.ja.md))
- [Getting-started guide](docs/GUIDE.md) ([日本語](docs/GUIDE.ja.md))
- [Advanced guide](docs/ADVANCED.md) ([日本語](docs/ADVANCED.ja.md))
- [CLI reference](docs/CLI.md) ([日本語](docs/CLI.ja.md))
- [Implementation specification, Japanese](docs/spec.ja.md)
- [Release procedure](docs/release.md) ([日本語](docs/release.ja.md))
- [Changelog](CHANGELOG.md)

## Development

```sh
npm install
npm run check
npm run build
npm run types
npm run smoke:dist
npm run build:site
```

The project is licensed under the [MIT License](LICENSE).
