import { describe, it, expect } from 'vitest'
import * as shared from './index.js'

describe('shared package exports', () => {
  it('exports key schemas', () => {
    expect(shared.RegisterInputSchema).toBeDefined()
    expect(shared.UserSchema).toBeDefined()
    expect(shared.OrgSchema).toBeDefined()
    expect(shared.ProjectSchema).toBeDefined()
    expect(shared.SessionSchema).toBeDefined()
    expect(shared.ErrorCodes).toBeDefined()
  })
})
