import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerAgentSurfaces } from "./agent.js";
import { CHANGED_CHANNEL, LIMITS, rpcContract, type ChangedKind } from "./contract.js";
import { ServiceError, createService } from "./service.js";
import { createStore } from "./store.js";

export { rpcContract };

const FALLBACK_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", path.join(homedir(), ".local", "bin"), path.join(homedir(), ".claude", "local")];

const executable = (candidate: string) => access(candidate, constants.X_OK).then(() => candidate, () => null);

export async function resolveCommand(command: string): Promise<string | null> {
  if (command.includes(path.sep)) return executable(command);
  const directories = [...(process.env.PATH ?? "").split(path.delimiter).filter((directory) => directory !== ""), ...FALLBACK_BIN_DIRS];
  for (const directory of directories) {
    const found = await executable(path.join(directory, command));
    if (found !== null) return found;
  }
  return null;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    maxRows: {
      type: "number",
      label: "Rows fetched per result",
      default: 500,
      experimental_schema: z.number().int().min(1).max(LIMITS.maxRows),
    },
    statementTimeoutSeconds: {
      type: "number",
      label: "Statement timeout (seconds, 0 for none)",
      default: 60,
      experimental_schema: z.number().int().min(0).max(3600),
    },
    askModel: { type: "string", label: "Model for plain-language requests (claude --model)", default: "sonnet" },
    claudePath: { type: "string", label: "claude CLI path", default: "claude" },
  });

  const store = createStore(bb.storage);
  const service = createService({
    store,
    async settings() {
      const current = await settings.get();
      return { ...current, claudePath: (await resolveCommand(current.claudePath)) ?? current.claudePath };
    },
    publish: (kind: ChangedKind) => bb.realtime.publish(CHANGED_CHANNEL, { kind }),
    log: (message) => bb.log.warn(message),
    commandExists: async (command) => (await resolveCommand(command)) !== null,
  });

  const rethrow = (error: unknown): never => {
    if (error instanceof ServiceError) throw new Error(error.hint === null ? error.message : `${error.message} ${error.hint}`);
    throw error;
  };
  const connection = (id: string) => {
    const found = store.getConnection(id);
    if (found === null) throw new Error(`No connection ${id}.`);
    return found;
  };

  bb.rpc.register(rpcContract, {
    connections_list: () => service.connections(),
    connections_save: (input) => service.saveConnection(input),
    connections_delete: async ({ id }) => ({ removed: await service.deleteConnection(id) }),
    connections_test: (input) => service.testConnection(input),
    connections_activate: async ({ id }) => ({ activeId: await service.activate(id).catch(rethrow) }),
    connections_set_writes: ({ id, allowWrites }) => service.setWrites(id, allowWrites),
    connections_set_database: ({ id, database }) => service.setDatabase(id, database),
    databases_list: async ({ connectionId }) => ({ databases: await service.databases(connection(connectionId)).catch(rethrow) }),
    schema_get: ({ connectionId, refresh }) => service.schema(connection(connectionId), refresh).catch(rethrow),
    query_run: ({ connectionId, sql, maxRows, queryId }) => service.run(connection(connectionId), sql, { source: "editor", maxRows, queryId }).catch(rethrow),
    query_cancel: async ({ queryId }) => ({ cancelled: await service.cancel(queryId) }),
    query_explain: ({ connectionId, sql, analyze }) => service.explain(connection(connectionId), sql, analyze).catch(rethrow),
    ask: ({ connectionId, prompt, currentSql, run }) => service.ask(connection(connectionId), prompt, currentSql, run).catch(rethrow),
    history_list: ({ connectionId, query, limit }) => ({ entries: service.history({ connectionId, query, limit }) }),
    history_clear: ({ connectionId }) => ({ removed: service.clearHistory(connectionId) }),
    saved_list: ({ connectionId }) => ({ queries: service.listSaved(connectionId) }),
    saved_save: (input) => service.saveQuery(input),
    saved_delete: ({ id }) => ({ removed: service.deleteSaved(id) }),
    status: () => service.status(),
  });

  registerAgentSurfaces(bb, service);

  bb.onDispose(() => service.dispose());
}
