import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, placeholder as placeholderOf } from "@codemirror/view";
import { experimental_useCodeTheme as useCodeTheme } from "@get-bb/plugin-sdk/app";
import type { SchemaSnapshot } from "../contract";
import { editorTheme } from "./codeTheme";

export interface EditorHandle {
  selectionOrAll(): string;
  insert(text: string): void;
  focus(): void;
}

export interface EditorProps {
  value: string;
  onChange(value: string): void;
  snapshot: SchemaSnapshot | null;
  onRun(): void;
  onExplain(): void;
  placeholder?: string;
}

export function namespaceOf(snapshot: SchemaSnapshot | null): SQLNamespace {
  const namespace: Record<string, Record<string, string[]>> = {};
  for (const table of snapshot?.tables ?? []) {
    (namespace[table.schema] ??= {})[table.name] = table.columns.map((column) => column.name);
  }
  return namespace;
}

function language(snapshot: SchemaSnapshot | null) {
  return sql({ dialect: PostgreSQL, schema: namespaceOf(snapshot), defaultSchema: "public", upperCaseKeywords: true });
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ value, onChange, snapshot, onRun, onExplain, placeholder }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const callbacks = useRef({ onChange, onRun, onExplain });
  callbacks.current = { onChange, onRun, onExplain };
  const { theme } = useCodeTheme();

  useImperativeHandle(ref, () => ({
    selectionOrAll() {
      const current = view.current;
      if (current === null) return value;
      const { from, to } = current.state.selection.main;
      return from === to ? current.state.doc.toString() : current.state.sliceDoc(from, to);
    },
    insert(text) {
      const current = view.current;
      if (current === null) return;
      const { from, to } = current.state.selection.main;
      current.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      current.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  useEffect(() => {
    if (host.current === null) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        placeholderOf(placeholder ?? "SELECT …"),
        Prec.highest(
          keymap.of([
            { key: "Mod-Enter", run: () => (callbacks.current.onRun(), true) },
            { key: "Shift-Mod-Enter", run: () => (callbacks.current.onExplain(), true) },
          ]),
        ),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        languageCompartment.current.of(language(snapshot)),
        themeCompartment.current.of(editorTheme(theme)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
        }),
      ],
    });
    const created = new EditorView({ state, parent: host.current });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const current = view.current;
    if (current === null) return;
    const doc = current.state.doc.toString();
    if (doc !== value) current.dispatch({ changes: { from: 0, to: doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: languageCompartment.current.reconfigure(language(snapshot)) });
  }, [snapshot]);

  useEffect(() => {
    view.current?.dispatch({ effects: themeCompartment.current.reconfigure(editorTheme(theme)) });
  }, [theme]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto" data-testid="sql-editor" />;
});
