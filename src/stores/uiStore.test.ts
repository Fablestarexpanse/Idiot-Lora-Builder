import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "@/stores/uiStore";

beforeEach(() => {
  useUiStore.setState({ toasts: [], isHelpOpen: false });
});

describe("uiStore toasts", () => {
  it("showToast defaults to error type (backward compat with existing call sites)", () => {
    useUiStore.getState().showToast("boom");
    const { toasts } = useUiStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("boom");
    expect(toasts[0].type).toBe("error");
  });

  it("supports success and info types", () => {
    useUiStore.getState().showToast("done", "success");
    useUiStore.getState().showToast("fyi", "info");
    const { toasts } = useUiStore.getState();
    expect(toasts.map((t) => t.type)).toEqual(["success", "info"]);
  });

  it("queues toasts in order with unique ids", () => {
    useUiStore.getState().showToast("one", "info");
    useUiStore.getState().showToast("two", "info");
    const { toasts } = useUiStore.getState();
    expect(toasts.map((t) => t.message)).toEqual(["one", "two"]);
    expect(toasts[0].id).not.toBe(toasts[1].id);
  });

  it("caps the queue at 3, dropping the oldest", () => {
    for (const msg of ["a", "b", "c", "d"]) {
      useUiStore.getState().showToast(msg, "info");
    }
    const { toasts } = useUiStore.getState();
    expect(toasts).toHaveLength(3);
    expect(toasts.map((t) => t.message)).toEqual(["b", "c", "d"]);
  });

  it("dismissToast removes only the matching toast", () => {
    useUiStore.getState().showToast("keep", "info");
    useUiStore.getState().showToast("drop", "info");
    const dropId = useUiStore.getState().toasts[1].id;
    useUiStore.getState().dismissToast(dropId);
    const { toasts } = useUiStore.getState();
    expect(toasts.map((t) => t.message)).toEqual(["keep"]);
  });
});

describe("uiStore help modal", () => {
  it("openHelp / closeHelp toggle isHelpOpen", () => {
    expect(useUiStore.getState().isHelpOpen).toBe(false);
    useUiStore.getState().openHelp();
    expect(useUiStore.getState().isHelpOpen).toBe(true);
    useUiStore.getState().closeHelp();
    expect(useUiStore.getState().isHelpOpen).toBe(false);
  });
});
