import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { LineCounter, parseDocument } from "yaml";
import type { Problem } from "../contract.js";
import { LIMITS } from "./source.js";

export type IssuePath = readonly PropertyKey[];

export interface SourceFile {
  id: string;
  file: string;
  data: unknown;
  locate: (path: IssuePath) => number | null;
}

export interface Sources {
  files: SourceFile[];
  problems: Problem[];
}

const YAML_FILE = /\.ya?ml$/i;

async function yamlFiles(root: string, problems: Problem[]): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > LIMITS.depth) return;
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && YAML_FILE.test(entry.name)) found.push(full);
    }
  };
  await walk(root, 0);
  if (found.length > LIMITS.files) {
    problems.push({
      severity: "warning",
      file: null,
      line: null,
      message: `Only the first ${LIMITS.files} of ${found.length} YAML files were read.`,
    });
  }
  return found.slice(0, LIMITS.files);
}

export function parseSource(id: string, file: string, text: string, problems: Problem[]): SourceFile {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true });
  for (const error of doc.errors) {
    problems.push({ severity: "error", file, line: error.linePos?.[0].line ?? null, message: error.message.split("\n")[0] ?? error.message });
  }
  const locate = (path: IssuePath): number | null => {
    const keys = path.filter((key): key is string | number => typeof key !== "symbol");
    for (let length = keys.length; length >= 0; length -= 1) {
      const node = doc.getIn(keys.slice(0, length), true) as { range?: [number, number, number] } | undefined;
      if (node?.range !== undefined) return lineCounter.linePos(node.range[0]).line;
    }
    return null;
  };
  return { id, file, data: doc.errors.length > 0 ? null : ((doc.toJS() as unknown) ?? {}), locate };
}

export async function loadSources(root: string): Promise<Sources> {
  const problems: Problem[] = [];
  const files: SourceFile[] = [];
  for (const full of await yamlFiles(root, problems)) {
    const file = relative(root, full).split(sep).join("/");
    const info = await stat(full);
    if (info.size > LIMITS.fileBytes) {
      problems.push({ severity: "error", file, line: null, message: `Larger than ${LIMITS.fileBytes / 1024} KiB; skipped.` });
      continue;
    }
    files.push(parseSource(file.replace(YAML_FILE, ""), file, await readFile(full, "utf8"), problems));
  }
  return { files, problems };
}
