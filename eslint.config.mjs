// Minimal, lenient config — mirrors the leniency of the original monolith's
// eslint-config-next preset (this backend has no Next.js/React code, so that
// preset doesn't apply, but we keep the same "don't block on style nits"
// philosophy rather than opting into strict typescript-eslint rule sets that
// were never part of the original project).
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "off", // TypeScript itself catches real undefined-symbol errors
    },
  },
  { ignores: ["dist/", "node_modules/", "python/"] },
];
