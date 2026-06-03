import { AssetPlacement, DoorPointDefinition, GeneratedCity, Size3Data, Vec3Data, assetDefinitionById } from "../assets";

export const CITY_SEED = "season-001";

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function placement(id: string, assetId: string, position: Vec3Data, overrides: AssetPlacement["overrides"] = {}, metadata: AssetPlacement["metadata"] = {}, label?: string, tags?: string[]): AssetPlacement {
  const source = assetDefinitionById.get(assetId);
  return {
    id,
    assetId,
    position,
    label: label ?? source?.name,
    tags: tags ?? source?.tags,
    overrides,
    metadata
  };
}

function doorPoint(id: string, side: DoorPointDefinition["side"], size: Size3Data, prompt: string, tags: string[]): DoorPointDefinition {
  const offset = {
    north: { x: 0, y: 0, z: -size.z / 2 - 1.35 },
    south: { x: 0, y: 0, z: size.z / 2 + 1.35 },
    east: { x: size.x / 2 + 1.35, y: 0, z: 0 },
    west: { x: -size.x / 2 - 1.35, y: 0, z: 0 }
  }[side];
  return { id, side, offset, prompt, tags };
}

function buildingPlacement(
  id: string,
  label: string,
  x: number,
  z: number,
  size: Size3Data,
  color: string,
  side: DoorPointDefinition["side"],
  tags: string[]
): AssetPlacement {
  return placement(
    id,
    "building-district-lowrise",
    { x, y: 0, z },
    {
      size,
      color,
      collisionBox: { size },
      doorPoints: [doorPoint(`${id}-door`, side, size, `[E] Enter ${label}`, tags)]
    },
    { role: "districtBuilding" },
    label,
    ["building", "exterior", ...tags]
  );
}

function addDoorSupportPlacements(result: AssetPlacement[], building: AssetPlacement): void {
  const definition = assetDefinitionById.get(building.assetId);
  const doorPointData = building.overrides?.doorPoints?.[0] ?? definition?.doorPoints?.[0];
  if (!definition || !doorPointData) return;

  const size = building.overrides?.size ?? definition.size;
  const doorX = building.position.x + doorPointData.offset.x;
  const doorZ = building.position.z + doorPointData.offset.z;
  const isEastWest = doorPointData.side === "east" || doorPointData.side === "west";
  const connectorTarget = isEastWest ? (doorX >= 0 ? 7.2 : -7.2) : doorZ >= 0 ? 7.2 : -7.2;

  result.push(
    placement(
      `${building.id}-entry-pad`,
      "sidewalk-entry-pad",
      { x: doorX, y: 0, z: doorZ },
      { size: { x: isEastWest ? 2.8 : 3.6, y: 0.14, z: isEastWest ? 3.6 : 2.8 } },
      { buildingId: building.id, doorSide: doorPointData.side },
      `${building.label} Door Pad`,
      ["sidewalk", "entrance", ...(building.tags ?? [])]
    )
  );

  if (isEastWest) {
    result.push(
      placement(
        `${building.id}-sidewalk-connector`,
        "sidewalk-door-connector",
        { x: (doorX + connectorTarget) / 2, y: 0, z: doorZ },
        { size: { x: Math.abs(doorX - connectorTarget) + 2.8, y: 0.1, z: 2.1 } },
        { buildingId: building.id, doorSide: doorPointData.side },
        `${building.label} Connector`
      )
    );
  } else {
    result.push(
      placement(
        `${building.id}-sidewalk-connector`,
        "sidewalk-door-connector",
        { x: doorX, y: 0, z: (doorZ + connectorTarget) / 2 },
        { size: { x: 2.1, y: 0.1, z: Math.abs(doorZ - connectorTarget) + 2.8 } },
        { buildingId: building.id, doorSide: doorPointData.side },
        `${building.label} Connector`
      )
    );
  }

  result.push(
    placement(
      `${building.id}-door-spawn-marker`,
      "prop-map-boundary-marker",
      { x: doorX, y: 0.16, z: doorZ },
      { size: { x: 0.25, y: 0.25, z: 0.25 }, color: "#77e1ff" },
      { buildingId: building.id, spawnType: "door" },
      `${building.label} Door Point`
    )
  );

  if (size.x <= 0 || size.z <= 0) throw new Error(`Invalid generated size for ${building.id}`);
}

