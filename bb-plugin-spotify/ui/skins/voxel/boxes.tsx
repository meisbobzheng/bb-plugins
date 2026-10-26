import { useEffect, useRef, useState } from "react";
import type { Playlist, Stats, Track } from "../../../contract";
import { artists, clock, hours, playlistLength, trackUrl } from "../../format";
import { upNext, type SkinProps } from "../../model";
import { clip, tagFor } from "./pixels";
import { City, Clock, Cover, Icon, Ident, PixelTitle, Pixels, Record, Seek, Volume, VIS_MODES, type VisMode } from "./visuals";

export type Share = "link" | "thread" | "card";
export type Size = "full" | "compact" | "tight";

const pad = (value: number) => String(value).padStart(2, "0");

export function Box({ title, note, hint, focus = false, className = "", children }: { title?: string; note?: React.ReactNode; hint?: React.ReactNode; focus?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section className={`v-box ${focus ? "v-focus" : ""} ${className}`}>
      {title === undefined ? null : (
        <div className="v-bh">
          <Pixels text={clip(title, 18)} shadow />
          {note === undefined ? null : <small>{note}</small>}
          <i className="v-rule" />
          {hint}
        </div>
      )}
      {children}
    </section>
  );
}

export const Kc = ({ children }: { children: React.ReactNode }) => <kbd className="v-kc">{children}</kbd>;

function crumb(data: SkinProps["data"]): string {
  const { track, context, device } = data.player;
  if (track === null) return data.player.status === "no-device" ? "no device · spotify is asleep" : "insert disc";
  const index = (data.selection.tracks ?? []).findIndex((entry) => entry.id === track.id);
  const smart = data.session !== null && data.session.tracks.some((entry) => entry.track.id === track.id);
  return [index >= 0 ? `track ${pad(index + 1)}/${pad(data.selection.tracks!.length)}` : null, smart ? "smart shuffle" : (context?.name ?? context?.kind ?? "single"), device?.name].filter(Boolean).join(" · ");
}

const repeatLabel = (repeat: string) => (repeat === "off" ? "off" : repeat === "track" ? "one" : "all");

