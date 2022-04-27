module.exports = {
  env: {
    browser: false,
    es2021: true,
    mocha: true,
    node: true,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "standard",
    // "plugin:prettier/recommended",
    "plugin:node/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {
    "node/no-unsupported-features/es-syntax": [
      "error",
      { ignores: ["modules"] },
    ],
    "node/no-unpublished-import": "off",
    "node/no-missing-import": ["error", {
      allowModules: [],
      tryExtensions: [".ts", ".js", ".json", ".node"],
    }],
    semi: ["error", "always"],
    quotes: ["error", "double"],
    "comma-dangle": ["error", "always-multiline"],
    "padded-blocks": "off",
    "space-before-function-paren": [
      "error",
      {
        anonymous: "always",
        named: "never",
        asyncArrow: "always",
      },
    ],
    "no-unused-vars": "off",
    "eslint no-multiple-empty-lines:": "off",
    "@typescript-eslint/no-unused-vars": "error",
  },
};
