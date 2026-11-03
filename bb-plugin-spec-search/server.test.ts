import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOG_SPECS } from "./catalog";
import { SPEC_29228, makeZip } from "./fixtures";
import { folderUrl } from "./ftp";
import { CLAUSE_TOOL, FETCH_TOOL, IDENTIFY_TOOL, SEARCH_TOOL, specSearch } from "./server";

const ARCHIVE = makeZip({ "29228-j20.docx": SPEC_29228, "CxData_Type_Rel19.xsd": "<xsd/>" });
const LISTING = `<a href="${folderUrl(19, "29")}29228-j10.zip">29228-j10.zip</a> <a href="${folderUrl(19, "29")}29228-j20.zip">29228-j20.zip</a>`;

type Route = () => Response;

function fakeFtp(routes: Record<string, Route>) {
  const requested: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    return routes[url]?.() ?? new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, requested };
}

const ftpRoutes: Record<string, Route> = {
  [folderUrl(19, "29")]: () => new Response(LISTING),
  [`${folderUrl(19, "29")}29228-j20.zip`]: () => new Response(ARCHIVE),
};

const running: AbortController[] = [];
afterEach(() => running.splice(0).forEach((controller) => controller.abort()));

async function setup({ routes = ftpRoutes, seeded = true } = {}) {
  const ftp = fakeFtp(routes);
  const { bb, harness } = createFakePluginHost({ pluginId: "spec-search" });
  if (seeded) await bb.storage.kv.set("seeded", true);
  await specSearch({ fetch: ftp.fetch })(bb);
  const start = () => running.push(harness.behavior.runService("ingest").controller);
  const tool = async (name: string, input: unknown) => {
    const result = await harness.behavior.callAgentTool(name, input);
    return typeof result === "string" ? result : (result as { content: Array<{ text: string }> }).content.map((part) => part.text).join("");
  };
  const cli = (...argv: string[]) => harness.behavior.runCli(argv);
  return { harness, ftp, start, tool, cli };
}

describe("spec search plugin", () => {
  it("queues the starter catalog once, on first load", async () => {
    const { cli } = await setup({ seeded: false });
    const jobs = JSON.parse((await cli("jobs", "--json", "--limit", "100")).stdout ?? "") as Array<{ target: string; status: string }>;
    expect(jobs.map(({ target }) => target).sort()).toEqual([...CATALOG_SPECS].sort());
    expect(jobs.every(({ status }) => status === "queued")).toBe(true);
  });

  it("fetches the newest Rel-19 version and answers clause lookups through the tools", async () => {
    const { start, tool, ftp } = await setup();
    expect(await tool(SEARCH_TOOL, { query: "29.228 B.1" })).toContain("No specs are indexed yet.");
    start();
    expect(await tool(FETCH_TOOL, { specs: ["TS 29.228"] })).toBe("Indexed TS 29.228 V19.2.0: 7 clauses.");
    expect(ftp.requested).toEqual([folderUrl(19, "29"), `${folderUrl(19, "29")}29228-j20.zip`]);

    const found = await tool(SEARCH_TOOL, { query: "29.228 B.1" });
    expect(found.split("\n")[0]).toBe("TS 29.228 §B.1 General description (V19.2.0, clause)");
    expect(await tool(SEARCH_TOOL, { query: "" })).toContain("TS 29.228\tV19.2.0\t7 clauses\tIP Multimedia (IM) Subsystem Cx and Dx interfaces");
    expect(await tool(SEARCH_TOOL, { query: "29.272 7.3.2" })).toContain(`29.272 is not indexed. Call ${FETCH_TOOL}`);

    const clause = await tool(CLAUSE_TOOL, { spec: "29.228", clause: "b.2" });
    expect(clause).toContain("# TS 29.228 §B.2 Service profile");
    expect(clause).toContain("Parent: §B Annex B (informative): User profile UML model");
    expect(clause).toContain("- §B.2.1 Public Identification");

    expect(await tool(IDENTIFY_TOOL, { text: "the public user identities associated with the service profile" })).toMatch(/^TS 29\.228 §B\.2\.1 Public Identification \(V19\.2\.0\): 100% /);
    expect(await tool(FETCH_TOOL, { specs: ["29.228"] })).toBe("TS 29.228 V19.2.0 is already indexed.");
  });

  it("serves the same lookups from the CLI", async () => {
    const { start, cli } = await setup();
    start();
    expect((await cli("fetch", "29.228", "--wait")).stdout).toMatch(/^\d+\tdone\tfetch 29\.228 \(Rel-19\)\tIndexed TS 29\.228 V19\.2\.0: 7 clauses\.\n$/);
    expect((await cli("show", "29.228", "B.1")).stdout).toContain("UML model of the user profile");
    expect((await cli("show", "TS", "29.228")).stdout).toBe(
      "TS 29.228 V19.2.0: IP Multimedia (IM) Subsystem Cx and Dx interfaces; Signalling flows and message contents\n  §Foreword Foreword\n  §6 User identity to HSS resolution\n  §B Annex B (informative): User profile UML model\n",
    );
    expect((await cli("search", "public", "identification", "--spec", "29.228")).stdout).toContain("TS 29.228 §B.2.1 Public Identification");
    expect((await cli("catalog")).stdout).toContain("  29.228\tV19.2.0\tCx/Dx signalling flows and message contents");

    const missing = await cli("show", "29.272", "7.3.2");
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain("29.272 is not indexed.");
    expect((await cli("remove", "29.228")).stdout).toBe("Removed 29.228.\n");
  });

  it("indexes a local .docx and reads its spec and version from the cover", async () => {
    const { harness, start, cli } = await setup();
    const dir = mkdtempSync(join(tmpdir(), "spec-search-test-"));
    writeFileSync(join(dir, "cx.docx"), SPEC_29228);
    start();
    const added = await harness.behavior.runCli(["add", "cx.docx", "--wait", "--json"], { cwd: dir });
    expect(JSON.parse(added.stdout ?? "")).toMatchObject([{ status: "done", note: "Indexed TS 29.228 V19.2.0 from cx.docx: 7 clauses." }]);
    expect((await cli("list")).stdout).toBe("TS 29.228\tV19.2.0\t7 clauses\tIP Multimedia (IM) Subsystem Cx and Dx interfaces; Signalling flows and message contents\n");
  });

  it("refuses to follow a redirect off www.3gpp.org", async () => {
    const { start, tool } = await setup({
      routes: { [folderUrl(19, "29")]: () => new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/listing" } }) },
    });
    start();
    expect(await tool(FETCH_TOOL, { specs: ["29.228"] })).toBe("Failed: Refusing to download from https://elsewhere.invalid; only https://www.3gpp.org is allowed.");
  });
});
