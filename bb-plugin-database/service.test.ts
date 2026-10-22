import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { Asker } from "./ask";
import type { ChangedKind } from "./channel";
import type { Connection } from "./contract";
import { createService, type Service } from "./service";
import { createStore } from "./store";

const url = process.env.BB_DATABASE_TEST_URL;
const target = url === undefined ? null : new URL(url);

describe.skipIf(target === null)("plain-language requests", () => {
  const replies: string[] = [];
  const requests: Array<{ prompt: string; previous: { sql: string; error: string } | null }> = [];
  const asker: Asker = {
    async complete(request) {
      requests.push({ prompt: request.prompt, previous: request.previous });
      return { text: replies.shift() ?? "", costUsd: 0.001, model: "claude-sonnet-5", durationMs: 5 };
    },
  };
  const published: ChangedKind[] = [];
  let service: Service;
  let connection: Connection;

  beforeAll(async () => {
    const { bb } = createFakePluginHost({ pluginId: "database" });
    service = createService({
      store: createStore(bb.storage),
      settings: async () => ({ maxRows: 100, statementTimeoutSeconds: 10, askModel: "sonnet", claudePath: "claude" }),
      publish: (kind) => published.push(kind),
      log: () => undefined,
      asker,
      profiles: async () => [],
    });
    connection = service.saveConnection({
      name: "local",
      host: target!.hostname,
      port: Number(target!.port || 5432),
      database: target!.pathname.slice(1),
      user: target!.username,
      userFollowsDatabase: false,
      auth: { kind: "password" },
      ssl: false,
      password: target!.password || "unused",
    });
  });

  afterAll(async () => {
    await service.dispose();
  });

  it("runs read-only SQL it generated and records the prompt", async () => {
    replies.push("```sql\nselect count(*) as plans from plans\n```\nCounts the plans.");
    const result = await service.ask(connection, "how many plans are there", null, true);
    expect(result).toMatchObject({ sql: "select count(*) as plans from plans", explanation: "Counts the plans.", readOnly: true, attempts: 1, costUsd: 0.001 });
    expect(result.run?.results[0]?.rows).toEqual([["3"]]);
    expect(service.history({ connectionId: connection.id, query: "", limit: 1 })[0]).toMatchObject({ source: "ask", prompt: "how many plans are there" });
  });

  it("retries once with the error when the first statement fails", async () => {
    replies.push("```sql\nselect nope from plans\n```", "```sql\nselect name from plans order by name limit 1\n```");
    const result = await service.ask(connection, "first plan by name", null, true);
    expect(result.attempts).toBe(2);
    expect(requests.at(-1)?.previous).toMatchObject({ sql: "select nope from plans" });
    expect(result.run?.results[0]?.rows).toEqual([["Basic"]]);
  });

  it("shows but never runs statements that write", async () => {
    replies.push("```sql\ndelete from plans where id = 1\n```\nRemoves the plan.");
    const result = await service.ask(connection, "delete plan 1", null, true);
    expect(result).toMatchObject({ readOnly: false, run: null });
    const { results } = await service.run(connection, "select count(*) from plans", { source: "editor" });
    expect(results[0]?.rows).toEqual([["3"]]);
  });

  it("fails clearly when claude returns prose", async () => {
    replies.push("I need more detail about which plans you mean.");
    await expect(service.ask(connection, "plans?", null, true)).rejects.toThrow(/more detail/);
  });

  it("publishes history changes", () => {
    expect(published).toContain("history");
  });
});
