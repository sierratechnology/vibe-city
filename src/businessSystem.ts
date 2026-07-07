import { Citizen } from "./citizenData";
import { BUSINESSES, BusinessEntity as DistrictBusinessRecord, DISTRICT_ID, WORKSTATIONS, Workstation, isBusinessOpen } from "./districtData";
import { getActiveShift } from "./citizenScheduleSystem";
import { WorldTimeState } from "./worldTime";

export type BusinessType = "HeadquartersOperations";
export type OwnerType = "city" | "npc" | "player" | "corporation";
export type StaffingStatus = "unstaffed" | "understaffed" | "staffed";
export type OperationalStatus = "Closed" | "Opening" | "Open" | "Understaffed" | "Operating" | "Closing";

export type RequiredStaffRole = {
  role: string;
  count: number;
  match: string[];
};

export type BusinessTypeDefinition = {
  businessType: BusinessType;
  requiredStaffRoles: RequiredStaffRole[];
  workstationTypes: string[];
  defaultOpenHours: DistrictBusinessRecord["openHours"];
  customerAreaTypes: string[];
};

export type BusinessEntity = {
  businessId: string;
  businessName: string;
  businessType: BusinessType;
  buildingId: string;
  leaseSpaceId?: string;
  districtId: string;
  ownerType: OwnerType;
  managerCitizenId: string | null;
  employeeCitizenIds: string[];
  customerCitizenIds: string[];
  openHours: DistrictBusinessRecord["openHours"];
  capacity: number;
  reputation: number;
  staffingStatus: StaffingStatus;
  operationalStatus: OperationalStatus;
  allowedBusinessTypes: BusinessType[];
  workstationIds: string[];
  requiredStaff: RequiredStaffRole[];
  currentStaffByRole: Record<string, number>;
  missingStaffByRole: Record<string, number>;
  scheduledStaffCitizenIds: string[];
  employeesPresentCitizenIds: string[];
  workersEnRouteCitizenIds: string[];
  workersHomeCitizenIds: string[];
  workersOffDistrictCitizenIds: string[];
  visitorsPresentCitizenIds: string[];
};

type BusinessDefinition = {
  businessId: string;
  businessType: BusinessType;
  ownerType: OwnerType;
  managerHints: string[];
  capacity: number;
  reputation: number;
  allowedBusinessTypes: BusinessType[];
  workstationIds: string[];
  leaseSpaceId?: string;
};

export const BUSINESS_TYPES: Record<BusinessType, BusinessTypeDefinition> = {
  HeadquartersOperations: {
    businessType: "HeadquartersOperations",
    requiredStaffRoles: [{ role: "Executive Assistant", count: 1, match: ["executive assistant"] }],
    workstationTypes: ["reception", "assistant", "executive", "projects", "meeting"],
    defaultOpenHours: "24h",
    customerAreaTypes: ["reception", "office"]
  }
};

export const BUSINESS_DEFINITIONS: BusinessDefinition[] = [
  {
    businessId: "stg-headquarters-operations",
    businessType: "HeadquartersOperations",
    ownerType: "corporation",
    managerHints: ["executive assistant"],
    capacity: 12,
    reputation: 5,
    allowedBusinessTypes: ["HeadquartersOperations"],
    workstationIds: ["reception", "meeting_boardroom", "assistant_office", "devon_executive_office", "projects_updates_office", "entrance_exit_door"]
  }
];

const businessRecordById = new Map(BUSINESSES.map((business) => [business.id, business]));
const businessDefinitionById = new Map(BUSINESS_DEFINITIONS.map((business) => [business.businessId, business]));

function roleMatches(roleName: string, role: RequiredStaffRole): boolean {
  const currentRole = roleName.toLowerCase();
  return role.match.some((match) => currentRole.includes(match.toLowerCase()));
}

function isEmployeeOf(citizen: Citizen, businessId: string): boolean {
  return citizen.schedule.some((shift) => shift.businessId === businessId);
}

function activeShiftBusinessId(citizen: Citizen, worldTime: WorldTimeState): string | null {
  return getActiveShift(citizen, worldTime.absoluteMinutes)?.businessId ?? null;
}

function deriveOperationalStatus(isOpen: boolean, staffingStatus: StaffingStatus, employeesPresent: number): OperationalStatus {
  if (!isOpen) return "Closed";
  if (staffingStatus === "unstaffed") return "Opening";
  if (staffingStatus === "understaffed") return "Understaffed";
  return employeesPresent > 0 ? "Operating" : "Open";
}

