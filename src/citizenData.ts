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
export type CitizenScene = "outside" | "apartment" | "barA" | "barB" | "sportsBar" | "casino" | "restaurant" | "bookShop" | "musicVenue" | "parkingGarage" | "none";
export type RelationshipLabel = "close friend" | "friend" | "friendly" | "neutral" | "tense" | "disliked" | "enemy";
export type CitizenInterest =
  | "nightlife"
  | "gambling"
  | "books"
  | "music"
  | "food"
  | "sports"
  | "cocktails"
  | "socializing"
  | "quiet places"
  | "live events"
  | "casino games";

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

export type Citizen = {
  id: string;
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
  currentLocation: string;
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

const BUSINESS_ROUTE: Record<string, { buildingId: string; portalId: string; scene: CitizenScene }> = {
  "bar-a-business": { buildingId: "bar-a", portalId: "bar-a-main", scene: "barA" },
  "bar-b-business": { buildingId: "bar-b", portalId: "bar-b-main", scene: "barB" },
  "sports-bar-business": { buildingId: "sports-bar", portalId: "sports-bar-main", scene: "sportsBar" },
  "casino-business": { buildingId: "casino", portalId: "casino-main", scene: "casino" },
  "casino-restaurant-operator": { buildingId: "casino", portalId: "casino-main", scene: "casino" },
  "standalone-restaurant": { buildingId: "restaurant", portalId: "restaurant-main", scene: "restaurant" },
  "book-shop-business": { buildingId: "book-shop", portalId: "book-shop-main", scene: "bookShop" },
  "music-venue-business": { buildingId: "music-venue", portalId: "music-venue-main", scene: "musicVenue" },
  "parking-garage-business": { buildingId: "parking-garage", portalId: "parking-garage-main", scene: "parkingGarage" },
  "apartment-operations": { buildingId: "apartment-building", portalId: "apartment-main", scene: "outside" },
  "coffee-shop-business": { buildingId: "coffee-shop", portalId: "coffee-shop-main", scene: "outside" },
  "convenience-store-business": { buildingId: "convenience-store", portalId: "convenience-store-main", scene: "outside" },
  "barber-shop-business": { buildingId: "barber-shop", portalId: "barber-shop-main", scene: "outside" },
  "bank-business": { buildingId: "bank", portalId: "bank-main", scene: "outside" },
  "small-hotel-business": { buildingId: "small-hotel", portalId: "small-hotel-main", scene: "outside" }
};

function shift(id: string, role: string, startMinute: number, endMinute: number, daysList: number[], workstationId: string, wage: number, businessId = "casino-business"): CitizenShift {
  const route = BUSINESS_ROUTE[businessId] ?? BUSINESS_ROUTE["casino-business"];
  return {
    id,
    days: daysList,
    startMinute,
    endMinute,
    role,
    businessId,
    buildingId: route.buildingId,
    portalId: route.portalId,
    scene: route.scene,
    workstationId,
    hourlyWage: wage
  };
}

function visit(id: string, businessId: string, startMinute: number, endMinute: number, daysList: number[], workstationId: string, label: string): CitizenShift {
  return shift(id, label, startMinute, endMinute, daysList, workstationId, 0, businessId);
}

function citizen(
  id: string,
  name: string,
  role: string,
  home: "home" | "off_district",
  homePosition: { x: number; z: number },
  schedule: CitizenShift[],
  interests: CitizenInterest[] = []
): Citizen {
  const walletKey = `vibeCity.wallet.${id}`;
  const social = loadCitizenSocial(id);
  return {
    id,
    name,
    home,
    interests,
    wallet: Number(window.localStorage.getItem(walletKey) ?? "0"),
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
    moodReason: "Baseline",
    currentSocialInteraction: null,
    role,
    currentMood: "neutral",
    currentState: home === "off_district" ? "off_district" : "home",
    currentScene: "none",
    currentLocation: home === "off_district" ? "Off District" : "Home",
    currentDestination: null,
    currentWorkstationId: null,
    memories: [],
    knownFacts: [],
    schedule,
    position: { ...homePosition },
    homePosition,
    offDistrictEntryPortalId: "parking-garage-portal",
    routeWaypoints: [],
    wasLateToday: false,
    delayMinutes: 0,
    activeShiftKey: null,
    paidShiftKeys: JSON.parse(window.localStorage.getItem(`vibeCity.paidShifts.${id}`) ?? "[]") as string[]
  };
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
    knownPlaces: [],
    knownBusinesses: [],
    knownRumors: [],
    knownKnowledgeIds: [],
    knownRumorIds: [],
    privateKnowledgeIds: [],
    lastSharedKnowledgeId: null,
    recentKnowledgeReceived: [],
    family: [],
    friends: [],
    coworkers: [],
    supervisor: null,
    subordinates: [],
    acquaintances: [],
    needs: { energy: 78, hunger: 22, social: 68, moneyStress: 42 }
  };
}

