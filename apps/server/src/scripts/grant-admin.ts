/**
 * Grant (or revoke) the platform admin role used by the internal admin panel
 * (apps/admin). This is the only way to mint the first admin.
 *
 *   pnpm --filter @midad/server with-env tsx src/scripts/grant-admin.ts <email> [admin|user]
 */
import { prisma } from '@midad/database';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = (process.argv[3] ?? 'admin').trim();
  if (!email || (role !== 'admin' && role !== 'user')) {
    process.stdout.write('Usage: grant-admin.ts <email> [admin|user]\n');
    process.exit(1);
  }
  const user = await prisma.user.update({ where: { email }, data: { role } }).catch(() => null);
  if (!user) {
    process.stdout.write(`No user found for ${email}\n`);
    process.exit(1);
  }
  process.stdout.write(`OK — ${email} is now "${role}"\n`);
  process.exit(0);
}

void main();
