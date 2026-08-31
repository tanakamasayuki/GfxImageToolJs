# 画像形式と最適化の上級ガイド

[English](ADVANCED.md) | 日本語

このガイドは、変換結果の品質・Flash容量・描画経路を意図的に調整したい利用者向けです。
初めて組込み画像を扱う場合は、先に[入門ガイド](GUIDE.ja.md)を読んでください。正確なCLI構文は
[CLIリファレンス](CLI.ja.md)、実装上の契約は[仕様書](spec.ja.md)にあります。

## 変換パイプライン

ツールは入力ファイルを直接C配列へコピーするのではなく、一度RGBA8888の中立画像へdecodeし、
設定を適用してから目的形式へencodeします。

```text
source file
  → RGBA8888 decode
  → alpha処理
  → mode / quantize / dither / threshold
  → format encoder
  → target-specific C/C++ emitter
  → reference decodeによるpreview
```

コア変換はCLIとWebで共通です。入力decoderは環境ごとに異なり得ますが、decode後の同じRGBAと
同じ設定に対するencodeは決定的です。

## TargetとFormatは別の概念

`target`は、生成したデータを受け取る描画ライブラリとC/C++宣言を選びます。`format`は画素を
並べる方法です。同じRGB565でも、byte order、配列型、描画関数がtargetごとに異なることが
あります。

target presetは許可形式を制約し、対応する宣言と使用例を生成します。まずtargetを選び、
必要な場合だけformatを固定してください。`generic-c`は外部ライブラリに依存しない配列が必要な
場合に使います。

## 汎用形式の選択

| Format | Layout | 主な用途と注意 |
| --- | --- | --- |
| `bitmap1-msb` | 横8画素/byte、左がMSB | 多くのbitmap API |
| `bitmap1-lsb` | 横8画素/byte、左がLSB | XBM系API |
| `bitmap1-vertical` | 縦8画素/byte、上がLSB | page方式OLED |
| `mask1-msb` | 独立した1bpp mask | 色データと透過を分離するtarget |
| `gray8` | 輝度1 byte/画素 | grayscale API |
| `indexed8` | index 1 byte/画素＋palette | 少色画像。palette代も必要 |
| `rgb332` | 直接色1 byte/画素 | 容量優先。色精度は低い |
| `rgb565le/be` | 直接色2 bytes/画素 | カラーLCD。byte orderをAPIに合わせる |
| `rgb888` | RGB 3 bytes/画素 | 色精度優先。容量が大きい |

1bppの末尾byteには、幅または高さが8の倍数でない場合の未使用bitがあります。format名だけでなく、
消費側APIが期待するbit orderとstrideを必ず合わせます。

## TinyGFXの5候補

TinyGFX targetの`auto`は次を比較します。

| Optimizer ID | 内容 | 得意な画像 |
| --- | --- | --- |
| `raw565` | 非圧縮RGB565 | 写真、圧縮しにくい画像、decode負荷を抑えたい場合 |
| `rle565` | 同じRGB565色のrun | ベタ塗り、横方向に同色が続く画像 |
| `rlepal4` | 16色以下のpalette＋短いrun | アイコン、ドット絵、少色UI |
| `bitmap1h` | 横詰め1bpp | 一般的なbitmap描画 |
| `bitmap1v` | 縦詰め1bpp | page方式panel、縦方向fast path |

`bitmap1h`と`bitmap1v`は、汎用の`bitmap1-msb`と`bitmap1-vertical`と同じbyte layoutです。
TinyGFX固有なのは、同じデータを`CellImage`と対応するopsで包む部分です。

TinyGFXのbitmap decoderはpalette entry 1だけを描き、0 bitは「描画先をそのまま残す」という意味です。
不透明な2色を両方描く形式ではありません。そのため自動選択でbitmapを候補にするのは、透過を含めても
可視色が1色だけの場合です。不透明な2色画像は`rlepal4`などのcolor形式に残します。意図的に
背景／前景へ変換するときだけ`--monochrome`または`mode = monochrome`を指定し、thresholdとditherを
確認します。

## なぜ複数画像をまとめて最適化するのか

