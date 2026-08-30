# CLI リファレンス

## コマンド

```text
gfx-image-tool build <path> [options]
gfx-image-tool inspect <path> [options]
gfx-image-tool init [directory]
```

`path`がファイルなら1枚を変換し、ディレクトリなら`.imagesconfig`を読み込んで
対象画像を再帰処理し、既定で`generated/images.h` 1本へまとめます。`init`は設定ファイルが
既にある場合は上書きしません。`[general] output_mode = split`で画像別headerへ切り替えられます。

## 共通オプション

| option | 内容 |
| --- | --- |
| `--out <path>` | 単一画像の出力ヘッダー、またはprojectの出力directory |
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

TinyGFXでは`--decoder-cost <N>`で1形式分の固定コストを変更できます。
`--prefer-bitmap h|v`は同容量の1bpp形式を安定して選ぶための指定です。
`--monochrome`を付けると、3色以上の画像もthreshold処理して1bpp候補へ加えます。
`--aligned-vblit`は縦詰めを既定にし、fast pathの実測コストを別欄でreportします。

## TinyGFX project

```ini
[general]
target = tinygfx
output_dir = generated
output_mode = bundle
output_file = images.h

[color]
format = auto
mode = auto
threshold = 128

[alpha]
mode = color-key
threshold = 128
color = auto

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
画像別sectionでは`alpha_mode`と`alpha_threshold`も上書きできます。

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
