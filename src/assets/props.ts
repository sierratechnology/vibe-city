import { AssetDefinition } from "./assetTypes";

export const propAssets: AssetDefinition[] = [
  {
    id: "prop-door-awning",
    name: "Door Awning",
    category: "prop",
    size: { x: 2.4, y: 0.28, z: 0.45 },
    color: "#f2e6c8",
    material: { roughness: 0.7 },
    tags: ["prop", "entrance", "exterior"]
  },
  {
    id: "prop-map-boundary-marker",
    name: "City Boundary Marker",
    category: "prop",
    size: { x: 0.2, y: 0.2, z: 0.2 },
    color: "#f2e6c8",
    material: { roughness: 0.6 },
    tags: ["prop", "debug", "bounds"]
  }
];
