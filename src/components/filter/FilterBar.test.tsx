import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterBar } from "./FilterBar";

describe("FilterBar", () => {
  it("renders search input and filter controls", () => {
    render(<FilterBar />);
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Uncaptioned$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Captioned$/i })).toBeInTheDocument();
  });

  it("updates search query when user types", async () => {
    const user = userEvent.setup();
    render(<FilterBar />);
    const input = screen.getByPlaceholderText("Search…");
    await user.type(input, "test");
    expect(input).toHaveValue("test");
  });
});
