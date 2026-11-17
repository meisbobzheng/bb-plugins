TK_BB_CONTENT_TABLES=(
  projects project_sources project_execution_defaults project_attachments project_attachment_threads
  environments diff_viewed_files threads thread_sections thread_tabs thread_conversation_outlines
  thread_dynamic_context_file_states thread_plugin_metadata thread_search_segments events retained_event_outputs
  prompt_history_entries plugin_settings plugin_kv plugin_state_snapshots plugin_schedules
  app_settings app_settings_values app_theme ui_preferences ui_preference_defaults
)

tk_sqlite_snapshot() {
  local from=$1 to=$2
  rm -f "$to" "$to-wal" "$to-shm"
  sqlite3 "file:$from?mode=ro" ".backup $(tk_sql $to)" && sqlite3 "$to" "PRAGMA journal_mode=DELETE;" >/dev/null
}

tk_sqlite_tables() {
  sqlite3 "$1" "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL%' AND name NOT GLOB '*_fts_*' AND name NOT GLOB '*_fts'"
}

tk_sqlite_keep_only() {
  local db=$1
  shift
  local -a keep=("$@") drop=() triggers=() virtual=()
  local name
  triggers=(${(f)"$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type = 'trigger'")"})
  virtual=(${(f)"$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL%'")"})
  local sql="PRAGMA foreign_keys=OFF; BEGIN;"
  for name in $triggers; do sql+="DROP TRIGGER IF EXISTS \"$name\";"; done
  for name in $virtual; do sql+="DROP TABLE IF EXISTS \"$name\";"; done
  sql+="COMMIT;"
  sqlite3 "$db" "$sql"
  sql="PRAGMA foreign_keys=OFF; BEGIN;"
  for name in ${(f)"$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")"}; do
    (( ${keep[(Ie)$name]} )) || sql+="DROP TABLE IF EXISTS \"$name\";"
  done
  sql+="COMMIT;"
  sqlite3 "$db" "$sql"
}

tk_bb_export_content() {
  local bb_db=$1 out=$2 host_id=$3 since_ms=$4 include_inactive=${5:-0}
  tk_sqlite_snapshot "$bb_db" "$out" || return 1
  local active="deleted_at IS NULL AND archived_at IS NULL AND "
  (( include_inactive )) && active=
  local -a tables=($(tk_sqlite_tables "$out"))
  local -a prune=() table
  for table in events thread_tabs thread_conversation_outlines thread_dynamic_context_file_states thread_plugin_metadata thread_search_segments project_attachment_threads; do
    prune+="DELETE FROM $table WHERE thread_id NOT IN (SELECT id FROM tk_keep);"
  done
  prune+=(
    "DELETE FROM prompt_history_entries WHERE thread_id IS NOT NULL AND thread_id NOT IN (SELECT id FROM tk_keep);"
    "DELETE FROM retained_event_outputs WHERE event_id NOT IN (SELECT id FROM events);"
  )
  for table in project_execution_defaults project_attachments; do
    prune+="DELETE FROM $table WHERE project_id NOT IN (SELECT id FROM projects);"
  done
  prune+=(
    "DELETE FROM diff_viewed_files WHERE environment_id NOT IN (SELECT id FROM environments);"
    "UPDATE events SET environment_id = NULL WHERE environment_id NOT IN (SELECT id FROM environments);"
  )
  for table in plugin_kv plugin_settings app_settings_values; do
    prune+="DELETE FROM $table WHERE $(tk_secret_like key);"
  done
  local statement optional=
  for statement in $prune; do
    table=${${statement#(DELETE FROM|UPDATE) }%% *}
    (( ${tables[(Ie)$table]} )) && optional+="$statement"$'\n'
  done
  sqlite3 "$out" "
    PRAGMA foreign_keys=OFF;
    BEGIN;
    CREATE TABLE tk_keep (id TEXT PRIMARY KEY);
    WITH RECURSIVE k(id) AS (
      SELECT id FROM threads WHERE ${active}updated_at >= $since_ms
      UNION
      SELECT CASE n.n WHEN 1 THEN t.parent_thread_id WHEN 2 THEN t.source_thread_id ELSE t.lifecycle_owner_thread_id END
      FROM k JOIN threads t ON t.id = k.id CROSS JOIN (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3) n
      WHERE CASE n.n WHEN 1 THEN t.parent_thread_id WHEN 2 THEN t.source_thread_id ELSE t.lifecycle_owner_thread_id END IS NOT NULL
    )
    INSERT INTO tk_keep SELECT id FROM k;
    INSERT OR IGNORE INTO tk_keep SELECT id FROM threads WHERE parent_thread_id IN (SELECT id FROM tk_keep) AND deleted_at IS NULL;
    DELETE FROM threads WHERE id NOT IN (SELECT id FROM tk_keep);
    DELETE FROM environments WHERE host_id <> $(tk_sql $host_id) OR status = 'destroyed'
      OR id NOT IN (SELECT environment_id FROM threads WHERE environment_id IS NOT NULL);
    DELETE FROM project_sources WHERE host_id <> $(tk_sql $host_id);
    DELETE FROM projects WHERE deleted_at IS NOT NULL AND id NOT IN (SELECT project_id FROM threads);
    DELETE FROM project_sources WHERE project_id NOT IN (SELECT id FROM projects);
    DELETE FROM environments WHERE project_id NOT IN (SELECT id FROM projects);
    UPDATE threads SET environment_id = NULL WHERE environment_id NOT IN (SELECT id FROM environments);
    $optional
    COMMIT;" || return 1
  tk_sqlite_keep_only "$out" $TK_BB_CONTENT_TABLES tk_keep || return 1
  tk_bb_scrub_secrets "$out" || return 1
  sqlite3 "$out" "VACUUM;"
}

tk_bb_drop_settings() {
  sqlite3 "$1" "DELETE FROM app_settings; DELETE FROM app_settings_values; DELETE FROM ui_preferences; DELETE FROM app_theme;"
}

tk_bb_content_threads() {
  sqlite3 "$1" "SELECT id FROM threads"
}

tk_bb_content_env_paths() {
  sqlite3 -separator $'\t' "$1" "SELECT id, path, is_worktree, coalesce(environment_provider_plugin_id, '') FROM environments WHERE path IS NOT NULL"
}

tk_sqlite_merge() {
  local src=$1 dst=$2 mode=$3
  shift 3
  local -a only=("$@")
  local plan=$TK_TMP/merge-$EPOCHSECONDS-$RANDOM.sql
  sqlite3 -separator $'\t' "$dst" "
    ATTACH $(tk_sql $src) AS src;
    SELECT s.name, (
      SELECT group_concat('\"' || replace(a.name, '\"', '\"\"') || '\"', ',')
      FROM pragma_table_info(s.name, 'src') a JOIN pragma_table_info(s.name, 'main') b ON a.name = b.name
    )
    FROM src.sqlite_master s
    WHERE s.type = 'table' AND s.name NOT LIKE 'sqlite_%' AND s.name <> 'tk_keep' AND s.name <> '_bb_migrations'
      AND s.sql NOT LIKE 'CREATE VIRTUAL%' AND s.name NOT GLOB '*_fts_*'
      AND EXISTS (SELECT 1 FROM main.sqlite_master m WHERE m.type = 'table' AND m.name = s.name)" >"$plan.tables" || return 1
  {
    print -r -- "PRAGMA foreign_keys=OFF; PRAGMA recursive_triggers=ON;"
    print -r -- "ATTACH $(tk_sql $src) AS src;"
    print -r -- "BEGIN;"
    local table cols
    while IFS=$'\t' read -r table cols; do
      [[ -z $cols ]] && continue
      (( ${#only} )) && (( ! ${only[(Ie)$table]} )) && continue
      [[ $mode == fresh ]] && print -r -- "DELETE FROM main.\"$table\";"
      print -r -- "INSERT OR REPLACE INTO main.\"$table\" ($cols) SELECT $cols FROM src.\"$table\";"
    done <"$plan.tables"
    print -r -- "COMMIT;"
  } >"$plan"
  sqlite3 "$dst" <"$plan"
}

tk_bb_scrub_secrets() {
  local db=$1 table column notnull sql="PRAGMA foreign_keys=OFF; BEGIN;"
  for table in $(tk_sqlite_tables "$db"); do
    [[ ${table:l} =~ $TK_SECRET_TABLE_RE ]] && sql+="DELETE FROM \"$table\";"
  done
  while IFS=$'\t' read -r table column notnull; do
    local blank=NULL
    (( notnull )) && blank="''"
    sql+="UPDATE \"$table\" SET \"$column\" = $blank WHERE \"$column\" IS NOT NULL;"
  done < <(sqlite3 -separator $'\t' "$db" "
    SELECT m.name, c.name, c.\"notnull\" FROM sqlite_master m JOIN pragma_table_info(m.name) c
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.sql NOT LIKE 'CREATE VIRTUAL%' AND m.name NOT GLOB '*_fts_*'
      AND c.pk = 0 AND (lower(c.name) GLOB '*password*' OR lower(c.name) GLOB '*secret*' OR lower(c.name) GLOB '*token*'
        OR lower(c.name) GLOB '*api_key*' OR lower(c.name) GLOB '*apikey*' OR lower(c.name) GLOB '*credential*')")
  sqlite3 "$db" "$sql COMMIT;"
}

tk_bb_migrations() {
  sqlite3 "file:$1?mode=ro" "SELECT count(*) FROM __drizzle_migrations" 2>/dev/null
}

tk_bb_host_id() {
  local data=${1:-$HOME/.bb}
  [[ -s $data/host-id ]] && print -r -- "$(<$data/host-id)"
}
