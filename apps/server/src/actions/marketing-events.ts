import { type Prisma, prisma } from '@nibleaf/database';

export type MarketingEventName = 'free_tool_started' | 'free_tool_completed' | 'free_tool_cta_clicked';

/** Store a privacy-safe marketing event. Validation at the public boundary
 * accepts only enumerated properties and rejects URLs, submitted content, and
 * free-form personal data before this action runs. */
export async function recordMarketingEvent(event: MarketingEventName, properties: Record<string, string | number>): Promise<{ recorded: true }> {
  await prisma.platformEvent.create({
    data: {
      type: event,
      metadata: properties as Prisma.InputJsonValue,
    },
  });
  return { recorded: true };
}
