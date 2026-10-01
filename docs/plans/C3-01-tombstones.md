# C3-01 — Stop permanently deleted notes coming back from the cloud

**Status:** Implemented 2026-09-30, uncommitted; awaiting a two-device manual test (§6) · **Written:** 2026-09-30 · **Estimate:** ~2 days of code, plus testing across two devices

## 1. The problem in one paragraph

All three sync providers (Dropbox, Google Drive, OneDrive) merge by taking **every note from both sides**, with the newer copy winning when a note exists on both. Nothing records that a note was *permanently* deleted. So if device A hard-deletes a note (Bin → Delete Forever, or the 30-day auto-sweep) while device B still holds a copy, B's next sync puts it back in the cloud and A's next sync brings it back. `Index.tsx` currently blocks Delete Forever for 30 days after binning to shrink the window. That's a mitigation, not a fix.

## 2. The fix in one paragraph

When a note is hard-deleted, write a **tombstone**: `{ id, deletedAt }`, with no content. Tombstones sync inside the same (encrypted) cloud file as the notes. During a merge, a note with a matching tombstone is dropped, not restored, and is removed from any device that still holds it. Tombstones older than **180 days** are cleared out. A device that has been offline longer than that is caught by a second, safe rule (§4.4) that moves suspect notes to the **Bin**, never deleting them outright.

## 3. What I found in the code (and one correction to the review)

| Fact | Where | Consequence |
|---|---|---|
| The merge is copy-pasted three times, identical apart from log prefixes | `dropbox.ts:338-371`, `google-drive.ts:543-576`, `one-drive.ts:466-499` | Pull it into **one shared function** first. Then tombstone logic is written once. |
| The cloud file is plain JSON `{ notes, customTags, noteImages }`, encrypted as a whole when encryption is on | `uploadNotes` / `downloadNotes` in each provider | Tombstones go inside it and get the same encryption for free. |
| **Old app versions ignore JSON fields they don't know** | each `downloadNotes` reads only `notes` / `customTags` / `noteImages` | ✅ **Adding a `tombstones` field doesn't break old versions.** See below. |
| Every hard delete in the UI goes through one function | `Index.tsx:302` `persistDelete` (the auto-sweep `:493`, Delete Forever `:671`, and bulk delete `:1056` all call it via `deleteNote` at `:330`) | One place to record tombstones. MCP never hard-deletes (`use-mcp-bridge.ts:13`). |
| Soft delete bumps `updatedAt` | `Index.tsx:700`, `:1108` | A tombstone's `deletedAt` is always later than the note's last real edit. |
| "Last synced" is stored as `toLocaleString()` text | `cloud-sync-runner.ts:239` | Can't be compared reliably. We need a new numeric timestamp. |

**Correction: no staged rollout needed.** The review assumed tombstones must be rolled out in two releases, because old versions wouldn't understand them. In practice:

- An old version downloads the file, ignores `tombstones`, merges as it does today, and re-uploads **without** the field. So it can wipe the cloud copy of the tombstones.
- But every new-version device keeps its **own local copy** of the tombstones for 180 days and merges them back in on its next sync. That re-deletes the note and re-uploads the tombstones.

The worst case, then, is that an old-version device keeps behaving exactly as it does today until it updates. New devices converge on the right answer. **This can ship in one release.**

## 4. Design

### 4.1 Data

```ts
// src/types/note.ts
export interface Tombstone { id: string; deletedAt: number } // ms since epoch

// Cloud file, new optional fields (old readers ignore them):
{
  notes, customTags, noteImages,
  formatVersion: 2,
  tombstones: Tombstone[],
  tombstonesPrunedBefore?: number, // tombstones older than this may have been cleared
}
```

**Local store:** `localStorage["open-keep-tombstones"]`, a JSON map `id → deletedAt`, following the `custom-tags` precedent. It holds note IDs (random UUIDs) and times only, never titles or content. If the OS clears it, we lose nothing beyond falling back to today's behaviour.

### 4.2 Recording

