import { getSupabaseRealtimeConfig } from "./supabaseClient";
import type { SupabaseRealtimeConfig } from "./supabaseClient";
import { offlinePresenceStatus } from "./presenceOfflineStatus";
import type { OfflinePresenceReason } from "./presenceOfflineStatus";
import type { PresenceScene } from "./presenceSceneProtocol";
export type { PresenceScene } from "./presenceSceneProtocol";

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

export type WirePlayerPresence = Omit<PlayerPresence, "currentScene"> & {
  currentScene: string;
  currentSceneV2?: PresenceScene;
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

export const PRESENCE_CHANNEL_NAME = "stg-world-zero";
const LOCAL_PLAYER_ID_KEY = "stgWorldZero.playerId";

export function getPersistentPlayerId(): string {
  const existing = globalThis.localStorage.getItem(LOCAL_PLAYER_ID_KEY);
  if (existing) return existing;
  const next = globalThis.crypto?.randomUUID?.() ?? `player-${Math.floor(Math.random() * 1_000_000_000)}`;
  globalThis.localStorage.setItem(LOCAL_PLAYER_ID_KEY, next);
  return next;
}

class OfflinePresenceAdapter implements PresenceAdapter {
  private readonly localPlayerId = getPersistentPlayerId();

  constructor(
    private readonly config: SupabaseRealtimeConfig,
    private readonly error: string,
    private readonly reason: OfflinePresenceReason
  ) {}

  publish(): void {}

  getSnapshot(): PresenceSnapshot {
    const status = offlinePresenceStatus(this.reason);
    return {
      hudStatus: status.hudStatus,
      remotePlayers: [],
      debug: {
        envConfigured: this.config.configured,
        supabaseUrlConfigured: this.config.urlConfigured,
        supabaseAnonKeyConfigured: this.config.anonKeyConfigured,
        mode: "offline",
        channelName: PRESENCE_CHANNEL_NAME,
        channelStatus: status.channelStatus,
        subscribeStatus: status.subscribeStatus,
        lastError: this.error,
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

function offlineAdapter(
  config: SupabaseRealtimeConfig,
  reason: OfflinePresenceReason,
  error?: string
): PresenceAdapter {
  return new OfflinePresenceAdapter(
    config,
    error ?? config.validationError ?? "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY",
    reason
  );
}

export async function createPresenceAdapter(): Promise<PresenceAdapter> {
  const config = getSupabaseRealtimeConfig();
  if (!config.configured || !config.url || !config.anonKey) return offlineAdapter(config, "configuration");

  try {
    const { createRealtimePresenceAdapter } = await import("./realtimePresence");
    return createRealtimePresenceAdapter(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("STG World Zero realtime module failed to load", { error: message });
    return offlineAdapter(config, "load_failure", `Realtime module failed to load: ${message}`);
  }
}
