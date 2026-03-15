/**
 * useWebSocket Hook
 *
 * Manages WebSocket connection with auto-reconnect.
 * Ported from telcoOS-webapp/client/src/hooks/useWebSocket.ts
 */

import { useRef, useCallback, useEffect, useState } from 'react';

function getWebSocketUrl(path) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}${path}`;
}

function getReconnectDelay(attempt, baseDelay, maxDelay) {
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

export function useWebSocket(path, options = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    autoConnect = true,
    autoReconnect = true,
    maxReconnectAttempts = 5,
    reconnectBaseDelay = 1000,
    reconnectMaxDelay = 30000,
  } = options;

  const [state, setState] = useState('disconnected');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const shouldReconnectRef = useRef(autoReconnect);
  const permanentDisconnectRef = useRef(false);
  const connectRef = useRef(() => {});

  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
  }, [onMessage, onConnect, onDisconnect, onError]);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current || permanentDisconnectRef.current || reconnectAttempts >= maxReconnectAttempts) {
      return;
    }

    const delay = getReconnectDelay(reconnectAttempts, reconnectBaseDelay, reconnectMaxDelay);
    setState('reconnecting');

    reconnectTimeoutRef.current = setTimeout(() => {
      setReconnectAttempts((prev) => prev + 1);
      connectRef.current();
    }, delay);
  }, [reconnectAttempts, maxReconnectAttempts, reconnectBaseDelay, reconnectMaxDelay]);

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    clearReconnectTimeout();
    permanentDisconnectRef.current = false;
    shouldReconnectRef.current = autoReconnect;

    const url = getWebSocketUrl(path);
    setState('connecting');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState('connected');
      setReconnectAttempts(0);
      onConnectRef.current?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.type === 'ping') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
          return;
        }
        onMessageRef.current?.(data);
      } catch (err) {
        console.error(`[WebSocket ${path}] Failed to parse message:`, err);
      }
    };

    ws.onerror = (event) => {
      onErrorRef.current?.(event);
    };

    ws.onclose = (event) => {
      wsRef.current = null;
      setState('disconnected');
      onDisconnectRef.current?.(event);

      if (!permanentDisconnectRef.current && shouldReconnectRef.current) {
        scheduleReconnect();
      }
    };
  }, [path, autoReconnect, clearReconnectTimeout, scheduleReconnect]);

  connectRef.current = connect;

  const disconnect = useCallback((permanent = false) => {
    if (permanent) {
      permanentDisconnectRef.current = true;
      shouldReconnectRef.current = false;
    }
    clearReconnectTimeout();
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }
    setState('disconnected');
  }, [clearReconnectTimeout]);

  const send = useCallback((data) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
    try {
      wsRef.current.send(JSON.stringify(data));
      return true;
    } catch (err) {
      console.error(`[WebSocket ${path}] Failed to send:`, err);
      return false;
    }
  }, [path]);

  useEffect(() => {
    if (autoConnect) connect();
    return () => {
      permanentDisconnectRef.current = true;
      shouldReconnectRef.current = false;
      clearReconnectTimeout();
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmount');
        wsRef.current = null;
      }
    };
  }, [autoConnect, connect, clearReconnectTimeout]);

  return {
    state,
    reconnectAttempts,
    send,
    connect,
    disconnect,
    isConnected: state === 'connected',
  };
}

export default useWebSocket;
