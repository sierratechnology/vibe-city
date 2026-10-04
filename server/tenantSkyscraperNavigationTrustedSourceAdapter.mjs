import { isProxy } from 'node:util/types';

const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const TypeErrorIntrinsic = TypeError;

function invalidSource() {
  throw new TypeErrorIntrinsic('trusted navigation source is required');
}

export function createTenantSkyscraperNavigationTrustedSourceAdapter(source) {
  if (arguments.length !== 1 || source === null || typeof source !== 'object'
      || isProxy(source)) invalidSource();
  const prototype = getPrototypeOf(source);
  if (prototype !== ObjectPrototype && prototype !== null) invalidSource();
  const keys = reflectOwnKeys(source);
  if (keys.length !== 2
      || !((keys[0] === 'authenticate' && keys[1] === 'resolveTrustedNavigationState')
        || (keys[1] === 'authenticate' && keys[0] === 'resolveTrustedNavigationState'))) {
    invalidSource();
  }
  const authenticateDescriptor = getOwnPropertyDescriptor(source, 'authenticate');
  const resolveDescriptor = getOwnPropertyDescriptor(source, 'resolveTrustedNavigationState');
  if (!authenticateDescriptor || !('value' in authenticateDescriptor)
      || authenticateDescriptor.enumerable !== true
      || !resolveDescriptor || !('value' in resolveDescriptor)
      || resolveDescriptor.enumerable !== true
      || typeof authenticateDescriptor.value !== 'function'
      || typeof resolveDescriptor.value !== 'function'
      || isProxy(authenticateDescriptor.value) || isProxy(resolveDescriptor.value)) invalidSource();
  const authenticate = authenticateDescriptor.value;
  const resolveTrustedNavigationState = resolveDescriptor.value;
  const authenticateWrapper = objectFreeze(
    (sessionCredential) => reflectApply(authenticate, undefined, [sessionCredential]),
  );
  const resolveTrustedNavigationStateWrapper = objectFreeze(
    (context) => reflectApply(resolveTrustedNavigationState, undefined, [context]),
  );
  const dependencies = objectCreate(null);
  dependencies.authenticate = authenticateWrapper;
  dependencies.resolveTrustedNavigationState = resolveTrustedNavigationStateWrapper;
  return objectFreeze(dependencies);
}
