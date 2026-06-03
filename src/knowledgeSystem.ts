import { Citizen } from "./citizenData";
import { WorldTimeState } from "./worldTime";

export type KnowledgeType = "citizen" | "place" | "business" | "schedule" | "event" | "rumor" | "job" | "relationship";

export type KnowledgeItem = {
  id: string;
  type: KnowledgeType;
  title: string;
  description: string;
  sourceCitizenId: string | null;
  confidence: number;
  discoveredAtWorldTime: number;
  expiresAtWorldTime?: number;
  tags: string[];
};

const KNOWLEDGE_STORAGE_PREFIX = "vibeCity.knowledge.";
const PLAYER_JOURNAL_KEY = "vibeCity.playerKnowledgeJournal";

export const KNOWLEDGE_LIBRARY: KnowledgeItem[] = [
  {
    id: "rumor-dealer-rotation",
    type: "rumor",
    title: "Dealer Rotation",
    description: "The casino manager rotates dealers every few hours.",
    sourceCitizenId: "olivia-grant",
    confidence: 78,
    discoveredAtWorldTime: 0,
    tags: ["casino", "dealer", "schedule"]
  },
  {
    id: "rumor-bar-a-after-nine",
    type: "rumor",
    title: "Bar A Late Crowd",
    description: "Bar A gets busier after 9 PM.",
    sourceCitizenId: "marcus-reed",
    confidence: 72,
    discoveredAtWorldTime: 0,
    tags: ["bar", "barA", "event"]
  },
  {
    id: "rumor-book-shop-regulars",
    type: "rumor",
    title: "Book Shop Regulars",
    description: "The book shop owner knows a lot of regulars.",
    sourceCitizenId: "hannah-booker",
    confidence: 66,
    discoveredAtWorldTime: 0,
    tags: ["bookShop", "people"]
  },
  {
    id: "rumor-parking-garage-districts",
    type: "rumor",
    title: "Parking Garage Routes",
    description: "The parking garage connects to other districts, but those routes are not open yet.",
    sourceCitizenId: null,
    confidence: 82,
    discoveredAtWorldTime: 0,
    tags: ["parkingGarage", "district", "portal"]
  },
  {
    id: "rumor-casino-overnights",
    type: "rumor",
    title: "Overnight Casino Staff",
    description: "Some casino staff work overnight shifts.",
    sourceCitizenId: "maya-cross",
    confidence: 80,
    discoveredAtWorldTime: 0,
    tags: ["casino", "schedule", "overnight"]
  },
  {
    id: "place-bar-a",
    type: "place",
    title: "Bar A",
    description: "A neighborhood bar on the Fremont East strip.",
    sourceCitizenId: null,
    confidence: 100,
    discoveredAtWorldTime: 0,
    tags: ["bar", "place"]
  },
  {
    id: "place-casino",
    type: "place",
    title: "Casino",
    description: "A 24-hour casino with table games, slots, security, cage, and restaurant lease space.",
    sourceCitizenId: null,
    confidence: 100,
    discoveredAtWorldTime: 0,
    tags: ["casino", "place"]
  },
  {
    id: "place-parking-garage",
    type: "place",
    title: "Parking Garage",
    description: "The district portal for off-district travel.",
    sourceCitizenId: null,
    confidence: 100,
    discoveredAtWorldTime: 0,
    tags: ["parkingGarage", "place", "portal"]
  },
  {
    id: "business-casino-restaurant-lease",
    type: "business",
    title: "Casino Restaurant Lease Space",
    description: "A restaurant business operates inside the casino as a leased space.",
    sourceCitizenId: "grace-holland",
    confidence: 86,
    discoveredAtWorldTime: 0,
    tags: ["restaurant", "casino", "lease"]
  }
];

const knowledgeById = new Map(KNOWLEDGE_LIBRARY.map((item) => [item.id, item]));

export function registerKnowledgeItem(item: KnowledgeItem): KnowledgeItem {
  const existing = knowledgeById.get(item.id);
  if (existing) return existing;
  knowledgeById.set(item.id, item);
  KNOWLEDGE_LIBRARY.push(item);
  return item;
}

export function getKnowledgeItem(id: string): KnowledgeItem | null {
  return knowledgeById.get(id) ?? null;
}

export function knowledgeItemsForIds(ids: string[]): KnowledgeItem[] {
  return ids.map(getKnowledgeItem).filter((item): item is KnowledgeItem => item !== null);
}

