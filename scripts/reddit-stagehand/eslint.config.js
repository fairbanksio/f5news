import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", ".chrome-profile/**", "output/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser } },
    rules: { "no-unused-vars": ["error", { varsIgnorePattern: "^ignored", argsIgnorePattern: "^_" }] },
  },
];
