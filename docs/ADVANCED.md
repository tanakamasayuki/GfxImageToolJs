# Advanced image formats and optimization

English | [日本語](ADVANCED.ja.md)

This guide is for users who want deliberate control over visual quality, flash use, and drawing
paths. Begin with the [getting-started guide](GUIDE.md) if embedded image concepts are new to you.
Use the [CLI reference](CLI.md) for exact syntax and the
[Japanese implementation specification](spec.ja.md) for normative design details.

## Conversion pipeline

The tool does not copy source file bytes directly into a C array. It decodes to a neutral RGBA8888
image, applies transformations, and then encodes the selected pixel format.

```text
source file
  → RGBA8888 decode
  → alpha handling
  → mode / quantization / dithering / threshold
  → format encoder
  → target-specific C/C++ emitter
  → preview through a reference decoder
```

The CLI and browser use the same conversion core. Input decoders can differ by environment, but
encoding the same decoded RGBA pixels with the same settings is deterministic.

## Target and format are separate

A `target` selects the consuming graphics library and C/C++ declarations. A `format` specifies how
pixels are laid out. Even RGB565 can require a different byte order, array type, or call site across
libraries.

Target presets restrict formats and emit matching declarations and examples. Select the target
first and force a format only when needed. Use `generic-c` for arrays independent of a supported
graphics library.

## Generic format selection

| Format | Layout | Typical use and caveat |
| --- | --- | --- |
| `bitmap1-msb` | 8 horizontal pixels/byte, left is MSB | many bitmap APIs |
| `bitmap1-lsb` | 8 horizontal pixels/byte, left is LSB | XBM-style APIs |
| `bitmap1-vertical` | 8 vertical pixels/byte, top is LSB | page-oriented OLEDs |
| `mask1-msb` | independent 1bpp mask | targets separating color and transparency |
| `gray8` | one luminance byte/pixel | grayscale APIs |
| `indexed8` | one index byte/pixel plus palette | low-color artwork; includes palette overhead |
| `rgb332` | one direct-color byte/pixel | compact, low color precision |
| `rgb565le/be` | two direct-color bytes/pixel | common LCD data; match API byte order |
| `rgb888` | R, G, B bytes/pixel | color precision at a larger size |

When dimensions are not divisible by eight, the last 1bpp byte contains unused bits. Match both bit
order and stride expected by the consuming API.

## The five TinyGFX candidates

TinyGFX `auto` compares:

| Optimizer ID | Representation | Best suited to |
| --- | --- | --- |
| `raw565` | uncompressed RGB565 | photographs, incompressible art, simple decoding |
| `rle565` | runs of one RGB565 color | flat fills and long same-color spans |
| `rlepal4` | up to 16 palette colors plus short runs | icons, pixel art, low-color UI |
| `bitmap1h` | horizontal 1bpp | general bitmap drawing |
| `bitmap1v` | vertical 1bpp | page-oriented panels and vertical fast paths |

`bitmap1h` and `bitmap1v` reuse the generic `bitmap1-msb` and `bitmap1-vertical` byte layouts.
TinyGFX adds the `CellImage` wrapper and matching ops; they are not separate bit encoders.

TinyGFX bitmap decoding draws palette entry 1 and treats zero bits as “preserve the destination”; it
does not draw two opaque palette colors. Automatic selection therefore admits bitmap only for one
visible source color, optionally with transparency. Even a two-color opaque image stays in a color
format such as `rlepal4`. Add `--monochrome` or select `mode = monochrome` only when that deliberate
background/foreground conversion is wanted, then inspect threshold and dithering results.

## Why optimize an image set?

Flash use includes decoding code as well as image bytes. The objective is conceptually:

```text
data + palette for every image
+ decoder cost for the set of formats in use
```

A decoder is paid once per format, not once per image. Choosing the smallest representation for each
image independently may introduce several decoders and make the whole program larger. Directory
builds and the multi-image browser workspace evaluate format sets to find the project-level minimum.

The default model charges 400 bytes per format. Using both bitmap layouts costs 520 bytes because
they share implementation. Runtime transparency handling is included in these fixed values; there
is no extra per-transparent-image charge.

Override with `--decoder-cost` only to test another measurement assumption. The report's
`individual minimum` is a comparison and uses a different evaluation unit from project selection.

## Horizontal versus vertical 1bpp

Horizontal and vertical packing have the same data size for common panel assets whose width and
height are both multiples of eight. With partial rows or pages, their padding can differ. Whenever
sizes tie, `prefer_bitmap` provides a deterministic layout choice.

- SSD1306, SH1106, or another page-oriented panel copied by byte: `vertical`;
- `pushVBitmap` or aligned vertical blit: `vertical`; and
- general bitmap APIs: usually `horizontal`.

