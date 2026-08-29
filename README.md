# Gfx Image Tool

JavaScript library and CLI for converting images into embedded pixel arrays and C/C++ headers.
Phases 1 through 3 are implemented. See [the Japanese specification](docs/spec.ja.md) and
[CLI reference](docs/CLI.md).

## Requirements

- Node.js 20 or later

## CLI

```sh
npm install
node bin/gfx-image-tool.js inspect icon.png
node bin/gfx-image-tool.js build icon.png --format rgb565be --out icon.h
```

Directory projects generate one self-contained header per source image:

```sh
gfx-image-tool init ./images
gfx-image-tool build ./images
gfx-image-tool build ./images --check
```

Current formats: `bitmap1-msb`, `bitmap1-lsb`, `bitmap1-vertical`, `mask1-msb`,
`gray8`, `indexed8`, `rgb332`, `rgb565le`, `rgb565be`, and `rgb888`.
Monochrome output supports Floyd-Steinberg and 2x2/4x4/8x8 Bayer dithering.
Targets: `generic-c`, `adafruit-gfx`, `u8g2`, `lovyangfx`, `arduino-gfx`, `tft-espi`, and `tinygfx`.

## TinyGFX optimization

```sh
gfx-image-tool build icon.png --target tinygfx --out icon.h
gfx-image-tool build logo.png --target tinygfx --monochrome --prefer-bitmap v
gfx-image-tool inspect ./images --target tinygfx --json
```

The optimizer considers `raw565`, `rle565`, `rlepal4`, `bitmap1h`, and `bitmap1v`.
Directory builds optimize all images as a set, including the fixed decoder cost (400 bytes per
format by default and 1.3x when both bitmap layouts are used). Set `[alpha] mode = preserve` to
translate source alpha into a collision-free TinyGFX transparent color or palette index.

Generated headers are self-contained image assets. Include `<TinyGFX/Image.h>` before them and
draw the generated `<name>Ref` with `lcd.drawImage()`.

## JavaScript API

```js
import { createImage, encodeImage, emitCSource } from 'gfx-image-tool';

const image = createImage(1, 1, [255, 0, 0, 255]);
const encoded = encodeImage(image, 'rgb565be');
const { source } = emitCSource(encoded, 'generic-c', { name: 'redPixel' });
```

Use `gfx-image-tool/node` for the optional Node image decoder adapter.

## Development

```sh
npm install
npm run check
npm run build
npm run types
npm run smoke:dist
```
