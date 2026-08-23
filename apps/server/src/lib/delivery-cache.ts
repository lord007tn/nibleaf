/** Cache policy for published delivery. Credential-dependent responses must not
 * be stored by browsers, reverse proxies, or CDNs and must vary on both supported
 * credential transports. */
const PRIVATE_DELIVERY_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } as const;

export const deliveryCacheHeaders = (isPrivate: boolean, publicPolicy: string): Record<string, string> =>
  isPrivate ? { ...PRIVATE_DELIVERY_HEADERS } : { 'Cache-Control': publicPolicy };

/** Delivery lookups deliberately return the same not-found response for an
 * absent resource and a private resource the visitor cannot read. Preserve that
 * non-disclosure boundary at the cache layer too: the global error response must
 * never enter a shared cache before a handler can choose its success policy. */
export const protectPrivateDeliveryFailureResponse = (path: string, response: Response): Response => {
  if (!/^\/api\/public\/(?:sites|assets)(?:\/|$)/.test(path)) return response;
  for (const [name, value] of Object.entries(PRIVATE_DELIVERY_HEADERS)) response.headers.set(name, value);
  return response;
};
