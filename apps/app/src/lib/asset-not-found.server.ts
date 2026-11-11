import { defineHandler, HTTPError } from 'nitro/h3';

/**
 * Nitro's static middleware serves every file the build wrote under `/assets/`,
 * so a request that reaches this route asked for a file that does not exist: an
 * old chunk after a deploy, a typo, or a probe. Without this route it falls
 * through to the page renderer and comes back as an HTML error page.
 *
 * The `/assets/**` route rule stamps `immutable` and the static-build marker on
 * every response it wraps, error responses included, so returning a 404 would
 * keep them: a browser or proxy could then store the miss for a year. A thrown
 * error is answered by Nitro's error handler outside that rule, with only the
 * headers given here.
 */
const ASSET_NOT_FOUND_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

export default defineHandler(() => {
  throw new HTTPError({ status: 404, statusText: 'Not Found', headers: ASSET_NOT_FOUND_HEADERS });
});
