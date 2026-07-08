import { prisma } from '@nibleaf/database';
import type { WaitlistSubmitBody } from '@nibleaf/validators';

/**
 * Add an email to the managed-Cloud waitlist. Idempotent: re-submitting the same
 * email refreshes its source/locale rather than erroring, and the response never
 * reveals whether the address was already on the list.
 */
export async function addToWaitlist(body: WaitlistSubmitBody): Promise<{ ok: true }> {
  const { email, source, locale } = body;
  await prisma.waitlistEntry.upsert({
    where: { email },
    create: { email, source, locale },
    update: { source: source ?? undefined, locale: locale ?? undefined },
  });
  return { ok: true };
}
