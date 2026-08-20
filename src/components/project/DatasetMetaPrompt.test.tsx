import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const readDatasetMetadata = vi.fn();
vi.mock("@/lib/tauri", () => ({
  readDatasetMetadata: (...args: unknown[]) => readDatasetMetadata(...args),
}));

const { DatasetMetaPrompt } = await import("./DatasetMetaPrompt");
const { useProjectStore } = await import("@/stores/projectStore");
const { useSettingsStore } = await import("@/stores/settingsStore");

function meta(trigger: string | null, name: string | null = null) {
  return {
    generator: "dataset-deviser",
    trigger,
    character_name: name,
    dataset_type: "character",
    caption_style: "prose",
  };
}

function setup(rootPath: string | null, triggerWord = "", locked = false) {
  // act() because a mounted prompt re-runs its lookup effect on these.
  act(() => {
    useProjectStore.setState({ rootPath });
    useSettingsStore.setState({ triggerWord, triggerWordLocked: locked });
  });
}

describe("DatasetMetaPrompt", () => {
  beforeEach(() => {
    readDatasetMetadata.mockReset();
    setup(null);
  });

  it("offers the trigger word a generator recorded", async () => {
    readDatasetMetadata.mockResolvedValue(meta("sysnootles", "Sy Snootles"));
    setup("/ds");
    render(<DatasetMetaPrompt />);
    expect(await screen.findByText("sysnootles")).toBeInTheDocument();
    expect(screen.getByText(/for Sy Snootles/)).toBeInTheDocument();
  });

  it("sets the trigger word when accepted", async () => {
    const user = userEvent.setup();
    readDatasetMetadata.mockResolvedValue(meta("sysnootles"));
    setup("/ds");
    render(<DatasetMetaPrompt />);
    await user.click(await screen.findByRole("button", { name: /Use it/ }));
    expect(useSettingsStore.getState().triggerWord).toBe("sysnootles");
  });

  it("leaves the trigger word alone when declined", async () => {
    const user = userEvent.setup();
    readDatasetMetadata.mockResolvedValue(meta("sysnootles"));
    setup("/ds", "existing");
    render(<DatasetMetaPrompt />);
    await user.click(await screen.findByRole("button", { name: /Not now/ }));
    expect(useSettingsStore.getState().triggerWord).toBe("existing");
    expect(screen.queryByText("sysnootles")).not.toBeInTheDocument();
  });

  it("does not nag after the same folder was declined", async () => {
    const user = userEvent.setup();
    readDatasetMetadata.mockResolvedValue(meta("sysnootles"));
    setup("/ds");
    const { rerender } = render(<DatasetMetaPrompt />);
    await user.click(await screen.findByRole("button", { name: /Not now/ }));

    // Re-open the same folder.
    setup("/other");
    rerender(<DatasetMetaPrompt />);
    await waitFor(() => expect(screen.getByText("sysnootles")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Not now/ }));
    setup("/ds");
    rerender(<DatasetMetaPrompt />);
    await waitFor(() =>
      expect(screen.queryByText("sysnootles")).not.toBeInTheDocument()
    );
  });

  it("stays silent when the trigger is already in use", async () => {
    readDatasetMetadata.mockResolvedValue(meta("sysnootles"));
    setup("/ds", "sysnootles");
    render(<DatasetMetaPrompt />);
    await waitFor(() => expect(readDatasetMetadata).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays silent when the trigger word is locked", async () => {
    readDatasetMetadata.mockResolvedValue(meta("sysnootles"));
    setup("/ds", "", true);
    render(<DatasetMetaPrompt />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(readDatasetMetadata).not.toHaveBeenCalled();
  });

  it("stays silent for a folder with no recognised metadata", async () => {
    readDatasetMetadata.mockResolvedValue(null);
    setup("/ds");
    render(<DatasetMetaPrompt />);
    await waitFor(() => expect(readDatasetMetadata).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays silent when the lookup fails", async () => {
    readDatasetMetadata.mockRejectedValue(new Error("backend exploded"));
    setup("/ds");
    render(<DatasetMetaPrompt />);
    await waitFor(() => expect(readDatasetMetadata).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
