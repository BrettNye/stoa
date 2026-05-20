// vault-mcp/tests/integration/claim-profile-normalize.test.ts
//
// Verifies that `vault_claim` strips `agent:` and `profile-` prefixes from
// every entry in the stored `profile:` array. Without this normalization,
// `vault_agent-memory`'s profile-membership predicate silently fails because
// it normalizes its own query input the same way and compares with exact
// equality. See src/tools/claim.ts:118 region for the fix rationale.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs, rmSync } from "node:fs";
import { join } from "node:path";
import { callTool, mkTempVault } from "../helpers.js";

interface ClaimFileFrontmatter {
  profile: string[];
}

async function readClaimProfile(vault: string, claim_id: string): Promise<string[]> {
  const path = join(vault, "wikis", "_agents", "claim", `${claim_id}.md`);
  const raw = await fs.readFile(path, "utf8");
  // Crude frontmatter parse for the `profile:` block. We only care about the
  // strings in the YAML array; a full parser is overkill for the assertion.
  const m = raw.match(/^profile:\s*\n((?:\s*-\s+.*\n)*)/m);
  if (!m) return [];
  return m[1].split("\n").filter(l => l.trim().startsWith("-")).map(l => {
    const v = l.replace(/^\s*-\s*/, "").trim();
    return v.replace(/^['"]|['"]$/g, "");
  });
}

describe("vault_claim — profile prefix normalization", () => {
  let vault: string;
  beforeEach(async () => { vault = await mkTempVault(); });
  afterEach(() => { rmSync(vault, { recursive: true, force: true }); });

  it("strips `agent:` prefix from explicit profile entries", async () => {
    const r = await callTool(
      "vault_claim",
      {
        as: "agent:claude-code",
        key: "test.normalize.agent-prefix",
        title: "agent prefix test",
        body: "body",
        profile: ["agent:charmander", "agent:pidgey"],
        confidence: 0.7,
      },
      vault,
    );
    const profile = await readClaimProfile(vault, r.claim_id);
    expect(profile).toEqual(["charmander", "pidgey"]);
  });

  it("strips `profile-` prefix from explicit profile entries", async () => {
    const r = await callTool(
      "vault_claim",
      {
        as: "agent:claude-code",
        key: "test.normalize.profile-prefix",
        title: "profile prefix test",
        body: "body",
        profile: ["profile-charmander", "profile-squirtle"],
        confidence: 0.7,
      },
      vault,
    );
    const profile = await readClaimProfile(vault, r.claim_id);
    expect(profile).toEqual(["charmander", "squirtle"]);
  });

  it("normalizes the default-from-as case (no profile arg) to bare name", async () => {
    const r = await callTool(
      "vault_claim",
      {
        as: "agent:claude-code",
        key: "test.normalize.default-from-as",
        title: "default-from-as test",
        body: "body",
        // no profile arg → defaults to [as] which used to leak the agent: prefix
        confidence: 0.7,
      },
      vault,
    );
    const profile = await readClaimProfile(vault, r.claim_id);
    expect(profile).toEqual(["claude-code"]);
  });

  it("preserves non-agent-style prefixes like `human:` unchanged", async () => {
    const r = await callTool(
      "vault_claim",
      {
        as: "human:brett",
        key: "test.normalize.human-preserved",
        title: "human preserved",
        body: "body",
        profile: ["human:brett", "agent:charmander"],
        confidence: 0.7,
      },
      vault,
    );
    const profile = await readClaimProfile(vault, r.claim_id);
    expect(profile).toEqual(["human:brett", "charmander"]);
  });

  it("preserves explicit empty profile [] as global (not normalized to anything)", async () => {
    const r = await callTool(
      "vault_claim",
      {
        as: "agent:claude-code",
        key: "test.normalize.empty-global",
        title: "global claim",
        body: "body",
        profile: [],
        confidence: 0.7,
      },
      vault,
    );
    const path = join(vault, "wikis", "_agents", "claim", `${r.claim_id}.md`);
    const raw = await fs.readFile(path, "utf8");
    expect(raw).toMatch(/^profile:\s*\[\]\s*$/m);
  });
});
