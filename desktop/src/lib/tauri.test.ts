import { describe, it, expect } from "vitest";
import { isAppError, errorMessage, type AppError } from "@/lib/tauri";

describe("isAppError", () => {
  it("accepts a well-formed structured command error", () => {
    const e: AppError = { kind: "modelNotFound", message: "no model" };
    expect(isAppError(e)).toBe(true);
  });

  it("rejects plain Errors and non-objects", () => {
    expect(isAppError(new Error("boom"))).toBe(false);
    expect(isAppError("just a string")).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError({ kind: "x" })).toBe(false); // missing message
  });
});

describe("errorMessage", () => {
  it("prefers the structured message from an AppError", () => {
    const e: AppError = {
      kind: "vectorStoreUnavailable",
      message: "index unavailable",
    };
    expect(errorMessage(e)).toBe("index unavailable");
  });

  it("falls back to Error.message and String() for other values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("raw")).toBe("raw");
    expect(errorMessage(42)).toBe("42");
  });
});
