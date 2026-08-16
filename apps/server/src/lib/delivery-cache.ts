/** Cache policy for published delivery. Credential-dependent responses must not
 * be stored by browsers, reverse proxies, or CDNs and must vary on both supported
 * credential transports. */
export const deliveryCacheHeaders = (isPrivate: boolean, publicPolicy: string): Record<string, string> =>
  isPrivate ? { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } : { 'Cache-Control': publicPolicy };
