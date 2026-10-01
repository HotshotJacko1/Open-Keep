// Copyright (c) 2026. Licensed under AGPLv3.

/**
 * M3 "container transform" between a note card and the note editor.
 *
 * A plain "ghost" panel -- no content, just the container's colour and shape
 * -- morphs between the card's rect and the editor dialog's rect, while the
 * real content cross-fades at each end. Because the ghost is its own layer,
 * the editor's open/close logic is untouched; NoteEditor only swaps its own
 * zoom animation for fades timed to match (see `morph` in NoteEditor and the
 * md3-fade-* keyframes in globals.css).
 *
 * Open:  card content fades into the ghost -> ghost grows into the dialog ->
 *        dialog content fades in over it (CSS delay = MORPH_MS).
 * Close: dialog content fades out over the ghost -> ghost shrinks into the
 *        card's (possibly new) position -> card fades back in.
 */

/** Keep in sync with the delay in NoteEditor's morph fade-in class. */
export const MORPH_MS = 350;
const FADE_MS = 150;
const CLOSE_FADE_MS = 100;
// M3 emphasized easing, as a single cubic curve.
const EASING = "cubic-bezier(0.2, 0, 0, 1)";
const HIDE_ID = "container-transform-hide";

type Surface = { rect: DOMRect; background: string; radius: string };

export class NoteContainerTransform {
  private ghost: HTMLDivElement | null = null;
  private noteId: string | null = null;
  private from: Surface | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Call when a note is opened from its card, before the editor renders.
   * Returns false (no morph; use the normal dialog animation) when there is
   * no card on screen or the user prefers reduced motion.
   */
  beginOpen(noteId: string): boolean {
    this.reset();
    if (prefersReducedMotion()) return false;
    const card = findNoteCard(noteId);
    if (!card) return false;
    this.noteId = noteId;
    this.from = surface(card);
    this.ghost = makeGhost(this.from);
    return true;
  }

  /**
   * Call from a layout effect once the editor is open. The dialog's portal
   * mounts one render later (Radix sets its "mounted" flag in a layout effect),
   * so look again after that synchronous re-render -- a microtask still runs
   * before the first paint -- and then a few frames later as a fallback.
   */
  playOpen(attempt = 0) {
    const ghost = this.ghost;
    const from = this.from;
    if (!ghost || !from || !this.noteId) return;
    const dialog = document.querySelector<HTMLElement>(".note-editor-dialog");
    if (!dialog) {
      if (attempt < 2) queueMicrotask(() => this.playOpen(attempt + 1));
      else if (attempt < 5) this.timer = setTimeout(() => this.playOpen(attempt + 1), 16);
      else this.reset();
      return;
    }
    this.from = null;
    const to = surface(dialog);

    hideCard(this.noteId);
    const grow = ghost.animate(
      [
        { ...geometry(from), opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { ...geometry(to), opacity: 1 },
      ],
      { duration: MORPH_MS, easing: EASING, fill: "forwards" }
    );
    whenDone(grow, MORPH_MS, () => this.fadeOutGhost(ghost, FADE_MS));
  }

  /**
   * Call when the editor starts closing, while the dialog is still on screen.
   * Only after a morphed open: the dialog is then using the fade-out that this
   * pairs with.
   */
  beginClose() {
    const noteId = this.noteId;
    const dialog = document.querySelector<HTMLElement>(".note-editor-dialog");
    this.clearGhost();
    if (!noteId || !dialog) return;

    const from = surface(dialog);
    const ghost = makeGhost(from);
    this.ghost = ghost;
    ghost.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CLOSE_FADE_MS, fill: "forwards" });

