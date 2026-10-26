import { useEffect, useRef } from "react";
import { LIKED_ID, type Device, type DuckState, type Playlist, type Stats as StatsData, type Track } from "../../../contract";
import { artists, clock } from "../../format";
import { upNext, type SkinProps } from "../../model";
import { nextDays, tagFor, type Hue, type Tag } from "./tubes";
import { Cover, Eq, Icon, vars, type IconName } from "./visuals";

export type Share = "link" | "thread" | "card";

const pad = (value: number) => String(value).padStart(2, "0");

const stop = (run: () => void) => (event: React.MouseEvent) => {
  event.stopPropagation();
  run();
};

function useCursorInView(list: React.RefObject<HTMLElement | null>, cursor: number | null, focused: boolean) {
  useEffect(() => {
    if (focused) list.current?.querySelector(".n-kb")?.scrollIntoView({ block: "nearest" });
  }, [list, cursor, focused]);
}

export function sourceOf(props: SkinProps): { id: string; name: string } {
  const chosen = props.data.selection.playlist;
  return chosen?.readable ? { id: chosen.id, name: chosen.name } : { id: LIKED_ID, name: "Liked Songs" };
}

export function Duck({ duck, short = false }: { duck: DuckState; short?: boolean }) {
  if (!duck.active) return null;
  const titles = duck.threads.map((thread) => `‘${thread.title}’`).join(", ");
  return (
    <div className="n-duck n-ol" role="status" title={titles === "" ? undefined : `${titles} ${duck.threads.length === 1 ? "needs" : "need"} you`}>
      <i className="n-dot" />
      <b>♪ {duck.mode === "pause" ? "paused" : "lowered"}</b>
      {short || titles === "" ? null : (
        <span className="n-tx">
          · {duck.threads.length === 1 ? "thread " : ""}
          {titles} {duck.threads.length === 1 ? "needs" : "need"} you
        </span>
      )}
    </div>
  );
}

export function Library({ props, playlists, cursor, focused, onPick, onPlay }: { props: SkinProps; playlists: Playlist[]; cursor: number; focused: boolean; onPick(index: number): void; onPlay(playlist: Playlist): void }) {
  const { data } = props;
  const list = useRef<HTMLDivElement>(null);
  useCursorInView(list, cursor, focused);
  const row = (playlist: Playlist) => {
    const index = playlists.indexOf(playlist);
    const playing = data.player.context?.uri === playlist.uri;
    return (
      <button
        key={playlist.id}
        type="button"
        className={`n-li ${data.selection.playlist?.id === playlist.id ? "n-sel" : ""} ${focused && index === cursor ? "n-kb" : ""}`}
        title={playlist.readable ? `${playlist.name} · double-click to play` : `${playlist.name} · followed, play only`}
        onClick={() => onPick(index)}
        onDoubleClick={() => onPlay(playlist)}
      >
        <Cover seed={playlist.name} liked={playlist.kind === "liked"} />
        <span className="n-nm">{playlist.name}</span>
        <span className="n-n">
          {playing ? <Eq /> : null}
          {playlist.readable ? playlist.trackCount.toLocaleString() : <span className="n-po">play only</span>}
        </span>
      </button>
    );
  };
  const followed = playlists.filter((entry) => !entry.readable);
  return (
    <div ref={list} className="n-lib">
      {data.playlists === null ? <div className="n-empty">loading playlists…</div> : null}
      {data.playlists !== null && playlists.length === 0 ? <div className="n-empty">no playlists yet · make one in Spotify and it lights up here</div> : null}
      {playlists.filter((entry) => entry.readable).map(row)}
      {followed.length > 0 ? (
        <div className="n-cap n-sub">
          Followed <small>play only</small>
        </div>
      ) : null}
      {followed.map(row)}
    </div>
  );
}

