/**
 * Eval harness (WP0.5): `bun run evals`
 *
 * Loads every fixture file in evals/fixtures/, calls the model configured
 * for the fixture's purpose (see src/lib/model-map.ts), evaluates the
 * fixture's assertions against the reply, and reports pass/fail. Exits
 * non-zero if any fixture fails.
 *
 * Adding a fixture file is the only step needed to cover a new case.
 *
 * Per D16/D12: evals are run manually before prompt-touching merges, with
 * env pointing at the production-designated models — never only against the
 * free dev models a prompt might accidentally be tuned to.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateText } from "ai";
import { createModelForPurpose } from "@/lib/ai-gateway.server";
import { resolveModelConfig } from "@/lib/model-map";
import type { EvalAssertion, EvalFixture, EvalFixtureModule } from "./types";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

function checkAssertion(assertion: EvalAssertion, output: string): string | null {
  switch (assertion.kind) {
    case "contains": {
      const haystack = assertion.caseSensitive ? output : output.toLowerCase();
      const needle = assertion.caseSensitive ? assertion.value : assertion.value.toLowerCase();
      return haystack.includes(needle)
        ? null
        : `expected output to contain ${JSON.stringify(assertion.value)}`;
    }
    case "matches": {
      const re = new RegExp(assertion.pattern, assertion.flags);
      return re.test(output) ? null : `expected output to match /${assertion.pattern}/`;
    }
    case "json-parses": {
      try {
        JSON.parse(output);
        return null;
      } catch {
        return "expected output to be valid JSON";
      }
    }
  }
}

async function loadFixtures(): Promise<EvalFixture[]> {
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".fixture.ts"))
    .sort();
  const fixtures: EvalFixture[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(FIXTURES_DIR, file)).href)) as {
      default: EvalFixtureModule;
    };
    const value = mod.default;
    fixtures.push(...(Array.isArray(value) ? value : [value]));
  }
  return fixtures;
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY — set it in .env or the environment.");
  process.exit(1);
}

const fixtures = await loadFixtures();
if (fixtures.length === 0) {
  console.error(`No fixtures found in ${FIXTURES_DIR}.`);
  process.exit(1);
}

let failures = 0;
for (const fixture of fixtures) {
  const { modelId } = resolveModelConfig(fixture.purpose, process.env);
  let errors: string[];
  try {
    const { text } = await generateText({
      model: createModelForPurpose(fixture.purpose, apiKey),
      system: fixture.system,
      prompt: fixture.prompt,
    });
    errors = fixture.assertions
      .map((a) => checkAssertion(a, text))
      .filter((e): e is string => e !== null);
  } catch (err) {
    errors = [`model call failed: ${err instanceof Error ? err.message : String(err)}`];
  }

  if (errors.length === 0) {
    console.log(`PASS  ${fixture.name}  [${fixture.purpose} → ${modelId}]`);
  } else {
    failures++;
    console.error(`FAIL  ${fixture.name}  [${fixture.purpose} → ${modelId}]`);
    for (const error of errors) console.error(`      ${error}`);
  }
}

console.log(`\n${fixtures.length - failures}/${fixtures.length} fixtures passed`);
process.exit(failures > 0 ? 1 : 0);
