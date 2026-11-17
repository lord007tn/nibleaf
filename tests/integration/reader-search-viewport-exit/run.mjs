import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

switch (process.argv[2]) {
  case '--build': {
    const { build } = await import('vite');
    const { default: config } = await import('../../../apps/app/tests/reader-search-viewport-exit/vite.config.mjs');
    await build({ ...config, configFile: false });
    break;
  }
  case '--serve':
    await import('./serve.mjs');
    break;
  case '--capture':
    await import('./browser.mjs');
    break;
  case '--acquire':
    await import('./acquire.mjs');
    break;
  default:
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./run.ps1', import.meta.url))], {
      stdio: 'inherit',
    });
}
