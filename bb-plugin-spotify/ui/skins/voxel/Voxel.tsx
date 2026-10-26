import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LIKED_ID, PALETTE_NAMES, PALETTES, type SearchResult, type Track } from "../../../contract";
import { artists } from "../../format";
import { isTyping, transportKey, useKeys } from "../../keys";
import { progressAt, type MiniProps, type Skin, type SkinProps } from "../../model";
import { Box, Kc, LibraryList, NowPlaying, ordered, ShareButtons, SharePreview, Spectrum, StatsBox, StatsStrip, TrackTable, tracksNote, UpNext, type Share, type Size, type TrackRows } from "./boxes";
import { clip } from "./pixels";
import { City, Clock, Cover, Icon, Pixels, Seek, VIS_MODES, type VisMode } from "./visuals";
import "./voxel.css";

type Focus = "library" | "tracks";
type Message = { id: number; text: string } | null;

const TABS = ["tracks", "up next", "library", "share · stats"];

const HELP: [string, string][] = [
  ["space", "play / pause"],
  ["n  p", "next / previous"],
  ["← →  , .", "seek ±10s"],
  ["+  -", "volume"],
  ["j k ⏎", "move · play / open"],
  ["tab", "library ⇄ tracks"],
  ["f", "like ♥"],
  ["s", "search · esc leaves"],
  ["q", "queue the row"],
  ["R", "reroll smart shuffle"],
  ["x  r", "shuffle · repeat"],
  ["y", "copy link"],
  ["@", "mention in thread"],
  ["c", "share card"],
  ["d", "device picker"],
  ["o", "open spotify app"],
  ["v", "visualizer mode"],
  ["1–4", "compact tabs"],
  ["⌘⇧S", "mini player"],
  ["?  esc", "help · close"],
];

const toneOf = (palette: string) => ((PALETTES.voxel as readonly string[]).includes(palette) ? palette : PALETTES.voxel[0]);

