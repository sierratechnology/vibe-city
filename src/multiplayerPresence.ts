import { RealtimeChannel, SupabaseClient, createClient } from "@supabase/supabase-js";

export type PresenceScene = "outside" | "apartment" | "barA" | "barB" | "sportsBar" | "casino" | "restaurant" | "bookShop" | "musicVenue" | "parkingGarage" | "none";

export type PlayerPresence = {
  playerId: string;
  displayName: string;
  districtId: string;
  currentScene: PresenceScene;
  position: { x: number; z: number };
  facingDirection: number;
  currentArea: string;
  lastSeen: number;
};

export type PresenceSnapshot = {
  mode: "local" | "supabase" | "offline";
  status: string;
  remotePlayers: PlayerPresence[];
};

export type PresenceAdapter = {
  mode: PresenceSnapshot["mode"];
  publish(presence: PlayerPresence): void;
  getSnapshot(now: number): PresenceSnapshot;
  dispose(): void;
};

const PRESENCE_CHANNEL = "vibe-city.presence.v1";
const PRESENCE_STORAGE_KEY = "vibeCity.presence.local";
const REMOTE_TIMEOUT_MS = 12000;

function getSessionId(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `session-${Math.floor(Math.random() * 1_000_000_000)}`;
  return id;
}

function readStoredPresence(): Record<string, PlayerPresence> {
  try {
    return JSON.parse(globalThis.localStorage.getItem(PRESENCE_STORAGE_KEY) ?? "{}") as Record<string, PlayerPresence>;
  } catch {
    return {};
  }
}

function writeStoredPresence(entries: Record<string, PlayerPresence>): void {
  globalThis.localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(entries));
}

class LocalPresenceAdapter implements PresenceAdapter {
  mode: PresenceSnapshot["mode"] = "local";

  private readonly sessionId = getSessionId();

  private readonly channel = "BroadcastChannel" in globalThis ? new BroadcastChannel(PRESENCE_CHANNEL) : null;

  private remotePlayers = new Map<string, PlayerPresence>();

  constructor() {
    this.channel?.addEventListener("message", (event: MessageEvent<PlayerPresence>) => {
      if (!event.data || event.data.playerId === this.sessionId) return;
      this.remotePlayers.set(event.data.playerId, event.data);
    });
  }

  publish(presence: PlayerPresence): void {
    const payload = { ...presence, playerId: this.sessionId };
    this.channel?.postMessage(payload);
    const stored = readStoredPresence();
    stored[payload.playerId] = payload;
    for (const [playerId, entry] of Object.entries(stored)) {
      if (Date.now() - entry.lastSeen > REMOTE_TIMEOUT_MS) delete stored[playerId];
    }
    writeStoredPresence(stored);
  }

  getSnapshot(now: number): PresenceSnapshot {
    const stored = readStoredPresence();
    for (const [playerId, entry] of Object.entries(stored)) {
      if (playerId !== this.sessionId) this.remotePlayers.set(playerId, entry);
    }
    for (const [playerId, entry] of this.remotePlayers) {
      if (now - entry.lastSeen > REMOTE_TIMEOUT_MS) this.remotePlayers.delete(playerId);
    }
    return {
      mode: "local",
      status: "Multiplayer offline / local mode",
      remotePlayers: [...this.remotePlayers.values()]
    };
  }

  dispose(): void {
    const stored = readStoredPresence();
    delete stored[this.sessionId];
    writeStoredPresence(stored);
    this.channel?.close();
  }
}

class OfflinePresenceAdapter implements PresenceAdapter {
  mode: PresenceSnapshot["mode"] = "offline";

  publish(): void {}

  getSnapshot(): PresenceSnapshot {
    return { mode: "offline", status: "Multiplayer offline / local mode", remotePlayers: [] };
  }

  dispose(): void {}
}

class SupabasePresenceAdapter implements PresenceAdapter {
  mode: PresenceSnapshot["mode"] = "supabase";

  private readonly sessionId = getSessionId();

  private readonly client: SupabaseClient;

  private readonly channel: RealtimeChannel;

  private remotePlayers = new Map<string, PlayerPresence>();

  private subscribed = false;

  private lastPresence: PlayerPresence | null = null;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
    this.channel = this.client.channel("vibe-city:district-1", {
      config: { presence: { key: this.sessionId } }
    });
    this.channel.on("presence", { event: "sync" }, () => {
      const state = this.channel.presenceState<PlayerPresence>();
      const next = new Map<string, PlayerPresence>();
      for (const [playerId, entries] of Object.entries(state)) {
        const latest = entries.sort((a, b) => b.lastSeen - a.lastSeen)[0];
        if (latest && playerId !== this.sessionId) next.set(playerId, latest);
      }
      this.remotePlayers = next;
    });
    this.channel.subscribe((status) => {
      this.subscribed = status === "SUBSCRIBED";
      if (this.subscribed && this.lastPresence) void this.channel.track({ ...this.lastPresence, playerId: this.sessionId });
    });
  }

  publish(presence: PlayerPresence): void {
    this.lastPresence = { ...presence, playerId: this.sessionId };
    if (this.subscribed) void this.channel.track(this.lastPresence);
  }

  getSnapshot(now: number): PresenceSnapshot {
    for (const [playerId, entry] of this.remotePlayers) {
      if (now - entry.lastSeen > REMOTE_TIMEOUT_MS) this.remotePlayers.delete(playerId);
    }
    return {
      mode: "supabase",
      status: this.subscribed ? "Multiplayer online / Supabase Realtime" : "Multiplayer connecting / Supabase Realtime",
      remotePlayers: [...this.remotePlayers.values()]
    };
  }

  dispose(): void {
    void this.channel.untrack();
    void this.client.removeChannel(this.channel);
  }
}

export function createPresenceAdapter(): PresenceAdapter {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (supabaseUrl && supabaseKey) {
    return new SupabasePresenceAdapter(supabaseUrl, supabaseKey);
  }
  if ("localStorage" in globalThis) return new LocalPresenceAdapter();
  return new OfflinePresenceAdapter();
}
