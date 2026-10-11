import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal dismissal", () => {
  it("stays open after outside clicks and Escape, then closes with X", () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose} title="Batch Rename"><input defaultValue="my_prefix" /></Modal>);
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("my_prefix")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the close control disabled during protected operations", () => {
    const onClose = vi.fn();
    render(<Modal isOpen closeDisabled onClose={onClose} title="Working">Please wait</Modal>);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
