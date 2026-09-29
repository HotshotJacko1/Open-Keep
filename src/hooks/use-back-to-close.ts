// Copyright (c) 2026. Licensed under AGPLv3.
import { useEffect, useRef } from "react";

// Android's back gesture/button (and the browser's back button) pops history
// rather than firing Escape, so every open dialog pushes one history entry and
// closes when that entry is popped.
//
// The entries live on one shared stack instead of each dialog managing its own:
// a back press closes only the dialogs above the entry it lands on, and a dialog
// closed by the app (Save, X, a parent closing) unwinds its entry -- plus any
// open children's -- with a single history.go(). When every dialog called
// history.back() for itself, a parent and child closing together popped twice.

type Entry = {
    /** Which dialog this is, so a remount of the same dialog can take its entry back. */
    key: string;
    /** Open order, to tell a closing dialog's children from dialogs opened after it closed. */
    seq?: number;
    close: () => void;
    /** Return true when the back press was consumed (e.g. an inner panel closed). */
    intercept?: () => boolean;
    /** Closed by the app; its history entry is unwound in the next flush. */
    releasing?: boolean;
};

const stack: Entry[] = [];
// Entries from an earlier page load (reload, OAuth return) must not count as ours.
const SESSION = Math.random().toString(36).slice(2);
let listening = false;
let flushScheduled = false;
let seq = 0;
let flushSeq = 0; // `seq` when the pending flush was scheduled

// history.go() is async, and a second go() issued before the first lands can be
// merged into it by the browser, so never count traversals. Instead, while one
// is in flight, hold off; when it lands, compare the real depth with the stack
// and correct whichever way is needed (reconcile).
let traversing = false;
let traversalTimer: ReturnType<typeof setTimeout> | undefined;

type DialogHistoryState = { dialogDepth?: number; dialogSession?: string } | null;

const depthOf = (state: unknown): number => {
    const s = state as DialogHistoryState;
    return s?.dialogSession === SESSION ? s.dialogDepth ?? 0 : 0;
};

const pushEntry = (depth: number) => {
    window.history.pushState({ dialogDepth: depth, dialogSession: SESSION }, "");
};

/** Make the history depth match the stack: go back over extra entries, or push missing ones. */
const reconcile = () => {
    const depth = depthOf(window.history.state);
    if (depth > stack.length) {
        traversing = true;
        clearTimeout(traversalTimer);
        // Safety net in case the popstate never arrives (merged or cancelled traversal).
        traversalTimer = setTimeout(() => {
            traversing = false;
            reconcile();
        }, 1000);
        window.history.go(stack.length - depth);
        return;
    }
    for (let d = depth + 1; d <= stack.length; d++) pushEntry(d);
};

const handlePopState = (event: PopStateEvent) => {
    if (traversing) {
        // Our own go() landed (or the user pressed back meanwhile; either way, re-sync).
        traversing = false;
        clearTimeout(traversalTimer);
        reconcile();
        return;
    }
    const depth = depthOf(event.state);
    while (stack.length > depth) {
        const top = stack[stack.length - 1];
        if (top.intercept?.()) break; // still open: reconcile restores its entry
        stack.pop();
        top.close();
    }
    reconcile();
};

const flushReleases = () => {
    flushScheduled = false;
    const index = stack.findIndex((e) => e.releasing);
    if (index === -1) return;
    const removed = stack.splice(index);
    const survivors = removed.filter((e) => !e.releasing);
    // Children still open above a closing dialog close with it. Dialogs opened
    // after the close was scheduled aren't its children: they stay, lower down.
    survivors.filter((e) => (e.seq ?? 0) <= flushSeq).reverse().forEach((child) => child.close());
    stack.push(...survivors.filter((e) => (e.seq ?? 0) > flushSeq));
    if (!traversing) reconcile();
};

const open = (entry: Entry) => {
    if (!listening) {
        window.addEventListener("popstate", handlePopState);
        listening = true;
    }
    entry.seq = ++seq;
    // The same dialog closed in this same commit (it remounted while open, or
    // StrictMode's double effect) takes its history entry back instead of
    // popping it and pushing a new one.
    const previous = stack.findIndex((e) => e.releasing && e.key === entry.key);
    if (previous !== -1) {
        stack[previous] = entry;
        return;
    }
    stack.push(entry);
    if (!traversing) pushEntry(stack.length);
};

const release = (entry: Entry) => {
    if (!stack.includes(entry)) return; // already popped by a back press
    entry.releasing = true;
    // Deferred to a microtask so a remount in the same commit can adopt the entry.
    if (!flushScheduled) {
        flushScheduled = true;
        flushSeq = seq;
        queueMicrotask(flushReleases);
    }
};

/**
 * Closes a dialog on back press while `isOpen`. `key` names the dialog (unique per
 * dialog type). `onBack`, if given, runs first and can return true to keep the
 * dialog open (e.g. it closed a sub-panel instead).
 */
export const useBackToClose = (
    key: string,
    isOpen: boolean,
    onClose: () => void,
    onBack?: () => boolean,
) => {
    const onCloseRef = useRef(onClose);
    const onBackRef = useRef(onBack);
    useEffect(() => {
        onCloseRef.current = onClose;
        onBackRef.current = onBack;
    });

    useEffect(() => {
        if (!isOpen) return;
        const entry: Entry = {
            key,
            close: () => onCloseRef.current(),
            intercept: () => onBackRef.current?.() ?? false,
        };
        open(entry);
        return () => release(entry);
    }, [isOpen, key]);
};
