import { useEffect, useRef } from "react";
import type { Device, DuckState, Playlist, Track } from "../../../contract";
import { artists, clock } from "../../format";
import { upNext, type SkinProps, type SpotifyData } from "../../model";
import { stepDays } from "../pastel/stickers";
import { listened, tagFor } from "./brush";
import { Cover } from "./visuals";

export type Share = "link" | "thread" | "card";

const SHARES: [Share, string, string][] = [
  ["link", "copy link", "y"],
  ["thread", "@ in thread", "@"],
  ["card", "share card", "c"],
];

export const HELP: [string, string][] = [
  ["space", "play · pause"],
  ["f", "keep in Liked Songs"],
  ["n", "next"],
  ["p", "previous"],
  ["← →  , .", "seek 10 s"],
  ["+ −", "volume"],
  ["j k", "move in the list"],
  ["⏎", "play · open"],
  ["s", "search"],
  ["R", "reshuffle by feel"],
  ["x", "shuffle"],
  ["r", "repeat"],
  ["y", "copy link"],
  ["@", "mention in thread"],
  ["c", "share card"],
  ["d", "devices"],
  ["o", "open Spotify"],
  ["1–4", "tabs, when narrow"],
];

export const ordered = (playlists: Playlist[] | null): Playlist[] => [...(playlists ?? []).filter((entry) => entry.readable), ...(playlists ?? []).filter((entry) => !entry.readable)];

export const Kbd = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>;

export function useNearest(ref: React.RefObject<HTMLElement | null>, deps: readonly unknown[]) {
  useEffect(() => {
    ref.current?.querySelector(".w-cur")?.scrollIntoView({ block: "nearest" });
  }, deps);
}

export function Library({ data, cursor, focused, onPick }: { data: SpotifyData; cursor: number; focused: boolean; onPick(index: number): void }) {
  const list = useRef<HTMLUListElement>(null);
  const playlists = ordered(data.playlists);
  useNearest(list, [cursor, focused]);
  const row = (playlist: Playlist) => {
    const index = playlists.indexOf(playlist);
    const playing = data.player.context?.uri === playlist.uri;
    const classes = [playlist.readable ? "" : "w-fol", data.selection.playlist?.id === playlist.id ? "w-on" : "", focused && index === cursor ? "w-cur" : ""].join(" ");
    return (
      <li key={playlist.id} className={classes} onClick={() => onPick(index)} title={playlist.readable ? playlist.name : `${playlist.name} · followed, play only`}>
        <span className="w-nm">{playlist.name}</span>
        {playing ? <i className="w-ring" title="playing" /> : null}
        <span className="w-c">{playlist.trackCount.toLocaleString()}</span>
      </li>
    );
  };
  const followed = playlists.filter((entry) => !entry.readable);
  return (
    <ul ref={list} className="w-pl">
      {data.playlists === null ? <li className="w-grp">gathering…</li> : null}
      {data.playlists !== null && playlists.length === 0 ? <li className="w-grp">no playlists yet</li> : null}
      {playlists.filter((entry) => entry.readable).map(row)}
      {followed.length > 0 ? <li className="w-grp">followed · play only</li> : null}
      {followed.map(row)}
    </ul>
  );
}

