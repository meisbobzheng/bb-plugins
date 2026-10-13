import type { BbPluginApi, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";

type Thread = PluginThreadEventPayloads["thread.created"]["thread"];
type Section = Awaited<ReturnType<BbPluginApi["sdk"]["threadSections"]["list"]>>[number];

const FALLBACK_SECTION = "other";
const PROMPT_CHAR_LIMIT = 4000;
const EXAMPLES_PER_SECTION = 8;
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
  });

  const inFlight = new Set<string>();

  const isRoutable = (thread: Thread) =>
    thread.sectionId === null &&
    thread.parentThreadId === null &&
    thread.archivedAt === null &&
    thread.visibility !== "hidden" &&
    thread.originPluginId !== bb.pluginId;

  bb.events.on("thread.created", async ({ thread }) => {
    if (isRoutable(thread)) await bb.storage.kv.set(pendingKey(thread.id), true);
  });

  bb.events.on("thread.active", async ({ thread }) => {
    if (inFlight.has(thread.id)) return;
    if (!(await bb.storage.kv.get<boolean>(pendingKey(thread.id)))) return;
    inFlight.add(thread.id);
    try {
      await route(thread.id);
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

  async function route(threadId: string) {
    if (!isRoutable(await bb.sdk.threads.get({ threadId }))) return;

    const sections = await bb.sdk.threadSections.list();
    const fallback =
      sections.find((section) => normalize(section.name) === FALLBACK_SECTION) ??
      (await bb.sdk.threadSections.create({ name: FALLBACK_SECTION }));
    const candidates = sections.filter((section) => section.id !== fallback.id);
    const target = (candidates.length > 0 && (await classify(threadId, candidates))) || fallback;

    if ((await bb.sdk.threads.get({ threadId })).sectionId !== null) return;
    await bb.sdk.threads.update({ threadId, sectionId: target.id });
    bb.log.info(`routed ${threadId} to ${target.name}`);
  }

  async function classify(threadId: string, sections: Section[]): Promise<Section | null> {
    const thread = await bb.sdk.threads.get({ threadId });
    const [firstPrompt, project, examples, { providerId, model, hints }] = await Promise.all([
      readFirstPrompt(threadId),
      bb.sdk.projects.get({ projectId: thread.projectId }),
      Promise.all(sections.map((section) => recentTitles(section.id))),
      settings.get(),
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
      `Reply with exactly one section name from the list, or "${FALLBACK_SECTION}" if none is a clear fit.`,
      "Do not use any tools. Reply with the section name only.",
    ].join("\n");

    const worker = await bb.sdk.threads.spawn({
      projectId: thread.projectId,
      environment: thread.environmentId
        ? { type: "reuse", environmentId: thread.environmentId }
        : { type: "project-default" },
      providerId,
      model,
      title: `Route thread ${threadId}`,
      visibility: "hidden",
      prompt,
    });

    try {
      await bb.sdk.threads.wait({ threadId: worker.id, status: "idle", timeoutMs: CLASSIFY_TIMEOUT_MS });
      const { output } = await bb.sdk.threads.output({ threadId: worker.id });
      const answer = normalize(output?.trim().split("\n").at(-1) ?? "");
      return sections.find((section) => normalize(section.name) === answer) ?? null;
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

  async function recentTitles(sectionId: string) {
    const threads = await bb.sdk.threads.list({ sectionId, limit: EXAMPLES_PER_SECTION });
    return threads.flatMap((thread) => {
      const title = thread.title ?? thread.titleFallback;
      return title ? [title] : [];
    });
  }
}
