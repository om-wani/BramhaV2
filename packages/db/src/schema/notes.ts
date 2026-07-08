import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { projects, users } from './identity.js'

// -------------------------------------------------------------------------
// NOTES
// -------------------------------------------------------------------------
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull().default(''),
    contentJson: jsonb('content_json'),
    folderPath: text('folder_path').notNull().default('/'),
    isDaily: boolean('is_daily').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notes_project').on(t.projectId, t.deletedAt),
    index('idx_notes_folder').on(t.projectId, t.folderPath),
  ],
)

// -------------------------------------------------------------------------
// NOTE_LINKS (backlink graph — wikilink references between notes)
// -------------------------------------------------------------------------
export const noteLinks = pgTable(
  'note_links',
  {
    fromNote: uuid('from_note')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    toNote: uuid('to_note')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.fromNote, t.toNote] }),
    index('idx_note_links_to').on(t.toNote),
  ],
)
