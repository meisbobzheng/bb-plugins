import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { artists } from "./format";
import type { Playlist, SkinProps, Track } from "./model";
import { themeOf } from "./share";
import "./playlist-add.css";

const MIME = "application/x-bb-spotify-track";
const SPRING_MS = 450;

let carried: Track | null = null;
let spring: ReturnType<typeof setTimeout> | null = null;

const carrying = (event: DragEvent) => carried !== null && event.dataTransfer.types.includes(MIME);
const family = (font: string) => font.replace(/^.*?\d+px\s*/, "");

function themeVars(source: HTMLElement): React.CSSProperties {
  const theme = themeOf(source);
  return {
    "--pick-bg": theme.bg,
    "--pick-ink": theme.ink,
    "--pick-muted": theme.muted,
    "--pick-accent": theme.accent,
    "--pick-title": family(theme.titleFont),
    "--pick-body": family(theme.bodyFont),
  } as React.CSSProperties;
}

function endDrag() {
  window.removeEventListener("dragend", endDrag, true);
  window.removeEventListener("drop", endDrag);
  window.removeEventListener("pointermove", endDrag, true);
  carried = null;
  if (spring !== null) clearTimeout(spring);
  spring = null;
  delete document.documentElement.dataset.spDragging;
  document.querySelectorAll('[data-sp-drop="over"]').forEach((element) => element.setAttribute("data-sp-drop", ""));
}

function startDrag(event: DragEvent<HTMLElement>, track: Track) {
  carried = track;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(MIME, track.id);
  if (track.url !== null) event.dataTransfer.setData("text/uri-list", track.url);
  event.dataTransfer.setData("text/plain", track.url ?? track.uri);
  const chip = document.createElement("div");
  chip.className = "sp-drag-chip";
  chip.textContent = `♫ ${track.name} — ${artists(track)}`;
  Object.assign(chip.style, themeVars(event.currentTarget));
  document.body.append(chip);
  event.dataTransfer.setDragImage(chip, 14, 14);
  requestAnimationFrame(() => chip.remove());
  document.documentElement.dataset.spDragging = "";
  window.addEventListener("dragend", endDrag, true);
  window.addEventListener("drop", endDrag);
  window.addEventListener("pointermove", endDrag, true);
}

export const addable = (playlists: Playlist[] | null) => (playlists ?? []).filter((playlist) => playlist.readable);

export interface PlaylistAdd {
  song(track: Track | null): React.HTMLAttributes<HTMLElement> & { draggable?: boolean; "data-sp-song"?: "" };
  target(playlist: Playlist): React.HTMLAttributes<HTMLElement> & { "data-sp-drop"?: "" };
  spring(open: () => void): React.HTMLAttributes<HTMLElement>;
  open(track: Track | null, anchor: HTMLElement | null): void;
  picker: React.ReactNode;
}

