#!/usr/bin/env node
// Chorus CLI entry. Real implementation lives in src/cli/index.ts.
// During development we use tsx; in published builds we point at dist/cli/index.js.
import("../dist/cli/index.js").catch(async () => {
  const { default: tsx } = await import("tsx/cjs/api");
  tsx.register();
  await import("../src/cli/index.ts");
});
