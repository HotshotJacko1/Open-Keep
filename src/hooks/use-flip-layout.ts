// Copyright (c) 2026. Licensed under AGPLv3.
import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

// M3 motion: standard easing for things moving on screen, emphasized
// decelerate for things entering.
const MOVE = { duration: 300, easing: "cubic-bezier(0.2, 0, 0, 1)" };
const ENTER = { duration: 250, easing: "cubic-bezier(0.05, 0.7, 0.1, 1)" };
const ANIMATION_ID = "flip-layout";

type Point = { x: number; y: number };

/**
 * Animates layout changes inside `containerRef` (M3 "items glide into place").
 *
 * Children opt in with a `data-flip-id` attribute. Whenever `layoutKey`
 * changes -- a note removed, added, reordered, or the view mode switched --
 * each child that moved slides from where it was to where it now is, and new
 * children fade in. This is the FLIP technique: the DOM has already jumped to
 * the final layout, and a transform plays the jump back smoothly.
 *
 * Positions are layout offsets (offsetLeft/offsetTop) relative to the
 * container, not screen rects, so scrolling, the pull-to-refresh transform,
 * in-flight animations and the grid itself moving never skew them. They are re-recorded after every commit and whenever the
 * container resizes (window resize, an image finishing loading), so a later
 * change always starts from the current layout.
 */
export function useFlipLayout(containerRef: RefObject<HTMLElement | null>, layoutKey: string) {
  const positions = useRef(new Map<string, Point>());
  const prevKey = useRef<string | null>(null);
  const observed = useRef<{ el: HTMLElement; observer: ResizeObserver } | null>(null);

  // Disconnect the resize observer on unmount.
  useLayoutEffect(() => () => observed.current?.observer.disconnect(), []);

  useLayoutEffect(() => {
    const container = containerRef.current;

    // The container can unmount and come back (e.g. the pinned section):
    // forget everything so the new one doesn't animate from stale positions,
    // and keep the resize observer on whichever element is current.
    if (observed.current && observed.current.el !== container) {
      observed.current.observer.disconnect();
      observed.current = null;
    }
    if (!container) {
      positions.current = new Map();
      prevKey.current = null;
      return;
    }
    if (!observed.current && typeof ResizeObserver !== "undefined") {
      // Layout can shift without a React commit (window resize, an image
      // finishing loading); re-record so the next change starts from truth.
      const observer = new ResizeObserver(() => {
        positions.current = measure(container);
      });
      observer.observe(container);
      observed.current = { el: container, observer };
    }

    const next = measure(container);
    const keyChanged = prevKey.current !== null && prevKey.current !== layoutKey;
    const hadItems = positions.current.size > 0;
    prevKey.current = layoutKey;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (keyChanged && hadItems && !reduceMotion) {
      for (const item of items(container)) {
        const id = item.dataset.flipId!;
        const before = positions.current.get(id);
        const after = next.get(id)!;

        if (!before) {
          cancelRunning(item);
          item.animate(
            [{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }],
            { ...ENTER, id: ANIMATION_ID, fill: "backwards" }
          );
          continue;
        }

        // Start from where the card was actually drawn: its old layout spot
        // plus whatever an interrupted animation had it offset by.
        const current = runningOffset(item);
        const dx = before.x + current.x - after.x;
        const dy = before.y + current.y - after.y;
        cancelRunning(item);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

        item.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          { ...MOVE, id: ANIMATION_ID }
        );
      }
    }

    positions.current = next;
  });
}

type Snapshot = Map<string, Point & { el: HTMLElement }>;

/**
 * FLIP for one change you know is coming, such as ticking a checklist item,
 * which sends it down to the ticked section. Call the returned `capture()`
 * just before the state change; on the next commit, every `[data-flip-id]`
 * element under the container slides from where it was to where it now is,
 * and new ones fade in.
 *
 * Unlike useFlipLayout, the elements can be anywhere under the container (a
 * checklist's two sections are separate lists), and nothing is measured until
 * capture() is called, so typing doesn't pay for it.
 *
 * An element that was re-created rather than moved (an item changing section
 * is a new element with the same id) travels above its neighbours on the
 * nearest solid background, so it passes over the rows it crosses rather than
 * through them. Its parent must be a flex or grid container for the z-index
 * to apply.
 */
