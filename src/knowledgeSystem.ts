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

const KNOWLEDGE_STORAGE_PREFIX = "stgWorldZero.knowledge.";
const PLAYER_JOURNAL_KEY = "stgWorldZero.playerKnowledgeJournal";

export const KNOWLEDGE_LIBRARY: KnowledgeItem[] = [
  {
    id: "place-stg-headquarters",
    type: "place",
    title: "STG Headquarters",
    description: "World Zero's first single-story headquarters building.",
    sourceCitizenId: null,
    confidence: 100,
    discoveredAtWorldTime: 0,
    tags: ["stg", "headquarters", "world-zero"]
  },
  {
    id: "business-stg-headquarters-operations",
    type: "business",
    title: "STG Headquarters Operations",
    description: "The active operating base for Devon, the executive assistant, project updates, meetings, and decisions.",
    sourceCitizenId: "agent_exec_assistant_001",
    confidence: 100,
    discoveredAtWorldTime: 0,
    tags: ["stg", "operations", "assistant"]
  },
  {
    id: "briefing-stg-morning",
    type: "event",
    title: "STG Morning Briefing",
    description: "The Executive Assistant has Devon's STG briefing ready.",
    sourceCitizenId: "agent_exec_assistant_001",
    confidence: 100,
    discoveredAtWorldTime: 0,
    tags: ["briefing", "decisions", "updates"]
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
      title: person.displayName,
      description: `${person.displayName} is ${person.roleTitle} in ${person.department}.`,
      sourceCitizenId: person.id,
      confidence: 100,
      discoveredAtWorldTime: 0,
      tags: ["agent", person.slug, person.agentType]
    });

    registerKnowledgeItem({
      id: `job-${person.id}`,
      type: "job",
      title: `${person.displayName} Role`,
      description: person.responsibilities.join("; "),
      sourceCitizenId: person.id,
      confidence: 100,
      discoveredAtWorldTime: 0,
      tags: ["job", person.assignedBuilding, person.roleTitle.toLowerCase().replaceAll(" ", "-")]
    });

    const persisted = loadCitizenKnowledge(person.id);
    const seedIds = ["place-stg-headquarters", "business-stg-headquarters-operations", "briefing-stg-morning", `citizen-${person.id}`, `job-${person.id}`];
    person.knownKnowledgeIds = Array.from(new Set([...person.knownKnowledgeIds, ...persisted, ...seedIds]));
    person.knownRumorIds = person.knownKnowledgeIds.filter((id) => getKnowledgeItem(id)?.type === "rumor");
    persistCitizenKnowledge(person);
  }
}

export function chooseShareableKnowledge(from: Citizen, to: Citizen, worldTime: WorldTimeState, includePrivate = false): KnowledgeItem | null {
  const knownByReceiver = new Set(to.knownKnowledgeIds);
  const candidates = knowledgeItemsForIds([...from.knownKnowledgeIds, ...(includePrivate ? from.privateKnowledgeIds : [])]).filter((item) => !knownByReceiver.has(item.id));
  if (!candidates.length) return null;
  const seed = `${from.id}:${to.id}:${Math.floor(worldTime.absoluteMinutes / 9)}:${candidates.length}`;
  return candidates[Math.floor(deterministicUnit(`${seed}:pick`) * candidates.length)];
}

export function shareKnowledge(from: Citizen, to: Citizen, item: KnowledgeItem, _worldTime?: WorldTimeState): boolean {
  const learned = addCitizenKnowledge(to, item.id);
  if (learned) {
    to.lastSharedKnowledgeId = item.id;
    to.recentKnowledgeReceived = [`${item.title} from ${from.displayName}`, ...to.recentKnowledgeReceived].slice(0, 5);
    from.lastSharedKnowledgeId = item.id;
    persistCitizenKnowledge(to);
    persistCitizenKnowledge(from);
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
