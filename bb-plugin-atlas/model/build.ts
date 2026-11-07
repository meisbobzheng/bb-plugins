import { stat } from "node:fs/promises";
import type { Atlas, Snapshot } from "../contract.js";
import { layoutDiagram } from "./layout.js";
import { loadSources, type SourceFile } from "./load.js";
import { resolveAtlas } from "./resolve.js";

export async function buildAtlas(files: readonly SourceFile[]): Promise<{ atlas: Atlas | null; problems: Snapshot["problems"] }> {
  const resolved = resolveAtlas(files);
  const problems = [...resolved.problems];
  if (resolved.root === null) return { atlas: null, problems };
  const pathEnds = new Map(Object.values(resolved.paths).map(({ id, between }) => [id, between]));
  const diagrams = await Promise.all(resolved.diagrams.map((diagram) => layoutDiagram(diagram, resolved.places, pathEnds, problems)));
  return {
    atlas: { root: resolved.root, diagrams: Object.fromEntries(diagrams.map((diagram) => [diagram.id, diagram])), places: resolved.places, paths: resolved.paths },
    problems,
  };
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

export async function snapshotOf(directory: string, now: () => Date = () => new Date()): Promise<Snapshot> {
  if (directory === "") return { status: "unconfigured", directory, atlas: null, problems: [], loadedAt: null };
  if (!(await isDirectory(directory))) return { status: "missing", directory, atlas: null, problems: [], loadedAt: null };
  const sources = await loadSources(directory);
  const { atlas, problems } = await buildAtlas(sources.files);
  return { status: "ready", directory, atlas, problems: [...sources.problems, ...problems], loadedAt: now().toISOString() };
}
