# GfxImageToolJs 仕様書 v0.1

- 対象読者: 本リポジトリの実装者・連携ツールの実装者
- ステータス: 初期リリースの実装基準。§17以降は実装履歴と将来候補
- 最終更新: 2026-08-31
- 正本: 本日本語版。英語の利用者向け技術解説は[Advanced guide](ADVANCED.md)を参照

[README](../README.ja.md) | [初心者向けガイド](GUIDE.ja.md) | [Advanced guide](ADVANCED.md) |
[CLIリファレンス](CLI.ja.md)

参考資料:

- TinyGFX `docs/IMAGE_TOOL.ja.md` — ツールの事前調査
- TinyGFX `docs/IMAGE_FORMAT.ja.md` — TinyGFX 形式、実測値、最適化根拠
- TinyGFX `tools/img2h.py` — 実験用実装。符号化 byte 列の補助的な交差検査用
- `LGFXFontToolJs` — Library First、Web、ビルド、Pages、npm リリースの兄弟実装
- `EmbedAssetToolJs` — フォルダー処理、設定、`--check`、終了コードの構成上の参考

---

## 1. 概要

**GfxImageToolJs** は、画像を組込み向けの画素配列・C/C++ ヘッダーへ変換し、
変換結果を比較・検査できる汎用 JavaScript ツールキットである。

中心は UI に依存しないライブラリとする。同じ公開 API を CLI とブラウザ版から
利用する。TinyGFX は高度な圧縮と容量最適化を提供する
主要ターゲットだが、データモデルと基本変換は特定の描画ライブラリに依存しない。

キャッチコピー案:

> JavaScript toolkit for converting images into embedded graphics assets.
> 画像を組込み向けグラフィックス資産へ変換・比較・最適化する JavaScript ツールキット。

正式名称は次で固定する。

| 用途 | 名前 |
| --- | --- |
| GitHub リポジトリ | `GfxImageToolJs` |
| npm パッケージ | `gfx-image-tool` |
| CLI | `gfx-image-tool` |

npm package名と公開先accountは、[リリース手順](release.ja.md)に従って公開直前に確認する。

### 1.1 設計の柱

1. **Library First** — 変換・検査・最適化はすべて UI なしで呼べる。
2. **中立モデル** — 入力デコード、画像処理、出力形式、C/C++ テンプレートを分離する。
3. **Target + Format** — `rgb565be` のようなデータ形式と、TinyGFX / Adafruit_GFX
   のような出力先を別概念にする。
4. **決定的出力** — 同じ入力・設定・バージョンから同じバイト列とソースを生成する。
5. **比較可能** — 元画像、変換後プレビュー、誤差、データ量、デコーダ代を可視化する。
6. **Buildless Core** — `src/` は素の ESM。ビルドなしでも import できる。

### 1.2 全体像

```text
PNG / JPEG / GIF / BMP / WebP / RGBA
                 │ decode
                 ▼
         中立 Image (RGBA8888)
                 │ crop / resize / alpha / quantize / dither
                 ▼
       EncodedImage（形式非依存メタデータ付き）
          │                         │
          ├─ binary / JSON          ├─ C/C++ generic
          ├─ Adafruit_GFX           ├─ U8g2
          ├─ LovyanGFX              ├─ Arduino_GFX
          ├─ TFT_eSPI               └─ TinyGFX（圧縮・集合最適化）
          ▼
             CLI / Web / build script
```

---

## 2. ユースケース

| ID | ユースケース | 成立条件 |
| --- | --- | --- |
| UC1 | 画像 1 枚を C/C++ 配列へ変換する | 形式、ビット・バイト順、宣言形を指定できる |
| UC2 | モノクロ OLED 用画像を作る | 閾値、反転、ディザ、横詰め・縦詰めをプレビューできる |
| UC3 | カラー LCD 用画像を作る | RGB332 / RGB565 / RGB888、バイト順、透過を選べる |
| UC4 | ライブラリへそのまま貼れるヘッダーを作る | ターゲット別プリセットと使用例を生成する |
| UC5 | 複数画像をbundleまたは個別の`.h`へ一括生成する | 設定、安定順序、衝突しないsymbol、`--check`を持つ |
| UC6 | TinyGFX の flash 使用量を最小化する | 全符号化を比較し、画像集合単位でデータ＋固定デコーダ代を最小化する |
| UC7 | 変換条件を対話的に決める | Web で原画・変換画・拡大画・容量を即時比較できる |
| UC8 | CI で生成漏れを検出する | 書き込まない `--check` と機械可読 JSON を持つ |
| UC9 | 他ツールから組み込む | Node/browser 共通の公開 API と、I/O を分離した純粋関数を持つ |

---

## 3. スコープ

### 3.1 入力

初期リリースで必須:

- PNG（アルファ付き含む）
- JPEG
- GIF（初期releaseはdecoderが返す第1frameのみ。animation診断は将来拡張）
- BMP
- Web API / JavaScript API からの `ImageData` 相当 RGBA8888

対応候補:

