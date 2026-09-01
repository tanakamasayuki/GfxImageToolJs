# CLI reference

English | [日本語](CLI.ja.md)

See the [getting-started guide](GUIDE.md) for concepts and the [advanced guide](ADVANCED.md) for
format and TinyGFX optimization details. This document is the command and configuration reference.

## Commands

```text
gfx-image-tool build <path> [options]
gfx-image-tool inspect <path> [options]
gfx-image-tool init [directory]
```

A file path converts one image. `init MySketch` creates `MySketch/images/.imagesconfig`; subsequent
`build MySketch` and `inspect MySketch` commands detect that canonical project. Put originals under
`images/`; they are bundled into `MySketch/images.h` by default. Passing `MySketch/images` directly
is equivalent. Set `[general] output_mode = split` for per-image headers. `init` never overwrites an
existing configuration.

## Common options

| Option | Meaning |
| --- | --- |
| `--out <path>` | Single-image header, or project output directory |
| `--preview <path>` | Single-image converted PNG, or project preview directory |
| `--preview-layout <id>` | `converted` (default), side-by-side `comparison`, or `both` |
| `--target <id>` | C output target; use `tinygfx` for TinyGFX |
| `--format <id>` | Force a format; TinyGFX defaults to `auto` |
| `--mode <mode>` | `auto`, `monochrome`, `grayscale`, `indexed`, or `true-color` |
| `--name <id>` | C symbol for a single image |
| `--prefix <id>` | Prefix for all project symbols |
| `--threshold <0..255>` | Luminance threshold for 1bpp |
| `--alpha-threshold <0..255>` | Threshold for classifying transparent alpha |
| `--transparent-color <RRGGBB\|auto>` | TinyGFX color key; defaults to automatic selection |
| `--dither <mode>` | `none`, `floyd-steinberg`, or `bayer2/4/8` |
| `--colors <2..256>` | Maximum `indexed8` palette size |
| `--matte <RRGGBB>` | Color onto which alpha is composited |
| `--check` | Do not write; exit 2 for missing, different, or stale output |
| `--json` | Write a machine-readable report to stdout |

Every `--json` result starts with metadata identifying the CLI that produced it:

```json
{ "tool": { "name": "gfx-image-tool", "version": "0.1.0" } }
```

The version is not embedded in generated headers, so upgrading the tool alone does not create a
header diff.

For TinyGFX, `--decoder-cost <N>` changes the fixed cost per format, `--prefer-bitmap h|v`
resolves equal-size 1bpp candidates, and `--monochrome` admits thresholded 1bpp candidates for
images with more than two colors. `--aligned-vblit` prefers vertical 1bpp and reports the measured
fast-path comparison separately.

`--preview <path>` writes pixels decoded from the generated asset. Use
`--preview-layout comparison` to place the source on the left and converted pixels on the right, or
`--preview-layout both` to emit the converted path plus a sibling `<stem>.comparison.png`.
For directory builds, the preview path is an output directory and input subdirectories are preserved.
Relative CLI `--out` and `--preview` paths use the current working directory; relative config paths
use the `images/` directory containing `.imagesconfig`. Configure persistent previews with
`[preview] output_dir = .gfx-image-tool/previews` and
`layout = converted|comparison|both`; they are then included in `--check` without repeating `--preview`.
Preview output is always PNG. PPM is used only by the legacy binary-P6 oracle import helper.

## Project layout and output placement

```text
MySketch/
├── MySketch.ino
├── images.h
└── images/
    ├── .imagesconfig
    ├── .gitignore
    ├── icon.png
    └── .gfx-image-tool/
        └── headers.json  # disposable, Git-ignored cache
```

The generated configuration defaults to `output_dir = ..`. Like EmbedAssetToolJs, both the output
directory and header name are configurable:

```ini
[general]
output_dir = ../src/generated
output_file = artwork.h
output_mode = bundle
```