function loadCitizenSocial(id: string): StoredSocial {
  const fallback = defaultSocial();
  const raw = window.localStorage.getItem(`vibeCity.social.${id}`);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSocial>;
    return {
      ...fallback,
      ...parsed,
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
  window.localStorage.setItem(`vibeCity.social.${citizenData.id}`, JSON.stringify(stored));
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
  if (score >= 40 && !citizenData.friends.includes(otherCitizenId)) citizenData.friends.push(otherCitizenId);
  if (score < 40) citizenData.friends = citizenData.friends.filter((id) => id !== otherCitizenId);
  if (score >= -9 && score <= 39 && !citizenData.acquaintances.includes(otherCitizenId)) citizenData.acquaintances.push(otherCitizenId);
}

function seedRelationship(citizenData: Citizen, otherCitizenId: string, minimumScore: number, tags: string[]): void {
  const existing = citizenData.relationships[otherCitizenId];
  const score = clampScore(Math.max(existing?.score ?? minimumScore, minimumScore));
  citizenData.relationships[otherCitizenId] = {
    citizenId: otherCitizenId,
    score,
    label: relationshipLabel(score),
    tags: Array.from(new Set([...(existing?.tags ?? []), ...tags]))
  };
  if (!citizenData.knownCitizens.includes(otherCitizenId)) citizenData.knownCitizens.push(otherCitizenId);
  if (score >= 40 && !citizenData.friends.includes(otherCitizenId)) citizenData.friends.push(otherCitizenId);
  if (score >= -9 && score <= 39 && !citizenData.acquaintances.includes(otherCitizenId)) citizenData.acquaintances.push(otherCitizenId);
}

function addKnown(citizenData: Citizen, places: string[], businesses: string[], facts: string[]): void {
  citizenData.knownPlaces = Array.from(new Set([...citizenData.knownPlaces, ...places]));
  citizenData.knownBusinesses = Array.from(new Set([...citizenData.knownBusinesses, ...businesses]));
  citizenData.knownFacts = Array.from(new Set([...citizenData.knownFacts, ...facts]));
}

function linkCoworkers(citizens: Citizen[], ids: string[], supervisorId: string | null, score = 18): void {
  for (const citizenData of citizens) {
    if (!ids.includes(citizenData.id)) continue;
    citizenData.coworkers = Array.from(new Set([...citizenData.coworkers, ...ids.filter((id) => id !== citizenData.id)]));
    citizenData.supervisor = supervisorId && supervisorId !== citizenData.id ? supervisorId : citizenData.supervisor;
    if (citizenData.id === supervisorId) citizenData.subordinates = Array.from(new Set([...citizenData.subordinates, ...ids.filter((id) => id !== supervisorId)]));
    for (const otherId of ids) {
      if (otherId !== citizenData.id) seedRelationship(citizenData, otherId, score, ["coworker"]);
    }
  }
}

function seedSocialGraph(citizens: Citizen[]): Citizen[] {
  const bar = ["marcus-reed", "lena-torres", "sarah-kim"];
  const managers = ["olivia-grant", "victor-lane", "maya-cross"];
  const dealers = ["eli-price", "jade-nguyen", "noah-stone", "tessa-vale", "dante-hill"];
  const casinoFloor = ["riley-park", "brooke-avery", "samir-patel", "ines-romero", "cam-wright", "luis-mendez"];
  const restaurant = ["grace-holland", "nick-harper", "zoe-fisher"];

  linkCoworkers(citizens, bar, "marcus-reed", 24);
  linkCoworkers(citizens, managers, null, 18);
  linkCoworkers(citizens, dealers, "olivia-grant", 20);
  linkCoworkers(citizens, casinoFloor, "brooke-avery", 15);
  linkCoworkers(citizens, restaurant, "grace-holland", 22);

  const workerGroups = new Map<string, string[]>();
  for (const citizenData of citizens) {
    for (const block of citizenData.schedule) {
      if (block.hourlyWage <= 0) continue;
      const ids = workerGroups.get(block.businessId) ?? [];
      ids.push(citizenData.id);
      workerGroups.set(block.businessId, Array.from(new Set(ids)));
    }
  }

  for (const [businessId, ids] of workerGroups) {
    const supervisor = ids.find((id) => citizens.find((entry) => entry.id === id)?.role.includes("Manager")) ?? ids[0] ?? null;
    linkCoworkers(citizens, ids, supervisor, businessId.includes("casino") ? 16 : 20);
  }

  for (const citizenData of citizens) {
    if (bar.includes(citizenData.id)) addKnown(citizenData, ["Bar A", "Parking Garage", "Fremont East"], ["bar-a-business"], ["Bar A is a busy neighborhood bar"]);
    if ([...managers, ...dealers, ...casinoFloor].includes(citizenData.id)) addKnown(citizenData, ["Casino", "Parking Garage", "Fremont East"], ["casino-business"], ["Casino operates 24 hours"]);
    if (restaurant.includes(citizenData.id)) addKnown(citizenData, ["Casino Restaurant Lease Space", "Casino"], ["casino-restaurant-operator"], ["The restaurant is leased inside the casino"]);
    if (citizenData.id === "marcus-reed") addKnown(citizenData, ["Bar A", "Casino"], ["bar-a-business", "casino-business"], ["Marcus supervises Bar A staff"]);
    for (const block of citizenData.schedule) {
      addKnown(citizenData, [block.buildingId], [block.businessId], [`${citizenData.name} knows ${block.businessId}`]);
    }
    persistCitizenSocial(citizenData);
  }

  return citizens;
}

export function persistCitizenPayroll(citizenData: Citizen): void {
  window.localStorage.setItem(`vibeCity.wallet.${citizenData.id}`, `${Math.round(citizenData.wallet)}`);
  window.localStorage.setItem(`vibeCity.paidShifts.${citizenData.id}`, JSON.stringify(citizenData.paidShiftKeys));
}

const DISTRICT_NAMES = [
  "Avery Knox",
  "Jordan Velez",
  "Mina Hart",
  "Theo Banks",
  "Casey Wynn",
  "Rosa Quinn",
  "Drew Ellis",
  "Ivy Chen",
  "Mason Cole",
  "Priya Shah",
  "Logan Rivers",
  "Nadia Wells",
  "Owen Fox",
  "Tara Holt",
  "Benji Cruz",
  "Elena Moss",
  "Kai Morgan",
  "Mara Singh",
  "Silas Reed",
  "June Porter",
  "Felix Ray",
  "Amara Blake",
  "Gavin West",
  "Sofia Lane",
  "Micah Brooks",
  "Talia Stone",
  "Jonah Hale",
  "Renee Park",
  "Miles Vega",
  "Carmen Dale",
  "Ezra Moon",
  "Layla Frost",
  "Remy Nash",
  "Nico Flynn",
  "Vera Shaw",
  "Parker Liu",
  "Dalia Cross",
  "Rowan Tate",
  "Iris Vale",
  "Caleb York",
  "Zara Pierce",
  "Finn Archer",
  "Maya Sloan",
  "Evan Lake",
  "Lena Fox",
  "Oscar Bell",
  "Nora Finch",
  "Ari Kim",
  "Gia Reed",
  "Julian Vale",
  "Mila Knox",
  "Tomas Grey",
  "Selene West",
  "Roman Pike",
  "Cleo Hart",
  "Devon Ames",
  "Keira Bloom",
  "Sam Rivera",
  "Luca Stone",
  "Noelle Chase"
];

function slugName(name: string, index: number): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}-${index}`;
}

const ROSTER_FIRST_NAMES = [
  "Alden",
  "Bree",
  "Cyrus",
  "Demi",
  "Emery",
  "Flora",
  "Gideon",
  "Hazel",
  "Imani",
  "Jasper",
  "Kira",
  "Landon",
  "Marisol",
  "Nolan",
  "Opal",
  "Pierce",
  "Quincy",
  "Rhea",
  "Sterling",
  "Tatum",
  "Uma",
  "Vance",
  "Willa",
  "Xavier",
  "Yara",
  "Zane"
];

const ROSTER_LAST_NAMES = [
  "Ames",
  "Bishop",
  "Cline",
  "Dawes",
  "Estrada",
  "Fletcher",
  "Garcia",
  "Hollis",
  "Irwin",
  "Jennings",
  "Keller",
  "Lowry",
  "Maddox",
  "Novak",
  "Owens",
  "Pruitt",
  "Quill",
  "Rios",
  "Summers",
  "Tran"
];

function rosterName(index: number): string {
  return `${ROSTER_FIRST_NAMES[index % ROSTER_FIRST_NAMES.length]} ${ROSTER_LAST_NAMES[Math.floor(index / ROSTER_FIRST_NAMES.length) % ROSTER_LAST_NAMES.length]}`;
}

function createDistrictCitizens(): Citizen[] {
  const created: Citizen[] = [];
  const add = (name: string, role: string, schedule: CitizenShift[], interests: CitizenInterest[]) => {
    const index = created.length;
    created.push(citizen(slugName(name, index), name, role, "off_district", { x: 41, z: 29.6 }, schedule, interests));
  };

  const staff = [
    ["Andre Miles", "Bartender", [shift("bar-a-swing-extra", "Bartender", minutes(14), minutes(22), days("Tuesday", "Wednesday", "Friday", "Saturday"), "bar-a-tap-2", 15, "bar-a-business")], ["nightlife", "cocktails", "socializing"]],
    ["Nina Brooks", "Bartender", [shift("bar-a-day-extra", "Bartender", minutes(12), minutes(20), days("Monday", "Thursday", "Friday", "Saturday"), "bar-a-tap-1", 15, "bar-a-business")], ["cocktails", "music"]],
    ["Tyler Shaw", "Bartender", [shift("bar-a-late-extra", "Bartender", minutes(20), minutes(2), days("Sunday", "Monday", "Tuesday"), "bar-a-tap-2", 15, "bar-a-business")], ["nightlife", "sports"]],
    ["Cal Morgan", "Bar B Manager", [shift("bar-b-manager-week", "Bar Manager", minutes(13), minutes(21), days("Wednesday", "Thursday", "Friday", "Saturday", "Sunday"), "bar-b-manager", 20, "bar-b-business")], ["nightlife", "cocktails"]],
    ["Toni Reyes", "Bartender", [shift("bar-b-night-a", "Bartender", minutes(17), minutes(1), days("Wednesday", "Thursday", "Friday", "Saturday"), "bar-b-tap-1", 15, "bar-b-business")], ["cocktails", "socializing"]],
    ["Jules Carter", "Bartender", [shift("bar-b-night-b", "Bartender", minutes(18), minutes(2), days("Friday", "Saturday", "Sunday"), "bar-b-tap-2", 15, "bar-b-business")], ["nightlife", "music"]],
    ["Rami Soto", "Bartender", [shift("bar-b-day", "Bartender", minutes(12), minutes(20), days("Monday", "Tuesday", "Wednesday"), "bar-b-tap-1", 15, "bar-b-business")], ["cocktails", "quiet places"]],
    ["Mo Harris", "Sports Bar Manager", [shift("sports-manager", "Sports Bar Manager", minutes(11), minutes(19), daily(), "sports-bar-manager", 21, "sports-bar-business")], ["sports", "food"]],
    ["Kara Fields", "Sports Bartender", [shift("sports-bartender-a", "Bartender", minutes(12), minutes(20), daily(), "sports-bar-tap-1", 15, "sports-bar-business")], ["sports", "cocktails"]],
    ["Eddie Parks", "Sports Bartender", [shift("sports-bartender-b", "Bartender", minutes(18), minutes(2), daily(), "sports-bar-tap-2", 15, "sports-bar-business")], ["sports", "nightlife"]],
    ["Iona Bell", "Sports Server", [shift("sports-server-a", "Server", minutes(16), minutes(0), days("Monday", "Thursday", "Friday", "Saturday", "Sunday"), "sports-bar-server-floor", 14, "sports-bar-business")], ["sports", "socializing"]],
    ["Mack Lane", "Sports Server", [shift("sports-server-b", "Server", minutes(18), minutes(2), days("Tuesday", "Wednesday", "Saturday", "Sunday"), "sports-bar-server-floor", 14, "sports-bar-business")], ["sports", "food"]],
    ["Darla Finch", "Restaurant Manager", [shift("standalone-manager", "Restaurant Manager", minutes(10), minutes(18), daily(), "restaurant-manager", 22, "standalone-restaurant")], ["food", "socializing"]],
    ["Hugo Price", "Host", [shift("standalone-host", "Host", minutes(11), minutes(19), daily(), "restaurant-host", 15, "standalone-restaurant")], ["food"]],
    ["Bella Stone", "Server", [shift("standalone-server-a", "Server", minutes(11), minutes(21), daily(), "restaurant-server-floor", 15, "standalone-restaurant")], ["food", "nightlife"]],
    ["Quinn Ellis", "Server", [shift("standalone-server-b", "Server", minutes(15), minutes(23), daily(), "restaurant-server-floor", 15, "standalone-restaurant")], ["food", "socializing"]],
    ["Omar Vale", "Cook", [shift("standalone-cook-a", "Cook", minutes(10), minutes(20), daily(), "restaurant-kitchen", 17, "standalone-restaurant")], ["food"]],
    ["Nell Cross", "Cook", [shift("standalone-cook-b", "Cook", minutes(14), minutes(23), daily(), "restaurant-kitchen", 17, "standalone-restaurant")], ["food", "music"]],
    ["Paolo Mendez", "Dishwasher", [shift("standalone-dish", "Dishwasher", minutes(12), minutes(22), daily(), "restaurant-dish", 14, "standalone-restaurant")], ["quiet places"]],
    ["Bea Rowan", "Book Shop Owner", [shift("book-owner", "Book Shop Owner", minutes(9), minutes(17), days("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"), "book-shop-counter", 18, "book-shop-business")], ["books", "quiet places"]],
    ["Cass May", "Book Shop Clerk", [shift("book-clerk-a", "Book Shop Clerk", minutes(10), minutes(18), days("Wednesday", "Thursday", "Friday", "Saturday", "Sunday"), "book-shop-counter", 14, "book-shop-business")], ["books", "music"]],
    ["Eliot Page", "Book Shop Clerk", [shift("book-clerk-b", "Book Shop Clerk", minutes(12), minutes(18), days("Sunday", "Monday", "Tuesday"), "book-shop-counter", 14, "book-shop-business")], ["books", "quiet places"]],
    ["Val King", "Venue Manager", [shift("venue-manager", "Venue Manager", minutes(15), minutes(23), days("Wednesday", "Thursday", "Friday", "Saturday", "Sunday"), "music-venue-manager", 21, "music-venue-business")], ["music", "live events"]],
    ["Pia Moon", "Venue Bartender", [shift("venue-bartender", "Venue Bartender", minutes(18), minutes(2), days("Thursday", "Friday", "Saturday", "Sunday"), "music-venue-bar", 15, "music-venue-business")], ["music", "cocktails"]],
    ["Gabe North", "Door Person", [shift("venue-door", "Door Person", minutes(18), minutes(2), days("Thursday", "Friday", "Saturday", "Sunday"), "music-venue-door", 16, "music-venue-business")], ["live events", "nightlife"]],
    ["Luz Ortega", "Sound Tech", [shift("venue-sound", "Sound Tech", minutes(17), minutes(1), days("Thursday", "Friday", "Saturday"), "music-venue-sound", 19, "music-venue-business")], ["music", "live events"]],
    ["Harper Jones", "Garage Attendant", [shift("garage-attendant", "Garage Attendant", minutes(8), minutes(20), daily(), "parking-garage-attendant", 16, "parking-garage-business")], ["quiet places"]],
    ["Sasha Young", "Garage Security", [shift("garage-security", "Garage Security", minutes(20), minutes(8), daily(), "parking-garage-security", 18, "parking-garage-business")], ["socializing"]],
    ["Cora Banks", "Casino Dealer", [shift("dealer-grave-a", "Dealer", minutes(0), minutes(8), daily(), "blackjack-table", 22)], ["gambling", "casino games"]],
    ["Malik Ross", "Casino Dealer", [shift("dealer-grave-b", "Dealer", minutes(0), minutes(8), daily(), "roulette-table", 22)], ["gambling", "casino games"]],
    ["Tina Alvarez", "Cage Cashier", [shift("cage-swing", "Cage Cashier", minutes(20), minutes(8), daily(), "cage-window-1", 19)], ["quiet places"]],
    ["Will Spencer", "Security Officer", [shift("security-night", "Security Officer", minutes(20), minutes(8), daily(), "security-slot-floor", 20)], ["casino games"]]
  ] as const;

  for (const [name, role, schedule, interests] of staff) add(name, role, [...schedule], [...interests]);

  let rosterIndex = 0;
  const addRoster = (
    label: string,
    role: string,
    count: number,
    businessId: string,
    workstationIds: string[],
    wage: number,
    startMinute: number,
    endMinute: number,
    interests: CitizenInterest[],
    daysList = daily()
  ) => {
    for (let index = 0; index < count; index += 1) {
      const name = rosterName(rosterIndex);
      const workstationId = workstationIds[index % workstationIds.length];
      add(name, role, [shift(`${label}-${index}`, role, startMinute, endMinute, daysList, workstationId, wage, businessId)], interests);
      rosterIndex += 1;
    }
  };

  addRoster("bar-b-bartender-fill", "Bartender", 1, "bar-b-business", ["bar-b-tap-2"], 15, minutes(18), minutes(2), ["nightlife", "cocktails"]);
  addRoster("sports-bar-bartender-fill", "Bartender", 2, "sports-bar-business", ["sports-bar-tap-1", "sports-bar-tap-2"], 15, minutes(16), minutes(0), ["sports", "cocktails"]);
  addRoster("sports-bar-server-fill", "Server", 2, "sports-bar-business", ["sports-bar-server-floor"], 14, minutes(16), minutes(0), ["sports", "food"]);
  addRoster("sports-bar-door", "Door Security", 1, "sports-bar-business", ["sports-bar-watch-area"], 17, minutes(18), minutes(2), ["sports", "nightlife"]);

  addRoster("casino-dealer-fill", "Dealer", 2, "casino-business", ["blackjack-table", "roulette-table", "three-card-poker-table"], 22, minutes(0), minutes(8), ["gambling", "casino games"]);
  addRoster("casino-cocktail-fill", "Cocktail Server", 3, "casino-business", ["cocktail-floor"], 18, minutes(16), minutes(4), ["casino games", "socializing"]);
  addRoster("casino-security-fill", "Security Officer", 5, "casino-business", ["security-entrance", "security-slot-floor", "casino-restaurant-host"], 20, minutes(12), minutes(0), ["casino games"]);
  addRoster("casino-surveillance-fill", "Surveillance Operator", 5, "casino-business", ["surveillance-room"], 21, minutes(12), minutes(0), ["quiet places"]);
  addRoster("casino-cage-fill", "Cage Cashier", 4, "casino-business", ["cage-window-1"], 19, minutes(12), minutes(0), ["quiet places"]);
  addRoster("casino-maintenance-fill", "Maintenance Tech", 3, "casino-business", ["maintenance-route"], 18, minutes(12), minutes(0), ["quiet places"]);

  addRoster("restaurant-host-fill", "Host", 1, "standalone-restaurant", ["restaurant-host"], 15, minutes(11), minutes(19), ["food"]);
  addRoster("restaurant-server-fill", "Server", 4, "standalone-restaurant", ["restaurant-server-floor"], 15, minutes(15), minutes(23), ["food", "socializing"]);
  addRoster("restaurant-cook-fill", "Cook", 2, "standalone-restaurant", ["restaurant-kitchen"], 17, minutes(12), minutes(22), ["food"]);
  addRoster("restaurant-dish-fill", "Dishwasher", 1, "standalone-restaurant", ["restaurant-dish"], 14, minutes(12), minutes(22), ["quiet places"]);
  addRoster("restaurant-busser", "Busser", 2, "standalone-restaurant", ["restaurant-server-floor"], 14, minutes(16), minutes(23), ["food"]);

  addRoster("casino-restaurant-host-fill", "Host", 2, "casino-restaurant-operator", ["casino-restaurant-host"], 15, minutes(11), minutes(19), ["food"]);
  addRoster("casino-restaurant-server-fill", "Server", 5, "casino-restaurant-operator", ["casino-restaurant-service"], 15, minutes(15), minutes(23), ["food", "casino games"]);
  addRoster("casino-restaurant-cook-fill", "Cook", 3, "casino-restaurant-operator", ["casino-restaurant-kitchen"], 17, minutes(12), minutes(22), ["food"]);
  addRoster("casino-restaurant-dish", "Dishwasher", 2, "casino-restaurant-operator", ["casino-restaurant-kitchen"], 14, minutes(12), minutes(22), ["quiet places"]);
  addRoster("casino-restaurant-busser", "Busser", 2, "casino-restaurant-operator", ["casino-restaurant-service"], 14, minutes(16), minutes(23), ["food"]);

  addRoster("music-bartender-fill", "Venue Bartender", 1, "music-venue-business", ["music-venue-bar"], 15, minutes(18), minutes(2), ["music", "cocktails"]);
  addRoster("music-door-fill", "Door Security", 1, "music-venue-business", ["music-venue-door"], 16, minutes(18), minutes(2), ["music", "live events"]);
  addRoster("music-stagehand", "Stagehand", 1, "music-venue-business", ["music-venue-sound"], 17, minutes(17), minutes(1), ["music", "live events"]);

  addRoster("garage-manager", "Parking Garage Manager", 1, "parking-garage-business", ["parking-garage-manager"], 22, minutes(8), minutes(16), ["quiet places"]);
  addRoster("garage-attendant-fill", "Garage Attendant", 2, "parking-garage-business", ["parking-garage-attendant"], 16, minutes(12), minutes(0), ["quiet places"]);
  addRoster("garage-security-fill", "Garage Security", 1, "parking-garage-business", ["parking-garage-security"], 18, minutes(8), minutes(20), ["socializing"]);

  addRoster("apartment-manager", "Property Manager", 1, "apartment-operations", ["apartment-property-manager"], 22, minutes(9), minutes(17), ["socializing"]);
  addRoster("apartment-maintenance", "Apartment Maintenance", 1, "apartment-operations", ["apartment-maintenance"], 18, minutes(8), minutes(16), ["quiet places"]);
  addRoster("apartment-security", "Front Desk Security", 1, "apartment-operations", ["apartment-front-desk"], 18, minutes(16), minutes(0), ["socializing"]);
  addRoster("apartment-manager-evening", "Property Manager", 1, "apartment-operations", ["apartment-property-manager"], 22, minutes(17), minutes(1), ["socializing"]);
  addRoster("apartment-manager-overnight", "Property Manager", 1, "apartment-operations", ["apartment-property-manager"], 22, minutes(1), minutes(9), ["quiet places"]);
  addRoster("apartment-maintenance-evening", "Apartment Maintenance", 1, "apartment-operations", ["apartment-maintenance"], 18, minutes(16), minutes(0), ["quiet places"]);
  addRoster("apartment-maintenance-overnight", "Apartment Maintenance", 1, "apartment-operations", ["apartment-maintenance"], 18, minutes(0), minutes(8), ["quiet places"]);
  addRoster("apartment-security-overnight", "Front Desk Security", 1, "apartment-operations", ["apartment-front-desk"], 18, minutes(0), minutes(8), ["socializing"]);

  addRoster("coffee-manager", "Coffee Shop Manager", 1, "coffee-shop-business", ["coffee-manager"], 18, minutes(7), minutes(15), ["food", "socializing"]);
  addRoster("coffee-barista", "Barista", 4, "coffee-shop-business", ["coffee-barista"], 14, minutes(7), minutes(17), ["food", "socializing"]);
  addRoster("convenience-manager", "Convenience Store Manager", 1, "convenience-store-business", ["convenience-manager"], 18, minutes(8), minutes(16), ["socializing"]);
  addRoster("convenience-manager-evening", "Convenience Store Manager", 1, "convenience-store-business", ["convenience-manager"], 18, minutes(16), minutes(0), ["socializing"]);
  addRoster("convenience-manager-overnight", "Convenience Store Manager", 1, "convenience-store-business", ["convenience-manager"], 18, minutes(0), minutes(8), ["quiet places"]);
  addRoster("convenience-clerk", "Convenience Store Clerk", 4, "convenience-store-business", ["convenience-clerk"], 14, minutes(8), minutes(20), ["socializing"]);
  addRoster("convenience-clerk-evening", "Convenience Store Clerk", 4, "convenience-store-business", ["convenience-clerk"], 14, minutes(16), minutes(0), ["socializing"]);
  addRoster("convenience-clerk-overnight", "Convenience Store Clerk", 4, "convenience-store-business", ["convenience-clerk"], 14, minutes(0), minutes(8), ["quiet places"]);
  addRoster("barber-manager", "Barber Shop Owner", 1, "barber-shop-business", ["barber-manager"], 20, minutes(9), minutes(17), ["socializing"]);
  addRoster("barber", "Barber", 3, "barber-shop-business", ["barber-chair"], 18, minutes(9), minutes(19), ["socializing"]);
  addRoster("bank-manager", "Bank Manager", 1, "bank-business", ["bank-manager"], 24, minutes(9), minutes(17), ["quiet places"]);
  addRoster("bank-teller", "Bank Teller", 3, "bank-business", ["bank-teller"], 17, minutes(9), minutes(17), ["quiet places"]);
  addRoster("bank-security", "Bank Security", 1, "bank-business", ["bank-security"], 18, minutes(9), minutes(17), ["quiet places"]);
  addRoster("hotel-manager", "Hotel Manager", 1, "small-hotel-business", ["hotel-manager"], 22, minutes(8), minutes(16), ["socializing"]);
  addRoster("hotel-manager-evening", "Hotel Manager", 1, "small-hotel-business", ["hotel-manager"], 22, minutes(16), minutes(0), ["socializing"]);
  addRoster("hotel-manager-overnight", "Hotel Manager", 1, "small-hotel-business", ["hotel-manager"], 22, minutes(0), minutes(8), ["quiet places"]);
  addRoster("hotel-front-desk", "Hotel Front Desk Clerk", 3, "small-hotel-business", ["hotel-front-desk"], 16, minutes(8), minutes(20), ["socializing"]);
  addRoster("hotel-front-desk-evening", "Hotel Front Desk Clerk", 3, "small-hotel-business", ["hotel-front-desk"], 16, minutes(16), minutes(0), ["socializing"]);
  addRoster("hotel-front-desk-overnight", "Hotel Front Desk Clerk", 3, "small-hotel-business", ["hotel-front-desk"], 16, minutes(0), minutes(8), ["quiet places"]);
  addRoster("hotel-housekeeping", "Housekeeping", 2, "small-hotel-business", ["hotel-housekeeping"], 15, minutes(9), minutes(17), ["quiet places"]);
  addRoster("hotel-housekeeping-evening", "Housekeeping", 2, "small-hotel-business", ["hotel-housekeeping"], 15, minutes(17), minutes(1), ["quiet places"]);
  addRoster("hotel-housekeeping-overnight", "Housekeeping", 2, "small-hotel-business", ["hotel-housekeeping"], 15, minutes(1), minutes(9), ["quiet places"]);
  addRoster("hotel-maintenance", "Hotel Maintenance", 1, "small-hotel-business", ["hotel-maintenance"], 18, minutes(8), minutes(16), ["quiet places"]);
  addRoster("hotel-maintenance-evening", "Hotel Maintenance", 1, "small-hotel-business", ["hotel-maintenance"], 18, minutes(16), minutes(0), ["quiet places"]);
  addRoster("hotel-maintenance-overnight", "Hotel Maintenance", 1, "small-hotel-business", ["hotel-maintenance"], 18, minutes(0), minutes(8), ["quiet places"]);

  const interestPlans: Array<{ interests: CitizenInterest[]; businessId: string; station: string; start: number; end: number; daysList: number[]; label: string }> = [
    { interests: ["sports", "food"], businessId: "sports-bar-business", station: "sports-bar-watch-area", start: minutes(19), end: minutes(22), daysList: days("Monday", "Thursday", "Sunday"), label: "Watch Game" },
    { interests: ["music", "live events"], businessId: "music-venue-business", station: "music-venue-floor", start: minutes(20), end: minutes(23), daysList: days("Thursday", "Friday", "Saturday"), label: "See Music" },
    { interests: ["books", "quiet places"], businessId: "book-shop-business", station: "book-shop-reading-area", start: minutes(13), end: minutes(16), daysList: days("Tuesday", "Wednesday", "Saturday", "Sunday"), label: "Browse Books" },
    { interests: ["gambling", "casino games"], businessId: "casino-business", station: "blackjack-table", start: minutes(18), end: minutes(23), daysList: daily(), label: "Visit Casino" },
    { interests: ["food", "socializing"], businessId: "standalone-restaurant", station: "restaurant-server-floor", start: minutes(18), end: minutes(21), daysList: daily(), label: "Dinner Visit" },
    { interests: ["nightlife", "cocktails"], businessId: "bar-a-business", station: "bar-a-customer-floor", start: minutes(21), end: minutes(1), daysList: days("Thursday", "Friday", "Saturday"), label: "Night Out" },
    { interests: ["nightlife", "socializing"], businessId: "bar-b-business", station: "bar-b-customer-floor", start: minutes(20), end: minutes(0), daysList: days("Friday", "Saturday", "Sunday"), label: "Meet Friends" }
  ];

  for (let index = 0; index < Math.min(DISTRICT_NAMES.length, 20); index += 1) {
    const name = DISTRICT_NAMES[index];
    const plan = interestPlans[index % interestPlans.length];
    const extraPlan = interestPlans[(index + 3) % interestPlans.length];
    const schedule = [
      visit(`interest-${index}-primary`, plan.businessId, plan.start, plan.end, plan.daysList, plan.station, plan.label)
    ];
    if (index % 3 === 0) schedule.push(visit(`interest-${index}-extra`, extraPlan.businessId, extraPlan.start, extraPlan.end, extraPlan.daysList, extraPlan.station, extraPlan.label));
    add(name, "District Regular", schedule, plan.interests);
  }

  return created;
}

export function createCitizens(): Citizen[] {
  const baseCitizens = [
    citizen("marcus-reed", "Marcus Reed", "Bar Manager", "home", { x: -58, z: 18 }, [
      shift("bar-manager-weekday", "Bar Manager", minutes(10), minutes(18), days("Monday", "Tuesday", "Wednesday", "Thursday", "Friday"), "bar-a-manager", 20, "bar-a-business")
    ]),
    citizen("lena-torres", "Lena Torres", "Bartender", "off_district", { x: 41, z: 29.6 }, [
      shift("bar-a-night-1", "Bartender", minutes(18), minutes(2), days("Monday", "Tuesday", "Wednesday", "Thursday"), "bar-a-tap-1", 15, "bar-a-business")
    ]),
    citizen("sarah-kim", "Sarah Kim", "Bartender", "home", { x: -58, z: -12 }, [
      shift("bar-a-weekend", "Bartender", minutes(18), minutes(2), days("Friday", "Saturday", "Sunday"), "bar-a-tap-2", 15, "bar-a-business")
    ]),
    citizen("olivia-grant", "Olivia Grant", "Casino Manager", "off_district", { x: 41, z: 29.6 }, [
      shift("casino-manager-day", "Casino Manager", minutes(8), minutes(16), daily(), "casino-manager-floor", 30)
    ]),
    citizen("victor-lane", "Victor Lane", "Casino Manager", "home", { x: 58, z: -16 }, [
      shift("casino-manager-swing", "Casino Manager", minutes(16), minutes(0), daily(), "casino-manager-floor", 30)
    ]),
    citizen("maya-cross", "Maya Cross", "Casino Manager", "off_district", { x: 41, z: 29.6 }, [
      shift("casino-manager-grave", "Casino Manager", minutes(0), minutes(8), daily(), "casino-manager-floor", 30)
    ]),
    citizen("eli-price", "Eli Price", "Blackjack Dealer", "home", { x: -58, z: -30 }, [
      shift("dealer-day-a", "Dealer", minutes(8), minutes(16), daily(), "blackjack-table", 22)
    ]),
    citizen("jade-nguyen", "Jade Nguyen", "Roulette Dealer", "off_district", { x: 41, z: 29.6 }, [
      shift("dealer-day-b", "Dealer", minutes(8), minutes(16), daily(), "roulette-table", 22)
    ]),
    citizen("noah-stone", "Noah Stone", "Three Card Poker Dealer", "home", { x: 58, z: 30 }, [
      shift("dealer-day-c", "Dealer", minutes(8), minutes(16), daily(), "three-card-poker-table", 22)
    ]),
    citizen("tessa-vale", "Tessa Vale", "Dealer", "off_district", { x: 41, z: 29.6 }, [
      shift("dealer-swing-a", "Dealer", minutes(16), minutes(0), daily(), "blackjack-table", 22)
    ]),
    citizen("dante-hill", "Dante Hill", "Dealer", "home", { x: -58, z: 3 }, [
      shift("dealer-swing-b", "Dealer", minutes(16), minutes(0), daily(), "roulette-table", 22)
    ]),
    citizen("riley-park", "Riley Park", "Cocktail Server", "off_district", { x: 41, z: 29.6 }, [
      shift("cocktail-day", "Cocktail Server", minutes(8), minutes(20), daily(), "cocktail-floor", 18)
    ]),
    citizen("brooke-avery", "Brooke Avery", "Security Supervisor", "home", { x: 58, z: 4 }, [
      shift("security-supervisor", "Security Supervisor", minutes(8), minutes(20), daily(), "security-entrance", 24)
    ]),
    citizen("samir-patel", "Samir Patel", "Security Officer", "off_district", { x: 41, z: 29.6 }, [
      shift("security-route", "Security Officer", minutes(8), minutes(20), daily(), "security-slot-floor", 20)
    ]),
    citizen("ines-romero", "Ines Romero", "Surveillance Operator", "off_district", { x: 41, z: 29.6 }, [
      shift("surveillance-day", "Surveillance Operator", minutes(8), minutes(20), daily(), "surveillance-room", 21)
    ]),
    citizen("cam-wright", "Cam Wright", "Cage Cashier", "home", { x: -58, z: 32 }, [
      shift("cage-day", "Cage Cashier", minutes(8), minutes(20), daily(), "cage-window-1", 19)
    ]),
    citizen("luis-mendez", "Luis Mendez", "Maintenance Tech", "off_district", { x: 41, z: 29.6 }, [
      shift("maintenance-day", "Maintenance Tech", minutes(9), minutes(17), daily(), "maintenance-route", 18)
    ]),
    citizen("grace-holland", "Grace Holland", "Restaurant Manager", "home", { x: 58, z: -34 }, [
      shift("restaurant-manager", "Restaurant Manager", minutes(11), minutes(19), daily(), "casino-restaurant-host", 21, "casino-restaurant-operator")
    ]),
    citizen("nick-harper", "Nick Harper", "Restaurant Cook", "off_district", { x: 41, z: 29.6 }, [
      shift("restaurant-cook", "Cook", minutes(11), minutes(21), daily(), "casino-restaurant-kitchen", 17, "casino-restaurant-operator")
    ]),
    citizen("zoe-fisher", "Zoe Fisher", "Restaurant Server", "home", { x: -58, z: -42 }, [
      shift("restaurant-server", "Server", minutes(11), minutes(21), daily(), "casino-restaurant-service", 15, "casino-restaurant-operator")
    ]),
    citizen("hannah-booker", "Hannah Booker", "Book Shop Clerk", "home", { x: -58, z: 42 }, [
      shift("book-shop-day", "Book Shop Clerk", minutes(10), minutes(18), daily(), "book-shop-counter", 14, "book-shop-business")
    ])
  ];
  return seedSocialGraph([...baseCitizens, ...createDistrictCitizens()]);
}
