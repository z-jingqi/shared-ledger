import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default [
  { ignores: ["**/dist/**", "**/coverage/**", "**/.wrangler/**", "accounting-app-mobile-design/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