    // Measure the card only after the save/reorder has rendered, so the ghost
    // lands where the card now is (editing moves a note to the top).
    this.timer = setTimeout(() => {
      this.timer = null;
      const card = findNoteCard(noteId);
      if (this.ghost !== ghost) return; // superseded by a newer open/close
      if (!card) {
        // Deleted, archived or filtered out: just fade away.
        this.fadeOutGhost(ghost, FADE_MS);
        this.noteId = null;
        return;
      }
      const to = surface(card, true);
      const shrink = ghost.animate(
        [{ ...geometry(from), opacity: 1 }, { ...geometry(to), opacity: 1 }],
        { duration: MORPH_MS, easing: EASING, fill: "forwards" }
      );
      whenDone(shrink, MORPH_MS, () => {
        if (this.ghost !== ghost) return;
        showCard(noteId);
        this.noteId = null;
        this.fadeOutGhost(ghost, FADE_MS);
      });
    }, CLOSE_FADE_MS);
  }

  /** Stop everything and restore the card. */
  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearGhost();
    if (this.noteId) showCard(this.noteId);
    this.noteId = null;
    this.from = null;
  }

  private fadeOutGhost(ghost: HTMLDivElement, duration: number) {
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration, fill: "forwards" });
    whenDone(fade, duration, () => {
      ghost.remove();
      if (this.ghost === ghost) this.ghost = null;
    });
  }

  private clearGhost() {
    // Cancel first so any pending whenDone() callbacks for it are skipped.
    this.ghost?.getAnimations().forEach((a) => a.cancel());
    this.ghost?.remove();
    this.ghost = null;
  }
}

/**
 * Run `fn` once when `animation` finishes -- or shortly after it should have,
 * in case the finish event never arrives (the app is suspended mid-animation
 * and the timeline stalls). Without this a card could stay hidden for good.
 * Not run if the animation is cancelled; reset() cleans up then.
 */
function whenDone(animation: Animation, duration: number, fn: () => void) {
  let done = false;
  const run = () => {
    if (done || animation.playState === "idle") return;
    done = true;
    clearTimeout(fallback);
    fn();
  };
  const fallback = setTimeout(run, duration + 250);
  animation.onfinish = run;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function findNoteCard(noteId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.note-card[data-note-id="${CSS.escape(noteId)}"]`);
}

/**
 * Where an element is drawn and what its container looks like. With
 * `ignoreMotion`, a translate from a running animation (the grid's
 * glide-into-place) is subtracted, giving the spot it is heading to.
 */
function surface(el: HTMLElement, ignoreMotion = false): Surface {
  let rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  if (ignoreMotion && style.transform && style.transform !== "none") {
    const m = new DOMMatrixReadOnly(style.transform);
    rect = new DOMRect(rect.x - m.m41, rect.y - m.m42, rect.width, rect.height);
  }
  return { rect, background: style.backgroundColor, radius: style.borderTopLeftRadius };
}

function geometry(s: Surface): Keyframe {
  return {
    left: `${s.rect.left}px`,
    top: `${s.rect.top}px`,
    width: `${s.rect.width}px`,
    height: `${s.rect.height}px`,
    borderRadius: s.radius,
    backgroundColor: s.background,
  };
}

function makeGhost(s: Surface): HTMLDivElement {
  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${s.rect.left}px`,
    top: `${s.rect.top}px`,
    width: `${s.rect.width}px`,
    height: `${s.rect.height}px`,
    borderRadius: s.radius,
    backgroundColor: s.background,
    boxShadow: "0 10px 30px rgb(0 0 0 / 0.2)",
    // Above the dialog scrim (z-50) so the panel isn't dimmed, below toasts.
    zIndex: "55",
    pointerEvents: "none",
    opacity: "0",
  });
  document.body.appendChild(ghost);
  return ghost;
}

// The card stays hidden while its note is open, so nothing is left behind in
// the grid. It fades out under the growing ghost, then is held hidden with
// inline `visibility` (React doesn't manage that property, so it survives
// re-renders) rather than by the fade's opacity fill: Chrome doesn't always
// repaint a card in the CSS-columns grid when a filled opacity animation is
// cancelled, so the card stayed invisible until something else repainted it
// -- a hover on desktop, which touch screens never get.
const HIDDEN_ATTR = "data-morph-hidden";

function hideCard(noteId: string) {
  const card = findNoteCard(noteId);
  if (!card) return;
  card.setAttribute(HIDDEN_ATTR, "");
  const fade = card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 70, fill: "forwards", id: HIDE_ID });
  fade.onfinish = () => {
    if (!card.hasAttribute(HIDDEN_ATTR)) return; // shown again meanwhile
    card.style.visibility = "hidden";
    fade.cancel();
  };
}

function showCard(noteId: string) {
  const card = findNoteCard(noteId);
  if (!card) return;
  card.removeAttribute(HIDDEN_ATTR);
  card.getAnimations().filter((a) => a.id === HIDE_ID).forEach((a) => a.cancel());
  card.style.visibility = "";
}
