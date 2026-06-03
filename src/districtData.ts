export type SceneName = "outside" | "apartment" | "barA" | "barB" | "sportsBar" | "casino" | "restaurant" | "bookShop" | "musicVenue" | "parkingGarage";

export type DoorPortal = {
  id: string;
  buildingId: string;
  exteriorPosition: { x: number; z: number };
  interiorPosition: { x: number; z: number };
  facingDirection: "north" | "south" | "east" | "west";
  width: number;
  linkedScene: SceneName | "off_district";
  linkedDoorId: string;
};

export type BusinessEntity = {
  id: string;
  name: string;
  buildingId: string;
  category: string;
  scene: SceneName | "none";
  tags: string[];
  openHours: "24h" | { startMinute: number; endMinute: number };
  vacant?: boolean;
  lease?: {
    propertyId: string;
    operatorBusinessId: string;
  };
};

export type Workstation = {
  id: string;
  buildingId: string;
  scene: SceneName;
  name: string;
  roleTags: string[];
  position: { x: number; z: number };
};

export const DISTRICT_ID = "district-1-fremont-east";
export const DISTRICT_NAME = "District 1 - Fremont East";
export const WORLD_LIMIT = 58;

export const DOOR_PORTALS: DoorPortal[] = [
  {
    id: "apartment-main",
    buildingId: "apartment-building",
    exteriorPosition: { x: -22, z: 28.95 },
    interiorPosition: { x: 0, z: 5.5 },
    facingDirection: "south",
    width: 2.8,
    linkedScene: "apartment",
    linkedDoorId: "apartment-exit"
  },
  {
    id: "bar-a-main",
    buildingId: "bar-a",
    exteriorPosition: { x: -28.6, z: 8 },
    interiorPosition: { x: 0, z: 7.6 },
    facingDirection: "east",
    width: 2.6,
    linkedScene: "barA",
    linkedDoorId: "bar-a-exit"
  },
  {
    id: "casino-main",
    buildingId: "casino",
    exteriorPosition: { x: 0, z: 6.35 },
    interiorPosition: { x: 0, z: 12.6 },
    facingDirection: "south",
    width: 3.2,
    linkedScene: "casino",
    linkedDoorId: "casino-exit"
  },
  {
    id: "bar-b-main",
    buildingId: "bar-b",
    exteriorPosition: { x: -46, z: -4.45 },
    interiorPosition: { x: 0, z: 7.6 },
    facingDirection: "south",
    width: 2.6,
    linkedScene: "barB",
    linkedDoorId: "bar-b-exit"
  },
  {
    id: "sports-bar-main",
    buildingId: "sports-bar",
    exteriorPosition: { x: -48, z: 31.05 },
    interiorPosition: { x: 0, z: 8.2 },
    facingDirection: "south",
    width: 2.8,
    linkedScene: "sportsBar",
    linkedDoorId: "sports-bar-exit"
  },
  {
    id: "restaurant-main",
    buildingId: "restaurant",
    exteriorPosition: { x: 18, z: 13.85 },
    interiorPosition: { x: 0, z: 7.4 },
    facingDirection: "south",
    width: 2.6,
    linkedScene: "restaurant",
    linkedDoorId: "restaurant-exit"
  },
  {
    id: "book-shop-main",
    buildingId: "book-shop",
    exteriorPosition: { x: -8, z: -11.65 },
    interiorPosition: { x: 0, z: 6.8 },
    facingDirection: "south",
    width: 2.4,
    linkedScene: "bookShop",
    linkedDoorId: "book-shop-exit"
  },
  {
    id: "music-venue-main",
    buildingId: "music-venue",
    exteriorPosition: { x: 16, z: -9.65 },
    interiorPosition: { x: 0, z: 8.2 },
    facingDirection: "south",
    width: 3,
    linkedScene: "musicVenue",
    linkedDoorId: "music-venue-exit"
  },
  {
    id: "parking-garage-main",
    buildingId: "parking-garage",
    exteriorPosition: { x: 41, z: 29.6 },
    interiorPosition: { x: 0, z: 6.8 },
    facingDirection: "south",
    width: 4,
    linkedScene: "parkingGarage",
    linkedDoorId: "parking-garage-exit"
  },
  {
    id: "coffee-shop-main",
    buildingId: "coffee-shop",
    exteriorPosition: { x: -48, z: 14.25 },
    interiorPosition: { x: -48, z: 14.25 },
    facingDirection: "south",
    width: 2.2,
    linkedScene: "outside",
    linkedDoorId: "coffee-shop-service"
  },
  {
    id: "convenience-store-main",
    buildingId: "convenience-store",
    exteriorPosition: { x: 34, z: -9.65 },
    interiorPosition: { x: 34, z: -9.65 },
    facingDirection: "south",
    width: 2.2,
    linkedScene: "outside",
    linkedDoorId: "convenience-store-service"
  },
  {
    id: "barber-shop-main",
    buildingId: "barber-shop",
    exteriorPosition: { x: 47, z: -8.75 },
    interiorPosition: { x: 47, z: -8.75 },
    facingDirection: "south",
    width: 2.2,
    linkedScene: "outside",
    linkedDoorId: "barber-shop-service"
  },
  {
    id: "bank-main",
    buildingId: "bank",
    exteriorPosition: { x: 48, z: 14.55 },
    interiorPosition: { x: 48, z: 14.55 },
    facingDirection: "south",
    width: 2.4,
    linkedScene: "outside",
    linkedDoorId: "bank-service"
  },
  {
    id: "small-hotel-main",
    buildingId: "small-hotel",
    exteriorPosition: { x: 36, z: -25.65 },
    interiorPosition: { x: 36, z: -25.65 },
    facingDirection: "south",
    width: 2.6,
    linkedScene: "outside",
    linkedDoorId: "small-hotel-service"
  },
  {
    id: "parking-garage-portal",
    buildingId: "parking-garage",
    exteriorPosition: { x: 41, z: 29.6 },
    interiorPosition: { x: 41, z: 29.6 },
    facingDirection: "south",
    width: 4,
    linkedScene: "off_district",
    linkedDoorId: "district-1-return"
  }
];

