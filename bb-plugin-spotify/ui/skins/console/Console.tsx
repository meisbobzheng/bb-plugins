import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Playlist, SearchResult, Track } from "../../../contract";
import { artists, clock, daysAgo, hours, playlistLength } from "../../format";
import { isTyping, transportKey, useKeys } from "../../keys";
import { progressAt, upNext, type MiniProps, type Skin, type SkinProps } from "../../model";
import { useFrame } from "../../spectrum";
import { complete, describeOptions, parseCommand, VISUALIZERS, type ConsoleCommand, type Tab, type Visualizer } from "./commands";
import { AsciiCover, blocksBar, BrailleProgress, sparkline, Spectrum } from "./visuals";
import "./console.css";

type Focus = "playlists" | "bottom";
type Message = { text: string; bad: boolean } | null;
type Layout = "full" | "wide" | "split" | "stack";

const TABS: Tab[] = ["tracks", "stats", "history", "search", "upnext"];
const TAB_LABELS: Record<Tab, string> = { tracks: "tracks", stats: "stats", history: "history", search: "search", upnext: "up next" };

function layoutFor({ width, height }: { width: number; height: number }): Layout {
  if (width === 0) return "full";
  if (width < 620) return "stack";
  if (width >= 900 && height >= 720) return "full";
  return width >= 1100 ? "wide" : "split";
}