export function getBusinessRecord(businessId: string): DistrictBusinessRecord {
  const record = businessRecordById.get(businessId);
  if (!record) throw new Error(`Unknown business record: ${businessId}`);
  return record;
}

export function getBusinessDefinition(businessId: string): BusinessDefinition {
  const definition = businessDefinitionById.get(businessId);
  if (!definition) throw new Error(`Unknown business definition: ${businessId}`);
  return definition;
}

export function deriveBusinessEntities(citizens: Citizen[], worldTime: WorldTimeState): BusinessEntity[] {
  return BUSINESS_DEFINITIONS.map((definition) => {
    const record = getBusinessRecord(definition.businessId);
    const typeDefinition = BUSINESS_TYPES[definition.businessType];
    const employees = citizens.filter((citizen) => isEmployeeOf(citizen, definition.businessId));
    const customers: Citizen[] = [];
    const scheduledEmployees = employees.filter((citizen) => activeShiftBusinessId(citizen, worldTime) === definition.businessId || citizen.status === "active");
    const employeesPresent = scheduledEmployees.filter((citizen) => citizen.currentState === "working" || citizen.currentState === "idle");
    const workersEnRoute = scheduledEmployees.filter((citizen) => citizen.currentState === "walking_to_work" || citizen.currentState === "walking_to_workstation");
    const workersHome = scheduledEmployees.filter((citizen) => citizen.currentState === "home");
    const workersOffDistrict = scheduledEmployees.filter((citizen) => citizen.currentState === "off_district");
    const currentStaffByRole = Object.fromEntries(
      typeDefinition.requiredStaffRoles.map((role) => [role.role, [...employeesPresent, ...workersEnRoute].filter((citizen) => roleMatches(citizen.role, role)).length])
    );
    const missingStaffByRole = Object.fromEntries(typeDefinition.requiredStaffRoles.map((role) => [role.role, Math.max(0, role.count - (currentStaffByRole[role.role] ?? 0))]));
    const missingTotal = Object.values(missingStaffByRole).reduce((sum, count) => sum + count, 0);
    const staffingStatus: StaffingStatus = scheduledEmployees.length === 0 && workersEnRoute.length === 0 ? "unstaffed" : missingTotal > 0 ? "understaffed" : "staffed";
    const openHours = record.openHours ?? typeDefinition.defaultOpenHours;
    const currentlyOpen = isBusinessOpen(record, worldTime.minuteOfDay);

    return {
      businessId: definition.businessId,
      businessName: record.name,
      businessType: definition.businessType,
      buildingId: record.buildingId,
      leaseSpaceId: definition.leaseSpaceId,
      districtId: DISTRICT_ID,
      ownerType: definition.ownerType,
      managerCitizenId: employees[0]?.id ?? null,
      employeeCitizenIds: employees.map((citizen) => citizen.id),
      customerCitizenIds: customers.map((citizen) => citizen.id),
      openHours,
      capacity: definition.capacity,
      reputation: definition.reputation,
      staffingStatus,
      operationalStatus: deriveOperationalStatus(currentlyOpen, staffingStatus, employeesPresent.length),
      allowedBusinessTypes: definition.allowedBusinessTypes,
      workstationIds: definition.workstationIds.filter((id) => WORKSTATIONS.some((station) => station.id === id)),
      requiredStaff: typeDefinition.requiredStaffRoles,
      currentStaffByRole,
      missingStaffByRole,
      scheduledStaffCitizenIds: scheduledEmployees.map((citizen) => citizen.id),
      employeesPresentCitizenIds: employeesPresent.map((citizen) => citizen.id),
      workersEnRouteCitizenIds: workersEnRoute.map((citizen) => citizen.id),
      workersHomeCitizenIds: workersHome.map((citizen) => citizen.id),
      workersOffDistrictCitizenIds: workersOffDistrict.map((citizen) => citizen.id),
      visitorsPresentCitizenIds: []
    };
  });
}

export function businessWorkstations(business: BusinessEntity): Workstation[] {
  return business.workstationIds.map((id) => WORKSTATIONS.find((station) => station.id === id)).filter((station): station is Workstation => Boolean(station));
}
