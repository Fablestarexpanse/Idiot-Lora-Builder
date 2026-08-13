import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FilterBar } from "./FilterBar";

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("FilterBar", () => {
  it("renders search input and filter controls", () => {
    renderWithClient(<FilterBar />);
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Uncaptioned$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Captioned$/i })).toBeInTheDocument();
  });

  it("updates search query when user types", async () => {
    const user = userEvent.setup();
    renderWithClient(<FilterBar />);
    const input = screen.getByPlaceholderText("Search…");
    await user.type(input, "test");
    expect(input).toHaveValue("test");
  });
});
