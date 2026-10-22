import type { Playlist, SearchResult, Track } from "../../../contract";
import { artists, clock, daysAgo, hours, monthDay, playlistLength } from "../../format";
import type { SkinProps } from "../../model";
import { Doodle, DoodleFor, Icon, Squiggle } from "./doodles";
import { FILLS, stuck, vars } from "./stickers";
import { Badge } from "./visuals";

export type Tab = "songs" | "stats" | "history" | "search";

export const TABS: { id: Tab; label: string; fill: string; note: string }[] = [
  { id: "songs", label: "Songs", fill: "var(--pink)", note: "click a song to play it" },
  { id: "stats", label: "Stats", fill: "var(--mint)", note: "written down while bb runs" },
  { id: "history", label: "History", fill: "var(--butter)", note: "skips get crossed out" },
  { id: "search", label: "Search", fill: "var(--lilac)", note: "press / to search" },
];

export interface Finder {
  input: React.RefObject<HTMLInputElement | null>;
  query: string;
  result: SearchResult | null;
  status: "idle" | "busy" | "error";
  setQuery(query: string): void;
  run(): void;
  leave(): void;
}

const Message = ({ children }: { children: React.ReactNode }) => <div className="k-page-msg">{children}</div>;

function Head({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="k-page-head">
      <span className="k-page-title">
        {title}
        <Squiggle />
      </span>
      <span className="k-page-sub">{sub}</span>
      {action}
    </div>
  );
}

function Row({ props, track, lead, middle, time, skipped = false, log = false, onPlay }: { props: SkinProps; track: Track; lead: string; middle: string; time: string; skipped?: boolean; log?: boolean; onPlay(): void }) {
  const { actions, data } = props;
  const act = (run: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    run();
  };
  return (
    <div className={`k-row ${log ? "k-row-log" : ""} ${track.id === data.player.track?.id ? "k-now" : ""} ${skipped ? "k-skip" : ""}`} onClick={onPlay} title={`Play ${track.name}`}>
      <DoodleFor seed={track.name} size={16} />
      <span className="k-row-n">{lead}</span>
      <span className="k-row-title k-trunc">
        <span>{track.name}</span>
        {skipped ? <em className="k-skip-note">skipped</em> : null}
      </span>
      <span className="k-row-meta k-trunc">{artists(track)}</span>
      <span className="k-row-meta k-trunc">{middle}</span>
      <span className="k-row-time">{time}</span>
      <span className="k-row-acts">
        <button type="button" className="k-pill" style={vars({ "--fill": "var(--pink)" })} onClick={act(onPlay)} aria-label={`Play ${track.name}`}>
          <Icon name="play" />
        </button>
        <button type="button" className="k-pill" style={vars({ "--fill": "var(--mint)" })} onClick={act(() => actions.queue(track))} aria-label={`Queue ${track.name}`}>
          <Icon name="plus" />
        </button>
        <button type="button" className="k-pill" style={vars({ "--fill": "var(--sky)" })} onClick={act(() => actions.copyLink(track))} aria-label={`Copy the link to ${track.name}`}>
          <Icon name="link" />
        </button>
        <button type="button" className="k-pill" style={vars({ "--fill": "var(--lilac)" })} onClick={act(() => actions.mention(track))} aria-label={`Mention ${track.name} in a thread`}>
          <Icon name="bubble" />
        </button>
      </span>
    </div>
  );
}

