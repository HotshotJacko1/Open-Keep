// Copyright (c) 2026. Licensed under AGPLv3.
import { describe, it, expect } from "vitest";
import { getTextDirection } from "@/utils/text-direction";

describe("getTextDirection", () => {
  it("reads Persian, Arabic and Hebrew as right to left", () => {
    expect(getTextDirection("نان و شیر بخرید")).toBe("rtl");
    expect(getTextDirection("مرحبا")).toBe("rtl");
    expect(getTextDirection("שלום")).toBe("rtl");
  });

  it("reads Latin, Cyrillic and CJK as left to right", () => {
    expect(getTextDirection("Buy milk")).toBe("ltr");
    expect(getTextDirection("Купить молоко")).toBe("ltr");
    expect(getTextDirection("牛乳を買う")).toBe("ltr");
  });

  it("goes by the first letter, skipping digits and punctuation", () => {
    expect(getTextDirection("2 لیتر شیر")).toBe("rtl");
    expect(getTextDirection("۵ - خرید Milk")).toBe("rtl");
    expect(getTextDirection("(Milk) شیر")).toBe("ltr");
  });

  it("treats text with no letters as left to right", () => {
    expect(getTextDirection("")).toBe("ltr");
    expect(getTextDirection("123 - 456")).toBe("ltr");
    expect(getTextDirection("۱۲۳")).toBe("ltr");
  });
});