function Transport({ props, size, pop }: { props: SkinProps; size: Size; pop: number }) {
  const { data, actions } = props;
  const { player } = data;
  const compact = size !== "full";
  const toggles = (
    <>
      <button type="button" className={`v-btn v-sm ${player.shuffle ? "v-on" : ""}`} data-key="x" onClick={() => actions.setShuffle(!player.shuffle)} aria-pressed={player.shuffle} title="Shuffle (x)">
        <Icon name="shuffle" />
        {size === "tight" ? null : player.shuffle ? "on" : "off"}
      </button>
      <button type="button" className={`v-btn v-sm ${player.repeat === "off" ? "" : "v-on"}`} data-key="r" onClick={actions.cycleRepeat} title="Repeat (r)">
        <Icon name="repeat" />
        {size === "tight" ? null : repeatLabel(player.repeat)}
      </button>
    </>
  );
  return (
    <>
      <div className="v-tp" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" className="v-btn" data-key="p" onClick={actions.previous} aria-label="Previous song" title="Previous (p)">
          <Icon name="prev" />
        </button>
        <button type="button" className="v-btn v-big v-play" data-key="space" onClick={actions.toggle} aria-label={player.isPlaying ? "Pause" : "Play"} title="Play or pause (space)">
          <Icon name={player.isPlaying ? "pause" : "play"} scale={compact ? 2 : 3} />
        </button>
        <button type="button" className="v-btn" data-key="n" onClick={actions.next} aria-label="Next song" title="Next (n)">
          <Icon name="next" />
        </button>
        <button
          type="button"
          className={`v-btn ${player.liked ? "v-on" : ""}`}
          data-key="f"
          onClick={actions.like}
          disabled={player.track === null}
          aria-pressed={player.liked === true}
          aria-label={player.liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
          title="Like (f)"
        >
          <Icon name={player.liked ? "heart" : "heart0"} />
          {pop > 0 ? (
            <span key={pop} className="v-pop">
              +1 ♥
            </span>
          ) : null}
        </button>
        {compact ? (
          <>
            <span className="v-sp" />
            <Volume player={player} label={size === "compact"} onChange={actions.setVolume} />
            {toggles}
          </>
        ) : null}
      </div>
      {compact ? null : (
        <div className="v-volrow">
          <Volume player={player} onChange={actions.setVolume} />
          <span className="v-sp" />
          {toggles}
        </div>
      )}
    </>
  );
}

function NoDevice({ onLaunch }: { onLaunch(): void }) {
  return (
    <div className="v-nodev">
      <span className="v-blink" /> no spotify device is awake
      <button type="button" className="v-btn v-sm" onClick={onLaunch}>
        <Kc>o</Kc>open spotify
      </button>
    </div>
  );
}

export function NowPlaying({ props, size, mode, pop }: { props: SkinProps; size: Size; mode: VisMode; pop: number }) {
  const { data, actions } = props;
  const { player } = data;
  const track = player.track;
  const full = size === "full";
  const year = track?.album.year == null ? "" : ` (${track.album.year})`;
  const view =
    size === "tight" ? null : !full && mode === "off" ? (
      <div className="v-view v-art">
        <Cover track={track} demo={data.demo} scale={6} />
      </div>
    ) : (
      <Record player={player} demo={data.demo} cols={full ? 40 : 26} rows={full ? 21 : 15} labels={full} />
    );
  return (
    <section className={`v-box ${full ? "v-np" : "v-cnp"}`}>
      {view}
      <div className="v-meta">
        <div className="v-crumb">{crumb(data)}</div>
        <PixelTitle text={track?.name ?? "No disc"} scales={full ? [3, 2] : [2]} lines={full ? 2 : 1} />
        {full ? (
          <>
            <div className="v-artist">{track ? artists(track) : "press space to play · or pick a playlist"}</div>
            {player.status === "no-device" ? (
              <NoDevice onLaunch={actions.launchApp} />
            ) : track === null ? null : (
              <div className="v-album">
                <span className="v-trunc">
                  {track.album.name}
                  {year}
                </span>
                <span className={player.liked ? "v-lk" : "v-d"}>
                  <Icon name={player.liked ? "heart" : "heart0"} scale={1} className="v-in" /> {player.liked ? "saved to Liked Songs" : "not saved · f"}
                </span>
              </div>
            )}
            <Seek player={player} cells={34} onSeek={actions.seek} />
            <div className="v-times">
              <b>
                <Clock player={player} />
              </b>
              <Clock player={player} remaining />
              <span>{clock(track?.durationMs ?? 0)}</span>
            </div>
          </>
        ) : (
          <>
            {player.status === "no-device" ? (
              <NoDevice onLaunch={actions.launchApp} />
            ) : (
              <div className="v-artist v-trunc">
                <span>{track ? artists(track) : "press space to play"}</span> <span>{track ? `${track.album.name}${year}` : ""}</span>
              </div>
            )}
            <div className="v-srow">
              <b>
                <Clock player={player} />
              </b>
              <Seek player={player} cells={size === "tight" ? 20 : 30} onSeek={actions.seek} />
              <span>{clock(track?.durationMs ?? 0)}</span>
            </div>
          </>
        )}
        <Transport props={props} size={size} pop={pop} />
      </div>
    </section>
  );
}

export function Spectrum({ props, mode, onMode }: { props: SkinProps; mode: VisMode; onMode(mode: VisMode): void }) {
  return (
    <Box
      title="SPECTRUM"
      note="voxel city"
      className="v-vis"
      hint={
        <div className="v-modes">
          {VIS_MODES.map((entry) => (
            <button key={entry} type="button" className={entry === mode ? "v-on" : ""} onClick={() => onMode(entry)}>
              {entry}
            </button>
          ))}
        </div>
      }
    >
      <City player={props.data.player} mode={mode} palette={props.palette} height={92} />
    </Box>
  );
}

export function ordered(playlists: Playlist[] | null): Playlist[] {
  const all = playlists ?? [];
  return [...all.filter((entry) => entry.readable), ...all.filter((entry) => !entry.readable)];
}

export function LibraryList({ props, playlists, cursor, focused, grid = false, onPick, onPlay }: { props: SkinProps; playlists: Playlist[]; cursor: number; focused: boolean; grid?: boolean; onPick(index: number): void; onPlay(playlist: Playlist): void }) {
  const { data } = props;
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector(".v-cur")?.scrollIntoView({ block: "nearest" });
  }, [cursor, focused]);
  if (data.playlists === null) return <div className="v-msg">loading library…</div>;
  if (playlists.length === 0) return <div className="v-msg">no playlists yet · make one in spotify</div>;
  const firstFollowed = playlists.findIndex((entry) => !entry.readable);
  return (
    <ul ref={list} className={`v-pl ${grid ? "v-grid" : ""}`}>
      {playlists.map((playlist, index) => {
        const playing = data.player.context?.uri === playlist.uri;
        return [
          index === firstFollowed ? (
            <li key="followed" className="v-hdr">
              followed · play only
            </li>
          ) : null,
          <li
            key={playlist.id}
            className={`${data.selection.playlist?.id === playlist.id ? "v-sel" : ""} ${playing ? "v-playing" : ""} ${focused && index === cursor ? "v-cur" : ""}`}
            title={playlist.readable ? `${playlist.name} · double-click to play` : `${playlist.name} · spotify only lets bb play this one`}
            onClick={() => onPick(index)}
            onDoubleClick={() => onPlay(playlist)}
          >
            <Ident seed={playlist.name} liked={playlist.kind === "liked"} />
            <span className="v-nm">
              <span className="v-trunc">{playlist.name}</span>
              {playing ? (
                <span className={`v-eq ${data.player.isPlaying ? "" : "v-still"}`}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
              {playlist.readable ? null : <Icon name="lock" scale={1} className="v-lock" />}
            </span>
            <span className="v-ct">{playlist.trackCount.toLocaleString()}</span>
          </li>,
        ];
      })}
    </ul>
  );
}

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];

