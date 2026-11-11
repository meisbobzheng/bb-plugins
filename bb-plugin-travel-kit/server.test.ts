import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { Overview } from "./contract";
import type { Runner } from "./runner";
import { createPlugin } from "./server";

async function setup(runner: Runner) {
  const home = await mkdtemp(path.join(tmpdir(), "travel-kit-server-"));
  const { bb, harness } = createFakePluginHost({ pluginId: "travel-kit" });
  await createPlugin({ runner, runnerPath: "/plugin/runner/travel-kit", home, open: async () => {} })(bb);
  return { harness, home };
}

describe("rpc", () => {
  it("starts as the main laptop with an empty profile", async () => {
    const { harness } = await setup(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const overview = (await harness.behavior.callRpc("overview", null)) as Overview;
    expect(overview).toMatchObject({ mode: "main", days: 7, profile: { excluded: [], classes: {} }, scan: null, job: null });
  });
});

describe("cli", () => {
  it("counts scanned items by kind", async () => {
    const { harness } = await setup(async () => ({ exitCode: 0, stdout: "formula\tjq\t1\t\nformula\tgh\t2\t\nrepo\thss\tmain\t\n", stderr: "" }));
    const result = await harness.behavior.runCli(["scan"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("   2  Homebrew");
    expect(result.stdout).toContain("   1  Repo");
  });

  it("waits for generate and prints where the kit went", async () => {
    const { harness } = await setup(async (_args, options) => {
      options?.onLine?.("› Kit ready");
      options?.onLine?.("::kit /tmp/kit.zip");
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const result = await harness.behavior.runCli(["generate"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("› Kit ready\nKit: /tmp/kit.zip\n");
  });

  it("prints the Terminal command for applying handbacks", async () => {
    const { harness } = await setup(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const result = await harness.behavior.runCli(["apply-command"]);
    expect(result.stdout).toBe("zsh '/plugin/runner/travel-kit' apply\n");
  });
});
