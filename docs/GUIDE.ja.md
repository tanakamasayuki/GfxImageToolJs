# はじめての画像変換ガイド

[English](GUIDE.md) | 日本語

このガイドは、パレット、RGB565、抜き色といった用語を知らなくても、画像を組込み機器で
表示できる形にするための入口です。設定値を網羅的に調べたい場合は
[CLIリファレンス](CLI.ja.md)、形式や最適化の仕組みを知りたい場合は
[上級ガイド](ADVANCED.ja.md)へ進んでください。

## なぜ画像を変換するのか

PCやスマートフォンで使うPNGやJPEGは、ファイルを小さく保存するための形式です。一方、
小型マイコンとディスプレイは、画面へ送る赤・緑・青の値や、白黒を表すビット列を必要とします。
PNGファイルをそのままC++のプログラムへ貼っても、多くの描画ライブラリは表示できません。

Gfx Image Toolは、その間をつなぎます。

```text
PNG / JPEGなど
      ↓ 変換
ディスプレイが読める画素データ
      ↓ C/C++ヘッダーとして保存
マイコンのプログラムから描画
```

変換では、単にファイル形式を変えるだけでなく、次の問題も解決します。

- ディスプレイや描画ライブラリに合う色の並びへ変える
- マイコンのFlashに収まるよう色数やデータ量を減らす
- 透明な部分で背景を残せるようにする
- 複数画像をまとめて、全体として小さい形式を選ぶ
- 変換後の見た目をPNGで確認してから組み込む

## 「出力先ライブラリ」とは何か

組込み画面を描くC/C++プログラムでは、画像を直接displayへ渡すのではなく、Adafruit GFXや
TinyGFXなどの**描画ライブラリ**を使うことが一般的です。本ツールの`Target`または
「出力先ライブラリ」は、生成したheaderをどの描画ライブラリへ渡すかという質問です。
displayの製品名を選ぶ欄ではありません。

同じ絵でも、ライブラリによって対応する色形式、bit・byteの並び、配列の宣言、描画関数が異なります。
出力先を選ぶと、本ツールは互換性のある形式だけを候補にし、headerへ対応する使用例を入れます。

| 出力先 | 選ぶ場面 |
| --- | --- |
| 汎用C/C++配列 | 特定libraryに合わせず、自作描画codeや独自driverから配列を読む |
| Adafruit GFX | firmwareで`Adafruit_GFX`の描画APIを使う |
| Arduino GFX | firmwareで`Arduino_GFX`を使う |
| LovyanGFX | firmwareで`LovyanGFX`を使う |
| TFT_eSPI | firmwareで`TFT_eSPI`を使う |
| U8g2 | 主にmonochrome displayを`U8g2`で描く |
| TinyGFX | `CellImage`、圧縮形式、画像集合最適化を使う |

どれかわからない場合は、firmwareの`#include`と画像を描く関数を確認してください。まだ描画libraryを
決めていない実験段階なら「汎用C/C++配列」を選べますが、実機へ組み込む前に実際のlibraryへ合わせて
再生成するのが安全です。RGB565という名前が同じでもbyte順が違う場合があるためです。

## 最初はWeb版がおすすめ