A new `src/lib/tombstones.ts` provides `recordTombstone(id)`, `readTombstones()`, `mergeTombstones(a, b)` (keeping the later `deletedAt` per id), `pruneTombstones(now)` and `clearTombstones()`.

- `persistDelete` in `Index.tsx` calls `recordTombstone(id)` **before** the local delete.
- `clearAllData()` and the "Reset & Delete All" paths (`LockScreen.tsx:198`, `ChangePinDialog.tsx:101`) call `clearTombstones()`, alongside the existing `*-last-synced` removals.

### 4.3 Merge rules — `src/lib/sync-merge.ts` (new, pure, no I/O)

```ts
mergeSyncData({
  local:  { notes, customTags, tombstones },
  remote: { notes, customTags, tombstones, tombstonesPrunedBefore },
  lastSyncStartedAt,  // this device + this provider; null if never / pre-upgrade
  now,
}) => { notes, customTags, tombstones, tombstonesPrunedBefore, removeIds, binIds }
```

1. **Tombstones:** union of local and remote, keeping the latest `deletedAt` per id.
2. **Notes:** exactly today's rule (union, newer `updatedAt` wins, ties keep local), then:
3. **Drop tombstoned notes:** if a note has a tombstone and `note.updatedAt <= tombstone.deletedAt`, drop it and add its id to `removeIds`.
   - If the note was edited *after* the delete (e.g. restored from the Bin on another device), **the note wins** and the tombstone is discarded. The user's latest action wins.
4. **Stale-device rule** — see §4.4.
5. **Prune:** drop tombstones with `deletedAt < now − 180 days`. If any were dropped, set `tombstonesPrunedBefore = now − 180 days`.
6. **Custom tags:** unchanged (a union). Out of scope, see §8.

The three providers' `syncNotes` shrink to "download → `mergeSyncData` → upload → return".

### 4.4 Stale-device rule (the offline-tablet case)

After a successful sync, a device's notes and the cloud match, because every sync uploads the full merged set. So on the next sync, a local note that is:

- **missing from the cloud**, and
- **not tombstoned**, and
- **not edited since this device's last sync started** (`note.updatedAt <= lastSyncStartedAt`)

must have been removed from the cloud by someone else.

We apply this rule **only when `lastSyncStartedAt < tombstonesPrunedBefore`**, i.e. when this device may have missed tombstones that were cleared out. Even then, we **move the note to the Bin** (`isDeleted: true, deletedAt: now`) instead of deleting it. That way a mistake (such as an old-version device that overwrote the cloud) is recoverable for 30 days. Notes edited while offline are kept and uploaded as normal.

⚠️ `lastSyncStartedAt` must be taken **before** `loadNotes()` at the start of the sync, not at the end. A note created during an in-flight sync would otherwise look "unchanged since last sync" and wrongly match the rule next time.

### 4.5 Runner changes — `cloud-sync-runner.ts`

- Capture `syncStartedAt = Date.now()` before `loadNotes()`.
- Pass the local tombstones and `lastSyncStartedAt` (new key `<provider>-last-sync-started-ms`) into `adapter.syncNotes`.
- Write-back, extending the existing "skip if local is newer" guard at `:218-231`:
  - For each id in `removeIds`: re-read the current local note. If it was edited after the tombstone, skip it. Otherwise delete its images (`deleteImage`) and the note.
  - For each id in `binIds`: the note is already returned binned in `notes`, so the normal save path handles it.
- Save the merged tombstones locally. On success, store `syncStartedAt` under the new key.
- **Force-resolution paths:**
  - "Keep this device": upload local notes **and local tombstones**.
  - "Keep cloud": import the cloud tombstones locally.
  - "Merge": the normal rules.

### 4.6 Keep the 30-day Delete-Forever gate for now

`BIN_RETENTION_MS` stays as-is for this release, because it still protects users who have an old-version device. Once Sentry shows almost nobody on pre-tombstone builds, it can be relaxed to allow immediate Delete Forever. Its comment in `Index.tsx:45-50` should be updated to say that.

