type MeetingEntryElement = HTMLElement & {
  hidden: boolean;
  disabled: boolean;
};

type PrivateMeetingInterfaceElements = {
  worldEntry: MeetingEntryElement;
  nonSpatialEntry: MeetingEntryElement;
  dialog: HTMLDialogElement;
  status: HTMLElement;
  purpose: HTMLElement;
  participants: HTMLElement;
  materials: HTMLElement;
  lifecycle: HTMLElement;
  startedAt: HTMLElement;
  endedAt: HTMLElement;
  outcome: HTMLElement;
  occupancy: HTMLElement;
  refresh: HTMLButtonElement;
  close: HTMLButtonElement;
};

type PrivateMeetingInterfacesAdapter = {
  getTrustedMeetingTarget: () => unknown;
  getTrustedSession: () => unknown;
  readAuthorizedMeetingSession: (session: TrustedMeetingSession, meetingSessionId: string) => Promise<unknown>;
};

type TrustedMeetingSession = Readonly<{
  kind: "trusted_authenticated_session";
  subjectId: string;
  tenantId: string;
  authorizationRef: string;
  policyRevision: number;
  active: true;
}>;

type PrivateMeetingController = {
  open: (invoker: HTMLElement, tenantId: string, meetingSessionId: string) => Promise<void>;
  refresh: () => Promise<void>;
  close: () => void;
};

type CreatePrivateMeetingController = (
  elements: Omit<PrivateMeetingInterfaceElements, "worldEntry" | "nonSpatialEntry">,
  adapter: {
    getTrustedSession: () => unknown;
    readAuthorizedMeetingSession: (session: TrustedMeetingSession, meetingSessionId: string) => Promise<unknown>;
  }
) => PrivateMeetingController;

