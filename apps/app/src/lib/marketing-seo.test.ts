import { describe, expect, it } from 'vitest';

import { NIBLEAF_ORGANIZATION } from '@/lib/marketing-organization';
import { marketingLd } from '@/lib/marketing-seo';

describe('marketingLd', () => {
  it('emits truthful linked entities and a numeric free offer', () => {
    const json = JSON.parse(marketingLd().children) as {
      '@graph': Array<Record<string, unknown>>;
    };
    const organization = json['@graph'].find((entry) => entry['@type'] === 'Organization');
    const application = json['@graph'].find((entry) => entry['@type'] === 'WebApplication');

    expect(organization?.sameAs).toEqual(['https://github.com/lord007tn/nibleaf']);
    expect(organization?.contactPoint).toMatchObject({
      '@type': 'ContactPoint',
      contactType: 'Product support',
      email: 'support@nibleaf.com',
    });
    expect(organization?.address).toEqual(NIBLEAF_ORGANIZATION.address);
    const offer = application?.offers as Record<string, unknown>;
    expect(offer).toMatchObject({
      '@type': 'Offer',
      price: 0,
      priceCurrency: 'USD',
    });
    expect(offer.url).toMatch(/\/pricing$/);
    expect(json['@graph'].some((entry) => entry['@type'] === 'SoftwareApplication')).toBe(false);
  });

  it('keeps public organization facts in the shared constant', () => {
    expect(NIBLEAF_ORGANIZATION).toMatchObject({
      name: 'Nibleaf',
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'TN',
      },
      supportContact: {
        email: 'support@nibleaf.com',
      },
    });
  });
});
