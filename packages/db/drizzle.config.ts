import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  // Only needed for `drizzle-kit migrate` (applies generated SQL to the DB).
  // `drizzle-kit generate` works without it.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
