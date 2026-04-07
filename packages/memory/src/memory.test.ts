import { describe, it, expect } from "vitest";
import { DEFAULT_AGENT_CATEGORIES } from "./types.js";
import * as WorkingMemory from "./working-memory.js";

describe("types", () => {
  it("has default agent categories", () => {
    expect(DEFAULT_AGENT_CATEGORIES.length).toBeGreaterThan(0);
    expect(DEFAULT_AGENT_CATEGORIES).toContain("directives");
  });
});

describe("working-memory", () => {
  it("creates and retrieves working memory", () => {
    const state = WorkingMemory.load("test-agent", "session-1");
    expect(state.agentId).toBe("test-agent");
    expect(state.sessionId).toBe("session-1");
  });

  it("enforces 16KB limit", () => {
    const result = WorkingMemory.write("test-agent", "session-2", "big", "x".repeat(20000));
    expect(result.success).toBe(false);
  });

  it("flushes and clears", () => {
    WorkingMemory.write("test-agent", "session-3", "fact", "test data");
    const flushed = WorkingMemory.flush("test-agent", "session-3");
    expect(flushed).not.toBeNull();
    expect(flushed!.data.fact).toBe("test data");
    
    const after = WorkingMemory.flush("test-agent", "session-3");
    expect(after).toBeNull();
  });
});
