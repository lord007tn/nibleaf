import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export interface GetDbParams {
  connectionString: string;
}

export function getDb({ connectionString }: GetDbParams): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type { PrismaClient } from './generated/client';
