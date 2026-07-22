import { describe, expect, it } from "vitest";
import {
  buildApiUrl,
  buildWebSocketUrl,
  normalizeServerUrl,
} from "./server-url";

describe("server URL configuration", () => {
  it("normalizes host names and trailing slashes", () => {
    expect(normalizeServerUrl("example.com/")).toBe("http://example.com");
    expect(normalizeServerUrl("https://example.com/base/")).toBe(
      "https://example.com/base",
    );
  });

  it("accepts WebSocket URLs as server addresses", () => {
    expect(normalizeServerUrl("wss://example.com/game/")).toBe(
      "https://example.com/game",
    );
  });

  it("rejects unsupported protocols and credentials", () => {
    expect(() => normalizeServerUrl("ftp://example.com")).toThrow();
    expect(() => normalizeServerUrl("https://user:pass@example.com")).toThrow();
  });

  it("builds API and WebSocket endpoints", () => {
    expect(buildApiUrl("https://example.com/base")).toBe(
      "https://example.com/base/api/trpc",
    );
    expect(buildWebSocketUrl("https://example.com/base")).toBe(
      "wss://example.com/base/ws",
    );
  });
});
