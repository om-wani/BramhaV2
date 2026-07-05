import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/identity.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgresql://bramha_dev:dev_only_postgres_password@localhost:5432/bramha_dev',
  },
})
