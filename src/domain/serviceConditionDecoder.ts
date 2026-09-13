import {
  classifyServiceConditionSnapshot,
  type ServiceConditionSnapshotResult
} from "./serviceCondition.ts";

const Uint8ArrayConstructor = Uint8Array;
const uint8ArrayPrototype = Uint8Array.prototype;
const arrayBufferPrototype = ArrayBuffer.prototype;
const typedArrayPrototype = Object.getPrototypeOf(uint8ArrayPrototype);
const getPrototypeOf: typeof Object.getPrototypeOf = Object.getPrototypeOf;
const createObject: typeof Object.create = Object.create;
const defineProperty: typeof Object.defineProperty = Object.defineProperty;
const applyReflect: typeof Reflect.apply = Reflect.apply;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(arrayBufferPrototype, "byteLength")!.get!;
const byteAt = Uint8Array.prototype.at;
const setBytes = Uint8Array.prototype.set;
const TextDecoderConstructor = TextDecoder;
const decodeText = TextDecoder.prototype.decode;
const StringConstructor = String;
const stringStartsWith = String.prototype.startsWith;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringFromCharCode = String.fromCharCode;
const stringFromCodePoint = String.fromCodePoint;
const arrayPrototype = Array.prototype;
const arrayIsArray = Array.isArray;
const arrayPush = Array.prototype.push;
const SetConstructor = Set;
const setPrototype = Set.prototype;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const MapConstructor = Map;
const mapPrototype = Map.prototype;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapHas = Map.prototype.has;
const mapValues = Map.prototype.values;
const WeakSetConstructor = WeakSet;
const weakSetPrototype = WeakSet.prototype;
const weakSetHas = WeakSet.prototype.has;
const weakSetAdd = WeakSet.prototype.add;

function parseDocument(text: string): unknown {
  let index = 0;
  let arrayElements = 0;
  let objectMembers = 0;
  let values = 0;
  let containers = 0;
  let stringBytes = 0;
  let parsingKey = false;
  const skipWhitespace = () => {
    while (text[index] === " " || text[index] === "\t" || text[index] === "\n" || text[index] === "\r") {
      index += 1;
    }
  };
  const consume = (character: string) => {
    skipWhitespace();
    if (text[index] !== character) throw new Error();
    index += 1;
  };
  const parseHexEscape = (start: number) => {
    let value = 0;
    let cursor = start;
    for (let count = 0; count < 4; count += 1) {
      const code = applyReflect(stringCharCodeAt, text, [cursor]) as number;
      let digit: number;
      if (code >= 48 && code <= 57) digit = code - 48;
      else if (code >= 65 && code <= 70) digit = code - 55;
      else if (code >= 97 && code <= 102) digit = code - 87;
      else throw new Error();
      value = value * 16 + digit;
      cursor += 1;
    }
    return { value, cursor };
  };
  const scanString = (start: number, build: boolean) => {
    if (text[start] !== "\"") throw new Error();
    let cursor = start + 1;
    let bytes = 0;
    let value = "";
    while (cursor < text.length && text[cursor] !== "\"") {
      const code = applyReflect(stringCharCodeAt, text, [cursor]) as number;
      if (code <= 0x1f) throw new Error();
      if (text[cursor] !== "\\") {
        if (code <= 0x7f) bytes += 1;
        else if (code <= 0x7ff) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
          const next = applyReflect(stringCharCodeAt, text, [cursor + 1]) as number;
          if (next < 0xdc00 || next > 0xdfff) throw new Error();
          bytes += 4;
          if (build) value += text[cursor] + text[cursor + 1];
          cursor += 2;
          continue;
        } else {
          if (code >= 0xdc00 && code <= 0xdfff) throw new Error();
          bytes += 3;
        }
        if (build) value += text[cursor];
        cursor += 1;
        continue;
      }
      cursor += 1;
      const escape = text[cursor];
      cursor += 1;
      let decoded: string;
      let decodedCode: number;
      if (escape === "\"" || escape === "\\" || escape === "/") {
        decoded = escape;
        decodedCode = applyReflect(stringCharCodeAt, escape, [0]) as number;
      } else if (escape === "b") {
        decoded = "\b";
        decodedCode = 0x08;
      } else if (escape === "f") {
        decoded = "\f";
        decodedCode = 0x0c;
      } else if (escape === "n") {
        decoded = "\n";
        decodedCode = 0x0a;
      } else if (escape === "r") {
        decoded = "\r";
        decodedCode = 0x0d;
      } else if (escape === "t") {
        decoded = "\t";
        decodedCode = 0x09;
      } else if (escape === "u") {
        const first = parseHexEscape(cursor);
        cursor = first.cursor;
        decodedCode = first.value;
        if (decodedCode >= 0xd800 && decodedCode <= 0xdbff) {
          if (text[cursor] !== "\\" || text[cursor + 1] !== "u") throw new Error();
          const second = parseHexEscape(cursor + 2);
          if (second.value < 0xdc00 || second.value > 0xdfff) throw new Error();
          cursor = second.cursor;
          decodedCode = 0x10000 + (decodedCode - 0xd800) * 0x400 + second.value - 0xdc00;
        } else if (decodedCode >= 0xdc00 && decodedCode <= 0xdfff) throw new Error();
        decoded = applyReflect(stringFromCodePoint, String, [decodedCode]) as string;
      } else throw new Error();
      bytes += decodedCode <= 0x7f ? 1 : decodedCode <= 0x7ff ? 2 : decodedCode <= 0xffff ? 3 : 4;
      if (build) value += decoded;
    }
    if (text[cursor] !== "\"") throw new Error();
    return { bytes, end: cursor + 1, value };
  };
  const parseString = () => {
    skipWhitespace();
    const scanned = scanString(index, false);
    if (scanned.bytes > (parsingKey ? 32 : 80) || stringBytes + scanned.bytes > 8_192) throw new Error();
    stringBytes += scanned.bytes;
    const decoded = scanString(index, true);
    index = decoded.end;
    return decoded.value;
  };
  const parseValue = (depth: number): unknown => {
    skipWhitespace();
    if (values >= 196) throw new Error();
    values += 1;
    if (text[index] === "{") {
      if (depth >= 3 || containers >= 34) throw new Error();
      containers += 1;
      return parseObject(depth + 1);
    }
    if (text[index] === "[") {
      if (depth >= 3 || containers >= 34) throw new Error();
      containers += 1;
      return parseArray(depth + 1);
    }
    if (text[index] === "\"") return parseString();
    for (const [token, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (applyReflect(stringStartsWith, text, [token, index])) {
        index += token.length;
        return value;
      }
    }
    throw new Error();
  };
  const parseObject = (depth: number): Record<string, unknown> => {
    consume("{");
    const result = applyReflect(createObject, Object, [null]) as Record<string, unknown>;
    const keys = new SetConstructor<string>();
    let members = 0;
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return result;
    }
    while (true) {
      if (members >= 9 || objectMembers >= 179) throw new Error();
      members += 1;
      objectMembers += 1;
      parsingKey = true;
      const key = parseString();
      parsingKey = false;
      if (applyReflect(setHas, keys, [key])) throw new Error();
      applyReflect(setAdd, keys, [key]);
      consume(":");
      const value = parseValue(depth);
      applyReflect(defineProperty, Object, [result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true
      }]);
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        return result;
      }
      consume(",");
    }
  };
  const parseArray = (depth: number): unknown[] => {
    consume("[");
    const result: unknown[] = [];
    let elements = 0;
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return result;
    }
    while (true) {
      if (elements >= 16 || arrayElements >= 16) throw new Error();
      elements += 1;
      arrayElements += 1;
      applyReflect(arrayPush, result, [parseValue(depth)]);
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return result;
      }
      consume(",");
    }
  };

  const result = parseValue(-1);
  skipWhitespace();
  if (index !== text.length) throw new Error();
  return result;
}

