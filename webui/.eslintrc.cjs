module.exports = {
  env: {
    browser: true,
    es2022: true,
    jest: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["build/", "coverage/"],
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: "latest",
    sourceType: "module",
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  globals: {
    afterEach: "readonly",
    beforeEach: "readonly",
    describe: "readonly",
    expect: "readonly",
    test: "readonly",
    vi: "readonly",
  },
  rules: {
    "no-console": "off",
    "no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^(_|e$|props$)",
        varsIgnorePattern: "^(e|props)$",
      },
    ],
    "react/prop-types": "off",
    "react/react-in-jsx-scope": "off",
  },
};
