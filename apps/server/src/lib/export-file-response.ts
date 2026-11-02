export const exportFileResponseHeaders = (fileName: string, format: string, size: number): Record<string, string> => {
  if (
    !fileName.trim() ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    [...fileName].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    throw new Error('Invalid download filename');
  }
  const fallback = [...fileName].map((character) => (character.charCodeAt(0) > 126 || character === '"' ? '_' : character)).join('');
  const encoded = encodeURIComponent(fileName).replace(/['()*!]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    'Content-Type': format === 'PDF' ? 'application/pdf' : 'application/zip',
    'Content-Length': String(size),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  };
};
