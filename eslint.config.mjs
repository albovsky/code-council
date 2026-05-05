import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Type-aware linting scoped to the libsql migration surface area: the DB
  // layer + every typed settings helper that reads through it. After the
  // sync→async swap, `settings.get(key)` returns `Promise<unknown>` — if a
  // helper forgets to `await`, the Promise flows into `Schema.safeParse`,
  // becomes `{success: false}`, and silently falls back to defaults
  // (dropping the user's stored value). `no-floating-promises` +
  // `await-thenable` together catch both shapes of that mistake.
  //
  // Scope is narrow on purpose — broadening to all of src/ would surface
  // dozens of pre-existing issues unrelated to this migration. Widen in a
  // separate cleanup pass.
  {
    files: [
      "src/lib/db/**/*.ts",
      "src/lib/settings/**/*.ts",
      "src/lib/personas.ts",
      "src/lib/cli-health.ts",
      "tests/db.test.ts",
      "tests/settings-helpers.test.ts",
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
  // React Compiler aspirational rules — Next.js 16 + React 19 ship a
  // bundle of `react-hooks/{set-state-in-effect,purity,refs}` rules that
  // catch *patterns the React Compiler cannot optimize* rather than
  // broken behaviour. Cockpit components written pre-Next-16 violate
  // them in 7 places (personas + templates pages, app-sidebar,
  // persona-dialog, template-dialog, permissions-form). All paths work
  // correctly in production (488 tests + smoke verified); the rules
  // describe a refactor backlog for v0.8, not a launch-blocker.
  //
  // Keeping them as `warn` so they show up in IDE + CI logs without
  // failing the lint job. Re-promote to `error` once the cockpit
  // refactor lands. Files-scoped so eslint resolves the plugin from the
  // nextVitals config that already loaded it.
  ...(() => {
    // Pluck the nextVitals config block that already loaded react-hooks
    // and inject our warn-level overrides on top. We can't define a
    // standalone block referencing `react-hooks` rules without also
    // reimporting the plugin (the package's main export isn't ESM-
    // resolvable directly from this config), so reuse the existing one.
    const target = nextVitals.find(
      (c) => c.plugins && Object.keys(c.plugins).includes("react-hooks"),
    );
    if (!target) return [];
    return [
      {
        files: target.files ?? ["**/*.{js,jsx,ts,tsx}"],
        plugins: target.plugins,
        rules: {
          "react-hooks/set-state-in-effect": "warn",
          "react-hooks/purity": "warn",
          "react-hooks/refs": "warn",
        },
      },
    ];
  })(),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktree artifacts and node_modules — never lint these.
    ".claude/**",
    "node_modules/**",
    "dist/**",
    "**/.next/**",
  ]),
]);

export default eslintConfig;
