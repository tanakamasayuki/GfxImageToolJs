# Gfx Image Tool

画像を組込み向けの画素配列と C/C++ ヘッダーへ変換する JavaScript ライブラリ＋CLIです。
Phase 3まで実装済みです。詳細は[仕様](docs/spec.ja.md)と
[CLIリファレンス](docs/CLI.ja.md)を参照してください。

## 必要環境

- Node.js 20以上

## CLI

```sh
npm install
node bin/gfx-image-tool.js inspect icon.png
node bin/gfx-image-tool.js build icon.png --format rgb565be --out icon.h
```

ディレクトリを指定すると、対象画像を既定で`generated/images.h` 1本へまとめます。
画像ごとのheaderが必要なら`.imagesconfig`で`output_mode = split`を指定します。

```sh
gfx-image-tool init ./images
gfx-image-tool build ./images
gfx-image-tool inspect ./images
gfx-image-tool build ./images --check
gfx-image-tool build ./images --target tinygfx --preview ./previews --preview-layout comparison
```

`--check`はファイルを書き換えず、欠落または差分があれば終了コード2を返します。
TinyGFXのdirectory変換も単体変換と同様に透過を既定で保持します。相対`--out`と
`--preview`はcurrent directory基準です。previewを毎回検査する場合は`.imagesconfig`の
`[preview] output_dir = previews`へ保存できます。

## ブラウザ版

複数画像を1projectとして扱うWeb workspaceもあります。画像はuploadせずブラウザ内だけで
decode・変換します。共通設定と画像別override、原画／変換後preview、TinyGFX集合最適化、
project `.h`、変換後／左右比較PNG、`.imagesconfig`、JSON reportのdownloadに対応しています。

```sh
npm run serve
# http://localhost:4173/
```

現在の対応形式:

- `bitmap1-msb` / `bitmap1-lsb` / `bitmap1-vertical`
- `mask1-msb`
- `gray8` / `indexed8` / `rgb332` / `rgb565le` / `rgb565be` / `rgb888`

主なオプション:

```sh
gfx-image-tool build icon.png --format bitmap1-msb --threshold 144 --invert
gfx-image-tool build icon.png --format bitmap1-msb --dither bayer4
gfx-image-tool build icon.png --format rgb565be --matte 000000
gfx-image-tool inspect icon.png --json
```

出力ターゲットは`generic-c`、`adafruit-gfx`、`u8g2`、`lovyangfx`、
`arduino-gfx`、`tft-espi`、`tinygfx`です。ターゲットは利用可能な形式を制約し、対応する
配列型と使用例をヘッダーへ生成します。

### TinyGFX

単一画像では、画素データと固定デコーダコストの合計が最小になる形式を選び、
単独でincludeできる`CellImage`ヘッダーを生成します。

```sh
gfx-image-tool build icon.png --target tinygfx --out icon.h
gfx-image-tool build logo.png --target tinygfx --monochrome --prefer-bitmap v
gfx-image-tool inspect ./images --target tinygfx --json
```

候補は`raw565`、`rle565`、`rlepal4`、`bitmap1h`、`bitmap1v`です。
ディレクトリbuildでは全画像をまとめて評価し、共有されるデコーダを含む合計Flash量を
最小化します。既定のデコーダコストは1形式400 Bで、横・縦1bppを両方使う場合は
`round(400 * 1.3) = 520 B`です。`--decoder-cost`または`[optimize] decoder_cost`で
基準値を変更できます。同サイズの1bpp候補は`prefer_bitmap`で安定して選びます。

TinyGFXヘッダーを使う側では先に画像APIをincludeします。

```cpp
#include <TinyGFX/Image.h>
#include "icon.h"

lcd.drawImage(&iconRef, 10, 10);
```

PNG等のalphaをTinyGFXの透過色へ変換するには、プロジェクト設定で
[alpha]の`mode = color-key`を指定します。`color = auto`では可視画素と衝突しない
RGB565値を自動選択し、
パレット形式では対応するpalette indexを出力します。

## `.imagesconfig`

```ini
[general]
output_dir = generated
output_mode = bundle
output_file = images.h
prefix = ui_
target = arduino-gfx

[color]
format = rgb565le
colors = 256
dither = none
threshold = 128
color = auto
invert = false

[alpha]
mode = none
matte = 000000
threshold = 128

[optimize]
decoder_cost = 400
prefer_bitmap = horizontal
aligned_vblit = false

[image "icons/*.png"]
format = indexed8
colors = 16
dither = floyd-steinberg
```

入力は再帰走査され、`.imagesignore`で除外できます。画像別sectionはglobで共通設定を
上書きします。既定の出力先`generated/`は入力として再走査されません。

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
npm run build:site
```
