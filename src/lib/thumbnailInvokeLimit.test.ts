import { describe, it, expect } from "vitest";
import { withThumbnailInvokeLimit } from "./thumbnailInvokeLimit";

describe("withThumbnailInvokeLimit", () => {
  it("returns the inner promise result", async () => {
    const v = await withThumbnailInvokeLimit(() => Promise.resolve(42));
    expect(v).toBe(42);
  });

  it("serializes many tiny tasks without throwing", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withThumbnailInvokeLimit(() => Promise.resolve(i))
      )
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});
