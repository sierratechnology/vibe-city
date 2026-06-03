import { AssetDefinition } from "./assetTypes";

export const sidewalkAssets: AssetDefinition[] = [
  {
    id: "sidewalk-concrete-strip",
    name: "Concrete Sidewalk Strip",
    category: "sidewalk",
    size: { x: 68, y: 0.12, z: 2.8 },
    color: "#bec1b3",
    material: { roughness: 0.86 },
    tags: ["exterior", "sidewalk", "cityGrid"]
  },
  {
    id: "sidewalk-entry-pad",
    name: "Door Entry Pad",
    category: "sidewalk",
    size: { x: 3.6, y: 0.14, z: 2.8 },
    color: "#e8d27c",
    material: { roughness: 0.7 },
    spawnPoints: [{ id: "entry-center", offset: { x: 0, y: 0.2, z: 0 }, tags: ["entrance", "sidewalk"] }],
    tags: ["exterior", "sidewalk", "entrance"]
  },
  {
    id: "sidewalk-door-connector",
    name: "Door Sidewalk Connector",
    category: "sidewalk",
    size: { x: 2.1, y: 0.1, z: 8 },
    color: "#bec1b3",
    material: { roughness: 0.86 },
    tags: ["exterior", "sidewalk", "connector"]
  }
];
