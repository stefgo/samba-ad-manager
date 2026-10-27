/**
 * The version of this server, as the image was built with it (`APP_VERSION`, see
 * docker/Dockerfile.server); null where nobody said -- a development run, or a build without
 * the argument. Read once: it cannot change while the process runs.
 */
export const appVersion: string | null = (() => {
    const value = process.env.APP_VERSION?.trim();
    return value && value !== "unknown" ? value : null;
})();
