import { AssetDefinition } from "./assetTypes";

export const signAssets: AssetDefinition[] = [
  {
    id: "sign-building-front",
    name: "Front Building Sign",
    category: "sign",
    size: { x: 4.2, y: 1.05, z: 0.04 },
    color: "#f8f4ea",
    material: { roughness: 0.5 },
    tags: ["sign", "label", "exterior"]
  }
];