- WebP（デコーダが対応する環境で入力可能。CI の必須形式にはしない）
- C/C++ 画素配列の読み戻し
- QOI、SVG。SVG はラスタライズ結果の環境差を明示できる場合に限る

### 3.2 出力画素形式

| 形式 ID | 内容 | 初期リリース |
| --- | --- | :-: |
| `bitmap1-msb` | 横詰め 1bpp、左画素が MSB | 必須 |
| `bitmap1-lsb` | 横詰め 1bpp、左画素が LSB（XBM） | 必須 |
| `bitmap1-vertical` | 縦 8 画素/byte、上画素が LSB | 必須 |
| `gray8` | 8bpp 輝度 | 必須 |
| `indexed8` | 8bpp 索引＋RGB565 または RGB888 パレット | 必須 |
| `rgb332` | 8bpp 直接色 | 必須 |
| `rgb565le` | RGB565、little endian byte stream | 必須 |
| `rgb565be` | RGB565、big endian byte stream | 必須 |
| `rgb888` | R, G, B の 24bit | 必須 |
| `bgr888` | B, G, R の 24bit | 後続 |
| `argb8888` | 32bit ARGB | 後続 |
| `mask1-msb` | 独立 1bpp 透過マスク | 必須 |
| `tinygfx-raw565` | TinyGFX 生 RGB565 | 必須 |
| `tinygfx-rle565` | 長さ 8bit＋RGB565 | 必須 |
| `tinygfx-rlepal4` | 長さ 4bit＋パレット索引 4bit | 必須 |
| `binary` | 入力ファイルを無変換で埋め込む | 非対象 |

RGB565 の整数値は `rrrrrggggggbbbbb` とし、`le` / `be` は出力 byte stream の
並びだけを表す。8bit から 5/6bit への既定変換は上位ビットの切り出しとする。

TinyGFX の `bitmap1h` / `bitmap1v` は独立した画素形式 ID ではない。それぞれ
`bitmap1-msb` / `bitmap1-vertical` と**同じ byte 列**を使い、`tinygfx` target の
C emitter が `CellImage` と `tinygfxImageBitmap1hOps` / `tinygfxImageBitmap1vOps` で
包む。§8 の `bitmap1h` / `bitmap1v` は optimizer 内の候補 ID であり、別 encoder を
実装してはならない。

### 3.3 ターゲットプリセット

| ターゲット ID | 主な出力 |
| --- | --- |
| `generic-c` | 型、修飾子、配列名を指定できる C/C++ 配列 |
| `adafruit-gfx` | `drawBitmap` / `drawXBitmap` / `drawGrayscaleBitmap` / `drawRGBBitmap` |
| `u8g2` | MSB bitmap / XBM の配列と呼び出し例 |
| `lovyangfx` | `pixelcopy_t` が受ける各形式と透過色 |
| `arduino-gfx` | indexed / RGB565 LE・BE / RGB888 と呼び出し例 |
| `tft-espi` | RGB565、swap 設定、透過色と呼び出し例 |
| `tinygfx` | `CellImage`、palette、`TinyGFXImageRef`、ops 参照 |

プリセットは、許可形式、既定形式、byte/bit order、C 宣言テンプレート、使用例、
制約をまとめたデータとして登録する。エンコーダへライブラリ名の条件分岐を持ち込まない。

### 3.4 非対象

- 元ファイルを可逆に埋め込むこと。`embed-asset-tool` を使う。
- 画像編集ソフト相当の描画機能、レイヤー、文字入れ、ベクター編集。
- デバイスへの転送、書き込み、実機描画。
- 動画・アニメーションのフレーム列生成（初期リリース）。
- JPEG / PNG 等を MCU 上でデコードするライブラリの実装。

---

## 4. 対応環境・依存関係

- Node.js 20 以上。CI の基準は Node.js 22。
- evergreen browser。ES modules、Canvas、File API を前提とする。
- ソースは JavaScript ESM、JSDoc、全ファイル `// @ts-check`。
- コア変換の実行時依存はゼロを目標とする。
- Node の PNG/JPEG/GIF/BMP デコードとリサイズには
  `@napi-rs/canvas` を optional dependency として利用する。利用不能時は
  `CapabilityError` と導入方法を返し、既に RGBA 化された入力の処理は可能とする。
- ブラウザは `createImageBitmap` / Canvas を adapter 内だけで使う。
- `Buffer`、DOM 型、Canvas 型をコア API の境界に出さない。

Node とブラウザのデコーダ差が出力の決定性へ影響するため、`BuildReport` に
decoder ID と version を記録する。CI 用 golden は Node adapter を正とする。

---

## 5. 中立モデル

### 5.1 `Image`

```js
{
  width: number,
  height: number,
  pixels: Uint8Array, // row-major, RGBA, 1 pixel = 4 bytes
  colorSpace: 'srgb',
  alphaMode: 'straight',
  source?: { name?: string, mime?: string, decoder?: string }
}
```