export const BUSINESSES: BusinessEntity[] = [
  { id: "player-home", name: "Player Apartment", buildingId: "apartment-building", category: "home", scene: "apartment", openHours: "24h", tags: ["apartment", "home"] },
  { id: "bar-a-business", name: "Bar A", buildingId: "bar-a", category: "bar", scene: "barA", openHours: { startMinute: 14 * 60, endMinute: 2 * 60 }, tags: ["bar", "active"] },
  { id: "bar-b-business", name: "Bar B", buildingId: "bar-b", category: "bar", scene: "barB", openHours: { startMinute: 16 * 60, endMinute: 2 * 60 }, tags: ["bar", "active"] },
  { id: "sports-bar-business", name: "Sports Bar", buildingId: "sports-bar", category: "bar", scene: "sportsBar", openHours: { startMinute: 11 * 60, endMinute: 2 * 60 }, tags: ["bar", "sports", "active"] },
  { id: "casino-business", name: "Casino", buildingId: "casino", category: "casino", scene: "casino", openHours: "24h", tags: ["casino", "active"] },
  { id: "standalone-restaurant", name: "Standalone Restaurant", buildingId: "restaurant", category: "restaurant", scene: "restaurant", openHours: { startMinute: 11 * 60, endMinute: 23 * 60 }, tags: ["restaurant", "active"] },
  {
    id: "casino-restaurant-operator",
    name: "Casino Restaurant Lease Space",
    buildingId: "casino",
    category: "restaurant",
    scene: "casino",
    openHours: { startMinute: 11 * 60, endMinute: 23 * 60 },
    tags: ["restaurant", "lease", "casino"],
    lease: { propertyId: "casino-business", operatorBusinessId: "casino-restaurant-operator" }
  },
  { id: "music-venue-business", name: "Music Venue", buildingId: "music-venue", category: "venue", scene: "musicVenue", openHours: { startMinute: 18 * 60, endMinute: 2 * 60 }, tags: ["musicVenue", "active"] },
  { id: "book-shop-business", name: "Book Shop", buildingId: "book-shop", category: "retail", scene: "bookShop", openHours: { startMinute: 10 * 60, endMinute: 18 * 60 }, tags: ["bookShop", "active"] },
  { id: "parking-garage-business", name: "Parking Garage", buildingId: "parking-garage", category: "portal", scene: "parkingGarage", openHours: "24h", tags: ["parkingGarage", "portal", "active"] },
  { id: "apartment-operations", name: "Apartment Building Operations", buildingId: "apartment-building", category: "property", scene: "outside", openHours: "24h", tags: ["apartment", "operations", "active"] },
  { id: "coffee-shop-business", name: "Coffee Shop", buildingId: "coffee-shop", category: "cafe", scene: "outside", openHours: { startMinute: 7 * 60, endMinute: 17 * 60 }, tags: ["coffee", "active"] },
  { id: "convenience-store-business", name: "Convenience Store", buildingId: "convenience-store", category: "retail", scene: "outside", openHours: "24h", tags: ["convenience", "active"] },
  { id: "barber-shop-business", name: "Barber Shop", buildingId: "barber-shop", category: "service", scene: "outside", openHours: { startMinute: 9 * 60, endMinute: 19 * 60 }, tags: ["barber", "active"] },
  { id: "bank-business", name: "Bank", buildingId: "bank", category: "financial", scene: "outside", openHours: { startMinute: 9 * 60, endMinute: 17 * 60 }, tags: ["bank", "active"] },
  { id: "small-hotel-business", name: "Small Hotel", buildingId: "small-hotel", category: "hotel", scene: "outside", openHours: "24h", tags: ["hotel", "active"] },
  { id: "vacant-lease-1", name: "Vacant Lease Space", buildingId: "vacant-lease-1", category: "lease", scene: "none", openHours: "24h", vacant: true, tags: ["vacant"] }
];

