export type SceneName = "outside" | "headquarters";

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

export const DISTRICT_ID = "stg_world";
export const DISTRICT_NAME = "World Zero - STG Headquarters";
export const WORLD_LIMIT = 58;

export const DOOR_PORTALS: DoorPortal[] = [
  {
    id: "headquarters-main",
    buildingId: "stg_headquarters",
    exteriorPosition: { x: 0, z: 8.85 },
    interiorPosition: { x: 0, z: 9.2 },
    facingDirection: "south",
    width: 3.4,
    linkedScene: "headquarters",
    linkedDoorId: "stg-headquarters-exit"
  }
];

export const BUSINESSES: BusinessEntity[] = [
  {
    id: "stg-headquarters-operations",
    name: "STG Headquarters Operations",
    buildingId: "stg_headquarters",
    category: "headquarters",
    scene: "headquarters",
    openHours: "24h",
    tags: ["stg", "headquarters", "executive-office"]
  }
];

export const WORKSTATIONS: Workstation[] = [
  { id: "reception", buildingId: "stg_headquarters", scene: "headquarters", name: "Reception Area", roleTags: ["reception", "assistant"], position: { x: 0, z: 5.2 } },
  { id: "meeting_boardroom", buildingId: "stg_headquarters", scene: "headquarters", name: "Meeting / Boardroom", roleTags: ["meeting", "boardroom"], position: { x: -6.6, z: -2.9 } },
  { id: "assistant_office", buildingId: "stg_headquarters", scene: "headquarters", name: "Assistant Office", roleTags: ["assistant", "office"], position: { x: -6.4, z: 2.6 } },
  { id: "devon_executive_office", buildingId: "stg_headquarters", scene: "headquarters", name: "Devon's Executive Office", roleTags: ["executive", "devon"], position: { x: 6.4, z: -2.9 } },
  { id: "projects_updates_office", buildingId: "stg_headquarters", scene: "headquarters", name: "Projects & Updates Office", roleTags: ["projects", "updates"], position: { x: 6.4, z: 2.6 } },
  { id: "entrance_exit_door", buildingId: "stg_headquarters", scene: "headquarters", name: "Entrance / Exit Door", roleTags: ["door", "portal"], position: { x: 0, z: 8.1 } }
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
