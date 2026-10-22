import { useRef, useState, type ReactNode, type RefObject } from "react";
import type { PlayerState, SearchResult } from "../../../contract";
import { artists, clock, daysAgo, hours, monthDay, playlistLength } from "../../format";
import { progressAt, upNext, type SpotifyActions, type SpotifyData } from "../../model";
import { useFrame } from "../../spectrum";
import { stepDays } from "./dial";
import { Group, Key, pad, Screws } from "./panel";

const isFresh = (reason: string | null) => reason !== null && /^(unheard|new to)/.test(reason);

export function Processor({ data, actions, source, onRun }: { data: SpotifyData; actions: SpotifyActions; source: string; onRun(): void }) {
  const options = data.shuffleOptions;
  const session = data.session;
  const upcoming = upNext(data).slice(0, 4);
  const set = actions.setShuffleOptions;
  return (
    <div className="r-face r-proc">
      <Screws />
      <div className="r-proc-panel">
        <header className="r-head">
          <div className="r-brand r-brand-sm r-engrave">
            SP-2<small>Smart Shuffle Processor</small>
          </div>
          <div className="r-device r-engrave">
            <span className={`r-led ${data.shuffling ? "r-blink" : "r-off"}`} />
            Source ▸ {source}
          </div>
        </header>
        <div className="r-proc-keys">
          <Group label="Rules">
            <Key pip lit={options.spread} onClick={() => set({ spread: !options.spread })} title="No artist or album twice in a row">
              Spread
            </Key>
            <Key pip lit={options.fresh} onClick={() => set({ fresh: !options.fresh })} title="Favor songs you have not heard lately">
              Fresh
            </Key>
            <div className={`r-days ${options.fresh ? "" : "r-dim"}`}>
              <Key className="r-step" onClick={() => set({ freshDays: stepDays(options.freshDays, -1) })} aria-label="Fewer fresh days">
                −
              </Key>
              <span className="r-lcd">{options.freshDays}D</span>
              <Key className="r-step" onClick={() => set({ freshDays: stepDays(options.freshDays, 1) })} aria-label="More fresh days">
                +
              </Key>
            </div>
            <Key pip lit={options.noSkips} onClick={() => set({ noSkips: !options.noSkips })} title="Leave out songs you usually skip">
              No skips
            </Key>
          </Group>
          <div className="r-proc-tail">
            <label className="r-group r-vibe">
              <span className="r-group-label r-engrave">Vibe</span>
              <input
                value={options.vibe ?? ""}
                maxLength={300}
                spellCheck={false}
                placeholder="start mellow, build to hype"
                aria-label="Vibe"
                onChange={(event) => set({ vibe: event.target.value === "" ? null : event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onRun();
                  else if (event.key === "Escape") event.currentTarget.blur();
                }}
              />
            </label>
            <Group label="Run">
              <Key dark lit={data.shuffling} className="r-run" onClick={onRun} kbd="⇧S" disabled={data.shuffling}>
                {data.shuffling ? "Working" : "Shuffle ▸"}
              </Key>
            </Group>
          </div>
        </div>
      </div>
      <div className="r-glass r-vfd r-program">
        <div className="r-ind r-glow">
          <span className="on">Program</span>
          <span className={session === null ? "" : "on"}>{session === null ? "No session" : `${session.sourceName} · ${session.tracks.length} trk`}</span>
          <span className={session?.dropped ? "on" : ""}>{session?.dropped ?? 0} skip-prone out</span>
          <span className={data.shuffling ? "on r-blink" : ""}>Processing</span>
        </div>
        {upcoming.length === 0 ? <div className="r-prow r-glow r-quiet">Queue empty · press Shuffle to build a program</div> : null}
        {upcoming.map((entry, index) => (
          <div key={`${entry.track.id}-${index}`} className="r-prow r-glow">
            <span>{pad(index + 1)}</span>
            <span className="r-trunc">
              {entry.track.name} — {artists(entry.track)}
            </span>
            <em className={isFresh(entry.reason) ? "r-fresh" : ""}>{entry.reason ?? ""}</em>
          </div>
        ))}
        {session?.vibeError ? <div className="r-prow r-glow r-warn">Vibe off · {session.vibeError}</div> : null}
      </div>
    </div>
  );
}

export function Cassette({ player, label }: { player: PlayerState; label: string }) {
  const left = useRef<HTMLSpanElement>(null);
  const right = useRef<HTMLSpanElement>(null);
  useFrame(
    (now) => {
      const duration = player.track?.durationMs ?? 0;
      const fraction = duration > 0 ? progressAt(player, now) / duration : 0.5;
      left.current?.style.setProperty("--r-wind", `${(3 + 6 * (1 - fraction)).toFixed(1)}px`);
      right.current?.style.setProperty("--r-wind", `${(3 + 6 * fraction).toFixed(1)}px`);
    },
    player.isPlaying,
    2,
    [player.progressMs, player.track?.id],
  );
  return (
    <div className={`r-glass r-cass ${player.isPlaying ? "r-rolling" : ""}`}>
      <div className="r-shell">
        <div className="r-sticker">
          <b>A</b>
          {label}
        </div>
        <div className="r-win" />
        <span ref={left} className="r-reel r-l" />
        <span ref={right} className="r-reel r-r" />
      </div>
    </div>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <>
      <h4>
        <b>{title}</b>
        {aside ? <span>{aside}</span> : null}
      </h4>
      {children}
    </>
  );
}

const Note = ({ children }: { children: ReactNode }) => <div className="r-note">{children}</div>;

export function TapeCard({ data, actions, onPlay }: { data: SpotifyData; actions: SpotifyActions; onPlay(): void }) {
  const { selection } = data;
  const playlist = selection.playlist;
  const tracks = selection.tracks ?? [];
  const current = data.player.track?.id;
  if (playlist === null) return (
      <Card title="Side A">
        <Note>Tune a station on the dial to load its tape.</Note>
      </Card>
    );
  const aside = selection.readable && tracks.length > 0 ? `${tracks.length} tracks · ${playlistLength(tracks)} · ⏎ plays` : playlist.owner;
  return (
    <Card title={`Side A · ${playlist.name}`} aside={aside}>
      {selection.loading ? <Note>Spooling the tape…</Note> : null}
      {!selection.loading && !selection.readable ? (
        <div className="r-note">
          <p>Spotify only lists the songs of playlists you own or collaborate on. This station is play only.</p>
          <Key dark onClick={onPlay}>
            ▶ Play {playlist.name}
          </Key>
        </div>
      ) : null}
      {!selection.loading && selection.readable && tracks.length === 0 ? <Note>This tape is blank.</Note> : null}
      {!selection.loading && selection.readable ? (
        <div className="r-tl">
          {tracks.map((track, index) => (
            <button type="button" key={`${track.id}-${index}`} className={`r-row ${track.id === current ? "on" : ""}`} onClick={() => actions.playPlaylist(playlist, track)} title={`${track.name} — ${artists(track)} · ${track.album.name}`}>
              <span>{track.id === current ? "" : pad(index + 1)}</span>
              <span>
                {track.name} <em>— {artists(track)}</em>
              </span>
              <span>{clock(track.durationMs)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function StatsCard({ data, actions, onTune }: { data: SpotifyData; actions: SpotifyActions; onTune(playlistId: string): void }) {
  const stats = data.stats;
  if (stats === null) return (
      <Card title="Listening log">
        <Note>Reading the log…</Note>
      </Card>
    );
  if (stats.since === null) return (
      <Card title="Listening log">
        <Note>No history yet. Plays are logged while bb is running.</Note>
      </Card>
    );
  const loudest = stats.topArtists[0]?.listenedMs || 1;
  const busiest = Math.max(1, ...stats.byHour);
  return (
    <Card title="Listening log" aside={`since ${monthDay(stats.since)}`}>
      <div className="r-stats">
        <div>
          <div className="r-figs">
            <div>
              <b>{hours(stats.listenedMs7)}</b>this week
            </div>
            <div>
              <b>{hours(stats.listenedMs30)}</b>30 days
            </div>
            <div>
              <b>{stats.plays30.toLocaleString()}</b>plays
            </div>
            <div>
              <b>{stats.skipRate30 === null ? "–" : `${Math.round(stats.skipRate30 * 100)}%`}</b>skipped
            </div>
          </div>
          <div className="r-sub">By hour</div>
          <div className="r-hours">
            {stats.byHour.map((value, hour) => (
              <i key={hour} style={{ height: `${Math.max(4, (value / busiest) * 100)}%` }} title={`${hour}:00 · ${hours(value)}`} />
            ))}
          </div>
          <div className="r-axis">
            <span>0</span>
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
          {stats.forgotten.length > 0 ? <div className="r-sub">Forgotten</div> : null}
          {stats.forgotten.map((entry) => (
            <button type="button" key={entry.playlistId} className="r-row r-plain" onClick={() => onTune(entry.playlistId)} title="Tune this station">
              <span>
                {entry.name} <em>· {entry.lastPlayedAt === null ? "never played here" : daysAgo(entry.lastPlayedAt)}</em>
              </span>
            </button>
          ))}
        </div>
        <div>
          <div className="r-sub">Top artists · 30 days</div>
          {stats.topArtists.slice(0, 8).map((artist) => (
            <div key={artist.name} className="r-meter">
              <span>{artist.name}</span>
              <i>
                <b style={{ width: `${(artist.listenedMs / loudest) * 100}%` }} />
              </i>
              <em>{hours(artist.listenedMs)}</em>
            </div>
          ))}
        </div>
        <div>
          <div className="r-sub">Top songs · 30 days</div>
          {stats.topTracks.slice(0, 8).map((entry) => (
            <button type="button" key={entry.track.id} className="r-row" onClick={() => actions.playTrack(entry.track)} title="Play">
              <span>{entry.plays}×</span>
              <span>
                {entry.track.name} <em>— {artists(entry.track)}</em>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function when(at: number): string {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : daysAgo(at);
}

export function HistoryCard({ data, actions }: { data: SpotifyData; actions: SpotifyActions }) {
  return (
    <Card title="Play log" aside={data.recent.length > 0 ? `${data.recent.length} recent · click replays` : undefined}>
      {data.recent.length === 0 ? <Note>No plays logged yet. They show up here as you listen.</Note> : null}
      <div className="r-tl r-log">
        {data.recent.map((play, index) => (
          <button type="button" key={`${play.startedAt}-${index}`} className="r-row" onClick={() => actions.playTrack(play.track)} title="Play again">
            <span>{when(play.startedAt)}</span>
            <span>
              {play.track.name} <em>— {artists(play.track)}</em>
            </span>
            <span>{play.skipped ? <b className="r-stamp">Skip</b> : clock(play.listenedMs)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

export interface Search {
  query: string;
  setQuery(query: string): void;
  run(query?: string): void;
  result: SearchResult | null;
  busy: boolean;
  error: string | null;
}

export function useSearch(actions: SpotifyActions): Search {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ result: SearchResult | null; busy: boolean; error: string | null }>({ result: null, busy: false, error: null });
  const ticket = useRef(0);
  const run = (text = query) => {
    const needle = text.trim();
    if (needle === "") return;
    setQuery(text);
    ticket.current += 1;
    const mine = ticket.current;
    setState((value) => ({ ...value, busy: true, error: null }));
    actions.search(needle).then(
      (result) => mine === ticket.current && setState({ result, busy: false, error: null }),
      (cause: unknown) => mine === ticket.current && setState({ result: null, busy: false, error: cause instanceof Error ? cause.message : String(cause) }),
    );
  };
  return { query, setQuery, run, ...state };
}

export function SearchCard({ search, input, actions, onLeave }: { search: Search; input: RefObject<HTMLInputElement | null>; actions: SpotifyActions; onLeave(): void }) {
  const result = search.result;
  const empty = result !== null && result.tracks.length + result.playlists.length + result.artists.length + result.albums.length === 0;
  const names = result === null ? [] : [...result.artists.map((artist) => artist.name), ...result.albums.map((album) => `${album.name} ${album.artist}`)].slice(0, 8);
  return (
    <Card title="Search" aside="⏎ searches · click plays · Q adds to queue">
      <form
        className="r-search"
        onSubmit={(event) => {
          event.preventDefault();
          search.run();
        }}
      >
        <span>▸</span>
        <input
          ref={input}
          value={search.query}
          spellCheck={false}
          placeholder="songs, artists, playlists…"
          aria-label="Search Spotify"
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && onLeave()}
        />
      </form>
      {search.busy ? <Note>Searching…</Note> : null}
      {search.error !== null ? <Note>{search.error}</Note> : null}
      {result === null && !search.busy ? <Note>Type above and press ⏎ to search Spotify.</Note> : null}
      {empty ? <Note>Nothing found for “{search.query}”.</Note> : null}
      {result !== null && result.tracks.length > 0 ? <div className="r-sub">Songs</div> : null}
      <div className="r-tl">
        {result?.tracks.map((track) => (
          <div key={track.id} className="r-row r-hit">
            <button type="button" onClick={() => actions.playTrack(track)} title="Play">
              <span className="r-mark">▶</span>
              <span>
                {track.name} <em>— {artists(track)}</em>
              </span>
              <span>{clock(track.durationMs)}</span>
            </button>
            <button type="button" className="r-q" onClick={() => actions.queue(track)} title="Add to queue">
              Q
            </button>
          </div>
        ))}
      </div>
      {result !== null && result.playlists.length > 0 ? <div className="r-sub">Playlists</div> : null}
      <div className="r-tl">
        {result?.playlists.map((playlist) => (
          <button type="button" key={playlist.id} className="r-row" onClick={() => actions.playPlaylist(playlist)} title="Play">
            <span className="r-mark">▶</span>
            <span>
              {playlist.name} <em>— {playlist.owner}</em>
            </span>
            <span>{playlist.trackCount}</span>
          </button>
        ))}
      </div>
      {names.length > 0 ? <div className="r-sub">Artists & albums</div> : null}
      <div className="r-chips">
        {names.map((name) => (
          <button type="button" key={name} onClick={() => search.run(name)} title="Search this">
            {name}
          </button>
        ))}
      </div>
    </Card>
  );
}
