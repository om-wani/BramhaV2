import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { SignJWT, jwtVerify } from 'jose'
import { ConfigService } from '@nestjs/config'
import type postgres from 'postgres'
import { RlsDbService } from '../common/db/rls-db.service'
import { JwtService } from '../auth/jwt.service'
import { EventPublisher } from '@bramha/event-bus'
import { REDIS_CLIENT } from '../common/redis/redis.module'
import { S3_CLIENT, S3_BUCKET } from '../common/s3/s3.module'
import type Redis from 'ioredis'
import type { CreateArtifactInput, CreateVersionInput } from '@bramha/shared'

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE_CAP_BYTES = 2 * 1024 * 1024 // 2 MB
const RENDER_TOKEN_TTL_SECONDS = 5 * 60 // 5 minutes
const PRESIGNED_URL_TTL_SECONDS = 15 * 60 // 15 minutes
const ISS = 'bramha'
const AUD = 'bramha-api'
const RENDER_TOKEN_TYPE = 'render_token'

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface ArtifactDto {
  id: string
  projectId: string
  conversationId: string | null
  createdByPersona: string | null
  createdByUser: string | null
  kind: string
  title: string
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface ArtifactVersionDto {
  artifactId: string
  version: number
  contentKey: string
  contentSha256: string
  sizeBytes: number
  createdByNode: string | null
  createdAt: string
}

export interface CreateArtifactResult {
  artifact: ArtifactDto
  version: ArtifactVersionDto
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface ArtifactRow {
  id: string
  project_id: string
  conversation_id: string | null
  created_by_persona: string | null
  created_by_user: string | null
  kind: string
  title: string
  current_version: number
  created_at: string
  updated_at: string
}

interface ArtifactVersionRow {
  artifact_id: string
  version: number
  content_key: string
  content_sha256: string
  size_bytes: number
  created_by_node: string | null
  created_at: string
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapArtifact(r: ArtifactRow): ArtifactDto {
  return {
    id: r.id,
    projectId: r.project_id,
    conversationId: r.conversation_id,
    createdByPersona: r.created_by_persona,
    createdByUser: r.created_by_user,
    kind: r.kind,
    title: r.title,
    currentVersion: r.current_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapVersion(r: ArtifactVersionRow): ArtifactVersionDto {
  return {
    artifactId: r.artifact_id,
    version: r.version,
    contentKey: r.content_key,
    contentSha256: r.content_sha256,
    sizeBytes: r.size_bytes,
    createdByNode: r.created_by_node,
    createdAt: r.created_at,
  }
}

type Tx = postgres.TransactionSql

@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name)
  private readonly publisher: EventPublisher

  constructor(
    private readonly db: RlsDbService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(S3_BUCKET) private readonly bucket: string,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.publisher = new EventPublisher(redis)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private computeSha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }

  private s3Key(projectId: string, artifactId: string, version: number): string {
    return `artifacts/${projectId}/${artifactId}/v${version}`
  }

  private async uploadToS3(key: string, content: Buffer): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: 'text/plain; charset=utf-8',
      }),
    )
  }

  private async getJoseKeys(): Promise<{ privateKey: unknown; publicKey: unknown }> {
    // Reuse the keys that JwtService already loaded via importPKCS8 / importSPKI
    // JwtService doesn't expose keys publicly, so we re-derive them here.
    // They are the same Ed25519 key-pair used for session JWTs.
    const { importPKCS8, importSPKI } = await import('jose')
    const privateKeyB64 = this.config.getOrThrow<string>('JWT_PRIVATE_KEY_BASE64')
    const publicKeyB64 = this.config.getOrThrow<string>('JWT_PUBLIC_KEY_BASE64')
    const privateKey = await importPKCS8(Buffer.from(privateKeyB64, 'base64').toString('utf-8'), 'EdDSA')
    const publicKey = await importSPKI(Buffer.from(publicKeyB64, 'base64').toString('utf-8'), 'EdDSA')
    return { privateKey, publicKey }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    projectId: string,
    input: CreateArtifactInput,
  ): Promise<CreateArtifactResult> {
    const buf = Buffer.from(input.content, 'utf-8')
    if (buf.byteLength > SIZE_CAP_BYTES) {
      throw new BadRequestException({ code: 'content_too_large', message: 'Content exceeds 2 MB limit' })
    }
    const sha256 = this.computeSha256(input.content)

    // Generate artifact id up-front so we can use it as part of the S3 key
    const { randomUUID } = await import('node:crypto')
    const artifactId = randomUUID()
    const version = 1
    const key = this.s3Key(projectId, artifactId, version)

    // Upload to S3 before DB insert — on failure the transaction never starts
    await this.uploadToS3(key, buf)

    const result = await this.db.run({ userId, projectId }, async (tx) => {
      const artifactRows = await tx<ArtifactRow[]>`
        INSERT INTO artifacts (id, project_id, conversation_id, created_by_user, kind, title, current_version)
        VALUES (
          ${artifactId}::uuid,
          ${projectId},
          ${input.conversationId ?? null},
          ${userId},
          ${input.kind},
          ${input.title},
          ${version}
        )
        RETURNING id, project_id, conversation_id, created_by_persona, created_by_user,
                  kind, title, current_version, created_at, updated_at
      `
      if (!artifactRows[0]) throw new Error('artifact insert returned no row')

      const versionRows = await tx<ArtifactVersionRow[]>`
        INSERT INTO artifact_versions (artifact_id, version, content_key, content_sha256, size_bytes)
        VALUES (${artifactId}::uuid, ${version}, ${key}, ${sha256}, ${buf.byteLength})
        RETURNING artifact_id, version, content_key, content_sha256, size_bytes, created_by_node, created_at
      `
      if (!versionRows[0]) throw new Error('artifact_version insert returned no row')

      return { artifact: artifactRows[0], version: versionRows[0] }
    })

    this.logger.log({
      event: 'artifact.created',
      actorId: userId,
      artifactId,
      projectId,
      kind: input.kind,
    })

    return {
      artifact: mapArtifact(result.artifact),
      version: mapVersion(result.version),
    }
  }

  // ── Create version ────────────────────────────────────────────────────────

  async createVersion(
    userId: string,
    projectId: string,
    artifactId: string,
    input: CreateVersionInput,
  ): Promise<ArtifactVersionDto> {
    const buf = Buffer.from(input.content, 'utf-8')
    if (buf.byteLength > SIZE_CAP_BYTES) {
      throw new BadRequestException({ code: 'content_too_large', message: 'Content exceeds 2 MB limit' })
    }
    const sha256 = this.computeSha256(input.content)

    const versionDto = await this.db.run({ userId, projectId }, async (tx: Tx) => {
      // Verify artifact exists and belongs to project (RLS handles membership check)
      const artifactRows = await tx<ArtifactRow[]>`
        SELECT id, project_id, conversation_id, created_by_persona, created_by_user,
               kind, title, current_version, created_at, updated_at
        FROM artifacts
        WHERE id = ${artifactId} AND project_id = ${projectId}
      `
      if (!artifactRows[0]) throw new NotFoundException({ code: 'artifact_not_found' })

      const nextVersion = artifactRows[0].current_version + 1
      const key = this.s3Key(projectId, artifactId, nextVersion)

      // Upload before any DB writes
      await this.uploadToS3(key, buf)

      const versionRows = await tx<ArtifactVersionRow[]>`
        INSERT INTO artifact_versions (artifact_id, version, content_key, content_sha256, size_bytes, created_by_node)
        VALUES (
          ${artifactId}::uuid,
          ${nextVersion},
          ${key},
          ${sha256},
          ${buf.byteLength},
          ${input.createdByNodeId ?? null}
        )
        RETURNING artifact_id, version, content_key, content_sha256, size_bytes, created_by_node, created_at
      `
      if (!versionRows[0]) throw new Error('artifact_version insert returned no row')

      // Advance current_version pointer
      await tx`
        UPDATE artifacts SET current_version = ${nextVersion}, updated_at = now()
        WHERE id = ${artifactId}
      `

      return versionRows[0]
    })

    const dto = mapVersion(versionDto)

    this.logger.log({
      event: 'artifact.version_created',
      actorId: userId,
      artifactId,
      version: dto.version,
      projectId,
    })

    // Fire-and-forget publish
    this.publisher
      .publish(`artifact.stream.chunk:${projectId}`, {
        artifactId,
        version: dto.version,
        projectId,
        contentKey: dto.contentKey,
      })
      .catch((err: unknown) => {
        this.logger.error({ event: 'event_publish.failed', channel: 'artifact.stream.chunk', err })
      })

    return dto
  }

  // ── Render token ──────────────────────────────────────────────────────────

  async getRenderToken(
    userId: string,
    projectId: string,
    artifactId: string,
    version: number,
  ): Promise<{ token: string }> {
    // Verify artifact exists and is accessible (RLS enforces membership)
    await this.db.run({ userId, projectId }, async (tx: Tx) => {
      const rows = await tx<{ artifact_id: string }[]>`
        SELECT artifact_id FROM artifact_versions
        WHERE artifact_id = ${artifactId} AND version = ${version}
      `
      if (!rows[0]) throw new NotFoundException({ code: 'version_not_found' })
    })

    const { privateKey } = await this.getJoseKeys()
    const keyId = this.config.get<string>('JWT_KEY_ID', 'key-1')

    const token = await new SignJWT({
      sub: userId,
      artifactId,
      version,
      projectId,
      type: RENDER_TOKEN_TYPE,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: keyId })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime(`${RENDER_TOKEN_TTL_SECONDS}s`)
      .sign(privateKey as Parameters<InstanceType<typeof SignJWT>['sign']>[0])

    return { token }
  }

  // ── Presigned URL ─────────────────────────────────────────────────────────

  async getPresignedUrl(
    userId: string,
    projectId: string,
    artifactId: string,
    version: number,
    renderToken: string,
  ): Promise<{ url: string }> {
    const { publicKey } = await this.getJoseKeys()

    // Verify render token
    let payload: Record<string, unknown>
    try {
      const result = await jwtVerify(renderToken, publicKey as Parameters<typeof jwtVerify>[1], {
        algorithms: ['EdDSA'],
        issuer: ISS,
        audience: AUD,
      })
      payload = result.payload as Record<string, unknown>
    } catch {
      throw new UnauthorizedException({ code: 'invalid_render_token', message: 'Invalid or expired render token' })
    }

    if (payload['type'] !== RENDER_TOKEN_TYPE) {
      throw new UnauthorizedException({ code: 'invalid_render_token', message: 'Token type mismatch' })
    }
    if (payload['artifactId'] !== artifactId) {
      throw new UnauthorizedException({ code: 'invalid_render_token', message: 'Artifact ID mismatch' })
    }
    if (payload['version'] !== version) {
      throw new UnauthorizedException({ code: 'invalid_render_token', message: 'Version mismatch' })
    }
    if (payload['sub'] !== userId) {
      throw new UnauthorizedException({ code: 'invalid_render_token', message: 'User mismatch' })
    }

    const key = this.s3Key(projectId, artifactId, version)
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key })
    const url = await getSignedUrl(this.s3, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS })

    return { url }
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async list(
    userId: string,
    projectId: string,
    conversationId?: string,
  ): Promise<ArtifactDto[]> {
    return this.db.run({ userId, projectId }, async (tx: Tx) => {
      let rows: ArtifactRow[]
      if (conversationId) {
        rows = await tx<ArtifactRow[]>`
          SELECT id, project_id, conversation_id, created_by_persona, created_by_user,
                 kind, title, current_version, created_at, updated_at
          FROM artifacts
          WHERE project_id = ${projectId} AND conversation_id = ${conversationId}
          ORDER BY created_at DESC, id DESC
        `
      } else {
        rows = await tx<ArtifactRow[]>`
          SELECT id, project_id, conversation_id, created_by_persona, created_by_user,
                 kind, title, current_version, created_at, updated_at
          FROM artifacts
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC, id DESC
        `
      }
      return rows.map(mapArtifact)
    })
  }

  // ── Get versions ──────────────────────────────────────────────────────────

  async getVersions(
    userId: string,
    projectId: string,
    artifactId: string,
  ): Promise<ArtifactVersionDto[]> {
    return this.db.run({ userId, projectId }, async (tx: Tx) => {
      // First verify artifact belongs to project (RLS handles membership)
      const artifactRows = await tx<{ id: string }[]>`
        SELECT id FROM artifacts WHERE id = ${artifactId} AND project_id = ${projectId}
      `
      if (!artifactRows[0]) throw new NotFoundException({ code: 'artifact_not_found' })

      const rows = await tx<ArtifactVersionRow[]>`
        SELECT artifact_id, version, content_key, content_sha256, size_bytes, created_by_node, created_at
        FROM artifact_versions
        WHERE artifact_id = ${artifactId}
        ORDER BY version ASC
      `
      return rows.map(mapVersion)
    })
  }
}
