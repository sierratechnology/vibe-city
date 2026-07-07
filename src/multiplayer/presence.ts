import { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient, getSupabaseRealtimeConfig } from "./supabaseClient";

export type PresenceScene = "outside" | "apartment" | "none";

export type PlayerPresence = {
  playerId: string;
  displayName: string;
  districtId: string;
  x: number;
  y: number;
  z: number;
  facing: number;
  currentScene: PresenceScene;
  currentArea: string;
  updatedAt: number;
};

export type PresenceDebugState = {
  envConfigured: boolean;
  supabaseUrlConfigured: boolean;
  supabaseAnonKeyConfigured: boolean;
  mode: "offline" | "realtime";
  channelName: string;
  channelStatus: string;
  subscribeStatus: string;
  lastError: string | null;
  websocketConnected: boolean;
  localPlayerId: string;
  localDisplayName: string;
  presenceCount: number;
  remotePlayersCount: number;
  lastBroadcastAt: number | null;
  lastPresenceSyncAt: number | null;
  remotePlayers: PlayerPresence[];
};

export type PresenceSnapshot = {
  hudStatus: string;
  remotePlayers: PlayerPresence[];
  debug: PresenceDebugState;
};

export type PresenceAdapter = {
  publish(presence: Omit<PlayerPresence, "playerId" | "updatedAt">): void;
  getSnapshot(now: number): PresenceSnapshot;
  dispose(): void;
};

const CHANNEL_NAME = "stg-world-zero";
const LOCAL_PLAYER_ID_KEY = "stgWorldZero.playerId";
const REMOTE_TIMEOUT_MS = 10_000;
const CONNECTING_TIMEOUT_MS = 10_000;

