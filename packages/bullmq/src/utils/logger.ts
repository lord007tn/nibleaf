import { createLogger, type Logger } from '@nibleaf/logger';

export const queueLogger: Logger = createLogger({ component: 'bullmq' });