- 座標原点は左上、x は右、y は下。
- RGBA は非 premultiplied の 8bit sRGB。
- `width` / `height` は正の安全な整数。`pixels.length === width * height * 4`。
- EXIF orientation は decode 時に適用し、モデルは常に表示向きとする。
- metadata は符号化の意味へ影響させない。

### 5.2 `EncodedImage`

```js
{
  width: number,
  height: number,
  format: string,
  data: Uint8Array,
  palette?: Uint8Array | Uint16Array,
  mask?: Uint8Array,
  transparent?: { kind: 'color' | 'palette-index', value: number },
  stride: number,
  stats: { dataBytes: number, paletteBytes: number, maskBytes: number },
  options: object
}
```

配列の実体と C/C++ ソース表現を分離する。`encode()` はソース文字列を返さず、
`emitCSource()` が `EncodedImage` と target preset からソースを生成する。

### 5.3 エラーモデル

- `GfxImageError` を基底とする。
- 安定した `code`、人間向け `message`、対象ファイル・設定キー・候補値を持つ。
- 設定不備、能力不足、入力破損、形式制約違反を別 code にする。
- ライブラリ本体はローカライズ済み UI 文言を持たない。
- 自動補正や情報損失は `issues[]` として返し、黙って行わない。

---

## 6. 画像処理パイプライン

処理順は次で固定する。

1. decode と EXIF orientation
2. crop
3. resize
4. alpha 処理（保持、matte 合成、閾値、色キー化）
5. 色空間上の量子化・2値化
6. dithering
7. target format への pack
8. mask / palette の生成
9. C/C++ source emit

### 6.1 切り抜き・リサイズ

- crop は `{x, y, width, height}`。
- resize は `width` / `height`、縦横比維持、`fit: contain | cover | fill`。
- filter は `nearest` / `bilinear`。ピクセルアート用途の既定は `nearest`。
- core の resize は実装を固定し、プラットフォーム Canvas の補間へ委譲しない。

### 6.2 2値化・グレースケール

- 輝度は明記した固定式で算出する。初期仕様は整数近似 Rec.709
  `Y = (54R + 183G + 19B + 128) >> 8`。
- threshold は 0..255、既定 128。
- invert を持つ。
- 1bpp の余りビットは 0、各 scanline / page は byte boundary に揃える。
- 横詰めの data bytes は `ceil(width / 8) * height`、縦詰めは
  `width * ceil(height / 8)`。幅・高さがともに 8 の倍数なら同量だが、一般寸法では
  異なり得る（例: 1x8 は横 8 B、縦 1 B）。同量時の選択規則は §8.2 で固定する。

### 6.3 減色

- 指定色数は 2..256。
- 初期実装は deterministic median-cut。入力順や乱数に結果を依存させない。
- 初期リリースは生成paletteを使う。固定paletteの注入・再利用は将来拡張とする。
- パレット順には安定した tie-break を定義する。
- RGB565 パレットを作る場合、量子化後の実色で重複を除去する。

### 6.4 ディザリング

最低限次を提供する。

- `none`
- `floyd-steinberg`
- `bayer2` / `bayer4` / `bayer8`

誤差拡散は左上から右下の固定走査とし、端処理・整数丸めを仕様化して golden test
で固定する。Web プレビューと CLI は同じ core 実装を使う。

### 6.5 透過

モードを明示指定する。

| mode | 動作 |
| --- | --- |
| `auto` | TinyGFXでは非opaque pixelをcolor-keyとして保持し、非対応targetではmatteへ合成 |
| `none` | alpha を無視。透明画素は `matte` 色へ合成 |
| `color-key` | 指定色または自動選択した 1 色を透過色にする |
| `mask` | 独立 1bpp mask を生成する |
| `alpha` | alpha を保持できる形式へ出す |

- alpha threshold の既定は 128。
- alpha modeの既定は`auto`。`none`で非opaque pixelを合成する場合はwarningへ記録する。
- `color-key: auto` は変換後画像で未使用の表現可能色を決定的に選ぶ。空き色がなければ
  エラーとし、既存色を勝手に透明にしない。
- パレット形式では transparent palette index を使う。
- TinyGFX 1bpp は 0 bit が透過という消費側仕様を report に明記する。

---

## 7. 形式エンコードと能力問い合わせ

公開 API の基本形:

```js
decodeImageFile(path, options)          // gfx-image-tool/node
decodeBrowserImage(file)                // gfx-image-tool/browser
transformImage(image, options)         // Image
canEncode(image, format, options)      // { ok, issues }
encodeImage(image, format, options)    // EncodedImage
encodeTinyCandidates(image, options)   // TinyGFX Candidate[]
emitCSource(encoded, target, options)  // { source, usage, issues }
inspectImage(image, options)           // 色数、alpha、候補サイズ
```

- `canEncode` は例外を使わず制約違反を列挙する。
- `encodeImage` は不可能な指定を黙って近似せず例外にする。
- 候補にはformat、data / palette / mask bytes、total bytesを含める。
- MSE / PSNR、alpha mismatch pixel countなどの数値画質評価は将来拡張とする。初期releaseは
  converted/comparison previewで判断する。
