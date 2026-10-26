import { useEffect, useRef } from "react";
import type { Device, Playlist, Stats, Track } from "../../../contract";
import { artists, clock, hours, playlistLength } from "../../format";
import { upNext, type SkinProps, type SpotifyData } from "../../model";
import { Arrow, Check, Cover, Icon, Kc, Outline, Plot, type IconName } from "./drawing";
import { nextDays, tagFor, vibeEnds, weekBars } from "./sheet";

export type Share = "link" | "thread" | "card";
export type Found = { query: string; tracks: Track[] | null; error: string | null };

const SHARES: { how: Share; label: string; icon: IconName; key: string }[] = [
  { how: "link", label: "copy link", icon: "link", key: "y" },
  { how: "thread", label: "mention", icon: "at", key: "@" },
  { how: "card", label: "share card", icon: "card", key: "c" },
];

export const repeatWord = (repeat: string) => (repeat === "off" ? "off" : repeat === "track" ? "one" : "all");

export function position(data: SpotifyData): string | null {
  const current = data.player.track?.id;
  const tracks = data.selection.tracks ?? [];
  const index = tracks.findIndex((entry) => entry.id === current);
  return index === -1 ? null : `${String(index + 1).padStart(2, "0")}/${String(tracks.length).padStart(2, "0")}`;
}

function kicker(data: SpotifyData): string {
  const { player } = data;
  if (player.track === null) return "now playing · nothing yet";
  const at = position(data);
  const from = player.context?.name ?? (player.context === null ? "single" : player.context.kind);
  return `${player.isPlaying ? "now playing" : "paused"}${at === null ? "" : ` · track ${at}`} · ${from}`;
}

export function Meta({ props }: { props: SkinProps }) {
  const { data, actions } = props;
  const { player } = data;
  const track = player.track;
  return (
    <div className="g-meta">
      <div className="g-tl">{kicker(data)}</div>
      <div className="g-title">
        <span className="g-tu">
          {track?.name ?? "nothing on the board"}
          <Outline shape="under" tone="red" seed="title" />
        </span>
      </div>
      {track === null ? (
        <div className="g-artist g-soft">{player.status === "no-device" ? "no Spotify device is awake" : "pick a playlist and press ⏎, or space to resume"}</div>
      ) : (
        <div className="g-artist">
          {artists(track)}{" "}
          <span className="g-album">
            — {track.album.name}
            {track.album.year === null ? "" : ` (${track.album.year})`}
          </span>
        </div>
      )}
      {player.status === "no-device" ? (
        <button type="button" className="g-launch" onClick={actions.launchApp}>
          open the Spotify app ↗ <Kc>o</Kc>
        </button>
      ) : track === null ? null : (
        <button type="button" className={`g-saved ${player.liked ? "g-on" : ""}`} onClick={actions.like} aria-pressed={player.liked === true}>
          <Icon name="heart" />
          {player.liked ? "saved to Liked Songs" : "not saved · f to save"}
        </button>
      )}
    </div>
  );
}

