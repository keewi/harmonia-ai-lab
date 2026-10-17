import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // The self-hosted runner unpacks GitHub's own actions, TypeScript and
    // all, into actions-runner/_work. None of it is ours to lint or compile.
    "actions-runner/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Reference components mirrored from Claude Design — not app code.
    "design-system/**",
    // Feature worktrees carry their own .next and node_modules — never lint them.
    ".claude/**",
    "docs/handoff/**",
  ]),
]);

export default eslintConfig;
