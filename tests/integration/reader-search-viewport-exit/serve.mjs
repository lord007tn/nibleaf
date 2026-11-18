import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

await preview({ configFile: fileURLToPath(new URL('../../../apps/app/tests/reader-search-viewport-exit/vite.config.mjs', import.meta.url)) });
