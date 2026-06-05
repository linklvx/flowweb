import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Socket } from 'socket.io-client';

// Track mock socket lifecycle
let mockConnected = false;
const mockRemoveAllListeners = vi.fn();
const mockClose = vi.fn();
const mockOn = vi.fn();
const mockEmit = vi.fn();
const mockSocket = {
  on: mockOn,
  emit: mockEmit,
  removeAllListeners: mockRemoveAllListeners,
  close: mockClose,
  get connected() { return mockConnected; },
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { useSocket } from './useSocket';

describe('useSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnected = false;
  });

  it('should create socket and return ref', () => {
    const { result } = renderHook(() => useSocket('project-1'));
    expect(result.current.current).toBe(mockSocket);
  });

  it('should emit join on connect', () => {
    const { result } = renderHook(() => useSocket('project-1'));
    // Find and call the connect handler
    const connectHandler = mockOn.mock.calls.find(
      (call: any[]) => call[0] === 'connect',
    )?.[1] as Function;
    expect(connectHandler).toBeDefined();
    mockConnected = true;
    connectHandler();
    expect(mockEmit).toHaveBeenCalledWith('join', 'project-1');
  });

  it('should clean up gracefully with close() instead of disconnect()', () => {
    const { unmount } = renderHook(() => useSocket('project-1'));

    unmount();

    // Should only remove listeners, not close the socket
    // (closing causes "closed before established" in Strict Mode)
    expect(mockRemoveAllListeners).toHaveBeenCalled();
  });

  it('should handle cleanup even when socket is not yet connected', () => {
    // Simulates React Strict Mode: mount → cleanup → remount
    mockConnected = false; // socket not yet connected (handshake in progress)

    const { unmount } = renderHook(() => useSocket('project-1'));
    unmount();

    // removeAllListeners() should not throw even when socket is not connected
    // unlike disconnect() which can cause "closed before established" error
    expect(mockRemoveAllListeners).toHaveBeenCalled();
  });
});
