import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const email = process.env.SEED_DEMO_EMAIL ?? 'demo@local.test';
  const password = process.env.SEED_DEMO_PASSWORD ?? 'ChangeMe123!';
  const emailNorm = normalizeEmail(email);

  const existing = await prisma.user.findUnique({
    where: { emailNorm },
    select: { id: true },
  });

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`Seed: demo user already exists (id=${existing.id})`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const passwordHash = await argon2.hash(password);

  const user = await prisma.user.create({
    data: {
      email,
      emailNorm,
      passwordHash,
    },
    select: { id: true, email: true },
  });

  // eslint-disable-next-line no-console
  console.log('Seed: created demo user');
  // eslint-disable-next-line no-console
  console.log({ id: user.id, email: user.email });

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
