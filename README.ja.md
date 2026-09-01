# Gfx Image Tool

[English](README.md) | 日本語

**公開URL:** [ブラウザ版](https://tanakamasayuki.github.io/GfxImageToolJs/) ·
[npmパッケージ](https://www.npmjs.com/package/gfx-image-tool) ·
[GitHub Releases](https://github.com/tanakamasayuki/GfxImageToolJs/releases)

PNG、JPEG、GIF、BMP、decoderが対応するWebP、またはRGBA画素を、組込み向け画素配列と、そのままincludeできる
C/C++ヘッダーへ変換します。同じJavaScript coreを、画像を外部へ送らないWeb workspace、
再現可能なCLI、library APIから利用できます。

## なぜ必要か

PC向け画像ファイルの中身は、多くの場合、組込みdisplay libraryが期待する画素の並びとは異なります。
firmwareにはFlash容量の制約があり、使える色形式や透明の表し方もlibraryごとに違います。
Gfx Image Toolは、実際の変換後画素をpreviewし、互換性のあるtargetを選び、TinyGFXのdecoder代を
含む画像集合全体を最適化してからsource codeを生成します。

パレット、RGB565、dither、抜き色が初めてなら、まず
**[初心者向けガイド](docs/GUIDE.ja.md)**を読んでください。形式とoptimizerの詳細は
**[上級ガイド](docs/ADVANCED.ja.md)**に分けています。

## クイックスタート

### ブラウザ版

[Web版](https://tanakamasayuki.github.io/GfxImageToolJs/)を開き、1枚以上の画像を追加してtargetの
描画libraryを選びます。原画と変換後を比較して、次をdownloadできます。

- rootの`images.h`と、`images/`配下に元画像・設定をまとめた再生成可能なproject ZIP
- projectの`.h`または選択画像のheader単体
- 変換後PNGと左右比較PNG
- CLIで再現するための`.imagesconfig`

Web版は自身が出力したproject ZIPを再度開けます。既定ZIPへreportやpreview PNGは混ぜず、必要なら
選択画像panelから変換後PNG／左右比較PNGを個別に保存します。

project共通設定と画像別overrideに対応し、TinyGFXでは複数画像を集合として最適化します。不透明な
素材は画像別スポイトで元色を透明化でき、`.imagesconfig`の`source_key = RRGGBB`でも再現できます。

### CLI

Node.js 20以上が必要です。

```sh
npm install --global gfx-image-tool
gfx-image-tool inspect icon.png --target tinygfx
gfx-image-tool build icon.png --target tinygfx --out icon.h
```

directory projectを再現可能に管理する例:

```sh
gfx-image-tool init ./MySketch
# 元画像を ./MySketch/images/ へ置く
gfx-image-tool build ./MySketch
gfx-image-tool build ./MySketch --check
```

新規projectは`MySketch/images/.imagesconfig`を作り、全画像を`MySketch/images.h`へまとめます。
生成先は設定の`output_dir`と`output_file`で変更でき、画像別headerが必要な場合は
`output_mode = split`を指定します。CLIの相対`--out`と`--preview`はcurrent working directory基準、
設定内の相対pathは`.imagesconfig`がある`images/`基準です。

bundle headerには画像ごとのsymbolに加え、`*_file_count`、`*_file_names`、`*_file_data`、
`*_file_sizes`、寸法、形式の一覧を生成します。TinyGFXでは`*_file_refs`も生成するため、名前や番号から
`TinyGFXImageRef`を選べます。これらの一覧を参照しなければ、section GCが有効な通常の組込みbuildでは
一覧も未使用画像もlinkerにより除去されます。

```sh
gfx-image-tool build ./MySketch --target tinygfx \
  --preview ./previews --preview-layout both
```

`images/.gfx-image-tool/`は再生成可能なcacheで、`init`が作る`images/.gitignore`によりgit管理されません。
cacheが無くても同じheaderを生成でき、`--check`は期待する生成物を検査します。ただしcacheが無い回だけは
過去のsplit出力をstaleとして検出できないためwarningを表示します。

## 形式とTarget

汎用形式:

- 1bpp: `bitmap1-msb`、`bitmap1-lsb`、`bitmap1-vertical`、`mask1-msb`
- 少色・索引色: `gray8`、`indexed8`、`rgb332`
- 直接色: `rgb565le`、`rgb565be`、`rgb888`

monochrome出力はFloyd–Steinbergと2×2／4×4／8×8 Bayer ditherに対応します。

targetは`generic-c`、`adafruit-gfx`、`u8g2`、`lovyangfx`、`arduino-gfx`、`tft-espi`、
`tinygfx`です。targetは互換formatを制約し、対応する宣言と使用方法をheaderへ生成します。

## TinyGFX

TinyGFXの`auto`は`raw565`、`rle565`、`rlepal4`、`bitmap1h`、`bitmap1v`を評価します。
directoryとWeb projectでは画像を1枚ずつ選ばず、画像dataと使用decoder集合の固定costを合計して
最小化します。sourceの透過は既定で、可視色と衝突しない抜き色として保持されます。
TinyGFXのbitmap形式は前景1色だけを描き、0 bitは描画先の背景を残します。自動modeでは元画像を
正確に保てる場合だけ候補にし、背景色／前景色への変換を意図する場合はmonochromeを明示します。

```cpp
#include <TinyGFX/Image.h>
#include "images.h"

lcd.drawImage(&img_iconRef, 10, 10);
```

正確なsymbol名とtarget固有の使用方法は、生成headerとreportで確認できます。

## JavaScript API

```js
import { createImage, encodeImage, emitCSource } from 'gfx-image-tool';

const image = createImage(1, 1, [255, 0, 0, 255]);
const encoded = encodeImage(image, 'rgb565be');
const { source } = emitCSource(encoded, 'generic-c', { name: 'redPixel' });
```

Node画像decoder adapterは`gfx-image-tool/node`、browser decoderは`gfx-image-tool/browser`です。

## ドキュメント

- [ドキュメント一覧](docs/README.ja.md)（[English](docs/README.md)）
- [初心者向けガイド](docs/GUIDE.ja.md)（[English](docs/GUIDE.md)）
- [上級ガイド](docs/ADVANCED.ja.md)（[English](docs/ADVANCED.md)）
- [CLIリファレンス](docs/CLI.ja.md)（[English](docs/CLI.md)）
- [実装仕様](docs/spec.ja.md)
- [リリース手順](docs/release.ja.md)（[English](docs/release.md)）
- [変更履歴](CHANGELOG.md)

## 開発

```sh
npm install
npm run check
npm run build
npm run types
npm run smoke:dist
npm run build:site
```

[MIT License](LICENSE)で公開しています。
