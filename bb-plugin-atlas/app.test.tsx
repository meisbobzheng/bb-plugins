// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { diagramFromSubPath } from "./components/AtlasPage";
import { routeBetween } from "./components/stage/Stage";
import { insideThumb, throughThumb, zoomFrame } from "./components/stage/geometry";
import type { Atlas, Problem, Snapshot } from "./contract";
import { buildAtlas } from "./model/build";
import { EXAMPLE_FILES } from "./model/example";
import { parseSource } from "./model/load";

let atlas: Atlas;

beforeAll(async () => {
  const problems: Problem[] = [];
  const files = Object.entries(EXAMPLE_FILES).map(([file, text]) => parseSource(file.replace(/\.yaml$/, ""), file, text, problems));
  atlas = (await buildAtlas(files)).atlas!;
});

afterEach(cleanup);

const ready = (problems: Problem[] = []): Snapshot => ({ status: "ready", directory: "/atlas", atlas, problems, loadedAt: "2026-11-07T00:00:00.000Z" });

async function open(subPath: string, snapshot: Snapshot = ready()) {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.navPanels[0]!, { subPath }, { rpc: { snapshot: () => snapshot } });
  const node = (id: string) => slot.container.querySelector(`[data-id="${id}"]`) as SVGGElement;
  await waitFor(() => expect(slot.container.querySelector(".atlas-node")).not.toBeNull());
  return { slot, node };
}

describe("Atlas app", () => {
  it("registers the Atlas page", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.navPanels.map(({ path, title }) => [path, title])).toEqual([["atlas", "Atlas"]]);
  });

  it("offers to create an example atlas when no folder is set", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const calls: unknown[] = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: {
        snapshot: () => ({ status: "unconfigured", directory: "", atlas: null, problems: [], loadedAt: null }),
        createExample: (input: unknown) => (calls.push(input), ready()),
      },
    });
    fireEvent.click(await slot.findByRole("button", { name: "Create an example atlas" }));
    await waitFor(() => expect(slot.container.querySelector('[data-id="epc"]')).not.toBeNull());
    expect(calls).toEqual([{ directory: "~/atlas" }]);
  });

  it("shows the top-level diagram and zooms into a system on click", async () => {
    const { slot, node } = await open("");
    expect(slot.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Mobile Core");
    expect(slot.getByRole("heading", { name: "Mobile Core" })).toBeTruthy();
    expect(node("epc").textContent).toContain("5 inside · open ↘");
    fireEvent.click(node("epc"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "atlas", options: { subPath: "epc" } }]);
  });

  it("opens a deep link and travels through a reference to the system it points at", async () => {
    const { slot, node } = await open("epc");
    expect(slot.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Mobile Core›EPC");
    fireEvent.click(node("bss"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "atlas", options: { subPath: "bss" } }]);
  });

  it("documents a connection with what it rolls up and the paths it rides", async () => {
    const { slot } = await open("");
    fireEvent.click(slot.getByRole("button", { name: /S1-MME · S1-U/ }));
    expect(await slot.findByRole("heading", { name: "S1-MME · S1-U" })).toBeTruthy();
    expect(slot.getByText("Made of")).toBeTruthy();
    expect(slot.getAllByText("S1-U").length).toBeGreaterThan(0);
  });

  it("drafts an unmapped system with an agent", async () => {
    const { slot, node } = await open("");
    fireEvent.click(node("ims"));
    fireEvent.click(await slot.findByRole("button", { name: "✦ Draft IMS with an agent" }));
    const [call] = slot.inspection.navigateCalls as Array<{ method: string; options: { initialPrompt: string; focusPrompt: boolean } }>;
    expect(call?.method).toBe("toCompose");
    expect(call?.options.initialPrompt).toContain("Map the IMS system into my Atlas in /atlas.");
    expect(call?.options.initialPrompt).toContain("Write ims.yaml");
    expect(call?.options.initialPrompt).toContain("add `open: ims` to `ims` in index.yaml");
  });

  it("lists problems with their file and line", async () => {
    const { slot } = await open("", ready([{ severity: "error", file: "epc.yaml", line: 12, message: 'No node "hsss" in this diagram.' }]));
    fireEvent.click(slot.getByRole("button", { name: "1 problem" }));
    expect(await slot.findByText("epc.yaml:12 · error")).toBeTruthy();
    expect(slot.getByText('No node "hsss" in this diagram.')).toBeTruthy();
  });

  it("offers the deployment lens only where nodes are placed", async () => {
    const { slot } = await open("epc");
    expect(slot.getByRole("group", { name: "Lens" })).toBeTruthy();
    expect(slot.container.querySelectorAll(".atlas-trunk")).toHaveLength(2);
  });
});

describe("navigation helpers", () => {
  it("decodes a panel sub-path into a diagram id", () => {
    expect(diagramFromSubPath("")).toBe("");
    expect(diagramFromSubPath("epc/hss")).toBe("epc/hss");
    expect(diagramFromSubPath("my%20system/sub")).toBe("my system/sub");
  });

  it("routes between diagrams by zooming out to the shared ancestor and back in", () => {
    expect(routeBetween(atlas, "epc/hss", "bss")).toEqual([
      { kind: "out", diagram: "epc", via: "hss" },
      { kind: "out", diagram: "index", via: "epc" },
      { kind: "in", diagram: "bss", via: "bss" },
    ]);
    expect(routeBetween(atlas, "index", "epc/hss")).toEqual([
      { kind: "in", diagram: "epc", via: "epc" },
      { kind: "in", diagram: "epc/hss", via: "hss" },
    ]);
  });

  it("maps a thumbnail onto the stage and back", () => {
    const frame = zoomFrame({ x: 110, y: 60, w: 200, h: 125 }, { x: 10, y: 10, w: 800, h: 500 });
    expect(frame).toEqual({ fx: 0.125, fy: 0.1, fw: 0.25 });
    expect(insideThumb(frame)).toBe("translate(12.5%, 10%) scale(0.25)");
    expect(throughThumb(frame)).toBe("translate(-50%, -40%) scale(4)");
  });
});