const NOT_CONFIGURED_MESSAGE = "Private meetings are not configured in this runtime.";
const TARGET_KIND = "trusted_authorized_meeting_target";
const TENANT_PATTERN = /^syn-tenant-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEETING_PATTERN = /^syn-tenant-[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const arrayIsArray = Array.isArray;
const cloneStructured = globalThis.structuredClone;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const plainObjectPrototype = Object.prototype;
const mapGet = Map.prototype.get;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const stringStartsWith = String.prototype.startsWith;
const TARGET_KEYS = ["kind", "tenantId", "meetingSessionId", "active"];
const MAX_TARGET_SCALAR_LENGTH = 128;

type TrustedMeetingTarget = Readonly<{
  kind: typeof TARGET_KIND;
  tenantId: string;
  meetingSessionId: string;
  active: true;
}>;

function trustedTarget(value: unknown): TrustedMeetingTarget | null {
  if (value === null || typeof value !== "object" || arrayIsArray(value)) return null;
  const prototype = objectGetPrototypeOf(value);
  if (prototype !== plainObjectPrototype && prototype !== null) return null;
  const keys = reflectOwnKeys(value);
  if (keys.length !== TARGET_KEYS.length) return null;
  const descriptors = new Map<PropertyKey, PropertyDescriptor>();
  for (let index = 0; index < TARGET_KEYS.length; index += 1) {
    const key = keys[index];
    if (key !== TARGET_KEYS[index]) return null;
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
    descriptors.set(key, descriptor);
  }
  const stable = (): boolean => {
    if (objectGetPrototypeOf(value) !== prototype) return false;
    const recheckedKeys = reflectOwnKeys(value);
    if (recheckedKeys.length !== keys.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      if (recheckedKeys[index] !== keys[index]) return false;
      const before = reflectApply(mapGet, descriptors, [keys[index]]);
      const after = objectGetOwnPropertyDescriptor(value, keys[index]);
      if (
        before === undefined || after === undefined || !("value" in before) || !("value" in after) ||
        before.enumerable !== after.enumerable || before.configurable !== after.configurable ||
        before.writable !== after.writable || !objectIs(before.value, after.value)
      ) return false;
    }
    return true;
  };
  if (!stable()) return null;
  cloneStructured(value);
  if (!stable()) return null;
  const tenantId = reflectApply(mapGet, descriptors, ["tenantId"])?.value;
  const meetingSessionId = reflectApply(mapGet, descriptors, ["meetingSessionId"])?.value;
  if (
    reflectApply(mapGet, descriptors, ["kind"])?.value !== TARGET_KIND ||
    reflectApply(mapGet, descriptors, ["active"])?.value !== true ||
    typeof tenantId !== "string" || tenantId.length > MAX_TARGET_SCALAR_LENGTH ||
    !reflectApply(regexpTest, TENANT_PATTERN, [tenantId]) ||
    typeof meetingSessionId !== "string" || meetingSessionId.length > MAX_TARGET_SCALAR_LENGTH ||
    !reflectApply(regexpTest, MEETING_PATTERN, [meetingSessionId]) ||
    !reflectApply(stringStartsWith, meetingSessionId, [`${tenantId}--`])
  ) return null;
  return objectFreeze({ kind: TARGET_KIND, tenantId, meetingSessionId, active: true });
}

function sameTarget(left: TrustedMeetingTarget | null, right: TrustedMeetingTarget | null): boolean {
  return left !== null && right !== null && left.kind === right.kind && left.tenantId === right.tenantId &&
    left.meetingSessionId === right.meetingSessionId && left.active === right.active;
}

export function createPrivateMeetingInterfaces(
  elements: PrivateMeetingInterfaceElements,
  adapter: PrivateMeetingInterfacesAdapter,
  createController: CreatePrivateMeetingController
): Readonly<{
  controller: PrivateMeetingController;
  refreshAvailability: () => void;
  isAvailable: () => boolean;
  openWorld: (invoker?: HTMLElement) => Promise<void>;
  openNonSpatial: () => Promise<void>;
}> {
  elements.status.textContent = NOT_CONFIGURED_MESSAGE;
  let openedTarget: TrustedMeetingTarget | null = null;

  function resolveTarget(): TrustedMeetingTarget | null {
    try {
      return trustedTarget(adapter.getTrustedMeetingTarget());
    } catch {
      return null;
    }
  }

  function setAvailability(available: boolean): void {
    elements.worldEntry.hidden = !available;
    elements.worldEntry.disabled = !available;
    elements.nonSpatialEntry.hidden = !available;
    elements.nonSpatialEntry.disabled = !available;
    if (!available) elements.status.textContent = NOT_CONFIGURED_MESSAGE;
  }

  const controller = createController(elements, {
    getTrustedSession: () => {
      const currentTarget = resolveTarget();
      if (!sameTarget(currentTarget, openedTarget)) {
        setAvailability(false);
        return null;
      }
      return adapter.getTrustedSession();
    },
    readAuthorizedMeetingSession: async (session, meetingSessionId) => {
      const currentTarget = resolveTarget();
      if (currentTarget === null || !sameTarget(currentTarget, openedTarget) || currentTarget.meetingSessionId !== meetingSessionId) {
        setAvailability(false);
        throw new Error("Private meeting target is unavailable.");
      }
      return adapter.readAuthorizedMeetingSession(session, meetingSessionId);
    }
  });

  function refreshAvailability(): void {
    const target = resolveTarget();
    setAvailability(target !== null && (openedTarget === null || sameTarget(target, openedTarget)));
  }

  function isAvailable(): boolean {
    const target = resolveTarget();
    return target !== null && (openedTarget === null || sameTarget(target, openedTarget));
  }

  async function invalidate(): Promise<void> {
    openedTarget = null;
    setAvailability(false);
    await controller.refresh();
  }

  async function openFrom(invoker: MeetingEntryElement): Promise<void> {
    const target = resolveTarget();
    const revalidatedTarget = resolveTarget();
    if (
      target === null || revalidatedTarget === null || !sameTarget(target, revalidatedTarget) ||
      (openedTarget !== null && !sameTarget(target, openedTarget))
    ) {
      await invalidate();
      return;
    }
    setAvailability(true);
    openedTarget = target;
    await controller.open(invoker, target.tenantId, target.meetingSessionId);
  }

  const openWorld = (invoker: HTMLElement = elements.worldEntry): Promise<void> => openFrom(invoker as MeetingEntryElement);
  const openNonSpatial = (): Promise<void> => openFrom(elements.nonSpatialEntry);
  elements.worldEntry.addEventListener("click", () => void openWorld(elements.worldEntry));
  elements.nonSpatialEntry.addEventListener("click", () => void openNonSpatial());
  refreshAvailability();

  return objectFreeze({ controller, refreshAvailability, isAvailable, openWorld, openNonSpatial });
}
