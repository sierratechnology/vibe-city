// @ts-expect-error -- this dormant Node-only boundary intentionally has no Node type package.
import { types } from 'node:util';
import { deriveServiceCondition } from './serviceCondition.ts';

const FAILURE_CODE = 'invalid_service_condition_observation';
const uint8ArrayPrototype = Uint8Array.prototype;
const getPrototypeOf = Object.getPrototypeOf;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const defineProperties = Object.defineProperties;
const freezeObject = Object.freeze;
const applyReflect = Reflect.apply;
const typedArrayPrototype = getPrototypeOf(uint8ArrayPrototype);
const arrayBufferPrototype = ArrayBuffer.prototype;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const byteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  arrayBufferPrototype, 'byteLength',
)!.get!;
const resizableGetter = Object.getOwnPropertyDescriptor(arrayBufferPrototype, 'resizable')?.get;
const maxByteLengthGetter = Object.getOwnPropertyDescriptor(
  arrayBufferPrototype, 'maxByteLength',
)?.get;
const setBytes = Uint8Array.prototype.set;
const byteAt = Uint8Array.prototype.at;
const decodeText = TextDecoder.prototype.decode;
const charCodeAt = String.prototype.charCodeAt;
const startsWith = String.prototype.startsWith;
const SetConstructor = Set;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const setSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const INPUT_KEYS = new SetConstructor([
  'tenantId', 'serviceId', 'sourceObservationId', 'observedAt', 'evaluatedAt',
  'sourceAvailability', 'lifecycle', 'required', 'configured', 'healthEvidence',
  'blockReason',
]);

function failure() {
  const result = createObject(null) as Record<string, unknown>;
  defineProperties(result, {
    ok: { value: false, enumerable: true },
    error: { value: FAILURE_CODE, enumerable: true },
  });
  return freezeObject(result);
}

function parseDocument(text: string) {
  let index = 0;
  let stringBytes = 0;
  const skipWhitespace = () => {
    while (text[index] === ' ' || text[index] === '\t'
      || text[index] === '\n' || text[index] === '\r') index += 1;
  };
  const parseString = (key: boolean) => {
    skipWhitespace();
    if (text[index] !== '"') throw new Error();
    index += 1;
    let value = '';
    let bytes = 0;
    while (index < text.length && text[index] !== '"') {
      let code = applyReflect(charCodeAt, text, [index]) as number;
      if (code <= 0x1f) throw new Error();
      if (code === 0x5c) {
        throw new Error();
      } else {
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = applyReflect(charCodeAt, text, [index + 1]) as number;
          if (low < 0xdc00 || low > 0xdfff) throw new Error();
          value += text[index] + text[index + 1];
          code = 0x10000 + (code - 0xd800) * 0x400 + low - 0xdc00;
          index += 2;
        } else {
          if (code >= 0xdc00 && code <= 0xdfff) throw new Error();
          value += text[index];
          index += 1;
        }
      }
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (bytes > (key ? 32 : 128) || stringBytes + bytes > 4_096) throw new Error();
    }
    if (text[index] !== '"') throw new Error();
    index += 1;
    stringBytes += bytes;
    return value;
  };
  const parseValue = () => {
    skipWhitespace();
    if (text[index] === '"') return parseString(false);
    if (applyReflect(startsWith, text, ['true', index])) {
      index += 4;
      return true;
    }
    if (applyReflect(startsWith, text, ['false', index])) {
      index += 5;
      return false;
    }
    if (applyReflect(startsWith, text, ['null', index])) {
      index += 4;
      return null;
    }
    throw new Error();
  };

  skipWhitespace();
  if (text[index] !== '{') throw new Error();
  index += 1;
  const result = {} as Record<string, unknown>;
  const keys = new SetConstructor<string>();
  const requiredKeyCount = applyReflect(setSizeGetter, INPUT_KEYS, []) as number;
  for (let member = 0; member < requiredKeyCount; member += 1) {
    const key = parseString(true);
    if (!applyReflect(setHas, INPUT_KEYS, [key])
      || applyReflect(setHas, keys, [key])) throw new Error();
    applyReflect(setAdd, keys, [key]);
    skipWhitespace();
    if (text[index] !== ':') throw new Error();
    index += 1;
    defineProperty(result, key, {
      value: parseValue(), enumerable: true, configurable: false, writable: false,
    });
    skipWhitespace();
    if (member < requiredKeyCount - 1) {
      if (text[index] !== ',') throw new Error();
      index += 1;
    }
  }
  skipWhitespace();
  if (text[index] !== '}') throw new Error();
  index += 1;
  skipWhitespace();
  if (index !== text.length
    || applyReflect(setSizeGetter, keys, []) !== requiredKeyCount) throw new Error();
  return result;
}

export function decodeServiceConditionObservation(input: unknown) {
  try {
    if (types.isProxy(input) || getPrototypeOf(input) !== uint8ArrayPrototype) return failure();
    const byteLength = applyReflect(byteLengthGetter, input, []) as number;
    const byteOffset = applyReflect(byteOffsetGetter, input, []) as number;
    const buffer = applyReflect(bufferGetter, input, []) as ArrayBuffer;
    if (getPrototypeOf(buffer) !== arrayBufferPrototype) return failure();
    const bufferLength = applyReflect(arrayBufferByteLengthGetter, buffer, []) as number;
    if (byteLength === 0 || byteLength > 16_384 || byteOffset !== 0
      || bufferLength !== byteLength
      || (resizableGetter && applyReflect(resizableGetter, buffer, []))
      || (maxByteLengthGetter
        && applyReflect(maxByteLengthGetter, buffer, []) !== bufferLength)) return failure();
    if (applyReflect(byteAt, input, [0]) === 0xef
      && applyReflect(byteAt, input, [1]) === 0xbb
      && applyReflect(byteAt, input, [2]) === 0xbf) return failure();
    const bytes = new Uint8Array(byteLength);
    applyReflect(setBytes, bytes, [input]);
    for (let index = 0; index < byteLength; index += 1) {
      if (applyReflect(byteAt, input, [index]) !== bytes[index]) return failure();
    }
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const text = applyReflect(decodeText, decoder, [bytes]) as string;
    const condition = deriveServiceCondition(parseDocument(text));
    const result = createObject(null) as Record<string, unknown>;
    defineProperties(result, {
      ok: { value: true, enumerable: true },
      condition: { value: condition, enumerable: true },
    });
    return freezeObject(result);
  } catch {
    return failure();
  }
}
