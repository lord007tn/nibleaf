import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'nibleaf-custom-domain-edge',
    compatibilityDate: '2026-07-15',
    entrypoint: 'src/index.ts',
    workersDev: false,
    previewUrls: false,
    observability: { enabled: true, headSamplingRate: 0.1 },
    // Preserve variables and secrets managed outside this repository on uploads.
    unsafe: { metadata: { keep_bindings: ['plain_text', 'json', 'secret_text'] } },
    env: {
      APP_ORIGIN: bindings.text('https://nibleaf.com'),
      EDGE_SECRET: bindings.secret(),
    },
    // Routes are managed externally. Upload and deploy scripts only change versions.
  },
});
