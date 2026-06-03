import { Citizen } from "./citizenData";
import { BUSINESSES, BusinessEntity as DistrictBusinessRecord, DISTRICT_ID, WORKSTATIONS, Workstation, isBusinessOpen } from "./districtData";
import { getActiveShift } from "./citizenScheduleSystem";
import { WorldTimeState } from "./worldTime";

export type BusinessType =
  | "Bar"
  | "SportsBar"
  | "Casino"
  | "Restaurant"
  | "BookShop"
  | "CoffeeShop"
  | "ConvenienceStore"
  | "BarberShop"
  | "Bank"
  | "Hotel"
  | "ParkingGarage"
  | "ApartmentOperations";

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
  employeesPresentCitizenIds: string[];
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
  Bar: {
    businessType: "Bar",
    requiredStaffRoles: [
      { role: "Manager", count: 1, match: ["manager"] },
      { role: "Bartender", count: 4, match: ["bartender"] }
    ],
    workstationTypes: ["manager", "bar"],
    defaultOpenHours: { startMinute: 14 * 60, endMinute: 2 * 60 },
    customerAreaTypes: ["bar", "social"]
  },
  SportsBar: {
    businessType: "SportsBar",
    requiredStaffRoles: [
      { role: "Manager", count: 1, match: ["manager"] },
      { role: "Bartender", count: 4, match: ["bartender"] },
      { role: "Server", count: 4, match: ["server"] },
      { role: "Security", count: 1, match: ["security", "door"] }
    ],
    workstationTypes: ["manager", "bartender", "server", "security", "sports"],
    defaultOpenHours: { startMinute: 11 * 60, endMinute: 2 * 60 },
    customerAreaTypes: ["sports", "social"]
  },
  Casino: {
    businessType: "Casino",
    requiredStaffRoles: [
      { role: "Casino Manager", count: 3, match: ["casino manager"] },
      { role: "Dealer", count: 9, match: ["dealer"] },
      { role: "Cocktail Server", count: 4, match: ["cocktail"] },
      { role: "Security", count: 8, match: ["security"] },
      { role: "Surveillance", count: 6, match: ["surveillance"] },
      { role: "Cage/Cashier", count: 6, match: ["cage", "cashier"] },
      { role: "Maintenance", count: 4, match: ["maintenance"] }
    ],
    workstationTypes: ["casino", "dealer", "security", "cashier", "maintenance", "surveillance"],
    defaultOpenHours: "24h",
    customerAreaTypes: ["casino", "tables", "slots"]
  },
  Restaurant: {
    businessType: "Restaurant",
    requiredStaffRoles: [
      { role: "Manager", count: 1, match: ["manager"] },
      { role: "Host", count: 2, match: ["host"] },
      { role: "Server", count: 6, match: ["server"] },
      { role: "Cook", count: 4, match: ["cook"] },
      { role: "Dishwasher", count: 2, match: ["dishwasher"] },
      { role: "Busser", count: 2, match: ["busser"] }
    ],
    workstationTypes: ["restaurant", "host", "server", "cook", "dish"],
    defaultOpenHours: { startMinute: 11 * 60, endMinute: 23 * 60 },
    customerAreaTypes: ["dining", "restaurant"]
  },
  BookShop: {
    businessType: "BookShop",
    requiredStaffRoles: [
      { role: "Owner/Manager", count: 1, match: ["owner", "manager"] },
      { role: "Clerk", count: 3, match: ["clerk"] }
    ],
    workstationTypes: ["retail", "cashier", "books"],
    defaultOpenHours: { startMinute: 10 * 60, endMinute: 18 * 60 },
    customerAreaTypes: ["books", "quiet"]
  },
  CoffeeShop: {
    businessType: "CoffeeShop",
    requiredStaffRoles: [
      { role: "Manager", count: 1, match: ["manager"] },
      { role: "Barista", count: 4, match: ["barista"] }
    ],
    workstationTypes: ["coffee", "barista"],
    defaultOpenHours: { startMinute: 7 * 60, endMinute: 17 * 60 },
    customerAreaTypes: ["coffee", "counter"]
  },
  ConvenienceStore: {
    businessType: "ConvenienceStore",
    requiredStaffRoles: [
      { role: "Manager", count: 1, match: ["manager"] },
      { role: "Clerk", count: 4, match: ["clerk"] }
    ],
    workstationTypes: ["convenience", "clerk"],
    defaultOpenHours: "24h",
    customerAreaTypes: ["retail", "counter"]
  },
  BarberShop: {
    businessType: "BarberShop",
    requiredStaffRoles: [
      { role: "Owner/Manager", count: 1, match: ["owner", "manager"] },
      { role: "Barber", count: 3, match: ["barber"] }
    ],
    workstationTypes: ["barber"],
    defaultOpenHours: { startMinute: 9 * 60, endMinute: 19 * 60 },
    customerAreaTypes: ["service", "chairs"]
  },
  Bank: {
    businessType: "Bank",
    requiredStaffRoles: [
      { role: "Manager", count: 1, match: ["manager"] },
      { role: "Teller", count: 3, match: ["teller"] },
      { role: "Security", count: 1, match: ["security"] }
    ],
    workstationTypes: ["bank", "teller", "security"],
    defaultOpenHours: { startMinute: 9 * 60, endMinute: 17 * 60 },
    customerAreaTypes: ["bank", "counter"]
  },
  Hotel: {
    businessType: "Hotel",
    requiredStaffRoles: [
      { role: "Manager", count: 1, match: ["manager"] },
      { role: "Front Desk", count: 3, match: ["front desk"] },
      { role: "Housekeeping", count: 2, match: ["housekeeping"] },
      { role: "Maintenance", count: 1, match: ["maintenance"] }
    ],
    workstationTypes: ["hotel", "frontDesk", "housekeeping", "maintenance"],
    defaultOpenHours: "24h",
    customerAreaTypes: ["hotel", "lobby"]
  },
  ParkingGarage: {
    businessType: "ParkingGarage",
    requiredStaffRoles: [
      { role: "Manager", count: 1, match: ["manager"] },
      { role: "Attendant", count: 3, match: ["attendant"] },
      { role: "Security", count: 2, match: ["security"] }
    ],
    workstationTypes: ["parking", "portal"],
    defaultOpenHours: "24h",
    customerAreaTypes: ["parking", "portal"]
  },
  ApartmentOperations: {
    businessType: "ApartmentOperations",
    requiredStaffRoles: [
      { role: "Property Manager", count: 1, match: ["property manager"] },
      { role: "Maintenance", count: 1, match: ["maintenance"] },
      { role: "Front Desk/Security", count: 1, match: ["front desk", "security"] }
    ],
    workstationTypes: ["apartment", "property", "maintenance", "security"],
    defaultOpenHours: "24h",
    customerAreaTypes: ["apartment", "lobby"]
  }
};

