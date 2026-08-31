# Changelog

## Unreleased

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
