import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Node puts the system's error code on the error; the type of a caught one does not say so. */
const isEpipe = (err: Error): boolean => (err as NodeJS.ErrnoException).code === "EPIPE";

// --- Ignore EPIPE globally (safe for dev) ---
process.on("uncaughtException", (err) => {
    if (isEpipe(err)) return;
    console.error(err);
});

// --- Version helper ---
// Same precedence as scripts/generate-version.sh, so the version the UI shows and the
// one an agent reports cannot disagree: build argument, then the version
// semantic-release maintains in the root package.json, then git.
const getVersion = (): string => {
    if (process.env.VITE_APP_VERSION) {
        return process.env.VITE_APP_VERSION;
    }
    try {
        const rootPackageJson = path.resolve(__dirname, "../../package.json");
        const { version } = JSON.parse(readFileSync(rootPackageJson, "utf8")) as { version?: string };
        if (version) {
            try {
                execSync("git describe --tags --exact-match", { stdio: "pipe" });
                return version;
            } catch {
                const hash = execSync("git rev-parse --short HEAD", { stdio: "pipe" })
                    .toString()
                    .trim();
                const dirty = execSync("git status --porcelain", { stdio: "pipe" })
                    .toString()
                    .trim()
                    ? "-dirty"
                    : "";
                return `${version}+${hash}${dirty}`;
            }
        }
    } catch {
        // No readable manifest or no git -- fall through to the branch name.
    }
    try {
        const branch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
        const hash = execSync("git rev-parse --short HEAD").toString().trim();
        const dirty = execSync("git status --porcelain").toString().trim()
            ? "-dirty"
            : "";
        return `${branch}-${hash}${dirty}`;
    } catch {
        return "unknown";
    }
};

const APP_VERSION = getVersion();

// The dev proxy has to reach the backend wherever it listens, so it reads the same variable
// the server does. `npm run dev:server` and `npm run dev:frontend` are separate shells: a
// port set only in config.yaml is invisible here and has to be given to both.
const BACKEND_PORT = process.env.SADM_SERVER_PORT || 3020;

export default defineConfig(() => ({
    plugins: [react()],

    define: {
        __APP_VERSION__: JSON.stringify(APP_VERSION),
    },

    server: {
        // Fixed, and loud when it is taken. Without `strictPort` Vite walks up to
        // 5174, 5175 and so on, which reads as a convenience and is not one here:
        // the VS Code tasks wait for a specific port in their `endsPattern` and
        // simply never report ready, so the debug session silently fails to start
        // -- and the local-UI launch would have attached to whatever already held
        // 5173, debugging the installed library instead of the checkout.
        // The local-UI task passes `--port 5174` and gets its own server.
        strictPort: true,
        proxy: {
            "/api": {
                target: `http://localhost:${BACKEND_PORT}`,
                changeOrigin: true,
                ws: false,
            },
            "/ws": {
                target: `ws://localhost:${BACKEND_PORT}`,
                changeOrigin: true,
                ws: true,
                configure: (proxy) => {
                    proxy.on("error", (err) => {
                        if (isEpipe(err)) return;
                        console.log("proxy ws error", err);
                    });
                },
            },
        },
    },

    // Resolving the component library.
    //
    // The default is the installed package: a build on a machine without a
    // sibling checkout -- CI, a container -- must not depend on one. Working
    // against the library source is opt-in via VITE_USE_LOCAL_UI=true, and the
    // type check has to be switched with it (npm run typecheck:local-ui), or the
    // compiler and the bundler look at two different versions of the same module.
    resolve: {
        alias: {
            ...(process.env.VITE_USE_LOCAL_UI === "true"
                ? {
                        "@stefgo/react-ui-components": path.resolve(
                            process.env.VITE_UI_COMPONENTS_PATH ||
                                "../../../react-ui-components",
                            "src/index.ts",
                        ),
                    }
                : {}),
        },
        dedupe: ["react", "react-dom", "lucide-react"],
    },

    build: {
        outDir: "../dist/public",
        emptyOutDir: true,
        // Rolldown, which bundles since Vite 8, takes `manualChunks` only as a function
        // and fails on the object form this used to carry. Its replacement matches module
        // paths rather than package entry points, so a group has to name what the object
        // form pulled in implicitly: react-router behind react-router-dom, scheduler
        // behind react-dom.
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: "vendor-react",
                            test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
                        },
                        {
                            name: "vendor-icons",
                            test: /node_modules[\\/]lucide-react[\\/]/,
                        },
                        {
                            name: "vendor-utils",
                            test: /node_modules[\\/]zustand[\\/]/,
                        },
                    ],
                },
            },
        },
    },
}));
