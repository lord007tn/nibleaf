import { APIError, createAuthMiddleware } from 'better-auth/api';

interface DeliveryContext {
  request?: Request;
  context?: object;
}

const requiredDeliveries = new WeakMap<object, Promise<boolean>>();
const unavailable = () =>
  new APIError('SERVICE_UNAVAILABLE', { code: 'AUTH_EMAIL_UNAVAILABLE', message: 'Unable to send a code. Please try again shortly.' });

/**
 * Better Auth catches errors from runInBackgroundOrAwait. Retain a request-only
 * acknowledgement so its public after hook can report a required enqueue
 * failure. Optional notifications never register here and stay best-effort.
 */
export async function trackRequiredAuthEmail(context: DeliveryContext | undefined, delivery: () => Promise<void>): Promise<void> {
  const outcome = Promise.resolve()
    .then(delivery)
    .then(
      () => true,
      () => false,
    );
  const key = context?.request ?? context?.context;
  if (key) {
    const previous = requiredDeliveries.get(key);
    requiredDeliveries.set(key, previous ? Promise.all([previous, outcome]).then((results) => results.every(Boolean)) : outcome);
  }
  if (!(await outcome) && !key) throw unavailable();
}

export const requireAuthEmailEnqueue = createAuthMiddleware(async (context) => {
  const key = context.request ?? context.context;
  const acknowledgement = requiredDeliveries.get(key);
  if (!acknowledgement) return;
  requiredDeliveries.delete(key);
  if (!(await acknowledgement)) throw unavailable();
});
