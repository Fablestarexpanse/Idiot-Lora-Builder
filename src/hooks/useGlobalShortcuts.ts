import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUiStore } from "@/stores/uiStore";
import { handleRatingShortcut } from "./useRatingShortcuts";

/**
 * True when keyboard input should go to the focused element instead of
 * app-global shortcuts: text inputs, textareas, selects, contenteditable
 * regions, and ARIA textboxes. Shared guard — import this instead of
 * re-implementing the activeElement check in components.
 */
export function isTypingTarget(el: Element | null): boolean {
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable === true) return true;
  return el.getAttribute("role") === "textbox";
}

/**
 * Single window keydown listener owning app-global keys. Mounted once in App.
 * Registered in the capture phase so ratings always win over other handlers
 * (grid, modals, etc.).
 *
 * Owns:
 * - `?` (Shift+/) — open the Help / keyboard-shortcuts modal
 * - `1` / `2` / `3` — rate Good / Bad / Needs Edit (delegated to
 *   `handleRatingShortcut`)
 *
 * Deliberately component-local (using the shared `isTypingTarget` guard):
 * grid arrow-nav / Ctrl+A / Escape in ImageGrid, T / Ctrl+Z / Ctrl+Y in
 * TagEditor.
 */
export function useGlobalShortcuts(): void {
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (isTypingTarget(document.activeElement)) return;

      // "?" opens the Help modal (e.key is layout-aware, so this is Shift+/
      // on US keyboards but works on any layout that produces "?").
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        useUiStore.getState().openHelp();
        return;
      }

      handleRatingShortcut(e, queryClientRef.current);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
}
