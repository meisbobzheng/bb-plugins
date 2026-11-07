import { describe, expect, it } from "vitest";
import type { Problem } from "../contract";
import { buildAtlas } from "./build";
import { EXAMPLE_FILES } from "./example";
import { ASPECT } from "./shape";
import { parseSource } from "./load";
import { resolveAtlas } from "./resolve";

function sources(files: Record<string, string>) {
  const problems: Problem[] = [];
  const parsed = Object.entries(files).map(([file, text]) => parseSource(file.replace(/\.ya?ml$/, ""), file, text, problems));
  return { parsed, problems };
}

function resolve(files: Record<string, string>) {
  const { parsed, problems } = sources(files);
  const resolved = resolveAtlas(parsed);
  return { ...resolved, problems: [...problems, ...resolved.problems] };
}

const diagram = (resolved: ReturnType<typeof resolve>, id: string) => resolved.diagrams.find((d) => d.id === id)!;
const edge = (resolved: ReturnType<typeof resolve>, id: string, label: string) => diagram(resolved, id).edges.find((e) => e.label === label);

describe("the example atlas", () => {
  it("resolves without problems", () => {
    expect(resolve(EXAMPLE_FILES).problems).toEqual([]);
  });

  it("rolls child connections up to the level above", () => {
    const atlas = resolve(EXAMPLE_FILES);
    const index = diagram(atlas, "index");
    const rolled = index.edges.filter((e) => e.derived).map((e) => [e.a, e.b, e.label]);
    expect(rolled).toEqual(
      expect.arrayContaining([
        ["ran", "epc", "S1-MME · S1-U"],
        ["epc", "inet", "SGi"],
        ["epc", "ims", "Cx"],
        ["epc", "bss", "Gy · Provisioning"],
      ]),
    );
    expect(edge(atlas, "index", "S1-MME · S1-U")?.parts).toEqual([
      { label: "S1-MME", a: "MME", b: "RAN", plane: "control" },
      { label: "S1-U", a: "SGW", b: "RAN", plane: "user" },
    ]);
    expect(edge(atlas, "index", "S1-MME · S1-U")?.plane).toBe("user");
  });

  it("keeps an explicit connection and records what rolled into it", () => {
    const atlas = resolve(EXAMPLE_FILES);
    const s6a = edge(atlas, "epc", "S6a");
    expect(s6a?.derived).toBe(false);
    expect(s6a?.parts).toEqual([{ label: "S6a", a: "diameter-edge", b: "MME", plane: "control" }]);
  });

  it("links each diagram to the node that opens it", () => {
    const atlas = resolve(EXAMPLE_FILES);
    expect(diagram(atlas, "epc/hss").parent).toEqual({ diagram: "epc", node: "hss" });
    expect(diagram(atlas, "index").nodes.find((n) => n.id === "ims")?.draft).toBe(true);
  });

  it("finds the network paths each connection rides", () => {
    const atlas = resolve(EXAMPLE_FILES);
    expect(edge(atlas, "epc", "S1-MME")?.rides).toEqual(["backhaul", "dx"]);
    expect(edge(atlas, "epc", "S1-U")?.rides).toEqual(["backhaul"]);
    expect(edge(atlas, "epc", "S11")?.rides).toEqual(["dx"]);
    expect(edge(atlas, "epc", "Gy")?.rides).toEqual(["dx"]);
    expect(edge(atlas, "epc", "S5")?.rides).toEqual([]);
    expect(edge(atlas, "epc", "S6a")?.rides).toEqual([]);
    expect(edge(atlas, "epc", "SGi")?.rides).toEqual([]);
  });

  it("inherits placement and labels through references", () => {
    const atlas = resolve(EXAMPLE_FILES);
    const bss = diagram(atlas, "epc").nodes.find((n) => n.id === "bss");
    expect(bss).toMatchObject({ kind: "ref", label: "BSS", sub: "↗ Mobile Core", place: "ns-bss", ref: { diagram: "index", node: "bss" } });
  });

  it("parses flows against connections, including rolled-up ones", () => {
    const atlas = resolve(EXAMPLE_FILES);
    const flow = diagram(atlas, "index").flows[0]!;
    expect(flow.name).toBe("Device comes online");
    expect(flow.steps).toHaveLength(7);
    expect(flow.steps[1]).toMatchObject({ from: "ran", to: "epc", edge: "ran~epc~rollup" });
  });

  it("lays out every diagram on a 16:10 canvas with a deployment view where nodes are placed", async () => {
    const { parsed } = sources(EXAMPLE_FILES);
    const { atlas, problems } = await buildAtlas(parsed);
    expect(problems).toEqual([]);
    const epc = atlas!.diagrams.epc!;
    expect(epc.logical.canvas.w / epc.logical.canvas.h).toBeCloseTo(ASPECT);
    expect(Object.keys(epc.logical.nodes).sort()).toEqual(epc.nodes.map((n) => n.id).sort());
    expect(epc.deployment?.containers.map((c) => c.id).sort()).toEqual(["aws", "eks", "ns-bss", "ns-epc", "ns-hss", "pop"]);
    expect(epc.deployment?.trunks.map((t) => t.id).sort()).toEqual(["backhaul", "dx"]);
    expect(atlas!.diagrams.index!.deployment).not.toBeNull();
  });
});