function loadStringArray(key: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function saveStringArray(key: string, ids: string[]): void {
  window.localStorage.setItem(key, JSON.stringify(Array.from(new Set(ids))));
}

export function loadCitizenKnowledge(citizenId: string): string[] {
  return loadStringArray(`${KNOWLEDGE_STORAGE_PREFIX}${citizenId}`);
}

export function persistCitizenKnowledge(citizen: Citizen): void {
  saveStringArray(`${KNOWLEDGE_STORAGE_PREFIX}${citizen.id}`, citizen.knownKnowledgeIds);
}

export function loadPlayerKnowledgeJournal(): string[] {
  return loadStringArray(PLAYER_JOURNAL_KEY);
}

export function persistPlayerKnowledgeJournal(ids: string[]): void {
  saveStringArray(PLAYER_JOURNAL_KEY, ids);
}

export function rememberPlayerKnowledge(existingIds: string[], knowledgeId: string): string[] {
  if (existingIds.includes(knowledgeId)) return existingIds;
  const next = [...existingIds, knowledgeId];
  persistPlayerKnowledgeJournal(next);
  return next;
}

export function addCitizenKnowledge(citizen: Citizen, knowledgeId: string): boolean {
  const item = getKnowledgeItem(knowledgeId);
  if (!item || citizen.knownKnowledgeIds.includes(knowledgeId)) return false;
  citizen.knownKnowledgeIds.push(knowledgeId);
  if (item.type === "rumor" && !citizen.knownRumorIds.includes(knowledgeId)) citizen.knownRumorIds.push(knowledgeId);
  persistCitizenKnowledge(citizen);
  return true;
}

export function seedCitizenKnowledge(citizens: Citizen[]): void {
  for (const person of citizens) {
    registerKnowledgeItem({
      id: `citizen-${person.id}`,
      type: "citizen",
      title: person.name,
      description: `${person.name} is currently known around the district as ${person.role}.`,
      sourceCitizenId: person.id,
      confidence: 92,
      discoveredAtWorldTime: 0,
      tags: ["citizen", person.role.toLowerCase().replaceAll(" ", "-")]
    });
  }

  for (const citizen of citizens) {
    const persisted = loadCitizenKnowledge(citizen.id);
    citizen.knownKnowledgeIds = Array.from(new Set([...citizen.knownKnowledgeIds, ...persisted]));

    const seedIds = new Set<string>();
    for (const shift of citizen.schedule) {
      registerKnowledgeItem({
        id: `job-${citizen.id}`,
        type: "job",
        title: `${citizen.name}'s Job`,
        description: `${citizen.name} works as ${shift.role} at ${shift.businessId}.`,
        sourceCitizenId: citizen.id,
        confidence: 100,
        discoveredAtWorldTime: 0,
        tags: ["job", shift.businessId, shift.role.toLowerCase().replaceAll(" ", "-")]
      });
      seedIds.add(`job-${citizen.id}`);
      if (shift.businessId === "bar-a-business") {
        seedIds.add("place-bar-a");
        seedIds.add("rumor-bar-a-after-nine");
      }
      if (shift.businessId === "casino-business") {
        seedIds.add("place-casino");
        seedIds.add("rumor-casino-overnights");
      }
      if (shift.businessId === "casino-restaurant-operator") {
        seedIds.add("business-casino-restaurant-lease");
      }
    }

    for (const knownCitizenId of citizen.knownCitizens) {
      seedIds.add(`citizen-${knownCitizenId}`);
    }
    if (citizen.supervisor) seedIds.add(`citizen-${citizen.supervisor}`);

    if (citizen.role.includes("Manager")) {
      seedIds.add("rumor-dealer-rotation");
      seedIds.add("rumor-parking-garage-districts");
    }
    if (citizen.id === "hannah-booker") seedIds.add("rumor-book-shop-regulars");
    if (citizen.home === "off_district") seedIds.add("place-parking-garage");

    for (const id of seedIds) addCitizenKnowledge(citizen, id);
    citizen.knownRumorIds = citizen.knownKnowledgeIds.filter((id) => getKnowledgeItem(id)?.type === "rumor");
    persistCitizenKnowledge(citizen);
  }
}

export function chooseShareableKnowledge(from: Citizen, to: Citizen, worldTime: WorldTimeState, includePrivate = false): KnowledgeItem | null {
  const relationship = from.relationships[to.id]?.score ?? 0;
  const chance = 0.25 + Math.max(0, relationship) / 180 - Math.max(0, -relationship) / 280;
  const seed = `${from.id}:${to.id}:${Math.floor(worldTime.absoluteMinutes / 9)}:${from.knownKnowledgeIds.length}`;
  const roll = deterministicUnit(seed);
  if (roll > Math.max(0.05, Math.min(0.8, chance))) return null;

  const knownByReceiver = new Set(to.knownKnowledgeIds);
  const candidates = knowledgeItemsForIds([...from.knownKnowledgeIds, ...(includePrivate ? from.privateKnowledgeIds : [])]).filter((item) => !knownByReceiver.has(item.id));
  if (!candidates.length) return null;
  return candidates[Math.floor(deterministicUnit(`${seed}:pick`) * candidates.length)];
}

export function shareKnowledge(from: Citizen, to: Citizen, item: KnowledgeItem, worldTime: WorldTimeState): boolean {
  const relationship = from.relationships[to.id]?.score ?? 0;
  const confidenceShift = Math.round((deterministicUnit(`${from.id}:${to.id}:${item.id}:${worldTime.seasonDay}`) - 0.5) * 10 + relationship / 35);
  const learned = addCitizenKnowledge(to, item.id);
  if (learned) {
    to.lastSharedKnowledgeId = item.id;
    to.recentKnowledgeReceived = [`${item.title} from ${from.name}`, ...to.recentKnowledgeReceived].slice(0, 5);
    from.lastSharedKnowledgeId = item.id;
    item.confidence = Math.max(0, Math.min(100, item.confidence + confidenceShift));
    persistCitizenKnowledge(to);
  }
  return learned;
}

function deterministicUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
