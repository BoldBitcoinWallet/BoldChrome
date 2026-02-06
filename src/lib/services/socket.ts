import { io, type Socket } from 'socket.io-client';
import { writable } from 'svelte/store';

export interface DeviceConfig {
  deviceId: string;
  deviceType: 'chrome-extension';
  deviceName: string;
  version: string;
}

export interface ConnectionState {
  connected: boolean;
  error?: string;
  lastHeartbeat?: number;
  reconnectAttempts?: number;
}

let socket: Socket | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const RECONNECT_DELAYS = [1000, 3000, 5000, 10000, 15000]; // exponential backoff
const MAX_RECONNECT_ATTEMPTS = 5;

// Store for connection state
export const connectionState = writable<ConnectionState>({
  connected: false
});

/**
 * Initialize WebSocket connection to backend
 */
export async function initializeSocket(deviceConfig: DeviceConfig): Promise<Socket> {
  if (socket?.connected) {
    console.log('[Socket] Already connected');
    return socket;
  }

  // Get backend URL from environment or fallback
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';

  console.log('[Socket] Initializing connection to:', backendUrl);

  socket = io(backendUrl, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    reconnectionAttempts: Infinity,
    transports: ['websocket', 'polling'],
    autoConnect: false,
  });

  // Connection events
  socket.on('connect', () => {
    console.log('[Socket] Connected with ID:', socket?.id);

    // Send device identification
    socket?.emit('extension:identify', {
      deviceId: deviceConfig.deviceId,
      deviceName: deviceConfig.deviceName,
      deviceType: deviceConfig.deviceType,
      version: deviceConfig.version,
    });

    reconnectAttempts = 0;
    connectionState.set({
      connected: true,
      error: undefined,
      reconnectAttempts: 0
    });

    // Start heartbeat
    startHeartbeat();
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
    connectionState.set({
      connected: false,
      error: reason
    });
    stopHeartbeat();
  });

  socket.on('connect_error', (error: any) => {
    console.error('[Socket] Connection error:', error);
    connectionState.set({
      connected: false,
      error: error.message || 'Connection error'
    });
  });

  socket.on('reconnect_attempt', () => {
    reconnectAttempts++;
    console.log(`[Socket] Reconnection attempt ${reconnectAttempts}`);
    connectionState.update(state => ({
      ...state,
      reconnectAttempts
    }));
  });

  socket.on('pong', () => {
    // Update heartbeat timestamp
    connectionState.update(state => ({
      ...state,
      lastHeartbeat: Date.now()
    }));
  });

  // Connect to backend
  socket.connect();

  return socket;
}

/**
 * Start heartbeat timer
 */
function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  heartbeatInterval = setInterval(() => {
    if (socket?.connected) {
      // Server expects a simple 'heartbeat' event
      socket.emit('heartbeat');
      // Update local heartbeat timestamp so UI can show last activity
      connectionState.update(state => ({
        ...state,
        lastHeartbeat: Date.now()
      }));
    }
  }, HEARTBEAT_INTERVAL);

  console.log('[Socket] Heartbeat started');
}

/**
 * Stop heartbeat timer
 */
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  console.log('[Socket] Heartbeat stopped');
}

/**
 * Get the current socket instance
 */
export function getSocket(): Socket {
  if (!socket) {
    throw new Error('Socket not initialized. Call initializeSocket first.');
  }
  return socket;
}

/**
 * Check if socket is connected
 */
export function isConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Disconnect and cleanup
 */
export function disconnect() {
  if (socket) {
    stopHeartbeat();
    socket.disconnect();
    socket = null;
  }
  console.log('[Socket] Disconnected and cleaned up');
}

/**
 * Register event listener
 */
export function on(event: string, callback: (...args: any[]) => void) {
  if (!socket) throw new Error('Socket not initialized');
  socket.on(event, callback);
}

/**
 * Unregister event listener
 */
export function off(event: string, callback?: (...args: any[]) => void) {
  if (!socket) return;
  socket.off(event, callback);
}

/**
 * Emit event to backend
 */
export function emit(event: string, data?: any) {
  if (!socket?.connected) {
    console.warn('[Socket] Not connected, cannot emit:', event);
    return;
  }
  socket.emit(event, data);
}

/**
 * Emit with callback
 */
export function emitWithAck(event: string, data?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Socket not connected'));
      return;
    }
    socket.emit(event, data, (response: any) => {
      resolve(response);
    });
  });
}
