import { AssetDefinition } from "./assetTypes";

export const interiorAssets: AssetDefinition[] = [
  {
    id: "interior-stg-headquarters",
    name: "STG Headquarters Interior",
    category: "interior",
    size: { x: 20, y: 1.5, z: 20 },
    color: "#344145",
    material: { roughness: 0.88 },
    collisionBox: { size: { x: 20, y: 1.5, z: 20 } },
    spawnPoints: [{ id: "reception-player-entry", offset: { x: 0, y: 0, z: 3.1 }, tags: ["interior", "stg", "reception", "player"] }],
    tags: ["interior", "stg", "headquarters"]
  }
];
