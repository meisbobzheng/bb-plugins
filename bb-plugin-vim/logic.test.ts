import { describe, expect, it } from "vitest";
import { COMMANDS, keymapFor, resolve } from "./vim/bindings";
import { hintLabels, typeHint } from "./vim/hints";
import { formatKeys, keyToken, parseKeys, type KeyLike } from "./vim/keys";
import { comparePosition, coverage, inViewport, nearestTo } from "./vim/layout";

const key = (value: string, modifiers: Partial<KeyLike> = {}): KeyLike => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("keyToken", () => {
  it("names printable, named, and Ctrl keys", () => {
    expect(keyToken(key("j"))).toBe("j");
    expect(keyToken(key("G", { shiftKey: true }))).toBe("G");
    expect(keyToken(key("?", { shiftKey: true }))).toBe("?");
    expect(keyToken(key("Escape"))).toBe("<Esc>");
    expect(keyToken(key("Enter"))).toBe("<CR>");
    expect(keyToken(key("D", { ctrlKey: true, shiftKey: true }))).toBe("<C-d>");
    expect(keyToken(key("[", { ctrlKey: true }))).toBe("<C-[>");
  });

  it("ignores ⌘, Alt, and keys vim never binds", () => {
    expect(keyToken(key("k", { metaKey: true }))).toBeNull();
    expect(keyToken(key("j", { altKey: true }))).toBeNull();
    expect(keyToken(key("ArrowDown"))).toBeNull();
    expect(keyToken(key("Shift", { shiftKey: true }))).toBeNull();
  });
});

describe("parseKeys and formatKeys", () => {
  it("splits sequences into tokens and labels them for the cheat sheet", () => {
    expect(parseKeys("gT")).toEqual(["g", "T"]);
    expect(parseKeys("<C-d>")).toEqual(["<C-d>"]);
    expect(formatKeys("<C-d>")).toBe("Ctrl+D");
    expect(formatKeys("<CR>")).toBe("Enter");
    expect(formatKeys("gg")).toBe("gg");
  });
});

describe("keymap", () => {
  it("never makes a complete binding the prefix of another", () => {
    for (const mac of [true, false]) {
      const keymap = keymapFor(mac);
      for (const binding of keymap) {
        const longer = keymap.filter((other) => other.keys.length > binding.keys.length && binding.keys.every((token, index) => other.keys[index] === token));
        expect(longer, binding.keys.join("")).toEqual([]);
      }
    }
  });

  it("binds every sequence once", () => {
    for (const mac of [true, false]) {
      const sequences = keymapFor(mac).map((binding) => binding.keys.join(" "));
      expect(new Set(sequences).size).toBe(sequences.length);
    }
  });

  it("adds the Ctrl variants only on macOS, where Ctrl is not bb's command modifier", () => {
    expect(keymapFor(true).some((binding) => binding.keys[0] === "<C-d>")).toBe(true);
    expect(keymapFor(false).some((binding) => binding.keys[0]?.startsWith("<C-"))).toBe(false);
  });

  it("stays clear of digits, which answer bb's question forms", () => {
    const tokens = COMMANDS.flatMap((command) => [...command.keys, ...(command.macKeys ?? [])].flatMap(parseKeys));
    expect(tokens.filter((token) => /^\d$/u.test(token))).toEqual([]);
  });
});

describe("resolve", () => {
  const keymap = keymapFor(false);

  it("runs single keys and waits on prefixes", () => {
    expect(resolve(keymap, [], "j")).toEqual({ kind: "run", action: "down" });
    expect(resolve(keymap, [], "g")).toEqual({ kind: "pending", keys: ["g"] });
    expect(resolve(keymap, ["g"], "g")).toEqual({ kind: "run", action: "top" });
    expect(resolve(keymap, ["g"], "T")).toEqual({ kind: "run", action: "previousThread" });
  });

  it("drops a broken sequence and reads the key on its own", () => {
    expect(resolve(keymap, ["g"], "j")).toEqual({ kind: "run", action: "down" });
    expect(resolve(keymap, ["g"], "x")).toEqual({ kind: "none" });
    expect(resolve(keymap, [], "x")).toEqual({ kind: "none" });
  });
});

describe("hints", () => {
  it("gives as many hints as it can one letter, and never starts a label with another", () => {
    expect(hintLabels(3, "ab")).toEqual(["b", "aa", "ab"]);
    expect(hintLabels(2, "abc")).toEqual(["a", "b"]);
    expect(hintLabels(0)).toEqual([]);
    expect(hintLabels(20).filter((label) => label.length === 1)).toHaveLength(13);
    const labels = hintLabels(200);
    expect(new Set(labels).size).toBe(200);
    expect(labels.filter((label) => label.length === 2)).toHaveLength(195);
    expect(labels.filter((label) => labels.some((other) => other !== label && other.startsWith(label)))).toEqual([]);
  });

  it("narrows by typed characters and picks a unique match", () => {
    const labels = ["aa", "ba", "ab"];
    expect(typeHint(labels, "", "a")).toEqual({ typed: "a", chosen: null });
    expect(typeHint(labels, "a", "B")).toEqual({ typed: "ab", chosen: 2 });
    expect(typeHint(labels, "", "b")).toEqual({ typed: "b", chosen: 1 });
    expect(typeHint(labels, "a", "z")).toEqual({ typed: "a", chosen: null });
  });
});

describe("layout", () => {
  const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

  it("orders panes left to right, then top to bottom", () => {
    const panes = [box(300, 0, 100, 100), box(0, 400, 100, 100), box(4, 0, 100, 100)];
    expect([...panes].sort(comparePosition)).toEqual([panes[2], panes[1], panes[0]]);
  });

  it("measures how much of a pane its child panes cover", () => {
    expect(coverage(box(0, 0, 100, 100), [box(0, 0, 50, 100)])).toBe(0.5);
    expect(coverage(box(0, 0, 100, 100), [box(90, 0, 50, 100)])).toBe(0.1);
    expect(coverage(box(0, 0, 0, 0), [])).toBe(1);
  });

  it("finds the box nearest a vertical position", () => {
    const boxes = [box(0, 0, 10, 10), box(0, 100, 10, 10), box(0, 200, 10, 10)];
    expect(nearestTo(boxes, 120)).toBe(1);
    expect(nearestTo(boxes, 1000)).toBe(2);
    expect(nearestTo([], 0)).toBe(-1);
  });

  it("knows when a box is on screen", () => {
    expect(inViewport(box(10, 10, 10, 10), 100, 100)).toBe(true);
    expect(inViewport(box(0, 120, 10, 10), 100, 100)).toBe(false);
    expect(inViewport(box(0, 0, 0, 10), 100, 100)).toBe(false);
  });
});
