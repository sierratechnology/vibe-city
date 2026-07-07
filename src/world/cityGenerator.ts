import { AssetPlacement, DoorPointDefinition, GeneratedCity, Size3Data, Vec3Data, assetDefinitionById } from "../assets";

export const CITY_SEED = "stg-world-zero";

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

function buildingPlacement(id: string, label: string, x: number, z: number, size: Size3Data, color: string, side: DoorPointDefinition["side"], tags: string[]): AssetPlacement {
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
    { role: "headquarters" },
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

  result.push(
    placement(
      `${building.id}-entry-pad`,
      "sidewalk-entry-pad",
      { x: doorX, y: 0, z: doorZ },
      { size: { x: 4.2, y: 0.14, z: 2.8 } },
      { buildingId: building.id, doorSide: doorPointData.side },
      `${building.label} Door Pad`,
      ["sidewalk", "entrance", ...(building.tags ?? [])]
    )
  );

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
  const placements: AssetPlacement[] = [];

  placements.push(placement("world-zero-entry-walk", "sidewalk-concrete-strip", { x: 0, y: 0, z: 15 }, { size: { x: 7, y: 0.12, z: 14 } }, {}, "STG Headquarters Entry Walk"));
  placements.push(placement("world-zero-front-pad", "sidewalk-entry-pad", { x: 0, y: 0, z: 12 }, { size: { x: 18, y: 0.14, z: 5 } }, {}, "STG Front Pad"));

  const headquarters = buildingPlacement("stg_headquarters", "STG Headquarters", 0, 0, { x: 18, y: 3.2, z: 15 }, "#4d6875", "south", [
    "stg",
    "headquarters",
    "activeInterior"
  ]);
  placements.push(headquarters);
  addDoorSupportPlacements(placements, headquarters);

  placements.push(placement("spawn-world-zero-player", "prop-map-boundary-marker", { x: 0, y: 0.16, z: 11.2 }, { color: "#f2e6c8" }, { spawnType: "player" }, "World Zero Spawn"));

  return { seed, placements };
}
