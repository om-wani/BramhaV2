import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req } from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { ApiKeysService } from './api-keys.service'
import { CreateApiKeyDto } from './dto/create-api-key.dto'

@Controller('users/me/api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  create(@Req() req: { user: { userId: string } }, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(req.user.userId, dto)
  }

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.apiKeys.list(req.user.userId)
  }

  @Delete(':id')
  revoke(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.apiKeys.revoke(req.user.userId, id)
  }
}
