import { Global, Module } from '@nestjs/common'
import { RlsDbService } from './rls-db.service'

@Global()
@Module({
  providers: [RlsDbService],
  exports: [RlsDbService],
})
export class DbModule {}
