import { AssetDefinition } from "./assetTypes";

const baseBuildingMaterial = { roughness: 0.72, opacity: 1 };

export const buildingAssets: AssetDefinition[] = [
  {
    id: "building-district-lowrise",
    name: "STG Single-Story Headquarters",
    category: "building",
    size: { x: 18, y: 3.2, z: 15 },
    color: "#4d6875",
    material: baseBuildingMaterial,
    collisionBox: { size: { x: 18, y: 3.2, z: 15 } },
    doorPoints: [{ id: "stg-headquarters-main-door", side: "south", offset: { x: 0, y: 0, z: 8.85 }, prompt: "[E] Enter STG Headquarters", targetScene: "headquarters", tags: ["stg", "headquarters", "entrance"] }],
    tags: ["stg", "headquarters", "building", "exterior", "activeInterior"]
  }
];
