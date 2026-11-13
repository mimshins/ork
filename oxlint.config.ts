/**
 * @file Oxlint configuration: the type-aware rule set, the repository's
 *   conventions, the package boundaries (`schema <- core <- runtime, nodes <-
 *   server <- ui, cli`) enforced as restricted imports, and the UI's React,
 *   hooks and accessibility rules.
 */

import { defineConfig, type OxlintOverride } from "oxlint";

// Dependency direction between workspace packages:
//   integrations <- schema <- core <- runtime, nodes <- server <- ui, cli
// A package may import only the packages to its left. The UI is browser code:
// it imports only the server's browser entry (`@krapht/ork-server/client`),
// and the CLI takes its built files, never its source.
const PACKAGES = [
  "integrations",
  "schema",
  "core",
  "runtime",
  "nodes",
  "server",
  "ui",
  "cli",
] as const;

const ALLOWED: Record<(typeof PACKAGES)[number], readonly string[]> = {
  integrations: [],
  schema: ["integrations"],
  core: ["integrations", "schema"],
  runtime: ["integrations", "schema", "core"],
  nodes: ["integrations", "schema", "core"],
  server: ["integrations", "schema", "core", "runtime", "nodes"],
  ui: ["server"],
  cli: ["integrations", "schema", "core", "runtime", "nodes", "server"],
};

const DIRECTION =
  "dependency direction: integrations <- schema <- core <- runtime, nodes <- server <- ui, cli";

/** The npm name of a workspace package: the CLI is `@krapht/ork` itself. */
const npmName = (pkg: (typeof PACKAGES)[number]): string =>
  pkg === "cli" ? "@krapht/ork" : `@krapht/ork-${pkg}`;

const boundaries = (pkg: (typeof PACKAGES)[number]): OxlintOverride => {
  const forbidden = PACKAGES.filter(
    other => other !== pkg && !ALLOWED[pkg].includes(other),
  );
  return {
    files: [`packages/${pkg}/**`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...(forbidden.length > 0
              ? [
                  {
                    group: forbidden.flatMap(p => [
                      npmName(p),
                      `${npmName(p)}/**`,
                    ]),
                    message: DIRECTION,
                  },
                ]
              : []),
            {
              group: ["@krapht/ork*/src", "@krapht/ork*/src/**"],
              message: "import a package through its public entry point",
            },
            {
              // `runtime` needs two levels up: core's own `src/runtime/` is `../runtime`.
              regex: `^((\\.\\./)+(${PACKAGES.filter(name => name !== "runtime").join("|")})|(\\.\\./){2,}runtime|(\\.\\./)+packages)(/|$)`,
              message: "no relative import into another package",
            },
          ],
        },
      ],
    },
  };
};

export default defineConfig({
  plugins: [
    "typescript",
    "import",
    "oxc",
    "unicorn",
    "promise",
    "node",
    "vitest",
  ],
  categories: {
    correctness: "error",
    suspicious: "error",
    pedantic: "error",
    perf: "error",
  },
  options: {
    reportUnusedDisableDirectives: "error",
    typeAware: true,
  },
  env: {
    es2024: true,
    node: true,
  },
  ignorePatterns: [
    "**/dist/**",
    "**/node_modules/**",
    "**/test/fixtures/**",
    // The interaction map's browser code and data: plain ES modules with JSDoc
    // types, ported as is and validated by docs/interaction-map/tools/check.mjs.
    "docs/interaction-map/public/**",
    // A third-party skill kept byte for byte (see its PROVENANCE.md).
    ".ai/skills/security-audit/**",
    ".claude/skills/security-audit/**",
  ],
  rules: {
    "typescript/no-explicit-any": "error",
    "typescript/ban-ts-comment": [
      "error",
      {
        "ts-expect-error": "allow-with-description",
        "ts-ignore": true,
        "ts-nocheck": true,
        minimumDescriptionLength: 10,
      },
    ],
    "typescript/consistent-type-imports": [
      "error",
      { fixStyle: "inline-type-imports" },
    ],
    "typescript/no-import-type-side-effects": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/consistent-type-definitions": ["error", "type"],
    "typescript/unbound-method": "off",
    "typescript/prefer-readonly-parameter-types": "off",
    "eslint/no-eval": "error",
    "eslint/no-new-func": "error",
    "eslint/no-implied-eval": "error",
    "eslint/eqeqeq": ["error", "always"],
    "eslint/no-var": "error",
    "eslint/prefer-const": "error",
    "eslint/max-lines-per-function": "off",
    "eslint/default-case": "error",
    "eslint/object-shorthand": "error",
    "eslint/no-promise-executor-return": "error",
    "eslint/no-unmodified-loop-condition": "error",
    "eslint/no-alert": "error",
    "eslint/no-duplicate-imports": ["error", { includeExports: true }],
    "eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "func-style": ["error", "expression", { allowArrowFunctions: true }],
    "prefer-arrow-callback": ["error", { allowNamedFunctions: false }],
    "import/no-cycle": "error",
    "import/no-unassigned-import": "error",
    "import/extensions": [
      "error",
      "always",
      {
        ignorePackages: true,
        checkTypeImports: true,
        ts: "always",
        json: "always",
      },
    ],
    "vitest/no-focused-tests": "error",
    "vitest/no-disabled-tests": "error",
  },
  overrides: [
    ...PACKAGES.map(pkg => boundaries(pkg)),
    {
      // The UI's code and tests: React, hooks and accessibility rules, and the
      // DOM. Its Vite config and build plugins run in Node.
      files: ["packages/ui/src/**", "packages/ui/test/**"],
      plugins: [
        "typescript",
        "import",
        "oxc",
        "unicorn",
        "promise",
        "vitest",
        "react",
        "jsx-a11y",
      ],
      env: { browser: true },
      rules: {
        "react/react-in-jsx-scope": "off",
        "react/jsx-filename-extension": ["error", { extensions: [".tsx"] }],
        // Style sheets are imported for their effect; Vite bundles them.
        "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
      },
    },
    {
      // What runs in the browser imports no Node module and no Node entry.
      files: ["packages/ui/src/**"],
      env: { browser: true, node: false },
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@krapht/ork-server",
                message:
                  "browser code imports the server's browser entry, @krapht/ork-server/client",
              },
            ],
            patterns: [
              {
                group: [
                  "@krapht/ork-*",
                  "!@krapht/ork-server",
                  "!@krapht/ork-server/client",
                  "node:*",
                ],
                message: DIRECTION,
              },
            ],
          },
        ],
      },
    },
    {
      files: ["**/test/**", "**/*.test.ts", "**/*.test.tsx"],
      rules: {
        "typescript/no-floating-promises": "off",
        "max-lines": "off",
      },
    },
  ],
});
