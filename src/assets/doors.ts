import { AssetDefinition } from "./assetTypes";

export const doorAssets: AssetDefinition[] = [
  {
    id: "door-dark-single",
    name: "High Contrast Single Door",
    category: "door",
    size: { x: 1.7, y: 2.2, z: 0.18 },
    color: "#070a0f",
    material: { roughness: 0.8 },
    spawnPoints: [{ id: "door-point", offset: { x: 0, y: 0.2, z: 0 }, tags: ["entrance", "door"] }],
    tags: ["door", "entrance", "exterior"]
  }
];
