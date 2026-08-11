import { describe, it, expect, beforeEach } from "vitest";
import { useFilterStore } from "./filterStore";

describe("filterStore", () => {
  beforeEach(() => {
    useFilterStore.getState().resetFilters();
  });

  it("starts with default filter state", () => {
    const state = useFilterStore.getState();
    expect(state.query).toBe("");
    expect(state.showCaptioned).toBeNull();
    expect(state.tagFilter).toBeNull();
    expect(state.ratingFilter).toBeNull();
    expect(state.sortBy).toBe("name");
    expect(state.sortOrder).toBe("asc");
  });

  it("setQuery updates query", () => {
    useFilterStore.getState().setQuery("test");
    expect(useFilterStore.getState().query).toBe("test");
  });

  it("setShowCaptioned updates showCaptioned", () => {
    useFilterStore.getState().setShowCaptioned(true);
    expect(useFilterStore.getState().showCaptioned).toBe(true);
    useFilterStore.getState().setShowCaptioned(null);
    expect(useFilterStore.getState().showCaptioned).toBeNull();
  });

  it("setSortBy and setSortOrder update sort state", () => {
    useFilterStore.getState().setSortBy("file_size");
    useFilterStore.getState().setSortOrder("desc");
    expect(useFilterStore.getState().sortBy).toBe("file_size");
    expect(useFilterStore.getState().sortOrder).toBe("desc");
  });

  it("resetFilters restores defaults", () => {
    useFilterStore.getState().setQuery("x");
    useFilterStore.getState().setRatingFilter("good");
    useFilterStore.getState().resetFilters();
    expect(useFilterStore.getState().query).toBe("");
    expect(useFilterStore.getState().ratingFilter).toBeNull();
  });
});