function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setSize((value) => (value.width === element.clientWidth && value.height === element.clientHeight ? value : { width: element.clientWidth, height: element.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function tagFor(reason: string | null, vibe: boolean): string | null {
  if (reason === null) return null;
  if (/^(unheard|new to)/.test(reason)) return "fresh";
  return vibe ? "vibe" : "spread";
}

function Pane({ title, keyHint, extra, focused, className, children }: { title: string; keyHint?: string; extra?: React.ReactNode; focused?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <fieldset className={`c-pane ${focused ? "c-focus" : ""} ${className ?? ""}`}>
      <legend>
        <b>{title}</b>
        {keyHint ? <span className="c-f"> [{keyHint}]</span> : null}
        {extra}
      </legend>
      {children}
    </fieldset>
  );
}

type PlaylistsProps = { props: SkinProps; focused: boolean; cursor: number; filter: string | null; onPick(index: number): void };

function PlaylistsPane(playlists: PlaylistsProps) {
  return (
    <Pane title="playlists" keyHint="1" focused={playlists.focused} className="c-side">
      <PlaylistsBody {...playlists} />
    </Pane>
  );
}

function PlaylistsBody({ props, focused, cursor, filter, onPick }: PlaylistsProps) {
  const { data } = props;
  const ul = useRef<HTMLUListElement>(null);
  useEffect(() => {
    ul.current?.querySelector(".c-cur")?.scrollIntoView({ block: "nearest" });
  }, [cursor, focused]);
  const list = visiblePlaylists(data.playlists, filter);
  const library = list.filter((entry) => entry.readable);
  const followed = list.filter((entry) => !entry.readable);
  const row = (playlist: Playlist) => {
    const index = list.indexOf(playlist);
    const playing = data.player.context?.uri === playlist.uri;
    const selected = data.selection.playlist?.id === playlist.id;
    return (
      <li key={playlist.id} className={`${index === cursor && focused ? "c-cur" : ""} ${playing ? "c-playing" : ""} ${selected ? "c-sel" : ""}`} onClick={() => onPick(index)}>
        <span className="c-y">{index === cursor ? "▸" : ""}</span>
        <span className="c-name">{playlist.name}</span>
        <span className="c-d">{playlist.trackCount.toLocaleString()}</span>
      </li>
    );
  };
  return (
    <>
      <div className="c-filter">
        / <span className={filter === null ? "c-f" : ""}>{filter ?? "filter…"}</span>
        {filter !== null ? <span className="c-caret">▏</span> : null}
      </div>
      {data.playlists === null ? <div className="c-d">loading…</div> : null}
      <ul ref={ul} className="c-list">
        {library.length > 0 ? <li className="c-hdr">── library</li> : null}
        {library.map(row)}
        {followed.length > 0 ? <li className="c-hdr">── followed · play only</li> : null}
        {followed.map(row)}
      </ul>
    </>
  );
}

function visiblePlaylists(playlists: Playlist[] | null, filter: string | null): Playlist[] {
  const all = playlists ?? [];
  const needle = filter?.toLowerCase() ?? "";
  const matched = needle === "" ? all : all.filter((entry) => entry.name.toLowerCase().includes(needle));
  return [...matched.filter((entry) => entry.readable), ...matched.filter((entry) => !entry.readable)];
}

function DeviceTag({ player }: { player: SkinProps["data"]["player"] }) {
  return player.device ? <span className="c-g"> ● {player.device.name.toLowerCase()}</span> : <span className="c-r"> ○ no device</span>;
}

function contextLine(data: SkinProps["data"]): string {
  const { track, context } = data.player;
  if (track === null) return "nothing playing";
  const index = (data.selection.tracks ?? []).findIndex((entry) => entry.id === track.id);
  return `${index >= 0 ? `track ${String(index + 1).padStart(2, "0")}/${data.selection.tracks!.length} · ` : ""}${(context?.name ?? context?.kind ?? "single").toLowerCase()}`;
}

function artistLine(player: SkinProps["data"]["player"]): string {
  if (player.track !== null) return artists(player.track);
  return player.status === "no-device" ? "no spotify device · press o to open the app" : "press space to play";
}

function useTicking(player: SkinProps["data"]["player"]): void {
  const [, tick] = useState(0);
  useFrame(() => tick((value) => value + 1), player.isPlaying, 2);
}

function Times({ data, flags = true }: { data: SkinProps["data"]; flags?: boolean }) {
  const { player } = data;
  const smart = data.session !== null && player.track !== null && data.session.tracks.some((entry) => entry.track.id === player.track!.id);
  return (
    <div className="c-times">
      <span>
        {clock(progressAt(player, Date.now()))} <span className="c-f">/</span> {clock(player.track?.durationMs ?? 0)}
      </span>
      {flags ? (
        <span>
          {smart ? "⇄ smart" : player.shuffle ? "⇄ on" : "⇄ off"} · ↻ {player.repeat === "off" ? "off" : player.repeat === "track" ? "one" : "all"} · vol {player.device?.volumePercent ?? "–"}
        </span>
      ) : null}
    </div>
  );
}

function Transport({ data, actions }: { data: SkinProps["data"]; actions: SkinProps["actions"] }) {
  const { isPlaying, liked } = data.player;
  return (
    <span className="c-transport" onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className="c-btn" onClick={actions.previous} aria-label="Previous song" title="Previous song (h)">
        ◂◂
      </button>
      <button type="button" className="c-btn c-btn-main" onClick={actions.toggle} aria-label={isPlaying ? "Pause" : "Play"} title="Play or pause (space)">
        {isPlaying ? "❚❚" : "▶"}
      </button>
      <button type="button" className="c-btn" onClick={actions.next} aria-label="Next song" title="Next song (l)">
        ▸▸
      </button>
      <button type="button" className={`c-btn ${liked ? "c-y" : ""}`} onClick={actions.like} aria-pressed={Boolean(liked)} aria-label="Save to Liked Songs" title="Save to Liked Songs (f)">
        {liked ? "♥" : "♡"}
      </button>
    </span>
  );
}

function NowStrip({ props, tight }: { props: SkinProps; tight: boolean }) {
  const { data, actions } = props;
  const { player } = data;
  const track = player.track;
  useTicking(player);
  return (
    <Pane title="now playing" className="c-strip" extra={<DeviceTag player={player} />}>
      <div className="c-np">
        {tight ? null : <AsciiCover player={player} demo={data.demo} cols={14} rows={7} />}
        <div className="c-meta">
          <div className="c-head">
            <span className="c-trunc">
              <b className="c-title">{track?.name ?? "—"}</b> <span className="c-artist">{artistLine(player)}</span>
            </span>
            <Transport data={data} actions={actions} />
          </div>
          {tight ? null : (
            <div className="c-d c-trunc">
              {contextLine(data)}
              {track === null ? "" : ` · ${track.album.name.toLowerCase()}${track.album.year === null ? "" : ` (${track.album.year})`}`}
            </div>
          )}
          <div className="c-seek">
            <BrailleProgress player={player} onSeek={actions.seek} />
            <Times data={data} flags={!tight} />
          </div>
        </div>
      </div>
    </Pane>
  );
}

function NowPlaying({ props }: { props: SkinProps }) {
  const { data, actions } = props;
  const { player } = data;
  const track = player.track;
  useTicking(player);
  return (
    <Pane title="now playing" extra={<DeviceTag player={player} />}>
      <div className="c-np">
        <AsciiCover player={player} demo={data.demo} />
        <div className="c-meta">
          <div className="c-d">{contextLine(data)}</div>
          <div className="c-title">{track?.name ?? "—"}</div>
          <div className="c-artist">{artistLine(player)}</div>
          {track === null ? null : (
            <table className="c-kv">
              <tbody>
                <tr>
                  <td>album</td>
                  <td>
                    {track.album.name}
                    {track.album.year === null ? "" : ` (${track.album.year})`}
                  </td>
                </tr>
                <tr>
                  <td>saved</td>
                  <td>{player.liked ? <span className="c-y">♥ liked songs</span> : <span className="c-d">♡ not saved · f</span>}</td>
                </tr>
                {track.url === null ? null : (
                  <tr>
                    <td>link</td>
                    <td className="c-b c-trunc">{track.url.replace("https://", "")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <BrailleProgress player={player} onSeek={actions.seek} />
          <Times data={data} />
        </div>
      </div>
    </Pane>
  );
}

function UpNext({ props }: { props: SkinProps }) {
  return (
    <Pane title="up next" className="c-side" extra={<span className="c-y"> smart shuffle</span>}>
      <UpNextBody props={props} limit={6} />
    </Pane>
  );
}

function UpNextBody({ props, limit }: { props: SkinProps; limit?: number }) {
  const { data } = props;
  const upcoming = upNext(data).slice(0, limit);
  const vibe = data.session?.options.vibe != null;
  const options = data.session?.options ?? data.shuffleOptions;
  return (
    <>
      <div className="c-cmd">
        <span className="c-y">:shuffle</span> {describeOptions(options) || <span className="c-d">plain</span>}
        {data.shuffling ? <span className="c-g"> · shuffling…</span> : null}
      </div>
      {upcoming.length === 0 ? <div className="c-d">queue is empty · R smart shuffles the selected playlist</div> : null}
      {upcoming.map((entry, position) => {
        const tag = tagFor(entry.reason, vibe);
        return (
          <div className="c-qrow" key={`${entry.track.id}-${position}`}>
            <span className="c-d">{position + 1}.</span>
            <span>
              <span className="c-trunc">
                {entry.track.name} <span className="c-d">— {artists(entry.track)}</span>
              </span>
              {tag !== null ? (
                <span className="c-why">
                  <span className={`c-tag c-tag-${tag}`}>{tag}</span> {entry.reason}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
      <div className="c-d c-foot">
        {data.session !== null ? `${data.session.tracks.length} in session · ${data.session.dropped} skip-prone dropped · ` : ""}
        <span className="c-y">R</span> reshuffle · <span className="c-y">e</span> edit
      </div>
    </>
  );
}

function TracksTable({ props, tracks, cursor, focused, album, share, onPick, emptyText }: { props: SkinProps; tracks: Track[]; cursor: number; focused: boolean; album: boolean; share: boolean; onPick(index: number): void; emptyText: string }) {
  const current = props.data.player.track?.id;
  const list = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    list.current?.querySelector(".c-cur")?.scrollIntoView({ block: "nearest" });
  }, [cursor, album]);
  if (tracks.length === 0) return <div className="c-d c-empty">{emptyText}</div>;
  return (
    <table className="c-tl">
      <colgroup>
        <col style={{ width: 38 }} />
        <col />
        <col style={{ width: album ? "22%" : "34%" }} />
        {album ? <col style={{ width: "24%" }} /> : null}
        <col style={{ width: 60 }} />
        {share ? <col style={{ width: 230 }} /> : null}
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>title</th>
          <th>artist</th>
          {album ? <th>album</th> : null}
          <th>time</th>
          {share ? <th>share</th> : null}
        </tr>
      </thead>
      <tbody ref={list}>
        {tracks.map((track, index) => (
          <tr key={`${track.id}-${index}`} className={`${index === cursor && focused ? "c-cur" : ""} ${track.id === current ? "c-now" : ""}`} onClick={() => onPick(index)} onDoubleClick={() => onPick(index)}>
            <td className="c-n">{track.id === current ? "▶" : String(index + 1).padStart(2, "0")}</td>
            <td>{track.name}</td>
            <td>{artists(track)}</td>
            {album ? <td>{track.album.name}</td> : null}
            <td className="c-n">{clock(track.durationMs)}</td>
            {share ? <td className="c-hint">{index === cursor && focused ? "yy link · @ thread · C card · q queue" : ""}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatsView({ props }: { props: SkinProps }) {
  const stats = props.data.stats;
  if (stats === null) return <div className="c-d c-empty">loading stats…</div>;
  if (stats.since === null) return <div className="c-d c-empty">no history yet · plays are recorded while bb is running</div>;
  const top = stats.topArtists[0]?.listenedMs ?? 1;
  return (
    <div className="c-stats">
      <div>
        <div className="c-d">since {new Date(stats.since).toLocaleDateString()}</div>
        <div>
          <span className="c-y">{hours(stats.listenedMs7)}</span> <span className="c-d">this week</span>
        </div>
        <div>
          <span className="c-y">{hours(stats.listenedMs30)}</span> <span className="c-d">this month · {stats.plays30} plays</span>
        </div>
        <div>
          <span className="c-y">{stats.skipRate30 === null ? "–" : `${Math.round(stats.skipRate30 * 100)}%`}</span> <span className="c-d">skipped</span>
        </div>
        <div className="c-d c-gap">by hour</div>
        <div className="c-b">{sparkline(stats.byHour)}</div>
        <div className="c-f">0     6     12    18   23</div>
        {stats.forgotten.length > 0 ? (
          <>
            <div className="c-d c-gap">forgotten</div>
            {stats.forgotten.map((entry) => (
              <div key={entry.playlistId}>
                {entry.name} <span className="c-d">· {entry.lastPlayedAt === null ? "never played here" : daysAgo(entry.lastPlayedAt)}</span>
              </div>
            ))}
          </>
        ) : null}
      </div>
      <div>
        <div className="c-d">top artists · 30 days</div>
        {stats.topArtists.slice(0, 8).map((artist) => (
          <div key={artist.name} className="c-bar">
            <span className="c-trunc">{artist.name}</span>
            <span className="c-y">{blocksBar(artist.listenedMs / top, 18)}</span>
            <span className="c-d">{hours(artist.listenedMs)}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="c-d">top songs · 30 days</div>
        {stats.topTracks.slice(0, 8).map((entry) => (
          <div key={entry.track.id} className="c-trunc">
            <span className="c-y">{String(entry.plays).padStart(3, " ")}×</span> {entry.track.name} <span className="c-d">— {artists(entry.track)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsolePage(props: SkinProps) {
  const { data, actions, palette } = props;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState<Focus>("bottom");
  const [tab, setTab] = useState<Tab>("tracks");
  const [cursor, setCursor] = useState({ playlists: 0, bottom: 0 });
  const [filter, setFilter] = useState<string | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [visualizer, setVisualizer] = useState<Visualizer>("bars");
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [help, setHelp] = useState(false);
  const lastY = useRef(0);
  const layout = layoutFor(useSize(root));
  const tabs = layout === "full" || layout === "wide" ? TABS.filter((name) => name !== "upnext") : TABS;
  const shown = tabs.includes(tab) ? tab : "tracks";

  const playlists = useMemo(() => visiblePlaylists(data.playlists, filter), [data.playlists, filter]);
  const bottomTracks: Track[] =
    shown === "tracks" ? (data.selection.tracks ?? []) : shown === "history" ? data.recent.map((play) => play.track) : shown === "search" ? (search?.tracks ?? []) : [];
  const cursorTrack = focus === "bottom" ? bottomTracks[cursor.bottom] : undefined;
  const subject = cursorTrack ?? data.player.track ?? null;

  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const index = playlists.findIndex((entry) => entry.id === data.selection.playlist?.id);
    if (index !== -1) setCursor((value) => ({ ...value, playlists: index }));
  }, [data.selection.playlist?.id]);

  const say = (text: string, bad = false) => setMessage({ text, bad });

  const pickPlaylist = (index: number) => {
    const playlist = playlists[index];
    if (playlist === undefined) return;
    setCursor((value) => ({ ...value, playlists: index, bottom: 0 }));
    actions.select(playlist.id);
    setTab("tracks");
    if (layout === "stack") setFocus("bottom");
    if (!playlist.readable) say(`${playlist.name.toLowerCase()} · spotify only lists playlists you own · p plays it`);
  };

  const playAt = (index: number) => {
    const track = bottomTracks[index];
    if (track === undefined) return;
    setCursor((value) => ({ ...value, bottom: index }));
    if (shown === "tracks" && data.selection.playlist !== null) actions.playPlaylist(data.selection.playlist, track);
    else actions.playTrack(track);
    say(`playing ${track.name.toLowerCase()}`);
  };

  const share = (how: "link" | "uri" | "card" | "thread", track: Track | null) => {
    if (track === null) return say("nothing to share", true);
    if (how === "link") actions.copyLink(track);
    if (how === "uri") actions.copyUri(track);
    if (how === "card") actions.shareCard(track, root.current);
    if (how === "thread") actions.mention(track);
    say(`${how === "thread" ? "mentioned" : "yanked"} ${track.name.toLowerCase()}`);
  };

  const run = (parsed: ConsoleCommand) => {
    switch (parsed.kind) {
      case "play": {
        if (parsed.playlist === null) return actions.toggle();
        const needle = parsed.playlist.toLowerCase().replace(/[^a-z0-9]/g, "");
        const match = (data.playlists ?? []).find((entry) => entry.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle));
        if (match === undefined) return say(`no playlist matches "${parsed.playlist}"`, true);
        actions.playPlaylist(match);
        return say(`playing ${match.name.toLowerCase()}`);
      }
      case "pause":
        return data.player.isPlaying ? actions.toggle() : undefined;
      case "next":
        return actions.next();
      case "previous":
        return actions.previous();
      case "volume":
        return actions.setVolume(parsed.percent);
      case "seek":
        return actions.seek(parsed.ms);
      case "shuffle": {
        const sourceId = data.selection.playlist?.readable ? data.selection.playlist.id : data.shuffleOptions.sourceId;
        actions.smartShuffle({ ...parsed.patch, sourceId });
        return say(`smart shuffling ${(data.selection.playlist?.name ?? "liked songs").toLowerCase()}…`);
      }
      case "like":
        return parsed.liked === Boolean(data.player.liked) ? say(parsed.liked ? "already saved" : "not saved") : actions.like();
      case "share":
        return share(parsed.how, subject);
      case "search":
        say(`searching ${parsed.query}…`);
        return void actions.search(parsed.query).then(
          (result) => {
            setSearch(result);
            setTab("search");
            setFocus("bottom");
            setCursor((value) => ({ ...value, bottom: 0 }));
            say(`${result.tracks.length} songs for "${parsed.query}"`);
          },
          (cause: unknown) => say(cause instanceof Error ? cause.message : String(cause), true),
        );
      case "repeat":
        return actions.cycleRepeat();
      case "tab":
        setTab(parsed.tab);
        return setFocus("bottom");
      case "visualizer":
        return setVisualizer(parsed.mode);
      case "open":
        return actions.launchApp();
      case "help":
        return setHelp(true);
    }
  };

  const submitCommand = () => {
    const parsed = parseCommand(command ?? "");
    setCommand(null);
    root.current?.focus();
    if ("error" in parsed) say(parsed.error, true);
    else run(parsed);
  };

  const move = (delta: number) =>
    setCursor((value) => {
      const length = focus === "playlists" ? playlists.length : bottomTracks.length;
      const key = focus;
      return { ...value, [key]: Math.max(0, Math.min(length - 1, value[key] + delta)) };
    });

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (help) {
        setHelp(false);
        return true;
      }
      if (filter !== null) {
        if (event.key === "Escape") setFilter(null);
        else if (event.key === "Enter") {
          pickPlaylist(cursor.playlists);
          setFilter(null);
        } else if (event.key === "Backspace") setFilter((value) => (value ?? "").slice(0, -1));
        else if (event.key.length === 1) {
          setFilter((value) => `${value ?? ""}${event.key}`);
          setCursor((value) => ({ ...value, playlists: 0 }));
        } else return false;
        return true;
      }
      if (transportKey(event, data, actions)) return true;
      switch (event.key) {
        case "j":
        case "ArrowDown":
          move(1);
          return true;
        case "k":
        case "ArrowUp":
          move(-1);
          return true;
        case "g":
          setCursor((value) => ({ ...value, [focus]: 0 }));
          return true;
        case "G":
          setCursor((value) => ({ ...value, [focus]: Math.max(0, (focus === "playlists" ? playlists.length : bottomTracks.length) - 1) }));
          return true;
        case "Tab":
          setFocus((value) => (value === "playlists" ? "bottom" : "playlists"));
          return true;
        case "Enter":
          if (focus === "playlists") pickPlaylist(cursor.playlists);
          else playAt(cursor.bottom);
          return true;
        case "p": {
          const playlist = focus === "playlists" ? playlists[cursor.playlists] : data.selection.playlist;
          if (playlist) {
            actions.playPlaylist(playlist);
            say(`playing ${playlist.name.toLowerCase()}`);
          }
          return true;
        }
        case "h":
          actions.previous();
          return true;
        case "l":
          actions.next();
          return true;
        case "f":
          actions.like();
          return true;
        case "y": {
          const now = performance.now();
          if (now - lastY.current < 450) share("link", subject);
          lastY.current = now;
          return true;
        }
        case "Y":
          share("uri", subject);
          return true;
        case "@":
          share("thread", subject);
          return true;
        case "C":
          share("card", subject);
          return true;
        case "q":
          if (cursorTrack) {
            actions.queue(cursorTrack);
            say(`queued ${cursorTrack.name.toLowerCase()}`);
          }
          return true;
        case "R":
          run({ kind: "shuffle", patch: {} });
          return true;
        case "e":
          setCommand(`:shuffle ${describeOptions(data.session?.options ?? data.shuffleOptions)}`);
          return true;
        case "v":
          setVisualizer((value) => VISUALIZERS[(VISUALIZERS.indexOf(value) + 1) % VISUALIZERS.length]!);
          return true;
        case "/":
          setFocus("playlists");
          setFilter("");
          return true;
        case "s":
          setCommand(":search ");
          return true;
        case ":":
          setCommand(":");
          return true;
        case "?":
          setHelp(true);
          return true;
        case "o":
          actions.launchApp();
          return true;
        case "1":
          setFocus("playlists");
          return true;
        case "2":
        case "3":
        case "4":
        case "5":
        case "6": {
          const next = tabs[Number(event.key) - 2];
          if (next === undefined) return false;
          setTab(next);
          setFocus("bottom");
          setCursor((value) => ({ ...value, bottom: 0 }));
          return true;
        }
        default:
          return false;
      }
    },
    [help, filter, data, actions, focus, cursor, playlists, bottomTracks, subject, cursorTrack, tabs, layout],
  );
  useKeys(root, onKey);

  useEffect(() => {
    if (command !== null) input.current?.focus();
  }, [command !== null]);

  const ghost = command === null ? null : complete(command);
  const mode = command !== null ? "COMMAND" : filter !== null ? "FILTER" : "NORMAL";
  const volume = data.player.device?.volumePercent ?? 0;
  const full = layout === "full";
  const stack = layout === "stack";
  const listing = stack && focus === "playlists";
  const pickTab = (name: Tab) => (setTab(name), setFocus("bottom"));
  const playlistsProps: PlaylistsProps = { props, focused: focus === "playlists", cursor: cursor.playlists, filter, onPick: (index) => (setFocus("playlists"), pickPlaylist(index)) };

  return (
    <div ref={root} tabIndex={0} data-layout={layout} className={`sp-console c-${palette}${full ? "" : " c-compact"}`} onMouseDown={(event) => !isTyping(event.target) && event.currentTarget.focus({ preventScroll: true })}>
      <div className="c-grid">
        {full ? (
          <>
            <PlaylistsPane {...playlistsProps} />
            <NowPlaying props={props} />
            <UpNext props={props} />
            <Pane title="spectrum" keyHint="v" className="c-wide" extra={<span className="c-d"> · {visualizer}</span>}>
              <Spectrum player={data.player} mode={visualizer} />
            </Pane>
          </>
        ) : (
          <>
            <NowStrip props={props} tight={stack} />
            {stack ? null : <PlaylistsPane {...playlistsProps} />}
          </>
        )}
        <Pane
          title={listing ? "playlists" : shown === "tracks" ? (data.selection.playlist?.name.toLowerCase() ?? "tracks") : TAB_LABELS[shown]}
          className={full ? "c-wide c-bottom" : "c-bottom"}
          focused={focus === "bottom" || stack}
          extra={
            <span className="c-d">
              {!listing && shown === "tracks" && data.selection.tracks ? ` · ${data.selection.tracks.length} tracks · ${playlistLength(data.selection.tracks)}` : ""}
              {full
                ? tabs.map((name, index) => (
                    <span key={name} className={name === shown ? "c-y" : "c-f"} onClick={() => pickTab(name)}>
                      {"  "}[{index + 2}] {TAB_LABELS[name]}
                    </span>
                  ))
                : null}
            </span>
          }
        >
          {full ? null : (
            <div className="c-tabs" role="tablist">
              {stack ? (
                <button type="button" role="tab" aria-selected={listing} className={listing ? "c-on" : ""} onClick={() => setFocus("playlists")}>
                  [1] playlists
                </button>
              ) : null}
              {tabs.map((name, index) => (
                <button key={name} type="button" role="tab" aria-selected={!listing && name === shown} className={!listing && name === shown ? "c-on" : ""} onClick={() => pickTab(name)}>
                  [{index + 2}] {TAB_LABELS[name]}
                </button>
              ))}
            </div>
          )}
          <div className="c-scroll">
            {listing ? (
              <PlaylistsBody {...playlistsProps} />
            ) : shown === "stats" ? (
              <StatsView props={props} />
            ) : shown === "upnext" ? (
              <UpNextBody props={props} />
            ) : (
              <TracksTable
                props={props}
                tracks={bottomTracks}
                cursor={cursor.bottom}
                focused={focus === "bottom"}
                album={full || layout === "wide"}
                share={full}
                onPick={(index) => (setFocus("bottom"), playAt(index))}
                emptyText={
                  shown === "tracks"
                    ? data.selection.loading
                      ? "loading…"
                      : data.selection.readable
                        ? "this playlist is empty"
                        : "spotify only lists songs of playlists you own or collaborate on · press p to play it"
                    : shown === "search"
                      ? "press s to search spotify"
                      : "no plays recorded yet"
                }
              />
            )}
          </div>
        </Pane>
        {layout === "wide" ? <UpNext props={props} /> : null}
      </div>
      <div className="c-status">
        <span className="c-mode">{mode}</span>
        {full ? (
          <>
            <span className="c-seg">spotify</span>
            <span className="c-trunc">
              {data.player.isPlaying ? "▶" : "❚❚"} {data.player.track ? `${data.player.track.name} — ${artists(data.player.track)}` : "nothing playing"}
            </span>
          </>
        ) : null}
        <span className="c-grow" />
        {data.player.duck.active ? (
          <span className="c-r c-trunc">
            ♪ {data.player.duck.mode === "pause" ? "paused" : "lowered"} · {data.player.duck.threads.map((thread) => thread.title.toLowerCase()).join(", ")} needs you
          </span>
        ) : null}
        <span className="c-d c-trunc">{data.demo ? "preview" : (data.player.device?.name.toLowerCase() ?? "no device")}</span>
        {stack ? null : <span className="c-d">vol {blocksBar(volume / 100, 10)}</span>}
        <span className="c-seg">? help</span>
      </div>
      <div className="c-cmdline">
        {command === null ? (
          <span className={message?.bad ? "c-r" : "c-g"}>{message?.text ?? ""}</span>
        ) : (
          <div className="c-input">
            {ghost !== null ? <span className="c-ghost">:{ghost}</span> : null}
            <input
              ref={input}
              value={command}
              spellCheck={false}
              aria-label="Command"
              onChange={(event) => setCommand(event.target.value.startsWith(":") ? event.target.value : `:${event.target.value}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitCommand();
                else if (event.key === "Escape") {
                  setCommand(null);
                  root.current?.focus();
                } else if (event.key === "Tab" && ghost !== null) {
                  event.preventDefault();
                  setCommand(`:${ghost}`);
                } else return;
                event.stopPropagation();
              }}
              onBlur={() => setCommand(null)}
            />
          </div>
        )}
      </div>
      {help ? <Help tabs={tabs} spectrum={full} /> : null}
    </div>
  );
}

function Help({ tabs, spectrum }: { tabs: Tab[]; spectrum: boolean }) {
  const rows: [string, string][] = [
    ["j k / ↑ ↓", "move"],
    ["tab", "switch pane"],
    ["⏎", "open playlist / play song"],
    ["p", "play playlist"],
    ["space", "play or pause"],
    ["h l", "previous / next"],
    [", .", "seek 10s"],
    ["+ -", "volume"],
    ["f", "save to liked songs"],
    ["yy  Y", "copy link / uri"],
    ["@", "mention in thread"],
    ["C", "share card"],
    ["q", "queue song"],
    ["R  e", "smart shuffle / edit flags"],
    ["/", "filter playlists"],
    ["s", "search spotify"],
    [`1  2-${tabs.length + 1}`, ["playlists", ...tabs.map((name) => TAB_LABELS[name])].join(" · ")],
    ["o", "open the spotify app"],
    ...(spectrum ? [["v", "cycle visualizer"] as [string, string]] : []),
    [":", "commands (:play, :vibe, :vol, :seek, :share…)"],
    ["⌘⇧S", "mini player anywhere in bb"],
  ];
  return (
    <div className="c-help" role="dialog" aria-label="Keyboard help">
      <fieldset className="c-pane c-focus">
        <legend>
          <b>keys</b> <span className="c-f">any key closes</span>
        </legend>
        <div className="c-help-rows">
          {rows.map(([keys, what]) => (
            <div key={keys} className="c-help-row">
              <span className="c-y">{keys}</span>
              <span>{what}</span>
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function ConsoleMini({ data, actions, palette, close }: MiniProps) {
  const root = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);
  useFrame(() => tick((value) => value + 1), data.player.isPlaying, 2);
  const lastY = useRef(0);
  const track = data.player.track;
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      if (event.key === "h") actions.previous();
      else if (event.key === "l") actions.next();
      else if (event.key === "f") actions.like();
      else if (event.key === "@" && track) actions.mention(track);
      else if (event.key === "o") actions.openPage();
      else if (event.key === "y" && track) {
        if (performance.now() - lastY.current < 450) actions.copyLink(track);
        lastY.current = performance.now();
      } else if (event.key === "q") close();
      else return false;
      return true;
    },
    [data, actions, track, close],
  );
  useKeys(root, onKey);
  return (
    <div ref={root} tabIndex={0} className={`sp-console c-${palette} c-mini`}>
      <span className="c-mode" data-sp-drag="" title="Drag to move">
        ♫
      </span>
      <button type="button" className="c-mini-btn" onClick={actions.toggle} aria-label={data.player.isPlaying ? "Pause" : "Play"}>
        {data.player.isPlaying ? "▶" : "❚❚"}
      </button>
      <button type="button" className="c-mini-title c-trunc" onClick={actions.openPage} title="Open the Spotify page">
        <b className="c-y">{track?.name ?? "nothing playing"}</b> <span className="c-b2">{track ? artists(track) : ""}</span>
      </button>
      <Spectrum player={data.player} mode="bars" mini />
      <span className="c-d">
        {clock(progressAt(data.player, Date.now()))}/{clock(track?.durationMs ?? 0)}
      </span>
      <span className="c-f c-mini-keys">h ◂ space ▸ l · yy · @ · f{data.player.liked ? " ♥" : ""}</span>
      <button type="button" className="c-mini-btn c-f" onClick={close} aria-label="Close the mini player">
        ×
      </button>
    </div>
  );
}

export const consoleSkin: Skin = { id: "console", Page: ConsolePage, Mini: ConsoleMini };
