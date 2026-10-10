import { PassThrough } from "stream";
import Docker from "dockerode";
import type { DcContainer } from "@sadm/shared";
import { config } from "../core/Config.js";

/** What a command inside the Samba container left behind. */
export interface ExecResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}

export interface ExecOptions {
    timeoutMs: number;
    /** Beyond this the output is cut and the call fails: nothing the agent asks for is that long. */
    maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The Samba container, through the Docker socket: what state it is in, and a way to run
 * something inside it.
 *
 * The socket is root on the host, and `exec` is the widest thing it offers -- which is why
 * nothing here takes a command from the server. The only caller of `exec` is the Samba
 * helper, with an argument list this agent builds itself; there is no shell in between.
 */
export class DockerService {
    private static docker: Docker | null = null;

    /** Whether a container is named at all. Without one, the Docker socket is never opened. */
    static isConfigured(): boolean {
        return !!config.samba.container;
    }

    private static client(): Docker {
        this.docker ??= new Docker({ socketPath: config.samba.dockerSocket });
        return this.docker;
    }

    private static container(): Docker.Container {
        if (!config.samba.container) throw new Error("No Samba container is configured (samba.container)");
        return this.client().getContainer(config.samba.container);
    }

    /** The container as Docker describes it right now. */
    static async inspect(): Promise<DcContainer> {
        const info = await this.container().inspect();
        return {
            name: info.Name.replace(/^\//, ""),
            state: info.State.Status,
            running: info.State.Running,
            // Docker writes the zero time for a container that never started.
            startedAt: info.State.StartedAt && !info.State.StartedAt.startsWith("0001-") ? info.State.StartedAt : null,
            image: info.Config.Image,
            health: info.State.Health?.Status ?? null,
            restartCount: info.RestartCount,
        };
    }

    /**
     * Runs one command inside the container and waits for it to end. `cmd` is the argument
     * list as it is; nothing interprets it on the way.
     */
    static async exec(cmd: string[], options: ExecOptions): Promise<ExecResult> {
        const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        const exec = await this.container().exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
        const stream = await exec.start({});

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let bytes = 0;
        let overflow = false;
        const collect = (into: Buffer[]) => {
            const sink = new PassThrough();
            sink.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > maxBytes) {
                    overflow = true;
                    stream.destroy();
                    return;
                }
                into.push(chunk);
            });
            return sink;
        };
        this.client().modem.demuxStream(stream, collect(stdout), collect(stderr));

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            // Ends the wait, not the process: Docker has no way to stop a single exec.
            stream.destroy();
        }, options.timeoutMs);
        try {
            await new Promise<void>((resolve) => {
                stream.on("end", resolve);
                stream.on("close", resolve);
                stream.on("error", () => resolve());
            });
        } finally {
            clearTimeout(timer);
        }
        if (timedOut) throw new Error(`Timed out after ${Math.round(options.timeoutMs / 1000)} s`);
        if (overflow) throw new Error(`Produced more than ${maxBytes} bytes of output`);

        const { ExitCode } = await exec.inspect();
        return {
            exitCode: ExitCode,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
        };
    }
}
