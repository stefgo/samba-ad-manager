import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// .mjs, like commitlint.config.mjs: the root package.json has no "type": "module",
// so a plain .js file here would be reparsed as ESM on every run, with a warning.
//
// Covers the three Node workspaces: shared, client and server/backend. The frontend
// keeps its own config next to its sources -- it needs the React plugins and browser
// globals, and two configs matching the same files would be two truths about them.
// A new Node workspace is covered by this one without another file.
export default defineConfig([
    globalIgnores([
        "**/dist",
        "**/node_modules",
        "server/frontend",
        "docker",
    ]),
    {
        files: ["**/*.{js,mjs,ts}"],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: globals.node,
            // Explicit, because the editor's ESLint server also loads the frontend
            // config in this process and the parser would otherwise see two
            // inferred roots.
            parserOptions: { tsconfigRootDir: import.meta.dirname },
        },
        rules: {
            // A `let` that a closure reads before anything assigns it cannot become a
            // `const` -- the timeout handle a cancel function closes over, for instance.
            // Every other single-assignment `let` is still an error.
            "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
            // No varsIgnorePattern here: the frontend needs one for components a file
            // only re-exports, the Node workspaces have nothing of the kind -- and an
            // "^[A-Z_]" exception would quietly swallow every unused type import.
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_" },
            ],
        },
    },
]);
