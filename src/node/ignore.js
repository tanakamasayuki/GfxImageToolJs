// @ts-check

/** @param {string} pattern */
export function globToRegExpSource(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') { source += '.*'; index++; }
      else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += char.replace(/[-\\^$+?.()|[\]{}]/g, '\\$&');
  }
  return source;
}

/** @param {string[]} patterns */
export function buildGlobMatcher(patterns) {
  /** @type {RegExp[]} */
  const regexes = [];
  for (const raw of patterns) {
    let pattern = String(raw).trim();
    if (!pattern) continue;
    for (;;) {
      regexes.push(new RegExp(`^${globToRegExpSource(pattern)}$`, 'i'));
      if (!pattern.startsWith('**/')) break;
      pattern = pattern.slice(3);
    }
  }
  return (/** @type {string} */ path) => regexes.some((regex) => regex.test(path.replaceAll('\\', '/')));
}

/** @param {string} text */
export function buildImagesIgnoreMatcher(text) {
  /** @type {{regex: RegExp, include: boolean, directory: boolean, basename: boolean}[]} */
  const rules = [];
  for (const pattern of ['.imagesconfig', '.imagesignore']) add(pattern, false);
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const include = line.startsWith('!');
    add(include ? line.slice(1).trim() : line, include);
  }
  /** @param {string} raw @param {boolean} include */
  function add(raw, include) {
    let pattern = raw.replace(/^\/+/, '');
    const directory = pattern.endsWith('/');
    pattern = pattern.replace(/\/+$/, '');
    if (!pattern) return;
    rules.push({
      regex: new RegExp(`^${globToRegExpSource(pattern)}$`),
      include,
      directory,
      basename: !pattern.includes('/'),
    });
  }
  return {
    /** @param {string} path @param {boolean} isDirectory */
    shouldIgnore(path, isDirectory) {
      const relative = path.replaceAll('\\', '/').replace(/^\/+/, '');
      const basename = relative.split('/').pop() || '';
      let ignored = false;
      for (const rule of rules) {
        if (rule.directory && !isDirectory) continue;
        if (rule.regex.test(rule.basename ? basename : relative)) ignored = !rule.include;
      }
      return ignored;
    },
  };
}
