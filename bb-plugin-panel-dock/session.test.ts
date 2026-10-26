import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampRect, defaultRect, parseRect } from "./floating";
import { FAST_POLL_MS, HIDDEN_POLL_MS, IDLE_POLL_MS, startSession } from "./session";

type Output = { chunks: { seq: number; dataBase64: string }[]; nextSeq: number; status: string; exitCode: number | null };

function fakeSdk(outputs: Output[]) {
  const idle = (seq: number): Output => ({ chunks: [], nextSeq: seq, status: "running", exitCode: null });
  const output = vi.fn(async ({ sinceSeq }: { sinceSeq?: number }) => outputs.shift() ?? idle(sinceSeq ?? 0));
  const input = vi.fn(async (_args: { terminalId: string; dataBase64: string }) => ({}));
  const close = vi.fn(async () => ({}));
  return { sdk: { terminals: { output, input, close, resize: vi.fn(async () => ({})) } } as never, output, input, close };
}

const sink = () => ({ write: vi.fn(), exit: vi.fn() });
const decoded = (write: ReturnType<typeof vi.fn>) =>
  write.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes as Uint8Array)).join("");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("terminal session", () => {
  it("writes output in order and asks only for chunks it has not seen", async () => {
    const { sdk, output } = fakeSdk([
      { chunks: [{ seq: 1, dataBase64: btoa("$ ") }], nextSeq: 2, status: "running", exitCode: null },
      { chunks: [{ seq: 2, dataBase64: btoa("ok") }], nextSeq: 3, status: "running", exitCode: null },
    ]);
    const target = sink();
    const session = startSession(sdk, "term_1", target);

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 2);

    expect(decoded(target.write)).toBe("$ ok");
    expect(output.mock.calls.map(([args]) => args.sinceSeq)).toEqual([undefined, 2, 3]);
    session.dispose();
  });

  it("backs off while idle, slows further while hidden, and speeds up on input", async () => {
    const { sdk, output } = fakeSdk([]);
    const session = startSession(sdk, "term_1", sink());

    await vi.advanceTimersByTimeAsync(5_000);
    const idleCalls = output.mock.calls.length;
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 4);
    expect(output.mock.calls.length - idleCalls).toBe(4);

    session.setVisible(false);
    const hiddenStart = output.mock.calls.length;
    await vi.advanceTimersByTimeAsync(HIDDEN_POLL_MS * 3);
    expect(output.mock.calls.length - hiddenStart).toBeLessThanOrEqual(4);

    session.setVisible(true);
    session.send("x");
    const typed = output.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS);
    expect(output.mock.calls.length).toBeGreaterThan(typed);
    session.dispose();
  });

  it("sends input as UTF-8 base64 in the order it was typed", async () => {
    const { sdk, input } = fakeSdk([]);
    const session = startSession(sdk, "term_1", sink());

    session.send("é");
    session.send("\r");
    await vi.advanceTimersByTimeAsync(0);

    expect(input.mock.calls.map(([args]) => args)).toEqual([
      { terminalId: "term_1", dataBase64: "w6k=" },
      { terminalId: "term_1", dataBase64: "DQ==" },
    ]);
    session.dispose();
  });

  it("reports an exit and stops polling", async () => {
    const { sdk, output } = fakeSdk([{ chunks: [], nextSeq: 1, status: "exited", exitCode: 0 }]);
    const target = sink();
    startSession(sdk, "term_1", target);

    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 4);

    expect(target.exit).toHaveBeenCalledWith(0);
    expect(output).toHaveBeenCalledOnce();
  });

  it("kills the shell on close", async () => {
    const { sdk, output, close } = fakeSdk([]);
    const session = startSession(sdk, "term_1", sink());
    await session.close();
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 4);
    expect(close).toHaveBeenCalledWith({ terminalId: "term_1", mode: "force" });
    expect(output.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("floating window rect", () => {
  const viewport = { width: 1440, height: 900 };

  it("starts centered near the top", () => {
    expect(defaultRect(viewport)).toEqual({ left: 170, top: 108, width: 1100, height: 630 });
  });

  it("keeps a saved window on screen and at least its minimum size", () => {
    expect(clampRect({ left: 1400, top: -40, width: 100, height: 5000 }, viewport)).toEqual({
      left: 1080,
      top: 0,
      width: 360,
      height: 900,
    });
  });

  it("ignores a malformed saved rect", () => {
    expect(parseRect("{\"left\":1}")).toBeNull();
    expect(parseRect("nope")).toBeNull();
    expect(parseRect(null)).toBeNull();
    expect(parseRect("{\"left\":1,\"top\":2,\"width\":400,\"height\":300}")).toEqual({ left: 1, top: 2, width: 400, height: 300 });
  });
});
