import { DAY_NAMES, dayIndexForName } from "./worldTime";

export type CitizenMood = "friendly" | "neutral" | "rushed" | "tired" | "annoyed" | "distracted" | "lonely" | "stressed";
export type CitizenState =
  | "home"
  | "off_district"
  | "walking_to_work"
  | "walking_to_workstation"
  | "working"
  | "on_break"
  | "leaving_building"
  | "walking_home"
  | "walking_to_destination"
  | "socializing"
  | "idle";
export type CitizenScene = "outside" | "headquarters" | "none";
export type RelationshipLabel = "close friend" | "friend" | "friendly" | "neutral" | "tense" | "disliked" | "enemy";
export type CitizenInterest = "executive support" | "project updates" | "meetings" | "decisions" | "agent coordination";

export type AgentProfile = {
  id: string;
  slug: string;
  displayName: string;
  preferredName: string;
  agentType: string;
  department: string;
  roleTitle: string;
  rank: string;
  status: string;
  currentLocation: string;
  homeOffice: string;
  assignedBuilding: string;
  assignedWorld: string;
  reportsTo: string;
  skills: string[];
  tools: string[];
  responsibilities: string[];
  permissions: string[];
  workSchedule: string[];
  shiftStatus: string;
  socialSchedule: string[];
  meetingAvailability: string[];
  currentTask: string[];
  activeProjects: string[];
  watchingRepos: string[];
  watchingDevices: string[];
  memoryScope: string[];
  personality: string[];
  communicationStyle: string[];
  greetingScript: string[];
  briefingSources: string[];
  decisionQueue: string[];
  createdAt: string;
  updatedAt: string;
};

export type CitizenRelationship = {
  citizenId: string;
  score: number;
  label: RelationshipLabel;
  tags: string[];
};

export type CitizenNeeds = {
  energy: number;
  hunger: number;
  social: number;
  moneyStress: number;
};

export type CitizenSocialInteraction = {
  partnerId: string;
  topic: string;
  endsAtAbsoluteMinute: number;
  relationshipDelta: number;
};

export type CitizenShift = {
  id: string;
  days: number[];
  startMinute: number;
  endMinute: number;
  role: string;
  businessId: string;
  buildingId: string;
  portalId: string;
  scene: CitizenScene;
  workstationId: string;
  hourlyWage: number;
};

export type Citizen = AgentProfile & {
  name: string;
  home: "home" | "off_district";
  interests: CitizenInterest[];
  wallet: number;
  relationshipToPlayer: number;
  relationships: Record<string, CitizenRelationship>;
  knownCitizens: string[];
  knownPlaces: string[];
  knownBusinesses: string[];
  knownRumors: string[];
  knownKnowledgeIds: string[];
  knownRumorIds: string[];
  privateKnowledgeIds: string[];
  lastSharedKnowledgeId: string | null;
  recentKnowledgeReceived: string[];
  family: string[];
  friends: string[];
  coworkers: string[];
  supervisor: string | null;
  subordinates: string[];
  acquaintances: string[];
  needs: CitizenNeeds;
  moodReason: string;
  currentSocialInteraction: CitizenSocialInteraction | null;
  role: string;
  currentMood: CitizenMood;
  currentState: CitizenState;
  currentScene: CitizenScene;
  currentDestination: string | null;
  currentWorkstationId: string | null;
  memories: string[];
  knownFacts: string[];
  schedule: CitizenShift[];
  position: { x: number; z: number };
  homePosition: { x: number; z: number };
  offDistrictEntryPortalId: string;
  routeWaypoints: Array<{ x: number; z: number }>;
  wasLateToday: boolean;
  delayMinutes: number;
  activeShiftKey: string | null;
  paidShiftKeys: string[];
};

function minutes(hour: number, minute = 0): number {
  return hour * 60 + minute;
}

function days(...names: Array<(typeof DAY_NAMES)[number]>): number[] {
  return names.map(dayIndexForName);
}

function daily(): number[] {
  return [0, 1, 2, 3, 4, 5, 6];
}

export function relationshipLabel(score: number): RelationshipLabel {
  if (score >= 75) return "close friend";
  if (score >= 40) return "friend";
  if (score >= 10) return "friendly";
  if (score >= -9) return "neutral";
  if (score >= -39) return "tense";
  if (score >= -74) return "disliked";
  return "enemy";
}

function clampScore(score: number): number {
  return Math.max(-100, Math.min(100, Math.round(score)));
}

