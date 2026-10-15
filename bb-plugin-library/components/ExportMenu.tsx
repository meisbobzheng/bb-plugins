import type { RefObject } from "react";
import { toast } from "sonner";
import type { Entry } from "../contract";
import { LIGHT_THEME, entryMarkdown, fileName, htmlDocument, renderEntry } from "../export";
import { captureDiagrams, printEntry, saveFile, themeOf, type SaveOutcome, type SaveTarget } from "./exporter";
import { errorMessage } from "./hooks";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

function Option({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium text-foreground">{title}</span>
      <span className="text-muted-foreground">{detail}</span>
    </span>
  );
}

interface ExportMenuProps {
  entry: Entry;
  article: RefObject<HTMLElement | null>;
  body: RefObject<HTMLElement | null>;
}

export function ExportMenu({ entry, article, body }: ExportMenuProps) {
  const render = () => {
    const theme = article.current === null ? LIGHT_THEME : themeOf(article.current);
    const rendered = renderEntry(entry, body.current === null ? [] : captureDiagrams(body.current), theme);
    if (rendered.diagramsMissing) toast("Some diagrams had not rendered yet, so they are exported as mermaid code.");
    return { theme, rendered };
  };

  const report = (outcome: SaveOutcome) => {
    if (outcome.kind === "saved") toast.success(`Saved ${outcome.name}`);
    if (outcome.kind === "downloaded") toast.success(`Downloaded ${outcome.name}`);
  };

  const save = (target: SaveTarget) => {
    saveFile(target).then(report, (cause: unknown) => toast.error(`Could not export: ${errorMessage(cause)}`));
  };

  const exportPdf = () => {
    const { theme, rendered } = render();
    setTimeout(() => printEntry(rendered, theme), 0);
  };

  const exportMarkdown = () =>
    save({ name: fileName(entry.title, "md"), type: "text/markdown", description: "Markdown", data: entryMarkdown(entry) });

  const exportHtml = () => {
    const { theme, rendered } = render();
    save({ name: fileName(entry.title, "html"), type: "text/html", description: "Web page", data: htmlDocument(rendered, theme) });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Icon name="Download" />
          Export
          <Icon name="ChevronDown" className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" mobileTitle="Export" className="w-72">
        <DropdownMenuItem onSelect={exportPdf}>
          <Option title="PDF…" detail="Opens the print dialog; choose Save as PDF" />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportMarkdown}>
          <Option title="Markdown (.md)…" detail="With title, kind, and tags as front matter" />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportHtml}>
          <Option title="HTML (.html)…" detail="A standalone page with its diagrams" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