function Meter({ fraction }: { fraction: number }) {
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * 10);
  return (
    <div className="v-meter">
      {Array.from({ length: 10 }, (_, index) => (
        <i key={index} className={index < lit ? "v-on" : ""} />
      ))}
    </div>
  );
}

const wholeHours = (ms: number) => `${Math.round(ms / 3_600_000)}H`;

export function StatsBox({ stats }: { stats: Stats | null }) {
  if (stats === null) return <div className="v-msg">loading stats…</div>;
  if (stats.since === null) return <div className="v-msg">no history yet · plays are logged while bb runs</div>;
  const busiest = Math.max(1, ...stats.byWeekday);
  const today = new Date().getDay();
  const top = stats.topArtists[0];
  return (
    <>
      <div className="v-hours">
        <Pixels text={wholeHours(stats.listenedMs7)} scale={3} shadow />
        <span>
          listened
          <br />
          <b>{hours(stats.listenedMs30)}</b> in 30 days
        </span>
      </div>
      <div className="v-week">
        {stats.byWeekday.map((value, day) => (
          <b key={day} className={day === today ? "v-today" : value / busiest > 0.75 ? "v-hot" : ""} title={`${hours(value)} · 30 days`}>
            {Array.from({ length: Math.max(1, Math.round((value / busiest) * 6)) }, (_, index) => (
              <i key={index} />
            ))}
          </b>
        ))}
      </div>
      <div className="v-wkl">
        {WEEK.map((day, index) => (
          <span key={index} className={index === today ? "v-lit" : ""}>
            {day}
          </span>
        ))}
      </div>
      <div className="v-kv">
        <span>skipped</span>
        <b>{stats.skipRate30 === null ? "–" : `${Math.round(stats.skipRate30 * 100)}%`}</b>
      </div>
      <Meter fraction={stats.skipRate30 ?? 0} />
      {top === undefined ? null : (
        <div className="v-kv v-stack">
          <span>top artist</span>
          <b>
            <Ident seed={top.name} />
            <span className="v-trunc">{top.name}</span>
          </b>
        </div>
      )}
      <div className="v-kv">
        <span>plays · 30d</span>
        <b>{stats.plays30.toLocaleString()}</b>
      </div>
    </>
  );
}

