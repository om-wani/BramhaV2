import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { z } from 'zod';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminService } from './admin.service.js';
import { FeedbackService } from '../feedback/feedback.service.js';
import type { AdminFeedbackRow } from '../feedback/feedback.service.js';

const SetAdminSchema = z.object({ isAdmin: z.boolean() });
type SetAdminInput = z.infer<typeof SetAdminSchema>;

@Controller('admin')
@UseGuards(SessionAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly feedbackService: FeedbackService,
  ) {}

  @Get('overview')
  async overview(): Promise<{ tables: string[]; counts: Record<string, number> }> {
    return { tables: this.adminService.tableNames(), counts: await this.adminService.overview() };
  }

  @Get('feedback')
  async feedback(): Promise<AdminFeedbackRow[]> {
    return this.feedbackService.listAll();
  }

  @Get('tables/:name')
  async table(
    @Param('name') name: string,
    @Query('limit') limit?: string,
  ): Promise<Record<string, unknown>[]> {
    const n = limit ? Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000) : 200;
    return this.adminService.listTable(name, n);
  }

  @Delete('tables/:name/:id')
  @HttpCode(200)
  async deleteRow(
    @Param('name') name: string,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.adminService.deleteRow(name, id);
    return { deleted: true };
  }

  @Post('users/:id/admin')
  @HttpCode(200)
  async setAdmin(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetAdminSchema)) body: SetAdminInput,
  ): Promise<{ ok: true }> {
    await this.adminService.setUserAdmin(id, body.isAdmin);
    return { ok: true };
  }
}
