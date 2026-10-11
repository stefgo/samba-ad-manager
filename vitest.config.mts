import { defineConfig } from "vitest/config";

// One config for every workspace that has tests, so `npm test` at the root is the
// whole suite. Every project runs in plain Node: what is tested is logic, and a DOM
// would only be needed once a component is.
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "shared",
                    environment: "node",
                    include: ["shared/src/**/*.test.ts"],
                },
            },
            {
                // Deliberately not server/frontend/vite.config.ts: that one shells out
                // to git for the version and sets up the dev proxy, neither of which a
                // test needs.
                resolve: {
                    // @sadm/shared exports its source under this condition. Without it
                    // the frontend tests would read shared/dist -- which needs a build
                    // first and is stale the moment shared/src changes.
                    conditions: ["development"],
                },
                test: {
                    name: "frontend",
                    environment: "node",
                    include: ["server/frontend/src/**/*.test.ts"],
                },
            },
            {
                // The same condition as the frontend, for the same reason: the backend
                // imports @sadm/shared, and a test must not depend on its build.
                resolve: { conditions: ["development"] },
                test: {
                    name: "backend",
                    environment: "node",
                    include: ["server/backend/src/**/*.test.ts"],
                },
            },
        ],
    },
});
