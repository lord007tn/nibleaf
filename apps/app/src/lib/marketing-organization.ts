/** Public organization facts shared by every Nibleaf JSON-LD graph.
 * Keep these values limited to facts Nibleaf intentionally publishes. */
export const NIBLEAF_ORGANIZATION = {
  name: 'Nibleaf',
  address: {
    '@type': 'PostalAddress',
    addressCountry: 'TN',
  },
  supportContact: {
    '@type': 'ContactPoint',
    contactType: 'Product support',
    email: 'support@nibleaf.com',
    availableLanguage: ['English', 'Arabic'],
  },
} as const;
