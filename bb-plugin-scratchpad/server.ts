import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { BOARDS_CHANGED, type BoardsChangedSignal } from "./constants.js";
import {
  boardNameSchema,
  boardSchema,
  boardSummarySchema,
  elementsSchema,
  type Board,
  type BoardSummary,
} from "./model.js";
import { summarizeBoard } from "./summary.js";

const PNG_DATA_URL = "data:image/png;base64,";
const boardId = z.object({ id: z.string().min(1).max(64) });

export const rpcContract = defineRpcContract({
  boards_list: {
    input: z.null(),
    output: z.object({ boards: z.array(boardSummarySchema) }),
  },
  board_get: {
    input: boardId,
    output: z.object({ board: boardSchema.nullable() }),
  },
  board_create: {
    input: z.object({ name: boardNameSchema }),
    output: boardSummarySchema,
  },
  board_rename: {
    input: boardId.extend({ name: boardNameSchema }),
    output: boardSummarySchema,
  },
  board_delete: {
    input: boardId,
    output: z.object({ deleted: z.boolean() }),
  },
  board_save: {
    input: boardId.extend({
      elements: elementsSchema,
      snapshot: z
        .string()
        .max(12_000_000)
        .refine((value) => value.startsWith(PNG_DATA_URL), "Expected a PNG data URL")
        .nullable(),
      clientId: z.string().max(64),
    }),
    output: z.object({ updatedAt: z.string() }),
  },
});

interface BoardRow {
  id: string;
  name: string;
  elements: string;
  element_count: number;
  updated_at: string;
}

function toSummary(row: Omit<BoardRow, "elements">): BoardSummary {
  return {
    id: row.id,
    name: row.name,
    elementCount: row.element_count,
    updatedAt: row.updated_at,
  };
}

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      elements TEXT NOT NULL DEFAULT '[]',
      element_count INTEGER NOT NULL DEFAULT 0,
      snapshot BLOB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ]);

  const summaryColumns = "id, name, element_count, updated_at";
  const listStatement = db.prepare<[], Omit<BoardRow, "elements">>(
    `SELECT ${summaryColumns} FROM boards ORDER BY updated_at DESC`,
  );
  const getStatement = db.prepare<[string], BoardRow>(
    `SELECT ${summaryColumns}, elements FROM boards WHERE id = ?`,
  );
  const snapshotStatement = db.prepare<[string], { snapshot: Buffer | null }>(
    "SELECT snapshot FROM boards WHERE id = ?",
  );

  function publish(signal: BoardsChangedSignal) {
    bb.realtime.publish(BOARDS_CHANGED, signal);
  }

  function getSummary(id: string): BoardSummary {
    const row = getStatement.get(id);
    if (row === undefined) throw new Error(`No scratchpad board with id ${id}`);
    return toSummary(row);
  }

  function getBoard(id: string): Board | null {
    const row = getStatement.get(id);
    if (row === undefined) return null;
    return { ...toSummary(row), elements: elementsSchema.parse(JSON.parse(row.elements)) };
  }

  function createBoard(name: string): BoardSummary {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(id, name, now, now);
    publish({ boardId: id, clientId: null });
    return getSummary(id);
  }

  bb.rpc.register(rpcContract, {
    boards_list: () => {
      const boards = listStatement.all().map(toSummary);
      return { boards: boards.length > 0 ? boards : [createBoard("Scratchpad")] };
    },
    board_get: ({ id }) => ({ board: getBoard(id) }),
    board_create: ({ name }) => createBoard(name),
    board_rename: ({ id, name }) => {
      db.prepare("UPDATE boards SET name = ?, updated_at = ? WHERE id = ?").run(
        name,
        new Date().toISOString(),
        id,
      );
      publish({ boardId: id, clientId: null });
      return getSummary(id);
    },
    board_delete: ({ id }) => {
      const { changes } = db.prepare("DELETE FROM boards WHERE id = ?").run(id);
      if (changes > 0) publish({ boardId: id, clientId: null });
      return { deleted: changes > 0 };
    },
    board_save: ({ id, elements, snapshot, clientId }) => {
      const updatedAt = new Date().toISOString();
      const png =
        snapshot === null
          ? null
          : Buffer.from(snapshot.slice(PNG_DATA_URL.length), "base64");
      const { changes } = db
        .prepare(
          "UPDATE boards SET elements = ?, element_count = ?, snapshot = ?, updated_at = ? WHERE id = ?",
        )
        .run(JSON.stringify(elements), elements.length, png, updatedAt, id);
      if (changes === 0) throw new Error(`No scratchpad board with id ${id}`);
      publish({ boardId: id, clientId });
      return { updatedAt };
    },
  });

  const snapshotDir = join(tmpdir(), `bb-plugin-${bb.pluginId}`);

  async function snapshotPath(board: Board): Promise<string | null> {
    const snapshot = snapshotStatement.get(board.id)?.snapshot;
    if (!snapshot || snapshot.length === 0) return null;
    const path = join(snapshotDir, `${board.id}-${Date.parse(board.updatedAt)}.png`);
    if (!existsSync(path)) {
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(path, snapshot);
    }
    return path;
  }

  bb.ui.registerMentionProvider({
    id: "board",
    label: "Scratchpad boards",
    search({ query }) {
      const needle = query.trim().toLowerCase();
      return listStatement
        .all()
        .filter((row) => row.name.toLowerCase().includes(needle))
        .slice(0, 20)
        .map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: `Scratchpad · ${row.element_count} item${row.element_count === 1 ? "" : "s"}`,
        }));
    },
    async resolve(itemId) {
      const board = getBoard(itemId);
      if (board === null) throw new Error("That scratchpad board no longer exists.");
      const path = await snapshotPath(board);
      return {
        context: summarizeBoard(board, path !== null),
        experimental_images:
          path === null
            ? []
            : [{ type: "localImage", path, context: `Rendering of scratchpad board "${board.name}"` }],
      };
    },
  });
}