export function Tracks({ props, tracks, cursor, focused, results, onPick }: { props: SkinProps; tracks: Track[]; cursor: number; focused: boolean; results: boolean; onPick(index: number): void }) {
  const { data, actions } = props;
  const box = useRef<HTMLDivElement>(null);
  const current = data.player.track?.id;
  useNearest(box, [cursor, focused, tracks]);
  useEffect(() => {
    const element = box.current;
    const now = element?.querySelector<HTMLElement>(".w-now");
    if (element === null || !now || results) return;
    if (now.offsetTop < element.scrollTop || now.offsetTop + now.offsetHeight > element.scrollTop + element.clientHeight * 0.8) element.scrollTop = now.offsetTop - element.clientHeight * 0.35;
  }, [current, results]);
  return (
    <div ref={box} className={`w-tl ${results ? "w-results" : ""}`}>
      {tracks.map((track, index) => (
        <div key={`${track.id}-${index}`} className={`w-tr ${track.id === current ? "w-now" : ""} ${focused && index === cursor ? "w-cur" : ""}`} onClick={() => onPick(index)} title={`Play ${track.name}`}>
          <span className="w-i">{String(index + 1).padStart(2, "0")}</span>
          <span className="w-n">{track.name}</span>
          <span className="w-a">{artists(track)}</span>
          <span className="w-al">{track.album.name}</span>
          <span className="w-d">{clock(track.durationMs)}</span>
          {results ? (
            <button
              type="button"
              className="w-q"
              onClick={(event) => {
                event.stopPropagation();
                actions.queue(track);
              }}
            >
              queue
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function emptyTracks(data: SpotifyData, results: boolean, onPlay: () => void): React.ReactNode {
  if (results) return <p className="w-quiet">nothing found · Esc returns to the playlist</p>;
  const { playlist, readable, loading } = data.selection;
  if (playlist === null) return <p className="w-quiet">pick a playlist from the library</p>;
  if (loading) return <p className="w-quiet">turning the pages…</p>;
  if (!readable)
    return (
      <p className="w-quiet">
        Spotify keeps the songs of followed playlists to itself.{" "}
        <button type="button" className="w-link" onClick={onPlay}>
          play {playlist.name}
        </button>{" "}
        <Kbd>⏎</Kbd>
      </p>
    );
  return <p className="w-quiet">an empty bowl · this playlist has no songs yet</p>;
}

export function Toggles({ props, short }: { props: SkinProps; short: boolean }) {
  const { data, actions } = props;
  const options = data.shuffleOptions;
  const days = (event: React.MouseEvent, direction: 1 | -1) => {
    event.stopPropagation();
    actions.setShuffleOptions({ freshDays: stepDays(options.freshDays, direction) });
  };
  const toggles: [boolean, string, string, () => void, React.ReactNode?][] = [
    [options.spread, "spread", "different artist from the last few", () => actions.setShuffleOptions({ spread: !options.spread })],
    [
      options.fresh,
      short ? `fresh ${options.freshDays}d` : `fresh · ${options.freshDays} days`,
      "favor what you haven't heard",
      () => actions.setShuffleOptions({ fresh: !options.fresh }),
      short ? null : (
        <span className="w-days">
          <span role="button" tabIndex={-1} aria-label="Fewer days" onClick={(event) => days(event, -1)}>
            ‹
          </span>
          <span role="button" tabIndex={-1} aria-label="More days" onClick={(event) => days(event, 1)}>
            ›
          </span>
        </span>
      ),
    ],
    [options.noSkips, "no-skips", "leave out what you pass over", () => actions.setShuffleOptions({ noSkips: !options.noSkips })],
  ];
  return (
    <div className={short ? "w-tg-row" : "w-tgs"}>
      {toggles.map(([on, name, note, toggle, extra]) => (
        <button key={note} type="button" role="checkbox" aria-checked={on} className={`w-tg ${on ? "w-on" : ""}`} onClick={toggle}>
          <i />
          <span>
            <b>
              {name}
              {extra}
            </b>
            {short ? null : <em>{note}</em>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Vibe({ props, onShuffle, onLeave }: { props: SkinProps; onShuffle(): void; onLeave(): void }) {
  const { data, actions } = props;
  return (
    <label className="w-vibe">
      <input
        value={data.shuffleOptions.vibe ?? ""}
        placeholder="describe a feeling…"
        aria-label="Vibe for smart shuffle"
        maxLength={300}
        spellCheck={false}
        onChange={(event) => actions.setShuffleOptions({ vibe: event.target.value === "" ? null : event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") onShuffle();
          else if (event.key === "Escape") onLeave();
          else return;
          event.stopPropagation();
          event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function Reshuffle({ busy, onClick, short }: { busy: boolean; onClick(): void; short?: boolean }) {
  return (
    <button type="button" className={`w-rs ${busy ? "w-busy" : ""}`} onClick={onClick} disabled={busy}>
      {busy ? <span className="w-busy-t">{short ? "reading…" : "reading the vibe…"}</span> : <>reshuffle <Kbd>R</Kbd></>}
    </button>
  );
}

export function Session({ data }: { data: SpotifyData }) {
  const session = data.session;
  if (data.shuffling) return <p className="w-session">listening for the order…</p>;
  if (session === null) return null;
  return (
    <p className="w-session">
      {session.tracks.length} from {session.sourceName} · {session.dropped} skip-prone left out
      {session.vibeError === null ? "" : " · the vibe didn't take, so a plain smart shuffle"}
    </p>
  );
}

export function UpNext({ props, cursor, focused, limit, onPick }: { props: SkinProps; cursor: number; focused: boolean; limit?: number; onPick(track: Track): void }) {
  const { data } = props;
  const list = useRef<HTMLOListElement>(null);
  useNearest(list, [cursor, focused]);
  const upcoming = upNext(data).slice(0, limit);
  const vibe = data.session?.options.vibe != null;
  return (
    <ol ref={list} className="w-upn">
      {upcoming.length === 0 ? (
        <li className="w-rest">
          the queue rests here · <Kbd>R</Kbd> to begin again
        </li>
      ) : null}
      {upcoming.map((entry, index) => {
        const tag = tagFor(entry.reason, vibe);
        return (
          <li key={`${entry.track.id}-${index}`} className={focused && index === cursor ? "w-cur" : ""} onClick={() => onPick(entry.track)} title={`Play ${entry.track.name}`}>
            <Cover album={entry.track.album.name} imageUrl={entry.track.album.imageUrl} demo={data.demo} size={26} />
            <div className="w-upn-b">
              <div className="w-t">
                {entry.track.name}
                <span>{artists(entry.track)}</span>
              </div>
              {tag === null ? null : (
                <div className="w-why">
                  <b>{tag}</b>
                  {entry.reason}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const upCount = (data: SpotifyData) => upNext(data).length;

export function Shares({ onShare, keys = true }: { onShare(how: Share): void; keys?: boolean }) {
  return (
    <div className="w-share">
      {SHARES.map(([how, label, key]) => (
        <button key={how} type="button" onClick={() => onShare(how)}>
          {label} {keys ? <Kbd>{key}</Kbd> : null}
        </button>
      ))}
    </div>
  );
}

export function Stats({ data, short }: { data: SpotifyData; short: boolean }) {
  const stats = data.stats;
  if (stats === null) return <p className="w-quiet">counting the hours…</p>;
  if (stats.since === null) return <p className="w-quiet">no history yet · plays are kept while bb runs</p>;
  const [value, unit] = listened(stats.listenedMs7);
  const peak = Math.max(1, ...stats.byWeekday);
  const today = new Date().getDay();
  const top = stats.topArtists[0]?.name;
  const skipped = stats.skipRate30 === null ? null : `${Math.round(stats.skipRate30 * 100)}% skipped`;
  return (
    <>
      <div className="w-big">
        {value}
        <small>{short ? unit.split(" ")[0] : unit}</small>
      </div>
      <div className="w-days-bars">
        {stats.byWeekday.map((ms, day) => (
          <i key={day} className={day === today ? "w-today" : ""} style={{ height: `${Math.max(2, Math.round((ms / peak) * 100))}%` }} title={`${(ms / 3_600_000).toFixed(1)} h`} />
        ))}
      </div>
      <p className="w-stat-p">
        {skipped}
        {skipped && top ? (short ? " · " : <br />) : null}
        {top ? (
          <>
            most {short ? "" : "often "}
            <b>{top}</b>
          </>
        ) : null}
      </p>
    </>
  );
}

export function Devices({ devices, current, cursor, onPick }: { devices: Device[]; current: Device | null; cursor: number; onPick(device: Device): void }) {
  return (
    <ul className="w-dev-m" role="menu">
      {devices.length === 0 ? <li className="w-dev-none">no devices awake · press o to open Spotify</li> : null}
      {devices.map((device, index) => (
        <li key={device.id ?? device.name} role="menuitem" className={`${device.isActive || device.id === current?.id ? "w-on" : ""} ${index === cursor ? "w-cur" : ""}`} onClick={() => onPick(device)}>
          <span>{device.name}</span>
          <small>{device.isActive ? "playing here" : device.type.toLowerCase()}</small>
        </li>
      ))}
    </ul>
  );
}

export function Duck({ duck, short }: { duck: DuckState; short: boolean }) {
  const titles = duck.threads.map((thread) => `‘${thread.title}’`).join(", ");
  return (
    <span className={`w-duck ${duck.active ? "w-on" : ""}`} role="status">
      <span className="w-dot" />
      {duck.active ? (
        <span className="w-trunc">
          <span className="w-note">♪ {duck.mode === "pause" ? "PAUSED" : "LOWERED"}</span> · {short ? "" : duck.threads.length === 1 ? "thread " : "threads "}
          {titles || "a thread"} {duck.threads.length > 1 ? "need" : "needs"} you
        </span>
      ) : (
        <span className="w-trunc">{short ? "♪ at full volume" : "♪ lowers itself when a thread needs you"}</span>
      )}
    </span>
  );
}

export function Volume({ volume, ducked, onChange, label = true }: { volume: number | null; ducked: boolean; onChange(percent: number): void; label?: boolean }) {
  const set = (element: HTMLElement, x: number) => {
    const box = element.getBoundingClientRect();
    if (box.width > 0) onChange(Math.round(Math.max(0, Math.min(1, (x - box.left) / box.width)) * 100));
  };
  return (
    <div className={`w-vol ${ducked ? "w-ducked" : ""}`}>
      {label ? <span>vol</span> : null}
      <div
        className={`w-vol-track ${volume === null ? "w-off" : ""}`}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volume ?? 0}
        onPointerDown={(event) => {
          if (volume === null) return;
          const element = event.currentTarget;
          set(element, event.clientX);
          element.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => volume !== null && event.currentTarget.hasPointerCapture?.(event.pointerId) && set(event.currentTarget, event.clientX)}
      >
        <i style={{ width: `${volume ?? 0}%` }} />
        <b style={{ left: `${volume ?? 0}%` }} />
      </div>
      <span className="w-vol-n">{volume === null ? "–" : ducked ? `${volume} ↓` : volume}</span>
    </div>
  );
}

export function Help({ compact }: { compact: boolean }) {
  return (
    <div className="w-help" role="dialog" aria-label="Keyboard help">
      <div className="w-help-c">
        <h4>Keys</h4>
        <p>Few, and close at hand.</p>
        <dl>
          {HELP.filter(([key]) => compact || key !== "1–4").map(([key, what]) => (
            <div key={key}>
              <dt>
                {key.split("  ").map((group) => (
                  <span key={group}>
                    {group.split(" ").map((part) => (
                      <Kbd key={part}>{part}</Kbd>
                    ))}
                  </span>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <footer>any key or <Kbd>esc</Kbd> to close · <Kbd>⌘⇧S</Kbd> mini player</footer>
      </div>
    </div>
  );
}
