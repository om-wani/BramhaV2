import { z } from 'zod';
import type { PersonaSlug } from './personas.js';

// Enums
export const AuthorType = z.enum(['user', 'agent', 'system']);
export type AuthorType = z.infer<typeof AuthorType>;

export const RoomKind = z.enum(['council', 'one_on_one']);
export type RoomKind = z.infer<typeof RoomKind>;

export const FileStatus = z.enum(['pending', 'processing', 'ready', 'error']);
export type FileStatus = z.infer<typeof FileStatus>;

export const OrgRole = z.enum(['owner', 'admin', 'member']);
export type OrgRole = z.infer<typeof OrgRole>;

export const ProjectRole = z.enum(['owner', 'editor', 'viewer']);
export type ProjectRole = z.infer<typeof ProjectRole>;

// Conversation node shape (safe to send over wire)
export interface ConversationNodeDto {
  id: string;
  roomId: string;
  projectId: string;
  parentId: string | null;
  authorType: AuthorType;
  userId: string | null;
  persona: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string; // ISO
}

// Branch shape
export interface BranchDto {
  id: string;
  roomId: string;
  projectId: string;
  name: string;
  headNodeId: string | null;
  forkedFromNodeId: string | null;
  createdBy: string;
  createdAt: string;
}

// File DTO — used by files module list/upload responses
export interface FileDto {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  chunkCount: number | null;
  errorMsg: string | null;
  createdAt: string; // ISO
  createdBy: string;
}

// Persona relevance score (emitted in turn:selection)
// WS-level summary score — web client only needs these 3 fields for the council panel
export interface PersonaScore {
  persona: PersonaSlug;
  score: number;
  selected: boolean;
}

// Validated citation from agent response (P4.4)
export interface ValidatedCitation {
  filename: string;
  chunkIndex: number;
  excerpt: string; // first 200 chars of chunk content
  chunkId: string;
  fileId: string;
}

// Knowledge chunk returned by hybrid RRF search (P4.3)
export interface KnowledgeChunk {
  id: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  filename: string;
  score: number; // RRF fused score
}