Flashで必要になるのは画像データだけではありません。使用する形式ごとにdecodeコードもリンク
されます。そのため目的関数は概念的に次の形です。

```text
全画像の data + palette
+ 使用する形式集合の decoder cost
```

decoder costは画像ごとではなく、形式ごとに1回です。各画像を単独で最小にすると、多数の形式を
少しずつ選び、project全体ではdecoderが増える可能性があります。directory buildとWebの複数画像
workspaceは、候補形式集合を評価して全体の最小を選びます。

既定では各形式のdecoderを400 Bとして扱います。`bitmap1h`と`bitmap1v`を両方使う場合は共有実装を
考慮して520 Bです。透過の実行時判定もこの固定値に含まれ、透過画像だけへ追加費用は加えません。

`--decoder-cost`は、別の計測前提で感度を確認するための上書きです。通常は400のままで構いません。
reportの`individual minimum`は比較用で、project選択とは評価単位が異なります。

## 1bppの横詰めと縦詰め

幅と高さがともに8の倍数である一般的なpanel素材では、横詰めと縦詰めのデータ量は同じです。
端数寸法では、横はscanline、縦はpageごとのpaddingがあるため異なる場合があります。同量時に
サイズ比較だけで向きは決められないので、tie-breakを`prefer_bitmap`で固定します。

- SSD1306やSH1106などpage方式panelへbyte copyする: `vertical`
- `pushVBitmap`やaligned vertical blitを使う: `vertical`
- それ以外、一般的なbitmap API: `horizontal`

`aligned_vblit`は容量形式の最適化ではなく、コードサイズと描画速度の選択です。比較情報として
aligned 244 B、generic 408 Bをreportしますが、形式選択の合計には加算しません。panel境界、回転、
dirty trackingなどの条件があるため、単純な`memcpy`だけの費用ではありません。

## 色数、palette、圧縮の相互作用

`colors`は最大palette数です。少なくするほどpalette自体は小さくなりますが、必ず総容量が減るとは
限りません。

- 減色で同じ色の領域が広がるとRLEが効きやすくなる
- ditherで細かな色変化が増えるとRLEが効きにくくなる
- `indexed8`は常に1 byte/画素なので、小画像ではpalette overheadが相対的に大きい
- TinyGFX `rlepal4`は16色以下とrunの両方が合う画像で強い
- RGB565への量子化後に同じになる色は、実際の出力色として重複を除く必要がある

Webの候補表または`inspect --json`でdata bytes、palette bytes、decoder bytesを分けて比較できます。
品質を落とす設定では、容量だけでなくconverted previewも必ず判断材料にします。

## Alpha処理を設計する

### `auto`

TinyGFXではsourceに非opaque pixelがあれば`color-key`として保持します。alphaを扱えないtargetでは
matteへ合成します。projectと単一画像で意味は同じです。

### `color-key`

alpha threshold未満の画素を1つの透明値へ置き換えます。`color = auto`は可視画素と衝突しない
表現可能なRGB565値を決定的に選びます。palette形式ではtransparent palette indexとして表現します。
利用可能な値がない場合は、黙って可視色を抜かずエラーにします。

color keyは二値透過なので、半透明の縁は透明か不透明のどちらかになります。素材側で縁を対象背景へ
premultiplyしたような画像は、別背景でhaloが出ることがあります。実機の代表的な背景色でも確認します。

`source_key = RRGGBB`は前処理であり、`[alpha] color`とは別です。decodeした元画像でRGBが完全一致する
pixelをalpha 0へ変えます。`[alpha] color`は、既に透明になったpixelを表す変換後RGB565値を選びます。
画像別sectionでは両方を指定できます。

### `none`

alphaをmatteへ合成します。非opaque pixelを含む画像で明示すると`ALPHA_COMPOSITED` warningを
reportします。背景が固定で、二値透過より滑らかな縁を優先する場合には有効です。

TinyGFX 1bppでは0 bitが透明として扱われるという消費側の制約があります。反転、前景色、透過の意味を
同時に変える場合はpreviewと実機の両方で検証してください。

