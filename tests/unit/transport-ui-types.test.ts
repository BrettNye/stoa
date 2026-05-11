import { it, expect } from "vitest";
import type { ApiTask, ApiAgent, ClaimRequest } from "../../src/transport/ui/types.js";

it("ApiTask requires the load-bearing fields", () => {
  const t: ApiTask = {
    id: "task-foo",
    title: "Foo",
    wiki: "_agents",
    status: "pending",
    updated: "2026-05-11T12:00:00Z"
  };
  expect(t.status).toBe("pending");
});

it("ClaimRequest carries expected_updated for OCC", () => {
  const r: ClaimRequest = {
    agent_id: "agent:squirtle",
    expected_updated: "2026-05-11T12:00:00Z"
  };
  expect(r.expected_updated).toBeDefined();
});