- decode / filesystem I/O 以外は同期 pure function とする。

---

## 8. TinyGFX 最適化

### 8.1 候補

`raw565`、`rle565`、`rlepal4`、`bitmap1h`、`bitmap1v` をすべて試す。
形式を利用者が強制する API も残す。`bitmap1h` と `bitmap1v` の byte 列は
§3.2 の汎用 1bpp encoder を再利用する。

### 8.2 評価単位

最小化する目的関数は原則として次とする。

```text
sum(各画像の data + palette + metadata)
+ decoderSetCost(使用する形式集合)
```

通常は使用 decoder 1 本につき `decoderCost` を加える。`bitmap1h` と `bitmap1v` を
両方使う場合だけ、2 本分を共有コスト `round(decoderCost * 1.3)` に置き換える。

デコーダ代は画像ごとではなく形式集合ごとに一度だけ加える。したがって
`optimizeImage()` と別に `optimizeImageSet()` を必須 API とする。形式数は少ないため、
許可された形式集合を全探索して global optimum を得る。

選択順序を次で固定する。

1. `format` または `bitmapLayout` が明示されていれば候補をその指定に制限する。
2. 画質制約を満たさない候補を除外する。
3. 上記目的関数が最小の候補を選ぶ。
4. 完全に同点なら安定した形式順を使う。1bpp 同士の同点は `preferBitmap` で決める。

`preferBitmap` は `horizontal | vertical`。ページ方式パネル（SSD1306 / SH1106 等）と
`aligned-vblit` 利用時は `vertical`、それ以外は `horizontal` を target preset の既定と
する。貼り先が既知なら `bitmapLayout` で明示する。ファイル列挙順や object key 順へ
tie-break を依存させない。

### 8.3 固定デコーダコスト

MCU 別・形式別の実測 profile は持たない。全形式を同じ固定値で評価する。

| 項目 | 既定値 |
| --- | ---: |
| decoder 1 形式 | 400 B |
| `bitmap1h` と `bitmap1v` の両方 | 520 B（400 B × 1.3） |

- `raw565` / `rle565` / `rlepal4` / 1bpp の各 decoder は 1 本 400 B とする。
- 1bpp の横と縦は実装を共有するため、両方使っても 800 B ではなく 520 B とする。
- 透過判定はこの固定値に含むものとして扱い、透過画像に追加コストを加えない。
- CLI の `--decoder-cost <N>` と API の `decoderCost` で 1 形式の値を上書きできる。
  共有 1bpp は `round(N * 1.3)` とする。
- MCU の指定、形式別 cost table、JSON cost profile、実測値の自動同期は実装しない。

根拠は TinyGFX `docs/IMAGE_FORMAT.ja.md` の感度検証である。CH32V003 / AVR / ESP32、
3 種類の画像集合の計 9 ケースで、実測 profile と固定 400 B の選択が一致した。
さらに 100〜800 B の範囲で選択結果の感度が低い。データ量が形式間で桁違いになるため、
decoder の数十〜数百 byte の差は通常、形式集合の選択を変えない。

`aligned-vblit` は固定 decoder cost に混ぜない。CH32V003 の本実装実測は fast path
244 B、汎用 `drawImage` 408 B（差 164 B）だが、これは形式間の容量最適化ではなく
**サイズと速度の選択**である。利用者が明示的に有効化し、report には通常経路と
fast path の双方を別欄で表示する。当初見積もりの 24 B は使用しない。

### 8.4 レポート

1 枚ごとの候補表、単純な画像別最小、集合最適化後の選択、使用形式集合、
データ量、デコーダ量、差分を text / JSON の両方で返す。

---

## 9. C/C++ ソース生成

生成器は次を保証する。

- C identifier への正規化、予約語回避、同名衝突の検出。
- 入力相対パスで安定ソート。
- `uint8_t` / `uint16_t`、alignment、`const`、`static`、`PROGMEM` のテンプレート化。
- include guard または `#pragma once`。
- 幅、高さ、stride、data length、palette length、透過情報。
- target が要求する構造体・参照・使用例。
- 生成ツール名と version、再生成可能な設定概要。
- timestamp、絶対パス、実行環境依存の改行を既定では入れない。
- LF と末尾改行を固定し、hex は大文字、1 行の要素数も固定する。

`generic-c` は宣言テンプレートを設定できるが、任意コード実行や JS template の
評価は行わない。定義済み placeholder の置換だけとする。

---

## 10. フォルダー規約と設定

### 10.1 単独利用

本ツールだけで入力画像から利用可能な `.h` までを生成する。他ツールへの委譲、
asset bundle への取り込み、元画像ファイルの埋め込みは行わない。

入力 path がファイルなら 1 枚を処理する。新規projectはfirmware project直下の`images/`を素材rootとし、
そこへ`.imagesconfig`、`.imagesignore`、元画像を置く。firmware projectをCLIへ渡すと
`images/`を自動検出し、`images/`自体を渡しても同じ結果にする。root直下の`.imagesconfig`は
project設定として読み込まない。