function sizeFor({ width, height }: { width: number; height: number }): Size {
  if (width === 0) return "full";
  if (width < 520 || height < 360) return "tight";
  return width >= 1024 && height >= 640 ? "full" : "compact";
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

function press(root: HTMLElement | null, key: string) {
  root?.querySelectorAll(`[data-key="${key}"]`).forEach((button) => {
    button.classList.add("v-press");
    setTimeout(() => button.classList.remove("v-press"), 140);
  });
}

function Duck({ props, short }: { props: SkinProps; short: boolean }) {
  const { duck } = props.data.player;
  if (!duck.active) return duck.mode === "off" || short ? null : <span className="v-duck v-off">♪ duck armed</span>;
  const titles = duck.threads.map((thread) => `'${thread.title}'`).join(", ");
  return (
    <span className="v-duck" role="status" title={titles}>
      <i className="v-blink" />
      <span className="v-trunc">
        ♪ {duck.mode === "pause" ? "paused" : "lowered"}
        {titles === "" ? "" : ` · ${titles} needs you`}
      </span>
    </span>
  );
}

function Devices({ props, open, cursor, short, onToggle, onPick }: { props: SkinProps; open: boolean; cursor: number; short: boolean; onToggle(): void; onPick(index: number): void }) {
  const { data } = props;
  const device = data.player.device;
  return (
    <div className="v-devw">
      <button type="button" className={`v-btn v-sm ${open ? "v-on" : ""}`} onClick={onToggle} aria-expanded={open} title="Devices (d)">
        <Icon name="laptop" />
        {short ? null : <span className="v-trunc">{device?.name ?? "no device"}</span>}▾
      </button>
      {open ? (
        <div className="v-menu v-box" role="menu">
          <div className="v-mh">play on</div>
          {data.devices.length === 0 ? <div className="v-msg">no devices · o opens spotify</div> : null}
          {data.devices.map((entry, index) => (
            <button key={entry.id ?? entry.name} type="button" role="menuitem" className={`${entry.isActive ? "v-on" : ""} ${index === cursor ? "v-cur" : ""}`} disabled={entry.id === null} onClick={() => onPick(index)}>
              <span>{entry.isActive ? "■" : "□"}</span>
              <span className="v-trunc">{entry.name}</span>
              <small>{entry.type.toLowerCase()}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Help({ onClose }: { onClose(): void }) {
  return (
    <div className="v-help" onClick={onClose}>
      <div className="v-dlg v-box" role="dialog" aria-label="Keyboard help">
        <div className="v-bh">
          <Pixels text="KEYS" shadow />
          <i className="v-rule" />
          <small>voxel · every key, one screen</small>
        </div>
        <div className="v-kl">
          {HELP.map(([keys, what]) => (
            <div key={keys}>
              <span>{keys}</span>
              <span>{what}</span>
            </div>
          ))}
        </div>
        <div className="v-more">
          press any key to close <i />
        </div>
      </div>
    </div>
  );
}

function Footer({ size, message }: { size: Size; message: Message }) {
  const hints: [string[], string][] =
    size === "full"
      ? [
          [["SPC"], "play"],
          [["N", "P"], "skip"],
          [["←", "→"], "seek"],
          [["J", "K", "⏎"], "pick"],
          [["F"], "like"],
          [["S"], "search"],
          [["R"], "reroll"],
          [["Y", "@", "C"], "share"],
          [["V"], "vis"],
          [["?"], "all keys"],
        ]
      : size === "compact"
        ? [
            [["SPC"], "play"],
            [["N", "P"], "skip"],
            [["F"], "like"],
            [["1", "4"], "tabs"],
            [["?"], "keys"],
          ]
        : [
            [["SPC"], "play"],
            [["?"], "keys"],
          ];
  return (
    <footer className="v-keys">
      {hints.map(([keys, what]) => (
        <span key={what}>
          {keys.map((key) => (
            <Kc key={key}>{key}</Kc>
          ))}
          {what}
        </span>
      ))}
      {message === null ? null : (
        <span key={message.id} className="v-toast" role="status">
          ▸ {message.text}
        </span>
      )}
    </footer>
  );
}

function VoxelPage(props: SkinProps) {
  const { data, actions, palette } = props;
  const { player } = data;
  const root = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const size = sizeFor(useSize(root));
  const full = size === "full";
  const [focus, setFocus] = useState<Focus>("tracks");
  const [cursor, setCursor] = useState({ library: 0, tracks: 0 });
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState<VisMode>("waterfall");
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pop, setPop] = useState(0);
  const playlists = useMemo(() => ordered(data.playlists), [data.playlists]);
  const track = player.track;
  const active: Focus = full ? focus : tab === 2 ? "library" : "tracks";

  const rows: TrackRows = results
    ? { tracks: results.tracks, heading: `search · ${query}`, results: true, empty: `no songs for "${query}" · esc clears` }
    : {
        tracks: data.selection.readable ? (data.selection.tracks ?? []) : [],
        heading: full ? "title" : (data.selection.playlist?.name.toLowerCase() ?? "title"),
        results: false,
        empty:
          data.selection.playlist === null ? (
            "pick a playlist from the library"
          ) : data.selection.loading ? (
            "loading tracks…"
          ) : !data.selection.readable ? (
            <>
              spotify only lists songs of playlists you own · ⏎ or{" "}
              <button type="button" className="v-btn v-sm" onClick={() => playList(data.selection.playlist)}>
                <Icon name="play" scale={1} /> play
              </button>{" "}
              plays it
            </>
          ) : (
            "this playlist is empty"
          ),
      };

  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), 2800);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (pop === 0) return;
    const timer = setTimeout(() => setPop(0), 800);
    return () => clearTimeout(timer);
  }, [pop]);

  useEffect(() => {
    const index = playlists.findIndex((entry) => entry.id === data.selection.playlist?.id);
    if (index !== -1) setCursor((value) => ({ ...value, library: index }));
  }, [data.selection.playlist?.id]);

  useEffect(() => {
    const index = rows.tracks.findIndex((entry) => entry.id === track?.id);
    setCursor((value) => ({ ...value, tracks: Math.max(0, index) }));
  }, [data.selection.playlist?.id, results, data.selection.tracks === null]);

  useEffect(() => {
    const index = rows.tracks.findIndex((entry) => entry.id === track?.id);
    if (index !== -1) setCursor((value) => ({ ...value, tracks: index }));
  }, [track?.id]);

  const say = (text: string) => setMessage({ id: Date.now(), text });
  const rest = () => root.current?.focus({ preventScroll: true });

  const playList = (playlist: SkinProps["data"]["selection"]["playlist"] | undefined) => {
    if (!playlist) return;
    actions.playPlaylist(playlist);
    say(`playing ${playlist.name.toLowerCase()}`);
  };

  const pickPlaylist = (index: number) => {
    const playlist = playlists[index];
    if (playlist === undefined) return;
    setCursor((value) => ({ ...value, library: index }));
    if (playlist.id === data.selection.playlist?.id && !playlist.readable) return playList(playlist);
    actions.select(playlist.id);
    setResults(null);
    if (!full) setTab(0);
    say(playlist.readable ? `${playlist.name.toLowerCase()} · ${playlist.trackCount.toLocaleString()} tracks · ⏎ plays` : `${playlist.name.toLowerCase()} · followed, play only · ⏎ plays it`);
  };

  const playRow = (index: number) => {
    const entry = rows.tracks[index];
    if (entry === undefined) return;
    setCursor((value) => ({ ...value, tracks: index }));
    if (!rows.results && data.selection.playlist !== null) actions.playPlaylist(data.selection.playlist, entry);
    else actions.playTrack(entry);
    say(`now playing ${entry.name} — ${artists(entry)}`);
  };

  const queueTrack = (entry: Track | undefined) => {
    if (entry === undefined) return;
    actions.queue(entry);
    say(`queued ${entry.name}`);
  };

  const like = () => {
    if (track === null) return say("nothing playing to like");
    if (!player.liked) setPop(Date.now());
    actions.like();
    say(player.liked ? "removed from liked songs" : "saved to liked songs");
  };

  const reroll = () => {
    if (data.shuffling) return;
    const chosen = data.selection.playlist;
    actions.smartShuffle({ sourceId: chosen?.readable ? chosen.id : LIKED_ID });
    say(`rerolling ${(chosen?.readable ? chosen.name : "liked songs").toLowerCase()}${data.shuffleOptions.vibe ? ` · vibe "${data.shuffleOptions.vibe}"` : ""}`);
  };

  const share = (how: Share) => {
    if (track === null) return say("nothing playing to share");
    if (how === "link") actions.copyLink(track);
    if (how === "thread") actions.mention(track);
    if (how === "card") actions.shareCard(track, root.current);
    say(how === "link" ? "copied link" : how === "thread" ? `mentioned ${track.name} in the thread` : "making a share card…");
  };

  const toggleMenu = () => {
    if (menu !== null) return setMenu(null);
    actions.refreshDevices();
    setMenu(
      Math.max(
        0,
        data.devices.findIndex((entry) => entry.isActive),
      ),
    );
  };

  const transfer = (index: number) => {
    const device = data.devices[index];
    setMenu(null);
    if (!device?.id) return;
    actions.transfer(device.id);
    say(`now playing on ${device.name}`);
  };

  const runSearch = () => {
    const text = query.trim();
    if (text === "") return;
    say(`searching ${text}…`);
    actions.search(text).then(
      (found) => {
        setResults(found);
        setFocus("tracks");
        setTab(0);
        setCursor((value) => ({ ...value, tracks: 0 }));
        say(`${found.tracks.length} songs for "${text}"`);
      },
      (cause: unknown) => say(cause instanceof Error ? cause.message : "search failed"),
    );
  };

  const move = (delta: number) =>
    setCursor((value) => {
      const length = active === "library" ? playlists.length : rows.tracks.length;
      return { ...value, [active]: Math.max(0, Math.min(length - 1, value[active] + delta)) };
    });

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (help) {
        setHelp(false);
        return true;
      }
      if (menu !== null) {
        if (event.key === "j" || event.key === "ArrowDown") setMenu(Math.min(data.devices.length - 1, menu + 1));
        else if (event.key === "k" || event.key === "ArrowUp") setMenu(Math.max(0, menu - 1));
        else if (event.key === "Enter") transfer(menu);
        else if (event.key === "Escape" || event.key === "d") setMenu(null);
        else return false;
        return true;
      }
      if (transportKey(event, data, actions)) {
        if (event.key === " ") press(root.current, "space");
        return true;
      }
      const seekBy = (delta: number) => actions.seek(progressAt(player, Date.now()) + delta);
      switch (event.key) {
        case "ArrowLeft":
          seekBy(-10_000);
          return true;
        case "ArrowRight":
          seekBy(10_000);
          return true;
        case "n":
          press(root.current, "n");
          actions.next();
          return true;
        case "p":
          press(root.current, "p");
          actions.previous();
          return true;
        case "j":
        case "ArrowDown":
          move(1);
          return true;
        case "k":
        case "ArrowUp":
          move(-1);
          return true;
        case "Enter":
          if (active === "library") pickPlaylist(cursor.library);
          else if (rows.tracks.length === 0 && data.selection.playlist !== null && !data.selection.readable) playList(data.selection.playlist);
          else playRow(cursor.tracks);
          return true;
        case "Tab":
          if (!full) return false;
          setFocus((value) => (value === "library" ? "tracks" : "library"));
          return true;
        case "f":
          press(root.current, "f");
          like();
          return true;
        case "s":
          if (!full) setTab(0);
          searchInput.current?.focus();
          searchInput.current?.select();
          return true;
        case "q":
          queueTrack(active === "tracks" ? rows.tracks[cursor.tracks] : undefined);
          return true;
        case "R":
          press(root.current, "R");
          reroll();
          return true;
        case "x":
          press(root.current, "x");
          actions.setShuffle(!player.shuffle);
          say(`shuffle ${player.shuffle ? "off" : "on"}`);
          return true;
        case "r":
          press(root.current, "r");
          actions.cycleRepeat();
          say(`repeat ${player.repeat === "off" ? "all" : player.repeat === "context" ? "one" : "off"}`);
          return true;
        case "y":
        case "@":
        case "c":
          press(root.current, event.key);
          share(event.key === "y" ? "link" : event.key === "@" ? "thread" : "card");
          return true;
        case "d":
          toggleMenu();
          return true;
        case "o":
          actions.launchApp();
          say("opening spotify…");
          return true;
        case "v": {
          const next = VIS_MODES[(VIS_MODES.indexOf(mode) + 1) % VIS_MODES.length]!;
          setMode(next);
          say(`visualizer ${next}`);
          return true;
        }
        case "?":
          setHelp(true);
          return true;
        case "Escape":
          if (results === null) return false;
          setResults(null);
          setQuery("");
          return true;
        case "1":
        case "2":
        case "3":
        case "4":
          if (full) return false;
          setTab(Number(event.key) - 1);
          return true;
        default:
          return false;
      }
    },
    [help, menu, data, actions, player, cursor, active, rows, full, mode, results, playlists],
  );
  useKeys(root, onKey);

  const search = (
    <label className="v-srch">
      <Icon name="search" />
      <input
        ref={searchInput}
        value={query}
        placeholder={size === "tight" ? "search…" : `search ${clip((data.selection.playlist?.name ?? "spotify").toLowerCase(), 16)}…`}
        aria-label="Search Spotify"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            runSearch();
            rest();
          } else if (event.key === "Escape") {
            if (query === "") setResults(null);
            rest();
          } else return;
          event.stopPropagation();
        }}
      />
      {size === "tight" ? null : <Kc>S</Kc>}
    </label>
  );

  const tracks = (
    <TrackTable
      props={props}
      rows={rows}
      cursor={cursor.tracks}
      focused={active === "tracks"}
      album={full}
      onPlay={(index) => {
        setFocus("tracks");
        playRow(index);
      }}
      onQueue={queueTrack}
    />
  );

  const library = (grid: boolean) => (
    <LibraryList
      props={props}
      playlists={playlists}
      cursor={cursor.library}
      focused={active === "library"}
      grid={grid}
      onPick={(index) => {
        setFocus("library");
        pickPlaylist(index);
      }}
      onPlay={playList}
    />
  );

  const tracksHint = (
    <>
      {results ? (
        <button type="button" className="v-btn v-xs" onClick={() => (setResults(null), setQuery(""))} aria-label="Clear search" title="Clear search (esc)">
          <Icon name="close" scale={1} />
        </button>
      ) : data.selection.playlist !== null ? (
        <button type="button" className="v-btn v-xs" onClick={() => playList(data.selection.playlist)} aria-label={`Play ${data.selection.playlist.name}`} title="Play playlist">
          <Icon name="play" scale={1} />
        </button>
      ) : null}
      <small>j k ⏎</small>
    </>
  );

  return (
    <div
      ref={root}
      tabIndex={0}
      data-layout={size}
      className={`sp-voxel v-${toneOf(palette)} v-${size} ${player.isPlaying ? "" : "v-paused"}`}
      onMouseDown={(event) => !isTyping(event.target) && event.currentTarget.focus({ preventScroll: true })}
      onClick={(event) => menu !== null && !(event.target as HTMLElement).closest(".v-devw") && setMenu(null)}
    >
      <header className="v-hud">
        <div className="v-logo">
          <Pixels text="VOXEL" scale={full ? 3 : 2} shadow />
          {full ? (
            <small>
              SPOTIFY
              <br />
              {(PALETTE_NAMES[toneOf(palette)] ?? "").toUpperCase()}
            </small>
          ) : null}
        </div>
        {search}
        <span className="v-grow" />
        <Duck props={props} short={size === "tight"} />
        <Devices props={props} open={menu !== null} cursor={menu ?? 0} short={size === "tight"} onToggle={toggleMenu} onPick={transfer} />
      </header>
      {full ? (
        <div className="v-body">
          <aside className="v-col">
            <Box title="LIBRARY" note={data.playlists === null ? "" : String(playlists.length)} focus={active === "library"} className="v-lib">
              <div className="v-scroll">{library(false)}</div>
            </Box>
            <Box title="STATS" note="this week" className="v-stats">
              <StatsBox stats={data.stats} />
            </Box>
          </aside>
          <main className="v-mid">
            <NowPlaying props={props} size={size} mode={mode} pop={pop} />
            <Spectrum props={props} mode={mode} onMode={setMode} />
            <Box title={results ? "SEARCH" : (data.selection.playlist?.name ?? "TRACKS")} note={results ? `"${query}"` : tracksNote(props)} hint={tracksHint} focus={active === "tracks"} className="v-tracks">
              <div className="v-scroll">{tracks}</div>
            </Box>
          </main>
          <aside className="v-col">
            <Box title="UP NEXT" hint={<small className="v-hi">smart shuffle</small>} className="v-upnext">
              <UpNext props={props} compact={false} onReroll={reroll} onLeave={rest} />
            </Box>
            <Box title="SHARE" note="this track" className="v-share">
              <ShareButtons onShare={share} />
              <SharePreview track={track} demo={data.demo} />
            </Box>
          </aside>
        </div>
      ) : (
        <>
          <NowPlaying props={props} size={size} mode={mode} pop={pop} />
          <nav className="v-tabs" role="tablist">
            {TABS.map((name, index) => (
              <button key={name} type="button" role="tab" aria-selected={index === tab} className={`v-btn ${index === tab ? "v-on" : ""}`} onClick={() => setTab(index)}>
                <span className="v-n">{index + 1}</span>
                {size === "tight" && index === 3 ? "share" : name}
              </button>
            ))}
            {size === "tight" ? null : (
              <>
                <span className="v-sp" />
                <span className="v-d v-vhint">v {mode === "off" ? "art" : "spin"}</span>
              </>
            )}
          </nav>
          <section className="v-box v-cbody">
            <div className="v-scroll" key={tab}>
              {tab === 0 ? (
                <>
                  {results ? (
                    <div className="v-results">
                      {results.tracks.length} songs · esc clears · q queues
                      {tracksHint}
                    </div>
                  ) : null}
                  {tracks}
                </>
              ) : tab === 1 ? (
                <UpNext props={props} compact onReroll={reroll} onLeave={rest} />
              ) : tab === 2 ? (
                library(true)
              ) : (
                <>
                  <ShareButtons onShare={share} />
                  <StatsStrip stats={data.stats} />
                </>
              )}
            </div>
          </section>
        </>
      )}
      <Footer size={size} message={message} />
      {help ? <Help onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

function VoxelMini({ data, actions, palette, close }: MiniProps) {
  const root = useRef<HTMLDivElement>(null);
  const { player } = data;
  const track = player.track;
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      if (event.key === "n") actions.next();
      else if (event.key === "p") actions.previous();
      else if (event.key === "f" && track !== null) actions.like();
      else if (event.key === "y" && track !== null) actions.copyLink(track);
      else if (event.key === "@" && track !== null) actions.mention(track);
      else if (event.key === "o") actions.openPage();
      else if (event.key === "q") close();
      else return false;
      return true;
    },
    [data, actions, track, close],
  );
  useKeys(root, onKey);
  const { duck } = player;
  return (
    <div ref={root} tabIndex={0} className={`sp-voxel v-${toneOf(palette)} v-mini ${player.isPlaying ? "" : "v-paused"}`}>
      <span className="v-drag" data-sp-drag="" title="Drag to move">
        <Cover track={track} demo={data.demo} scale={3} />
      </span>
      <div className="v-mbody">
        <button type="button" className="v-mtitle" onClick={actions.openPage} title="Open the Spotify page">
          <Pixels text={clip(track?.name ?? "No disc", 17)} shadow />
        </button>
        <div className="v-sub v-trunc">
          {track === null ? (
            player.status === "no-device" ? (
              "no device · o opens spotify"
            ) : (
              "press space to play"
            )
          ) : (
            <>
              <b>{artists(track)}</b> · {track.album.name}
            </>
          )}
        </div>
        <div className="v-srow">
          <Seek player={player} cells={24} thin onSeek={actions.seek} />
          <b>
            <Clock player={player} />
          </b>
        </div>
      </div>
      <div className="v-mc" onMouseDown={(event) => event.preventDefault()}>
        <City player={player} mode="waterfall" palette={palette} mini height={38} />
        <button type="button" className="v-btn v-xs" onClick={actions.previous} aria-label="Previous song" title="Previous (p)">
          <Icon name="prev" />
        </button>
        <button type="button" className="v-btn v-xs v-play" onClick={actions.toggle} aria-label={player.isPlaying ? "Pause" : "Play"} title="Play or pause (space)">
          <Icon name={player.isPlaying ? "pause" : "play"} />
        </button>
        <button type="button" className="v-btn v-xs" onClick={actions.next} aria-label="Next song" title="Next (n)">
          <Icon name="next" />
        </button>
        <button type="button" className={`v-btn v-xs ${player.liked ? "v-on" : ""}`} onClick={actions.like} disabled={track === null} aria-label={player.liked ? "Remove from Liked Songs" : "Save to Liked Songs"} title="Like (f)">
          <Icon name={player.liked ? "heart" : "heart0"} />
        </button>
        <button type="button" className="v-btn v-xs v-close" onClick={close} aria-label="Close the mini player" title="Close (q)">
          <Icon name="close" />
        </button>
      </div>
      {duck.active ? (
        <div className="v-dk" role="status">
          <i className="v-blink" />
          <span className="v-trunc">
            ♪ {duck.mode === "pause" ? "paused" : "lowered"}
            {duck.threads.length > 0 ? ` · ${duck.threads.map((thread) => `'${thread.title}'`).join(", ")} needs you` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export const voxelSkin: Skin = { id: "voxel", Page: VoxelPage, Mini: VoxelMini };
