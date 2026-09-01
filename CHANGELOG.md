# Changelog

## Unreleased

## 1.0.1

- (EN) Use installation-free `npx gfx-image-tool` commands throughout user documentation and pin `gfx-image-tool@1.0.0` in CI examples for reproducible generated assets.
- (JA) 利用者向け文書のCLI例をinstall不要の`npx gfx-image-tool`へ統一し、CI例は生成assetを再現できるよう`gfx-image-tool@1.0.0`へ固定。
- (EN) This is a documentation and generated project-README update only; encoder behavior, CLI behavior, library APIs, and generated header bytes are unchanged.
- (JA) 文書と生成project内READMEだけの更新で、encoder動作、CLI動作、library API、生成headerのbyte列に変更はありません。

## 1.0.0

- (EN) Support 240x240 and larger TinyGFX raw/bitmap data, apply the 16-bit data-length limit only to RLE candidates, and identify the failing image in oversize diagnostics.
- (JA) TinyGFXの240x240以上のraw/bitmap dataを生成可能にし、16 bit data長制約をRLE候補だけへ適用。容量超過診断へ対象画像名も追加。
- (EN) Warn about unknown configuration sections/keys and unmatched image overrides, explain generation-setting changes during `--check`, improve empty-project guidance, and remove outputs after the final source image is deleted.
- (JA) 未知の設定section/keyと一致しない画像overrideを警告し、`--check`で生成設定差を説明。空projectの案内と最後の元画像削除後の生成物掃除も改善。
- (EN) Run the test suite portably on the supported Node.js 20 baseline and add Node.js 20 to CI alongside Node.js 22.
- (JA) 対応下限のNode.js 20でもtest suiteを起動できる指定へ直し、Node.js 22と並べてCI対象へ追加。
- (EN) Add `tool.name` and `tool.version` metadata to every CLI `--json` result without changing generated headers.
- (JA) 生成headerを変えず、全CLI `--json`結果へ`tool.name`と`tool.version`を追加。
- (EN) Replace opaque TinyGFX fixed-format failures with image-specific palette diagnostics showing the actual RGB565 color count, transparency budget, format limit, and corrective settings.
- (JA) TinyGFX固定形式の抽象的な変換失敗を、対象画像・実RGB565色数・透過色枠・形式上限・修正設定を示す具体的な診断へ改善。
- (EN) Move preview tracking into the disposable `images/.gfx-image-tool/previews.json` cache so committed preview directories contain only reviewable images, and clarify that previews are disabled until configured.
- (JA) preview追跡情報を使い捨ての`images/.gfx-image-tool/previews.json`へ移し、commit対象のpreview directoryを画像だけに整理。設定するまでpreviewが無効であることも雛形へ明記。
- (EN) Add Embed Asset Tool-style image count, name, data, size, dimension, and format indexes to bundle headers, plus directly drawable TinyGFX reference indexes.
- (JA) bundle headerへEmbed Asset Tool形式の画像count・name・data・size・寸法・形式一覧と、直接描画できるTinyGFX reference一覧を追加。
- (EN) Adopt a clean `images/ -> ../images.h` project layout with configurable output placement, sketch-root CLI discovery, disposable Git-ignored tool cache, and matching Web ZIP import/export.
- (JA) `images/ -> ../images.h`の整理されたproject構成、変更可能な出力先、CLIのsketch root自動検出、git管理不要の再生成cache、同構成のWeb ZIP入出力を追加。
- (EN) Simplify per-image Web settings by hiding irrelevant controls, removing the symbol override field, constraining the eyedropper to source pixels, and explicitly clearing/reporting unmatched source color keys.
- (JA) Webの画像別設定で不要項目を非表示にし、symbol個別指定を削除、スポイトを原画pixelへ限定し、元画像に存在しない抜き色は透明化0件へ戻して明示。
- (EN) Make browser project ZIPs reopenable and rebuildable with original files under `images/`, add per-image source-color eyedropper transparency and blinking preview backgrounds, clarify final results and conversion failures, enlarge UI text, and prevent TinyGFX auto optimization from erasing the second color of an opaque two-color image through bitmap selection.
- (JA) Web project ZIPを`images/`の元画像込みで再読込・再生成可能にし、画像別の元色スポイト透過、背景点滅、最終結果と変換失敗の明示、文字サイズ改善を追加、TinyGFX自動最適化が不透明2色画像をbitmap化して片方の色を消す問題を修正。
- (EN) Improve the browser workspace with human-readable settings and help, sorted replacement-safe images, effective per-image values, selectable preview backgrounds, confirmed removal, dropped configuration import, file previews, and a complete project ZIP.
- (JA) Web workspaceへ人向け設定名とhelp、sort済み同名差替え、画像別実効値、preview背景選択、削除確認、設定drop import、ファイルpreview、project ZIPを追加。
- (EN) Add paired English/Japanese documentation paths with beginner and advanced guides, a documentation index, a prominent browser-workspace link, and a release checklist.
- (JA) 初心者／上級ガイド、文書index、Web版への目立つ導線、release checklistを日英の対で追加。
- (EN) Start the library-first image model, embedded pixel encoders, generic C emitter, and Node CLI.
- (JA) Library First の画像モデル、組込み向け画素エンコーダ、汎用 C 出力、Node CLI の実装を開始。
- (EN) Add deterministic indexed-color quantization, directory projects, configuration, check mode, and GFX target presets.
- (JA) 決定的な索引色減色、ディレクトリプロジェクト、設定、checkモード、GFXターゲットpresetを追加。
- (EN) Add TinyGFX five-format encoding, fixed decoder-cost set optimization, CellImage headers, stable bitmap tie-breaking, and alpha transparency.
- (JA) TinyGFXの5形式エンコード、固定デコーダコストによる集合最適化、CellImageヘッダー、安定した1bpp同点選択、alpha透過を追加。
- (EN) Bundle directory projects into one header by default, with an optional split mode and symbol-collision checks.
- (JA) directory projectの既定出力をheader 1本へまとめ、任意のsplit modeとsymbol衝突検査を追加。
- (EN) Add a private, multi-image browser workspace with live previews, per-image overrides, TinyGFX set reports, configuration import/export, and Pages deployment.
- (JA) 画像をuploadしない複数画像Web workspace、live preview、画像別override、TinyGFX集合report、設定import/export、Pages配信を追加。
- (EN) Fix TinyGFX directory builds defaulting to forced raw565, and add converted/comparison PNG exports to CLI and web.
- (JA) TinyGFX directory buildがraw565固定になる既定値を修正し、CLI/Webへ変換後・左右比較PNG出力を追加。
- (EN) Preserve alpha by default in TinyGFX directory builds, align relative CLI output paths to the working directory, and make preview output configurable.
- (JA) TinyGFX directoryの透過を既定で保持し、CLI相対出力をcurrent directory基準へ統一、preview出力を設定可能にした。
- (EN) Track generated headers and previews with manifests so stale outputs are checked and removed, and avoid reserved leading-underscore C++ identifiers.
- (JA) header/preview生成manifestで孤立出力を検査・削除し、予約済みの先頭underscore C++識別子を生成しないようにした。
- (EN) Show header and preview manifest status explicitly so missing dotfiles explain `--check` failures.
- (JA) header/preview manifestの状態を明示し、dotfile欠落による`--check`失敗理由を表示する。
- (EN) Add `--preview-layout both` to emit converted and side-by-side PNGs in one build.
- (JA) 変換後PNGと左右比較PNGを同時生成する`--preview-layout both`を追加。
