import { defineConfig } from 'prisma/config';

const LOCAL_DATABASE_URL = 'postgresql://nibleaf:nibleaf@localhost:5442/nibleaf';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.POSTGRES_URL ?? LOCAL_DATABASE_URL },
});