## BundleとSplit

新規projectは`images/`内の全画像から、その親へ`images.h` 1本を生成します。includeが簡単で、全画像のsymbol衝突を
一度に検査でき、生成物管理も明瞭です。一般的な`-fdata-sections`と`--gc-sections`を有効にした構成では、
未参照のdata sectionをlinkerが除去できます。

bundle末尾には`<prefix>_file_count`、`file_names`、`file_data`、`file_sizes`、`file_widths`、
`file_heights`、`file_formats`を生成し、TinyGFXだけは`file_refs`も生成します。一覧自身を参照しなければ、
`-fdata-sections`と`--gc-sections`により一覧と未使用画像を除去できます。逆に`file_data`または
`file_refs`を参照すると、その一覧がpointerで指す全画像を意図的に保持します。toolchainのsection GCが
無効な場合は除去を保証できないため、最終判断はmap fileで行います。

ただし、header内の定義を複数translation unitへincludeすると、`static` dataが単位ごとに複製される
可能性があります。bundleは通常1つの`.cpp`からincludeするか、map fileで最終Flashを確認してください。
分割コンパイルや所有単位を明確にしたい場合は`output_mode = split`を使います。

## 再現可能なdirectory build

設定の優先順位は、project default、`[image "glob"]` override、CLI optionの順です。Webからexportした
`.imagesconfig`はCLIで読み戻せます。入力は相対pathで安定sortされ、timestampや絶対pathは生成物へ
入れません。

```sh
gfx-image-tool build ./MySketch
gfx-image-tool build ./MySketch --check
```

新規projectの`.imagesconfig`は`MySketch/images/`にあり、`output_dir = ..`が既定です。任意の
`output_dir`と`output_file`へ変更できます。`--check`はread-onlyで、欠落・差分・stale outputがあれば
終了2です。headerは`images/.gfx-image-tool/headers.json`、previewは
`images/.gfx-image-tool/previews.json`で、ツールが
以前生成したファイルだけを追跡します。通常buildはcache上の孤立ファイルを削除し、利用者が置いた
未追跡ファイルは削除しません。`.gfx-image-tool/`は派生cacheなのでgitへ入れず、削除しても同じheaderへ
戻せます。

cacheがなければ、過去の生成物を安全にstaleと断定できません。その場合も期待するheaderの一致は検査し、
stale検出を省略したwarningを出します。次の通常buildでcacheを再作成します。

## Previewは何を保証するか

`converted` PNGは生成assetをreference decoderで戻した画素です。`comparison`は原画を左、変換後を右へ
同じ高さで並べます。`both`は両方を生成します。CLI previewは一般的なPNGで、PPMではありません。

previewはencoderの意図を確認する強い手段ですが、target libraryの実装やpanel配線までは検証しません。
byte orderやbit orderの最終確認には、生成ヘッダーを実ライブラリのhost testまたは実機で描きます。
TinyGFXではhost oracleで全5形式をpixel exact比較するのが正検査です。

## CIでの運用例

```sh
npm ci
gfx-image-tool build MySketch --check
```

終了コード2は「生成物が最新でない」、3はoption/config誤り、1はI/O・decode・変換失敗です。JSONを処理する
場合は`--json`を使い、stdoutを機械可読出力として扱います。

## JavaScript APIの境界

UIやfilesystemに依存しない処理はroot exportから使えます。

```js
import { createImage, encodeImage, emitCSource } from 'gfx-image-tool';

const image = createImage(1, 1, [255, 0, 0, 255]);
const encoded = encodeImage(image, 'rgb565be');
const { source } = emitCSource(encoded, 'generic-c', { name: 'redPixel' });
```

Nodeの画像decodeは`gfx-image-tool/node`、browser adapterは`gfx-image-tool/browser`です。core APIの境界では
RGBA8888の中立modelを使い、`Buffer`やDOM objectをformat encoderへ持ち込みません。

## 関連資料

- [入門ガイド](GUIDE.ja.md)
- [CLIリファレンス](CLI.ja.md)
- [実装仕様](spec.ja.md)
- [README](../README.ja.md)