export const BUSINESS_DEFINITIONS: BusinessDefinition[] = [
  { businessId: "bar-a-business", businessType: "Bar", ownerType: "npc", managerHints: ["manager"], capacity: 32, reputation: 3.4, allowedBusinessTypes: ["Bar"], workstationIds: ["bar-a-manager", "bar-a-tap-1", "bar-a-tap-2", "bar-a-customer-floor"] },
  { businessId: "bar-b-business", businessType: "Bar", ownerType: "npc", managerHints: ["manager"], capacity: 30, reputation: 3.1, allowedBusinessTypes: ["Bar"], workstationIds: ["bar-b-manager", "bar-b-tap-1", "bar-b-tap-2", "bar-b-customer-floor"] },
  { businessId: "sports-bar-business", businessType: "SportsBar", ownerType: "npc", managerHints: ["manager"], capacity: 44, reputation: 3.6, allowedBusinessTypes: ["SportsBar", "Bar"], workstationIds: ["sports-bar-manager", "sports-bar-tap-1", "sports-bar-tap-2", "sports-bar-server-floor", "sports-bar-watch-area"] },
  {
    businessId: "casino-business",
    businessType: "Casino",
    ownerType: "corporation",
    managerHints: ["casino manager"],
    capacity: 160,
    reputation: 4.0,
    allowedBusinessTypes: ["Casino"],
    workstationIds: ["casino-manager-floor", "blackjack-table", "roulette-table", "three-card-poker-table", "dealer-break-room", "cocktail-floor", "security-entrance", "security-slot-floor", "surveillance-room", "cage-window-1", "maintenance-route"]
  },
  { businessId: "standalone-restaurant", businessType: "Restaurant", ownerType: "npc", managerHints: ["manager"], capacity: 58, reputation: 3.7, allowedBusinessTypes: ["Restaurant"], workstationIds: ["restaurant-manager", "restaurant-host", "restaurant-server-floor", "restaurant-kitchen", "restaurant-dish"] },
  {
    businessId: "casino-restaurant-operator",
    businessType: "Restaurant",
    ownerType: "npc",
    managerHints: ["manager"],
    capacity: 46,
    reputation: 3.5,
    allowedBusinessTypes: ["Restaurant"],
    leaseSpaceId: "casino-restaurant-lease-space",
    workstationIds: ["casino-restaurant-host", "casino-restaurant-kitchen", "casino-restaurant-service"]
  },
  { businessId: "book-shop-business", businessType: "BookShop", ownerType: "npc", managerHints: ["owner", "manager"], capacity: 24, reputation: 4.2, allowedBusinessTypes: ["BookShop"], workstationIds: ["book-shop-counter", "book-shop-reading-area"] },
  { businessId: "coffee-shop-business", businessType: "CoffeeShop", ownerType: "npc", managerHints: ["manager"], capacity: 24, reputation: 3.8, allowedBusinessTypes: ["CoffeeShop"], workstationIds: ["coffee-manager", "coffee-barista"] },
  { businessId: "convenience-store-business", businessType: "ConvenienceStore", ownerType: "corporation", managerHints: ["manager"], capacity: 20, reputation: 3.0, allowedBusinessTypes: ["ConvenienceStore"], workstationIds: ["convenience-manager", "convenience-clerk"] },
  { businessId: "barber-shop-business", businessType: "BarberShop", ownerType: "npc", managerHints: ["owner", "manager"], capacity: 12, reputation: 3.9, allowedBusinessTypes: ["BarberShop"], workstationIds: ["barber-manager", "barber-chair"] },
  { businessId: "bank-business", businessType: "Bank", ownerType: "corporation", managerHints: ["manager"], capacity: 30, reputation: 3.6, allowedBusinessTypes: ["Bank"], workstationIds: ["bank-manager", "bank-teller", "bank-security"] },
  { businessId: "small-hotel-business", businessType: "Hotel", ownerType: "corporation", managerHints: ["manager"], capacity: 70, reputation: 3.3, allowedBusinessTypes: ["Hotel"], workstationIds: ["hotel-manager", "hotel-front-desk", "hotel-housekeeping", "hotel-maintenance"] },
  { businessId: "parking-garage-business", businessType: "ParkingGarage", ownerType: "city", managerHints: ["manager"], capacity: 90, reputation: 3.1, allowedBusinessTypes: ["ParkingGarage"], workstationIds: ["parking-garage-manager", "parking-garage-attendant", "parking-garage-security", "parking-garage-portal-station"] },
  { businessId: "apartment-operations", businessType: "ApartmentOperations", ownerType: "city", managerHints: ["property manager"], capacity: 24, reputation: 3.2, allowedBusinessTypes: ["ApartmentOperations"], workstationIds: ["apartment-property-manager", "apartment-maintenance", "apartment-front-desk"] }
];

