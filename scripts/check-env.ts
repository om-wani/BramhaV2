import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    result[key] = trimmed.slice(eqIdx + 1).trim()
  }
  return result
}

function checkEnv(): void {
  const examplePath = resolve(ROOT, '.env.example')
  const envPath = resolve(ROOT, '.env')

  const exampleKeys = Object.keys(parseEnvFile(examplePath))

  let envVars: Record<string, string>
  try {
    envVars = parseEnvFile(envPath)
  } catch {
    console.error('ERROR: .env file not found. Copy .env.example to .env and fill in values.')
    process.exit(1)
  }

  const missing = exampleKeys.filter((k) => !(k in envVars))
  const extra = Object.keys(envVars).filter((k) => !exampleKeys.includes(k))

  if (missing.length > 0) {
    console.error(`ERROR: Missing env vars (defined in .env.example but not in .env):\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }

  if (extra.length > 0) {
    console.warn(`WARN: Extra env vars in .env not in .env.example:\n  ${extra.join('\n  ')}`)
  }

  console.log(`✓ All ${exampleKeys.length} required env vars present.`)
}

checkEnv()
