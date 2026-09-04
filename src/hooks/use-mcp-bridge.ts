// Copyright (c) 2026. Licensed under AGPLv3.
//
// React side of the Open Keep MCP bridge (see the "Open Keep MCP Bridge"
// PRD). Owns the pairing token / read+write consent switches, the
// WebSocket connection to the local MCP server, and the translation from
// each of the 15 bridge ops into calls against the app's *existing* note
// functions -- this file intentionally holds no storage logic of its own.
//
// Safety design this implements (see the PRD's "Safety design for write &
// delete" section):
//  - every mutating op enforces note-limits.ts via the normal saveNote()
//    path (no skipLimits) and reports back if content was trimmed
//  - delete_note only ever soft-deletes (isDeleted/deletedAt), the exact
//    path a manual delete takes -- it never calls the storage layer's
//    permanent deleteNote()
//  - every mutating op snapshots the note(s) it's about to change and adds
//    a one-click Undo to both a toast and the in-session "AI Activity" log
//  - agent-created/edited notes are tagged ai-created / ai-edited
//  - checklist notes are read-only from the bridge in v1 -- their content
//    is markdown-shaped list syntax, not HTML, and blindly editing it here
//    would corrupt it the same way the app already guards against elsewhere
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Note } from "@/types/note";
import { looksLikeHtml, plainTextToHtml } from "@/utils/note-markdown-format";
import { showSuccess } from "@/utils/toast";
import { safeRandomUUID } from "@/lib/utils";
import { McpBridgeClient, ConnectionState } from "@/lib/mcp-bridge/bridge-client";
import { BridgeOp, BridgeRequest, BridgeResponse, NoteFull, NoteSummary, TagInfo } from "@/lib/mcp-bridge/protocol";

// Base of the port range. Each MCP client runs its own copy of the server
// and takes the first free port from here, so the app connects across the
// range rather than to one fixed port.
const BASE_PORT = 8420;
const MAX_ACTIVITY = 25;
const AI_CREATED_TAG = "ai-created";
const AI_EDITED_TAG = "ai-edited";

const READ_OPS = new Set<BridgeOp>([
  "list_all_notes", "search_notes", "get_note", "list_tags", "get_notes_by_tag", "get_tag_by_id",
]);

/**
 * The browser owns the pairing token, not the server. That's what makes a
 * one-click .mcpb install possible: the user can read a token here without
 * having run anything locally first, then paste it into Claude Desktop's
 * install prompt. Format matches the server's randomBytes(24).toString("base64url").
 */
function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const STORAGE_KEYS = {
  token: "ai-bridge-token",
  readEnabled: "ai-bridge-read-enabled",
  writeEnabled: "ai-bridge-write-enabled",
};

export interface AiActivityEntry {
  id: string;
  timestamp: number;
  label: string;
  undo: () => Promise<void>;
}

export interface McpBridgeHandlers {
  notes: Note[];
  /** Must return whether note-limits.ts trimmed the content (see Index.tsx's handleSaveNote). */
  handleSaveNote: (note: Note) => Promise<boolean>;
  handleRenameTag: (oldTag: string, newTag: string) => Promise<void>;
  handleDeleteTag: (tag: string) => Promise<void>;
}

export interface McpBridgeState {
  connectionState: ConnectionState;
  /** How many MCP server instances are currently paired. */
  connectedCount: number;
  readEnabled: boolean;
  writeEnabled: boolean;
  setReadEnabled: (enabled: boolean) => void;
  setWriteEnabled: (enabled: boolean) => void;
  token: string;
  regenerateToken: () => void;
  activity: AiActivityEntry[];
  undoActivity: (id: string) => Promise<void>;
  disconnectAccess: () => void;
}

function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    isPinned: note.isPinned,
    isArchived: note.isArchived,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function toFull(note: Note): NoteFull {
  return { ...toSummary(note), content: note.content, type: note.type || "text" };
}

function stripHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  return new DOMParser().parseFromString(html, "text/html").body.textContent || "";
}

function toHtmlIfPlain(text: string): string {
  return looksLikeHtml(text) ? text : plainTextToHtml(text);
}

function withTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags : [...tags, tag];
}

/** True for a note that shouldn't be handed to a mutating tool. */
function isEditableByAgent(note: Note | undefined): note is Note {
  return !!note && !note.isDeleted && note.type !== "list";
}

