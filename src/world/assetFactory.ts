import * as THREE from "three";
import { AssetDefinition, AssetPlacement, GeneratedCity, Vec3Data, assetDefinitionById } from "../assets";

export type WorldCollider = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type WorldBuildingRuntime = {
  name: string;
  group: THREE.Group;
  occluder: THREE.Mesh;
  materials: THREE.Material[];
  roof: THREE.Mesh;
};

export type WorldAssetBuildResult = {
  colliders: WorldCollider[];
  buildings: WorldBuildingRuntime[];
  debugGroup: THREE.Group;
  assetCount: number;
};

const PLAYER_COLLISION_PADDING = 0.55;

function hexColor(value: string): number {
  return new THREE.Color(value).getHex();
}

function resolvedDefinition(definition: AssetDefinition, placement: AssetPlacement): AssetDefinition {
  return {
    ...definition,
    ...placement.overrides,
    material: { ...definition.material, ...placement.overrides?.material },
    tags: placement.tags ?? definition.tags
  };
}

function addBox(parent: THREE.Group, size: Vec3Data, position: Vec3Data, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.set(position.x, position.y + size.y / 2, position.z);
  mesh.castShadow = size.y > 0.3;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createLabelSprite(text: string, width = 512, height = 128, fontSize = 42, background = "transparent"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  if (background !== "transparent") {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.fillStyle = "#f8f4ea";
  context.font = `700 ${fontSize}px Arial`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, width / 2, height / 2, width - 36);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
}

function createSignMaterial(text: string): THREE.MeshBasicMaterial {
  const sprite = createLabelSprite(text, 512, 128, 42, "#1f2630");
  return new THREE.MeshBasicMaterial({ map: (sprite.material as THREE.SpriteMaterial).map, transparent: true });
}

function addCollider(colliders: WorldCollider[], x: number, z: number, width: number, depth: number, radius = PLAYER_COLLISION_PADDING): void {
  colliders.push({
    minX: x - width / 2 - radius,
    maxX: x + width / 2 + radius,
    minZ: z - depth / 2 - radius,
    maxZ: z + depth / 2 + radius
  });
}

function makeDebugLabel(text: string, position: THREE.Vector3): THREE.Sprite {
  const label = createLabelSprite(text, 384, 96, 28, "rgba(8, 12, 18, 0.65)");
  label.position.copy(position);
  label.scale.set(4, 1, 1);
  label.renderOrder = 30;
  return label;
}

function addDebugBox(debugGroup: THREE.Group, id: string, x: number, z: number, width: number, depth: number, height: number): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({ color: 0x78e4ff, transparent: true, opacity: 0.12, depthWrite: false })
  );
  mesh.position.set(x, height / 2 + 0.05, z);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x78e4ff }));
  edges.position.copy(mesh.position);
  debugGroup.add(mesh, edges, makeDebugLabel(id, new THREE.Vector3(x, height + 0.75, z)));
}

function addDebugPoint(debugGroup: THREE.Group, id: string, position: THREE.Vector3, color: number): void {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), new THREE.MeshBasicMaterial({ color, depthTest: false }));
  marker.position.copy(position);
  marker.renderOrder = 31;
  debugGroup.add(marker, makeDebugLabel(id, position.clone().add(new THREE.Vector3(0, 0.55, 0))));
}

