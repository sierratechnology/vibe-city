import { Citizen, CitizenShift, persistCitizenPayroll } from "./citizenData";
import { DoorPortal, portalById, workstationById } from "./districtData";
import { WorldTimeState } from "./worldTime";

export type ActiveShiftWindow = CitizenShift & {
  key: string;
  startAbsoluteMinute: number;
  endAbsoluteMinute: number;
};

const MINUTES_PER_DAY = 1440;
const COMMUTE_LEAD_MINUTES = 35;

function shiftWindowsNear(citizen: Citizen, absoluteMinutes: number): ActiveShiftWindow[] {
  const baseDay = Math.floor(absoluteMinutes / MINUTES_PER_DAY);
  const windows: ActiveShiftWindow[] = [];

  for (let dayOffset = -1; dayOffset <= 1; dayOffset += 1) {
    const dayNumber = baseDay + dayOffset;
    const dayIndex = ((dayNumber % 7) + 7) % 7;
    const dayStart = dayNumber * MINUTES_PER_DAY;

    for (const shift of citizen.schedule) {
      if (!shift.days.includes(dayIndex)) continue;
      const start = dayStart + shift.startMinute;
      let end = dayStart + shift.endMinute;
      if (shift.endMinute <= shift.startMinute) end += MINUTES_PER_DAY;
      windows.push({ ...shift, key: `${citizen.id}:${shift.id}:${Math.floor(start)}`, startAbsoluteMinute: start, endAbsoluteMinute: end });
    }
  }

  return windows.sort((a, b) => a.startAbsoluteMinute - b.startAbsoluteMinute);
}

export function getActiveShift(citizen: Citizen, absoluteMinutes: number): ActiveShiftWindow | null {
  return shiftWindowsNear(citizen, absoluteMinutes).find((shift) => absoluteMinutes >= shift.startAbsoluteMinute && absoluteMinutes < shift.endAbsoluteMinute) ?? null;
}

export function getUpcomingShift(citizen: Citizen, absoluteMinutes: number): ActiveShiftWindow | null {
  return (
    shiftWindowsNear(citizen, absoluteMinutes).find((shift) => {
      const minutesUntilStart = shift.startAbsoluteMinute - absoluteMinutes;
      return minutesUntilStart > 0 && minutesUntilStart <= COMMUTE_LEAD_MINUTES;
    }) ?? null
  );
}

export function getShiftByKey(citizen: Citizen, key: string | null, absoluteMinutes: number): ActiveShiftWindow | null {
  if (!key) return null;
  return shiftWindowsNear(citizen, absoluteMinutes).find((shift) => shift.key === key) ?? null;
}

export function isLateForShift(shift: ActiveShiftWindow, arrivalAbsoluteMinutes: number): boolean {
  return arrivalAbsoluteMinutes - shift.startAbsoluteMinute > 10;
}

export function payCompletedShift(citizen: Citizen, shift: ActiveShiftWindow): void {
  if (shift.hourlyWage <= 0) return;
  if (citizen.paidShiftKeys.includes(shift.key)) return;
  const hoursWorked = (shift.endAbsoluteMinute - shift.startAbsoluteMinute) / 60;
  citizen.wallet += Math.round(hoursWorked * shift.hourlyWage);
  citizen.paidShiftKeys.push(shift.key);
  persistCitizenPayroll(citizen);
}

export function startCommutingToWork(citizen: Citizen, shift: ActiveShiftWindow): void {
  const portal = portalById(shift.portalId);
  const entryPortal = portalById(citizen.offDistrictEntryPortalId);
  citizen.currentState = "walking_to_work";
  citizen.currentScene = "outside";
  citizen.currentMood = "rushed";
  citizen.currentDestination = portal.id;
  citizen.currentLocation = "Parking Garage";
  citizen.currentWorkstationId = null;
  citizen.activeShiftKey = shift.key;
  citizen.routeWaypoints = [];
  citizen.wasLateToday = false;
  citizen.delayMinutes = 0;
  citizen.position = { ...entryPortal.exteriorPosition };
}

export function enterWorkPortal(citizen: Citizen, shift: ActiveShiftWindow): DoorPortal {
  const portal = portalById(shift.portalId);
  const staysOutside = shift.scene === "outside" || portal.linkedScene === "outside";
  citizen.currentState = staysOutside ? (shift.hourlyWage > 0 ? "working" : "idle") : "walking_to_workstation";
  citizen.currentScene = shift.scene;
  citizen.currentMood = "rushed";
  citizen.currentDestination = shift.workstationId;
  citizen.currentLocation = staysOutside ? portal.buildingId : `${portal.buildingId} Interior Door`;
  citizen.currentWorkstationId = null;
  citizen.routeWaypoints = [];
  citizen.position = staysOutside ? { ...workstationById(shift.workstationId).position } : { ...portal.interiorPosition };
  return portal;
}

export function startWorking(citizen: Citizen, shift: ActiveShiftWindow, worldTime: WorldTimeState): void {
  const station = workstationById(shift.workstationId);
  citizen.currentState = shift.hourlyWage > 0 ? "working" : "idle";
  citizen.currentScene = station.scene;
  citizen.currentMood = isLateForShift(shift, worldTime.absoluteMinutes) ? "annoyed" : "neutral";
  citizen.wasLateToday = citizen.currentMood === "annoyed";
  citizen.role = shift.role;
  citizen.currentDestination = null;
  citizen.currentLocation = station.name;
  citizen.currentWorkstationId = station.id;
  citizen.routeWaypoints = [];
  citizen.position = { ...station.position };
}

export function sendCitizenHome(citizen: Citizen, shift: ActiveShiftWindow | null): DoorPortal {
  if (shift) payCompletedShift(citizen, shift);
  const exitPortal = shift ? portalById(shift.portalId) : portalById(citizen.offDistrictEntryPortalId);
  const destinationPortal = portalById(citizen.offDistrictEntryPortalId);
  citizen.currentState = citizen.currentScene !== "outside" && exitPortal.linkedScene !== "outside" ? "leaving_building" : "walking_to_destination";
  citizen.currentScene = citizen.currentState === "leaving_building" ? citizen.currentScene : "outside";
  citizen.currentMood = "tired";
  citizen.currentDestination = citizen.currentState === "leaving_building" ? exitPortal.id : destinationPortal.id;
  citizen.currentWorkstationId = null;
  citizen.routeWaypoints = [];
  return destinationPortal;
}