export function Tracks({ props, tracks, cursor, focused, album, onPlay, onShare }: { props: SkinProps; tracks: Track[]; cursor: number; focused: boolean; album: boolean; onPlay(index: number): void; onShare(how: Share, track: Track): void }) {
  const { data, actions } = props;
  const list = useRef<HTMLDivElement>(null);
  useCursorInView(list, cursor, focused);
  const vibe = data.session?.options.vibe != null;
  const tags = new Map<string, Tag>();
  for (const entry of upNext(data).slice(0, 8)) {
    const tag = tagFor(entry.reason, vibe);
    if (tag !== null) tags.set(entry.track.id, tag);
  }
  const current = data.player.track?.id;
  const act = (icon: IconName, label: string, run: () => void, hue: Hue) => (
    <button type="button" className={`n-ab n-${hue}`} title={label} aria-label={label} onClick={stop(run)}>
      <Icon name={icon} />
    </button>
  );
  return (
    <div ref={list} className={`n-rows ${album ? "n-album" : ""}`}>
      <div className="n-row n-th">
        <span className="n-n">#</span>
        <span>Title</span>
        <span>Artist</span>
        {album ? <span>Album</span> : null}
        <span className="n-acts" />
        <span className="n-tm">Time</span>
      </div>
      {tracks.map((track, index) => {
        const tag = tags.get(track.id);
        return (
          <div key={`${track.id}-${index}`} className={`n-row ${track.id === current ? "n-cur" : ""} ${focused && index === cursor ? "n-kb" : ""}`} onClick={() => onPlay(index)}>
            <span className="n-n">{track.id === current ? <Eq /> : pad(index + 1)}</span>
            <span className="n-ti">
              {track.name}
              {tag === undefined ? null : <i className={`n-rdot n-${tag}`} title={`up next · ${tag}`} />}
            </span>
            <span>{artists(track)}</span>
            {album ? <span>{track.album.name}</span> : null}
            <span className="n-acts">
              {act("plus", "Add to queue", () => actions.queue(track), "clear")}
              {act("link", "Copy link", () => onShare("link", track), "uv")}
              {act("at", "Mention in thread", () => onShare("thread", track), "uv")}
              {act("card", "Share card", () => onShare("card", track), "uv")}
            </span>
            <span className="n-tm">{clock(track.durationMs)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Rules({ props, onShuffle, onLeave }: { props: SkinProps; onShuffle(): void; onLeave(): void }) {
  const { data, actions } = props;
  const options = data.shuffleOptions;
  const session = data.session;
  const source = sourceOf(props).name;
  const chip = (on: boolean, hue: Hue, label: string, toggle: () => void) => (
    <button type="button" className={`n-chip n-${hue} ${on ? "n-on" : ""}`} role="switch" aria-checked={on} onClick={toggle}>
      <i />
      {label}
    </button>
  );
  return (
    <div className="n-ss n-glass">
      <label className="n-mood n-ol">
        <span className="n-k">vibe</span>
        <span className="n-q">“</span>
        <input
          value={options.vibe ?? ""}
          placeholder="describe a mood…"
          aria-label="Vibe"
          maxLength={300}
          spellCheck={false}
          onChange={(event) => actions.setShuffleOptions({ vibe: event.target.value === "" ? null : event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") onShuffle();
            else if (event.key !== "Escape") return;
            event.stopPropagation();
            onLeave();
          }}
        />
        <span className="n-q">”</span>
      </label>
      <div className="n-chips">
        {chip(options.spread, "spread", "Spread", () => actions.setShuffleOptions({ spread: !options.spread }))}
        <span className={`n-chip n-fresh n-pair ${options.fresh ? "n-on" : ""}`}>
          <button type="button" role="switch" aria-checked={options.fresh} onClick={() => actions.setShuffleOptions({ fresh: !options.fresh })}>
            <i />
            Fresh
          </button>
          <button type="button" className="n-days" title="Change the fresh window" onClick={() => actions.setShuffleOptions({ freshDays: nextDays(options.freshDays) })}>
            · {options.freshDays}d
          </button>
        </span>
        {chip(options.noSkips, "clear", "No skips", () => actions.setShuffleOptions({ noSkips: !options.noSkips }))}
      </div>
      <div className="n-ss-foot">
        {data.shuffling ? (
          <span className="n-busy">reshuffling {source}…</span>
        ) : session === null ? (
          <span>from {source}</span>
        ) : (
          <span>
            {session.tracks.length} from {session.sourceName} · {session.dropped} skip-prone dropped{session.vibeError === null ? "" : " · vibe failed, plain shuffle"}
          </span>
        )}
        <button type="button" className="n-re" onClick={onShuffle} disabled={data.shuffling}>
          reshuffle <kbd data-k="R">R</kbd>
        </button>
      </div>
    </div>
  );
}

export function Queue({ props, cursor, focused, onPlay }: { props: SkinProps; cursor: number; focused: boolean; onPlay(track: Track): void }) {
  const { data } = props;
  const list = useRef<HTMLDivElement>(null);
  useCursorInView(list, cursor, focused);
  const upcoming = upNext(data).slice(0, 30);
  const vibe = data.session?.options.vibe != null;
  if (upcoming.length === 0) return <div className="n-empty">nothing queued · R smart-shuffles {sourceOf(props).name}</div>;
  return (
    <div ref={list} className="n-queue">
      {upcoming.map((entry, index) => {
        const tag = tagFor(entry.reason, vibe);
        return (
          <div key={`${entry.track.id}-${index}`} className={`n-qi ${focused && index === cursor ? "n-kb" : ""}`} onClick={() => onPlay(entry.track)} title={`Play ${entry.track.name}`}>
            <Cover seed={entry.track.album.name} />
            <span className="n-qm">
              <span className="n-qt">{entry.track.name}</span>
              <span className="n-qa">{artists(entry.track)}</span>
            </span>
            {tag === null ? null : (
              <span className="n-why">
                <b className={`n-tag n-${tag}`}>{tag}</b>
                <span>{entry.reason}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function bigTime(ms: number): [string, string] {
  const hoursValue = ms / 3_600_000;
  if (hoursValue < 1) return [String(Math.round(ms / 60_000)), "m"];
  return [hoursValue < 10 ? hoursValue.toFixed(1).replace(/\.0$/, "") : String(Math.round(hoursValue)), "h"];
}

export function Stats({ stats }: { stats: StatsData | null }) {
  if (stats === null) return <div className="n-stats n-glass n-empty">counting plays…</div>;
  if (stats.since === null) return <div className="n-stats n-glass n-empty">no history yet · plays are recorded while bb runs</div>;
  const [value, unit] = bigTime(stats.listenedMs7);
  const busiest = Math.max(1, ...stats.byWeekday);
  const today = new Date().getDay();
  const skip = stats.skipRate30 === null ? null : Math.round(stats.skipRate30 * 100);
  return (
    <div className="n-stats n-glass">
      <div className="n-cap">
        This week <small>listening</small>
      </div>
      <div className="n-st-big">
        <span className="n-num n-lit n-clear">
          {value}
          <small>{unit}</small>
        </span>
        <span className="n-spark" title="30 days by weekday">
          {stats.byWeekday.map((ms, day) => (
            <i key={day} className={day === today ? "n-today" : ""} style={{ height: 3 + Math.round((ms / busiest) * 24) }} />
          ))}
        </span>
      </div>
      <div className="n-st-row">
        <span>Skipped</span>
        <span className="n-bar">
          <i style={{ width: `${skip ?? 0}%` }} />
        </span>
        <b>{skip === null ? "–" : `${skip}%`}</b>
      </div>
      <div className="n-st-row n-two">
        <span>Top artist</span>
        <b>{stats.topArtists[0]?.name ?? "–"}</b>
      </div>
    </div>
  );
}

const deviceIcon = (device: Device): IconName => (/phone/i.test(device.type) ? "phone" : /computer/i.test(device.type) ? "laptop" : "speaker");

export function Devices({ devices, cursor, onPick }: { devices: Device[]; cursor: number; onPick(device: Device): void }) {
  if (devices.length === 0) return <div className="n-empty">no devices awake · o opens Spotify</div>;
  return (
    <div className="n-devs">
      {devices.map((device, index) => (
        <button key={device.id ?? device.name} type="button" className={`n-dv ${device.isActive ? "n-on" : ""} ${index === cursor ? "n-kb" : ""}`} onClick={() => onPick(device)} disabled={device.id === null}>
          <Icon name={deviceIcon(device)} />
          <span>
            {device.name}
            <small>
              {device.isActive ? "playing here · " : ""}
              {device.type.toLowerCase()}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}

export function ShareButtons({ onShare, keys = false }: { onShare(how: Share): void; keys?: boolean }) {
  const button = (how: Share, icon: IconName, label: string, key: string) => (
    <button type="button" className="n-sbtn n-ol" onClick={() => onShare(how)}>
      <Icon name={icon} />
      {label}
      {keys ? <kbd data-k={key}>{key}</kbd> : null}
    </button>
  );
  return (
    <div className="n-shares">
      {button("link", "link", "Copy link", "y")}
      {button("thread", "at", "Mention in thread", "@")}
      {button("card", "card", "Share card", "c")}
    </div>
  );
}

export function Keycaps({ keys, toast }: { keys: [string, string][]; toast: { id: number; text: string; hue: Hue } | null }) {
  return (
    <div className="n-keys">
      {keys.map(([key, label]) => (
        <span key={key}>
          <kbd data-k={key}>{key}</kbd>
          {label}
        </span>
      ))}
      <span key={toast?.id} className={`n-toast ${toast === null ? "" : "n-show"}`} style={vars({ "--c": `var(--${toast?.hue ?? "play"})` })} role="status">
        {toast?.text}
      </span>
    </div>
  );
}

const HELP: [string, [string, string][]][] = [
  [
    "Playback",
    [
      ["space", "play / pause"],
      ["n p", "next / previous"],
      ["← →", "seek 10 s (also , .)"],
      ["− +", "volume"],
      ["f", "save to Liked Songs"],
      ["x r", "shuffle / repeat"],
    ],
  ],
  [
    "Browse",
    [
      ["j k", "move in the list"],
      ["⏎", "play / open"],
      ["tab", "next pane"],
      ["s", "filter, ⏎ searches Spotify"],
      ["1–4", "compact tabs"],
      ["d", "pick a device"],
    ],
  ],
  [
    "Share & more",
    [
      ["R", "smart reshuffle"],
      ["y", "copy link"],
      ["@", "mention in thread"],
      ["c", "copy share card"],
      ["o", "open the Spotify app"],
      ["⌘⇧S", "mini player"],
    ],
  ],
];

export function Help({ onClose }: { onClose(): void }) {
  return (
    <div className="n-help" role="dialog" aria-label="Keyboard help" onClick={onClose}>
      <div className="n-help-card n-glass">
        <div className="n-help-h">
          <span className="n-lit n-clear">Keys</span>
          <span>any key or esc closes</span>
        </div>
        <div className="n-help-g">
          {HELP.map(([group, rows]) => (
            <div key={group}>
              <div className="n-grp">{group}</div>
              {rows.map(([key, what]) => (
                <div key={key} className="n-hk">
                  <span>{what}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