const businessRecordById = new Map(BUSINESSES.map((business) => [business.id, business]));
const businessDefinitionById = new Map(BUSINESS_DEFINITIONS.map((business) => [business.businessId, business]));

function citizenRoleMatches(citizen: Citizen, role: RequiredStaffRole): boolean {
  const currentRole = citizen.role.toLowerCase();
  return role.match.some((match) => currentRole.includes(match.toLowerCase()));
}

function roleCount(citizens: Citizen[], role: RequiredStaffRole): number {
  return citizens.filter((citizen) => citizenRoleMatches(citizen, role)).length;
}

function deriveManagerId(definition: BusinessDefinition, employees: Citizen[]): string | null {
  const manager = employees.find((citizen) => definition.managerHints.some((hint) => citizen.role.toLowerCase().includes(hint.toLowerCase())));
  return manager?.id ?? employees.find((citizen) => citizen.role.toLowerCase().includes("manager") || citizen.role.toLowerCase().includes("owner"))?.id ?? employees[0]?.id ?? null;
}

function isEmployeeOf(citizen: Citizen, businessId: string): boolean {
  return citizen.schedule.some((shift) => shift.businessId === businessId && shift.hourlyWage > 0);
}

function activeShiftBusinessId(citizen: Citizen, worldTime: WorldTimeState): string | null {
  return getActiveShift(citizen, worldTime.absoluteMinutes)?.businessId ?? null;
}

