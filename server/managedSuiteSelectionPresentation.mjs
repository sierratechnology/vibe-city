import { createManagedCustomerIdentityDomain } from './managedCustomerIdentityDomain.mjs';
import { createManagedSuiteSelectionReadiness } from './managedSuiteSelectionReadiness.mjs';

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const defineProperty = Object.defineProperty;
const TypeErrorIntrinsic = TypeError;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add);
const weakSetHas = Function.call.bind(WeakSet.prototype.has);
const authenticResults = new WeakSet();
const isAuthenticIdentity = createManagedCustomerIdentityDomain.isAuthenticResult;
const isAuthenticReadiness = createManagedSuiteSelectionReadiness.isAuthenticResult;
const INVALID_INPUT = 'Invalid managed suite selection presentation input';

function invalid() {
  throw new TypeErrorIntrinsic(INVALID_INPUT);
}

function frozenRecord(entries) {
  const value = objectCreate(null);
  for (let index = 0; index < entries.length; index += 1) {
    value[entries[index][0]] = entries[index][1];
  }
  return objectFreeze(value);
}

export function createManagedSuiteSelectionPresentation(identity, readiness) {
  if (!isAuthenticIdentity(identity) || !isAuthenticReadiness(readiness)
      || identity.tenantBinding.tenantId !== readiness.tenantId
      || identity.organization.organizationId !== readiness.organizationId) invalid();
  const gates = [];
  for (let index = 0; index < readiness.gates.length; index += 1) {
    defineProperty(gates, `${index}`, {
      configurable: true,
      enumerable: true,
      value: frozenRecord([
        ['name', readiness.gates[index].name],
        ['state', readiness.gates[index].state],
      ]),
      writable: true,
    });
  }
  objectFreeze(gates);
  const result = frozenRecord([
    ['schemaVersion', 'managed-suite-selection-presentation/1'],
    ['tenantId', identity.tenantBinding.tenantId],
    ['accountId', identity.account.accountId],
    ['organizationId', identity.organization.organizationId],
    ['evaluatedAt', readiness.evaluatedAt],
    ['selectionStatus', 'blocked'],
    ['canSelect', false],
    ['canCommit', false],
    ['gates', gates],
  ]);
  weakSetAdd(authenticResults, result);
  return result;
}

defineProperty(createManagedSuiteSelectionPresentation, 'isAuthenticResult', {
  configurable: false,
  enumerable: false,
  value(value) {
    return value !== null && typeof value === 'object' && weakSetHas(authenticResults, value);
  },
  writable: false,
});
