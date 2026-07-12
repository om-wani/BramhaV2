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
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  AddProjectMemberInputSchema,
  UpdateProjectMemberRoleInputSchema,
} from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator.js'
import { OrgMemberGuard } from '../common/guards/org-role.guard.js'
import { ProjectViewerGuard, ProjectOwnerGuard } from '../common/guards/project-member.guard.js'
import { ProjectsService, type ProjectDto, type ProjectMemberDto } from './projects.service.js'

class CreateProjectDto extends createZodDto(CreateProjectInputSchema) {}
class UpdateProjectDto extends createZodDto(UpdateProjectInputSchema) {}
class AddProjectMemberDto extends createZodDto(AddProjectMemberInputSchema) {}
class UpdateProjectMemberRoleDto extends createZodDto(UpdateProjectMemberRoleInputSchema) {}

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // ── Org-scoped project routes ─────────────────────────────────────────

  /** POST /orgs/:orgId/projects — Create project in org (org member+) */
  @Post('orgs/:orgId/projects')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Body() body: CreateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.create(user.userId, orgId, body)
  }

  /** GET /orgs/:orgId/projects — List projects in org (RLS-filtered) */
  @Get('orgs/:orgId/projects')
  @UseGuards(JwtAuthGuard)
  listByOrg(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): Promise<ProjectDto[]> {
    return this.projects.listByOrg(user.userId, orgId)
  }

  // ── Project-scoped routes ─────────────────────────────────────────────

  /** GET /projects/:projectId — Get project (member+) */
  @Get('projects/:projectId')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectDto> {
    return this.projects.getById(user.userId, projectId)
  }

  /** PATCH /projects/:projectId — Update project (owner only) */
  @Patch('projects/:projectId')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: UpdateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.update(user.userId, projectId, body)
  }

  /** DELETE /projects/:projectId — Archive project (owner only) */
  @Delete('projects/:projectId')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectDto> {
    return this.projects.archive(user.userId, projectId)
  }

  // ── Project member routes ─────────────────────────────────────────────

  /** POST /projects/:projectId/members — Add member (owner only) */
  @Post('projects/:projectId/members')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  @HttpCode(HttpStatus.CREATED)
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: AddProjectMemberDto,
  ): Promise<ProjectMemberDto> {
    return this.projects.addMember(user.userId, projectId, body)
  }

  /** GET /projects/:projectId/members — List members (member+) */
  @Get('projects/:projectId/members')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectMemberDto[]> {
    return this.projects.listMembers(user.userId, projectId)
  }

  /** PATCH /projects/:projectId/members/:userId — Update role (owner only) */
  @Patch('projects/:projectId/members/:userId')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('userId') targetUserId: string,
    @Body() body: UpdateProjectMemberRoleDto,
  ): Promise<void> {
    return this.projects.updateMemberRole(user.userId, projectId, targetUserId, body)
  }

  /** DELETE /projects/:projectId/members/:userId — Remove member (owner only) */
  @Delete('projects/:projectId/members/:userId')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.projects.removeMember(user.userId, projectId, targetUserId)
  }
}