単一画像入力は自己完結した `.h` 1 本を生成する。directory入力は全画像をまとめた
**project header 1 本**を既定とする。利用側のincludeとWebからのdownloadが1ファイルで
済み、未参照の`static const`データは通常の`-fdata-sections` / `--gc-sections`構成で除去
できるためである。symbolは入力相対パス順で安定生成し、bundle内の衝突を検出する。

画像ごとのheaderが必要な場合だけ`output_mode = split`を指定する。split時は元のdirectory
構造を出力directoryへ保ち、任意のindex headerを生成できる。生成先・設定ファイル自身は
入力から除外する。

bundleにはEmbed Asset Toolと同系統の`*_file_count`、`*_file_names`、`*_file_data`、`*_file_sizes`を
常に生成し、画像固有情報としてwidth、height、formatの並列配列を加える。TinyGFXだけは
`TinyGFXImageRef`への`*_file_refs`も生成する。入力相対path順を全配列で共有する。一覧が未参照なら
section GCで一覧と未使用画像を除去でき、pointer一覧を参照した場合は全参照先を保持する設計とする。

headerの追跡cacheは`images/.gfx-image-tool/headers.json`、previewの追跡cacheは
`images/.gfx-image-tool/previews.json`へ置き、preview出力先には生成PNG以外を置かない。通常buildは前回cacheに記録され、
今回の期待集合から外れたファイルだけを削除する。`--check`は削除せずstaleとして終了2を返す。
cacheに記録されていないファイルは削除しない。`.gfx-image-tool/`は入力走査とgit管理から除外し、
削除しても同じheaderを再生成できる。cache欠落だけでは`--check`を失敗させず、stale検出を省略した
warningを出す。数字またはunderscoreで始まる入力symbolは
`img_`系prefixを付け、global namespaceの予約識別子を生成しない。

設定例:

```ini
[general]
output_dir = ..
output_mode = bundle
output_file = images.h
prefix = images
target = generic-c

[input]
patterns = **/*.png, **/*.jpg, **/*.jpeg, **/*.gif, **/*.bmp

[color]
format = rgb565be
colors =
dither = none
threshold = 128
invert = false

[alpha]
mode = auto
threshold = 128
color = auto

[preview]
# 空ならpreview生成は無効
output_dir =
layout = converted

[csource]
storage = PROGMEM
align = 4
static = true

[optimize]
decoder_cost = 400
prefer_bitmap = horizontal
aligned_vblit = false

[image "splash.png"]
mode = monochrome
threshold = 144
dither = bayer4

[image "icons/*.png"]
mode = indexed
colors = 16
alpha_mode = color-key
source_key = FF00FF
```

- 不明section / keyは初期releaseではforward compatibilityのため読み飛ばす。
- 値不正は設定キーを示してエラーにする。既定値への黙った置換はしない。
- CLI option は設定を上書きし、API option は CLI と同じ構造を使う。
- 画像別 override は glob section（例: `[image "icons/*.png"]`）で指定可能にする。`source_key`は
  decode後の元画像RGBと完全一致するpixelをalpha 0へ変換し、`alpha_color`とは別に扱う。
- glob section には共通設定との差分だけを記述できる。
- Web が出力する設定と CLI が読む設定は同一 schema とし、相互に再現できる。

---

## 11. CLI

兄弟ツールに揃え、command + path を基本形とする。

```sh
npx gfx-image-tool build [path] [options]
npx gfx-image-tool inspect [path] [options]
npx gfx-image-tool init [path]
npx gfx-image-tool --version
```

主要 option:

```text
--out <path>          単一画像の header、または directory 処理の出力 directory
--target <id>         出力ターゲット
--format <id|auto>    形式を固定、または候補から選択
--decoder-cost <N>     TinyGFX decoder 1形式の固定コスト（既定400 B）
--check               書き込まず既存出力との一致を検査
--json                stdout を機械可読 JSON にする
--preview <path>      単一画像の変換後 PNG、または preview 出力 directory
--preview-layout <id> converted、左右比較のcomparison、両方生成するboth
--name <identifier>   単一画像のシンボル名
--prefix <identifier> directory 出力の接頭辞
-h, --help
```

- path が画像なら単一変換、directoryならそのdirectory自身が`images/`か、配下の`images/`を解決して対象画像を再帰処理する。
- 単一画像の既定出力は同じ directory の `<stem>.h`、directory の既定出力は
  新規`images/` projectでは親の`images.h`とする。`output_dir`と`output_file`で変更できる。
- `inspect` は書き込まず、実効設定、入力一覧、画像情報、候補形式とサイズを表示する。
- `init <project>`は`<project>/images/.imagesconfig`と、cacheを除外する`.gitignore`を作る。
  既存ファイルは変更しない。
- `--json` 時は stdout を JSON 専用とし、人間向け進捗は stderr へ出す。

終了コード:

| code | 意味 |
| ---: | --- |
| 0 | 成功、または `--check` 一致 |
| 1 | 読み書き、decode、変換エラー、対象なし |
| 2 | `--check` 不一致または出力なし |
| 3 | command / option / config の誤り |

---

## 12. Web リファレンスアプリ

UI framework なしの静的アプリを GitHub Pages で配信する。単一画像専用の demo ではなく、
**複数画像を 1 project として比較・調整できる作業台**にする。一方、directory の監視、
自動再生成、コンパイル前 hook は持たず、それらは CLI の責務とする。

### 12.1 操作の流れ

1. 1 枚以上の画像を drop / paste / file picker で追加する。
2. target と project 共通設定を選ぶ。
3. 一覧で寸法、元色数、alpha、候補形式、変換後容量を比較する。
4. 画像を選び、共通設定を画像単位で上書きしてプレビューする。
5. TinyGFX では全画像を集合最適化し、画像別最小との差を確認する。
6. 元画像を含むproject ZIP、project `.h`、`.imagesconfig`をproject file欄からdownloadする。選択画像の
   `.h`と変換後／左右比較PNGは、選択画像panelからdownloadする。report JSONとpreview PNGは既定ZIPへ含めない。
7. 保存したproject ZIPをdropして、設定と`images/`内の元画像をworkspaceへ復元できる。

1 枚だけ投入した場合も同じ画面を簡易モードとして使える。別の「お試し専用画面」は
作らず、同じworkspaceをそのまま使う。

### 12.2 設定の階層

設定は project default と per-image override の 2 層にする。同じ種類の画像をまとめて
扱えるよう、将来 glob group を UI に加えられる schema とする。

project 共通に向く項目:

- target、TinyGFX の固定 decoder cost / 最適化目的
- format の `auto` / 許可形式集合
- 既定alpha threshold、透過色
- C/C++ の storage、alignment、prefix、命名規則

画像ごとに調整する項目:

- mode: `auto` / `monochrome` / `grayscale` / `indexed` / `true-color`
- 強制 format、最大色数、固定 palette
- threshold、dither、mode、format

`mode` は利用者向けの入口で、選択した target に不可能な形式を隠す。実際の format は
advanced 欄で確認・固定できる。`auto` は画質制約を満たす候補だけから選ぶ。
選択画像panelは実効mode/formatで意味のないoverride項目をdisabled表示せず、行ごと非表示にする。
symbolは最終結果として表示するが、Webの画像別設定項目には置かない。

project共通設定は全項目を常時表示する。項目数が少なく、畳むことで設定の存在を見落とす方が問題に
なるため、decoder cost、1bpp preference、`aligned-vblit`、symbol prefix、header名も同じcard内に置く。

### 12.3 比較表示と出力

プレビューには最近傍拡大、pixel grid、alpha checker、白・黒・マゼンタ・緑の背景切替、背景2色の
点滅、原画と変換後の並列表示を持たせる。元画像色の透明化はnative EyeDropperまたは原画preview上の
pixel clickで指定できる。最終結果としてformat、data byte、元／変換後の透明pixel数、実際の抜き色を表示する。
スポイトは原画preview内のpixelだけを取得する。手入力色が元画像に存在しなければ毎回原画から再計算した
結果を使って透明化を0 pixelに戻し、「該当色なし」を明示する。以前の抜き色結果を残してはならない。
候補ごとにdata / paletteとdecoder costを含む容量を表示する。設定変更はcore APIを再実行するだけとし、
UI専用変換を作らない。実寸表示、任意背景色、MSE / PSNRは将来拡張とする。

設定exportはproject defaultとoverrideを`images/.imagesconfig`へ書く。再importすると同じ選択状態と
出力byte列を再現する。project ZIPはrootにbundle header、`images/`に元画像、設定、`.gitignore`を収録する。
report、preview、`.gfx-image-tool/`は含めない。WebはこのZIPを再importでき、`images/`だけを入力として復元する。

i18n、ロケール検査、サイト生成、Pages workflow は `LGFXFontToolJs` と同じ構造を使う。
初期ロケールは `en` / `ja`。中国語追加は辞書追加だけで済む構造にする。

---

## 13. JavaScript API と package exports

```js
import {
  transformImage,
  encodeImage,
  encodeTinyCandidates,
  optimizeTinyImageSet,
  emitCSource,
  inspectImage,
} from 'gfx-image-tool';

import { decodeImageFile } from 'gfx-image-tool/node';
import { decodeBrowserImage } from 'gfx-image-tool/browser';
```

- package root は安定 API のみ export する。
- `./src/*` は兄弟 font tool と同じく高度利用向けに公開するが semver 上は準安定扱い。
- `./node` に Node decoder / filesystem workflow、`./browser` に browser decoder を分ける案を採用する。
- top-level import で DOM や native optional dependency をロードしない。
- `types/` に `tsc --emitDeclarationOnly` で `.d.ts` を生成する。

---

## 14. アーキテクチャとリポジトリ構成

