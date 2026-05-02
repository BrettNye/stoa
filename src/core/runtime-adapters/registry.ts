import type { RuntimeAdapter, RuntimeName } from "./types.js";
import { UnknownRuntimeError } from "./types.js";
import { claudeCodeAdapter } from "./claude-code.js";

export function getAdapter(runtime: RuntimeName): RuntimeAdapter {
  switch (runtime) {
    case "claude-code":
      return claudeCodeAdapter;
    default: {
      // Exhaustiveness guard — extending RuntimeName forces a new case here.
      const _exhaustive: never = runtime;
      throw new UnknownRuntimeError(String(_exhaustive));
    }
  }
}
