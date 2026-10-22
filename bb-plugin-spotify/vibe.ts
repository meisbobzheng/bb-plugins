import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { Track } from "./contract";

export const VIBE_POOL = 250;

export const SYSTEM_PROMPT = [
  "You sequence songs into a listening session that matches a mood or arc the listener describes.",
  "Use what you know about each song and artist: energy, tempo, mood, and genre.",
  'Reply with only a JSON object: {"order":[{"i":<song number>,"note":"<four to six words on why it sits there>"}]}.',
  "Pick the 25 to 60 songs that fit best, in the order they should play, each number at most once.",
  "Use only song numbers from the list.",
].join(" ");

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[], options: { stdin: string; cwd: string; timeoutMs: number }) => Promise<CommandResult>;

export const spawnRunner: CommandRunner = (command, args, { stdin, cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
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

const minutes = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

export function buildMessage(vibe: string, pool: readonly Track[]): string {
  const lines = pool.map((track, index) => {
    const album = track.album.year === null ? track.album.name : `${track.album.name}, ${track.album.year}`;
    return `${index + 1}. ${track.name} — ${track.artists.map((artist) => artist.name).join(", ")} (${album}, ${minutes(track.durationMs)})`;
  });
  return [`The listener wants: ${vibe}`, "", "Songs:", ...lines].join("\n");
}

const resultLine = z.object({ type: z.literal("result"), result: z.string().optional(), is_error: z.boolean().optional(), subtype: z.string().optional() });
const orderSchema = z.object({ order: z.array(z.object({ i: z.number().int(), note: z.string().optional() })) });

export function parseOrder(text: string, poolSize: number): { index: number; note: string | null }[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("claude did not return a song order.");
  const parsed = orderSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
  if (!parsed.success) throw new Error("claude returned an order in the wrong shape.");
  const order = parsed.data.order.filter((entry) => entry.i >= 1 && entry.i <= poolSize).map((entry) => ({ index: entry.i - 1, note: entry.note?.trim().slice(0, 60) || null }));
  if (order.length === 0) throw new Error("claude picked no songs for that vibe.");
  return order;
}

export function resultText(stdout: string): string {
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = resultLine.safeParse(json);
    if (!parsed.success) continue;
    if (parsed.data.is_error === true || (parsed.data.subtype !== undefined && parsed.data.subtype !== "success")) {
      throw new Error(`claude could not answer: ${(parsed.data.result ?? "").slice(0, 300)}`);
    }
    return parsed.data.result ?? "";
  }
  throw new Error(`claude returned no result: ${stdout.trim().slice(0, 300) || "(empty output)"}`);
}

export async function orderByVibe(options: {
  vibe: string;
  pool: readonly Track[];
  claudePath: string;
  model: string;
  run?: CommandRunner;
  timeoutMs?: number;
}): Promise<{ index: number; note: string | null }[]> {
  const run = options.run ?? spawnRunner;
  const args = ["-p", "--output-format", "json", "--model", options.model, "--tools", "", "--no-session-persistence", "--system-prompt", SYSTEM_PROMPT];
  const result = await run(options.claudePath, args, { stdin: buildMessage(options.vibe, options.pool), cwd: tmpdir(), timeoutMs: options.timeoutMs ?? 120_000 });
  if (result.code !== 0 && result.stdout.trim() === "") throw new Error(`claude exited with ${result.code ?? "a signal"}: ${result.stderr.trim().slice(0, 300) || "no output"}`);
  return parseOrder(resultText(result.stdout), options.pool.length);
}
