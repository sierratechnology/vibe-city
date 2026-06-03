export type AssetCategory = "road" | "sidewalk" | "building" | "door" | "sign" | "prop" | "interior" | "workstation" | "spawnPoint" | "portal";

export type Vec3Data = {
  x: number;
  y: number;
  z: number;
};

export type Size3Data = {
  x: number;
  y: number;
  z: number;
};

export type CollisionBoxDefinition = {
  size: Size3Data;
  offset?: Vec3Data;
};

export type DoorPointDefinition = {
  id: string;
  side: "north" | "south" | "east" | "west";
  offset: Vec3Data;
  prompt: string;
  targetScene?: string;
  tags: string[];
};

export type SpawnPointDefinition = {
  id: string;
  offset: Vec3Data;
  tags: string[];
};

export type AssetDefinition = {
  id: string;
  name: string;
  category: AssetCategory;
  size: Size3Data;
  color: string;
  material: {
    roughness?: number;
    metalness?: number;
    opacity?: number;
  };
  collisionBox?: CollisionBoxDefinition;
  doorPoints?: DoorPointDefinition[];
  spawnPoints?: SpawnPointDefinition[];
  tags: string[];
  placementRules?: Record<string, string | number | boolean>;
};

export type AssetPlacement = {
  id: string;
  assetId: string;
  position: Vec3Data;
  rotationY?: number;
  label?: string;
  tags?: string[];
  overrides?: Partial<Pick<AssetDefinition, "size" | "color" | "material" | "collisionBox" | "doorPoints" | "spawnPoints">>;
  metadata?: Record<string, string | number | boolean>;
};

export type GeneratedCity = {
  seed: string;
  placements: AssetPlacement[];
};