function createGround(parent: THREE.Group): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(116, 116),
    new THREE.MeshStandardMaterial({ color: 0x5d6b64, roughness: 0.92 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  parent.add(ground);

  const gridHelper = new THREE.GridHelper(116, 58, 0xf2e6c8, 0x8f968b);
  gridHelper.position.y = 0.08;
  gridHelper.visible = false;
  gridHelper.name = "debug-grid";
  parent.add(gridHelper);
}

function buildFlatAsset(parent: THREE.Group, debugGroup: THREE.Group, definition: AssetDefinition, placement: AssetPlacement): void {
  const resolved = resolvedDefinition(definition, placement);
  if (resolved.tags.includes("debug")) {
    addDebugPoint(debugGroup, placement.id, new THREE.Vector3(placement.position.x, placement.position.y + 0.35, placement.position.z), 0xf2e6c8);
    return;
  }

  const material = new THREE.MeshStandardMaterial({ color: hexColor(resolved.color), roughness: resolved.material.roughness ?? 0.8 });
  addBox(parent, resolved.size, placement.position, material);
  addDebugPoint(debugGroup, placement.id, new THREE.Vector3(placement.position.x, 0.55, placement.position.z), 0xf2e6c8);
}

function buildBuilding(parent: THREE.Group, debugGroup: THREE.Group, colliders: WorldCollider[], buildings: WorldBuildingRuntime[], definition: AssetDefinition, placement: AssetPlacement): void {
  const resolved = resolvedDefinition(definition, placement);
  const group = new THREE.Group();
  group.position.set(placement.position.x, placement.position.y, placement.position.z);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: hexColor(resolved.color), roughness: resolved.material.roughness ?? 0.72, transparent: true });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x202833, roughness: 0.65, transparent: true });
  const doorDefinition = assetDefinitionById.get("door-dark-single");
  const signDefinition = assetDefinitionById.get("sign-building-front");
  const awningDefinition = assetDefinitionById.get("prop-door-awning");
  if (!doorDefinition || !signDefinition || !awningDefinition) {
    throw new Error("Door, sign, and awning asset definitions are required for building generation.");
  }

  const trimMaterial = new THREE.MeshStandardMaterial({ color: hexColor(awningDefinition.color), roughness: awningDefinition.material.roughness ?? 0.7, transparent: true });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: hexColor(doorDefinition.color), roughness: doorDefinition.material.roughness ?? 0.8, transparent: true });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(resolved.size.x, resolved.size.y, resolved.size.z), wallMaterial);
  walls.position.y = resolved.size.y / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(resolved.size.x + 0.75, 0.42, resolved.size.z + 0.75), roofMaterial);
  roof.position.y = resolved.size.y + 0.24;
  roof.castShadow = true;
  group.add(roof);

  const label = createLabelSprite(placement.label ?? resolved.name);
  label.position.set(0, resolved.size.y + 1.25, 0);
  label.scale.set(8.5, 2.1, 1);
  group.add(label);

  const doorPoint = resolved.doorPoints?.[0];
  const signMaterial = createSignMaterial(placement.label ?? resolved.name);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(signDefinition.size.x, signDefinition.size.y), signMaterial);
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorDefinition.size.x, doorDefinition.size.y, doorDefinition.size.z), doorMaterial);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(awningDefinition.size.x, awningDefinition.size.y, awningDefinition.size.z), trimMaterial);

  if (doorPoint) {
    const halfX = resolved.size.x / 2;
    const halfZ = resolved.size.z / 2;

    if (doorPoint.side === "north" || doorPoint.side === "south") {
      const z = doorPoint.side === "north" ? -halfZ - 0.02 : halfZ + 0.02;
      door.position.set(doorPoint.offset.x, doorDefinition.size.y / 2, z);
      awning.position.set(doorPoint.offset.x, 2.45, z);
      sign.position.set(doorPoint.offset.x, 3.15, z + (doorPoint.side === "south" ? 0.04 : -0.04));
      sign.rotation.y = doorPoint.side === "south" ? 0 : Math.PI;
    } else {
      door.geometry = new THREE.BoxGeometry(doorDefinition.size.z, doorDefinition.size.y, doorDefinition.size.x);
      awning.geometry = new THREE.BoxGeometry(awningDefinition.size.z, awningDefinition.size.y, awningDefinition.size.x);
      const x = doorPoint.side === "west" ? -halfX - 0.02 : halfX + 0.02;
      door.position.set(x, doorDefinition.size.y / 2, doorPoint.offset.z);
      awning.position.set(x, 2.45, doorPoint.offset.z);
      sign.position.set(x + (doorPoint.side === "east" ? 0.04 : -0.04), 3.15, doorPoint.offset.z);
      sign.rotation.y = doorPoint.side === "east" ? Math.PI / 2 : -Math.PI / 2;
    }

    const worldDoor = new THREE.Vector3(placement.position.x + doorPoint.offset.x, 0.45, placement.position.z + doorPoint.offset.z);
    addDebugPoint(debugGroup, doorPoint.id, worldDoor, 0x2ef59a);
  }

  group.add(door, awning, sign);
  parent.add(group);

  if (resolved.collisionBox) {
    const offset = resolved.collisionBox.offset ?? { x: 0, y: 0, z: 0 };
    const collisionX = placement.position.x + offset.x;
    const collisionZ = placement.position.z + offset.z;
    addCollider(colliders, collisionX, collisionZ, resolved.collisionBox.size.x, resolved.collisionBox.size.z);
    addDebugBox(debugGroup, `${placement.id}-collision`, collisionX, collisionZ, resolved.collisionBox.size.x, resolved.collisionBox.size.z, resolved.collisionBox.size.y);
  }

  buildings.push({
    name: resolved.name,
    group,
    occluder: walls,
    materials: [wallMaterial, roofMaterial, trimMaterial, doorMaterial, signMaterial],
    roof
  });
}

export function buildGeneratedCity(parent: THREE.Group, city: GeneratedCity): WorldAssetBuildResult {
  const colliders: WorldCollider[] = [];
  const buildings: WorldBuildingRuntime[] = [];
  const debugGroup = new THREE.Group();
  debugGroup.name = "asset-debug";
  debugGroup.visible = false;

  createGround(parent);

  for (const cityPlacement of city.placements) {
    const definition = assetDefinitionById.get(cityPlacement.assetId);
    if (!definition) {
      throw new Error(`Unknown asset id: ${cityPlacement.assetId}`);
    }

    if (definition.category === "building") {
      buildBuilding(parent, debugGroup, colliders, buildings, definition, cityPlacement);
    } else {
      buildFlatAsset(parent, debugGroup, definition, cityPlacement);
    }
  }

  parent.add(debugGroup);
  return { colliders, buildings, debugGroup, assetCount: city.placements.length };
}