[Web版](https://tanakamasayuki.github.io/GfxImageToolJs/)は画像を外部へアップロードせず、
ブラウザ内で変換します。画像を追加すると原画と変換後を並べて確認でき、ヘッダーとPNGを
ダウンロードできます。

1. 画像をdropするか、ファイル選択で追加します。
2. 使用する描画ライブラリを「出力先ライブラリ」で選びます。
3. 「色の扱い」は「自動」、画素データ形式は最初に表示された推奨値から始めます。
4. 変換後previewで、色、輪郭、透明部分を確認します。
5. 「プロジェクトZIPをdownload」で元画像、header、設定を再生成可能な構成で保存します。
6. 個別に必要ならproject `.h`や`.imagesconfig`もdownloadできます。

既存の`.imagesconfig`は画像と一緒でも、画像より先でもdropできます。画像別sectionは、対応する
ファイル名の画像を後から追加した場合にも適用されます。
Web版からdownloadしたproject ZIPをそのままdropして開き直すこともできます。
`images/.imagesconfig`と`images/`内の元画像だけを復元し、生成headerやtool管理情報を入力画像として
追加しません。

展開後に用途がわかるよう、ZIPは次の構成です。

```text
gfx-image-project/
  images.h         firmwareからincludeする生成header
  images/
    .imagesconfig  変換設定
    .gitignore     .gfx-image-tool/を除外
    icon.png       変換元画像
    ui/splash.png
```

スケッチ直下へ増えるのは通常`images.h`だけです。元画像と設定は`images/`内にまとまり、実行時にできる
`.gfx-image-tool/`は常に入力走査とgit管理から除外されます。reportとpreview PNGはWeb画面または個別downloadで
確認し、既定のproject ZIPには入れません。

複数画像を同時に入れて構いません。特にTinyGFXでは、画像をまとめて評価したほうが、
プログラム全体で必要なデコーダを減らせる場合があります。

## まず覚える5つの言葉

### 1. 画素と色深度

画像は小さな点（画素、pixel）の集まりです。1画素に多くの情報を持たせるほど色は滑らかに
なりますが、データは大きくなります。

| 表現 | 1画素の目安 | 向いている画像 |
| --- | ---: | --- |
| 1bpp | 1 bit | 白黒アイコン、文字、単色OLED |
| 8bitカラー | 1 byte | 色数の少ないアイコン、ドット絵 |
| RGB565 | 2 bytes | カラーLCDの一般的な画像 |
| RGB888 | 3 bytes | 色を優先する画像、対応機器向け |

`bpp`はbits per pixelの略です。1bppは各画素を0か1で表します。

### 2. パレットと減色

パレットは「この画像で使う色の一覧」です。各画素に赤・緑・青を全部持たせず、一覧の何番目の
色かを記録します。使う色が少ない画像では大幅に小さくできます。

例えば赤、青、白、透明の4種類だけを使うアイコンなら、256色分の情報は不要です。
`indexed` modeと`Colors`で上限を指定すると、似た色をまとめて色数を減らします。これを減色と
呼びます。写真を16色にすると帯状の色むらが出やすい一方、アイコンやドット絵にはよく合います。
透過を持つTinyGFXの4bit palette形式では、透明を表す1色も16色の上限に含まれます。そのため
表示色は最大15色です。上限を超えた場合、WebとCLIは実際の色数と変更すべき最大色数を表示します。

### 3. ディザリング

色数を減らしたとき、使えなくなった中間色を細かな点の並びで表現する方法です。

- `none`: 輪郭が明瞭。アイコン、UI、ドット絵向け
- `floyd-steinberg`: 写真やグラデーションを少ない色で見せたい場合
- `bayer2/4/8`: 規則的な模様。小型画面やレトロな表現向け

ディザリングは見た目を改善することがありますが、細かな色変化が増えるため、RLE圧縮が効きにくく
なる場合があります。原画と変換後を見比べて決めてください。

### 4. 透明、アルファ、抜き色

PNGの各画素には「どのくらい透明か」というalpha情報を持てます。しかし、組込み向けの形式には
半透明をそのまま保存できないものが多くあります。その場合は1色を「描かない色」と決めます。
これがcolor key、一般に「抜き色」と呼ばれる方法です。

TinyGFXで`Alpha = Auto`を選ぶと、透明な画素がある画像では抜き色を使って背景を残します。
`Transparent color = auto`なら、画像の見える部分と衝突しない色をツールが選びます。

`Alpha = None / matte`は透明部分を背景色へ塗りつぶします。一度塗りつぶすと、別の背景へ描いたとき
四角い地が見えます。意図して合成する場合だけ使ってください。

半透明はalpha thresholdを境に「透明」か「不透明」のどちらかになります。既定値128では、
alphaが128未満の画素を透明として扱います。

不透明な画像に単色背景がある場合は、選択画像で「元画像の指定色を透明にする」を有効にし、スポイトで
色を選べます。この元画像の抜き色は「変換後の予約抜き色」と別物です。前者が透明pixelを作り、後者が
target形式でそのpixelを表します。RGB完全一致なので、anti-aliasされた縁の近似色は素材側の調整が必要です。

### 5. 変換後preview

確認すべきなのは元画像ではなく、ヘッダーへ格納されたデータをもう一度画素へ戻したpreviewです。
RGB565の色の丸め、減色、1bpp化、透明判定が反映されています。

透明画像はcheckerboardだけでなく、明るい色と暗い色の背景へ重ねて確認すると安全です。
「背景色を点滅」は鮮やかな2色を交互に表示し、背景がそのまま見える範囲を判別しやすくします。
黒い背景だけでは、透明を誤って黒へ塗りつぶしても気づけないことがあります。
選択画像の最終結果欄には、実際のformat、byte数、透明pixel数、使用した変換後の抜き色を表示します。

## 画像別の出発点

| 画像 | 最初に試す設定 | 確認すること |
| --- | --- | --- |
| 白黒ロゴ・文字 | `monochrome` | thresholdで線が欠けないか |
| 単色OLED | 1bpp、panelに合う向き | 横詰め／縦詰めがAPIに合うか |
| UIアイコン | `indexed`、16〜32色、ditherなし | 輪郭と抜き色 |
| ドット絵 | `indexed`、元の色数、ditherなし | 色とpixel grid |
| 写真・背景 | RGB565、またはTinyGFX `auto` | 色の段差と容量 |
| 透明PNG | `Alpha = Auto` | 異なる背景で縁を確認 |

迷ったらtargetだけを正しく選び、その他は`auto`から始めてください。小さくするための調整は、
まず変換後の見た目が許容できることを確認してから行います。

## CLIで繰り返し生成する

Web版は設定を試す作業に向いています。元画像の更新、チーム開発、CIではCLIを使うと、同じ設定で
生成し直せます。

```sh
npx gfx-image-tool init ./MySketch
# ./MySketch/images/へ画像を置く
npx gfx-image-tool build ./MySketch --target tinygfx
npx gfx-image-tool build ./MySketch --target tinygfx --check
```

`init`は`MySketch/images/.imagesconfig`を作り、既定で全画像を`MySketch/images.h`へまとめます。
`build ./MySketch/images`と直接指定しても同じです。`--check`はファイルを書き換えず、生成物が最新か
検査します。

出力先は`.imagesconfig`から変更できます。pathは`images/`基準です。

```ini
[general]
output_dir = ../src/generated
output_file = artwork.h
```

変換後と左右比較のPNGも一緒に残す例です。

```ini
[general]
target = tinygfx

[preview]
output_dir = .gfx-image-tool/previews
layout = both
```

`.gfx-image-tool/`内のcacheはcommit不要です。削除しても次のbuildで復元します。cacheが無い状態の
`--check`は期待headerを検査できますが、以前のsplit headerを追跡できないためwarningを表示します。

## TinyGFXで表示する

生成ヘッダー内のコメントにも使用例があります。基本形は次のとおりです。

```cpp
#include <TinyGFX/Image.h>
#include "images.h"

lcd.drawImage(&img_iconRef, 10, 10);
```

複数画像を番号や名前で扱うため、bundleには一覧も入ります。prefixが`img_`なら、例えば
`img_file_count`、`img_file_names`、`img_file_refs`を利用できます。

```cpp
for (uint16_t i = 0; i < img_file_count; ++i) {
  lcd.drawImage(img_file_refs[i], 0, i * 24);
}
```

このpointer一覧を使うと全画像を必要としている意思表示になるため、全画像がlinkされます。一覧を使わず
`img_iconRef`だけを参照する場合、section GCが有効なら他の画像と一覧は除去対象になります。

実際のsymbol名は、ヘッダーと変換reportで確認してください。同じbundle headerを複数の
`.cpp`からincludeする構成は重複を招くことがあるため、通常は描画を担当する1つの翻訳単位から
includeします。

## よくある失敗

- 原画だけを見て完了にする: 必ず変換後previewを確認します。
- targetを選ばず形式名だけで決める: 描画ライブラリが期待するbyte/bit順と合わないことがあります。
- 透明PNGを黒へ合成する: 黒以外の背景で四角く見えるため、TinyGFXではまず`Alpha = Auto`を使います。
- 写真を極端に少ないパレットへする: 容量は減りますが、色の帯や斑点が目立ちます。
- 1枚ずつ最小形式を選ぶ: TinyGFXではデコーダが画像間で共有されるため、フォルダ単位の`auto`が有利です。
- generated directoryだけをコピーする: dotfileのmanifestも一緒に管理します。

## 次に読むもの

- [上級ガイド](ADVANCED.ja.md) — 形式、TinyGFX集合最適化、透過、再現性
- [CLIリファレンス](CLI.ja.md) — コマンド、設定、終了コード
- [仕様書](spec.ja.md) — 実装者向けの設計契約
- [README](../README.ja.md) — インストールと全体の入口
