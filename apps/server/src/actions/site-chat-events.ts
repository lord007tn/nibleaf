import { prisma } from '@nibleaf/database';
import type { SiteChatEventsBody } from '@nibleaf/validators';
import { trustedChatConsent } from '@/actions/site-chat';
import { resolvePublishedAnswerContext } from '@/actions/sites';
import { notFound } from '@/errors';
import { recordAiChatEvents } from '@/lib/ai-search/conversation-archive';
/** Content-free reader chat events. Publication and reader access resolve first,
 * so unknown sites and readers without access to a private site get a 404; events
 * from readers who may read a private site are kept and marked private. */
export const recordSiteChatEvents = async (identifier: string, body: SiteChatEventsBody) => {
  const context = await resolvePublishedAnswerContext(identifier, body.lang);
  const project = await prisma.project.findUnique({ where: { id: context.scope.projectId }, select: { organizationId: true } });
  if (!project) throw notFound('site');
  await recordAiChatEvents(
    {
      tenantId: project.organizationId,
      projectId: context.scope.projectId,
      visibility: context.scope.visibility,
      consent: trustedChatConsent(context.snapshot.project.config, body.consent),
      sessionId: body.sessionId,
      language: context.scope.language,
    },
    body.events,
  );
  return { recorded: body.events.length };
};
