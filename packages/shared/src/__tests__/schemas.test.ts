import { describe, it, expect } from 'vitest';
import {
  RegisterSchema,
  SetProfileSchema,
  LoginSchema,
  CreateOrgSchema,
  CreateProjectSchema,
  CreateRoomSchema,
  SendMessageSchema,
  CreateBranchSchema,
} from '../schemas.js';

describe('SetProfileSchema', () => {
  it('accepts a non-empty name', () => {
    expect(SetProfileSchema.safeParse({ name: 'Alice' }).success).toBe(true);
  });
  it('rejects an empty name', () => {
    expect(SetProfileSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('RegisterSchema', () => {
  it('accepts valid registration data', () => {
    const result = RegisterSchema.safeParse({
      email: 'user@example.com',
      name: 'Alice',
      password: 'securepassword123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = RegisterSchema.safeParse({
      email: 'not-an-email',
      name: 'Alice',
      password: 'securepassword123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 8 characters', () => {
    const result = RegisterSchema.safeParse({
      email: 'user@example.com',
      name: 'Alice',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('does not require a name (name is deferred to onboarding)', () => {
    const result = RegisterSchema.safeParse({
      email: 'user@example.com',
      password: 'securepassword123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects email longer than 255 characters', () => {
    const longEmail = `${'a'.repeat(250)}@example.com`;
    const result = RegisterSchema.safeParse({
      email: longEmail,
      name: 'Alice',
      password: 'securepassword123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password longer than 128 characters', () => {
    const result = RegisterSchema.safeParse({
      email: 'user@example.com',
      name: 'Alice',
      password: 'a'.repeat(129),
    });
    expect(result.success).toBe(false);
  });
});

describe('LoginSchema', () => {
  it('accepts valid login data', () => {
    const result = LoginSchema.safeParse({
      email: 'user@example.com',
      password: 'mypassword',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = LoginSchema.safeParse({
      email: 'not-an-email',
      password: 'mypassword',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = LoginSchema.safeParse({
      email: 'user@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateOrgSchema', () => {
  it('accepts valid org data', () => {
    const result = CreateOrgSchema.safeParse({ name: 'Acme Inc', slug: 'acme-inc' });
    expect(result.success).toBe(true);
  });

  it('rejects slug with uppercase letters', () => {
    const result = CreateOrgSchema.safeParse({ name: 'Acme Inc', slug: 'Acme-Inc' });
    expect(result.success).toBe(false);
  });

  it('rejects slug with spaces', () => {
    const result = CreateOrgSchema.safeParse({ name: 'Acme Inc', slug: 'acme inc' });
    expect(result.success).toBe(false);
  });
});

describe('CreateProjectSchema', () => {
  it('accepts valid project with optional description', () => {
    const result = CreateProjectSchema.safeParse({
      name: 'My Project',
      slug: 'my-project',
      description: 'A great project',
    });
    expect(result.success).toBe(true);
  });

  it('accepts project without description', () => {
    const result = CreateProjectSchema.safeParse({ name: 'My Project', slug: 'my-project' });
    expect(result.success).toBe(true);
  });

  it('rejects description longer than 500 characters', () => {
    const result = CreateProjectSchema.safeParse({
      name: 'My Project',
      slug: 'my-project',
      description: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateRoomSchema', () => {
  it('accepts a custom room with one agent (1-on-1)', () => {
    const result = CreateRoomSchema.safeParse({ name: 'CEO Chat', personas: ['ceo'] });
    expect(result.success).toBe(true);
  });

  it('accepts a custom room with several agents', () => {
    const result = CreateRoomSchema.safeParse({ name: 'Growth', personas: ['cmo', 'cfo', 'ceo'] });
    expect(result.success).toBe(true);
  });

  it('rejects a room with no agents', () => {
    const result = CreateRoomSchema.safeParse({ name: 'Empty', personas: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a room with no name', () => {
    const result = CreateRoomSchema.safeParse({ personas: ['ceo'] });
    expect(result.success).toBe(false);
  });
});

describe('SendMessageSchema', () => {
  it('accepts valid message', () => {
    const result = SendMessageSchema.safeParse({
      content: 'Hello world',
      branchId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = SendMessageSchema.safeParse({
      content: '',
      branchId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID branchId', () => {
    const result = SendMessageSchema.safeParse({ content: 'Hello', branchId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('CreateBranchSchema', () => {
  it('accepts valid branch data', () => {
    const result = CreateBranchSchema.safeParse({
      name: 'Feature Branch',
      fromNodeId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID fromNodeId', () => {
    const result = CreateBranchSchema.safeParse({ name: 'Branch', fromNodeId: 'bad-id' });
    expect(result.success).toBe(false);
  });
});
