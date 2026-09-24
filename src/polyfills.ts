// Copyright (c) 2026. Licensed under AGPLv3.
//
// Shims for built-ins that dependencies call but older Android WebViews lack
// (Sentry OPENKEEP-P: Object.hasOwn in react-markdown; OPENKEEP-Q/N:
// Array.prototype.findLast in TipTap/ProseMirror). esbuild's build.target only
// transpiles syntax, so these have to be patched at runtime. crypto.randomUUID
// is handled separately by safeRandomUUID in lib/utils.ts.
//
// Imported first in main.tsx. Each shim is installed only when missing, and as
// non-enumerable so `for...in` over arrays/objects is unaffected.

const define = (target: object, name: string, value: unknown) => {
  if (name in target) return;
  Object.defineProperty(target, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
};

define(Object, "hasOwn", (obj: object, key: PropertyKey) => {
  if (obj == null) throw new TypeError("Cannot convert undefined or null to object");
  return Object.prototype.hasOwnProperty.call(Object(obj), key);
});

define(
  Array.prototype,
  "findLast",
  function <T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (predicate.call(thisArg, this[i], i, this)) return this[i];
    }
    return undefined;
  }
);

define(
  Array.prototype,
  "findLastIndex",
  function <T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (predicate.call(thisArg, this[i], i, this)) return i;
    }
    return -1;
  }
);

export {};
