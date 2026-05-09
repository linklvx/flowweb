import React, { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

export function useSocket(projectId: string): React.MutableRefObject<Socket | null> {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io('/execution', {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', projectId);
    });

    return () => {
      socket.disconnect();
    };
  }, [projectId]);

  return socketRef;
}
