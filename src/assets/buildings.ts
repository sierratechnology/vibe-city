import { AssetDefinition } from "./assetTypes";

const baseBuildingMaterial = { roughness: 0.72, opacity: 1 };

export const buildingAssets: AssetDefinition[] = [
  {
    id: "building-district-lowrise",
    name: "District Low-Rise Building",
    category: "building",
    size: { x: 8, y: 2.8, z: 6.6 },
    color: "#6d7885",
    material: baseBuildingMaterial,
    collisionBox: { size: { x: 8, y: 2.8, z: 6.6 } },
    doorPoints: [{ id: "district-main-door", side: "south", offset: { x: 0, y: 0, z: 4.65 }, prompt: "[E] Enter", tags: ["entrance"] }],
    tags: ["building", "exterior", "district"]
  },
  {
    id: "building-apartment-lowrise",
    name: "Apartment Building",
    category: "building",
    size: { x: 9.5, y: 3.1, z: 7.2 },
    color: "#738392",
    material: baseBuildingMaterial,
    collisionBox: { size: { x: 9.5, y: 3.1, z: 7.2 } },
    doorPoints: [{ id: "apartment-main-door", side: "south", offset: { x: 0, y: 0, z: 4.95 }, prompt: "[E] Enter Apartment", targetScene: "apartment", tags: ["apartment", "entrance"] }],
    tags: ["apartment", "building", "exterior", "homeBase"]
  },
  {
    id: "building-casino-lowrise",
    name: "Casino",
    category: "building",
    size: { x: 10.5, y: 3.6, z: 7.7 },
    color: "#c59b39",
    material: baseBuildingMaterial,
    collisionBox: { size: { x: 10.5, y: 3.6, z: 7.7 } },
    doorPoints: [{ id: "casino-main-door", side: "south", offset: { x: 0, y: 0, z: 5.2 }, prompt: "[E] Enter Casino", tags: ["casino", "entrance"] }],
    tags: ["casino", "building", "exterior"]
  },
  {
    id: "building-bar-lowrise",
    name: "Bar",
    category: "building",
    size: { x: 8, y: 2.8, z: 6.7 },
    color: "#8f414b",
    material: baseBuildingMaterial,
    collisionBox: { size: { x: 8, y: 2.8, z: 6.7 } },
    doorPoints: [{ id: "bar-main-door", side: "east", offset: { x: 5.35, y: 0, z: 0 }, prompt: "[E] Enter Bar", targetScene: "bar", tags: ["bar", "entrance"] }],
    tags: ["bar", "building", "exterior", "activeInterior"]
  },
  {
    id: "building-restaurant-lowrise",
    name: "Restaurant",
    category: "building",
    size: { x: 8.8, y: 2.9, z: 6.9 },
    color: "#3d9267",
    material: baseBuildingMaterial,
    collisionBox: { size: { x: 8.8, y: 2.9, z: 6.9 } },
    doorPoints: [{ id: "restaurant-main-door", side: "south", offset: { x: 0, y: 0, z: 4.8 }, prompt: "[E] Enter Restaurant", tags: ["restaurant", "entrance"] }],
    tags: ["restaurant", "building", "exterior"]
  },
  {
    id: "building-music-venue-lowrise",
    name: "Music Venue",
    category: "building",
    size: { x: 10.4, y: 3.2, z: 7.3 },
    color: "#4f67aa",
    material: baseBuildingMaterial,
    collisionBox: { size: { x: 10.4, y: 3.2, z: 7.3 } },
    doorPoints: [{ id: "music-venue-main-door", side: "south", offset: { x: 0, y: 0, z: 5 }, prompt: "[E] Enter Music Venue", tags: ["musicVenue", "entrance"] }],
    tags: ["musicVenue", "building", "exterior"]
  }
];