export function generateCity(seed = CITY_SEED): GeneratedCity {
  const random = createSeededRandom(seed);
  const placements: AssetPlacement[] = [];

  placements.push(placement("road-fremont-east-strip", "road-asphalt-strip", { x: 0, y: 0, z: 0 }, { size: { x: 116, y: 0.08, z: 9.2 } }, {}, "Fremont East Road"));
  placements.push(placement("road-casino-cross", "road-asphalt-strip", { x: 0, y: 0, z: 0 }, { size: { x: 9.2, y: 0.08, z: 94 } }, {}, "Casino Cross Street"));
  placements.push(placement("road-garage-cross", "road-asphalt-strip", { x: 40, y: 0, z: 0 }, { size: { x: 8.2, y: 0.08, z: 92 } }, {}, "Garage Access Road"));
  placements.push(placement("road-apartment-cross", "road-asphalt-strip", { x: -24, y: 0, z: 0 }, { size: { x: 8.2, y: 0.08, z: 92 } }, {}, "Apartment Cross Street"));

  for (const z of [-7.2, 7.2]) {
    placements.push(placement(`sidewalk-strip-${z}`, "sidewalk-concrete-strip", { x: 0, y: 0, z }, { size: { x: 116, y: 0.12, z: 2.8 } }));
  }

  for (const x of [-28, -20, -7.2, 7.2, 36, 44]) {
    placements.push(placement(`sidewalk-cross-${x}`, "sidewalk-concrete-strip", { x, y: 0, z: 0 }, { size: { x: 2.8, y: 0.12, z: 94 } }));
  }

  const buildings = [
    buildingPlacement("apartment-building", "Apartment Building", -22, 24, { x: 10, y: 3.2, z: 7.2 }, "#738392", "south", ["apartment", "homeBase"]),
    buildingPlacement("bar-a", "Bar A", -34, 8, { x: 8, y: 2.8, z: 6.8 }, "#8f414b", "east", ["bar", "activeInterior"]),
    buildingPlacement("bar-b", "Bar B", -46, -9, { x: 8, y: 2.7, z: 6.4 }, "#7e3f72", "south", ["bar", "activeInterior"]),
    buildingPlacement("sports-bar", "Sports Bar", -48, 25, { x: 9, y: 2.9, z: 7.4 }, "#385f8a", "south", ["sports", "bar", "activeInterior"]),
    buildingPlacement("casino", "Casino", 0, 0, { x: 13, y: 3.7, z: 10 }, "#c59b39", "south", ["casino", "activeInterior"]),
    buildingPlacement("restaurant", "Standalone Restaurant", 18, 9, { x: 9, y: 2.9, z: 7 }, "#3d9267", "south", ["restaurant"]),
    buildingPlacement("music-venue", "Music Venue", 16, -13, { x: 10, y: 3.2, z: 7.4 }, "#4f67aa", "south", ["musicVenue"]),
    buildingPlacement("book-shop", "Book Shop", -8, -15, { x: 8.2, y: 2.6, z: 6 }, "#9b6b48", "south", ["bookShop", "retail"]),
    buildingPlacement("parking-garage", "Parking Garage", 41, 24, { x: 14, y: 4.1, z: 8.5 }, "#59636e", "south", ["parkingGarage", "portal"]),
    buildingPlacement("coffee-shop", "Coffee Shop", -48, 10, { x: 7.2, y: 2.5, z: 5.8 }, "#5c8a7a", "south", ["coffee"]),
    buildingPlacement("convenience-store", "Convenience Store", 34, -13, { x: 8.6, y: 2.5, z: 6 }, "#697e41", "south", ["convenience"]),
    buildingPlacement("barber-shop", "Barber Shop", 47, -12, { x: 7.4, y: 2.5, z: 5.8 }, "#3f8291", "south", ["barber"]),
    buildingPlacement("bank", "Bank", 48, 10, { x: 8.5, y: 3, z: 6.4 }, "#566b94", "south", ["bank"]),
    buildingPlacement("office-building", "Office Building", -18, -30, { x: 12, y: 4.3, z: 8 }, "#6f7787", "south", ["office"]),
    buildingPlacement("retail-store", "Retail Store", 29, 11, { x: 7.6, y: 2.5, z: 5.8 }, "#9b6f53", "south", ["retail"]),
    buildingPlacement("small-hotel", "Small Hotel", 36, -31, { x: 12, y: 4, z: 8 }, "#8a7d69", "south", ["hotel"]),
    buildingPlacement("vacant-lease-1", "Vacant Lease Space", -34, -13, { x: 7.8, y: 2.4, z: 5.8 }, "#78806f", "south", ["vacant", "lease"]),
    buildingPlacement("vacant-lease-2", "Vacant Lease Space", 5, 24, { x: 7.8, y: 2.4, z: 5.8 }, "#78806f", "south", ["vacant", "lease"])
  ];

  for (const building of buildings) {
    placements.push(building);
    addDoorSupportPlacements(placements, building);
  }

  const cityEdgeSpawns = [
    { id: "spawn-west-residential-edge", x: -57, z: 18 },
    { id: "spawn-east-residential-edge", x: 57, z: -16 },
    { id: "spawn-southwest-residential-edge", x: -57, z: -30 },
    { id: "spawn-southeast-residential-edge", x: 57, z: 30 },
    { id: "spawn-parking-garage-return", x: 41, z: 29.6 }
  ];

  for (const spawn of cityEdgeSpawns) {
    const jitter = (random() - 0.5) * 0.2;
    placements.push(placement(spawn.id, "prop-map-boundary-marker", { x: spawn.x + jitter, y: 0.16, z: spawn.z - jitter }, { color: "#f2e6c8" }, { spawnType: "citizenEdge" }, spawn.id));
  }

  return { seed, placements };
}
