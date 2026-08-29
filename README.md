# Gfx Image Tool

JavaScript library and CLI for converting images into embedded pixel arrays and C/C++ headers.
The project is currently implementing Phase 1. See [the Japanese specification](docs/spec.ja.md).

## Requirements

- Node.js 20 or later

## CLI

```sh
npm install
node bin/gfx-image-tool.js inspect icon.png
node bin/gfx-image-tool.js build icon.png --format rgb565be --out icon.h
```

Current formats: `bitmap1-msb`, `bitmap1-lsb`, `bitmap1-vertical`, `mask1-msb`,
`gray8`, `rgb332`, `rgb565le`, `rgb565be`, and `rgb888`.
Monochrome output supports Floyd-Steinberg and 2x2/4x4/8x8 Bayer dithering.

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
