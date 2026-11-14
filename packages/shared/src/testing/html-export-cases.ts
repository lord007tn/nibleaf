/** Seeded HTML-block export preservation cases, independent of either tokenizer. */
export const HTML_EXPORT_SEED = 0x59_16_11_01;
export const HTML_EXPORT_COUNT = 1408;

export const htmlExportCases = (seed = HTML_EXPORT_SEED) => {
  let state = seed;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const wrappers = [
    ['<style>', '</style>'],
    ['<script>', '</script>'],
    ['<pre>', '</pre>'],
    ['<textarea>', '</textarea>'],
    ['<!--', '-->'],
    ['<?instruction', '?>'],
    ['<!DOCTYPE', '>'],
    ['<![CDATA[', ']]>'],
    ['<div>', '</div>'],
    ['<span>', '</span>'],
    ['<custom-tag>', '</custom-tag>'],
  ] as const;
  return Array.from({ length: HTML_EXPORT_COUNT }, (_, index) => {
    const [open, close] = wrappers[index % wrappers.length] as (typeof wrappers)[number];
    const bits = next();
    const fence = (bits & 1 ? '`' : '~').repeat(3 + ((bits >>> 1) & 1));
    const markers = [`PAYLOAD_${index}_EXPR`, `PAYLOAD_${index}_NOTE`, `PAYLOAD_${index}_TEXT`, `FOLLOW_${index}`];
    const body = [`{${markers[0]}}`, `<Note>${markers[1]}</Note>`, markers[2] as string];
    // Track literal syntax as well as its payload, so converting a Note to a
    // callout or stripping expression braces is a loss in either target.
    markers.push(body[0] as string, body[1] as string);
    const fenced = bits & 4 ? [fence, ...body, ...(bits & 8 ? [fence] : [])] : body;
    const lines = [open, ...(bits & 16 ? [''] : []), ...fenced, ...(bits & 32 ? [close] : []), ...(bits & 64 ? [''] : []), markers[3] as string];
    // Exercise prefixes using the reader's existing container handling, too.
    const container = (bits >>> 7) % 3;
    const source = lines.map((line, at) => (container === 1 ? '> ' : container === 2 ? (at === 0 ? '- ' : '  ') : '') + line).join('\n');
    return { index, source, markers };
  });
};
