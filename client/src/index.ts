import { VERSION } from "./core/Version.js";

// `--version` for whoever builds an image with this agent in it: says what was installed and
// that it starts, without a Samba to read and without touching a file. Everything else is
// imported only after this, because importing it reads the configuration.
if (process.argv.includes("--version")) {
    console.log(VERSION);
    process.exit(0);
}

await import("./agent.js");
