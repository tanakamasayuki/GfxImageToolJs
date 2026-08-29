// @ts-check

export class GfxImageError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class InvalidImageError extends GfxImageError {}
export class UnsupportedFormatError extends GfxImageError {}
export class EncodeConstraintError extends GfxImageError {}
export class CapabilityError extends GfxImageError {}
