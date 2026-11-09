/**
 * Public email providers: anyone can create an address there for free. Allowing
 * such a domain on a private site would let anyone read it, so the reader
 * access settings refuse them (see `readerEmailDomain` in @nibleaf/validators).
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  // Google, Microsoft, Yahoo, AOL, Apple
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'passport.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'aol.com',
  'aim.com',
  'icloud.com',
  'me.com',
  'mac.com',
  // Privacy-focused and independent providers
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'tutanota.com',
  'tutanota.de',
  'tutamail.com',
  'tuta.io',
  'tuta.com',
  'zoho.com',
  'zohomail.com',
  'mail.com',
  'email.com',
  'fastmail.com',
  'fastmail.fm',
  'hey.com',
  'duck.com',
  'hushmail.com',
  'mailbox.org',
  'posteo.de',
  'posteo.net',
  'gmx.com',
  'gmx.net',
  // Europe
  'web.de',
  't-online.de',
  'freenet.de',
  'laposte.net',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'libero.it',
  'virgilio.it',
  'alice.it',
  'tiscali.it',
  'seznam.cz',
  'wp.pl',
  'o2.pl',
  'interia.pl',
  'onet.pl',
  'btinternet.com',
  'sky.com',
  // Russia and neighbours
  'mail.ru',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  'internet.ru',
  'ya.ru',
  'rambler.ru',
  // China, Korea, India
  'qq.com',
  'foxmail.com',
  '163.com',
  '126.com',
  'yeah.net',
  'sina.com',
  'sina.cn',
  'sohu.com',
  'aliyun.com',
  '139.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'rediffmail.com',
  // Internet service providers handing out personal addresses
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'cox.net',
  'bellsouth.net',
  'earthlink.net',
  'juno.com',
  'shaw.ca',
  'rogers.com',
  'bigpond.com',
  'optusnet.com.au',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
]);

/** Providers that run the same free service under many country domains
 *  (gmx.de, yandex.com.tr, yahoo.co.uk, hotmail.fr…). */
const PUBLIC_EMAIL_BRANDS = new Set(['gmail', 'gmx', 'yandex', 'yahoo', 'hotmail', 'outlook', 'live', 'aol']);
/** Second-level labels used under country codes (co.uk, com.br, ne.jp…). */
const COUNTRY_SECOND_LEVELS = new Set(['co', 'com', 'net', 'org', 'ne', 'or']);

/** Whether `domain` (an email domain such as `example.com`) is a public email provider. */
export const isPublicEmailProvider = (domain: string): boolean => {
  const normalized = domain.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
  if (PUBLIC_EMAIL_DOMAINS.has(normalized)) return true;
  const [brand, ...rest] = normalized.split('.');
  if (!brand || !PUBLIC_EMAIL_BRANDS.has(brand)) return false;
  // brand.tld (gmx.de) or brand.sld.cc (yahoo.co.uk); never brand.company.com.
  if (rest.length === 1) return true;
  return rest.length === 2 && COUNTRY_SECOND_LEVELS.has(rest[0] as string) && (rest[1] as string).length === 2;
};