```text
GfxImageToolJs/
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.types.json
├── README.md / README.ja.md
├── CHANGELOG.md
├── LICENSE
├── bin/
│   └── gfx-image-tool.js
├── src/
│   ├── index.js
│   ├── model/          # Image / EncodedImage と検証
│   ├── transform/      # crop / resize / alpha / quantize / dither
│   ├── format/         # bit packing と各画素形式 encoder
│   ├── target/         # preset と C/C++ emitter
│   ├── optimize/       # 候補比較、TinyGFX 集合最適化、固定 decoder cost
│   ├── inspect/        # 統計・誤差・report
│   ├── node/           # Node decoder と filesystem workflow
│   ├── browser/        # browser decoder
│   └── util/
├── web/                # 編集する静的Web source
├── docs/
│   ├── GUIDE.md / GUIDE.ja.md
│   ├── ADVANCED.md / ADVANCED.ja.md
│   ├── CLI.md / CLI.ja.md
│   ├── spec.ja.md
│   └── release.md / release.ja.md
├── test/
│   └── *.test.js
├── scripts/
│   ├── build.js
│   ├── build-site.js
│   ├── smoke-dist.js
│   ├── check-locales.js
│   ├── check-releasable.js
│   ├── prepare-tinygfx-oracle.js
│   ├── serve.js
│   └── sync-version.js
└── .github/workflows/
    ├── ci.yml
    ├── pages.yml
    └── release.yml
```

生成物は `dist/`、`types/`、`site/`。原則 `.gitignore` とし npm pack / Pages 前に生成する。

依存方向:

```text
util ← model ← transform / format ← target / inspect / optimize
                                      ↑
                          node / browser adapters
                                      ↑
                                CLI / Web
```

`src/`のcoreから`web/`、`bin/`、Node builtinへ依存しない。Node builtinを使うコードは
`src/node/`に閉じ込める。typecheckとbrowser bundle smokeで境界の崩れを検出する。

---

## 15. テストと正しさ

### 15.1 必須テスト

- `node:test` を使用する。
- 手書き最小画像: 1x1、端数幅、高さ端数、透明、全色同一、最大 palette 境界。
- 各 bit / byte order の期待 byte 列を手計算 fixture と完全一致。
- 1bpp は 1x8 等の非対称寸法で横・縦の容量差を検証し、8 の倍数寸法では
  `preferBitmap` による安定した同点選択を検証する。
- TinyGFX optimizer は decoder 1 本 400 B、1bpp 両方 520 Bで集合選択を固定し、
  `decoderCost` 上書き時も共有コストを同じ丸め規則で算出する。
- 各 transform の golden pixel 一致。
- 量子化・dither の決定性と golden 一致。
- PNG/JPEG/GIF/BMP decode、破損入力、巨大寸法拒否。
- targetごとのC source出力とusageのtest。
- CLI、`--check`、JSON stdout、終了コード。
- config parse、glob override、symbol collision、path traversal 防止。
- package tarball の import、CLI、browser bundle smoke test。

### 15.2 オラクル

- TinyGFX: 生成ヘッダーを TinyGFX の host test へ読み込み、描画結果を元の変換後 RGBA
  と pixel exact 比較する。全 TinyGFX 形式と透過あり・なしを対象にする。
- `img2h.py` はオラクルにしない。ラン長の分割、palette index の packing、1bpp bit order
  について既知 fixture との補助的な交差検査にだけ使う。PNG 以外の decode、減色、
  dither の正しさを同スクリプトとの一致で判定しない。
- 一般形式: まず byte layout の仕様 fixture を正とする。可能な target は実ライブラリの
  host build / reference function でも照合する。
- encode → reference decode → pixel の一致を検証し、自作 encode/decode の往復だけで
  正しさを証明しない。

### 15.3 非機能要件

- 既定最大画素数を設ける（案: 64 megapixels）。API / CLI で明示 override 可能。
- サイズ計算は allocation 前に overflow を検査する。
- 入力ファイル名を C comment へ出す際は改行等を sanitize する。
- 任意パスへの上書きを避け、出力先を解決・表示してから atomic replace する。
- 一括処理の並列化を許すが、出力順と結果は変えない。

`npm run check`はtest、typecheck、locale checkを含む。
CI は check、build、types、dist smoke、site build を実行する。

---

## 16. 公開・リリース

兄弟ツールと同じローカル npm publish を正式経路とする。

`package.json` の基本契約:

- `name: gfx-image-tool`
- `type: module`、`sideEffects: false`、`engines.node: >=20`
- `main` / `module`: `dist/gfx-image-tool.js`
- `browser` / `unpkg` / `jsdelivr`: `dist/gfx-image-tool.min.js`
- `types`: `types/index.d.ts`
- `bin.gfx-image-tool`: `./bin/gfx-image-tool.js`
- npm `files`: `bin`, `dist`, `src`, `types`, README、CHANGELOG、LICENSE

scripts:

| script | 内容 |
| --- | --- |
| `test` | `node --test` |
| `typecheck` | `tsc --noEmit` |
| `check` | test + typecheck + layers + locales |
| `build` | ESM / minified browser bundle 生成 |
| `types` | declaration 生成 |
| `build:site` | Pages artifact 生成 |
| `smoke:dist` | pack 相当成果物から API / CLI を起動 |
| `prepack` | build + types |
| `preversion` | check + `check-releasable.js` |
| `version` | `sync-version.js` |

通常のリリース手順:

```sh
npm run check
npm pack --dry-run
git status
npm version patch              # minor / major は semver に従う
npm publish --access public
git push --follow-tags
```

- `CHANGELOG.md` の `## Unreleased` に `(EN)` / `(JA)` の組で変更を書く。
- `preversion` は clean/releasable 条件と未記載 changelog を検出して中止する。
- `version` は package version、CHANGELOG 見出し、Web/CDN の固定 version を同期する。
- `prepack` は配布物を再生成する。
- `ci.yml` は main / PR、`pages.yml` は main / manual、`release.yml` は manual の予備。
- npm token は repository に置かない。将来 CI publish を使う場合は Trusted Publishing と
  provenance を使う。

---

## 17. 実装履歴と今後

Phase 1〜4は初期releaseへ実装済み。Phase 5は需要に応じて検討する将来候補である。

### Phase 1 — Core と汎用 C 出力

- model、RGBA 入力、1bpp / gray8 / RGB332 / RGB565 / RGB888
- threshold、invert、alpha matte / mask、Floyd-Steinberg / Bayer
- generic-c target、単一画像 CLI、inspect、golden tests

### Phase 2 — フォルダー運用と主要 GFX

- Node decoder、canonical `images/` project、`.imagesconfig`、`.imagesignore`、bundle / split `.h`
- quantize / indexed8
- Adafruit_GFX、U8g2、LovyanGFX、Arduino_GFX、TFT_eSPI presets
- `init`、`--check`、JSON report、CI/package/release scripts

### Phase 3 — TinyGFX 最適化

- TinyGFX 5 optimizer 候補と C header（1bpp 2 候補は汎用 encoder を共有）
- 固定 decoder cost、1bpp 共有割引、集合最適化
- TinyGFX host oracle、実験用 `img2h.py` との補助的な符号化 fixture 交差検査

### Phase 4 — Web project workspace

- 複数画像 workspace、共通設定＋画像別 override、設定 import / export、project `.h` download
- Converter / Optimizer UI、i18n、Pages
- npm dist / types / CDN

### Phase 5 — 需要に応じた拡張

- C source import、WebP 必須化、QOI、32bit alpha、追加 target
- 複数フレーム画像、ユーザー定義 target preset
- 速度・flash・画質を重み付けする multi-objective optimizer

---

## 18. 将来拡張で決める事項

初期releaseのblockerではない。該当機能へ着手するときに決める。

| 論点 | 現時点の案 |
| --- | --- |
| Node decoderのoptional dependency | 初期releaseは`@napi-rs/canvas`。変更時はdecode差とpackage容量を再評価する |
| `.imagesconfig`の名前 | 本ツール専用設定として採用済み。将来変更する場合はmigrationを用意する |
| target preset の厳密な API 対応版 | 各 upstream の version を fixture metadata に記録し、形式仕様と C template を分離する |
| RGB565 palette の byte order | palette の整数表現と memory byte order を別 option として最終確定する |
| GIF / WebP animation | 初期releaseは第1frameのみ。診断とframe set modelは需要に応じて追加する |
| crop/resizeのUI/CLI公開 | Core APIには実装済み。UI/CLIへの公開は操作需要を確認して決める |
| 最適化時の画質制約 | `maxMse` 等で候補を足切りしてから容量最小化する方式を初期案とする |
| Webの対応言語 | 初期releaseはen / ja。追加localeは辞書追加の需要に応じて判断する |

---

## 19. 初期リリースの受け入れ条件

`0.1.0` は次をすべて満たした時点で公開可能とする。

1. PNG / JPEG / GIF / BMP を Node CLI で読み、必須の汎用形式へ変換できる。
2. generic-c と主要 5 GFX targetについて、bundleと画像別splitのヘッダーが生成できる。
3. 単一画像とcanonical `images/` projectのbuild / inspect / init / checkが動く。
4. Web で複数画像、共通設定＋画像別上書き、設定再 import、project `.h` download が動く。
5. TinyGFX 5 候補、固定 decoder cost、集合最適化が動き、TinyGFX host test の描画結果と
   pixel exact で一致する。`img2h.py` との一致は符号化 byte 列の補助検査とする。
6. byte order、bit order、alpha、端数幅、palette 境界を golden test で固定している。
7. `npm run check`、build、types、dist smoke、site build が CI で通る。
8. README、初心者／上級guide、CLI文書、release文書が日英で相互linkされ、実装仕様とCHANGELOGがある。
9. `npm pack --dry-run` に開発用 fixture や不要な native binary が混入しない。
10. npm 名の再確認後、兄弟ツールと同じリリース手順で公開できる。