export function Art({ track, caption }: { track: Track | null; caption: boolean }) {
  return (
    <figure className="g-art">
      <div className="g-art-box">
        <Cover track={track} />
      </div>
      {caption ? (
        <figcaption className="g-tl">
          fig. 1 — {track === null ? "no cover" : `${track.album.name}${track.album.year === null ? "" : `, ${track.album.year}`}`}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function ShareButtons({ onShare }: { onShare(how: Share): void }) {
  return (
    <div className="g-share">
      {SHARES.map((share) => (
        <button key={share.how} type="button" className="g-sbtn" onClick={() => onShare(share.how)}>
          <Icon name={share.icon} />
          {share.label} <Kc>{share.key}</Kc>
          <Outline seed={share.how} />
        </button>
      ))}
    </div>
  );
}

function Round({ label, keyHint, big = false, on = false, onClick, children }: { label: string; keyHint: string; big?: boolean; on?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" className={`g-tb ${big ? "g-big" : ""} ${on ? "g-on" : ""}`} onClick={onClick} aria-label={label} title={`${label} (${keyHint})`}>
      {children}
      <span className="g-kca">
        <Kc>{keyHint}</Kc>
      </span>
      <Outline shape="circle" seed={label} />
    </button>
  );
}

export function Transport({ props }: { props: SkinProps }) {
  const { data, actions } = props;
  const { isPlaying, liked, track } = data.player;
  return (
    <>
      <Round label="Previous song" keyHint="p" onClick={actions.previous}>
        <Icon name="prev" />
      </Round>
      <Round label={isPlaying ? "Pause" : "Play"} keyHint="space" big onClick={actions.toggle}>
        <Icon name={isPlaying ? "pause" : "play"} />
      </Round>
      <Round label="Next song" keyHint="n" onClick={actions.next}>
        <Icon name="next" />
      </Round>
      <Round label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} keyHint="f" on={liked === true} onClick={() => track !== null && actions.like()}>
        <Icon name="heart" />
      </Round>
    </>
  );
}

function Toggle({ icon, word, state, on, onClick }: { icon: IconName; word: string; state: string; on: boolean; onClick(): void }) {
  return (
    <button type="button" className={`g-st ${on ? "g-on" : ""}`} onClick={onClick} aria-pressed={on} title={`${word} (${icon === "shuffle" ? "x" : "r"})`}>
      <Icon name={icon} />
      <span className="g-w">{word}</span>
      <b>
        {state}
        {on ? <Outline shape="circle" tone="red" seed={word} /> : null}
      </b>
    </button>
  );
}

export function Shuffle({ props }: { props: SkinProps }) {
  const { player } = props.data;
  return <Toggle icon="shuffle" word="shuffle" state={player.shuffle ? "on" : "off"} on={player.shuffle} onClick={() => props.actions.setShuffle(!player.shuffle)} />;
}

export function Repeat({ props }: { props: SkinProps }) {
  const { player } = props.data;
  return <Toggle icon="repeat" word="repeat" state={repeatWord(player.repeat)} on={player.repeat !== "off"} onClick={props.actions.cycleRepeat} />;
}

export function Playlists({ props, list, cursor, focused, columns = false, onPick }: { props: SkinProps; list: Playlist[]; cursor: number | null; focused: boolean; columns?: boolean; onPick(playlist: Playlist): void }) {
  const { data } = props;
  const ul = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (focused) ul.current?.querySelector(".g-cur")?.scrollIntoView({ block: "nearest" });
  }, [cursor, focused]);
  const row = (playlist: Playlist) => {
    const index = list.indexOf(playlist);
    const selected = data.selection.playlist?.id === playlist.id;
    return (
      <li key={playlist.id}>
        <button type="button" className={`g-pl ${focused && index === cursor ? "g-cur" : ""}`} onClick={() => onPick(playlist)} aria-pressed={selected} title={playlist.readable ? playlist.name : `${playlist.name} · play only`}>
          <span className="g-pl-mark">{data.player.context?.uri === playlist.uri ? "♪" : ""}</span>
          <span className="g-pl-n">
            <span className="g-trunc">{playlist.name}</span>
            {playlist.readable ? null : <Icon name="lock" />}
          </span>
          <span className="g-pl-c">{playlist.trackCount.toLocaleString()}</span>
          {selected ? (
            <span className="g-circ">
              <Outline shape="circle" tone="red" seed="circ" />
            </span>
          ) : null}
        </button>
      </li>
    );
  };
  const followed = list.filter((entry) => !entry.readable);
  return (
    <ul ref={ul} className={`g-pls ${columns ? "g-cols" : ""}`}>
      {data.playlists === null ? <li className="g-quiet">sketching the library…</li> : null}
      {data.playlists !== null && list.length === 0 ? <li className="g-quiet">no playlist by that name</li> : null}
      {list.filter((entry) => entry.readable).map(row)}
      {followed.length > 0 ? <li className="g-grp g-tl">followed · play only</li> : null}
      {followed.map(row)}
    </ul>
  );
}

export function Finder({ input, query, onQuery, onSearch, onLeave, onBrowse }: { input: React.RefObject<HTMLInputElement | null>; query: string; onQuery(query: string): void; onSearch(): void; onLeave(): void; onBrowse(): void }) {
  return (
    <label className="g-search">
      <Icon name="search" />
      <input
        ref={input}
        value={query}
        placeholder="search library…"
        spellCheck={false}
        aria-label="Search playlists, or press enter to search Spotify"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSearch();
          else if (event.key === "Escape") onLeave();
          else if (event.key === "ArrowDown") onBrowse();
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      />
      <Kc>s</Kc>
      <Outline seed="search" />
    </label>
  );
}

export function StatsBox({ stats }: { stats: Stats | null }) {
  if (stats === null || stats.since === null)
    return (
      <div className="g-stats">
        <div className="g-tl">this week · listening</div>
        <div className="g-quiet">{stats === null ? "tallying…" : "no history yet · plays are noted while bb runs"}</div>
        <Outline seed="stats" />
      </div>
    );
  const bars = weekBars(stats.byWeekday);
  const top = Math.max(1, ...bars);
  return (
    <div className="g-stats">
      <div className="g-tl">this week · listening</div>
      <div className="g-st-top">
        <div className="g-st-big">
          {hours(stats.listenedMs7).replace(" hr", " h")} <small>played</small>
        </div>
        <div>
          <div className="g-bars">
            {bars.map((value, index) => (
              <span key={index} className="g-bar g-hatch" style={{ height: `${Math.max(2, Math.round((value / top) * 36))}px` }}>
                <Outline seed={`bar${index}`} />
              </span>
            ))}
          </div>
          <div className="g-days">
            {"MTWTFSS".split("").map((day, index) => (
              <span key={index}>{day}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="g-st-line">
        <span>skipped</span>
        <b>{stats.skipRate30 === null ? "–" : `${Math.round(stats.skipRate30 * 100)}%`}</b>
      </div>
      <div className="g-st-line">
        <span>top artist</span>
        <b className="g-trunc">{stats.topArtists[0]?.name ?? "–"}</b>
      </div>
      <Outline seed="stats" />
    </div>
  );
}

export function Tracks({ props, found, cursor, focused, onPlay, onQueue, onClear }: { props: SkinProps; found: Found | null; cursor: number | null; focused: boolean; onPlay(index: number): void; onQueue(track: Track): void; onClear(): void }) {
  const { data, actions } = props;
  const { playlist, readable, loading } = data.selection;
  const box = useRef<HTMLDivElement>(null);
  const current = data.player.track?.id;
  const rows = found !== null ? (found.tracks ?? []) : (data.selection.tracks ?? []);
  useEffect(() => {
    box.current?.querySelector(focused && cursor !== null ? ".g-cur" : ".g-now")?.scrollIntoView({ block: "nearest" });
  }, [cursor, focused, current, found]);
  const empty = (title: string, note: string, action?: React.ReactNode) => (
    <div className="g-ph">
      <div className="g-ph-t">{title}</div>
      <div className="g-tl">{note}</div>
      {action}
    </div>
  );
  const body = () => {
    if (found !== null) {
      if (found.error !== null) return empty("search came back blank", found.error);
      if (found.tracks === null) return empty(`looking up “${found.query}”…`, "sketching results");
      if (found.tracks.length === 0) return empty(`nothing for “${found.query}”`, "try another word · esc clears");
    } else {
      if (playlist === null) return empty("pick a playlist", "its songs get drawn here");
      if (loading) return empty(playlist.name, `${playlist.trackCount.toLocaleString()} tracks · sketching the list…`);
      if (!readable)
        return empty(
          playlist.name,
          "followed · spotify won't list its songs, but it can still play them",
          <button type="button" className="g-sbtn" onClick={() => actions.playPlaylist(playlist)}>
            ▶ play {playlist.name}
            <Outline seed="plplay" />
          </button>,
        );
      if (rows.length === 0) return empty(playlist.name, "this playlist is empty");
    }
    return rows.map((track, index) => {
      const now = track.id === current;
      return (
        <div key={`${track.id}-${index}`} role="button" tabIndex={-1} className={`g-trow ${now ? "g-now" : ""} ${focused && index === cursor ? "g-cur" : ""}`} onClick={() => onPlay(index)}>
          <span className="g-t-n">{now ? (data.player.isPlaying ? "♪" : "❚❚") : String(index + 1).padStart(2, "0")}</span>
          <span className="g-t-t">
            {track.name}
            {now ? <span className="g-nowtag">← now</span> : null}
          </span>
          <span className="g-t-a">{artists(track)}</span>
          <span className="g-t-al">{track.album.name}</span>
          {found !== null ? (
            <button
              type="button"
              className="g-t-q"
              title={`Queue ${track.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onQueue(track);
              }}
            >
              + queue
            </button>
          ) : (
            <span className="g-t-d">{clock(track.durationMs)}</span>
          )}
        </div>
      );
    });
  };
  return (
    <div ref={box} className={`g-tlist ${found !== null ? "g-found" : ""}`}>
      {found !== null ? (
        <div className="g-found-h">
          <span className="g-tl g-trunc">
            {found.tracks === null ? "searching" : `${found.tracks.length} found`} for “{found.query}”
          </span>
          <button type="button" className="g-tl g-link" onClick={onClear}>
            back to {playlist?.name ?? "the list"} · esc
          </button>
        </div>
      ) : null}
      {body()}
    </div>
  );
}

export function tracksCaption(data: SpotifyData, found: Found | null): [string, string] {
  if (found !== null) return ["fig. 3 — search results", "click a row to play"];
  const { playlist, tracks, readable } = data.selection;
  return [`fig. 3 — tracks · ${playlist?.name ?? "none"}`, tracks !== null && readable && tracks.length > 0 ? `click a row to play · ${playlistLength(tracks)}` : ""];
}

function Ck({ on, label, onToggle, extra }: { on: boolean; label: string; onToggle(): void; extra?: React.ReactNode }) {
  return (
    <span className={`g-ck ${on ? "g-on" : ""}`}>
      <button type="button" role="checkbox" aria-checked={on} onClick={onToggle}>
        <span className="g-box">
          <Check />
          <Outline seed={label} />
        </span>
        {label}
      </button>
      {extra}
    </span>
  );
}

export function ShuffleNote({ props, onShuffle, onLeave }: { props: SkinProps; onShuffle(): void; onLeave(): void }) {
  const { data, actions } = props;
  const options = data.session?.options ?? data.shuffleOptions;
  const session = data.session;
  const rules = [options.spread, options.fresh, options.noSkips, options.vibe !== null].filter(Boolean).length;
  const picks = upNext(data).length;
  const source = data.selection.playlist?.readable ? data.selection.playlist.name : "Liked Songs";
  return (
    <div className="g-note">
      <span className="g-tape" />
      <div className="g-note-h g-tl g-ink">smart shuffle · up next</div>
      <label className="g-vibe">
        <span className="g-tl">vibe</span>
        <span className="g-vibe-in">
          <input
            value={data.shuffleOptions.vibe ?? ""}
            placeholder="describe the arc…"
            maxLength={300}
            spellCheck={false}
            aria-label="Vibe"
            onChange={(event) => actions.setShuffleOptions({ vibe: event.target.value === "" ? null : event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") onShuffle();
              else if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              onLeave();
            }}
          />
          <Outline shape="under" seed="vibe" />
        </span>
      </label>
      <div className="g-note-b">
        <div className="g-cks">
          <Ck on={data.shuffleOptions.spread} label="spread" onToggle={() => actions.setShuffleOptions({ spread: !data.shuffleOptions.spread })} />
          <Ck
            on={data.shuffleOptions.fresh}
            label="fresh"
            onToggle={() => actions.setShuffleOptions({ fresh: !data.shuffleOptions.fresh })}
            extra={
              <button type="button" className="g-days-btn" title="Change the fresh window" onClick={() => actions.setShuffleOptions({ freshDays: nextDays(data.shuffleOptions.freshDays) })}>
                {data.shuffleOptions.freshDays}d
              </button>
            }
          />
          <Ck on={data.shuffleOptions.noSkips} label="no-skips" onToggle={() => actions.setShuffleOptions({ noSkips: !data.shuffleOptions.noSkips })} />
        </div>
        <div className="g-note-foot">
          <span className="g-tl">{data.shuffling ? "re-sketching…" : `${rules} rules · ${picks} picks`}</span>
          <button type="button" className="g-resh" onClick={onShuffle} disabled={data.shuffling}>
            ↻ reshuffle <Kc>R</Kc>
            <Outline seed="resh" />
          </button>
        </div>
      </div>
      <div className="g-note-s g-tl">
        {session === null
          ? `draws from ${source}`
          : `${session.tracks.length} from ${session.sourceName} · ${session.dropped} skip-prone dropped${session.vibeError === null ? "" : " · vibe didn't take"}`}
      </div>
    </div>
  );
}

export function Picks({ props, cursor, focused, limit, plot = true, onPlay }: { props: SkinProps; cursor: number | null; focused: boolean; limit?: number; plot?: boolean; onPlay(track: Track): void }) {
  const { data } = props;
  const upcoming = upNext(data).slice(0, limit);
  const vibe = data.session?.options.vibe ?? data.shuffleOptions.vibe;
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(data.session?.id);
  useEffect(() => {
    if (focused) box.current?.querySelector(".g-cur")?.scrollIntoView({ block: "nearest" });
  }, [cursor, focused]);
  return (
    <>
      {plot ? (
        <>
          <div className="g-arc">
            <Plot picks={Math.min(5, upcoming.length)} rising={vibe !== null} ends={vibeEnds(vibe)} />
          </div>
          <div className="g-ann g-ann-q">
            <span>{data.session !== null ? "smart shuffle picks these" : "queued after this one"}</span>
            <Arrow to="down" />
          </div>
        </>
      ) : null}
      <div ref={box} key={data.session?.id ?? "queue"} className={`g-queue ${data.session?.id === first.current ? "" : "g-redraw"}`}>
        {upcoming.length === 0 ? <div className="g-quiet">nothing queued · R sketches a smart shuffle</div> : null}
        {upcoming.map((entry, index) => {
          const tag = tagFor(entry.reason, data.session?.options.vibe != null);
          return (
            <button key={`${entry.track.id}-${index}`} type="button" className={`g-q ${focused && index === cursor ? "g-cur" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 0.09}s` }} onClick={() => onPlay(entry.track)}>
              <span className="g-q-n">{index + 1}</span>
              <span className="g-q-b">
                <span className="g-q-t">
                  {entry.track.name} <span>— {artists(entry.track)}</span>
                </span>
                {tag !== null ? (
                  <span className="g-q-why">
                    <span className={`g-tag g-tag-${tag}`}>
                      {tag}
                      <Outline seed={tag} />
                    </span>
                    <i>{entry.reason}</i>
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function DeviceList({ devices, current, cursor, onPick }: { devices: Device[]; current: Device | null; cursor: number | null; onPick(device: Device): void }) {
  if (devices.length === 0) return <div className="g-quiet">no devices awake · open Spotify somewhere</div>;
  return (
    <>
      {devices.map((device, index) => (
        <button key={device.id ?? device.name} type="button" className={`g-dv ${device.isActive || device.id === current?.id ? "g-on" : ""} ${index === cursor ? "g-cur" : ""}`} disabled={device.id === null} onClick={() => onPick(device)}>
          <span className="g-trunc">{device.name}</span>
          <small>{device.type.toLowerCase()}</small>
        </button>
      ))}
    </>
  );
}

export const HELP: [string, string][] = [
  ["space", "play / pause"],
  ["n · p", "next · previous"],
  ["← → , .", "seek 10 s"],
  ["+ −", "volume"],
  ["j k ⏎", "move · play / open"],
  ["tab", "next list"],
  ["f", "like / unlike"],
  ["s", "search · esc leaves"],
  ["R", "smart reshuffle"],
  ["x · r", "shuffle · repeat"],
  ["y", "copy link"],
  ["@", "mention in thread"],
  ["c", "share card"],
  ["d", "output device"],
  ["o", "open Spotify app"],
  ["1–4", "tabs, when compact"],
  ["b", "pencil boil"],
  ["⌘⇧S", "mini player"],
  ["?", "this legend"],
];

export const LEGEND: [string, string][] = [
  ["space", "play/pause"],
  ["n", "next"],
  ["p", "prev"],
  ["f", "like"],
  ["s", "search"],
  ["R", "reshuffle"],
  ["y", "link"],
  ["@", "mention"],
  ["d", "device"],
  ["?", "help"],
];

export function Help({ onClose }: { onClose(): void }) {
  return (
    <div className="g-help" role="dialog" aria-label="Keyboard legend" onClick={onClose}>
      <div className="g-help-card">
        <div className="g-help-h">Legend — keys</div>
        <div className="g-help-g">
          {HELP.map(([keys, what]) => (
            <div key={keys}>
              <Kc>{keys}</Kc>
              <span>{what}</span>
            </div>
          ))}
        </div>
        <div className="g-help-f g-tl">any key or esc closes</div>
        <Outline seed="help" />
      </div>
    </div>
  );
}
