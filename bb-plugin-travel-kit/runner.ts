import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RunOptions = {
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type RunResult = { exitCode: number; stdout: string; stderr: string };

export type Runner = (args: string[], options?: RunOptions) => Promise<RunResult>;

export function findRunner(from = path.dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [path.join(from, "runner", "travel-kit"), path.join(from, "..", "runner", "travel-kit")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export function createRunner(script: string): Runner {
  return (args, { onLine, signal, timeoutMs } = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn("/bin/zsh", [script, ...args], { stdio: ["ignore", "pipe", "pipe"], signal });
      let stdout = "";
      let stderr = "";
      let pending = "";
      const timer = timeoutMs === undefined ? null : setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      const emit = (chunk: string) => {
        pending += chunk.replace(ANSI, "");
        const lines = pending.split(/\r?\n|\r/);
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim() !== "") onLine?.(line);
      };
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
        emit(chunk);
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
        emit(chunk);
      });
      child.on("error", (error) => {
        if (timer !== null) clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (timer !== null) clearTimeout(timer);
        if (pending.trim() !== "") onLine?.(pending);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
}
