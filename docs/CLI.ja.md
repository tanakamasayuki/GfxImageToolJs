# CLI リファレンス

[English](CLI.md) | 日本語

初めて画像を変換する場合は[初心者向けガイド](GUIDE.ja.md)、形式やTinyGFX最適化の背景は
[上級ガイド](ADVANCED.ja.md)を先に参照してください。この文書は正確なコマンドと設定の
リファレンスです。

## コマンド

```text
gfx-image-tool build <path> [options]
gfx-image-tool inspect <path> [options]
gfx-image-tool init [directory]
```

`path`がファイルなら1枚を変換します。`init MySketch`は`MySketch/images/.imagesconfig`を作り、
`build MySketch`と`inspect MySketch`はこのcanonical projectを自動検出します。元画像は`images/`へ置き、
既定で親の`MySketch/images.h` 1本へまとめます。`build MySketch/images`も同じです。`init`は既存設定を
上書きしません。`[general] output_mode = split`で画像別headerへ切り替えられます。

## 共通オプション

| option | 内容 |
| --- | --- |
| `--out <path>` | 単一画像の出力ヘッダー、またはprojectの出力directory |
| `--preview <path>` | 単一画像の変換後PNG、またはproject previewの出力directory |
| `--preview-layout <id>` | `converted`（既定）、左右に並べる`comparison`、両方出す`both` |
| `--target <id>` | C出力target。TinyGFXは`tinygfx` |
| `--format <id>` | 形式を固定。TinyGFXの既定は`auto` |
| `--mode <mode>` | `auto`、`monochrome`、`grayscale`、`indexed`、`true-color` |
| `--name <id>` | 単一画像のC symbol |
| `--prefix <id>` | project内の全symbolへ付けるprefix |
| `--threshold <0..255>` | 1bppの輝度threshold |
| `--alpha-threshold <0..255>` | alphaを透過と判定するthreshold |
| `--transparent-color <RRGGBB\|auto>` | TinyGFXの透過色。既定は自動選択 |
| `--dither <mode>` | `none`、`floyd-steinberg`、`bayer2/4/8` |
| `--colors <2..256>` | `indexed8`の最大palette数 |
| `--matte <RRGGBB>` | alphaを指定色へ合成 |
| `--check` | 書き込まず、差分または欠落時に終了コード2 |
| `--json` | stdoutへJSON reportを出力 |

すべての`--json`出力は、生成に使用したCLIを識別する次のfieldから始まります。生成headerへversion
commentは埋め込まないため、tool更新だけでheader差分が発生することはありません。

```json
{ "tool": { "name": "gfx-image-tool", "version": "0.1.0" } }
```

TinyGFXでは`--decoder-cost <N>`で1形式分の固定コストを変更できます。
`--prefer-bitmap h|v`は同容量の1bpp形式を安定して選ぶための指定です。
`--monochrome`を付けると、3色以上の画像もthreshold処理して1bpp候補へ加えます。
`--aligned-vblit`は縦詰めを既定にし、fast pathの実測コストを別欄でreportします。

変換後の実画素はPNGへ書き出せます。

```sh
gfx-image-tool build icon.png --target tinygfx --preview icon-converted.png
gfx-image-tool build icon.png --target tinygfx \
  --preview icon-comparison.png --preview-layout comparison
gfx-image-tool build icon.png --target tinygfx \
  --preview icon.png --preview-layout both
```

directoryの場合、`--preview previews`のように出力directoryを指定します。入力のsubdirectory
構造を保ったPNGが生成されます。previewはheaderへ格納された形式をdecodeした画素なので、
RGB565の丸め、palette減色、1bpp化、透過を含みます。`comparison`は左が原画、右が変換後です。
`both`では指定pathが変換後画像、同じdirectoryの`<stem>.comparison.png`が左右比較画像に
なります。directory出力でも`image.png`と`image.comparison.png`を同時生成します。
`--preview`が生成するのは常に一般的なPNGです。PPMはTinyGFXの旧P6 oracle fixtureを読む
補助scriptだけで使い、preview出力には使いません。P6 PPMはheaderに続けて無圧縮RGB byteを
並べるalphaなしの形式で、目視確認や配布にはPNGのほうが適しています。
CLIで指定する相対`--out`と`--preview`は、単一画像・directoryのどちらもcurrent working
directory基準です。`.imagesconfig`内の相対pathは設定がある`images/`基準です。

## Project構成と出力先

```text
MySketch/
├── MySketch.ino
├── images.h
└── images/
    ├── .imagesconfig
    ├── .gitignore
    ├── icon.png
    └── .gfx-image-tool/
        └── headers.json  # git管理しないcache
```

既定設定は`output_dir = ..`です。`EmbedAssetToolJs`と同様に、出力directoryとheader名を変更できます。

```ini
[general]
output_dir = ../src/generated
output_file = artwork.h
output_mode = bundle
```

この例は`MySketch/src/generated/artwork.h`を生成します。一時的に出力directoryだけを変える場合は
`gfx-image-tool build MySketch --out ./temporary`のように指定します。CLI optionは設定より優先されます。

