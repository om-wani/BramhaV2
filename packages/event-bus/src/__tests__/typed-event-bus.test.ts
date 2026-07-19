import { describe, it, expect, vi } from 'vitest';
import { TypedEventBus } from '../typed-event-bus.js';

describe('TypedEventBus', () => {
  it('emit + on: handler called with correct event', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();

    bus.on('node.created', handler);
    bus.emit({
      type: 'node.created',
      projectId: 'p1',
      roomId: 'r1',
      nodeId: 'n1',
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: 'node.created',
      projectId: 'p1',
      roomId: 'r1',
      nodeId: 'n1',
    });
  });

  it('on returns unsubscribe fn that stops future emissions', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();

    const unsubscribe = bus.on('node.streaming', handler);

    bus.emit({
      type: 'node.streaming',
      projectId: 'p1',
      roomId: 'r1',
      nodeId: 'n1',
      seq: 1,
      text: 'hello',
    });

    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();

    bus.emit({
      type: 'node.streaming',
      projectId: 'p1',
      roomId: 'r1',
      nodeId: 'n1',
      seq: 2,
      text: 'world',
    });

    // Still only called once — unsubscribed
    expect(handler).toHaveBeenCalledOnce();
  });

  it('different event types do not cross-fire', () => {
    const bus = new TypedEventBus();
    const nodeCreatedHandler = vi.fn();
    const nodeErrorHandler = vi.fn();

    bus.on('node.created', nodeCreatedHandler);
    bus.on('node.error', nodeErrorHandler);

    bus.emit({
      type: 'node.created',
      projectId: 'p1',
      roomId: 'r1',
      nodeId: 'n1',
    });

    expect(nodeCreatedHandler).toHaveBeenCalledOnce();
    expect(nodeErrorHandler).not.toHaveBeenCalled();

    bus.emit({
      type: 'node.error',
      projectId: 'p1',
      roomId: 'r1',
      nodeId: 'n1',
      code: 'ERR_TIMEOUT',
    });

    expect(nodeCreatedHandler).toHaveBeenCalledOnce();
    expect(nodeErrorHandler).toHaveBeenCalledOnce();
  });

  it('once: fires only once', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();

    bus.once('branch.created', handler);

    const event = {
      type: 'branch.created' as const,
      projectId: 'p1',
      roomId: 'r1',
      branchId: 'b1',
    };

    bus.emit(event);
    bus.emit(event);
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('off: removes a listener', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();

    bus.on('file.status', handler);
    bus.emit({ type: 'file.status', projectId: 'p1', fileId: 'f1', status: 'ready' });
    expect(handler).toHaveBeenCalledOnce();

    bus.off('file.status', handler);
    bus.emit({ type: 'file.status', projectId: 'p1', fileId: 'f1', status: 'error' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('turn.selection event carries scores array', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();

    bus.on('turn.selection', handler);
    bus.emit({
      type: 'turn.selection',
      projectId: 'p1',
      roomId: 'r1',
      userNodeId: 'u1',
      scores: [{ persona: 'cto', score: 0.8 }],
    });

    expect(handler).toHaveBeenCalledOnce();
    const received = handler.mock.calls[0]?.[0] as {
      scores: unknown[];
    };
    expect(received.scores).toHaveLength(1);
  });
});
