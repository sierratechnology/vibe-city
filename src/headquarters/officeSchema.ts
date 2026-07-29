export const HEADQUARTERS_ACCESS_STATES = ["public", "tenant", "invited", "restricted", "unavailable"] as const;

export type HeadquartersAccessState = (typeof HEADQUARTERS_ACCESS_STATES)[number];

export type HeadquartersOfficeId =
  | "reception"
  | "executive-office"
  | "chief-agent-office"
  | "records-room"
  | "finance"
  | "boardroom"
  | "small-meeting-room"
  | "infrastructure"
  | "reserved-departments";

export type HeadquartersOffice = {
  readonly id: HeadquartersOfficeId;
  readonly displayName: string;
  readonly definition: string;
  readonly access: HeadquartersAccessState;
  readonly accessReason: string;
};

function accessLabel(access: HeadquartersAccessState): string {
  return access === "unavailable"
    ? "Reserved / Unavailable"
    : access[0].toUpperCase() + access.slice(1);
}

export function officeAccessText(office: HeadquartersOffice): string {
  return `${office.displayName} · ${accessLabel(office.access)}`;
}

export function officeSignText(office: HeadquartersOffice): string {
  return office.access === "unavailable"
    ? `${office.displayName} · Reserved`
    : office.displayName;
}

export const HEADQUARTERS_OFFICES: readonly HeadquartersOffice[] = [
  {
    id: "reception",
    displayName: "Reception",
    definition: "Visitor entry and wayfinding for the existing Headquarters interior.",
    access: "public",
    accessReason: "The existing Headquarters entry and reception area is open to visitors."
  },
  {
    id: "executive-office",
    displayName: "Executive Office",
    definition: "Existing office designated as the Executive Office; no occupancy is implied.",
    access: "public",
    accessReason: "This visible slice has no office access control; the existing space is publicly traversable. Public access does not imply occupancy or service."
  },
  {
    id: "chief-agent-office",
    displayName: "Chief Agent Office",
    definition: "Existing office designation for the Chief Agent identity; no live agent or occupancy is implied.",
    access: "public",
    accessReason: "This visible slice has no office access control; the existing space is publicly traversable. Public access does not imply a live agent, occupancy, or service."
  },
  {
    id: "records-room",
    displayName: "Records Room",
    definition: "Existing area containing the public Records Terminal.",
    access: "public",
    accessReason: "The existing public records terminal can be inspected without credentials."
  },
  {
    id: "finance",
    displayName: "Finance",
    definition: "Reserved department label only; no finance workspace or service is implemented.",
    access: "unavailable",
    accessReason: "Reserved; no finance room or finance systems are implemented."
  },
  {
    id: "boardroom",
    displayName: "Boardroom",
    definition: "Existing shared meeting space; no scheduling or meeting service is represented.",
    access: "public",
    accessReason: "The existing meeting space is open; no meeting service is implied."
  },
  {
    id: "small-meeting-room",
    displayName: "Small Meeting Room",
    definition: "Reserved room definition; the room is not implemented.",
    access: "unavailable",
    accessReason: "Reserved; this room is not implemented."
  },
  {
    id: "infrastructure",
    displayName: "Infrastructure",
    definition: "Reserved department label only; no infrastructure workspace or service is implemented.",
    access: "unavailable",
    accessReason: "Reserved; no infrastructure workspace or systems are implemented."
  },
  {
    id: "reserved-departments",
    displayName: "Reserved Departments",
    definition: "Placeholder for future department definitions; no rooms, departments, staffing, or capabilities are represented.",
    access: "unavailable",
    accessReason: "Reserved for future definition; no departments, staffing, or capabilities are represented."
  }
];
