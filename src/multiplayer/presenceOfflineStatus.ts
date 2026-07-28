export type OfflinePresenceReason = "configuration" | "load_failure";

export type OfflinePresenceStatus = {
  hudStatus: string;
  channelStatus: string;
  subscribeStatus: string;
};

export function offlinePresenceStatus(reason: OfflinePresenceReason): OfflinePresenceStatus {
  if (reason === "load_failure") {
    return {
      hudStatus: "Offline / Realtime Unavailable",
      channelStatus: "load_failed",
      subscribeStatus: "load_failed"
    };
  }
  return {
    hudStatus: "Offline / Missing Env",
    channelStatus: "offline",
    subscribeStatus: "offline"
  };
}
