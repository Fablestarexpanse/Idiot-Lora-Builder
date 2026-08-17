import { describe, it, expect } from "vitest";
import { isTypingTarget } from "@/hooks/useGlobalShortcuts";

function el(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

describe("isTypingTarget", () => {
  it("returns false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it("returns true for input, textarea, and select", () => {
    expect(isTypingTarget(el("input"))).toBe(true);
    expect(isTypingTarget(el("textarea"))).toBe(true);
    expect(isTypingTarget(el("select"))).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    const div = el("div");
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isTypingTarget(div)).toBe(true);
  });

  it("returns true for ARIA textboxes", () => {
    expect(isTypingTarget(el("div", { role: "textbox" }))).toBe(true);
  });

  it("returns false for plain elements, buttons, and body", () => {
    expect(isTypingTarget(el("div"))).toBe(false);
    expect(isTypingTarget(el("button"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });
});
