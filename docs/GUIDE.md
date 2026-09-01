# Getting started with embedded images

English | [日本語](GUIDE.ja.md)

This guide assumes no prior knowledge of palettes, RGB565, or color keys. It explains why images
need conversion and how to obtain a dependable C/C++ asset. See the [CLI reference](CLI.md) for
all commands and the [advanced guide](ADVANCED.md) for formats and optimization details.

## Why convert an image?

PNG and JPEG are storage formats designed for computers and phones. Small microcontrollers and
displays usually need a stream of red, green, and blue values—or packed on/off bits. Most embedded
graphics libraries cannot draw a PNG merely because its bytes were copied into a C++ program.

Gfx Image Tool bridges that gap:

```text
PNG, JPEG, and other source images
              ↓ convert
pixels arranged for the display library
              ↓ emit a C/C++ header
draw from firmware
```

Conversion also solves several practical problems:

- arranging colors and bits as the selected graphics library expects;
- reducing colors and data so the asset fits in flash;
- preserving the background around transparent artwork;
- choosing formats for a collection of images, not just one file at a time; and
- previewing the pixels that will really be decoded before using them in firmware.

## What is the output library?

Embedded C/C++ programs commonly draw through a graphics library such as Adafruit GFX or TinyGFX
rather than sending an image file straight to a display. The `Target`, shown as `Output library` in
the browser, asks which graphics library will consume the generated header. It is not a display
model selector.

Libraries differ in supported color formats, bit and byte order, declarations, and drawing calls.
Selecting one restricts conversion to compatible formats and adds a matching usage example to the
header.

| Output library | Choose it when |
| --- | --- |
| Generic C/C++ arrays | custom drawing code or a driver reads the array directly |
| Adafruit GFX | firmware uses the `Adafruit_GFX` drawing API |
| Arduino GFX | firmware uses `Arduino_GFX` |
| LovyanGFX | firmware uses `LovyanGFX` |
| TFT_eSPI | firmware uses `TFT_eSPI` |
| U8g2 | a mostly monochrome display is drawn through `U8g2` |
| TinyGFX | firmware uses `CellImage`, compressed formats, and set optimization |

If uncertain, inspect the firmware's `#include` directives and the function that draws an image.
Generic arrays are useful before a library has been selected, but regenerate for the real library
before device integration. Formats with the same RGB565 name can still require different byte order.

## Start with the browser workspace

