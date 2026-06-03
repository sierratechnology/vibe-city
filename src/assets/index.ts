import { AssetDefinition } from "./assetTypes";
import { buildingAssets } from "./buildings";
import { doorAssets } from "./doors";
import { interiorAssets } from "./interiors";
import { propAssets } from "./props";
import { roadAssets } from "./roads";
import { sidewalkAssets } from "./sidewalks";
import { signAssets } from "./signs";

export const assetDefinitions: AssetDefinition[] = [
  ...roadAssets,
  ...sidewalkAssets,
  ...buildingAssets,
  ...doorAssets,
  ...signAssets,
  ...propAssets,
  ...interiorAssets
];

export const assetDefinitionById = new Map(assetDefinitions.map((asset) => [asset.id, asset]));

export * from "./assetTypes";
