import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const FALLBACK_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", path.join(homedir(), ".local", "bin"), path.join(homedir(), ".claude", "local")];

export interface CompleteRequest {
  claudePath: string;
  model: string;
  system: string;
  prompt: string;
  timeoutMs: number;
}

export type Complete = (request: CompleteRequest) => Promise<string>;

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[], options: { stdin: string; timeoutMs: number }) => Promise<CommandResult>;

const executable = (candidate: string) => access(candidate, constants.X_OK).then(() => candidate, () => null);

export async function resolveCommand(command: string): Promise<string | null> {
  if (command.includes(path.sep)) return executable(command);
  const directories = [...(process.env.PATH ?? "").split(path.delimiter).filter((directory) => directory !== ""), ...FALLBACK_BIN_DIRS];
  for (const directory of directories) {
    const found = await executable(path.join(directory, command));
    if (found !== null) return found;
  }
  return null;
}

export const spawnRunner: CommandRunner = (command, args, { stdin, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude did not answer within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });

export function parseResult(stdout: string): { result: string; isError: boolean } {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.type !== "result") continue;
      return {
        result: typeof parsed.result === "string" ? parsed.result : "",
        isError: parsed.is_error === true || parsed.subtype !== "success",
      };
    } catch {
      continue;
    }
  }
  throw new Error(`claude returned no result: ${stdout.trim().slice(0, 500) || "(empty output)"}`);
}

export function claudeArgs({ model, system }: Pick<CompleteRequest, "model" | "system">): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--system-prompt",
    system,
  ];
}

export function createComplete(run: CommandRunner = spawnRunner): Complete {
  return async (request) => {
    const command = (await resolveCommand(request.claudePath)) ?? request.claudePath;
    const result = await run(command, claudeArgs(request), { stdin: request.prompt, timeoutMs: request.timeoutMs });
    if (result.code !== 0 && result.stdout.trim() === "") {
      throw new Error(`claude exited with ${result.code ?? "a signal"}: ${result.stderr.trim().slice(0, 500) || "no output"}`);
    }
    const parsed = parseResult(result.stdout);
    if (parsed.isError) throw new Error(`claude could not answer: ${parsed.result.slice(0, 500) || result.stderr.trim().slice(0, 500)}`);
    return parsed.result;
  };
}
