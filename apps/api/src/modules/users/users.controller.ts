import { Controller, Get, Patch, Body, Param, UseGuards } from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import { UpdateProfileInputSchema } from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { UsersService, type UserProfile, type PublicProfile } from './users.service'

class UpdateProfileDto extends createZodDto(UpdateProfileInputSchema) {}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile> {
    return this.users.getMe(user.userId)
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.users.updateMe(user.userId, body)
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getPublicProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') targetId: string,
  ): Promise<PublicProfile> {
    return this.users.getPublicProfile(user.userId, targetId)
  }
}