export function usePlaylistAdd({ data, actions }: Pick<SkinProps, "data" | "actions">): PlaylistAdd {
  const [open, setOpen] = useState<{ track: Track; anchor: HTMLElement } | null>(null);
  const add = useRef(actions.addToPlaylist);
  add.current = actions.addToPlaylist;

  const show = useCallback((track: Track | null, anchor: HTMLElement | null) => {
    if (track !== null && anchor !== null) setOpen({ track, anchor });
  }, []);

  const song = useCallback(
    (track: Track | null) =>
      track === null
        ? {}
        : {
            draggable: true,
            "data-sp-song": "" as const,
            onDragStart: (event: DragEvent<HTMLElement>) => startDrag(event, track),
            onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
              event.preventDefault();
              setOpen({ track, anchor: event.currentTarget });
            },
          },
    [],
  );

  const target = useCallback(
    (playlist: Playlist) =>
      !playlist.readable
        ? {}
        : {
            "data-sp-drop": "" as const,
            onDragOver: (event: DragEvent<HTMLElement>) => {
              if (!carrying(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              event.currentTarget.setAttribute("data-sp-drop", "over");
            },
            onDragLeave: (event: DragEvent<HTMLElement>) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.setAttribute("data-sp-drop", "");
            },
            onDrop: (event: DragEvent<HTMLElement>) => {
              const track = carried;
              if (track === null || !carrying(event)) return;
              event.preventDefault();
              endDrag();
              add.current(track, playlist);
            },
          },
    [],
  );

  const springOpen = useCallback(
    (openTab: () => void) => ({
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!carrying(event) || spring !== null) return;
        spring = setTimeout(() => {
          spring = null;
          openTab();
        }, SPRING_MS);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => carrying(event) && event.preventDefault(),
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (spring === null || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        clearTimeout(spring);
        spring = null;
      },
    }),
    [],
  );

  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus && open?.anchor.isConnected) open.anchor.focus({ preventScroll: true });
  };

  const picker =
    open === null ? null : (
      <Picker
        track={open.track}
        anchor={open.anchor}
        playlists={addable(data.playlists)}
        loading={data.playlists === null}
        onPick={(playlist) => {
          close(true);
          add.current(open.track, playlist);
        }}
        onClose={close}
      />
    );

  return { song, target, spring: springOpen, open: show, picker };
}

function place(anchor: HTMLElement, width: number, height: number): { left: number; top: number } {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const inside = rect.height > 120;
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, inside ? rect.left + (rect.width - width) / 2 : rect.right - width));
  const below = inside ? rect.top + 24 : rect.bottom + 6;
  const top = below + height + margin <= window.innerHeight ? below : Math.max(margin, rect.top - height - 6);
  return { left, top };
}

function Picker({ track, anchor, playlists, loading, onPick, onClose }: { track: Track; anchor: HTMLElement; playlists: Playlist[]; loading: boolean; onPick(playlist: Playlist): void; onClose(refocus: boolean): void }) {
  const scope = usePortalScopeProps();
  const frame = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const vars = useMemo(() => themeVars(anchor), [anchor]);
  const needle = query.trim().toLowerCase();
  const shown = needle === "" ? playlists : playlists.filter((playlist) => playlist.name.toLowerCase().includes(needle));
  const active = Math.min(cursor, Math.max(0, shown.length - 1));

  useLayoutEffect(() => {
    const element = frame.current;
    if (element !== null) setPosition(place(anchor, element.offsetWidth, element.offsetHeight));
  }, [anchor]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || frame.current?.contains(event.target) || anchor.contains(event.target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [anchor, onClose]);

  useEffect(() => {
    frame.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") setCursor(Math.max(0, Math.min(shown.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
    else if (event.key === "Enter" && shown[active] !== undefined) onPick(shown[active]);
    else if (event.key === "Escape") onClose(true);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return createPortal(
    <div
      {...scope}
      ref={frame}
      className="sp-pick"
      role="dialog"
      aria-label={`Add ${track.name} to a playlist`}
      style={{ ...vars, left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      onKeyDown={onKey}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="sp-pick-head">
        Add <b>{track.name}</b> to
      </div>
      <input
        autoFocus
        value={query}
        placeholder="Find a playlist"
        aria-label="Find a playlist"
        aria-controls="sp-pick-list"
        aria-activedescendant={shown[active] === undefined ? undefined : `sp-pick-${shown[active].id}`}
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
        }}
      />
      <ul id="sp-pick-list" role="listbox" aria-label="Playlists">
        {shown.map((playlist, index) => (
          <li
            key={playlist.id}
            id={`sp-pick-${playlist.id}`}
            role="option"
            aria-selected={index === active}
            onPointerEnter={() => setCursor(index)}
            onClick={() => onPick(playlist)}
          >
            <span>{playlist.name}</span>
            <span>{playlist.trackCount.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <div className="sp-pick-empty">{loading ? "Loading playlists…" : needle === "" ? "No playlists you can add to." : "No playlist matches."}</div> : null}
    </div>,
    document.body,
  );
}
