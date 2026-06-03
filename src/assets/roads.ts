import { AssetDefinition } from "./assetTypes";

export const roadAssets: AssetDefinition[] = [
  {
    id: "road-asphalt-strip",
    name: "Asphalt Road Strip",
    category: "road",
    size: { x: 68, y: 0.08, z: 8.4 },
    color: "#2c333a",
    material: { roughness: 0.88 },
    tags: ["exterior", "road", "cityGrid"]
  }
];
