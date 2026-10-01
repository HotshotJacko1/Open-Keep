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

// Sentry OPENKEEP-S: on Android Chrome, the IME can change the editor's DOM
// text before ProseMirror has read the mutation. If ProseMirror writes the
// selection in that window, it passes an offset from its model that is past
// the end of the now-shorter text node, and Selection.collapse throws
// IndexSizeError. Within a ProseMirror editor only, clamp the offset to the
// node's length; ProseMirror re-syncs on its next DOM flush. Elsewhere the
// native behaviour (throwing) is unchanged.
const clampInEditor = (name: "collapse" | "extend") => {
  const native = Selection.prototype[name] as (node: Node | null, offset?: number) => void;
  if (typeof native !== "function") return;
  Selection.prototype[name] = function (this: Selection, node: Node | null, offset = 0) {
    if (node && offset > 0) {
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (element?.closest(".ProseMirror")) {
        const length = node instanceof CharacterData ? node.length : node.childNodes.length;
        if (offset > length) offset = length;
      }
    }
    return native.call(this, node, offset);
  };
};

if (typeof Selection !== "undefined") {
  clampInEditor("collapse");
  clampInEditor("extend");
}

export {};
