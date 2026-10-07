// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect } from "vitest";
import {
  CHECKLIST_INDENT,
  ChecklistItem,
  outdentChecklistItem,
  parseChecklist,
  serializeChecklist,
} from "@/utils/markdown";

const top = (id: string, checked = false): ChecklistItem => ({ id, content: id, checked, indentation: "" });
const sub = (id: string, checked = false): ChecklistItem => ({ id, content: id, checked, indentation: CHECKLIST_INDENT });
const shape = (items: ChecklistItem[]) => items.map(i => (i.indentation === "" ? i.id : `-${i.id}`));

describe("outdentChecklistItem", () => {
  it("moves a middle sub-item out, so the sub-items below it keep their parent (C2-31)", () => {
    const items = [top("A"), sub("b"), sub("c"), sub("d"), top("E")];
    expect(shape(outdentChecklistItem(items, "c"))).toEqual(["A", "-b", "-d", "c", "E"]);
  });

  it("outdents the last sub-item of a group in place", () => {
    const items = [top("A"), sub("b"), sub("c"), top("E")];
    expect(shape(outdentChecklistItem(items, "c"))).toEqual(["A", "-b", "c", "E"]);
  });

  it("outdents in place at the end of the list", () => {
    const items = [top("A"), sub("b"), sub("c")];
    expect(shape(outdentChecklistItem(items, "c"))).toEqual(["A", "-b", "c"]);
  });

  it("works on stored order when the sub-item is ticked and its parent isn't", () => {
    const items = [top("A"), sub("b", true), sub("c"), top("E")];
    const result = outdentChecklistItem(items, "b");
    expect(shape(result)).toEqual(["A", "-c", "b", "E"]);
    expect(result.find(i => i.id === "b")!.checked).toBe(true);
  });

  it("doesn't let an orphan sub-item adopt the orphans below it", () => {
    const items = [sub("x"), sub("y"), top("A")];
    expect(shape(outdentChecklistItem(items, "x"))).toEqual(["-y", "x", "A"]);
  });

  it("leaves top-level items and unknown ids alone", () => {
    const items = [top("A"), sub("b")];
    expect(outdentChecklistItem(items, "A")).toBe(items);
    expect(outdentChecklistItem(items, "nope")).toBe(items);
  });

  it("keeps the item's trailing lines with it", () => {
    const { items } = parseChecklist("- [ ] A\n    - [ ] b\n    - [ ] c\nnote under c\n    - [ ] d");
    const c = items[2];
    expect(serializeChecklist(outdentChecklistItem(items, c.id))).toBe(
      "- [ ] A\n    - [ ] b\n    - [ ] d\n- [ ] c\nnote under c",
    );
  });
});
