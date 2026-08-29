// @ts-check

const ALL = Object.freeze([
  'bitmap1-msb', 'bitmap1-lsb', 'bitmap1-vertical', 'gray8', 'indexed8',
  'rgb332', 'rgb565le', 'rgb565be', 'rgb888', 'mask1-msb',
]);

const TARGETS = Object.freeze({
  'generic-c': ALL,
  'adafruit-gfx': ['bitmap1-msb', 'bitmap1-lsb', 'gray8', 'rgb565le'],
  u8g2: ['bitmap1-msb', 'bitmap1-lsb'],
  lovyangfx: ['bitmap1-msb', 'bitmap1-lsb', 'gray8', 'indexed8', 'rgb332', 'rgb565le', 'rgb565be', 'rgb888'],
  'arduino-gfx': ['bitmap1-msb', 'bitmap1-lsb', 'gray8', 'indexed8', 'rgb565le', 'rgb565be', 'rgb888'],
  'tft-espi': ['bitmap1-msb', 'rgb332', 'rgb565le', 'rgb565be'],
  tinygfx: ['tinygfx-raw565', 'tinygfx-rle565', 'tinygfx-rlepal4', 'bitmap1-msb', 'bitmap1-vertical'],
});

export function listTargets() {
  return Object.keys(TARGETS);
}

/** @param {string} target */
export function targetFormats(target) {
  return [...(TARGETS[/** @type {keyof typeof TARGETS} */ (target)] ?? [])];
}

/** @param {string} target @param {string} format */
export function targetSupports(target, format) {
  return targetFormats(target).includes(format);
}

/** @param {string} target @param {string} format @param {string} name @param {number} width @param {number} height */
export function targetUsage(target, format, name, width, height) {
  const data = `${name}_data`;
  if (target === 'adafruit-gfx') {
    if (format === 'bitmap1-msb') return `display.drawBitmap(x, y, ${data}, ${width}, ${height}, color);`;
    if (format === 'bitmap1-lsb') return `display.drawXBitmap(x, y, ${data}, ${width}, ${height}, color);`;
    if (format === 'gray8') return `display.drawGrayscaleBitmap(x, y, ${data}, ${width}, ${height});`;
    return `display.drawRGBBitmap(x, y, reinterpret_cast<const uint16_t*>(${data}), ${width}, ${height});`;
  }
  if (target === 'u8g2') {
    return format === 'bitmap1-lsb'
      ? `u8g2.drawXBMP(x, y, ${width}, ${height}, ${data});`
      : `u8g2.drawBitmap(x, y, ${Math.ceil(width / 8)}, ${height}, ${data});`;
  }
  if (target === 'lovyangfx') {
    return format.startsWith('rgb565')
      ? `lcd.pushImage(x, y, ${width}, ${height}, reinterpret_cast<const uint16_t*>(${data}));`
      : `lcd.pushImage(x, y, ${width}, ${height}, ${data});`;
  }
  if (target === 'arduino-gfx') {
    if (format === 'rgb565be') return `gfx->draw16bitBeRGBBitmap(x, y, reinterpret_cast<const uint16_t*>(${data}), ${width}, ${height});`;
    if (format === 'rgb565le') return `gfx->draw16bitRGBBitmap(x, y, reinterpret_cast<const uint16_t*>(${data}), ${width}, ${height});`;
    if (format === 'rgb888') return `gfx->draw24bitRGBBitmap(x, y, ${data}, ${width}, ${height});`;
    if (format === 'indexed8') return `gfx->drawIndexedBitmap(x, y, ${data}, ${name}_palette, ${width}, ${height});`;
    return `gfx->drawBitmap(x, y, ${data}, ${width}, ${height}, color);`;
  }
  if (target === 'tft-espi') {
    if (format === 'rgb565be') return `tft.setSwapBytes(true); tft.pushImage(x, y, ${width}, ${height}, reinterpret_cast<const uint16_t*>(${data}));`;
    if (format === 'rgb565le') return `tft.setSwapBytes(false); tft.pushImage(x, y, ${width}, ${height}, reinterpret_cast<const uint16_t*>(${data}));`;
    return `tft.pushImage(x, y, ${width}, ${height}, ${data});`;
  }
  if (target === 'tinygfx') return `lcd.drawImage(&${name}Ref, x, y);`;
  return data;
}
