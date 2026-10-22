import { describe, expect, it } from "vitest";
import { complete, describeOptions, parseCommand } from "./commands";

describe("parseCommand", () => {
  it("reads playback commands", () => {
    expect(parseCommand(":play deep work")).toEqual({ kind: "play", playlist: "deep work" });
    expect(parseCommand("play")).toEqual({ kind: "play", playlist: null });
    expect(parseCommand(":vol 60")).toEqual({ kind: "volume", percent: 60 });
    expect(parseCommand(":seek 1:23")).toEqual({ kind: "seek", ms: 83_000 });
    expect(parseCommand(":seek 90")).toEqual({ kind: "seek", ms: 90_000 });
    expect(parseCommand(":repeat one")).toEqual({ kind: "repeat", state: "track" });
  });

  it("reads smart shuffle flags and a quoted vibe", () => {
    expect(parseCommand(':shuffle vibe "start mellow, end euphoric" --spread --fresh 14d --no-skips')).toEqual({
      kind: "shuffle",
      patch: { vibe: "start mellow, end euphoric", spread: true, fresh: true, freshDays: 14, noSkips: true },
    });
    expect(parseCommand(":shuffle plain")).toEqual({ kind: "shuffle", patch: { spread: false, fresh: false, noSkips: false, vibe: null } });
    expect(parseCommand(":vibe rainy sunday")).toEqual({ kind: "shuffle", patch: { vibe: "rainy sunday" } });
  });

  it("explains bad input", () => {
    expect(parseCommand(":vol loud")).toEqual({ error: "vol takes a number from 0 to 100" });
    expect(parseCommand(":shuffle --wat")).toEqual({ error: "shuffle does not know --wat" });
    expect(parseCommand(":dance")).toEqual({ error: "not a command: dance" });
  });
});

describe("complete", () => {
  it("suggests the first command that extends the input", () => {
    expect(complete(":sh")).toBe("shuffle --spread --fresh 30d --no-skips");
    expect(complete(":share c")).toBe("share card");
    expect(complete(":")).toBeNull();
  });
});

describe("describeOptions", () => {
  it("prints options the way :shuffle reads them", () => {
    const text = describeOptions({ sourceId: "p", spread: true, fresh: true, freshDays: 30, noSkips: false, vibe: "late night" });
    expect(text).toBe('vibe "late night" --spread --fresh 30d');
    expect(parseCommand(`:shuffle ${text}`)).toEqual({ kind: "shuffle", patch: { vibe: "late night", spread: true, fresh: true, freshDays: 30 } });
  });
});