function clampNeed(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

type StoredSocial = {
  relationships: Record<string, CitizenRelationship>;
  knownCitizens: string[];
  knownPlaces: string[];
  knownBusinesses: string[];
  knownRumors: string[];
  knownKnowledgeIds: string[];
  knownRumorIds: string[];
  privateKnowledgeIds: string[];
  lastSharedKnowledgeId: string | null;
  recentKnowledgeReceived: string[];
  family: string[];
  friends: string[];
  coworkers: string[];
  supervisor: string | null;
  subordinates: string[];
  acquaintances: string[];
  needs: CitizenNeeds;
};

function defaultSocial(): StoredSocial {
  return {
    relationships: {},
    knownCitizens: [],
    knownPlaces: ["Reception Area", "Meeting / Boardroom", "Assistant Office", "Devon's Executive Office", "Projects & Updates Office"],
    knownBusinesses: ["stg-headquarters-operations"],
    knownRumors: [],
    knownKnowledgeIds: [],
    knownRumorIds: [],
    privateKnowledgeIds: ["briefing-stg-morning"],
    lastSharedKnowledgeId: null,
    recentKnowledgeReceived: [],
    family: [],
    friends: [],
    coworkers: [],
    supervisor: "devon",
    subordinates: [],
    acquaintances: [],
    needs: { energy: 92, hunger: 12, social: 70, moneyStress: 0 }
  };
}

function loadCitizenSocial(id: string): StoredSocial {
  const fallback = defaultSocial();
  const raw = window.localStorage.getItem(`stgWorldZero.social.${id}`);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSocial>;
    return {
      ...fallback,
      ...parsed,
      knownPlaces: Array.from(new Set([...fallback.knownPlaces, ...(parsed.knownPlaces ?? [])])),
      knownBusinesses: Array.from(new Set([...fallback.knownBusinesses, ...(parsed.knownBusinesses ?? [])])),
      privateKnowledgeIds: Array.from(new Set([...fallback.privateKnowledgeIds, ...(parsed.privateKnowledgeIds ?? [])])),
      needs: {
        energy: clampNeed(parsed.needs?.energy ?? fallback.needs.energy),
        hunger: clampNeed(parsed.needs?.hunger ?? fallback.needs.hunger),
        social: clampNeed(parsed.needs?.social ?? fallback.needs.social),
        moneyStress: clampNeed(parsed.needs?.moneyStress ?? fallback.needs.moneyStress)
      }
    };
  } catch {
    return fallback;
  }
}

export function persistCitizenSocial(citizenData: Citizen): void {
  const stored: StoredSocial = {
    relationships: citizenData.relationships,
    knownCitizens: citizenData.knownCitizens,
    knownPlaces: citizenData.knownPlaces,
    knownBusinesses: citizenData.knownBusinesses,
    knownRumors: citizenData.knownRumors,
    knownKnowledgeIds: citizenData.knownKnowledgeIds,
    knownRumorIds: citizenData.knownRumorIds,
    privateKnowledgeIds: citizenData.privateKnowledgeIds,
    lastSharedKnowledgeId: citizenData.lastSharedKnowledgeId,
    recentKnowledgeReceived: citizenData.recentKnowledgeReceived,
    family: citizenData.family,
    friends: citizenData.friends,
    coworkers: citizenData.coworkers,
    supervisor: citizenData.supervisor,
    subordinates: citizenData.subordinates,
    acquaintances: citizenData.acquaintances,
    needs: citizenData.needs
  };
  window.localStorage.setItem(`stgWorldZero.social.${citizenData.id}`, JSON.stringify(stored));
}

export function adjustRelationship(citizenData: Citizen, otherCitizenId: string, delta: number, tags: string[]): void {
  const existing = citizenData.relationships[otherCitizenId] ?? { citizenId: otherCitizenId, score: 0, label: "neutral" as RelationshipLabel, tags: [] };
  const score = clampScore(existing.score + delta);
  const mergedTags = Array.from(new Set([...existing.tags, ...tags]));
  citizenData.relationships[otherCitizenId] = {
    citizenId: otherCitizenId,
    score,
    label: relationshipLabel(score),
    tags: mergedTags
  };
  if (!citizenData.knownCitizens.includes(otherCitizenId)) citizenData.knownCitizens.push(otherCitizenId);
}

export function persistCitizenPayroll(citizenData: Citizen): void {
  window.localStorage.setItem(`stgWorldZero.wallet.${citizenData.id}`, `${Math.round(citizenData.wallet)}`);
  window.localStorage.setItem(`stgWorldZero.paidShifts.${citizenData.id}`, JSON.stringify(citizenData.paidShiftKeys));
}