The [browser workspace](https://tanakamasayuki.github.io/GfxImageToolJs/) performs conversion locally;
your images are not uploaded. It shows the original and converted result and can download headers,
previews, and configuration.

1. Drop or choose one or more images.
2. Select the graphics library under `Output library`.
3. Start with automatic color treatment and the initially suggested pixel format.
4. Inspect the converted preview, especially edges and transparent areas.
5. Choose `Download project ZIP` to save source images, header, and configuration in a rebuildable layout.
6. Download the project `.h` or `.imagesconfig` separately when needed.

An existing `.imagesconfig` can be dropped with the images or before them. Per-image sections are
also applied when a matching image is added later.
You can also drop a project ZIP previously downloaded from the web app. It restores
`images/.imagesconfig` and originals under `images/`; the generated header and tool state are not
added as inputs.

The archive is arranged so its purpose is visible after extraction:

```text
gfx-image-project/
  images.h         generated header included by firmware
  images/
    .imagesconfig  conversion settings
    .gitignore     excludes .gfx-image-tool/
    icon.png       original input
    ui/splash.png
```

Only `images.h` normally appears beside the sketch. Originals and settings stay under `images/`;
the runtime `.gfx-image-tool/` cache is excluded from input scans and Git. Reports and preview PNGs stay
in the web UI or are downloaded separately instead of being mixed into the default project ZIP.

Adding several images at once is useful. For TinyGFX, the tool can then reduce total flash use by
accounting for decoders shared by the whole image set.

## Five concepts to know

### 1. Pixels and color depth

An image is a grid of pixels. More information per pixel gives smoother color but uses more data.

| Representation | Approximate cost | Good for |
| --- | ---: | --- |
| 1bpp | 1 bit/pixel | monochrome icons, text, monochrome OLEDs |
| 8-bit color | 1 byte/pixel | icons and pixel art with few colors |
| RGB565 | 2 bytes/pixel | common color LCD artwork |
| RGB888 | 3 bytes/pixel | color-first assets on supported devices |

`bpp` means bits per pixel. At 1bpp, every pixel is represented by zero or one.

### 2. Palettes and color reduction

A palette is a list of colors used by an image. Instead of storing red, green, and blue for every
pixel, the data stores the position of a color in that list. This can be much smaller when an image
uses only a few colors.

An icon containing red, blue, white, and transparency does not need 256 distinct colors. `indexed`
mode and `Colors` set a maximum; similar source colors are merged to fit. This is color reduction,
or quantization. It works well for icons and pixel art. A photograph reduced to 16 colors will often
show bands or patches.
For a transparent TinyGFX 4-bit palette image, the transparency key consumes one of the 16 palette
entries, leaving at most 15 visible colors. If that limit is exceeded, the Web UI and CLI report the
actual color count and the maximum setting that will fit.

### 3. Dithering

Dithering uses patterns of available colors to suggest colors that are no longer in the palette.

- `none`: crisp edges; suitable for UI, icons, and pixel art;
- `floyd-steinberg`: useful for photographs and gradients with few colors; and
- `bayer2/4/8`: regular patterns suited to small screens or a deliberate retro look.

Dithering may improve appearance but can reduce RLE compression because it introduces many small
changes. Decide by comparing the preview and reported size.

### 4. Transparency, alpha, and color keys

PNG pixels may carry alpha—how transparent each pixel is. Many embedded formats cannot preserve
partial alpha. They instead reserve one color to mean “do not draw this pixel.” This is a color key,
also known as a transparent or chroma key.

For TinyGFX, `Alpha = Auto` turns source transparency into a color key. With
`Transparent color = auto`, the tool chooses a value that does not collide with visible pixels.

`Alpha = None / matte` paints transparent pixels onto a fixed color. That is permanent: drawing the
asset over another background can reveal a rectangular matte. Use it only when compositing is
intentional.

An alpha threshold divides partial transparency into transparent and opaque pixels. With the default
128, pixels whose alpha is below 128 become transparent.

If an opaque image uses a flat background color, select the image and enable `Make a source color
transparent`. Use the eyedropper to pick that color. This source key is different from the encoded
transparent value: the first creates transparent pixels; the second represents those pixels in the
target format. The match is exact, so antialiased edge shades may need source artwork cleanup.

### 5. The converted preview

The important preview is decoded from the generated asset. It includes RGB565 rounding, palette
reduction, 1bpp conversion, and transparency decisions.

Check transparent images over both light and dark backgrounds. `Blink colors` alternates two vivid
backgrounds, making unchanged transparent areas easy to spot. A preview shown only over black can
hide the mistake of replacing transparency with black pixels. The selected-image result box states
the final format, bytes, transparent-pixel count, and encoded key actually used.

## Sensible starting points

| Artwork | Start with | Check |
| --- | --- | --- |
| monochrome logo or text | `monochrome` | adjust threshold so strokes remain |
| monochrome OLED asset | 1bpp with panel-compatible layout | match horizontal/vertical drawing API |
| UI icon | `indexed`, 16–32 colors, no dither | edges and color key |
| pixel art | `indexed`, original color count, no dither | colors and pixel grid |
| photograph or background | RGB565 or TinyGFX `auto` | banding and size |
| transparent PNG | `Alpha = Auto` | edges on different backgrounds |

When uncertain, select the correct target and begin with `auto`. Optimize size only after the
converted appearance is acceptable.

## Rebuild projects with the CLI

The browser is convenient for exploration. The CLI makes source updates, team workflows, and CI
reproducible.

```sh
npm install --global gfx-image-tool
gfx-image-tool init ./MySketch
# Put images under ./MySketch/images/
gfx-image-tool build ./MySketch --target tinygfx
gfx-image-tool build ./MySketch --target tinygfx --check
```

`init` creates `MySketch/images/.imagesconfig` and the build bundles all images into
`MySketch/images.h`. Passing `./MySketch/images` directly is equivalent. `--check` changes no files
and reports whether generated outputs are current.

Output placement is configurable. Paths in `.imagesconfig` are relative to `images/`:

```ini
[general]
output_dir = ../src/generated
output_file = artwork.h
```

To keep both converted and side-by-side PNGs:

```ini
[general]
target = tinygfx

[preview]
output_dir = .gfx-image-tool/previews
layout = both
```

Do not commit `.gfx-image-tool/`; it is recreated by the next build. A cache-less `--check` still
checks expected headers, but warns that it cannot identify an old split header from a deleted source.

## Draw a TinyGFX asset

Generated headers include a target-specific example. The basic TinyGFX form is:

```cpp
#include <TinyGFX/Image.h>
#include "images.h"

lcd.drawImage(&img_iconRef, 10, 10);
```

Bundles also contain indexes for selecting several images by number or name. With the `img_` prefix,
for example, use `img_file_count`, `img_file_names`, and `img_file_refs`:

```cpp
for (uint16_t i = 0; i < img_file_count; ++i) {
  lcd.drawImage(img_file_refs[i], 0, i * 24);
}
```

Using the pointer index intentionally retains every image. If only `img_iconRef` is referenced,
section GC can discard the other images and the unused index.

Check the header or report for the exact symbol. Normally include a bundled header from one
translation unit; including definitions from the same header in several `.cpp` files may duplicate
data depending on the generated declarations and toolchain.

## Common mistakes

- Checking only the source: always inspect the converted preview.
- Choosing a format without a target: the library may expect a different byte or bit order.
- Compositing a transparent PNG onto black: start with `Alpha = Auto` for TinyGFX.
- Giving a photograph an extremely small palette: size falls, but artifacts become obvious.
- Optimizing images individually: TinyGFX decoders are shared, so project-level `auto` may be smaller.
- Copying only visible generated files: keep the dotfile manifests too.

## Where to go next

- [Advanced guide](ADVANCED.md) — formats, TinyGFX set optimization, alpha, and reproducibility
- [CLI reference](CLI.md) — commands, configuration, and exit codes
- [Japanese implementation specification](spec.ja.md) — normative design contract for contributors
- [README](../README.md) — installation and project overview
