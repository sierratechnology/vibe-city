import { createManagedCustomerIdentityDomain } from './managedCustomerIdentityDomain.mjs';
import { createManagedFirstAssignmentReadiness } from './managedFirstAssignmentReadiness.mjs';
import { createManagedRepositoryConnectionReadiness } from './managedRepositoryConnectionReadiness.mjs';
import { createManagedStarterAgentReadiness } from './managedStarterAgentReadiness.mjs';
import { createManagedSuiteSelectionPresentation } from './managedSuiteSelectionPresentation.mjs';

const TypeErrorIntrinsic = TypeError;
const mathFloor = Math.floor;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const defineProperty = Object.defineProperty;
const stringCharCodeAt = Function.call.bind(String.prototype.charCodeAt);
const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
const weakSetHas = Function.call.bind(WeakSet.prototype.has);
const authenticResults = new WeakSet();
const INVALID_INPUT = 'Invalid managed customer journey presentation input';
const isAuthenticIdentity = createManagedCustomerIdentityDomain.isAuthenticResult;
const isAuthenticPresentation = createManagedSuiteSelectionPresentation.isAuthenticResult;
const isAuthenticStarter = createManagedStarterAgentReadiness.isAuthenticResult;
const isAuthenticRepository = createManagedRepositoryConnectionReadiness.isAuthenticResult;
const isAuthenticAssignment = createManagedFirstAssignmentReadiness.isAuthenticResult;

function invalid() {
  throw new TypeErrorIntrinsic(INVALID_INPUT);
}

function defineDataProperty(target, key, value, configurable, enumerable, writable) {
  const descriptor = objectCreate(null);
  descriptor.configurable = configurable;
  descriptor.enumerable = enumerable;
  descriptor.value = value;
  descriptor.writable = writable;
  defineProperty(target, key, descriptor);
}

function frozenRecord(entries) {
  const value = objectCreate(null);
  for (let index = 0; index < entries.length; index += 1) {
    value[entries[index][0]] = entries[index][1];
  }
  return objectFreeze(value);
}

function digit(value, index) {
  const code = stringCharCodeAt(value, index);
  return code >= 0x30 && code <= 0x39 ? code - 0x30 : -1;
}

function timestampValue(value) {
  if (typeof value !== 'string' || value.length !== 24
      || stringCharCodeAt(value, 4) !== 0x2d || stringCharCodeAt(value, 7) !== 0x2d
      || stringCharCodeAt(value, 10) !== 0x54 || stringCharCodeAt(value, 13) !== 0x3a
      || stringCharCodeAt(value, 16) !== 0x3a || stringCharCodeAt(value, 19) !== 0x2e
      || stringCharCodeAt(value, 23) !== 0x5a) return undefined;
  const positions = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22];
  for (let index = 0; index < positions.length; index += 1) {
    if (digit(value, positions[index]) < 0) return undefined;
  }
  const year = digit(value, 0) * 1000 + digit(value, 1) * 100
    + digit(value, 2) * 10 + digit(value, 3);
  const month = digit(value, 5) * 10 + digit(value, 6);
  const day = digit(value, 8) * 10 + digit(value, 9);
  const hour = digit(value, 11) * 10 + digit(value, 12);
  const minute = digit(value, 14) * 10 + digit(value, 15);
  const second = digit(value, 17) * 10 + digit(value, 18);
  const millisecond = digit(value, 20) * 100 + digit(value, 21) * 10 + digit(value, 22);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return undefined;
  let maxDay = 31;
  if (month === 4 || month === 6 || month === 9 || month === 11) maxDay = 30;
  else if (month === 2) maxDay = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  if (day < 1 || day > maxDay) return undefined;
  const adjustedYear = month <= 2 ? year - 1 : year;
  const era = mathFloor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = mathFloor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + mathFloor(yearOfEra / 4)
    - mathFloor(yearOfEra / 100) + dayOfYear;
  return ((((era * 146097 + dayOfEra) * 24 + hour) * 60 + minute) * 60 + second) * 1000
    + millisecond;
}

export function createManagedCustomerJourneyPresentation(
  identity,
  presentation,
  starter,
  repository,
  assignment,
) {
  if (!isAuthenticIdentity(identity)
      || !isAuthenticPresentation(presentation)
      || !isAuthenticStarter(starter)
      || !isAuthenticRepository(repository)
      || !isAuthenticAssignment(assignment)
      || identity.tenantBinding.tenantId !== presentation.tenantId
      || identity.account.accountId !== presentation.accountId
      || identity.organization.organizationId !== presentation.organizationId
      || presentation.tenantId !== starter.tenantId
      || presentation.accountId !== starter.accountId
      || presentation.organizationId !== starter.organizationId
      || presentation.tenantId !== repository.tenantId
      || presentation.accountId !== repository.accountId
      || presentation.organizationId !== repository.organizationId
      || presentation.tenantId !== assignment.tenantId
      || presentation.accountId !== assignment.accountId
      || presentation.organizationId !== assignment.organizationId) invalid();
  const presentationValue = timestampValue(presentation.evaluatedAt);
  const starterValue = timestampValue(starter.evaluatedAt);
  const repositoryValue = timestampValue(repository.evaluatedAt);
  const assignmentValue = timestampValue(assignment.evaluatedAt);
  if (presentationValue === undefined
      || starterValue === undefined
      || repositoryValue === undefined
      || assignmentValue === undefined
      || presentationValue > starterValue
      || starterValue > repositoryValue
      || repositoryValue > assignmentValue
      || assignmentValue - presentationValue > 86_400_000
      || assignmentValue - starterValue > 86_400_000
      || assignmentValue - repositoryValue > 86_400_000) invalid();
  const steps = [];
  const definitions = [
    ['account_organization', 'ready'],
    ['suite_selection', presentation.selectionStatus],
    ['starter_agent', starter.introductionStatus],
    ['repository_connection', repository.connectionStatus],
    ['first_assignment', assignment.assignmentStatus],
  ];
  for (let index = 0; index < definitions.length; index += 1) {
    defineDataProperty(steps, `${index}`, frozenRecord([
      ['name', definitions[index][0]],
      ['state', definitions[index][1]],
    ]), true, true, true);
  }
  objectFreeze(steps);
  const result = frozenRecord([
    ['schemaVersion', 'managed-customer-journey-presentation/1'],
    ['tenantId', presentation.tenantId],
    ['accountId', identity.account.accountId],
    ['organizationId', identity.organization.organizationId],
    ['evaluatedAt', assignment.evaluatedAt],
    ['journeyStatus', 'blocked'],
    ['canAdvance', false],
    ['canComplete', false],
    ['steps', steps],
  ]);
  weakSetAdd(authenticResults, result);
  return result;
}

defineDataProperty(
  createManagedCustomerJourneyPresentation,
  'isAuthenticResult',
  function isAuthenticResult(value) {
    return value !== null && typeof value === 'object' && weakSetHas(authenticResults, value);
  },
  false,
  false,
  false,
);
