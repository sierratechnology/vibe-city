import { RelationshipLabel, relationshipLabel } from "./citizenData";

export type PlayerKnowledgeEntry = {
  knowledgeId: string;
  sourceCitizenId: string | null;
  learnedAtWorldTime: number;
};

export type PlayerMessage = {
  id: string;
  title: string;
  body: string;
  createdAtWorldTime: number;
  category: "system" | "contact" | "knowledge";
};

export type PlayerProfile = {
  playerId: string;
  displayName: string;
  wallet: number;
  reputationStars: number;
  influence: number;
  homeBuildingId: string;
  knownCitizenIds: string[];
  relationshipByCitizenId: Record<string, number>;
  lastTalkHourByCitizenId: Record<string, number>;
  knowledgeJournal: PlayerKnowledgeEntry[];
  interests: string[];
  messages: PlayerMessage[];
};

const PROFILE_KEY = "vibeCity.playerProfile";

export function createDefaultPlayerProfile(displayName = "Player"): PlayerProfile {
  return {
    playerId: "local-player",
    displayName: displayName.trim() || "Player",
    wallet: 2000,
    reputationStars: 0,
    influence: 0,
    homeBuildingId: "apartment-building",
    knownCitizenIds: [],
    relationshipByCitizenId: {},
    lastTalkHourByCitizenId: {},
    knowledgeJournal: [],
    interests: ["nightlife", "music", "food"],
    messages: [
      {
        id: "welcome-message",
        title: "Welcome to District 1",
        body: "Your phone will collect contacts, messages, and knowledge as you meet people.",
        createdAtWorldTime: 0,
        category: "system"
      }
    ]
  };
}

export function loadPlayerProfile(): PlayerProfile | null {
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
    const fallback = createDefaultPlayerProfile(parsed.displayName);
    return {
      ...fallback,
      ...parsed,
      wallet: Number.isFinite(parsed.wallet) ? Number(parsed.wallet) : fallback.wallet,
      reputationStars: Number.isFinite(parsed.reputationStars) ? Number(parsed.reputationStars) : fallback.reputationStars,
      influence: Number.isFinite(parsed.influence) ? Number(parsed.influence) : fallback.influence,
      knownCitizenIds: Array.isArray(parsed.knownCitizenIds) ? parsed.knownCitizenIds : [],
      relationshipByCitizenId: parsed.relationshipByCitizenId ?? {},
      lastTalkHourByCitizenId: parsed.lastTalkHourByCitizenId ?? {},
      knowledgeJournal: Array.isArray(parsed.knowledgeJournal) ? parsed.knowledgeJournal : [],
      interests: Array.isArray(parsed.interests) ? parsed.interests : fallback.interests,
      messages: Array.isArray(parsed.messages) ? parsed.messages : fallback.messages
    };
  } catch {
    return null;
  }
}

export function savePlayerProfile(profile: PlayerProfile): void {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function resetPlayerProfile(): void {
  window.localStorage.removeItem(PROFILE_KEY);
}

export function relationshipForCitizen(profile: PlayerProfile, citizenId: string): number {
  return profile.relationshipByCitizenId[citizenId] ?? 0;
}

export function relationshipLabelForCitizen(profile: PlayerProfile, citizenId: string): RelationshipLabel {
  return relationshipLabel(relationshipForCitizen(profile, citizenId));
}

export function addContact(profile: PlayerProfile, citizenId: string): boolean {
  if (!profile.knownCitizenIds.includes(citizenId)) {
    profile.knownCitizenIds.push(citizenId);
    profile.relationshipByCitizenId[citizenId] ??= 0;
    savePlayerProfile(profile);
    return true;
  }
  profile.relationshipByCitizenId[citizenId] ??= 0;
  savePlayerProfile(profile);
  return false;
}

export function addPlayerMessage(profile: PlayerProfile, title: string, body: string, createdAtWorldTime: number, category: PlayerMessage["category"] = "system"): void {
  const id = `${category}:${title}:${Math.floor(createdAtWorldTime)}:${profile.messages.length}`;
  if (profile.messages.some((message) => message.title === title && message.body === body)) return;
  profile.messages.unshift({ id, title, body, createdAtWorldTime, category });
  profile.messages = profile.messages.slice(0, 40);
  savePlayerProfile(profile);
}

export function adjustPlayerCitizenRelationship(profile: PlayerProfile, citizenId: string, delta: number): number {
  const next = Math.max(-100, Math.min(100, Math.round((profile.relationshipByCitizenId[citizenId] ?? 0) + delta)));
  profile.relationshipByCitizenId[citizenId] = next;
  savePlayerProfile(profile);
  return next;
}

export function canGainTalkRelationship(profile: PlayerProfile, citizenId: string, absoluteMinutes: number): boolean {
  const hour = Math.floor(absoluteMinutes / 60);
  return profile.lastTalkHourByCitizenId[citizenId] !== hour;
}

export function markTalkRelationship(profile: PlayerProfile, citizenId: string, absoluteMinutes: number): void {
  profile.lastTalkHourByCitizenId[citizenId] = Math.floor(absoluteMinutes / 60);
  savePlayerProfile(profile);
}

export function rememberKnowledge(profile: PlayerProfile, knowledgeId: string, sourceCitizenId: string | null, learnedAtWorldTime: number): boolean {
  if (profile.knowledgeJournal.some((entry) => entry.knowledgeId === knowledgeId)) return false;
  profile.knowledgeJournal.push({ knowledgeId, sourceCitizenId, learnedAtWorldTime });
  savePlayerProfile(profile);
  return true;
}

export function resetCitizenPersistence(): void {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith("vibeCity.social.") || key?.startsWith("vibeCity.knowledge.") || key?.startsWith("vibeCity.wallet.") || key?.startsWith("vibeCity.paidShifts.")) {
      keys.push(key);
    }
  }
  for (const key of keys) window.localStorage.removeItem(key);
}

export function resetWorldTimePersistence(): void {
  window.localStorage.removeItem("vibeCity.seasonStartTimestamp");
  window.localStorage.removeItem("vibeCity.debugWorldMinuteOffset");
}