function Songs({ props }: { props: SkinProps }) {
  const { data, actions } = props;
  const { playlist, tracks, readable, loading } = data.selection;
  if (playlist === null) return <Message>pick a mixtape from the shelf and its songs get written down here.</Message>;
  const play = (fill: string, label: string) => (
    <button type="button" className="k-button" style={vars({ "--fill": fill })} onClick={() => actions.playPlaylist(playlist)}>
      <Icon name="play" /> {label}
    </button>
  );
  const sub = tracks !== null && readable && !loading ? `${tracks.length.toLocaleString()} songs · ${playlistLength(tracks)}` : `${playlist.trackCount.toLocaleString()} songs`;
  return (
    <>
      <Head title={playlist.name} sub={sub} action={readable ? play("var(--pink)", "Play it") : null} />
      {loading ? (
        <Message>flipping to the right page…</Message>
      ) : !readable ? (
        <Message>
          <span>Spotify only lists the songs of playlists you own or collaborate on, so this page stays blank. You can still play the whole thing, though.</span>
          {play("var(--sky)", `Play ${playlist.name}`)}
        </Message>
      ) : tracks === null || tracks.length === 0 ? (
        <Message>this page is blank. the playlist has no songs yet.</Message>
      ) : (
        tracks.map((track, index) => (
          <Row key={`${track.id}-${index}`} props={props} track={track} lead={String(index + 1)} middle={track.album.name} time={clock(track.durationMs)} onPlay={() => actions.playPlaylist(playlist, track)} />
        ))
      )}
    </>
  );
}

