import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { FilesService } from './files.service.js';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard.js';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard.js';
import { UploadTicketGuard } from './upload-ticket.guard.js';
import { signUploadTicket } from './upload-ticket.js';
import type { FileDto } from '@bramha/shared';

type AuthenticatedRequest = FastifyRequest & {
  user: { id: string; email: string; name: string };
  params: Record<string, string>;
};

@Controller('projects/:projectId/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // POST /projects/:projectId/files/ticket — mint a short-lived upload ticket.
  // Session + admin membership checked here (small request, goes via proxy).
  @Post('ticket')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard, ProjectMemberGuard('admin'))
  async uploadTicket(
    @Param('projectId') projectId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ token: string }> {
    return { token: signUploadTicket(req.user.id, projectId) };
  }

  // POST /projects/:projectId/files — multipart upload, authorized by the
  // ticket Bearer so the file can be sent directly to the backend origin
  // (bypassing the proxy's ~4.5 MB body limit).
  @Post()
  @HttpCode(201)
  @UseGuards(UploadTicketGuard)
  async uploadFile(
    @Param('projectId') projectId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<FileDto> {
    // @fastify/multipart is registered on the Fastify instance.
    // We consume the multipart data from the raw request.
    const fastifyReq = req as FastifyRequest & {
      file?: () => Promise<{
        filename: string;
        file: import('stream').Readable & { truncated?: boolean };
        mimetype: string;
      }>;
    };

    // Bug 4 fix: fastifyReq.file is always a function reference, never falsy — removed guard.
    // The `if (!part)` check after await is the correct guard.
    const part = await fastifyReq.file?.();

    if (!part) {
      throw new BadRequestException({ code: 'NO_FILE', title: 'No file uploaded' });
    }

    // Read stream into buffer with per-chunk size guard (Bug 2)
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const MAX = 25 * 1024 * 1024;
    for await (const chunk of part.file) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      totalBytes += buf.length;
      if (totalBytes > MAX) {
        throw new BadRequestException({ code: 'FILE_TOO_LARGE', title: 'File too large' });
      }
      chunks.push(buf);
    }

    // Also check if @fastify/multipart truncated the stream
    if (part.file.truncated) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', title: 'File too large' });
    }

    const buffer = Buffer.concat(chunks);

    return this.filesService.uploadFile({
      projectId,
      userId: req.user.id,
      filename: part.filename,
      buffer,
      size: buffer.length,
    });
  }

  // GET /projects/:projectId/files — list files
  @Get()
  @UseGuards(SessionAuthGuard, ProjectMemberGuard('member'))
  async listFiles(
    @Param('projectId') projectId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<FileDto[]> {
    return this.filesService.listFiles(projectId, req.user.id);
  }

  // DELETE /projects/:projectId/files/:fileId
  @Delete(':fileId')
  @UseGuards(SessionAuthGuard, ProjectMemberGuard('admin'))
  async deleteFile(
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Record<string, never>> {
    await this.filesService.deleteFile(projectId, fileId, req.user.id);
    return {};
  }
}
