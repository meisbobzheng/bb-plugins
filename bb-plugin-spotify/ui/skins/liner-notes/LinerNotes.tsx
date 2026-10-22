import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { LIKED_ID, PALETTE_NAMES, type Playlist, type SearchResult, type Track } from "../../../contract";
import { artists, clock, playlistLength, trackUrl } from "../../format";
import { isTyping, transportKey, useKeys } from "../../keys";
import { upNext, type MiniProps, type Skin, type SkinProps } from "../../model";
import { contents, credits, duckNote, issueLine, kicker, nextWindow, prose, quoted, sentence, sessionNote, sides, songs } from "./edition";
import { BackMatter, MATTERS, type Matter } from "./matter";
import { Halftone, Oscillogram, ProgressRule, VolumeRule } from "./plates";
import "./liner-notes.css";

type Found = { query: string; result: SearchResult | null; error: string | null };
type Entries = ReturnType<typeof contents>;

const LIMIT = 80;

const KEYS: [string, string][] = [
  ["j k", "move"],
  ["⏎", "open"],
  ["p", "play"],
  ["space", "pause"],
  ["n b", "next, back"],
  [", .", "seek"],
  ["+ −", "volume"],
  ["l", "keep"],
  ["s", "reshuffle"],
  ["y", "link"],
  ["@", "thread"],
  ["c", "card"],
  ["/", "search"],
  ["1 2 3", "back matter"],
  ["⌘⇧S", "summon"],
];

const titleSize = (name: string) => (name.length > 44 ? "l-long" : name.length > 24 ? "l-mid" : "");

function Masthead({ data, actions }: SkinProps) {
  const { player } = data;
  const device = player.device;
  const duck = duckNote(player.duck);
  return (
    <>
      <header className="l-mast">
        <h1 data-text="Liner Notes">
          Liner Notes<span>for Spotify</span>
        </h1>
        <div className="l-issue l-num">
          {issueLine(new Date())}
          {data.demo ? " · Proof, with sample songs" : ""}
          <br />
          {device === null ? (
            <>○ No device</>
          ) : (
            <>
              <b className={player.isPlaying ? "l-live" : ""}>●</b> {player.isPlaying ? "Playing" : "Paused"} on {device.name} · Volume {device.volumePercent ?? "—"}
            </>
          )}
        </div>
      </header>
      <div className="l-subrule" />
      {player.status === "no-device" ? (
        <p className="l-erratum">
          <b>Erratum.</b> Spotify isn&rsquo;t playing on any device, so the presses are idle.{" "}
          <button type="button" className="l-link" onClick={actions.launchApp}>
            Open Spotify →
          </button>
        </p>
      ) : null}
      {player.status === "error" && player.error ? (
        <p className="l-erratum">
          <b>Erratum.</b> {player.error}
        </p>
      ) : null}
      {duck !== null ? (
        <p className="l-erratum l-stop">
          <b>Stop press.</b> {duck}
        </p>
      ) : null}
    </>
  );
}