function formatRealtimeError(error: unknown): string {
  if (!error) return "No error details provided";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function getPersistentPlayerId(): string {
  const existing = globalThis.localStorage.getItem(LOCAL_PLAYER_ID_KEY);
  if (existing) return existing;
  const next = globalThis.crypto?.randomUUID?.() ?? `player-${Math.floor(Math.random() * 1_000_000_000)}`;
  globalThis.localStorage.setItem(LOCAL_PLAYER_ID_KEY, next);
  return next;
}

class MissingEnvPresenceAdapter implements PresenceAdapter {
  private readonly localPlayerId = getPersistentPlayerId();

  private readonly config = getSupabaseRealtimeConfig();

  publish(): void {}

  getSnapshot(): PresenceSnapshot {
    return {
      hudStatus: "Offline / Missing Env",
      remotePlayers: [],
      debug: {
        envConfigured: this.config.configured,
        supabaseUrlConfigured: this.config.urlConfigured,
        supabaseAnonKeyConfigured: this.config.anonKeyConfigured,
        mode: "offline",
        channelName: CHANNEL_NAME,
        channelStatus: "missing_env",
        subscribeStatus: "missing_env",
        lastError: this.config.validationError ?? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY",
        websocketConnected: false,
        localPlayerId: this.localPlayerId,
        localDisplayName: "",
        presenceCount: 1,
        remotePlayersCount: 0,
        lastBroadcastAt: null,
        lastPresenceSyncAt: null,
        remotePlayers: []
      }
    };
  }

  dispose(): void {}
}

class SupabasePresenceAdapter implements PresenceAdapter {
  private readonly localPlayerId = getPersistentPlayerId();

  private readonly client: SupabaseClient;

  private readonly channel: RealtimeChannel;

  private channelStatus = "connecting";

  private subscribeStatus = "connecting";

  private lastError: string | null = null;

  private readonly createdAt = Date.now();

  private localDisplayName = "";

  private remotePlayers = new Map<string, PlayerPresence>();

  private lastBroadcastAt: number | null = null;

  private lastPresenceSyncAt: number | null = null;

  private lastPresence: PlayerPresence | null = null;

  constructor(client: SupabaseClient) {
    this.client = client;
    console.info("STG World Zero presence channel creating", { channelName: CHANNEL_NAME });
    this.channel = this.client.channel(CHANNEL_NAME, {
      config: { presence: { key: this.localPlayerId } }
    });
    console.info("STG World Zero presence channel created", { channelName: CHANNEL_NAME });
    this.channel.on("presence", { event: "sync" }, () => {
      console.info("STG World Zero presence sync received", { channelName: CHANNEL_NAME });
      this.syncPresence();
    });
    this.channel.on("presence", { event: "join" }, (payload) => {
      console.info("STG World Zero presence join received", { channelName: CHANNEL_NAME, payload });
      this.syncPresence();
    });
    this.channel.on("presence", { event: "leave" }, (payload) => {
      console.info("STG World Zero presence leave received", { channelName: CHANNEL_NAME, payload });
      this.syncPresence();
    });
    this.channel.subscribe((status, error) => {
      console.info("STG World Zero presence subscribe status", { channelName: CHANNEL_NAME, status, error });
      this.channelStatus = status.toLowerCase();
      this.subscribeStatus = status;

      if (status === "SUBSCRIBED") {
        this.lastError = null;
        if (this.lastPresence) {
          console.info("STG World Zero presence tracking after subscribed", { channelName: CHANNEL_NAME, playerId: this.localPlayerId });
          void this.channel.track(this.lastPresence);
        }
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.lastError = formatRealtimeError(error) || status;
        console.error("STG World Zero presence connection error", {
          channelName: CHANNEL_NAME,
          status,
          error: this.lastError
        });
      }
    });
  }

  private websocketConnected(): boolean {
    const realtime = this.client.realtime as unknown as { isConnected?: () => boolean };
    return Boolean(realtime.isConnected?.());
  }

  private syncPresence(): void {
    const state = this.channel.presenceState<PlayerPresence>();
    const next = new Map<string, PlayerPresence>();
    for (const entries of Object.values(state)) {
      const latest = entries.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!latest || latest.playerId === this.localPlayerId) continue;
      next.set(latest.playerId, latest);
    }
    this.remotePlayers = next;
    this.lastPresenceSyncAt = Date.now();
  }

  publish(presence: Omit<PlayerPresence, "playerId" | "updatedAt">): void {
    const payload: PlayerPresence = {
      ...presence,
      playerId: this.localPlayerId,
      updatedAt: Date.now()
    };
    this.localDisplayName = payload.displayName;
    this.lastPresence = payload;
    this.lastBroadcastAt = payload.updatedAt;
    if (this.channelStatus === "subscribed") {
      void this.channel.track(payload);
    }
  }

  getSnapshot(now: number): PresenceSnapshot {
    for (const [playerId, presence] of this.remotePlayers) {
      if (now - presence.updatedAt > REMOTE_TIMEOUT_MS) this.remotePlayers.delete(playerId);
    }
    const remotePlayers = [...this.remotePlayers.values()];
    const connected = this.channelStatus === "subscribed";
    if (!connected && !this.lastError && now - this.createdAt > CONNECTING_TIMEOUT_MS) {
      this.lastError = `Still ${this.channelStatus} after ${Math.round((now - this.createdAt) / 1000)}s. Websocket connected: ${this.websocketConnected()}.`;
      console.error("STG World Zero presence stuck connecting", {
        channelName: CHANNEL_NAME,
        subscribeStatus: this.subscribeStatus,
        channelStatus: this.channelStatus,
        websocketConnected: this.websocketConnected(),
        lastError: this.lastError
      });
    }
    return {
      hudStatus: connected ? "Connected" : this.lastError ? `Realtime Error: ${this.channelStatus}` : "Connecting",
      remotePlayers,
      debug: {
        envConfigured: true,
        supabaseUrlConfigured: true,
        supabaseAnonKeyConfigured: true,
        mode: "realtime",
        channelName: CHANNEL_NAME,
        channelStatus: this.channelStatus,
        subscribeStatus: this.subscribeStatus,
        lastError: this.lastError,
        websocketConnected: this.websocketConnected(),
        localPlayerId: this.localPlayerId,
        localDisplayName: this.localDisplayName,
        presenceCount: remotePlayers.length + 1,
        remotePlayersCount: remotePlayers.length,
        lastBroadcastAt: this.lastBroadcastAt,
        lastPresenceSyncAt: this.lastPresenceSyncAt,
        remotePlayers
      }
    };
  }

  dispose(): void {
    void this.channel.untrack();
    void this.client.removeChannel(this.channel);
  }
}

export function createPresenceAdapter(): PresenceAdapter {
  const client = createSupabaseClient();
  if (!client) return new MissingEnvPresenceAdapter();
  return new SupabasePresenceAdapter(client);
}
