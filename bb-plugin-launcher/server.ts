import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { EMPTY_STATE, STATE_CHANGED, recordUsage, type LauncherState } from "./model";

const STATE_KEY = "state";

const stateSchema = z.object({
  pinnedProjectIds: z.array(z.string()),
  usage: z.record(z.string(), z.object({ count: z.number().int().nonnegative(), lastUsedAt: z.number() })),
}) satisfies z.ZodType<LauncherState>;

export const rpcContract = defineRpcContract({
  state_get: {
    input: z.null(),
    output: stateSchema,
  },
  usage_record: {
    input: z.object({ key: z.string().min(1).max(200) }),
    output: stateSchema,
  },
  project_pin_set: {
    input: z.object({ projectId: z.string().min(1), pinned: z.boolean() }),
    output: stateSchema,
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    replaceShortcut: {
      type: "boolean",
      label: "Open with ⌘K",
      description: "Open the launcher with ⌘K (Ctrl+K elsewhere) instead of bb's quick palette.",
      default: true,
    },
    showPreview: {
      type: "boolean",
      label: "Show preview pane",
      description: "Show the selected thread, project, or plugin beside the results.",
      default: true,
    },
  });

  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<LauncherState> {
    const parsed = stateSchema.safeParse(await bb.storage.kv.get(STATE_KEY));
    return parsed.success ? parsed.data : EMPTY_STATE;
  }

  function update(change: (state: LauncherState) => LauncherState): Promise<LauncherState> {
    const next = queue.then(async () => {
      const state = change(await read());
      await bb.storage.kv.set(STATE_KEY, state);
      bb.realtime.publish(STATE_CHANGED, null);
      return state;
    });
    queue = next.catch(() => undefined);
    return next;
  }

  bb.rpc.register(rpcContract, {
    state_get: () => read(),
    usage_record: ({ key }) =>
      update((state) => ({ ...state, usage: recordUsage(state.usage, key, Date.now()) })),
    project_pin_set: ({ projectId, pinned }) =>
      update((state) => {
        const others = state.pinnedProjectIds.filter((id) => id !== projectId);
        return { ...state, pinnedProjectIds: pinned ? [...others, projectId] : others };
      }),
  });
}