This writes `MySketch/src/generated/artwork.h`. For a temporary directory override, use
`gfx-image-tool build MySketch --out ./temporary`; CLI options take precedence over configuration.

Bundle headers always include indexes using the configured prefix, or `images` when it is empty:

- `*_file_count` and `*_file_names`;
- `*_file_data` and `*_file_sizes`;
- `*_file_widths`, `*_file_heights`, and `*_file_formats`; and
- `*_file_refs` for TinyGFX only.

`file_sizes` contains the encoded-data byte count addressed by `file_data`; palette bytes remain a
separate value in the optimization report.

## TinyGFX

Use `--target tinygfx`; its default format is `auto`. The candidates are `raw565`, `rle565`,
`rlepal4`, `bitmap1h`, and `bitmap1v`.

TinyGFX stores RLE stream length in a 16-bit field, so `rle565` and `rlepal4` candidates larger
than 65,535 bytes are excluded. `raw565`, `bitmap1h`, and `bitmap1v` are dimension-driven and may
contain more data; for example, a 240x240 `raw565` image (115,200 bytes) is supported. A forced
oversized RLE error names the source image and suggests `auto` or `raw565`.

For projects, set `[alpha] mode = color-key` and `threshold = 128` to preserve source alpha as a
collision-free TinyGFX transparent color or palette index. Set `[optimize] decoder_cost = 400` and
`prefer_bitmap = horizontal|vertical` to configure set optimization. Per-image sections may fix a
format and override `alpha_mode`, `alpha_threshold`, or `alpha_color`. To make an opaque source RGB
color transparent before encoding, set `source_key` on that image:

```ini
[image "icons/logo.png"]
source_key = FF00FF
```

Matching is exact in decoded RGB888. The resulting alpha is then handled by the normal alpha mode;
for TinyGFX, `auto` preserves it as the final encoded color key or bitmap background.

The project default is `[alpha] mode = auto`, which preserves TinyGFX source transparency. Explicit
`none` composites onto the matte and reports `ALPHA_COMPOSITED` when non-opaque pixels are present.

Canonical projects write header tracking cache to `images/.gfx-image-tool/headers.json` and preview
tracking cache to `images/.gfx-image-tool/previews.json`. The preview output contains only generated
PNGs, with no tracking dotfile mixed into a directory intended for review or commit. These manifests
contain only files previously generated by this tool. A normal build removes orphaned manifest entries; `--check` reports them as
`stale` and exits 2 without changing files. `.gfx-image-tool/` is recreated and excluded by the
generated `images/.gitignore`; do not commit it. Untracked user files are never removed. Names beginning with a digit or underscore receive an `img_`-style
prefix, for example `2nd.png` becomes `img_2ndRef`.
Manifest lines are labeled `upToDate manifest`, `mismatch manifest`, or `missing manifest`. A missing
cache does not fail `--check`: expected outputs are still checked, with a warning that old split
outputs could not be detected. A normal build recreates the cache.

Unknown `.imagesconfig` sections and keys, and `[image "..."]` patterns that match no input, are
reported in `warnings` and on stderr. `--check` also reports generation settings that differ from
the previous build cache (for example, `target: tinygfx -> generic-c`) before reporting a mismatch.

The JSON `optimization` object reports the selected format set, image data plus palette bytes,
decoder bytes, and total bytes.

## Exit status

| Status | Meaning |
| ---: | --- |
| 0 | Success, including a matching `--check` |
| 1 | Input/output, decoding, or conversion failure |
| 2 | Missing, different, or stale generated output under `--check` |
| 3 | Invalid command, option, or configuration |

For cross-project validation, `scripts/prepare-tinygfx-oracle.js` converts TinyGFX's post-conversion
P6 PPM fixtures into headers for all five formats. Run TinyGFX's `tests/image_oracle` host profile
against the resulting pairs for a pixel-exact check using TinyGFX's own decoders.

## Related documentation

- [Getting-started guide](GUIDE.md)
- [Advanced guide](ADVANCED.md)
- [README](../README.md)