function Contents({ data, entries, cursor, query, finder, onQuery, onSearch, onEscape, onBrowse, onPick }: {
  data: SkinProps["data"];
  entries: Entries;
  cursor: number | null;
  query: string;
  finder: RefObject<HTMLInputElement | null>;
  onQuery(query: string): void;
  onSearch(query: string): void;
  onEscape(): void;
  onBrowse(): void;
  onPick(playlist: Playlist): void;
}) {
  const playing = data.player.context?.uri;
  const entry = (playlist: Playlist) => {
    const index = entries.order.indexOf(playlist);
    const selected = data.selection.playlist?.id === playlist.id;
    return (
      <li key={playlist.id} className={`${selected ? "l-on" : ""} ${index === cursor ? "l-cur" : ""} ${playlist.uri === playing ? "l-playing" : ""}`} onClick={() => onPick(playlist)}>
        <span className="l-n">{index === cursor ? "☞" : playlist.uri === playing ? "●" : String(index + 1).padStart(2, "0")}</span>
        <span className="l-t">{playlist.name}</span>
        <span className="l-dots" />
        <span className="l-c">{playlist.trackCount.toLocaleString()}</span>
      </li>
    );
  };
  return (
    <nav className="l-col l-contents">
      <h3>Contents</h3>
      <label className="l-search">
        <input
          ref={finder}
          value={query}
          placeholder="Find a playlist, song, artist"
          spellCheck={false}
          aria-label="Find a playlist, song, or artist"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSearch(query);
            else if (event.key === "Escape") onEscape();
            else if (event.key === "ArrowDown") onBrowse();
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />
        <kbd>/</kbd>
      </label>
      {query.trim() !== "" ? <p className="l-hint">⏎ searches Spotify for &ldquo;{query.trim()}&rdquo;</p> : null}
      {data.playlists === null ? <p className="l-quiet">Setting the contents…</p> : null}
      {data.playlists !== null && entries.order.length === 0 ? <p className="l-quiet">{query.trim() === "" ? "No playlists in your library yet." : "No playlist by that name."}</p> : null}
      <ul className="l-toc l-num">
        {entries.yours.length > 0 ? <li className="l-group">Yours</li> : null}
        {entries.yours.map(entry)}
        {entries.followed.length > 0 ? <li className="l-group">Followed · play only</li> : null}
        {entries.followed.map(entry)}
      </ul>
      <p className="l-prose l-num">
        {prose(data.stats).map((part, index) => (part.em ? <b key={index}>{part.text}</b> : part.text))}
      </p>
    </nav>
  );
}

function Feature({ data, actions, palette }: SkinProps) {
  const { player } = data;
  const track = player.track;
  const kept = track !== null && player.liked === true;
  const title = track?.name ?? "Silence, for now.";
  const caption =
    track === null || track.album.imageUrl === null
      ? "No sleeve on file; a sun stands in."
      : player.isPlaying
        ? "The sleeve, set in halftone; it breathes with the bass."
        : "The sleeve, set in halftone; it rests while paused.";
  return (
    <section className="l-feature">
      <div className="l-kicker l-num">{kicker(data)}</div>
      <div className="l-lead">
        <div className="l-heading">
          <h2 className={`l-title ${titleSize(title)}`} data-text={title}>
            {title}
          </h2>
          {track === null ? (
            <p className="l-deck">
              {player.status === "no-device" ? "Spotify isn’t open on any device. " : "Start a song in Spotify, or choose a playlist from the contents and press P."}
              {player.status === "no-device" ? (
                <button type="button" className="l-link" onClick={actions.launchApp}>
                  Open Spotify →
                </button>
              ) : null}
            </p>
          ) : (
            <>
              <p className="l-deck">
                {artists(track)}, from <i>{track.album.name}</i>
                {track.album.year === null ? "" : ` (${track.album.year})`}.
              </p>
              <p className="l-credits l-num">{credits(track, player.liked, data.stats, data.recent).join(" · ")}.</p>
            </>
          )}
        </div>
        <figure className="l-figure">
          <Halftone player={player} demo={data.demo} size={188} palette={palette} />
          <figcaption>
            <i>Plate i.</i> {caption}
          </figcaption>
        </figure>
      </div>
      <Oscillogram player={player} palette={palette} onSeek={actions.seek} />
      <ProgressRule player={player} onSeek={actions.seek} />
      <div className="l-transport">
        <button type="button" onClick={actions.previous}>
          ← Previous<kbd>B</kbd>
        </button>
        <button type="button" onClick={actions.toggle}>
          {player.isPlaying ? "Pause" : "Play"}
          <kbd>Space</kbd>
        </button>
        <button type="button" onClick={actions.next}>
          Next →<kbd>N</kbd>
        </button>
        <button type="button" className={kept ? "l-on" : ""} onClick={actions.like} disabled={track === null} aria-pressed={kept}>
          {kept ? "Kept ♥\uFE0E" : "Keep ♡\uFE0E"}
          <kbd>L</kbd>
        </button>
        <span className="l-grow" />
        <VolumeRule device={player.device} onChange={actions.setVolume} />
      </div>
    </section>
  );
}

