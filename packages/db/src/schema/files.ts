import { pgTable, uuid, text, bigint, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { projects, users } from './identity.js'
import { rooms } from './conversations.js'

// -------------------------------------------------------------------------
// FILES  (presigned-upload file registry)
// -------------------------------------------------------------------------
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    declaredMime: text('declared_mime').notNull(),
    detectedMime: text('detected_mime'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    scanStatus: text('scan_status').notNull().default('pending'),
    scanReport: jsonb('scan_report'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_files_project_id').on(t.projectId),
    index('idx_files_uploaded_by').on(t.uploadedBy),
  ],
)
