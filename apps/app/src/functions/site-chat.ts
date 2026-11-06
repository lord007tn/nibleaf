import { siteChatBody, siteChatEventsBody, siteChatFeedbackBody } from '@nibleaf/validators';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { errorSse, upstreamError } from '@/components/site/ai-chat/helpers';
import { apiOrigin } from '@/services/api-origin';

const project = { projectId: z.string().min(1) };
const streamHeaders = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' };
export const chatSiteFn = createServerFn({ method: 'POST' })
  .validator(siteChatBody.extend(project))
  .handler(async ({ data }) => {
    const { projectId, ...body } = data;
    const upstream = await fetch(`${apiOrigin()}/api/public/sites/${encodeURIComponent(projectId)}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: getRequest().signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return new Response(errorSse(body.conversationId, crypto.randomUUID(), upstreamError(upstream.status)), { headers: streamHeaders });
    }
    return new Response(upstream.body, { headers: streamHeaders });
  });
export const submitChatFeedbackFn = createServerFn({ method: 'POST' })
  .validator(siteChatFeedbackBody.extend(project))
  .handler(async ({ data }) => {
    const { projectId, ...body } = data;
    const result = await fetch(`${apiOrigin()}/api/public/sites/${encodeURIComponent(projectId)}/chat/feedback`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: getRequest().signal,
    });
    if (!result.ok) throw new Error('Feedback unavailable');
    return { saved: true };
  });

export const trackChatEventsFn = createServerFn({ method: 'POST' })
  .validator(siteChatEventsBody.extend(project))
  .handler(async ({ data }) => {
    try {
      const { projectId, ...body } = data;
      const result = await fetch(`${apiOrigin()}/api/public/sites/${encodeURIComponent(projectId)}/chat/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      await result.body?.cancel();
    } catch {
      /* Reader telemetry is best effort. */
    }
  });
