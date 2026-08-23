import { defineConfig } from 'prisma/config';
import { keys } from './src/keys';

const env = keys();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env.POSTGRES_URL },
});
