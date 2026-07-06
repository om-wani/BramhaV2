import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import {
  CreateOrgInputSchema,
  UpdateOrgInputSchema,
  InviteOrgMemberInputSchema,
  UpdateOrgMemberRoleInputSchema,
} from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { OrgAdminGuard, OrgOwnerGuard, OrgMemberGuard } from '../common/guards/org-role.guard'
import { OrgsService, type OrgDto, type OrgMemberDto } from './orgs.service'

class CreateOrgDto extends createZodDto(CreateOrgInputSchema) {}
class UpdateOrgDto extends createZodDto(UpdateOrgInputSchema) {}
class InviteOrgMemberDto extends createZodDto(InviteOrgMemberInputSchema) {}
class UpdateOrgMemberRoleDto extends createZodDto(UpdateOrgMemberRoleInputSchema) {}

@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /** POST /orgs — Create org; caller becomes owner */
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateOrgDto,
  ): Promise<OrgDto> {
    return this.orgs.create(user.userId, body)
  }

  /** GET /orgs — List orgs the caller belongs to */
  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser): Promise<OrgDto[]> {
    return this.orgs.listForUser(user.userId)
  }

  /** GET /orgs/:orgId — Get org details */
  @Get(':orgId')
  @UseGuards(JwtAuthGuard)
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): Promise<OrgDto> {
    return this.orgs.getById(user.userId, orgId)
  }

  /** PATCH /orgs/:orgId — Update org (owner only) */
  @Patch(':orgId')
  @UseGuards(JwtAuthGuard, OrgOwnerGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Body() body: UpdateOrgDto,
  ): Promise<OrgDto> {
    return this.orgs.update(user.userId, orgId, body)
  }

  /** DELETE /orgs/:orgId — Delete org (owner only) */
  @Delete(':orgId')
  @UseGuards(JwtAuthGuard, OrgOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): Promise<void> {
    return this.orgs.deleteOrg(user.userId, orgId)
  }

  // ── Members ──────────────────────────────────────────────────────────────

  /** POST /orgs/:orgId/members — Invite member by email (admin+) */
  @Post(':orgId/members')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  inviteMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Body() body: InviteOrgMemberDto,
  ): Promise<OrgMemberDto> {
    return this.orgs.inviteMember(user.userId, orgId, body)
  }

  /** GET /orgs/:orgId/members — List org members */
  @Get(':orgId/members')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): Promise<OrgMemberDto[]> {
    return this.orgs.listMembers(user.userId, orgId)
  }

  /** PATCH /orgs/:orgId/members/:userId — Update member role (admin+) */
  @Patch(':orgId/members/:userId')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() body: UpdateOrgMemberRoleDto,
  ): Promise<void> {
    return this.orgs.updateMemberRole(user.userId, orgId, targetUserId, body.role)
  }

  /** DELETE /orgs/:orgId/members/:userId — Remove member (admin+) */
  @Delete(':orgId/members/:userId')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.orgs.removeMember(user.userId, orgId, targetUserId)
  }
}
