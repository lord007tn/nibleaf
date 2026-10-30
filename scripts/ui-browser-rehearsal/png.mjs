// Minimal PNG decoder for Chromium screenshots (8-bit RGB/RGBA, non-interlaced),
// so the chevron direction can be read from pixels without a dependency.
import { inflateSync } from 'node:zlib';

export function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || chunk[12] !== 0) throw new Error('unsupported PNG layout');
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      idat.push(chunk);
    }
    offset += length + 12;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** Which way a chevron points, judged from the ink pixels that differ from the dominant background. */
export function chevronDirection(buffer) {
  const { width, height, channels, pixels } = decodePng(buffer);
  const colorAt = (x, y) => {
    const i = (y * width + x) * channels;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
  const counts = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = colorAt(x, y).join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const ink = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorAt(x, y);
      if (Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) > 90) ink.push([x, y]);
    }
  }
  if (ink.length < 10) return { direction: 'none', inkPixels: ink.length };
  const xs = ink.map(([x]) => x);
  const ys = ink.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const spread = (points, axis) => (points.length ? Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis])) + 1 : 0);
  const band = 0.2;
  const evidence = { inkPixels: ink.length, box: { w, h } };
  if (h > w) {
    const left = spread(ink.filter(([x]) => x <= minX + w * band), 1);
    const right = spread(ink.filter(([x]) => x >= maxX - w * band), 1);
    return { direction: left > right ? 'right' : 'left', ...evidence, bands: { left, right } };
  }
  const top = spread(ink.filter(([, y]) => y <= minY + h * band), 0);
  const bottom = spread(ink.filter(([, y]) => y >= maxY - h * band), 0);
  return { direction: top > bottom ? 'down' : 'up', ...evidence, bands: { top, bottom } };
}
