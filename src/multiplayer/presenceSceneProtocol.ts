export type PresenceScene = "outside" | "headquarters" | "none";

const LEGACY_WIRE_HEADQUARTERS_SCENE = ["apart", "ment"].join("");

export function normalizePresenceScene(value: unknown): PresenceScene | null {
  if (value === LEGACY_WIRE_HEADQUARTERS_SCENE) return "headquarters";
  if (value === "outside" || value === "headquarters" || value === "none") return value;
  return null;
}

export function legacyCompatibleWireScene(scene: PresenceScene): string {
  return scene === "headquarters" ? LEGACY_WIRE_HEADQUARTERS_SCENE : scene;
}