export function decodeServiceConditionSnapshotJson(
  input: unknown
): ServiceConditionSnapshotResult {
  try {
    if (getPrototypeOf(input) !== uint8ArrayPrototype) {
      return classifyServiceConditionSnapshot(null);
    }
    const byteLength = applyReflect(byteLengthGetter, input, []) as number;
    const buffer = applyReflect(bufferGetter, input, []) as ArrayBuffer;
    if (getPrototypeOf(buffer) !== arrayBufferPrototype) {
      return classifyServiceConditionSnapshot(null);
    }
    applyReflect(arrayBufferByteLengthGetter, buffer, []);
    if (byteLength === 0 || byteLength > 16_384) {
      return classifyServiceConditionSnapshot(null);
    }
    if (applyReflect(byteAt, input, [0]) === 0xef
      && applyReflect(byteAt, input, [1]) === 0xbb
      && applyReflect(byteAt, input, [2]) === 0xbf) {
      return classifyServiceConditionSnapshot(null);
    }
    const bytes = new Uint8ArrayConstructor(byteLength);
    applyReflect(setBytes, bytes, [input]);
    const decoder = new TextDecoderConstructor("utf-8", { fatal: true, ignoreBOM: true });
    const text = applyReflect(decodeText, decoder, [bytes]) as string;
    const parsed = parseDocument(text);
    if (Set !== SetConstructor
      || setPrototype.has !== setHas
      || setPrototype.add !== setAdd
      || Array.isArray !== arrayIsArray
      || arrayPrototype.push !== arrayPush
      || String !== StringConstructor
      || String.prototype.charCodeAt !== stringCharCodeAt
      || String.fromCharCode !== stringFromCharCode
      || Map !== MapConstructor
      || mapPrototype.get !== mapGet
      || mapPrototype.set !== mapSet
      || mapPrototype.has !== mapHas
      || mapPrototype.values !== mapValues
      || WeakSet !== WeakSetConstructor
      || weakSetPrototype.has !== weakSetHas
      || weakSetPrototype.add !== weakSetAdd) {
      return classifyServiceConditionSnapshot(null);
    }
    return classifyServiceConditionSnapshot(parsed);
  } catch {
    return classifyServiceConditionSnapshot(null);
  }
}
