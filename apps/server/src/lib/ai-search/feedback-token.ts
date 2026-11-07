import { createHmac } from 'node:crypto';
import { safeEqual } from '@nibleaf/shared/crypto';
import { env } from '@/env';

/** Proof that a reader received a specific answer. Conversation and turn ids are
 * random, but only the API can mint this, so a third party cannot rate or
 * comment on answers they never saw. Domain-separated from session signing. */
export const chatFeedbackToken = (projectId: string, conversationId: string, turnId: string): string =>
  createHmac('sha256', env.BETTER_AUTH_SECRET).update(`nibleaf:ai-chat-feedback:v1\0${projectId}\0${conversationId}\0${turnId}`).digest('base64url');

export const verifyChatFeedbackToken = (projectId: string, conversationId: string, turnId: string, token: string): boolean =>
  safeEqual(chatFeedbackToken(projectId, conversationId, turnId), token);