## 5. Implementation order

Each step leaves the app working and can be committed separately.

1. **Extract** the three merge blocks into `mergeSyncData()`, with **no behaviour change**. Confirm sync still works on one provider.
2. **Add** `tombstones.ts` and record tombstones in `persistDelete`, plus the clear-on-reset calls.
3. **Merge rules** (§4.3, steps 1–3) and the cloud file fields. Runner changes: removals, saving tombstones, force paths.
4. **Timestamp** `*-last-sync-started-ms`, plus clearing it wherever the `*-last-synced` keys are cleared.
5. **Stale-device rule** (§4.4) and pruning (§4.3 step 5).
6. **Tests** (§6), then update the `BIN_RETENTION_MS` comment, `CLAUDE.md`'s sync section, and the review note.

## 6. Testing

**Automated.** `mergeSyncData` is a pure function, so it can be tested without a cloud account. The app has no test runner yet. I'd add **Vitest** as a dev dependency with one test file (it fits the existing Vite setup and adds nothing to the shipped app). The cases:

| # | Scenario | Expected |
|---|---|---|
| 1 | A hard-deletes a note; B still has it; B syncs, then A | The note is gone on both, and the tombstone is in the cloud |
| 2 | Same, but B restored it from the Bin after A's delete | The note survives on both; the tombstone is discarded |
| 3 | Old-version device re-uploads without `tombstones` | The next new-version sync re-deletes the note and restores the tombstones |
| 4 | Tombstone is 181 days old | Pruned; `tombstonesPrunedBefore` is set |
| 5 | Device last synced before `tombstonesPrunedBefore`, holds an unedited note missing from the cloud | The note goes to the **Bin**, not deleted |
| 6 | Same, but the note was edited while offline | The note is kept and uploaded |
| 7 | Device never synced (`lastSyncStartedAt` null) | The stale rule doesn't apply; everything uploads |
| 8 | "Keep this device" / "Keep cloud" | Tombstones follow the side that was chosen |
| 9 | Cloud file from 5.1.0 (no new fields) | Merges exactly as today |

**Manual (two devices, one provider — web plus Android is enough):** repeat scenarios 1, 2 and 3. For scenario 3, keep a 5.1.0 install as the "old" device. Also check that a note created *during* a sync isn't binned on the following sync (§4.4 warning).

## 7. Risks

| Risk | Mitigation |
|---|---|
| The stale rule bins notes that weren't really deleted | Only applies after a clear-out the device missed; bins rather than deletes; notes edited while offline are exempt |
| Device clocks disagree | The tombstone comparison is against the deleting device's clock; a small skew only matters for a note edited within seconds of a delete. The stale rule compares against the device's own clock only |
| Old-version devices keep resurrecting notes | Same as today, until they update; new devices undo it on their next sync (§3) |
| The OS clears the local tombstone store | Falls back to the tombstones in the cloud; worst case is today's behaviour |

## 8. Out of scope (noted for later)

- ~~**Deleted custom tags come back the same way.**~~ ✅ Done 2026-09-30 as **C1-19**. Labels have no timestamps, so a delete-only tombstone can't tell "deleted" from "deleted, then re-created". The file carries `tagChanges`, the latest `{ name, deleted, at }` per label, and the newest change wins (a delete on an exact tie). A rename records a delete of the old name and a create of the new one. There's no stale-device rule for labels; the stakes are too low.
- **Relaxing the 30-day Delete-Forever gate** (§4.6). That comes in a later release.

## 9. Decisions (agreed 2026-09-30: yes to all four)

1. **Clear tombstones after 180 days?** Each is about 70 bytes, so even years of deletions stay small. Longer is safer. *(Recommend 180.)*
2. **Edit-after-delete: should the note win?** (§4.3 rule 3.) *(Recommend yes — the user's latest action wins.)*
3. **Stale-device rule: Bin, not delete?** *(Recommend Bin.)*
4. **Add Vitest for the merge tests?** *(Recommend yes. It's dev-only and doesn't touch the shipped app.)*
