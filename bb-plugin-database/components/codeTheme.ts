import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";
import { tags as t } from "@lezer/highlight";

function scopeColor(theme: PluginCodeThemeData, wanted: readonly string[]): string | undefined {
  let best: { rank: number; color: string } | null = null;
  for (const rule of theme.tokenColors) {
    const color = rule.settings.foreground;
    if (color === undefined) continue;
    const scopes = rule.scope === undefined ? [] : typeof rule.scope === "string" ? rule.scope.split(",").map((scope) => scope.trim()) : rule.scope;
    for (const scope of scopes) {
      wanted.forEach((want, index) => {
        const match = scope === want ? 3 : want.startsWith(`${scope}.`) ? 2 : scope.startsWith(`${want}.`) ? 1 : 0;
        if (match === 0) return;
        const rank = match * 100 - index * 10 - Math.abs(scope.length - want.length) / 100;
        if (best === null || rank > best.rank) best = { rank, color };
      });
    }
  }
  return best === null ? undefined : (best as { color: string }).color;
}

function mix(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export function editorTheme(theme: PluginCodeThemeData | null): Extension {
  if (theme === null) {
    return [
      EditorView.theme({
        "&": { backgroundColor: "transparent", color: "inherit", height: "100%" },
        ".cm-content": { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)" },
        ".cm-gutters": { backgroundColor: "transparent", border: "none" },
        "&.cm-focused": { outline: "none" },
      }),
      syntaxHighlighting(HighlightStyle.define([{ tag: t.keyword, fontWeight: "600" }, { tag: t.comment, fontStyle: "italic" }])),
    ];
  }
  const { fg, bg, colors } = theme;
  const dark = theme.type === "dark";
  const color = (scopes: readonly string[]) => scopeColor(theme, scopes) ?? fg;
  const panelBg = colors["editorSuggestWidget.background"] ?? colors["editorWidget.background"] ?? bg;
  const panelBorder = colors["editorSuggestWidget.border"] ?? colors["editorWidget.border"] ?? mix(fg, 15);
  const selectedBg = colors["editorSuggestWidget.selectedBackground"] ?? colors["list.activeSelectionBackground"] ?? mix(fg, 15);
  const selection = colors["editor.selectionBackground"] ?? mix(fg, 20);
  const highlight = HighlightStyle.define([
    { tag: t.keyword, color: color(["keyword", "keyword.other", "storage.type", "storage"]) },
    { tag: [t.string, t.special(t.string)], color: color(["string", "string.quoted"]) },
    { tag: t.number, color: color(["constant.numeric", "constant"]) },
    { tag: [t.bool, t.null], color: color(["constant.language", "constant"]) },
    { tag: t.comment, color: color(["comment", "comment.line"]), fontStyle: "italic" },
    { tag: t.operator, color: color(["keyword.operator", "keyword"]) },
    { tag: t.typeName, color: color(["support.type", "entity.name.type", "storage.type"]) },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: color(["entity.name.function", "support.function"]) },
    { tag: t.variableName, color: color(["variable", "variable.other"]) },
    { tag: t.propertyName, color: color(["variable.other.property", "variable.other.member", "variable"]) },
    { tag: t.punctuation, color: color(["punctuation", "meta.brace"]) },
  ]);
  return [
    EditorView.theme(
      {
        "&": { backgroundColor: bg, color: fg, height: "100%", fontSize: "13px" },
        ".cm-content": { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", caretColor: colors["editorCursor.foreground"] ?? fg, padding: "8px 0" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors["editorCursor.foreground"] ?? fg },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: selection },
        ".cm-gutters": { backgroundColor: bg, color: colors["editorLineNumber.foreground"] ?? mix(fg, 45), border: "none", paddingLeft: "4px" },
        ".cm-activeLineGutter": { backgroundColor: mix(fg, 6), color: colors["editorLineNumber.activeForeground"] ?? fg },
        ".cm-activeLine": { backgroundColor: mix(fg, 6) },
        ".cm-selectionMatch": { backgroundColor: colors["editor.selectionHighlightBackground"] ?? mix(fg, 12) },
        ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: mix(fg, 15), outline: "none" },
        "&.cm-focused": { outline: "none" },
        ".cm-placeholder": { color: mix(fg, 45), fontStyle: "italic" },
        ".cm-tooltip": { backgroundColor: panelBg, color: fg, border: `1px solid ${panelBorder}`, borderRadius: "6px", boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)" },
        ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", fontSize: "12px", maxHeight: "16em" },
        ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 8px", lineHeight: "1.6" },
        ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: selectedBg, color: colors["editorSuggestWidget.selectedForeground"] ?? fg },
        ".cm-completionIcon": { opacity: "0.7", paddingRight: "6px" },
        ".cm-completionDetail": { opacity: "0.6", fontStyle: "normal", marginLeft: "8px" },
        ".cm-panels": { backgroundColor: panelBg, color: fg },
        ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${panelBorder}` },
        ".cm-searchMatch": { backgroundColor: colors["editor.findMatchHighlightBackground"] ?? mix(fg, 20) },
        ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: colors["editor.findMatchBackground"] ?? mix(fg, 35) },
      },
      { dark },
    ),
    syntaxHighlighting(highlight),
  ];
}