export function StatsStrip({ stats }: { stats: Stats | null }) {
  if (stats === null || stats.since === null) return <div className="v-msg">{stats === null ? "loading stats…" : "no history yet · plays are logged while bb runs"}</div>;
  return (
    <div className="v-sstat">
      <div>
        this week<b>{hours(stats.listenedMs7)}</b>
      </div>
      <div>
        skipped<b>{stats.skipRate30 === null ? "–" : `${Math.round(stats.skipRate30 * 100)}%`}</b>
      </div>
      <div>
        top artist<b>{stats.topArtists[0]?.name ?? "–"}</b>
      </div>
    </div>
  );
}

export interface TrackRows {
  tracks: Track[];
  heading: string;
  results: boolean;
  empty: React.ReactNode;
}

export function TrackTable({ props, rows, cursor, focused, album, onPlay, onQueue }: { props: SkinProps; rows: TrackRows; cursor: number; focused: boolean; album: boolean; onPlay(index: number): void; onQueue(track: Track): void }) {
  const { player } = props.data;
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    body.current?.querySelector(".v-sel")?.scrollIntoView({ block: "nearest" });
  }, [cursor, focused]);
  if (rows.tracks.length === 0) return <div className="v-msg">{rows.empty}</div>;
  return (
    <table className="v-tl">
      <colgroup>
        <col style={{ width: 34 }} />
        <col />
        <col style={{ width: album ? "25%" : "32%" }} />
        {album ? <col style={{ width: "24%" }} /> : null}
        <col style={{ width: 50 }} />
        {rows.results ? <col style={{ width: 32 }} /> : null}
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>{rows.heading}</th>
          <th>artist</th>
          {album ? <th>album</th> : null}
          <th>time</th>
          {rows.results ? <th /> : null}
        </tr>
      </thead>
      <tbody ref={body}>
        {rows.tracks.map((track, index) => {
          const current = track.id === player.track?.id;
          const marked = focused && index === cursor;
          return (
            <tr key={`${track.id}-${index}`} className={`${current ? "v-cur" : ""} ${marked ? "v-sel" : ""}`} onClick={() => onPlay(index)}>
              <td className="v-n">{current ? <Icon name={player.isPlaying ? "play" : "pause"} scale={1} className="v-in" /> : marked ? "▸" : pad(index + 1)}</td>
              <td>
                {track.name}
                {current && player.liked ? (
                  <span className="v-lk">
                    <Icon name="heart" scale={1} className="v-in" />
                  </span>
                ) : null}
              </td>
              <td>{artists(track)}</td>
              {album ? <td className="v-al">{track.album.name}</td> : null}
              <td className="v-tm">{clock(track.durationMs)}</td>
              {rows.results ? (
                <td className="v-q">
                  <button
                    type="button"
                    className="v-btn v-xs"
                    aria-label={`Queue ${track.name}`}
                    title="Queue (q)"
                    onClick={(event) => {
                      event.stopPropagation();
                      onQueue(track);
                    }}
                  >
                    <Icon name="plus" scale={1} />
                  </button>
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function tracksNote(props: SkinProps): string {
  const { playlist, tracks, readable, loading } = props.data.selection;
  if (playlist === null) return "";
  if (!readable) return `by ${playlist.owner.toLowerCase()} · play only`;
  if (loading || tracks === null) return `by ${playlist.owner.toLowerCase()}`;
  return `by ${playlist.owner.toLowerCase()} · ${playlistLength(tracks)}`;
}

export function UpNext({ props, compact, onReroll, onLeave }: { props: SkinProps; compact: boolean; onReroll(): void; onLeave(): void }) {
  const { data, actions } = props;
  const options = data.shuffleOptions;
  const session = data.session;
  const vibe = session?.options.vibe != null;
  const upcoming = upNext(data).slice(0, compact ? 8 : 12);
  const [mounted] = useState(Date.now);
  const enter = session !== null && session.createdAt > mounted;
  const field = (
    <label className="v-vibe">
      <span>vibe ▸</span>
      <input
        value={options.vibe ?? ""}
        placeholder="describe a vibe…"
        aria-label="Describe the vibe"
        maxLength={300}
        spellCheck={false}
        onChange={(event) => actions.setShuffleOptions({ vibe: event.target.value === "" ? null : event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onReroll();
            onLeave();
          } else if (event.key === "Escape") onLeave();
          else return;
          event.stopPropagation();
        }}
      />
    </label>
  );
  const reroll = (
    <button type="button" className={`v-btn v-sm ${data.shuffling ? "v-busy" : ""}`} data-key="R" onClick={onReroll} disabled={data.shuffling}>
      <Kc>R</Kc>
      {data.shuffling ? "rolling…" : "reroll"}
    </button>
  );
  const toggles: [string, boolean, () => void][] = [
    ["spread", options.spread, () => actions.setShuffleOptions({ spread: !options.spread })],
    [`fresh ${options.freshDays}d`, options.fresh, () => actions.setShuffleOptions({ fresh: !options.fresh })],
    ["no-skips", options.noSkips, () => actions.setShuffleOptions({ noSkips: !options.noSkips })],
  ];
  return (
    <>
      {compact ? (
        <div className="v-qrow">
          {field}
          {reroll}
        </div>
      ) : (
        field
      )}
      <div className="v-tgs">
        {toggles.map(([label, on, toggle]) => (
          <button key={label} type="button" role="checkbox" aria-checked={on} className={`v-tg ${on ? "v-on" : ""}`} onClick={toggle}>
            <i />
            {label}
          </button>
        ))}
      </div>
      <div className="v-queue" key={session?.id ?? "queue"}>
        {upcoming.length === 0 ? <div className="v-msg">queue is empty · R smart shuffles the selected playlist</div> : null}
        {upcoming.map((entry, index) => {
          const tag = tagFor(entry.reason, vibe);
          return (
            <div key={`${entry.track.id}-${index}`} className={`v-qi ${enter ? "v-enter" : ""}`} style={enter ? { animationDelay: `${Math.min(index, 8) * 70}ms` } : undefined}>
              <span className="v-no">{pad(index + 1)}</span>
              <div className="v-qt">
                <div className="v-trunc">
                  {entry.track.name} <span className="v-d">— {artists(entry.track)}</span>
                </div>
                {tag === null ? null : (
                  <div className="v-why">
                    <span className={`v-tag v-t-${tag}`}>{tag}</span>
                    <span className="v-trunc">{entry.reason}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="v-qf">
        <span className="v-trunc">
          {data.shuffling ? "rolling a new order…" : session === null ? "no smart shuffle yet" : `${session.dropped} skip-prone dropped · ${session.tracks.length} from ${session.sourceName.toLowerCase()}${session.vibeError === null ? "" : " · vibe failed"}`}
        </span>
        {compact ? null : reroll}
      </div>
    </>
  );
}

const SHARES: { how: Share; key: string; icon: "link" | "at" | "card"; label: string }[] = [
  { how: "link", key: "y", icon: "link", label: "copy link" },
  { how: "thread", key: "@", icon: "at", label: "@ thread" },
  { how: "card", key: "c", icon: "card", label: "share card" },
];

export function ShareButtons({ onShare }: { onShare(how: Share): void }) {
  return (
    <div className="v-shr">
      {SHARES.map((share) => (
        <button key={share.how} type="button" className="v-btn" data-key={share.key} onClick={() => onShare(share.how)}>
          <em>{share.key}</em>
          <Icon name={share.icon} />
          {share.label}
        </button>
      ))}
    </div>
  );
}

export function SharePreview({ track, demo }: { track: Track | null; demo: boolean }) {
  if (track === null) return null;
  return (
    <div className="v-card">
      <Cover track={track} demo={demo} scale={2} />
      <div className="v-qt">
        <Pixels text={clip(track.name, 24)} scale={1} className="v-t2" />
        <p>
          {artists(track)} · {trackUrl(track).replace("https://", "")}
        </p>
      </div>
    </div>
  );
}
