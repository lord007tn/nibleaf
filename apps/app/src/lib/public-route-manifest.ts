const PUBLIC_SITE_ROUTE_TEMPLATE = '/sites/$projectId';
const SERIALIZED_PUBLIC_SITE_ROUTE_TEMPLATE = '/sites/\\u0024projectId';
const STREAM_BARRIER_ID = 'id="$tsr-stream-barrier"';
const SCRIPT_OPEN = '<script';
const SCRIPT_CLOSE = '</script>';
const OUTSIDE_OVERLAP = SCRIPT_OPEN.length - 1;

/**
 * TanStack Start serializes matched route IDs into an inline hydration script.
 * A route ID is runtime state, not a public URL, but crawlers can still extract
 * slash-prefixed strings from that script. Encode only the dollar sign as a
 * JavaScript Unicode escape: the browser evaluates the original route ID while
 * the HTML source no longer advertises the placeholder as a crawlable path.
 */
export function encodePublicRouteManifestTemplates(source: string): string {
  return source.replace(/<script\b[^>]*id=["']\$tsr-stream-barrier["'][^>]*>[\s\S]*?<\/script>/g, (script) =>
    script.replaceAll(PUBLIC_SITE_ROUTE_TEMPLATE, SERIALIZED_PUBLIC_SITE_ROUTE_TEMPLATE),
  );
}

/** Preserve streamed SSR while encoding route templates, including matches
 * split across arbitrary byte chunks. Only the framework-owned stream barrier
 * is buffered; authored HTML and MDX pass through unchanged. */
export function encodePublicRouteManifestResponse(response: Response): Response {
  if (!response.body || !(response.headers.get('content-type') ?? '').includes('text/html')) {
    return response;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = '';
  let insideStreamBarrier = false;

  const write = (controller: TransformStreamDefaultController<Uint8Array>, value: string) => {
    if (value) controller.enqueue(encoder.encode(value));
  };

  const drain = (controller: TransformStreamDefaultController<Uint8Array>, flush = false) => {
    while (buffered) {
      if (insideStreamBarrier) {
        const closeIndex = buffered.indexOf(SCRIPT_CLOSE);
        if (closeIndex === -1 && !flush) return;

        const end = closeIndex === -1 ? buffered.length : closeIndex + SCRIPT_CLOSE.length;
        const script = buffered.slice(0, end);
        write(controller, script.replaceAll(PUBLIC_SITE_ROUTE_TEMPLATE, SERIALIZED_PUBLIC_SITE_ROUTE_TEMPLATE));
        buffered = buffered.slice(end);
        insideStreamBarrier = false;
        continue;
      }

      const scriptStart = buffered.indexOf(SCRIPT_OPEN);
      if (scriptStart !== -1) {
        write(controller, buffered.slice(0, scriptStart));
        buffered = buffered.slice(scriptStart);

        const tagEnd = buffered.indexOf('>');
        if (tagEnd === -1 && !flush) return;

        if (tagEnd !== -1) {
          const openingTag = buffered.slice(0, tagEnd + 1);
          write(controller, openingTag);
          buffered = buffered.slice(tagEnd + 1);
          insideStreamBarrier = openingTag.includes(STREAM_BARRIER_ID);
          continue;
        }
      }

      if (flush) {
        write(controller, buffered);
        buffered = '';
      } else if (buffered.length > OUTSIDE_OVERLAP) {
        write(controller, buffered.slice(0, -OUTSIDE_OVERLAP));
        buffered = buffered.slice(-OUTSIDE_OVERLAP);
      }
      return;
    }
  };

  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true });
        drain(controller);
      },
      flush(controller) {
        buffered += decoder.decode();
        drain(controller, true);
      },
    }),
  );

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
