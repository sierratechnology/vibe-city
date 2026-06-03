import { AssetDefinition } from "./assetTypes";

export const interiorAssets: AssetDefinition[] = [
  {
    id: "interior-bar-room",
    name: "Bar Interior Room",
    category: "interior",
    size: { x: 18, y: 1.5, z: 16 },
    color: "#3b3230",
    material: { roughness: 0.9 },
    collisionBox: { size: { x: 18, y: 1.5, z: 16 } },
    spawnPoints: [
      { id: "bar-player-entry", offset: { x: 0, y: 0, z: 6 }, tags: ["interior", "bar", "player"] },
      { id: "bar-staff-zone", offset: { x: 0, y: 0, z: -3.2 }, tags: ["interior", "bar", "staff"] }
    ],
    tags: ["interior", "bar"]
  },
  {
    id: "interior-apartment-room",
    name: "Player Apartment Interior Room",
    category: "interior",
    size: { x: 14, y: 1.3, z: 12 },
    color: "#596577",
    material: { roughness: 0.86 },
    spawnPoints: [{ id: "apartment-player-entry", offset: { x: 0, y: 0, z: 4 }, tags: ["interior", "apartment", "player"] }],
    tags: ["interior", "apartment", "customizationFuture"]
  }
];
