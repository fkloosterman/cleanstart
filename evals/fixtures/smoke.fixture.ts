import type { EvalFixtureModule } from "../types";

/**
 * Harness smoke test: proves the runner can load a fixture, reach the
 * configured model, and evaluate assertions. Real fixture sets arrive with
 * WP1.4 (extraction) and WP3.6 (composer).
 */
const fixtures: EvalFixtureModule = {
  name: "smoke: model replies and assertion evaluates",
  purpose: "chat",
  prompt: 'Reply with exactly the word "pong" and nothing else.',
  assertions: [{ kind: "contains", value: "pong", caseSensitive: false }],
};

export default fixtures;
