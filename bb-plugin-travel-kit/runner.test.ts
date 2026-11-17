import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "runner", "lib");

async function zsh(body: string, env: Record<string, string> = {}): Promise<string> {
  const home = env.HOME ?? (await mkdtemp(path.join(tmpdir(), "tk-zsh-")));
  const prelude = [
    "emulate -R zsh",
    "setopt no_unset pipe_fail extended_glob null_glob no_nomatch",
    "path=(/usr/bin /bin /usr/sbin /sbin $path)",
    `for lib in ui steps paths bbdb git scan kinds kit apply; do source ${LIB}/$lib.zsh; done`,
    'TK_TMP=$(mktemp -d "$TMPDIR/tk.XXXXXX")',
    "export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t GIT_CONFIG_GLOBAL=/dev/null",
  ].join("\n");
  return execFileSync("/bin/zsh", ["-c", `${prelude}\n${body}`], {
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmpdir(), ...env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const BB_SCHEMA = `
CREATE TABLE hosts (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE host_daemon_sessions (id TEXT PRIMARY KEY, host_id TEXT, data_dir TEXT);
CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT);
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, kind TEXT DEFAULT 'standard', deleted_at INTEGER);
CREATE UNIQUE INDEX projects_personal ON projects (kind) WHERE kind = 'personal';
CREATE TABLE project_sources (id TEXT PRIMARY KEY, project_id TEXT, host_id TEXT, path TEXT);
CREATE UNIQUE INDEX project_sources_project_host ON project_sources (project_id, host_id);
CREATE TABLE environments (id TEXT PRIMARY KEY, project_id TEXT, host_id TEXT, path TEXT, status TEXT, is_worktree INTEGER DEFAULT 0, environment_provider_plugin_id TEXT);
CREATE UNIQUE INDEX environments_project_host_path ON environments (project_id, host_id, path);
CREATE TABLE thread_sections (id TEXT PRIMARY KEY, name TEXT);
CREATE UNIQUE INDEX thread_sections_name ON thread_sections (name);
CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT, environment_id TEXT, section_id TEXT, parent_thread_id TEXT, source_thread_id TEXT,
  lifecycle_owner_thread_id TEXT, title TEXT, deleted_at INTEGER, archived_at INTEGER, updated_at INTEGER);
CREATE TABLE events (id TEXT PRIMARY KEY, thread_id TEXT, environment_id TEXT, data TEXT);
CREATE TABLE thread_search_segments (id TEXT PRIMARY KEY, thread_id TEXT, text TEXT);
CREATE VIRTUAL TABLE thread_search_segments_fts USING fts5(text);
CREATE TRIGGER segs_ai AFTER INSERT ON thread_search_segments BEGIN INSERT INTO thread_search_segments_fts(rowid, text) VALUES (new.rowid, new.text); END;
CREATE TRIGGER segs_ad AFTER DELETE ON thread_search_segments BEGIN DELETE FROM thread_search_segments_fts WHERE rowid = old.rowid; END;
CREATE TABLE plugin_kv (plugin_id TEXT, key TEXT, value TEXT, PRIMARY KEY (plugin_id, key));
CREATE TABLE app_settings_values (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE ui_preferences (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE app_theme (id TEXT PRIMARY KEY, value TEXT);
`;

describe("paths", () => {
  it("rewrites home paths and Claude slugs without touching lookalike users", async () => {
    const out = await zsh(`
      d=$TK_TMP/tree; mkdir -p $d/-Users-bob-dev-hss
      print -r -- '{"cwd":"/Users/bob/dev/hss","other":"/Users/bobby/x"} /Users/bob' > $d/-Users-bob-dev-hss/s.jsonl
      tk_rewrite_files $d /Users/bob /Users/new
      tk_rename_slug_dirs $d /Users/bob /Users/new
      cat $d/-Users-new-dev-hss/s.jsonl`);
    expect(out.trim()).toBe('{"cwd":"/Users/new/dev/hss","other":"/Users/bobby/x"} /Users/new');
  });

  it("never copies keys, tokens, or credential files", async () => {
    const out = await zsh(`
      s=$TK_TMP/src; mkdir -p $s/.ssh $s/gh $s/lib
      touch $s/.ssh/id_ed25519 $s/gh/hosts.yml $s/oauth_token.json $s/credentials $s/key.pem $s/.env $s/settings.json $s/lib/tokenizer.js
      tk_copy_tree $s $TK_TMP/dst
      cd $TK_TMP/dst && find . -type f | sort`);
    expect(out.trim().split("\n")).toEqual(["./lib/tokenizer.js", "./settings.json"]);
  });

  it("overlays a tree, backs up what it replaces, and then matches", async () => {
    const out = await zsh(`
      mkdir -p $TK_TMP/a $TK_TMP/b; print new > $TK_TMP/a/f; print old > $TK_TMP/b/f; print mine > $TK_TMP/b/extra
      tk_tree_matches $TK_TMP/a $TK_TMP/b || print before-differs
      tk_overlay $TK_TMP/a $TK_TMP/b $TK_TMP/backup
      tk_tree_matches $TK_TMP/a $TK_TMP/b && print after-matches
      cat $TK_TMP/backup/f $TK_TMP/b/extra`);
    expect(out.trim().split("\n")).toEqual(["before-differs", "after-matches", "old", "mine"]);
  });
});

describe("bb database", () => {
  const seed = (now: number) => `
    sqlite3 $src <<'SQL'
${BB_SCHEMA}
INSERT INTO hosts VALUES ('host_main', 'main'), ('host_gone', 'old');
INSERT INTO host_daemon_sessions VALUES ('s1', 'host_main', '/Users/bob/.bb');
INSERT INTO user VALUES ('u1', 'me@example.invalid');
INSERT INTO projects VALUES ('proj_personal', 'Personal', 'personal', NULL), ('proj_hss', 'hss', 'standard', NULL);
INSERT INTO project_sources VALUES ('ps1', 'proj_hss', 'host_main', '/Users/bob/dev/hss'), ('ps2', 'proj_hss', 'host_gone', '/Users/old/dev/hss');
INSERT INTO environments VALUES ('env_hss', 'proj_hss', 'host_main', '/Users/bob/dev/hss', 'ready', 0, 'environment-project-checkout'),
  ('env_dead', 'proj_hss', 'host_gone', '/Users/old/dev/hss', 'destroyed', 0, NULL);
INSERT INTO thread_sections VALUES ('sec_work', 'work');
INSERT INTO threads VALUES
  ('thr_recent', 'proj_hss', 'env_hss', 'sec_work', 'thr_parent', NULL, NULL, 'recent', NULL, NULL, ${now}),
  ('thr_parent', 'proj_hss', 'env_dead', NULL, NULL, NULL, NULL, 'old parent', NULL, NULL, 1),
  ('thr_old', 'proj_hss', 'env_hss', NULL, NULL, NULL, NULL, 'old', NULL, NULL, 1),
  ('thr_archived', 'proj_hss', 'env_hss', NULL, NULL, NULL, NULL, 'archived', NULL, ${now}, ${now});
INSERT INTO events VALUES ('e1', 'thr_recent', 'env_hss', '{"cwd":"/Users/bob/dev/hss","host":"host_main"}'), ('e2', 'thr_old', 'env_hss', '{}');
INSERT INTO thread_search_segments VALUES ('g1', 'thr_recent', 'diameter s6a attach'), ('g2', 'thr_old', 'old text');
INSERT INTO plugin_kv VALUES ('spotify', 'refreshToken', 'x'), ('library', 'lastEntry', 'lib_1');
INSERT INTO app_settings_values VALUES ('theme', 'cape'), ('openaiApiKey', 'x');
SQL`;

  it("exports recent threads with their parents, strips hosts, identity, and secret keys", async () => {
    const now = Date.now();
    const out = await zsh(`
      src=$TK_TMP/bb.db; ${seed(now)}
      tk_bb_export_content $src $TK_TMP/content.db host_main ${now - 1000} || print EXPORT-FAILED
      sqlite3 $TK_TMP/content.db "
        SELECT 'threads', group_concat(id) FROM (SELECT id FROM threads ORDER BY id);
        SELECT 'envs', group_concat(id) FROM environments;
        SELECT 'parent env', coalesce(environment_id, 'null') FROM threads WHERE id = 'thr_parent';
        SELECT 'sources', group_concat(id) FROM project_sources;
        SELECT 'events', group_concat(id) FROM events;
        SELECT 'kv', group_concat(key) FROM plugin_kv;
        SELECT 'settings', group_concat(key) FROM app_settings_values;
        SELECT 'tables', group_concat(name) FROM (SELECT name FROM sqlite_master WHERE name IN ('hosts', 'host_daemon_sessions', 'user') ORDER BY name);"`);
    expect(out.trim().split("\n")).toEqual([
      "threads|thr_parent,thr_recent",
      "envs|env_hss",
      "parent env|null",
      "sources|ps1",
      "events|e1",
      "kv|lastEntry",
      "settings|theme",
      "tables|",
    ]);
  });

  it("merges into a fresh bb under its own host and home, then upserts without breaking search or ids", async () => {
    const now = Date.now();
    const out = await zsh(`
      src=$TK_TMP/bb.db; ${seed(now)}
      tk_bb_export_content $src $TK_TMP/content.db host_main ${now - 1000} || print EXPORT-FAILED
      dst=$TK_TMP/target.db
      sqlite3 $dst <<'SQL'
${BB_SCHEMA}
INSERT INTO hosts VALUES ('host_travel', 'travel');
INSERT INTO projects VALUES ('proj_fresh_personal', 'Personal', 'personal', NULL);
SQL
      cp $TK_TMP/content.db $TK_TMP/work.db
      tk_rewrite_sqlite $TK_TMP/work.db /Users/bob /Users/new -Users-bob- -Users-new- host_main host_travel
      tk_sqlite_merge $TK_TMP/work.db $dst fresh
      cp $TK_TMP/content.db $TK_TMP/again.db
      sqlite3 $TK_TMP/again.db "UPDATE environments SET id = 'env_dup'; UPDATE threads SET environment_id = 'env_dup' WHERE environment_id = 'env_hss';"
      sqlite3 $TK_TMP/again.db "INSERT INTO thread_sections VALUES ('sec_other', 'work'); UPDATE threads SET section_id = 'sec_other';"
      tk_rewrite_sqlite $TK_TMP/again.db /Users/bob /Users/new -Users-bob- -Users-new- host_main host_travel
      tk_bb_align_ids $TK_TMP/again.db $dst
      tk_sqlite_merge $TK_TMP/again.db $dst upsert
      sqlite3 $dst "
        SELECT 'hosts', group_concat(id) FROM hosts;
        SELECT 'personal', group_concat(id) FROM projects WHERE kind = 'personal';
        SELECT 'env', id, host_id, path FROM environments;
        SELECT 'thread env', environment_id, section_id FROM threads WHERE id = 'thr_recent';
        SELECT 'event', data FROM events;
        SELECT 'fts', count(*) FROM thread_search_segments_fts WHERE thread_search_segments_fts MATCH 'diameter';"`);
    expect(out.trim().split("\n")).toEqual([
      "hosts|host_travel",
      "personal|proj_personal",
      "env|env_hss|host_travel|/Users/new/dev/hss",
      "thread env|env_hss|sec_work",
      'event|{"cwd":"/Users/new/dev/hss","host":"host_travel"}',
      "fts|1",
    ]);
  });

  it("merges a handback's bb settings, theme and skills only when told to take them", async () => {
    const out = await zsh(`
      SRC_HOME=/Users/travel SRC_HOST_ID=host_travel
      mkdir -p $HOME/.bb $TK_TMP/hb/theme
      sqlite3 $HOME/.bb/bb.db <<'SQL'
${BB_SCHEMA}
INSERT INTO hosts VALUES ('host_main', 'main');
INSERT INTO app_settings_values VALUES ('theme', 'main');
SQL
      sqlite3 $TK_TMP/hb/content.db <<'SQL'
${BB_SCHEMA}
INSERT INTO threads (id, title) VALUES ('thr_t', 'travel');
INSERT INTO app_settings_values VALUES ('theme', 'travel');
SQL
      print dark > $TK_TMP/hb/theme/t.json
      tk_bb_merge_payload $TK_TMP/hb host_main upsert keep >/dev/null
      sqlite3 $HOME/.bb/bb.db "SELECT 'keep', value, (SELECT count(*) FROM threads) FROM app_settings_values"
      [[ -e $HOME/.bb/theme ]] && print keep-copied-theme
      tk_bb_merge_payload $TK_TMP/hb host_main upsert take >/dev/null
      sqlite3 $HOME/.bb/bb.db "SELECT 'take', value FROM app_settings_values"
      cat $HOME/.bb/theme/t.json`);
    expect(out.trim().split("\n")).toEqual(["keep|main|1", "take|travel", "dark"]);
  });

  it("clears password, token, and secret columns and empties auth tables in plugin databases", async () => {
    const out = await zsh(`
      db=$TK_TMP/plugin.db
      sqlite3 $db "CREATE TABLE connections (id TEXT PRIMARY KEY, host TEXT, auth TEXT, password TEXT, api_token TEXT NOT NULL);
        INSERT INTO connections VALUES ('c1', 'db.internal', 'iam', 'hunter2', 'tok');
        CREATE TABLE auth (k TEXT); INSERT INTO auth VALUES ('refresh');"
      tk_bb_scrub_secrets $db
      sqlite3 $db "SELECT host, auth, coalesce(password, 'null'), '[' || api_token || ']' FROM connections; SELECT count(*) FROM auth;"`);
    expect(out.trim().split("\n")).toEqual(["db.internal|iam|null|[]", "0"]);
  });
});

describe("git", () => {
  it("bundles branches and uncommitted work, restores them elsewhere, and never forces a moved branch", async () => {
    const out = await zsh(`
      B=$TK_TMP; SRC=$B/src-home; DST=$B/dst-home; mkdir -p $SRC/dev $DST/dev
      git init -q --bare $B/origin.git
      git init -q -b main $SRC/dev/hss && cd $SRC/dev/hss && print a > a && git add a && git commit -qm one && git remote add origin $B/origin.git && git push -q -u origin main
      git checkout -q -b feature && print f > f && git add f && git commit -qm feat && git checkout -q main
      WT=$SRC/.bb/plugins/environment-git-worktree/host-data/worktrees/thr-x
      mkdir -p \${WT:h} && git worktree add -q $WT -b thr-x
      print wip >> $WT/a; print new > $WT/untracked.txt
      cd $B
      HOME=$SRC tk_git_export $SRC/dev/hss $B/kit/hss.bundle $WT
      print -r -- "source refs: $(git -C $SRC/dev/hss for-each-ref refs/travel-kit | wc -l | tr -d ' ') status: $(git -C $WT status --porcelain | tr '\\n' ' ')"
      HOME=$DST tk_git_import $DST/dev/hss $B/kit/hss.bundle $B/kit/hss.tsv $SRC
      DWT=$DST/.bb/plugins/environment-git-worktree/host-data/worktrees/thr-x
      print -r -- "branches: $(git -C $DST/dev/hss for-each-ref --format='%(refname:short)' refs/heads | tr '\\n' ' ')"
      print -r -- "worktree: $(git -C $DWT status --porcelain | tr '\\n' ' ')"
      HOME=$DST tk_git_import_check $DST/dev/hss $B/kit/hss.bundle $B/kit/hss.tsv $SRC && print check-ok
      git -C $DST/dev/hss checkout -q feature && print t >> $DST/dev/hss/f && git -C $DST/dev/hss commit -qam travel && git -C $DST/dev/hss checkout -q main
      git -C $SRC/dev/hss checkout -q feature && print m >> $SRC/dev/hss/f && git -C $SRC/dev/hss commit -qam mainside && git -C $SRC/dev/hss checkout -q main
      HOME=$DST tk_git_export $DST/dev/hss $B/hb/hss.bundle
      HOME=$SRC tk_git_import $SRC/dev/hss $B/hb/hss.bundle $B/hb/hss.tsv $DST | grep 'kept both'`);
    const lines = out.trim().split("\n");
    expect(lines[0]).toBe("source refs: 0 status:  M a ?? untracked.txt ");
    expect(lines).toContain("branches: feature main thr-x ");
    expect(lines).toContain("worktree:  M a ?? untracked.txt ");
    expect(lines).toContain("check-ok");
    expect(lines.at(-1)).toMatch(/^kept both: feature moved on both sides, incoming copy is travel-kit\/feature-\d{8}$/);
  });
});

describe("handback repos", () => {
  it("only hands back repos with unpushed commits, uncommitted changes, or no remote", async () => {
    const out = await zsh(`
      B=$TK_TMP; git init -q --bare $B/origin.git
      git init -q -b main $B/repo && cd $B/repo && print a > a && git add a && git commit -qm one && git remote add origin $B/origin.git && git push -q -u origin main
      tk_repo_has_local_work $B/repo && print pushed-has-work || print pushed-clean
      git tag v0 $(git commit-tree HEAD^{tree} -m orphan); tk_repo_has_local_work $B/repo && print tag-has-work || print tag-clean
      print b > b; tk_repo_has_local_work $B/repo && print dirty-has-work
      git add b && git commit -qm two; tk_repo_has_local_work $B/repo && print unpushed-has-work
      git init -q $B/local; tk_repo_has_local_work $B/local && print no-remote-has-work`);
    expect(out.trim().split("\n")).toEqual(["pushed-clean", "tag-clean", "dirty-has-work", "unpushed-has-work", "no-remote-has-work"]);
  });
});

describe("apply repos", () => {
  it("asks before cloning a clean repo from GitHub, skips without a terminal, and remembers the answer", async () => {
    const out = await zsh(`
      tk_engine_init $HOME/.travel-kit; KIT_SEQ=1 TK_HB=$TK_TMP/hb
      git init -q --bare $TK_TMP/origin.git
      print -r -- "add\trepo\tclean\tmain\t$TK_TMP/origin.git" > $TK_TMP/changes.tsv
      tk_apply_repos $TK_TMP/changes.tsv
      [[ -e $HOME/dev/clean ]] && print cloned || print not-cloned
      tk_state_get $(tk_apply_key add-repo clean)
      tk_choose() { print -u2 asked-again; print c }
      tk_apply_repos $TK_TMP/changes.tsv 2>&1`);
    expect(out.trim().split("\n")).toEqual(["not-cloned", "skipped"]);
  });
});

describe("scan", () => {
  it("lists custom scripts but not shims that launch an app bundle", async () => {
    const out = await zsh(`
      d=$TK_TMP/bin; mkdir -p $d; TK_SCRIPT_DIRS=($d)
      print -r -- '#!/bin/sh\n/Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"' > $d/tailscale
      print -r -- '#!/bin/zsh\naws ssm start-session' > $d/druid-forward
      print -r -- '#!/bin/zsh\nset -e\nexec /Applications/Wireshark.app/Contents/MacOS/Wireshark -k' > $d/pcap
      chmod +x $d/*
      tk_scan_scripts | cut -f2`);
    expect(out.trim().split("\n")).toEqual([expect.stringMatching(/\/druid-forward$/), expect.stringMatching(/\/pcap$/)]);
  });
});

describe("step engine", () => {
  it("skips finished steps, records failures and blocks, and resumes on the next run", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "tk-steps-"));
    const script = `
      TK_YES=1
      tk_phase demo "Demo"
      tk_kind flaky demo "flaky"
      tk_kind needy demo "needy"
      tk_flaky_check() { [[ -f $HOME/$1 ]] }
      tk_flaky_run() { [[ -f $HOME/allow ]] || { print "not yet"; return 1 }; touch $HOME/$1 }
      tk_needy_needs() { [[ -f $HOME/allow ]] || print "permission" }
      tk_needy_check() { [[ -f $HOME/needy-done ]] }
      tk_needy_run() { touch $HOME/needy-done }
      tk_engine_init $HOME/.travel-kit
      tk_step flaky one; tk_step flaky two; tk_step needy three
      touch $HOME/one
      tk_run_all >/dev/null
      tk_summary >/dev/null; print "exit $?"
      for key in flaky:one flaky:two needy:three; do print -r -- "$key $(tk_state_get $key)"; done`;
    const first = await zsh(script, { HOME: home });
    expect(first.trim().split("\n")).toEqual(["exit 1", "flaky:one ok", "flaky:two failed", "needy:three blocked"]);
    await zsh("touch $HOME/allow", { HOME: home });
    const second = await zsh(script, { HOME: home });
    expect(second.trim().split("\n")).toEqual(["exit 0", "flaky:one ok", "flaky:two ok", "needy:three ok"]);
  });
});