bundle headerには設定したprefix（空なら`images`）を使った次の一覧も常に入ります。

- `*_file_count`、`*_file_names`
- `*_file_data`、`*_file_sizes`
- `*_file_widths`、`*_file_heights`、`*_file_formats`
- TinyGFXのみ`*_file_refs`

`file_sizes`は`file_data`が指す符号化data本体のbyte数です。palette容量は最適化reportで別に確認します。

## TinyGFX project

```ini
[general]
target = tinygfx
output_dir = ..
output_mode = bundle
output_file = images.h

[color]
format = auto
mode = auto
threshold = 128

[alpha]
mode = auto
threshold = 128
color = auto

[preview]
output_dir = .gfx-image-tool/previews
layout = both

[optimize]
decoder_cost = 400
prefer_bitmap = vertical
aligned_vblit = false

[image "photos/*.png"]
format = raw565

[image "icons/mono/*.png"]
mode = monochrome
```

`format = auto`ではproject内の全画像を集合として最適化します。形式を固定する場合は
`raw565`、`rle565`、`rlepal4`、`bitmap1h`、`bitmap1v`を指定します。
TinyGFXでstream長を16 bit fieldから読む`rle565`と`rlepal4`は、65,535 byteを超える候補を
選択対象から外します。寸法から走査する`raw565`、`bitmap1h`、`bitmap1v`にはこのdata長制約はなく、
240x240の`raw565`（115,200 byte）も生成できます。大きすぎるRLEを固定した場合は、対象画像名と
`auto`または`raw565`へ変更する案をerrorに表示します。
画像別sectionでは`alpha_mode`、`alpha_threshold`、`alpha_color`も上書きできます。不透明な元画像の
特定RGB色を透明化してから変換するには、画像別に`source_key`を指定します。

```ini
[image "icons/logo.png"]
source_key = FF00FF
```

decode後のRGB888と完全一致するpixelを透明にし、そのalphaを通常のalpha modeで処理します。
TinyGFXの`auto`では、最終的な抜き色またはbitmap背景として保持します。
`alpha.mode = auto`はTinyGFXで透過を`color-key`として保持します。`none`を明示した画像に
非opaque pixelがある場合は`ALPHA_COMPOSITED` warningを出します。`preview.output_dir`を
設定すると、`--preview`を毎回書かなくても通常buildと`--check`の両方へpreviewを含めます。

## 孤立した生成物

canonical projectはheader追跡cacheを`images/.gfx-image-tool/headers.json`へ、preview追跡cacheを
`images/.gfx-image-tool/previews.json`へ生成し、前回生成したファイル集合を記録します。preview出力先には
PNGだけを生成し、追跡用のdot fileを混在させません。元画像を
削除した場合、通常buildはmanifestに記録された孤立header/PNGだけを削除し、JSON reportでは
`removed`とします。`--check`はファイルを変更せず`stale`として報告し、終了コード2を返します。

`.gfx-image-tool/`は`init`が作る`.gitignore`で除外する再生成可能なcacheなので、commit不要です。
cacheに載っていない利用者ファイルは削除対象になりません。
`--check`はcache自体も`upToDate manifest`、`mismatch manifest`、`missing manifest`としてpath付きで
表示しますが、cacheの欠落・差分だけでは終了2にしません。cacheが無い回は期待する出力だけを検査し、
以前の孤立ファイルを特定できない旨をwarningにします。通常buildはcacheを作り直します。

`.imagesconfig`の未知section・未知keyと、入力画像に一致しない`[image "..."]`は、stderrおよび
JSONの`warnings`へ表示します。`--check`時に前回buildのcacheと生成設定が異なる場合も、たとえば
`target: tinygfx -> generic-c`のように、生成物の不一致を報告する前に設定差を表示します。

入力名が数字またはunderscoreで始まる場合、C/C++の予約識別子を避けるためsymbolへ`img_`
系prefixを付けます。例: `2nd.png` → `img_2ndRef`。

`inspect --json`と`build --json`の`optimization`には、選択された形式集合、画素・paletteの
合計byte数、decoder byte数、両者の合計が入ります。`vblit`欄の244 B（aligned）と
408 B（generic）は比較情報であり、上記合計には加算しません。

## 終了コード

| code | 意味 |
| ---: | --- |
| 0 | 成功、または`--check`で一致 |
| 1 | 入出力・decode・変換エラー |
| 2 | `--check`で欠落または差分あり |
| 3 | CLI optionまたは引数エラー |

## TinyGFX host oracle

TinyGFX repositoryの`tests/image_oracle/pairs`にある変換後PPMを使って、正式ツールの
5形式ヘッダーを別directoryへ準備できます。

```sh
node scripts/prepare-tinygfx-oracle.js \
  ../TinyGFX/tests/image_oracle/pairs /tmp/tinygfx-oracle/pairs
```

生成したpairsをTinyGFXの同testへ置いてhost profileを実行すると、TinyGFX自身の
decoderが描いた結果とPPMをRGB565でpixel exact比較できます。

## 関連資料

- [初心者向けガイド](GUIDE.ja.md)
- [上級ガイド](ADVANCED.ja.md)
- [README](../README.ja.md)