export function useMcpBridge({ notes, handleSaveNote, handleRenameTag, handleDeleteTag }: McpBridgeHandlers): McpBridgeState {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [connectedCount, setConnectedCount] = useState(0);
  const [readEnabled, setReadEnabledState] = useState(() => localStorage.getItem(STORAGE_KEYS.readEnabled) === "true");
  const [writeEnabled, setWriteEnabledState] = useState(() => localStorage.getItem(STORAGE_KEYS.writeEnabled) === "true");
  const [token, setTokenState] = useState(() => localStorage.getItem(STORAGE_KEYS.token) || "");
  const [activity, setActivity] = useState<AiActivityEntry[]>([]);

  // Mint a token on first use so the Settings dialog always has one to show,
  // even before anything has been installed locally. Kept out of the useState
  // initialiser so the initialiser stays pure under StrictMode's double-invoke.
  useEffect(() => {
    if (token) return;
    const fresh = generateToken();
    localStorage.setItem(STORAGE_KEYS.token, fresh);
    setTokenState(fresh);
  }, [token]);

  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  const handleSaveNoteRef = useRef(handleSaveNote);
  const handleRenameTagRef = useRef(handleRenameTag);
  const handleDeleteTagRef = useRef(handleDeleteTag);
  useEffect(() => {
    handleSaveNoteRef.current = handleSaveNote;
    handleRenameTagRef.current = handleRenameTag;
    handleDeleteTagRef.current = handleDeleteTag;
  }, [handleSaveNote, handleRenameTag, handleDeleteTag]);

  const recordActivity = useCallback((label: string, undo: () => Promise<void>) => {
    const entry: AiActivityEntry = { id: safeRandomUUID(), timestamp: Date.now(), label, undo };
    setActivity((prev) => [entry, ...prev].slice(0, MAX_ACTIVITY));

    showSuccess(label, {
      action: {
        label: "Undo",
        onClick: async () => {
          await undo();
          setActivity((prev) => prev.filter((e) => e.id !== entry.id));
          showSuccess("Undone");
        },
      },
      duration: 10000,
    });
  }, []);

  const undoActivity = useCallback(async (id: string) => {
    const entry = activity.find((e) => e.id === id);
    if (!entry) return;
    await entry.undo();
    setActivity((prev) => prev.filter((e) => e.id !== id));
    showSuccess("Undone");
  }, [activity]);

  // --- The 15 ops -------------------------------------------------------
  const runOp = useCallback(async (op: BridgeOp, params: Record<string, unknown>): Promise<unknown> => {
    const currentNotes = notesRef.current;
    const saveNote = handleSaveNoteRef.current;

    const findNote = (id: unknown): Note | undefined => {
      if (typeof id !== "string") return undefined;
      return currentNotes.find((n) => n.id === id);
    };

    switch (op) {
      case "list_all_notes":
        return currentNotes.filter((n) => !n.isDeleted).map(toSummary);

      case "search_notes": {
        const query = String(params.query ?? "").toLowerCase();
        if (!query) throw { code: "INVALID_PARAMS", message: "query is required." };
        return currentNotes
          .filter((n) => !n.isDeleted)
          .filter((n) => n.title.toLowerCase().includes(query) || stripHtml(n.content).toLowerCase().includes(query))
          .map(toSummary);
      }

      case "get_note": {
        const note = findNote(params.id);
        if (!note || note.isDeleted) throw { code: "NOT_FOUND", message: "No note with that id." };
        return toFull(note);
      }

      case "list_tags": {
        const counts = new Map<string, number>();
        for (const n of currentNotes) {
          if (n.isDeleted) continue;
          for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
        }
        const tags: TagInfo[] = Array.from(counts, ([name, noteCount]) => ({ name, noteCount }));
        return tags;
      }

      case "get_notes_by_tag": {
        const tag = String(params.tag ?? "");
        if (!tag) throw { code: "INVALID_PARAMS", message: "tag is required." };
        return currentNotes.filter((n) => !n.isDeleted && n.tags.includes(tag)).map(toSummary);
      }

      case "get_tag_by_id": {
        // Open Keep tags are plain strings, not entities with their own ids
        // -- the tag name doubles as its id here.
        const id = String(params.id ?? "");
        if (!id) throw { code: "INVALID_PARAMS", message: "id is required." };
        const noteCount = currentNotes.filter((n) => !n.isDeleted && n.tags.includes(id)).length;
        const tagInfo: TagInfo = { name: id, noteCount };
        return tagInfo;
      }

      case "create_note": {
        const title = String(params.title ?? "").trim();
        if (!title) throw { code: "INVALID_PARAMS", message: "title is required." };
        const extraTags = Array.isArray(params.tags) ? (params.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
        const now = Date.now();
        const newNote: Note = {
          id: safeRandomUUID(),
          title,
          content: params.content ? toHtmlIfPlain(String(params.content)) : "",
          type: "text",
          tags: Array.from(new Set([AI_CREATED_TAG, ...extraTags])),
          isPinned: false,
          isArchived: false,
          createdAt: now,
          updatedAt: now,
        };
        const trimmed = await saveNote(newNote);
        recordActivity(`Claude created "${title}"`, async () => {
          // Undoing a create moves it to the bin, same as any other
          // delete -- recoverable, never a silent hard-remove.
          await saveNote({ ...newNote, isDeleted: true, deletedAt: Date.now() });
        });
        return { note: toFull(newNote), trimmed };
      }

      case "update_note": {
        const note = findNote(params.id);
        if (!isEditableByAgent(note)) {
          throw note?.type === "list"
            ? { code: "INVALID_PARAMS", message: "This is a checklist note -- editing checklists via AI isn't supported yet." }
            : { code: "NOT_FOUND", message: "No note with that id." };
        }
        if (params.title === undefined && params.content === undefined) {
          throw { code: "INVALID_PARAMS", message: "Provide a title and/or content to update." };
        }
        const before = { ...note };
        const updated: Note = {
          ...note,
          title: params.title !== undefined ? String(params.title) : note.title,
          content: params.content !== undefined ? toHtmlIfPlain(String(params.content)) : note.content,
          tags: withTag(note.tags, AI_EDITED_TAG),
          updatedAt: Date.now(),
        };
        const trimmed = await saveNote(updated);
        recordActivity(`Claude edited "${updated.title}"`, async () => { await saveNote(before); });
        return { note: toFull(updated), trimmed };
      }

      case "append_to_note":
      case "prepend_to_note": {
        const note = findNote(params.id);
        if (!isEditableByAgent(note)) {
          throw note?.type === "list"
            ? { code: "INVALID_PARAMS", message: "This is a checklist note -- editing checklists via AI isn't supported yet." }
            : { code: "NOT_FOUND", message: "No note with that id." };
        }
        const text = String(params.text ?? "");
        if (!text) throw { code: "INVALID_PARAMS", message: "text is required." };
        const fragment = toHtmlIfPlain(text);
        const before = { ...note };
        const newContent = op === "append_to_note" ? note.content + fragment : fragment + note.content;
        const updated: Note = { ...note, content: newContent, tags: withTag(note.tags, AI_EDITED_TAG), updatedAt: Date.now() };
        const trimmed = await saveNote(updated);
        recordActivity(`Claude ${op === "append_to_note" ? "added to" : "added to the start of"} "${updated.title}"`, async () => { await saveNote(before); });
        return { note: toFull(updated), trimmed };
      }

      case "delete_note": {
        const note = findNote(params.id);
        if (!note || note.isDeleted) throw { code: "NOT_FOUND", message: "No note with that id." };
        const before = { ...note };
        // Soft delete only -- the same isDeleted/deletedAt path the app's
        // own delete button takes. This never calls the storage layer's
        // permanent deleteNote(); it's recoverable from the bin for 30
        // days regardless of whether Undo below gets used.
        const updated: Note = {
          ...note,
          isDeleted: true,
          deletedAt: Date.now(),
          isPinned: false,
          updatedAt: Math.max(Date.now(), note.updatedAt + 1),
        };
        await saveNote(updated);
        recordActivity(`Claude deleted "${note.title}"`, async () => { await saveNote(before); });
        return { id: note.id, deleted: true };
      }

      case "add_tags_to_note":
      case "remove_tags_from_note": {
        const note = findNote(params.id);
        if (!note || note.isDeleted) throw { code: "NOT_FOUND", message: "No note with that id." };
        const tagsParam = Array.isArray(params.tags) ? (params.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
        if (tagsParam.length === 0) throw { code: "INVALID_PARAMS", message: "tags must be a non-empty array." };
        const before = { ...note };
        const newTags = op === "add_tags_to_note"
          ? Array.from(new Set([...note.tags, ...tagsParam]))
          : note.tags.filter((t) => !tagsParam.includes(t));
        const updated: Note = { ...note, tags: newTags, updatedAt: Date.now() };
        await saveNote(updated);
        recordActivity(`Claude ${op === "add_tags_to_note" ? "tagged" : "untagged"} "${updated.title}"`, async () => { await saveNote(before); });
        return toFull(updated);
      }

      case "rename_tag": {
        const from = String(params.from ?? "");
        const to = String(params.to ?? "");
        if (!from || !to) throw { code: "INVALID_PARAMS", message: "from and to are required." };
        const affected = currentNotes.filter((n) => n.tags.includes(from)).map((n) => ({ ...n }));
        await handleRenameTagRef.current(from, to);
        recordActivity(`Claude renamed tag "${from}" to "${to}" on ${affected.length} note${affected.length === 1 ? "" : "s"}`, async () => {
          await Promise.all(affected.map((n) => saveNote(n)));
        });
        return { from, to, affectedCount: affected.length };
      }

      case "delete_tag": {
        const tag = String(params.tag ?? "");
        if (!tag) throw { code: "INVALID_PARAMS", message: "tag is required." };
        const affected = currentNotes.filter((n) => n.tags.includes(tag)).map((n) => ({ ...n }));
        await handleDeleteTagRef.current(tag);
        recordActivity(`Claude removed tag "${tag}" from ${affected.length} note${affected.length === 1 ? "" : "s"}`, async () => {
          await Promise.all(affected.map((n) => saveNote(n)));
        });
        return { tag, affectedCount: affected.length };
      }

      default:
        throw { code: "INVALID_PARAMS", message: `Unknown operation: ${op}` };
    }
  }, [recordActivity]);

  // --- Wiring the client --------------------------------------------------
  const clientRef = useRef<McpBridgeClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new McpBridgeClient((state, count) => {
      setConnectionState(state);
      setConnectedCount(count);
    });
  }

  const readEnabledRef = useRef(readEnabled);
  const writeEnabledRef = useRef(writeEnabled);
  useEffect(() => { readEnabledRef.current = readEnabled; }, [readEnabled]);
  useEffect(() => { writeEnabledRef.current = writeEnabled; }, [writeEnabled]);

  const handleRequest = useCallback(async (request: BridgeRequest): Promise<BridgeResponse> => {
    const gate = READ_OPS.has(request.op) ? readEnabledRef.current : writeEnabledRef.current;
    if (!gate) {
      return {
        type: "response",
        id: request.id,
        ok: false,
        error: {
          code: "INVALID_PARAMS",
          message: READ_OPS.has(request.op)
            ? "Reading notes is turned off in Open Keep > Settings > AI Assistant Access."
            : "Creating/editing/deleting notes is turned off in Open Keep > Settings > AI Assistant Access.",
        },
      };
    }
    try {
      const data = await runOp(request.op, request.params);
      return { type: "response", id: request.id, ok: true, data };
    } catch (err: any) {
      return {
        type: "response",
        id: request.id,
        ok: false,
        error: { code: err?.code || "INTERNAL", message: err?.message || "Something went wrong." },
      };
    }
  }, [runOp]);

  useEffect(() => {
    // Native builds have no local MCP server to reach, so don't sit there
    // retrying five ports forever if a stale flag is set.
    const shouldConnect =
      (readEnabled || writeEnabled) && token.length > 0 && !Capacitor.isNativePlatform();
    if (shouldConnect) {
      clientRef.current!.connect(token, BASE_PORT, handleRequest);
    } else {
      clientRef.current!.disconnect();
    }
    // Reconnect whenever the token changes too, so pasting a new one takes effect immediately.
  }, [readEnabled, writeEnabled, token, handleRequest]);

  const setReadEnabled = useCallback((enabled: boolean) => {
    localStorage.setItem(STORAGE_KEYS.readEnabled, String(enabled));
    setReadEnabledState(enabled);
  }, []);

  const setWriteEnabled = useCallback((enabled: boolean) => {
    localStorage.setItem(STORAGE_KEYS.writeEnabled, String(enabled));
    setWriteEnabledState(enabled);
  }, []);

  const regenerateToken = useCallback(() => {
    const fresh = generateToken();
    localStorage.setItem(STORAGE_KEYS.token, fresh);
    setTokenState(fresh);
    showSuccess("New pairing token generated - update it in your AI tool");
  }, []);

  const disconnectAccess = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.setItem(STORAGE_KEYS.readEnabled, "false");
    localStorage.setItem(STORAGE_KEYS.writeEnabled, "false");
    setTokenState("");
    setReadEnabledState(false);
    setWriteEnabledState(false);
    setActivity([]);
    clientRef.current?.disconnect();
    showSuccess("AI access disconnected");
  }, []);

  return { connectionState, connectedCount, readEnabled, writeEnabled, setReadEnabled, setWriteEnabled, token, regenerateToken, activity, undoActivity, disconnectAccess };
}
