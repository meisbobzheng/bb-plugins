import { describe, expect, it } from "vitest";
import { createComplete, parseResult, type CommandRunner } from "./claude";

const request = { claudePath: "/opt/claude", model: "haiku", system: "Route it.", prompt: "Sections: …", timeoutMs: 1_000 };

function runner(result: { code: number | null; stdout: string; stderr?: string }) {
  const calls: { command: string; args: readonly string[]; stdin: string }[] = [];
  const run: CommandRunner = async (command, args, { stdin }) => {
    calls.push({ command, args, stdin });
    return { stderr: "", ...result };
  };
  return { run, calls };
}

describe("claude classifier", () => {
  it("runs claude in print mode with no tools, MCP servers, skills, or saved session, and returns its answer", async () => {
    const { run, calls } = runner({ code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", result: "reviews\nhss" }) });
    await expect(createComplete(run)(request)).resolves.toBe("reviews\nhss");
    expect(calls).toEqual([
      {
        command: "/opt/claude",
        args: ["-p", "--output-format", "json", "--model", "haiku", "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--system-prompt", "Route it."],
        stdin: "Sections: …",
      },
    ]);
  });

  it("reports a claude that exits without output", async () => {
    const { run } = runner({ code: 1, stdout: "", stderr: "Not logged in" });
    await expect(createComplete(run)(request)).rejects.toThrow("claude exited with 1: Not logged in");
  });

  it("reports an error result", async () => {
    const { run } = runner({ code: 0, stdout: JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, result: "" }) });
    await expect(createComplete(run)(request)).rejects.toThrow("claude could not answer");
  });

  it("finds the result line among other output", () => {
    expect(parseResult(`warning\n${JSON.stringify({ type: "result", subtype: "success", result: "other" })}\n`)).toEqual({ result: "other", isError: false });
    expect(() => parseResult("")).toThrow("claude returned no result: (empty output)");
  });
});