describe("handback diff", () => {
  it("reports added and removed packages and changed files, but not version-only package changes", async () => {
    const out = await zsh(`
      print -r -- $'formula\\tjq\\t1.7\\t\\nformula\\tgone\\t1\\t\\ndotfile\\t.zshrc\\taaa\\t\\nbb\\tthreads\\t3\\t' > $TK_TMP/base
      print -r -- $'formula\\tjq\\t1.8\\t\\nformula\\tripgrep\\t14\\t\\ndotfile\\t.zshrc\\tbbb\\t\\nbb\\tthreads\\t5\\t' > $TK_TMP/now
      tk_diff_items $TK_TMP/base $TK_TMP/now | cut -f1-3`);
    expect(out.trim().split("\n")).toEqual(["add\tformula\tripgrep", "change\tdotfile\t.zshrc", "remove\tformula\tgone"]);
  });

  it("applies the profile's exclusions and app classes to a scan", async () => {
    const out = await zsh(`
      print -r -- $'exclude\\trepo\\tsrsRAN_4G\\t\\nclass\\tapp\\tSlack\\tmanual' > $TK_TMP/profile
      print -r -- $'repo\\tsrsRAN_4G\\tmaster\\t\\nrepo\\thss\\tmain\\t\\napp\\tSlack\\t4\\tiru\\napp\\tChrome\\t1\\tiru' | tk_profile_apply $TK_TMP/profile`);
    expect(out.trim().split("\n")).toEqual(["repo\thss\tmain\t", "app\tSlack\t4\tmanual", "app\tChrome\t1\tiru"]);
  });
});
