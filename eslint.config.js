import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**", "release/**", "dist-electron/**", ".pf-run/**", "public/samples/**"] },
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ["src/**/*.{ts,tsx}", "shared/**/*.ts", "server/**/*.ts", "e2e/**/*.ts", "integrations/**/*.ts", "api/**/*.ts"],
  })),
  {
    files: ["src/**/*.{ts,tsx}", "shared/**/*.ts", "server/**/*.ts", "e2e/**/*.ts", "integrations/**/*.ts", "api/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
