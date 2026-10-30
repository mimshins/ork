/**
 * @file Oxlint configuration: the type-aware rule set, the repository's
 *   conventions, and the package boundaries (`schema <- core <- runtime-claude,
 *   nodes <- server <- cli`) enforced as restricted imports.
 */

import { defineConfig, type OxlintOverride } from "oxlint";

// Dependency direction between workspace packages:
//   integrations <- schema <- core <- runtime-claude, nodes <- server <- cli
// A package may import only the packages to its left.
const PACKAGES = [
  "integrations",
  "schema",
  "core",
  "runtime-claude",
  "nodes",
  "server",
  "cli",
] as const;

const ALLOWED: Record<(typeof PACKAGES)[number], readonly string[]> = {
  integrations: [],
  schema: ["integrations"],
  core: ["integrations", "schema"],
  "runtime-claude": ["integrations", "schema", "core"],
  nodes: ["integrations", "schema", "core"],
  server: ["integrations", "schema", "core", "runtime-claude", "nodes"],
  cli: ["integrations", "schema", "core", "runtime-claude", "nodes", "server"],
};

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
                    message:
                      "dependency direction: integrations <- schema <- core <- runtime-claude, nodes <- server <- cli",
                  },
                ]
              : []),
            {
              group: ["@krapht/ork*/src", "@krapht/ork*/src/**"],
              message: "import a package through its public entry point",
            },
            {
              regex: `^(\\.\\./)+(${PACKAGES.join("|")}|packages)(/|$)`,
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
      files: ["**/test/**", "**/*.test.ts"],
      rules: {
        "typescript/no-floating-promises": "off",
        "max-lines": "off",
      },
    },
  ],
});
