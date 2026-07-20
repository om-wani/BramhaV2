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

// Persona relevance score (emitted in turn:selection)
// WS-level summary score — web client only needs these 3 fields for the council panel
export interface PersonaScore {
  persona: PersonaSlug;
  score: number;
  selected: boolean;
}
