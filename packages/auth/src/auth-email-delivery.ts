import { AsyncLocalStorage } from 'node:async_hooks';
import { APIError, createAuthMiddleware } from 'better-auth/api';

interface DeliveryContext {
  request?: Request;
}

const deliveryScope = new AsyncLocalStorage<object>();
const requiredDeliveries = new WeakMap<object, Promise<boolean>>();
const unavailable = () =>
  new APIError('SERVICE_UNAVAILABLE', { code: 'AUTH_EMAIL_UNAVAILABLE', message: 'Unable to send a code. Please try again shortly.' });

/** Keep nested, requestless Better Auth wrappers in their outer invocation. */
export function withRequiredAuthEmailScope<T extends { handler: (request: Request) => Promise<Response>; api: object }>(auth: T): T {
  const handler = (request: Request) => deliveryScope.run({}, () => auth.handler(request));
  const api = new Proxy(auth.api, {
    get(target, property, receiver) {
      const endpoint: unknown = Reflect.get(target, property, receiver);
      if (typeof endpoint !== 'function') return endpoint;
      return new Proxy(endpoint, {
        apply(method, receiver, args) {
          return deliveryScope.run({}, () => Reflect.apply(method, receiver, args));
        },
      });
    },
  });
  return new Proxy(auth, {
    get(target, property, receiver) {
      if (property === 'handler') return handler;
      if (property === 'api') return api;
      return Reflect.get(target, property, receiver);
    },
  });
}

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
  const key = deliveryScope.getStore() ?? context?.request;
  if (key) {
    const previous = requiredDeliveries.get(key);
    requiredDeliveries.set(key, previous ? Promise.all([previous, outcome]).then((results) => results.every(Boolean)) : outcome);
  }
  if (!(await outcome) && !key) throw unavailable();
}

export const requireAuthEmailEnqueue = createAuthMiddleware(async (context) => {
  const key = deliveryScope.getStore() ?? context.request;
  if (!key) return;
  const acknowledgement = requiredDeliveries.get(key);
  if (!acknowledgement) return;
  requiredDeliveries.delete(key);
  if (!(await acknowledgement)) throw unavailable();
});