export const WORKSTATIONS: Workstation[] = [
  { id: "bar-a-manager", buildingId: "bar-a", scene: "barA", name: "Manager Station", roleTags: ["manager", "bar"], position: { x: -4.7, z: -3.4 } },
  { id: "bar-a-tap-1", buildingId: "bar-a", scene: "barA", name: "Bar Station 1", roleTags: ["bartender", "bar"], position: { x: -1.8, z: -3.25 } },
  { id: "bar-a-tap-2", buildingId: "bar-a", scene: "barA", name: "Bar Station 2", roleTags: ["bartender", "bar"], position: { x: 1.4, z: -3.25 } },
  { id: "bar-a-customer-floor", buildingId: "bar-a", scene: "barA", name: "Bar A Customer Floor", roleTags: ["customer", "bar", "social"], position: { x: 0, z: 3.2 } },
  { id: "bar-b-manager", buildingId: "bar-b", scene: "barB", name: "Manager Station", roleTags: ["manager", "bar"], position: { x: -4.7, z: -3.4 } },
  { id: "bar-b-tap-1", buildingId: "bar-b", scene: "barB", name: "Bar Station 1", roleTags: ["bartender", "bar"], position: { x: -1.8, z: -3.25 } },
  { id: "bar-b-tap-2", buildingId: "bar-b", scene: "barB", name: "Bar Station 2", roleTags: ["bartender", "bar"], position: { x: 1.4, z: -3.25 } },
  { id: "bar-b-customer-floor", buildingId: "bar-b", scene: "barB", name: "Bar B Customer Floor", roleTags: ["customer", "bar", "social"], position: { x: 0, z: 3.2 } },
  { id: "sports-bar-manager", buildingId: "sports-bar", scene: "sportsBar", name: "Sports Bar Manager Station", roleTags: ["manager", "sports", "bar"], position: { x: -5.2, z: -3.8 } },
  { id: "sports-bar-tap-1", buildingId: "sports-bar", scene: "sportsBar", name: "Sports Bar Station 1", roleTags: ["bartender", "sports", "bar"], position: { x: -1.7, z: -3.7 } },
  { id: "sports-bar-tap-2", buildingId: "sports-bar", scene: "sportsBar", name: "Sports Bar Station 2", roleTags: ["bartender", "sports", "bar"], position: { x: 1.7, z: -3.7 } },
  { id: "sports-bar-server-floor", buildingId: "sports-bar", scene: "sportsBar", name: "Sports Bar Server Floor", roleTags: ["server", "sports", "bar"], position: { x: 4.5, z: 2.2 } },
  { id: "sports-bar-watch-area", buildingId: "sports-bar", scene: "sportsBar", name: "Sports Bar Watch Area", roleTags: ["customer", "sports", "social"], position: { x: 0, z: 4.2 } },
  { id: "casino-manager-floor", buildingId: "casino", scene: "casino", name: "Casino Manager Floor", roleTags: ["manager", "casino"], position: { x: -8.5, z: 0 } },
  { id: "blackjack-table", buildingId: "casino", scene: "casino", name: "Blackjack Table", roleTags: ["dealer", "blackjack"], position: { x: -4.8, z: 0.8 } },
  { id: "roulette-table", buildingId: "casino", scene: "casino", name: "Roulette Table", roleTags: ["dealer", "roulette"], position: { x: 0, z: 0.8 } },
  { id: "three-card-poker-table", buildingId: "casino", scene: "casino", name: "Three Card Poker Table", roleTags: ["dealer", "poker"], position: { x: 4.8, z: 0.8 } },
  { id: "dealer-break-room", buildingId: "casino", scene: "casino", name: "Dealer Break Room", roleTags: ["break"], position: { x: 8.2, z: -8.2 } },
  { id: "cocktail-floor", buildingId: "casino", scene: "casino", name: "Cocktail Service Route", roleTags: ["cocktail"], position: { x: -6.5, z: 5.5 } },
  { id: "security-entrance", buildingId: "casino", scene: "casino", name: "Security Entrance Post", roleTags: ["security"], position: { x: 0, z: 9.4 } },
  { id: "security-slot-floor", buildingId: "casino", scene: "casino", name: "Security Slot Patrol", roleTags: ["security"], position: { x: -8, z: 5.2 } },
  { id: "surveillance-room", buildingId: "casino", scene: "casino", name: "Surveillance Room", roleTags: ["surveillance"], position: { x: -8.8, z: -8.5 } },
  { id: "cage-window-1", buildingId: "casino", scene: "casino", name: "Cage Window", roleTags: ["cashier"], position: { x: 8.4, z: 4.5 } },
  { id: "maintenance-route", buildingId: "casino", scene: "casino", name: "Facilities Route", roleTags: ["maintenance"], position: { x: 7.5, z: -3.8 } },
  { id: "casino-restaurant-host", buildingId: "casino", scene: "casino", name: "Restaurant Host Stand", roleTags: ["restaurant", "host"], position: { x: -3, z: -8.8 } },
  { id: "casino-restaurant-kitchen", buildingId: "casino", scene: "casino", name: "Restaurant Kitchen", roleTags: ["restaurant", "cook"], position: { x: -0.5, z: -8.8 } },
  { id: "casino-restaurant-service", buildingId: "casino", scene: "casino", name: "Restaurant Service Counter", roleTags: ["restaurant", "server"], position: { x: 2.7, z: -8.8 } },
  { id: "restaurant-manager", buildingId: "restaurant", scene: "restaurant", name: "Restaurant Manager Station", roleTags: ["restaurant", "manager"], position: { x: -5, z: -3.8 } },
  { id: "restaurant-host", buildingId: "restaurant", scene: "restaurant", name: "Host Stand", roleTags: ["restaurant", "host"], position: { x: -3.4, z: 4.7 } },
  { id: "restaurant-server-floor", buildingId: "restaurant", scene: "restaurant", name: "Dining Room", roleTags: ["restaurant", "server", "social"], position: { x: 2.8, z: 2.5 } },
  { id: "restaurant-kitchen", buildingId: "restaurant", scene: "restaurant", name: "Kitchen Line", roleTags: ["restaurant", "cook"], position: { x: 3.7, z: -4.3 } },
  { id: "restaurant-dish", buildingId: "restaurant", scene: "restaurant", name: "Dish Pit", roleTags: ["restaurant", "dish"], position: { x: 5.6, z: -4.3 } },
  { id: "book-shop-counter", buildingId: "book-shop", scene: "bookShop", name: "Book Shop Counter", roleTags: ["retail", "cashier"], position: { x: -3.8, z: -3.3 } },
  { id: "book-shop-reading-area", buildingId: "book-shop", scene: "bookShop", name: "Reading Area", roleTags: ["customer", "books", "quiet"], position: { x: 2.8, z: 2.5 } },
  { id: "music-venue-manager", buildingId: "music-venue", scene: "musicVenue", name: "Venue Manager Station", roleTags: ["music", "manager"], position: { x: -5.4, z: -3.5 } },
  { id: "music-venue-bar", buildingId: "music-venue", scene: "musicVenue", name: "Venue Bar", roleTags: ["music", "bartender"], position: { x: 4.5, z: -3.5 } },
  { id: "music-venue-door", buildingId: "music-venue", scene: "musicVenue", name: "Door Post", roleTags: ["music", "door"], position: { x: 0, z: 5.2 } },
  { id: "music-venue-sound", buildingId: "music-venue", scene: "musicVenue", name: "Sound Booth", roleTags: ["music", "tech"], position: { x: -4.5, z: 2.8 } },
  { id: "music-venue-floor", buildingId: "music-venue", scene: "musicVenue", name: "Stage Floor", roleTags: ["customer", "music", "social"], position: { x: 1.6, z: 0.8 } },
  { id: "parking-garage-attendant", buildingId: "parking-garage", scene: "parkingGarage", name: "Garage Attendant Booth", roleTags: ["parking", "attendant"], position: { x: -3.6, z: -2.8 } },
  { id: "parking-garage-security", buildingId: "parking-garage", scene: "parkingGarage", name: "Garage Security Post", roleTags: ["parking", "security"], position: { x: 3.4, z: -1.2 } },
  { id: "parking-garage-portal-station", buildingId: "parking-garage", scene: "parkingGarage", name: "Off-District Portal", roleTags: ["portal"], position: { x: 0, z: -5.8 } },
  { id: "parking-garage-manager", buildingId: "parking-garage", scene: "parkingGarage", name: "Garage Manager Desk", roleTags: ["parking", "manager"], position: { x: -5.8, z: -2.8 } },
  { id: "apartment-property-manager", buildingId: "apartment-building", scene: "outside", name: "Apartment Property Office", roleTags: ["apartment", "manager"], position: { x: -24.2, z: 29.2 } },
  { id: "apartment-maintenance", buildingId: "apartment-building", scene: "outside", name: "Apartment Maintenance Post", roleTags: ["apartment", "maintenance"], position: { x: -20.2, z: 29.2 } },
  { id: "apartment-front-desk", buildingId: "apartment-building", scene: "outside", name: "Apartment Front Desk Security", roleTags: ["apartment", "security"], position: { x: -22, z: 29.8 } },
  { id: "coffee-manager", buildingId: "coffee-shop", scene: "outside", name: "Coffee Shop Manager Post", roleTags: ["coffee", "manager"], position: { x: -50.4, z: 14.4 } },
  { id: "coffee-barista", buildingId: "coffee-shop", scene: "outside", name: "Coffee Barista Counter", roleTags: ["coffee", "barista"], position: { x: -47.2, z: 14.4 } },
  { id: "convenience-manager", buildingId: "convenience-store", scene: "outside", name: "Convenience Manager Post", roleTags: ["convenience", "manager"], position: { x: 32.6, z: -9.2 } },
  { id: "convenience-clerk", buildingId: "convenience-store", scene: "outside", name: "Convenience Clerk Counter", roleTags: ["convenience", "clerk"], position: { x: 35.4, z: -9.2 } },
  { id: "barber-manager", buildingId: "barber-shop", scene: "outside", name: "Barber Owner Station", roleTags: ["barber", "manager"], position: { x: 45.4, z: -8.4 } },
  { id: "barber-chair", buildingId: "barber-shop", scene: "outside", name: "Barber Chair", roleTags: ["barber"], position: { x: 48.2, z: -8.4 } },
  { id: "bank-manager", buildingId: "bank", scene: "outside", name: "Bank Manager Office", roleTags: ["bank", "manager"], position: { x: 45.8, z: 14.8 } },
  { id: "bank-teller", buildingId: "bank", scene: "outside", name: "Bank Teller Window", roleTags: ["bank", "teller"], position: { x: 48.6, z: 14.8 } },
  { id: "bank-security", buildingId: "bank", scene: "outside", name: "Bank Security Post", roleTags: ["bank", "security"], position: { x: 50.8, z: 14.8 } },
  { id: "hotel-manager", buildingId: "small-hotel", scene: "outside", name: "Hotel Manager Desk", roleTags: ["hotel", "manager"], position: { x: 33.4, z: -25.2 } },
  { id: "hotel-front-desk", buildingId: "small-hotel", scene: "outside", name: "Hotel Front Desk", roleTags: ["hotel", "frontDesk"], position: { x: 36, z: -25.2 } },
  { id: "hotel-housekeeping", buildingId: "small-hotel", scene: "outside", name: "Hotel Housekeeping Station", roleTags: ["hotel", "housekeeping"], position: { x: 38.6, z: -25.2 } },
  { id: "hotel-maintenance", buildingId: "small-hotel", scene: "outside", name: "Hotel Maintenance Post", roleTags: ["hotel", "maintenance"], position: { x: 40.2, z: -25.2 } }
];

export function portalById(id: string): DoorPortal {
  const portal = DOOR_PORTALS.find((door) => door.id === id);
  if (!portal) throw new Error(`Unknown door portal: ${id}`);
  return portal;
}

export function workstationById(id: string): Workstation {
  const workstation = WORKSTATIONS.find((station) => station.id === id);
  if (!workstation) throw new Error(`Unknown workstation: ${id}`);
  return workstation;
}

export function isBusinessOpen(business: BusinessEntity, minuteOfDay: number): boolean {
  if (business.openHours === "24h") return true;
  const { startMinute, endMinute } = business.openHours;
  if (startMinute <= endMinute) return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}
