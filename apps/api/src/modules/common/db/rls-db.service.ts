import { Injectable } from '@nestjs/common'
import { withTenant } from '@bramha/db'
import type { TenantContext } from '@bramha/db'
import type postgres from 'postgres'

@Injectable()
export class RlsDbService {
  async run<T>(
    ctx: TenantContext,
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    return withTenant(fn, ctx)
  }
}
