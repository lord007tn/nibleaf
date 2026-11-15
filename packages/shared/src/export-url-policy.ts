export const dangerous = (value: string): boolean => {
  let normalized = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 32 || code === 127) continue;
    normalized += character.toLowerCase();
    if (normalized.length >= 11) break;
  }
  return ['javascript:', 'vbscript:', 'data:'].some((s) => normalized.startsWith(s));
};
const white = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
/** WHATWG srcset splitting/descriptor-tokenizer, preserving commas INSIDE URLs.
 * Invalid/future descriptors do not hide a dangerous URL candidate. */
export const srcsetCandidates = (input: string): string[] => {
  const urls: string[] = [];
  let at = 0;
  while (at < input.length) {
    while (at < input.length && (white(input[at]) || input[at] === ',')) at++;
    if (at === input.length) break;
    const start = at;
    while (at < input.length && !white(input[at])) at++;
    let url = input.slice(start, at);
    if (url.endsWith(',')) {
      while (url.endsWith(',')) url = url.slice(0, -1);
      urls.push(url);
      continue;
    }
    urls.push(url);
    let state: 'descriptor' | 'after' | 'parens' = 'descriptor';
    while (at < input.length) {
      const c = input[at++];
      if (state === 'parens') {
        if (c === ')') state = 'descriptor';
        continue;
      }
      if (c === ',') break;
      if (c === '(') {
        state = 'parens';
        continue;
      }
      state = white(c) ? 'after' : 'descriptor';
    }
  }
  return urls;
};
const single = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'data',
  'poster',
  'background',
  'cite',
  'longdesc',
  'usemap',
  'manifest',
  'codebase',
  'classid',
  'icon',
  'lowsrc',
  'dynsrc',
  'itemid',
]);
const spaces = new Set(['ping', 'archive', 'profile', 'itemtype', 'attributionsrc']);
export const isExportUrlAttribute = (name: string): boolean => single.has(name) || spaces.has(name) || name === 'srcset' || name === 'imagesrcset';
export const unsafeAttribute = (attribute: { name: string; value: string; prefix?: string | null }, tag = ''): boolean => {
  const name = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
  if (name.startsWith('on')) return true;
  if (name === 'srcset' || name === 'imagesrcset') return srcsetCandidates(attribute.value).some(dangerous);
  if (name === 'archive' && tag === 'applet') return attribute.value.split(/[\t\n\f\r ,]+/).some(dangerous);
  if (spaces.has(name)) return attribute.value.split(/[\t\n\f\r ]+/).some(dangerous);
  return single.has(name) && dangerous(attribute.value);
};