function deriveOperationalStatus(isOpen: boolean, staffingStatus: StaffingStatus, employeesPresent: number, worldTime: WorldTimeState, openHours: DistrictBusinessRecord["openHours"]): OperationalStatus {
  if (!isOpen) return "Closed";
  if (staffingStatus === "unstaffed") return "Opening";
  if (staffingStatus === "understaffed") return "Understaffed";
  if (openHours !== "24h") {
    const { startMinute, endMinute } = openHours;
    const minute = worldTime.minuteOfDay;
    const normalizedEnd = endMinute <= startMinute ? endMinute + 1440 : endMinute;
    const normalizedMinute = minute < startMinute && endMinute <= startMinute ? minute + 1440 : minute;
    if (Math.abs(normalizedMinute - startMinute) <= 30) return "Opening";
    if (Math.abs(normalizedEnd - normalizedMinute) <= 30) return "Closing";
  }
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
    const customers = citizens.filter((citizen) => activeShiftBusinessId(citizen, worldTime) === definition.businessId && getActiveShift(citizen, worldTime.absoluteMinutes)?.hourlyWage === 0);
    const employeesPresent = employees.filter((citizen) => citizen.currentState === "working" && activeShiftBusinessId(citizen, worldTime) === definition.businessId);
    const visitorsPresent = customers.filter((citizen) => citizen.currentState === "idle" && activeShiftBusinessId(citizen, worldTime) === definition.businessId);
    const currentStaffByRole = Object.fromEntries(typeDefinition.requiredStaffRoles.map((role) => [role.role, roleCount(employees, role)]));
    const missingStaffByRole = Object.fromEntries(typeDefinition.requiredStaffRoles.map((role) => [role.role, Math.max(0, role.count - (currentStaffByRole[role.role] ?? 0))]));
    const missingTotal = Object.values(missingStaffByRole).reduce((sum, count) => sum + count, 0);
    const staffingStatus: StaffingStatus = employees.length === 0 ? "unstaffed" : missingTotal > 0 ? "understaffed" : "staffed";
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
      managerCitizenId: deriveManagerId(definition, employees),
      employeeCitizenIds: employees.map((citizen) => citizen.id),
      customerCitizenIds: customers.map((citizen) => citizen.id),
      openHours,
      capacity: definition.capacity,
      reputation: definition.reputation,
      staffingStatus,
      operationalStatus: deriveOperationalStatus(currentlyOpen, staffingStatus, employeesPresent.length, worldTime, openHours),
      allowedBusinessTypes: definition.allowedBusinessTypes,
      workstationIds: definition.workstationIds.filter((id) => WORKSTATIONS.some((station) => station.id === id)),
      requiredStaff: typeDefinition.requiredStaffRoles,
      currentStaffByRole,
      missingStaffByRole,
      employeesPresentCitizenIds: employeesPresent.map((citizen) => citizen.id),
      visitorsPresentCitizenIds: visitorsPresent.map((citizen) => citizen.id)
    };
  });
}

export function businessWorkstations(business: BusinessEntity): Workstation[] {
  return business.workstationIds.map((id) => WORKSTATIONS.find((station) => station.id === id)).filter((station): station is Workstation => Boolean(station));
}