export const EXECUTIVE_ASSISTANT_PROFILE: AgentProfile = {
  id: "agent_exec_assistant_001",
  slug: "executive-assistant",
  displayName: "Executive Assistant",
  preferredName: "Assistant",
  agentType: "personal_assistant",
  department: "Executive Office",
  roleTitle: "Executive Assistant to Devon",
  rank: "001",
  status: "active",
  currentLocation: "reception",
  homeOffice: "assistant_office",
  assignedBuilding: "stg_headquarters",
  assignedWorld: "stg_world",
  reportsTo: "devon",
  skills: ["daily briefings", "meeting coordination", "task triage", "project updates", "GitHub summaries", "Vercel summaries", "Raspberry Pi status summaries", "agent coordination"],
  tools: ["GitHub", "Vercel", "Device Registry", "Agent Registry", "Project Registry", "Calendar", "Whiteboard"],
  responsibilities: ["greet Devon at login", "summarize important updates", "surface urgent decisions", "coordinate meetings with other agents", "maintain the decision queue", "point Devon to the right office or room"],
  permissions: ["read_project_status", "read_agent_status", "read_device_status", "request_meetings", "create_briefings", "queue_decisions"],
  workSchedule: ["Monday-Friday core shift", "flexible after-hours urgent coverage"],
  shiftStatus: "on_duty",
  socialSchedule: ["lunch", "end-of-day debrief"],
  meetingAvailability: ["available for executive briefings"],
  currentTask: ["Prepare STG morning briefing"],
  activeProjects: ["STG World Zero", "STG Company Brain"],
  watchingRepos: ["sierratechnology/vibe-city"],
  watchingDevices: ["phosphor-node-01", "vanta-node-01"],
  memoryScope: ["STG organization", "STG World Zero", "Vanta", "Neon Media", "PHOSPHOR", "RigFlow"],
  personality: ["calm", "direct", "organized", "loyal", "proactive"],
  communicationStyle: ["concise", "executive assistant tone", "speaks like a real person, not a generic chatbot"],
  greetingScript: ["Welcome back, Devon. I have your STG briefing ready."],
  briefingSources: ["GitHub activity", "Vercel deployments", "Raspberry Pi device status", "active projects", "agent status", "decision queue"],
  decisionQueue: [],
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z"
};

function createExecutiveAssistant(): Citizen {
  const social = loadCitizenSocial(EXECUTIVE_ASSISTANT_PROFILE.id);
  const schedule: CitizenShift[] = [
    {
      id: "assistant-core-shift",
      days: days("Monday", "Tuesday", "Wednesday", "Thursday", "Friday"),
      startMinute: minutes(8),
      endMinute: minutes(18),
      role: EXECUTIVE_ASSISTANT_PROFILE.roleTitle,
      businessId: "stg-headquarters-operations",
      buildingId: "stg_headquarters",
      portalId: "headquarters-main",
      scene: "headquarters",
      workstationId: "reception",
      hourlyWage: 0
    },
    {
      id: "assistant-urgent-coverage",
      days: daily(),
      startMinute: minutes(18),
      endMinute: minutes(8),
      role: EXECUTIVE_ASSISTANT_PROFILE.roleTitle,
      businessId: "stg-headquarters-operations",
      buildingId: "stg_headquarters",
      portalId: "headquarters-main",
      scene: "headquarters",
      workstationId: "reception",
      hourlyWage: 0
    }
  ];

  return {
    ...EXECUTIVE_ASSISTANT_PROFILE,
    name: EXECUTIVE_ASSISTANT_PROFILE.displayName,
    home: "home",
    interests: ["executive support", "project updates", "meetings", "decisions", "agent coordination"],
    wallet: Number(window.localStorage.getItem(`stgWorldZero.wallet.${EXECUTIVE_ASSISTANT_PROFILE.id}`) ?? "0"),
    relationshipToPlayer: 0,
    relationships: social.relationships,
    knownCitizens: social.knownCitizens,
    knownPlaces: social.knownPlaces,
    knownBusinesses: social.knownBusinesses,
    knownRumors: social.knownRumors,
    knownKnowledgeIds: social.knownKnowledgeIds,
    knownRumorIds: social.knownRumorIds,
    privateKnowledgeIds: social.privateKnowledgeIds,
    lastSharedKnowledgeId: social.lastSharedKnowledgeId,
    recentKnowledgeReceived: social.recentKnowledgeReceived,
    family: social.family,
    friends: social.friends,
    coworkers: social.coworkers,
    supervisor: social.supervisor,
    subordinates: social.subordinates,
    acquaintances: social.acquaintances,
    needs: social.needs,
    moodReason: "Ready with STG briefing",
    currentSocialInteraction: null,
    role: EXECUTIVE_ASSISTANT_PROFILE.roleTitle,
    currentMood: "friendly",
    currentState: "working",
    currentScene: "headquarters",
    currentLocation: EXECUTIVE_ASSISTANT_PROFILE.currentLocation,
    currentDestination: null,
    currentWorkstationId: "reception",
    memories: [],
    knownFacts: ["World Zero is the STG Headquarters foundation."],
    schedule,
    position: { x: 0, z: 5.2 },
    homePosition: { x: -6.4, z: 2.6 },
    offDistrictEntryPortalId: "headquarters-main",
    routeWaypoints: [],
    wasLateToday: false,
    delayMinutes: 0,
    activeShiftKey: null,
    paidShiftKeys: JSON.parse(window.localStorage.getItem(`stgWorldZero.paidShifts.${EXECUTIVE_ASSISTANT_PROFILE.id}`) ?? "[]") as string[]
  };
}

export function createCitizens(): Citizen[] {
  const assistant = createExecutiveAssistant();
  persistCitizenSocial(assistant);
  return [assistant];
}
