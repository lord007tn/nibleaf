import { type Prisma, prisma } from '@nibleaf/database';
import { type MarketingEventBody, marketingEventBody } from '@/modules/public/marketing-events/schema';

/** Store a privacy-safe marketing event. Validation at the public boundary
 * accepts only enumerated properties and rejects URLs, submitted content, and
 * free-form personal data before this action runs. */
export async function recordMarketingEvent(input: MarketingEventBody): Promise<{ recorded: true }> {
  const { event, properties } = marketingEventBody.parse(input);
  await prisma.platformEvent.create({
    data: {
      type: event,
      metadata: properties as Prisma.InputJsonValue,
    },
  });
  return { recorded: true };
}