describe("problems", () => {
  const base = `title: T
nodes:
  a: {}
  b: {}
`;

  it("points at the line of a bad field", () => {
    const { problems } = resolve({ "index.yaml": `${base}  c:\n    lable: C\n` });
    expect(problems).toEqual([{ severity: "error", file: "index.yaml", line: 6, message: 'nodes.c: Unrecognized key: "lable"' }]);
  });

  it("explains a malformed connection and an unknown node", () => {
    const { problems } = resolve({ "index.yaml": `${base}edges:\n  - S6a: a to b\n  - S11: a -- z\n` });
    expect(problems.map((p) => [p.line, p.message])).toEqual([
      [6, "Write each connection as `- S6a: mme -- hss` (label: from -- to)."],
      [7, 'No node "z" in this diagram.'],
    ]);
  });

  it("reports a missing diagram, a bad reference, and an unknown place", () => {
    const { problems } = resolve({
      "index.yaml": `title: T\nnodes:\n  a: { open: nope }\n  b: { ref: index }\n  c: { runs-on: mars }\n`,
    });
    expect(problems.map((p) => p.message)).toEqual([
      'No diagram "nope". `open` takes a file path without .yaml, such as epc or epc/hss.',
      '"index" isn\'t a reference. Write diagram#node, such as index#ran or epc#mme.',
      'No place "mars" in infra.yaml. There is no infra.yaml yet.',
    ]);
  });

  it("warns when a connection crosses places with no network path", () => {
    const { problems } = resolve({
      "index.yaml": `title: T\nnodes:\n  a: { runs-on: x }\n  b: { runs-on: y }\nedges:\n  - S11: a -- b\n`,
      "infra.yaml": `places:\n  x: {}\n  y: {}\n`,
    });
    expect(problems).toEqual([
      { severity: "warning", file: "index.yaml", line: 6, message: "S11 (a ↔ b) runs from x to y, but no path in infra.yaml connects them." },
    ]);
  });

  it("asks for index.yaml and for an open on stray diagrams", () => {
    const { problems } = resolve({ "epc.yaml": base });
    expect(problems.map((p) => p.message)).toEqual(["No index.yaml. The atlas opens at index.yaml, so add one with the top-level diagram."]);
    const stray = resolve({ "index.yaml": base, "epc.yaml": base });
    expect(stray.problems.map((p) => p.message)).toEqual(['Nothing opens "epc". Add `open: epc` to the system node it describes.']);
  });

  it("skips a flow step with no connection", () => {
    const { problems, diagrams } = resolve({ "index.yaml": `${base}flows:\n  F:\n    - a -> b: hello\n` });
    expect(problems.map((p) => [p.severity, p.line])).toEqual([["warning", 7]]);
    expect(diagrams[0]!.flows[0]!.steps).toEqual([]);
  });

  it("warns that partial pins are ignored", async () => {
    const { parsed } = sources({ "index.yaml": `title: T\nnodes:\n  a: { at: [0, 0] }\n  b: {}\n` });
    const { problems } = await buildAtlas(parsed);
    expect(problems.map((p) => p.message)).toEqual(["Only 1 of 2 nodes have `at`, so the pins are ignored. Pin every node or none."]);
  });
});
