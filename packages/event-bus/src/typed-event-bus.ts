import { EventEmitter } from 'node:events';

// Internal server-side events (not WS events)
export type InternalEvent =
  | { type: 'node.created'; projectId: string; roomId: string; nodeId: string; branchId: string }
  | {
      type: 'node.streaming';
      projectId: string;
      roomId: string;
      nodeId: string;
      seq: number;
      text: string;
    }
  | {
      type: 'node.error';
      projectId: string;
      roomId: string;
      nodeId: string;
      code: string;
    }
  | {
      type: 'branch.created';
      projectId: string;
      roomId: string;
      branchId: string;
    }
  | { type: 'file.status'; projectId: string; fileId: string; status: string }
  | {
      type: 'delegation.pending';
      projectId: string;
      roomId: string;
      taskId: string;
      fromPersona: string;
      toPersona: string;
      task: string;
    }
  | {
      type: 'turn.selection';
      projectId: string;
      roomId: string;
      userNodeId: string;
      scores: Array<{ persona: string; score: number; selected: boolean }>;
    };

export type AnyBusEvent = InternalEvent;

export class TypedEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit<T extends AnyBusEvent>(event: T): void {
    this.emitter.emit(event.type, event);
  }

  on<T extends AnyBusEvent['type']>(
    type: T,
    handler: (event: Extract<AnyBusEvent, { type: T }>) => void,
  ): () => void {
    this.emitter.on(type, handler as (e: unknown) => void);
    return () => this.emitter.off(type, handler as (e: unknown) => void);
  }

  once<T extends AnyBusEvent['type']>(
    type: T,
    handler: (event: Extract<AnyBusEvent, { type: T }>) => void,
  ): void {
    this.emitter.once(type, handler as (e: unknown) => void);
  }

  off<T extends AnyBusEvent['type']>(
    type: T,
    handler: (event: Extract<AnyBusEvent, { type: T }>) => void,
  ): void {
    this.emitter.off(type, handler as (e: unknown) => void);
  }
}

// Singleton for use within apps/server
export const eventBus = new TypedEventBus();
