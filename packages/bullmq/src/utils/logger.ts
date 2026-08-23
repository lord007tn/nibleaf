import { createLogger, type Logger } from '@nibleaf/logger';

// The public annotation keeps TypeScript 7 from leaking pnpm's installation
// path for pino into this package's inferred declaration name.
export const queueLogger: Logger = createLogger({ component: 'bullmq' });
