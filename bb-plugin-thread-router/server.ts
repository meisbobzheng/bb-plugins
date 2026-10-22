import type { BbPluginApi, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import { funkyName, parseFunkyName, toTopic } from "./names";

type Thread = PluginThreadEventPayloads["thread.created"]["thread"];
type Section = Awaited<ReturnType<BbPluginApi["sdk"]["threadSections"]["list"]>>[number];
type Pending = { untitled: boolean };

const FALLBACK_SECTION = "other";
const PROMPT_CHAR_LIMIT = 4000;
const EXAMPLES_PER_SECTION = 8;
const RECENT_NAMES_LIMIT = 100;
const CLASSIFY_TIMEOUT_MS = 120_000;

const pendingKey = (threadId: string) => `pending:${threadId}`;

const normalize = (name: string) =>
  name.trim().toLowerCase().replace(/^["'`*\s]+|["'`*.\s]+$/g, "");

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    providerId: {
      type: "string",
      label: "Classifier provider",
      description: "Provider that runs the hidden routing thread.",
      default: "claude-code",
    },
    model: {
      type: "string",
      label: "Classifier model",
      description: "Small, fast model used to pick a section.",
      default: "claude-haiku-4-5-20251001",
    },
    hints: {
      type: "string",
      label: "Routing hints",
      description: "Optional notes on what belongs in each section, e.g. 'reviews: PR review threads'.",
      experimental_multiline: true,
      default: "",
    },
    naming: {
      type: "boolean",
      label: "Funky thread names",
      description: "Rename untitled new threads to a topic and a name, e.g. 'hss-warrior'.",
      default: true,
    },
  });

  const inFlight = new Set<string>();

  const isRoutable = (thread: Thread) =>
    thread.sectionId === null &&
    thread.parentThreadId === null &&
    thread.archivedAt === null &&
    thread.visibility !== "hidden" &&
    thread.originPluginId !== bb.pluginId;

  bb.events.on("thread.created", async ({ thread }) => {
    if (!isRoutable(thread)) return;
    await bb.storage.kv.set(pendingKey(thread.id), { untitled: thread.title === null } satisfies Pending);
  });

  bb.events.on("thread.active", async ({ thread }) => {
    if (inFlight.has(thread.id)) return;
    const pending = await bb.storage.kv.get<Pending>(pendingKey(thread.id));
    if (!pending) return;
    inFlight.add(thread.id);
    try {
      await route(thread.id, pending.untitled);
    } catch (error) {
      bb.log.error(`failed to route ${thread.id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await bb.storage.kv.delete(pendingKey(thread.id));
      inFlight.delete(thread.id);
    }
  });

  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => bb.storage.kv.delete(pendingKey(thread.id)));
  }

  async function route(threadId: string, untitled: boolean) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!isRoutable(thread)) return;

    const config = await settings.get();
    const rename = untitled && config.naming;
    const sections = await bb.sdk.threadSections.list();
    const fallback =
      sections.find((section) => normalize(section.name) === FALLBACK_SECTION) ??
      (await bb.sdk.threadSections.create({ name: FALLBACK_SECTION }));
    const candidates = sections.filter((section) => section.id !== fallback.id);
    const verdict = candidates.length > 0 || rename ? await classify(thread, candidates, config) : null;
    const target = verdict?.section ?? fallback;

    const current = await bb.sdk.threads.get({ threadId });
    const sectionId = current.sectionId === null ? target.id : undefined;
    const untouched = current.title === null || current.title === thread.title;
    const title = rename && verdict && untouched ? funkyName(verdict.topic, await recentNames()) : undefined;
    if (sectionId === undefined && title === undefined) return;

    await bb.sdk.threads.update({ threadId, sectionId, title });
    if (sectionId) bb.log.info(`routed ${threadId} to ${target.name}`);
    if (title) bb.log.info(`named ${threadId} ${title}`);
  }

  async function classify(
    thread: Thread,
    sections: Section[],
    { providerId, model, hints }: Awaited<ReturnType<typeof settings.get>>,
  ) {
    const [firstPrompt, project, examples] = await Promise.all([
      readFirstPrompt(thread.id),
      bb.sdk.projects.get({ projectId: thread.projectId }),
      Promise.all(sections.map((section) => recentTitles(section.id))),
    ]);

    const sectionLines = sections.map((section, index) => {
      const titles = examples[index]!;
      return titles.length === 0
        ? `- ${section.name}`
        : `- ${section.name} (recent threads: ${titles.map((title) => JSON.stringify(title)).join(", ")})`;
    });

    const prompt = [
      "You are routing a new coding-agent thread into one of the user's sidebar sections.",
      "",
      "Sections:",
      ...sectionLines,
      ...(hints.trim() ? ["", "Routing hints from the user:", hints.trim()] : []),
      "",
      "New thread:",
      `Project: ${project.name}`,
      `Title: ${thread.title ?? thread.titleFallback ?? "(untitled)"}`,
      "First message:",
      '"""',
      firstPrompt.slice(0, PROMPT_CHAR_LIMIT),
      '"""',
      "",
      "Reply with exactly two lines and nothing else:",
      `Line 1: one section name from the list, or "${FALLBACK_SECTION}" if none is a clear fit.`,
      "Line 2: one lowercase word for the thread's project or topic, such as hss, review, or rfc.",
      "Do not use any tools. Do not label the lines.",
    ].join("\n");

    const worker = await bb.sdk.threads.spawn({
      projectId: thread.projectId,
      environment: thread.environmentId
        ? { type: "reuse", environmentId: thread.environmentId }
        : { type: "project-default" },
      providerId,
      model,
      title: `Route thread ${thread.id}`,
      visibility: "hidden",
      prompt,
    });

    try {
      await bb.sdk.threads.wait({ threadId: worker.id, status: "idle", timeoutMs: CLASSIFY_TIMEOUT_MS });
      const { output } = await bb.sdk.threads.output({ threadId: worker.id });
      const [answer = "", topic] = (output ?? "").split("\n").filter((line) => line.trim()).slice(-2);
      return {
        section: sections.find((section) => normalize(section.name) === normalize(answer)) ?? null,
        topic: toTopic(topic, project.name),
      };
    } finally {
      await bb.sdk.threads.archive({ threadId: worker.id });
      await bb.sdk.threads.stop({ threadId: worker.id });
    }
  }

  async function readFirstPrompt(threadId: string) {
    const history = await bb.sdk.threads.promptHistory({ threadId });
    const first = history.reduce<(typeof history)[number] | undefined>(
      (oldest, entry) => (oldest === undefined || entry.createdAt < oldest.createdAt ? entry : oldest),
      undefined,
    );
    return (first?.input ?? [])
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
  }

  async function recentNames() {
    const threads = await bb.sdk.threads.list({ limit: RECENT_NAMES_LIMIT });
    return threads.flatMap((thread) => {
      const name = thread.title === null ? null : parseFunkyName(thread.title);
      return name ? [name] : [];
    });
  }

  async function recentTitles(sectionId: string) {
    const threads = await bb.sdk.threads.list({ sectionId, limit: EXAMPLES_PER_SECTION });
    return threads.flatMap((thread) => {
      const title = thread.title ?? thread.titleFallback;
      return title ? [title] : [];
    });
  }
}
