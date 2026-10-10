const path = require("path");

// Working against the library source instead of the installed package. VITE_USE_LOCAL_UI
// swaps three things that have to move together: Vite's module resolution, the content
// glob below, and the preset. The preset carries the theme -- the tokens and the border
// colour preflight paints on every element -- so leaving it on the installed package would
// run the new components on the old theme, and the difference would show up as a colour
// found in neither source tree.
const useLocalUi = process.env.VITE_USE_LOCAL_UI === "true";
const localUiPath = process.env.VITE_UI_COMPONENTS_PATH || "../../../react-ui-components";

const preset = useLocalUi
    ? require(path.resolve(localUiPath, "tailwind-preset.js"))
    : require("@stefgo/react-ui-components/tailwind-preset");

const localUiContent = useLocalUi ? [`${localUiPath}/src/**/*.{ts,tsx}`] : [];

/** @type {import('tailwindcss').Config} */
export default {
    // `darkMode` and `safelist` come from the preset, and Tailwind merges those. `content`
    // it does not merge: a `content` set here replaces the preset's, so the library's own
    // dist glob is spread back in -- without it every class only the library uses is
    // missing from the output.
    presets: [preset],
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", ...preset.content, ...localUiContent],
    theme: {
        extend: {
            // No colours and no shadow here on purpose: a role is defined once in the
            // preset and redefined per theme in its .dark block. The status dots use
            // `shadow-glow-success`, which the preset derives from the success token,
            // instead of the fixed green `shadow-glow-online` carried before.
            fontFamily: {
                // The name `@fontsource-variable/inter` registers, imported in `Main.tsx`.
                sans: ["Inter Variable", "ui-sans-serif", "system-ui", "sans-serif"],
            },
        },
    },
    plugins: [],
};
