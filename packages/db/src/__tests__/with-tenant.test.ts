/**
 * Test: withTenant passes ctx correctly and returns fn result.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TenantContext } from '../with-tenant.js';

describe('withTenant', () => {
  beforeEach(() => {
    // Ensure DATABASE_URL is unset so PGlite is used
    delete process.env['DATABASE_URL'];
    // Use a unique in-memory path per test run
    process.env['PGLITE_DATA_DIR'] = `memory://with-tenant-test-${Date.now()}`;
  });

  afterEach(() => {
    // Clear module cache so singleton is reset between tests
    vi.resetModules();
    delete process.env['PGLITE_DATA_DIR'];
  });

  it('passes ctx to fn and returns the fn result', async () => {
    const { withTenant } = await import('../with-tenant.js');

    const ctx: TenantContext = {
      projectId: 'proj-123',
      userId: 'user-456',
    };

    const result = await withTenant(ctx, async (db, receivedCtx) => {
      expect(receivedCtx.projectId).toBe('proj-123');
      expect(receivedCtx.userId).toBe('user-456');
      expect(db).toBeDefined();
      return 'hello-from-fn';
    });

    expect(result).toBe('hello-from-fn');
  });

  it('propagates errors thrown inside fn', async () => {
    const { withTenant } = await import('../with-tenant.js');

    const ctx: TenantContext = { projectId: 'p', userId: 'u' };

    await expect(
      withTenant(ctx, async () => {
        throw new Error('intentional-error');
      }),
    ).rejects.toThrow('intentional-error');
  });

  it('works with async fn that returns a complex value', async () => {
    const { withTenant } = await import('../with-tenant.js');

    const ctx: TenantContext = { projectId: 'p2', userId: 'u2' };

    const result = await withTenant(ctx, async (_db, c) => ({
      projectId: c.projectId,
      items: [1, 2, 3],
    }));

    expect(result.projectId).toBe('p2');
    expect(result.items).toEqual([1, 2, 3]);
  });
});
