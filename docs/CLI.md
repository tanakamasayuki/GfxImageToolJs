# CLI reference

## Commands

```text
gfx-image-tool build <path> [options]
gfx-image-tool inspect <path> [options]
gfx-image-tool init [directory]
```

A file path converts one image. A directory path recursively builds a project configured by
`.imagesconfig`. `init` never overwrites an existing configuration.

Common options include `--out`, `--target`, `--format`, `--name`, `--prefix`, `--threshold`,
`--alpha-threshold`, `--dither`, `--colors`, `--matte`, `--check`, and `--json`.
Check mode is read-only and exits with status 2 for missing or different output. Invalid command
arguments exit with status 3.

## TinyGFX

Use `--target tinygfx`; its default format is `auto`. The candidates are `raw565`, `rle565`,
`rlepal4`, `bitmap1h`, and `bitmap1v`. `--decoder-cost <N>` changes the fixed per-format cost,
`--prefer-bitmap h|v` resolves equal-size bitmap candidates, and `--monochrome` enables thresholded
1bpp candidates for images with more than two colors. `--aligned-vblit` prefers the vertical layout
and reports its measured fast-path cost separately from the optimizer total.

For projects, set `[alpha] mode = preserve` and `threshold = 128` to preserve source alpha as a
collision-free TinyGFX transparent color or palette index. Set `[optimize] decoder_cost = 400` and
`prefer_bitmap = horizontal|vertical` to configure set optimization. Per-image sections may fix a
format and override `alpha_mode` or `alpha_threshold`.

The JSON `optimization` object reports the selected format set, image data plus palette bytes,
decoder bytes, and total bytes.

For cross-project validation, `scripts/prepare-tinygfx-oracle.js` converts TinyGFX's post-conversion
P6 PPM fixtures into headers for all five formats. Run TinyGFX's `tests/image_oracle` host profile
against the resulting pairs for a pixel-exact check using TinyGFX's own decoders.
