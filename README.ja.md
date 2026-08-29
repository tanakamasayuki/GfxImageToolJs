# Gfx Image Tool

画像を組込み向けの画素配列と C/C++ ヘッダーへ変換する JavaScript ライブラリ＋CLIです。
現在は Phase 1 の実装中です。仕様は [docs/spec.ja.md](docs/spec.ja.md) を参照してください。

## 必要環境

- Node.js 20以上

## CLI

```sh
npm install
node bin/gfx-image-tool.js inspect icon.png
node bin/gfx-image-tool.js build icon.png --format rgb565be --out icon.h
```

現在の対応形式:

- `bitmap1-msb` / `bitmap1-lsb` / `bitmap1-vertical`
- `mask1-msb`
- `gray8` / `rgb332` / `rgb565le` / `rgb565be` / `rgb888`

主なオプション:

```sh
gfx-image-tool build icon.png --format bitmap1-msb --threshold 144 --invert
gfx-image-tool build icon.png --format bitmap1-msb --dither bayer4
gfx-image-tool build icon.png --format rgb565be --matte 000000
gfx-image-tool inspect icon.png --json
```

## JavaScript API

```js
import { createImage, encodeImage, emitCSource } from 'gfx-image-tool';

const image = createImage(1, 1, [255, 0, 0, 255]);
const encoded = encodeImage(image, 'rgb565be');
const { source } = emitCSource(encoded, 'generic-c', { name: 'redPixel' });
```

Nodeで画像ファイルを読むadapterはサブパスに分離されています。

```js
import { decodeImageFile } from 'gfx-image-tool/node';
```

## 開発

```sh
npm install
npm run check
npm run build
npm run types
npm run smoke:dist
```
