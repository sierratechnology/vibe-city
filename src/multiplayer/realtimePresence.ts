import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type {
  PlayerPresence,
  PresenceAdapter,
  PresenceDebugState,
  PresenceSnapshot,
  WirePlayerPresence
} from "./presence";
import { legacyCompatibleWireScene, normalizePresenceScene } from "./presenceSceneProtocol";
import type { SupabaseRealtimeConfig } from "./supabaseClient";

const PRESENCE_CHANNEL_NAME = "stg-world-zero";
const LOCAL_PLAYER_ID_KEY = "stgWorldZero.playerId";
const REMOTE_TIMEOUT_MS = 10_000;
const CONNECTING_TIMEOUT_MS = 10_000;

function getPersistentPlayerId(): string {
  const existing = globalThis.localStorage.getItem(LOCAL_PLAYER_ID_KEY);
  if (existing) return existing;
  const next = globalThis.crypto?.randomUUID?.() ?? `player-${Math.floor(Math.random() * 1_000_000_000)}`;
  globalThis.localStorage.setItem(LOCAL_PLAYER_ID_KEY, next);
  return next;
}

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
  private lastPresence: WirePlayerPresence | null = null;

  constructor(client: SupabaseClient) {
    this.client = client;
    console.info("STG World Zero presence channel creating", { channelName: PRESENCE_CHANNEL_NAME });
    this.channel = this.client.channel(PRESENCE_CHANNEL_NAME, {
      config: { presence: { key: this.localPlayerId } }
    });
    console.info("STG World Zero presence channel created", { channelName: PRESENCE_CHANNEL_NAME });
    this.channel.on("presence", { event: "sync" }, () => {
      console.info("STG World Zero presence sync received", { channelName: PRESENCE_CHANNEL_NAME });
      this.syncPresence();
    });
    this.channel.on("presence", { event: "join" }, (payload) => {
      console.info("STG World Zero presence join received", { channelName: PRESENCE_CHANNEL_NAME, payload });
      this.syncPresence();
    });
    this.channel.on("presence", { event: "leave" }, (payload) => {
      console.info("STG World Zero presence leave received", { channelName: PRESENCE_CHANNEL_NAME, payload });
      this.syncPresence();
    });
    this.channel.subscribe((status, error) => {
      console.info("STG World Zero presence subscribe status", { channelName: PRESENCE_CHANNEL_NAME, status, error });
      this.channelStatus = status.toLowerCase();
      this.subscribeStatus = status;

      if (status === "SUBSCRIBED") {
        this.lastError = null;
        if (this.lastPresence) void this.channel.track(this.lastPresence);
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.lastError = formatRealtimeError(error) || status;
        console.error("STG World Zero presence connection error", {
          channelName: PRESENCE_CHANNEL_NAME,
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
    const state = this.channel.presenceState<WirePlayerPresence>();
    const next = new Map<string, PlayerPresence>();
    for (const entries of Object.values(state)) {
      const latest = entries.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!latest || latest.playerId === this.localPlayerId) continue;
      const currentScene = normalizePresenceScene(latest.currentSceneV2 ?? latest.currentScene);
      if (!currentScene) continue;
      next.set(latest.playerId, { ...latest, currentScene });
    }
    this.remotePlayers = next;
    this.lastPresenceSyncAt = Date.now();
  }

  publish(presence: Omit<PlayerPresence, "playerId" | "updatedAt">): void {
    const publicPayload: PlayerPresence = {
      ...presence,
      playerId: this.localPlayerId,
      updatedAt: Date.now()
    };
    const wirePayload: WirePlayerPresence = {
      ...publicPayload,
      currentScene: legacyCompatibleWireScene(publicPayload.currentScene),
      currentSceneV2: publicPayload.currentScene
    };
    this.localDisplayName = publicPayload.displayName;
    this.lastPresence = wirePayload;
    this.lastBroadcastAt = publicPayload.updatedAt;
    if (this.channelStatus === "subscribed") void this.channel.track(wirePayload);
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
        channelName: PRESENCE_CHANNEL_NAME,
        subscribeStatus: this.subscribeStatus,
        channelStatus: this.channelStatus,
        websocketConnected: this.websocketConnected(),
        lastError: this.lastError
      });
    }
    const debug: PresenceDebugState = {
      envConfigured: true,
      supabaseUrlConfigured: true,
      supabaseAnonKeyConfigured: true,
      mode: "realtime",
      channelName: PRESENCE_CHANNEL_NAME,
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
    };
    return {
      hudStatus: connected ? "Connected" : this.lastError ? `Realtime Error: ${this.channelStatus}` : "Connecting",
      remotePlayers,
      debug
    };
  }

  dispose(): void {
    void this.channel.untrack();
    void this.client.removeChannel(this.channel);
  }
}

export function createRealtimePresenceAdapter(config: SupabaseRealtimeConfig): PresenceAdapter {
  if (!config.url || !config.anonKey) throw new Error("Supabase realtime configuration is incomplete");
  const client = createClient(config.url, config.anonKey, {
    realtime: {
      params: {
        eventsPerSecond: 12
      }
    }
  });
  console.info("STG World Zero Supabase client created", { realtimeConfigured: true });
  return new SupabasePresenceAdapter(client);
}