function Listing({ data, actions }: SkinProps) {
  const { selection } = data;
  const playlist = selection.playlist;
  const [all, setAll] = useState(false);
  if (playlist === null) return <p className="l-quiet l-listing">Choose a playlist from the contents to read its tracklisting.</p>;
  const tracks = selection.tracks ?? [];
  const shown = all ? tracks : tracks.slice(0, LIMIT);
  const current = data.player.track?.id;
  const listed = !selection.loading && selection.readable && tracks.length > 0;
  return (
    <section className="l-listing">
      <div className="l-listing-h">
        <h3>
          Tracklisting <em>{playlist.name}</em>
        </h3>
        <span className="l-num">
          {listed ? `${songs(tracks.length)} · ${playlistLength(tracks)}` : songs(playlist.trackCount)} ·{" "}
          <button type="button" className="l-link" onClick={() => actions.playPlaylist(playlist)}>
            Play this playlist
          </button>
          <kbd>P</kbd>
        </span>
      </div>
      {selection.loading ? <p className="l-quiet">Setting the type for {playlist.name}…</p> : null}
      {!selection.loading && !selection.readable ? (
        <p className="l-quiet">
          Spotify only lists the songs of playlists you own or collaborate on, so <i>{playlist.name}</i> can be played but not read.{" "}
          <button type="button" className="l-link" onClick={() => actions.playPlaylist(playlist)}>
            Play it →
          </button>
        </p>
      ) : null}
      {!selection.loading && selection.readable && tracks.length === 0 ? <p className="l-quiet">This playlist has no songs yet.</p> : null}
      {listed
        ? sides(shown).map((side) => (
            <div key={side.label} className="l-side">
              <div className="l-side-h">
                <b>Side {side.label}</b>
                <span className="l-num">
                  {songs(side.tracks.length)} · {playlistLength(side.tracks)}
                </span>
              </div>
              <ol className="l-tracks l-num">
                {side.tracks.map((track, index) => (
                  <li key={`${track.id}-${index}`} className={track.id === current ? "l-on" : ""} onClick={() => actions.playPlaylist(playlist, track)} title="Play from here">
                    <span className="l-i">{track.id === current ? "●" : `${side.label}${index + 1}`}</span>
                    <span className="l-nm">
                      {track.name} <em>{artists(track)}</em>
                    </span>
                    <span className="l-d">{clock(track.durationMs)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))
        : null}
      {listed && shown.length < tracks.length ? (
        <button type="button" className="l-link l-more" onClick={() => setAll(true)}>
          Continued: the other {songs(tracks.length - shown.length)}, {playlistLength(tracks.slice(shown.length))} →
        </button>
      ) : null}
    </section>
  );
}

function Index({ found, actions, onClose }: { found: Found; actions: SkinProps["actions"]; onClose(): void }) {
  const { result } = found;
  const queue = (event: React.MouseEvent, track: Track) => {
    event.stopPropagation();
    actions.queue(track);
  };
  return (
    <section className="l-listing l-index">
      <div className="l-listing-h">
        <h3>
          Index <em>&ldquo;{found.query}&rdquo;</em>
        </h3>
        <span>
          {result === null ? "" : `${songs(result.tracks.length)} · `}
          <button type="button" className="l-link" onClick={onClose}>
            Back to the tracklisting
          </button>
          <kbd>Esc</kbd>
        </span>
      </div>
      {result === null && found.error === null ? <p className="l-quiet">Looking up &ldquo;{found.query}&rdquo; in Spotify…</p> : null}
      {found.error !== null ? (
        <p className="l-erratum">
          <b>Erratum.</b> {found.error}
        </p>
      ) : null}
      {result !== null && result.tracks.length === 0 && result.playlists.length === 0 ? <p className="l-quiet">Nothing in Spotify answers to &ldquo;{found.query}&rdquo;.</p> : null}
      {result !== null && result.tracks.length > 0 ? (
        <ol className="l-tracks l-num">
          {result.tracks.map((track, index) => (
            <li key={`${track.id}-${index}`} onClick={() => actions.playTrack(track)} title="Play this song">
              <span className="l-i">{index + 1}</span>
              <span className="l-nm">
                {track.name} <em>{artists(track)}</em>
              </span>
              <span className="l-d">{clock(track.durationMs)}</span>
              <button type="button" className="l-queue" onClick={(event) => queue(event, track)}>
                Queue
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {result !== null && result.playlists.length > 0 ? (
        <>
          <div className="l-side-h">
            <b>Playlists</b>
          </div>
          <ol className="l-tracks l-num">
            {result.playlists.map((playlist, index) => (
              <li key={playlist.id} onClick={() => actions.playPlaylist(playlist)} title="Play this playlist">
                <span className="l-i">{index + 1}</span>
                <span className="l-nm">
                  {playlist.name} <em>{playlist.owner}</em>
                </span>
                <span className="l-d">{playlist.trackCount.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

function Option({ n, on, label, onToggle, children }: { n: number; on: boolean; label: string; onToggle(): void; children: React.ReactNode }) {
  return (
    <div className={`l-opt ${on ? "l-on" : ""}`} onClick={onToggle}>
      <button type="button" className="l-ck" role="checkbox" aria-checked={on} aria-label={label} />
      <span>
        <sup>{n}</sup>
        {children}
      </span>
    </div>
  );
}

function Shuffle({ data, actions, onShuffle }: SkinProps & { onShuffle(): void }) {
  const options = data.shuffleOptions;
  const vibe = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(options.vibe ?? "");
  useEffect(() => {
    if (options.vibe !== null) setDraft((current) => (current.trim() === options.vibe ? current : options.vibe!));
  }, [options.vibe]);
  const shape = (text: string) => actions.setShuffleOptions({ vibe: text.trim() === "" ? null : text.trim() });
  const selected = data.selection.playlist;
  const upcoming = upNext(data).slice(0, 5);
  const note = sessionNote(data.session);
  return (
    <section className="l-box">
      <h3>
        Shuffle, edited <em>smart</em>
      </h3>
      <p className="l-lede">Spotify shuffles. This one edits.</p>
      <Option n={1} on={options.spread} label="No artist or album twice in a row" onToggle={() => actions.setShuffleOptions({ spread: !options.spread })}>
        No artist or album twice in a row
      </Option>
      <Option n={2} on={options.fresh} label={`Favor songs I haven't heard in ${options.freshDays} days`} onToggle={() => actions.setShuffleOptions({ fresh: !options.fresh })}>
        Favor songs I haven&rsquo;t heard in{" "}
        <button
          type="button"
          className="l-days l-num"
          title="Change the window"
          onClick={(event) => {
            event.stopPropagation();
            actions.setShuffleOptions({ freshDays: nextWindow(options.freshDays) });
          }}
        >
          {options.freshDays}
        </button>{" "}
        days
      </Option>
      <Option n={3} on={options.noSkips} label="Skip songs I usually skip" onToggle={() => actions.setShuffleOptions({ noSkips: !options.noSkips })}>
        Skip songs I usually skip
      </Option>
      <Option n={4} on={options.vibe !== null} label="Shape it like this" onToggle={() => (options.vibe !== null ? actions.setShuffleOptions({ vibe: null }) : draft.trim() !== "" ? shape(draft) : vibe.current?.focus())}>
        Shape it like this:
      </Option>
      <input
        ref={vibe}
        className={`l-vibe ${options.vibe === null ? "l-off" : ""}`}
        value={draft}
        maxLength={300}
        placeholder="start mellow, end euphoric"
        spellCheck={false}
        aria-label="Shape the shuffle in plain English"
        onChange={(event) => {
          setDraft(event.target.value);
          shape(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== "Escape") return;
          event.preventDefault();
          event.currentTarget.closest<HTMLElement>(".sp-liner")?.focus();
          if (event.key === "Enter") onShuffle();
        }}
      />
      <button type="button" className="l-go" disabled={data.shuffling} onClick={onShuffle}>
        {data.shuffling ? "Shuffling the deck…" : "Reshuffle the deck"}
        <kbd>S</kbd>
      </button>
      <p className="l-source">
        Deals from <i>{selected?.readable ? selected.name : "Liked Songs"}</i>.{note === null ? "" : ` ${note}`}
      </p>
      {upcoming.length === 0 ? (
        <p className="l-quiet">Nothing on deck yet. Reshuffle to deal the next songs.</p>
      ) : (
        <ol className="l-upnext l-num">
          {upcoming.map((entry, index) => (
            <li key={`${entry.track.id}-${index}`}>
              <span>{index + 1}</span>
              <span>
                {entry.track.name} — {artists(entry.track)}
                {entry.reason === null ? null : <small>{entry.reason}</small>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Cite({ data, actions, root }: SkinProps & { root: RefObject<HTMLDivElement | null> }) {
  const track = data.player.track;
  return (
    <section className="l-box">
      <h3>Cite this track</h3>
      {track === null ? (
        <p className="l-quiet">Nothing to cite until a song plays.</p>
      ) : (
        <>
          <p className="l-cite">
            {sentence(artists(track))} {quoted(track.name)} <i>{track.album.name}</i>
            {track.album.year === null ? "" : `, ${track.album.year}`}.<span className="l-url">{trackUrl(track).replace(/^https:\/\//, "")}</span>
          </p>
          <div className="l-chips">
            <button type="button" onClick={() => actions.copyLink(track)}>
              Link
            </button>
            <button type="button" onClick={() => actions.copyUri(track)}>
              URI
            </button>
            <button type="button" onClick={() => actions.mention(track)}>
              @ Thread
            </button>
            <button type="button" onClick={() => actions.shareCard(track, root.current)}>
              Card
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function LinerPage(props: SkinProps) {
  const { data, actions, palette } = props;
  const root = useRef<HTMLDivElement>(null);
  const finder = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [matter, setMatter] = useState<Matter>("stats");
  const entries = useMemo(() => contents(data.playlists, query), [data.playlists, query]);
  const track = data.player.track;
  const selected = data.selection.playlist;

  useEffect(() => {
    if (cursor !== null) root.current?.querySelector(".l-toc .l-cur")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const reshuffle = useCallback(() => actions.smartShuffle({ sourceId: selected?.readable ? selected.id : LIKED_ID }), [actions, selected]);

  const pick = (playlist: Playlist) => {
    actions.select(playlist.id);
    setCursor(null);
    setFound(null);
  };

  const search = (text: string) => {
    const needle = text.trim();
    if (needle === "") return;
    setFound({ query: needle, result: null, error: null });
    actions.search(needle).then(
      (result) => setFound((value) => (value?.query === needle ? { query: needle, result, error: null } : value)),
      (cause: unknown) => setFound((value) => (value?.query === needle ? { query: needle, result: null, error: cause instanceof Error ? cause.message : String(cause) } : value)),
    );
  };

  const escape = () => {
    setQuery("");
    setFound(null);
    root.current?.focus({ preventScroll: true });
  };

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      const order = entries.order;
      const move = (delta: number) => setCursor((value) => Math.max(0, Math.min(order.length - 1, (value ?? order.findIndex((entry) => entry.id === selected?.id)) + delta)));
      switch (event.key) {
        case "j":
        case "ArrowDown":
          move(1);
          return true;
        case "k":
        case "ArrowUp":
          move(-1);
          return true;
        case "Enter": {
          const playlist = cursor === null ? undefined : order[cursor];
          if (playlist === undefined) return false;
          pick(playlist);
          return true;
        }
        case "Escape":
          if (cursor === null && found === null) return false;
          setCursor(null);
          setFound(null);
          return true;
        case "p": {
          const playlist = (cursor === null ? undefined : order[cursor]) ?? selected;
          if (playlist) actions.playPlaylist(playlist);
          return true;
        }
        case "n":
          actions.next();
          return true;
        case "b":
          actions.previous();
          return true;
        case "l":
          if (track) actions.like();
          return true;
        case "s":
          if (!data.shuffling) reshuffle();
          return true;
        case "y":
          if (track) actions.copyLink(track);
          return true;
        case "@":
          if (track) actions.mention(track);
          return true;
        case "c":
          if (track) actions.shareCard(track, root.current);
          return true;
        case "/":
          finder.current?.focus();
          finder.current?.select();
          return true;
        case "1":
        case "2":
        case "3":
          setMatter(MATTERS[Number(event.key) - 1]!);
          anchor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return true;
        default:
          return false;
      }
    },
    [data, actions, entries, cursor, found, selected, track, reshuffle],
  );
  useKeys(root, onKey);

  return (
    <div ref={root} tabIndex={0} className={`sp-liner l-page l-${palette}`} onMouseDown={(event) => !isTyping(event.target) && event.currentTarget.focus({ preventScroll: true })}>
      <div className="l-sheet">
        <Masthead {...props} />
        <div className="l-cols">
          <Contents
            data={data}
            entries={entries}
            cursor={cursor}
            query={query}
            finder={finder}
            onQuery={(value) => {
              setQuery(value);
              setCursor(null);
            }}
            onSearch={search}
            onEscape={escape}
            onBrowse={() => {
              root.current?.focus({ preventScroll: true });
              setCursor(0);
            }}
            onPick={pick}
          />
          <main className="l-col l-center">
            <Feature {...props} />
            {found !== null ? <Index found={found} actions={actions} onClose={() => setFound(null)} /> : <Listing key={selected?.id ?? "none"} {...props} />}
          </main>
          <aside className="l-col l-right">
            <Shuffle {...props} onShuffle={reshuffle} />
            <Cite {...props} root={root} />
          </aside>
        </div>
        <BackMatter {...props} matter={matter} onMatter={setMatter} anchor={anchor} />
        <footer className="l-colophon">
          <span>
            Set in Didot, Iowan Old Style &amp; Avenir Next. The {PALETTE_NAMES[palette] ?? palette} edition.
          </span>
          <span className="l-keys">
            {KEYS.map(([keys, what]) => (
              <span key={keys}>
                <kbd>{keys}</kbd> {what}
              </span>
            ))}
          </span>
        </footer>
      </div>
    </div>
  );
}

function LinerMini({ data, actions, palette, close }: MiniProps) {
  const root = useRef<HTMLDivElement>(null);
  const { player } = data;
  const track = player.track;
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (transportKey(event, data, actions)) return true;
      if (event.key === "n") actions.next();
      else if (event.key === "b") actions.previous();
      else if (event.key === "l" && track) actions.like();
      else if (event.key === "y" && track) actions.copyLink(track);
      else if (event.key === "@" && track) actions.mention(track);
      else return false;
      return true;
    },
    [data, actions, track],
  );
  useKeys(root, onKey);
  return (
    <div ref={root} tabIndex={0} className={`sp-liner l-mini l-${palette}`}>
      <span className="l-edge" data-sp-drag="" title="Drag to move" />
      <span className="l-ribbon" data-sp-drag="" title="Drag to move" />
      <div className="l-thumb" data-sp-drag="" title="Drag to move">
        <Halftone player={player} demo={data.demo} size={56} palette={palette} />
      </div>
      <div className="l-slip">
        <button type="button" className={`l-slip-title ${titleSize(track?.name ?? "")}`} onClick={actions.openPage} title="Open Liner Notes">
          {track?.name ?? "Nothing playing"}
        </button>
        <div className="l-slip-by">
          {track === null ? (
            "Open Spotify, then press space."
          ) : (
            <>
              {artists(track)} · <i>{track.album.name}</i>
            </>
          )}
        </div>
        <ProgressRule player={player} onSeek={actions.seek} compact />
      </div>
      <div className="l-ctl">
        <button type="button" onClick={actions.previous} aria-label="Previous song">
          ←
        </button>
        <button type="button" onClick={actions.toggle}>
          {player.isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={actions.next} aria-label="Next song">
          →
        </button>
        <button type="button" className={player.liked ? "l-on" : ""} onClick={actions.like} disabled={track === null} aria-pressed={player.liked ?? false} aria-label="Keep in Liked Songs">
          {"♥\uFE0E"}
        </button>
      </div>
      <button type="button" className="l-close" onClick={close} aria-label="Close the mini player">
        ×
      </button>
    </div>
  );
}

export const linerNotesSkin: Skin = { id: "liner-notes", Page: LinerPage, Mini: LinerMini };
