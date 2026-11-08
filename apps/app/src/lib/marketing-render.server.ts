import { renderSsrHtmlResponse } from '@tanstack/react-router/ssr/server';
import { type defaultStreamHandler, StartServer } from '@tanstack/react-start/server';
import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';

/** Wait for every Suspense boundary before consuming React's stream. Unlike the
 * default streaming handler, no bot detection or timing-dependent reveal scripts
 * are involved. Router hydration is appended to the completed HTML afterward. */
export function renderMarketing({ request, router, responseHeaders }: Parameters<typeof defaultStreamHandler>[0]) {
  return renderSsrHtmlResponse({
    router,
    responseHeaders,
    render: async () => {
      const stream = await renderToReadableStream(createElement(StartServer, { router }), { signal: request.signal });
      await stream.allReady;
      return new Response(stream).text();
    },
  });
}