export function useFlipNextChange(containerRef: RefObject<HTMLElement | null>) {
  const snapshot = useRef<Snapshot | null>(null);
  const running = useRef(new Set<Animation>());

  useLayoutEffect(() => {
    const before = snapshot.current;
    const container = containerRef.current;
    snapshot.current = null;
    if (!before || !container) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // The snapshot was taken as drawn, mid-animation included, so stopping
    // the old animations here only means measuring the new layout cleanly.
    for (const animation of running.current) animation.cancel();
    running.current.clear();

    const origin = container.getBoundingClientRect();
    let background: string | undefined;
    for (const el of descendants(container)) {
      const prev = before.get(el.dataset.flipId!);
      let animation: Animation;
      if (!prev) {
        animation = el.animate([{ opacity: 0 }, { opacity: 1 }], { ...ENTER, fill: "backwards" });
      } else {
        const rect = el.getBoundingClientRect();
        const dx = prev.x - (rect.left - origin.left);
        const dy = prev.y - (rect.top - origin.top);
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        const from: Keyframe = { transform: `translate(${dx}px, ${dy}px)` };
        const to: Keyframe = { transform: "none" };
        if (prev.el !== el) {
          if (background === undefined) background = solidBackground(container);
          for (const frame of [from, to]) {
            frame.zIndex = 1;
            frame.backgroundColor = background;
          }
        }
        // A little longer for a long trip, so it reads as moving, not jumping.
        const duration = Math.min(500, MOVE.duration + Math.abs(dy) / 10);
        animation = el.animate([from, to], { ...MOVE, duration });
      }
      running.current.add(animation);
      animation.onfinish = () => running.current.delete(animation);
    }
  });

  return useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const origin = container.getBoundingClientRect();
    const map: Snapshot = new Map();
    for (const el of descendants(container)) {
      const rect = el.getBoundingClientRect();
      map.set(el.dataset.flipId!, { x: rect.left - origin.left, y: rect.top - origin.top, el });
    }
    snapshot.current = map;
  }, [containerRef]);
}

function descendants(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-flip-id]"));
}

// The colour actually painted behind the container: the first ancestor with a
// background that isn't fully transparent.
function solidBackground(container: HTMLElement): string {
  for (let el: HTMLElement | null = container; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (color && !isTransparent(color)) return color;
  }
  return "transparent";
}

// Zero alpha comes back as "rgba(0, 0, 0, 0)" or, in newer colour syntax, "... / 0)".
function isTransparent(color: string): boolean {
  return (
    color === "transparent" ||
    /^rgba\([^,]*,[^,]*,[^,]*,\s*0(\.0+)?\s*\)$/.test(color) ||
    /\/\s*0(\.0+)?\s*\)$/.test(color)
  );
}

function items(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(":scope > [data-flip-id]"));
}

// Positions are relative to the container, so the whole grid shifting (the
// note creator expanding above it, a banner appearing) doesn't count as the
// cards moving.
function measure(container: HTMLElement): Map<string, Point> {
  const map = new Map<string, Point>();
  for (const item of items(container)) {
    const sameParent = item.offsetParent === container.offsetParent;
    map.set(item.dataset.flipId!, {
      x: item.offsetLeft - (sameParent ? container.offsetLeft : 0),
      y: item.offsetTop - (sameParent ? container.offsetTop : 0),
    });
  }
  return map;
}

function runningAnimations(item: HTMLElement): Animation[] {
  return item.getAnimations?.().filter((a) => a.id === ANIMATION_ID) ?? [];
}

function runningOffset(item: HTMLElement): Point {
  if (runningAnimations(item).length === 0) return { x: 0, y: 0 };
  const transform = getComputedStyle(item).transform;
  if (!transform || transform === "none") return { x: 0, y: 0 };
  const m = new DOMMatrixReadOnly(transform);
  return { x: m.m41, y: m.m42 };
}

function cancelRunning(item: HTMLElement) {
  for (const animation of runningAnimations(item)) animation.cancel();
}