function Stats({ props }: { props: SkinProps }) {
  const { data, actions } = props;
  const stats = data.stats;
  if (stats === null) return <Message>counting your plays…</Message>;
  if (stats.since === null) return <Message>no history yet! plays get written into this notebook while bb is running, so check back after a few songs.</Message>;
  const top = Math.max(1, stats.topArtists[0]?.listenedMs ?? 1);
  const busiest = Math.max(1, ...stats.byHour);
  const replay = (playlistId: string): Playlist | undefined => data.playlists?.find((entry) => entry.id === playlistId);
  return (
    <div className="k-stats">
      <div>
        <div className="k-col-title">
          since {monthDay(stats.since)} <Doodle kind="flower" fill="var(--pink)" size={16} className="k-inline" />
        </div>
        <div className="k-badges">
          <Badge big={hours(stats.listenedMs30)} small="this month" fill="var(--pink)" tilt={-5} />
          <Badge big={hours(stats.listenedMs7)} small="this week" fill="var(--mint)" tilt={4} />
          <Badge big={stats.plays30.toLocaleString()} small="plays in 30 days" fill="var(--butter)" tilt={3} />
          <Badge big={stats.skipRate30 === null ? "–" : `${Math.round(stats.skipRate30 * 100)}%`} small="skipped" fill="var(--lilac)" tilt={-3} />
        </div>
        {stats.topTracks.length > 0 ? (
          <div className="k-repeat">
            {stats.topTracks.slice(0, 3).map((entry) => (
              <div key={entry.track.id} className="k-trunc">
                <b>{entry.plays}×</b>
                {entry.track.name} <span className="k-soft">· {artists(entry.track)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div>
        <div className="k-col-title">top artists, stacked like candy</div>
        <div className="k-blocks">
          {stats.topArtists.slice(0, 6).map((artist, index) => (
            <div key={artist.name} className="k-block" style={{ ...stuck(artist.name, 1.5, `var(--${FILLS[index % FILLS.length]})`), ...vars({ "--w": `${((artist.listenedMs / top) * 100).toFixed(1)}%` }) }}>
              <span className="k-trunc">{artist.name}</span>
              <b>{hours(artist.listenedMs)}</b>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="k-col-title">when you listen</div>
        <div className="k-hours">
          {stats.byHour.map((value, hour) => {
            const share = value / busiest;
            return <span key={hour} className="k-hour" title={`${hour}:00 · ${hours(value)}`} style={vars({ "--d": `${(5 + share * 13).toFixed(1)}px`, "--fill": share > 0.66 ? "var(--pink)" : share > 0.33 ? "var(--lilac)" : "var(--sky)" })} />;
          })}
        </div>
        <div className="k-hour-axis">
          <span>12am</span>
          <span>6am</span>
          <span>noon</span>
          <span>6pm</span>
        </div>
        {stats.forgotten.length > 0 ? (
          <div className="k-misses">
            {stats.forgotten.slice(0, 4).map((entry, index) => {
              const playlist = replay(entry.playlistId);
              return (
                <button key={entry.playlistId} type="button" className="k-miss" style={stuck(entry.name, 3.5, index % 2 ? "var(--pink)" : "var(--butter)")} disabled={playlist === undefined} onClick={() => playlist && actions.playPlaylist(playlist)} title={playlist ? `Play ${entry.name}` : entry.name}>
                  <em>miss you!</em>
                  <b className="k-trunc">{entry.name}</b>
                  <small>{entry.lastPlayedAt === null ? "never played here" : `last played ${daysAgo(entry.lastPlayedAt)}`}</small>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function when(at: number): string {
  const time = new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return daysAgo(at) === "today" ? time : new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

function History({ props }: { props: SkinProps }) {
  const { data, actions } = props;
  if (data.recent.length === 0) return <Message>nothing written down yet. songs land here after you play them with bb open.</Message>;
  return (
    <>
      <Head title="Lately" sub={`${data.recent.length} plays · skips crossed out`} />
      {data.recent.map((play, index) => (
        <Row key={`${play.startedAt}-${index}`} props={props} track={play.track} lead={when(play.startedAt)} middle={play.track.album.name} time={clock(play.listenedMs)} skipped={play.skipped} log onPlay={() => actions.playTrack(play.track)} />
      ))}
    </>
  );
}

function Search({ props, finder }: { props: SkinProps; finder: Finder }) {
  const { actions } = props;
  const { result, status } = finder;
  return (
    <>
      <label className="k-find">
        <Icon name="search" />
        <input
          ref={finder.input}
          value={finder.query}
          placeholder="find a song, artist or playlist…"
          aria-label="Search Spotify"
          spellCheck={false}
          onChange={(event) => finder.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") finder.run();
            else if (event.key === "Escape") finder.leave();
            else return;
            event.stopPropagation();
          }}
        />
        <kbd>⏎</kbd>
      </label>
      {status === "busy" ? <Message>rummaging through Spotify…</Message> : null}
      {status === "error" ? <Message>the search fell off the page. try again in a moment.</Message> : null}
      {status === "idle" && result !== null && result.tracks.length === 0 && result.playlists.length === 0 ? <Message>nothing found for “{finder.query}”.</Message> : null}
      {status === "idle" && result !== null && result.playlists.length > 0 ? (
        <div className="k-found">
          {result.playlists.slice(0, 6).map((playlist) => (
            <button key={playlist.id} type="button" className={`k-label ${playlist.readable ? "" : "k-ticket"}`} style={stuck(playlist.name)} onClick={() => actions.playPlaylist(playlist)} title={`Play ${playlist.name}`}>
              <span className="k-badge-dot">
                <DoodleFor seed={playlist.name} size={18} />
              </span>
              <span className="k-label-text">
                <span className="k-label-name k-trunc">{playlist.name}</span>
                <span className="k-label-sub">by {playlist.owner}</span>
              </span>
              <span className="k-label-count">
                <Icon name="play" size={14} />
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {status === "idle" && result !== null
        ? result.tracks.map((track, index) => <Row key={`${track.id}-${index}`} props={props} track={track} lead={String(index + 1)} middle={track.album.name} time={clock(track.durationMs)} onPlay={() => actions.playTrack(track)} />)
        : null}
    </>
  );
}

export function Notebook({ props, tab, onTab, finder }: { props: SkinProps; tab: Tab; onTab(tab: Tab): void; finder: Finder }) {
  return (
    <section className="k-notebook">
      <div className="k-tabs" role="tablist" aria-label="Notebook">
        {TABS.map((entry, index) => (
          <button key={entry.id} type="button" role="tab" aria-selected={entry.id === tab} className={`k-tab ${entry.id === tab ? "k-here" : ""}`} style={vars({ "--fill": entry.fill })} onClick={() => onTab(entry.id)}>
            {entry.label}
            <kbd>{index + 1}</kbd>
          </button>
        ))}
        <span className="k-tabs-note">{TABS.find((entry) => entry.id === tab)?.note}</span>
      </div>
      <div className="k-page" role="tabpanel">
        {tab === "songs" ? <Songs props={props} /> : tab === "stats" ? <Stats props={props} /> : tab === "history" ? <History props={props} /> : <Search props={props} finder={finder} />}
      </div>
    </section>
  );
}
