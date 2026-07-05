import postgres from 'postgres'

function getConnectionString(): string {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL environment variable is required')
  return url
}

// Package-private: never export this directly from index.ts
export const sql = postgres(getConnectionString(), {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})