`aligned_vblit` is a code-size-versus-speed choice, not part of data-format optimization. The report
shows measured comparison values of 244 bytes for aligned and 408 bytes for generic, but excludes
them from the optimizer total. Clipping, rotation, panel bands, and dirty tracking remain; this is
not merely the cost of `memcpy`.

## Interactions among colors, palettes, and compression

`colors` is a maximum palette size. Lowering it shrinks the palette but does not guarantee a smaller
total:

- merging colors can create longer runs and improve RLE;
- dithering creates frequent changes and can hurt RLE;
- `indexed8` still spends one byte per pixel, so palette overhead matters on tiny images;
- TinyGFX `rlepal4` is strongest when both a 16-color limit and repeated runs fit the artwork; and
- colors identical after RGB565 quantization should be deduplicated as actual output colors.

Use the browser candidate table or `inspect --json` to separate data, palette, and decoder bytes.
Treat the converted preview as a constraint whenever a size reduction is lossy.

## Designing alpha behavior

### `auto`

For TinyGFX, source non-opaque pixels become a color key. Targets that cannot represent alpha
composite them onto the matte. File and directory inputs use the same semantics.

### `color-key`

Pixels below the alpha threshold map to one transparent value. `color = auto` deterministically
chooses a representable RGB565 value not used by visible pixels. Palette formats use a transparent
palette index. If no value is available, conversion fails instead of making a visible color vanish.

A color key is binary transparency. Partially transparent edge pixels become transparent or opaque,
and artwork authored against one background may show a halo on another. Test representative device
backgrounds.

`source_key = RRGGBB` is a preprocessing operation and must not be confused with `[alpha] color`.
It changes exact matching decoded source pixels to alpha zero. `[alpha] color` chooses the encoded
RGB565 value used to represent already-transparent pixels. Per-image sections may use both.

### `none`

Alpha is composited onto the matte. Explicit use on non-opaque source pixels records an
`ALPHA_COMPOSITED` warning. This can be appropriate for a fixed background where antialiased edges
matter more than reusable transparency.

TinyGFX 1bpp uses zero bits as transparent. Verify the combined meaning of inversion, foreground,
and transparency in both preview and target rendering.

## Bundle versus split

A new project bundles every input under `images/` into one `images.h` beside that directory. It simplifies inclusion, checks
symbol collisions across the project, and keeps generated output easy to manage. With common
`-fdata-sections` and `--gc-sections` settings, the linker can remove unreferenced data sections.

However, including a header containing definitions in several translation units can duplicate
`static` data. Normally include a bundle from one `.cpp`, or inspect the link map. Use
`output_mode = split` when compile ownership or separate headers are more important.

## Reproducible directory builds

Precedence is project defaults, `[image "glob"]` overrides, then CLI options. A `.imagesconfig`
exported by the browser can be imported by the CLI. Inputs are stably sorted by relative path, and
generated output omits timestamps and absolute paths.

```sh
gfx-image-tool build ./MySketch
gfx-image-tool build ./MySketch --check
```

The new `.imagesconfig` lives in `MySketch/images/` and defaults to `output_dir = ..`; both
`output_dir` and `output_file` may point elsewhere. `--check` is read-only and exits 2 for missing,
different, or stale output. `images/.gfx-image-tool/headers.json` tracks headers, while preview
outputs retain their own manifest. A normal build removes manifest-tracked orphans and never removes
an untracked user file. Root-level legacy `.imagesconfig` projects remain readable.

Without a manifest, old output cannot safely be identified as stale. Commit these dotfiles whenever
generated assets are committed.

## What a preview proves

A `converted` PNG is decoded from the generated representation. `comparison` places source pixels
on the left and converted pixels on the right; `both` produces both files. CLI previews are ordinary
PNG files, not PPM.

Preview validates encoder intent, but not the target library implementation or display wiring. For
final byte- and bit-order confidence, draw the header through the real library's host test or device.
TinyGFX's host oracle performs the authoritative pixel-exact check for all five formats.

## CI workflow

```sh
npm ci
gfx-image-tool build MySketch --check
```

Exit status 2 means generated output is not current, 3 means invalid options or configuration, and
1 means I/O, decoding, or conversion failed. Use `--json` when stdout is consumed by automation.

## JavaScript API boundary

UI- and filesystem-independent operations are available from the root export:

```js
import { createImage, encodeImage, emitCSource } from 'gfx-image-tool';

const image = createImage(1, 1, [255, 0, 0, 255]);
const encoded = encodeImage(image, 'rgb565be');
const { source } = emitCSource(encoded, 'generic-c', { name: 'redPixel' });
```

Image decoding for Node is under `gfx-image-tool/node`; the browser adapter is under
`gfx-image-tool/browser`. The core boundary uses neutral RGBA8888 images rather than leaking
`Buffer` or DOM objects into format encoders.

## Related documentation

- [Getting-started guide](GUIDE.md)
- [CLI reference](CLI.md)
- [Japanese implementation specification](spec.ja.md)
- [README](../README.md)
