import { describe, expect, it } from "vitest";
import { buildMessage, orderByVibe, parseOrder, SYSTEM_PROMPT, type CommandRunner } from "./vibe";
import { track } from "./test/fake-spotify";

describe("parseOrder", () => {
  it("reads the JSON object out of surrounding prose and converts to zero-based indexes", () => {
    expect(parseOrder('Here you go:\n{"order":[{"i":2,"note":"slow start"},{"i":1}]}\nEnjoy', 3)).toEqual([
      { index: 1, note: "slow start" },
      { index: 0, note: null },
    ]);
  });

  it("rejects an answer with no usable songs", () => {
    expect(() => parseOrder('{"order":[{"i":9}]}', 3)).toThrow("picked no songs");
    expect(() => parseOrder("I can't help with that", 3)).toThrow("did not return");
  });
});

describe("orderByVibe", () => {
  it("runs claude without tools and passes the numbered songs on stdin", async () => {
    const calls: { command: string; args: readonly string[]; stdin: string }[] = [];
    const run: CommandRunner = async (command, args, { stdin }) => {
      calls.push({ command, args, stdin });
      return { code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", result: '{"order":[{"i":2,"note":"lift"}]}' }), stderr: "" };
    };
    const pool = [track("a", { name: "Kerala", artist: "Bonobo" }), track("b", { name: "Gosh", artist: "Jamie xx" })];
    const order = await orderByVibe({ vibe: "start mellow, end euphoric", pool, claudePath: "/bin/claude", model: "sonnet", run });
    expect(order).toEqual([{ index: 1, note: "lift" }]);
    expect(calls[0]!.command).toBe("/bin/claude");
    expect(calls[0]!.args).toEqual(["-p", "--output-format", "json", "--model", "sonnet", "--tools", "", "--no-session-persistence", "--system-prompt", SYSTEM_PROMPT]);
    expect(calls[0]!.stdin).toBe(buildMessage("start mellow, end euphoric", pool));
    expect(calls[0]!.stdin).toContain("2. Gosh — Jamie xx (Album b, 2015, 3:20)");
  });

  it("surfaces a claude error result", async () => {
    const run: CommandRunner = async () => ({ code: 1, stdout: JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "overloaded" }), stderr: "" });
    await expect(orderByVibe({ vibe: "x", pool: [track("a")], claudePath: "claude", model: "sonnet", run })).rejects.toThrow("overloaded");
  });
});
