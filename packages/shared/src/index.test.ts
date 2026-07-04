import { describe, it, expect } from 'vitest'

describe('shared package', () => {
  it('exports an empty module', async () => {
    const mod = await import('./index.js')
    expect(mod).toBeDefined()
  })
})
