import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

import { WS_URL } from './config';
import { api } from './api';
import { useSession } from '@/stores/session';

export type RealtimeEvent = { type: string; data: any; id?: string; ts?: string };
type Handler = (event: RealtimeEvent) => void;

type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting';
export const useRealtimeStatus = create<{ status: Status; set: (s: Status) => void }>((set) => ({
  status: 'idle',
  set: (status) => set({ status }),
}));

const PING_MS = 25_000;
const MAX_BACKOFF = 30_000;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private channels = new Map<string, number>();
  private seen: string[] = [];
  private seenSet = new Set<string>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private wanted = false;
  private ready = false;
  private appState: AppStateStatus = AppState.currentState;

  constructor() {
    AppState.addEventListener('change', (next) => {
      const wasBackground = this.appState !== 'active';
      this.appState = next;
      if (next === 'active' && wasBackground && this.wanted) {
        this.open();
        this.emit({ type: 'client.foreground', data: {} });
      } else if (next !== 'active') {
        // Close when backgrounded: saves battery and stops showing us as online.
        this.teardown();
      }
    });
  }

  start() {
    this.wanted = true;
    this.open();
  }

  stop() {
    this.wanted = false;
    this.teardown();
    this.channels.clear();
    useRealtimeStatus.getState().set('idle');
  }

  private open() {
    if (!this.wanted || this.ws || this.appState !== 'active') return;
    const token = useSession.getState().accessToken;
    if (!token) return;
    useRealtimeStatus.getState().set(this.attempts ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (msg) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (event.type === 'ready') {
        const reconnected = this.attempts > 0;
        this.ready = true;
        this.attempts = 0;
        useRealtimeStatus.getState().set('connected');
        for (const channel of this.channels.keys()) this.rawSend({ type: 'subscribe', channel });
        this.pingTimer = setInterval(() => this.rawSend({ type: 'ping' }), PING_MS);
        if (reconnected) this.emit({ type: 'client.reconnected', data: {} });
        return;
      }
      if (event.type === 'pong') return;
      if (event.id) {
        if (this.seenSet.has(event.id)) return; // duplicate delivery after reconnect
        this.seenSet.add(event.id);
        this.seen.push(event.id);
        if (this.seen.length > 300) this.seenSet.delete(this.seen.shift()!);
      }
      this.emit(event);
    };
    ws.onclose = async (e) => {
      const wasThis = this.ws === ws;
      this.clearTimers();
      if (wasThis) this.ws = null;
      this.ready = false;
      if (!this.wanted || !wasThis) return;
      if (e.code === 4401) {
        // Access token expired: any authenticated call triggers a refresh, then we retry.
        try {
          await api('/me');
        } catch {
          /* handled by api() */
        }
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect() {
    if (!this.wanted || this.retryTimer) return;
    this.attempts += 1;
    useRealtimeStatus.getState().set('reconnecting');
    const delay = Math.min(MAX_BACKOFF, 1000 * 2 ** Math.min(this.attempts, 5)) * (0.7 + Math.random() * 0.6);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private teardown() {
    this.clearTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    ws?.close();
  }

  private rawSend(payload: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  /** Send only once authenticated; returns false if not connected (callers can fall back to REST). */
  send(payload: object): boolean {
    if (!this.ready) return false;
    this.rawSend(payload);
    return true;
  }

  subscribe(channel: string): () => void {
    const count = this.channels.get(channel) ?? 0;
    this.channels.set(channel, count + 1);
    if (count === 0 && this.ready) this.rawSend({ type: 'subscribe', channel });
    return () => {
      const n = (this.channels.get(channel) ?? 1) - 1;
      if (n <= 0) {
        this.channels.delete(channel);
        if (this.ready) this.rawSend({ type: 'unsubscribe', channel });
      } else {
        this.channels.set(channel, n);
      }
    };
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private emit(event: RealtimeEvent) {
    this.handlers.get(event.type)?.forEach((h) => h(event));
    this.handlers.get('*')?.forEach((h) => h(event));
  }
}

export const realtime = new RealtimeClient();
