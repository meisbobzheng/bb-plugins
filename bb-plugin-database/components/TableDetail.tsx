import type { TableInfo } from "../contract";
import { qualifiedName } from "../sql";
import { formatCount, prettyType } from "./bits";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";

export function TableDetail({ table, onPreview, onClose }: { table: TableInfo; onPreview(): void; onClose(): void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="min-w-0 truncate font-mono font-semibold" title={qualifiedName(table.schema, table.name)}>
          {qualifiedName(table.schema, table.name)}
        </span>
        <span className="shrink-0 text-muted-foreground">{table.kind}</span>
        {table.estimatedRows === null ? null : <span className="shrink-0 text-muted-foreground">~{formatCount(table.estimatedRows, "row")}</span>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="h-6 shrink-0 gap-1 px-2 text-xs" onClick={onPreview}>
          <Icon name="Play" className="size-3" />
          Preview 100 rows
        </Button>
        <Button size="sm" variant="ghost" className="h-6 w-6 px-0" onClick={onClose} aria-label="Close table details">
          <Icon name="X" className="size-3.5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        {table.comment === null ? null : <p className="mb-3 text-muted-foreground">{table.comment}</p>}
        <table className="w-full border-collapse font-mono">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="border-b border-border px-2 py-1 font-normal">column</th>
              <th className="border-b border-border px-2 py-1 font-normal">type</th>
              <th className="border-b border-border px-2 py-1 font-normal">nullable</th>
              <th className="border-b border-border px-2 py-1 font-normal">default</th>
              <th className="border-b border-border px-2 py-1 font-normal">comment</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((column) => (
              <tr key={column.name} className="hover:bg-state-hover">
                <td className="border-b border-border px-2 py-1">
                  <span className="inline-flex items-center gap-1">
                    {column.primaryKey ? <Icon name="database/key" className="size-3 text-attention" /> : null}
                    {column.name}
                  </span>
                </td>
                <td className="border-b border-border px-2 py-1 text-muted-foreground">{prettyType(column.type)}</td>
                <td className="border-b border-border px-2 py-1 text-muted-foreground">{column.nullable ? "yes" : "no"}</td>
                <td className="max-w-[20rem] truncate border-b border-border px-2 py-1 text-muted-foreground" title={column.default ?? ""}>
                  {column.default ?? ""}
                </td>
                <td className="max-w-[20rem] truncate border-b border-border px-2 py-1 font-sans text-muted-foreground" title={column.comment ?? ""}>
                  {column.comment ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {table.indexes.length === 0 ? null : (
          <section className="mt-4">
            <h3 className="mb-1 font-semibold">Indexes</h3>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {table.indexes.map((index) => (
                <li key={index.name} className="truncate" title={index.definition}>
                  {index.definition}
                </li>
              ))}
            </ul>
          </section>
        )}
        {table.foreignKeys.length === 0 ? null : (
          <section className="mt-4">
            <h3 className="mb-1 font-semibold">Foreign keys</h3>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {table.foreignKeys.map((key) => (
                <li key={key.name} className="truncate" title={key.definition}>
                  <span className="text-muted-foreground">{key.name}:</span> {key.definition}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
