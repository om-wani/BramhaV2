import type { ConversationNodeDto, BranchDto, FileStatus, PersonaScore } from './dtos.js';

export interface NodeCreatedEvent {
  type: 'node:created';
  node: ConversationNodeDto;
}

export interface NodeDeltaEvent {
  type: 'node:delta';
  nodeId: string;
  seq: number;
  text: string;
}

export interface NodeErrorEvent {
  type: 'node:error';
  nodeId: string;
  code: string;
}

export interface BranchCreatedEvent {
  type: 'branch:created';
  branch: BranchDto;
}

export interface FileStatusEvent {
  type: 'file:status';
  fileId: string;
  status: FileStatus;
}

export interface TurnSelectionEvent {
  type: 'turn:selection';
  userNodeId: string;
  scores: PersonaScore[];
}

export type ServerToClientEvent =
  | NodeCreatedEvent
  | NodeDeltaEvent
  | NodeErrorEvent
  | BranchCreatedEvent
  | FileStatusEvent
  | TurnSelectionEvent;

// Type map for typed Socket.IO — used by both server gateway and web client
export type ServerToClientEvents = {
  [E in ServerToClientEvent as E['type']]: (event: E) => void;
} & {
  'room:joined': (payload: { roomId: string }) => void;
  'error:room': (payload: { code: string }) => void;
};

export type ClientToServerEvents = {
  'room:join': (payload: { projectId: string; roomId: string }) => void;
  'room:leave': (payload: { roomId: string }) => void;
  'project:join': (payload: { projectId: string }) => void;
};
