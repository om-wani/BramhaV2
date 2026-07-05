import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

const ROOT = resolve(import.meta.dirname, '..')
const ENV_PATH = resolve(ROOT, '.env')
const EXAMPLE_PATH = resolve(ROOT, '.env.example')

describe('check-env', () => {
  const hadEnvBefore = existsSync(ENV_PATH)

  afterEach(() => {
    if (!hadEnvBefore && existsSync(ENV_PATH)) {
      unlinkSync(ENV_PATH)
    }
  })

  it('passes when all example keys present in .env', () => {
    const example = readFileSync(EXAMPLE_PATH, 'utf-8')
    writeFileSync(ENV_PATH, example)
    expect(() =>
      execSync(`npx tsx ${ROOT}/scripts/check-env.ts`, { stdio: 'pipe' })
    ).not.toThrow()
  })

  it('exits non-zero when .env is missing', () => {
    if (existsSync(ENV_PATH)) unlinkSync(ENV_PATH)
    expect(() =>
      execSync(`npx tsx ${ROOT}/scripts/check-env.ts`, { stdio: 'pipe' })
    ).toThrow()
  })
})
