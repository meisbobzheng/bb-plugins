tk_formula_remove() { brew uninstall --formula "$1" }
tk_cask_remove() { brew uninstall --cask "$1" }
tk_tap_remove() { brew untap "$1" }
tk_npm_remove() { npm uninstall -g "$1" }
tk_uv_remove() { uv tool uninstall "$1" }
tk_pipx_remove() { pipx uninstall "$1" }

tk_stage() {
  local payload=$1 stage=$2 id=$3 sub
  [[ -f $stage/.ready && $(<$stage/.ready) == $id ]] && return 0
  rm -rf "$stage"
  mkdir -p "$stage"
  for sub in home root bb; do
    [[ -d $payload/$sub ]] && tk_copy_tree "$payload/$sub" "$stage/$sub"
  done
  tk_info "Rewriting paths from $SRC_HOME to $HOME"
  tk_rewrite_files "$stage" "$SRC_HOME" "$HOME"
  tk_rename_slug_dirs "$stage/bb/claude-projects" "$SRC_HOME" "$HOME"
  print -r -- "$id" >"$stage/.ready"
}

tk_bb_align_ids() {
  local work=$1 main=$2 table column
  local -a tables=($(tk_sqlite_tables "$work")) sql=()
  local -A remaps=(
    proj_map "projects:id project_sources:project_id project_execution_defaults:project_id project_attachments:project_id environments:project_id threads:project_id prompt_history_entries:project_id"
    env_map "threads:environment_id events:environment_id diff_viewed_files:environment_id environments:id"
    sec_map "threads:section_id thread_sections:id"
  )
  local -A maps=(
    proj_map "SELECT w.id AS old, p.id AS new FROM projects w JOIN m.projects p ON p.kind = 'personal' AND w.kind = 'personal' AND p.id <> w.id"
    env_map "SELECT w.id AS old, e.id AS new FROM environments w JOIN m.environments e ON e.project_id = w.project_id AND e.host_id = w.host_id AND e.path = w.path AND e.id <> w.id"
    sec_map "SELECT w.id AS old, s.id AS new FROM thread_sections w JOIN m.thread_sections s ON s.name = w.name AND s.id <> w.id"
  )
  local map target
  for map in proj_map env_map sec_map; do
    sql+="CREATE TEMP TABLE $map AS ${maps[$map]};"
    for target in ${=remaps[$map]}; do
      table=${target%%:*} column=${target#*:}
      (( ${tables[(Ie)$table]} )) || continue
      sql+="UPDATE $table SET $column = (SELECT new FROM $map WHERE old = $column) WHERE $column IN (SELECT old FROM $map);"
    done
  done
  sql+="UPDATE project_sources SET id = (SELECT s.id FROM m.project_sources s WHERE s.project_id = project_sources.project_id AND s.host_id = project_sources.host_id)
    WHERE EXISTS (SELECT 1 FROM m.project_sources s WHERE s.project_id = project_sources.project_id AND s.host_id = project_sources.host_id AND s.id <> project_sources.id);"
  sqlite3 -bail "$work" "PRAGMA foreign_keys=OFF; ATTACH $(tk_sql $main) AS m; BEGIN; ${(j: :)sql} COMMIT;"
}

tk_apply_key() { print -r -- "hb${KIT_SEQ}:$(tk_key "$1" "$2")" }

tk_apply_packages() {
  local changes=$1 op kind name version extra choice
  typeset -A all_kind
  while IFS=$'\t' read -r op kind name version extra; do
    (( ${TK_PACKAGE_KINDS[(Ie)$kind]} )) || [[ $kind == (bbplugin|marketplace) ]] || continue
    local key=$(tk_apply_key "$op-$kind" "$name")
    [[ -n $(tk_state_get $key) ]] && continue
    if [[ $op == add ]]; then
      tk_call $kind check "$name" "$version" "$extra" >/dev/null 2>&1 && { tk_state_set $key ok; continue }
      choice=${all_kind[add-$kind]:-}
      [[ -z $choice ]] && choice=$(tk_choose "  + $(tk_label $kind "$name" "$version") was added on the travel laptop. [s]kip, [i]nstall, [a]ll $kind, [n]one $kind?" sian)
      [[ $choice == a ]] && all_kind[add-$kind]=i choice=i
      [[ $choice == n ]] && all_kind[add-$kind]=s choice=s
      if [[ $choice == i ]]; then
        local missing=$(tk_needs $kind "$name" "$version" "$extra")
        if [[ -n $missing ]]; then
          tk_warn "    needs $missing; skipped"
          continue
        fi
        if tk_call $kind run "$name" "$version" "$extra" >>"$TK_LOG_DIR/apply.log" 2>&1; then
          tk_state_set $key ok
          tk_say "    ${TK_GREEN}✓${TK_RESET} installed"
        else
          tk_error "    install failed (log: $TK_LOG_DIR/apply.log)"
        fi
      else
        tk_state_set $key skipped
      fi
    elif [[ $op == remove ]]; then
      tk_call $kind check "$name" "$version" "$extra" >/dev/null 2>&1 || { tk_state_set $key ok; continue }
      choice=${all_kind[remove-$kind]:-}
      [[ -z $choice ]] && choice=$(tk_choose "  − $(tk_label $kind "$name" "$version") was removed on the travel laptop. [k]eep, [u]ninstall, [a]ll keep?" kua)
      [[ $choice == a ]] && all_kind[remove-$kind]=k choice=k
      if [[ $choice == u ]] && tk_has_fn tk_${kind}_remove; then
        tk_call $kind remove "$name" >>"$TK_LOG_DIR/apply.log" 2>&1 && tk_say "    removed"
      fi
      tk_state_set $key ok
    fi
  done <"$changes"
}

tk_file_paths() {
  local kind=$1 name=$2
  if [[ $kind == script ]]; then
    print -r -- "$(tk_script_source "$name")"$'\t'"$(tk_script_target "$name")"
  else
    local rel=$(tk_home_rel $kind "$name")
    print -r -- "$TK_STAGE/home/$rel"$'\t'"$HOME/$rel"
  fi
}

tk_apply_files() {
  local changes=$1 op kind name version extra choice from to
  typeset -A all_kind
  while IFS=$'\t' read -r op kind name version extra; do
    (( ${TK_FILE_KINDS[(Ie)$kind]} )) || continue
    local key=$(tk_apply_key "$op-$kind" "$name")
    [[ -n $(tk_state_get $key) ]] && continue
    IFS=$'\t' read -r from to <<<"$(tk_file_paths $kind "$name")"
    if [[ $op == remove ]]; then
      tk_say "  − $kind $name was deleted on the travel laptop; keeping your copy (delete it yourself if you want)"
      tk_state_set $key ok
      continue
    fi
    [[ -e $from ]] || continue
    if tk_tree_matches "$from" "$to"; then
      tk_state_set $key ok
      continue
    fi
    choice=${all_kind[$kind]:-}
    while [[ -z $choice ]]; do
      choice=$(tk_choose "  ≠ $kind $name changed on the travel laptop. [m] keep main, [t]ake travel, [d]iff, [a]ll travel $kind?" mtda)
      if [[ $choice == d ]]; then
        git --no-pager diff --no-index --color=always -- "$to" "$from" 2>/dev/null | head -n 200
        choice=
      fi
    done
    [[ $choice == a ]] && all_kind[$kind]=t choice=t
    if [[ $choice == t ]]; then
      if [[ $kind == script ]]; then
        tk_script_run "$name" && tk_say "    ${TK_GREEN}✓${TK_RESET} updated"
      else
        tk_overlay "$from" "$to" "$TK_BACKUP_DIR/${to#$HOME/}" && tk_say "    ${TK_GREEN}✓${TK_RESET} updated (old copy in $TK_BACKUP_DIR)"
      fi
    fi
    tk_state_set $key ok
  done <"$changes"
}

tk_apply_repos() {
  local changes=$1 op kind name version extra key choice all=
  while IFS=$'\t' read -r op kind name version extra; do
    [[ $kind == repo && $op != remove ]] || continue
    local bundle=$TK_HB/payload/git/$name.bundle meta=$TK_HB/payload/git/$name.tsv
    if [[ ! -f $bundle ]]; then
      [[ $op == add && -n $extra && ! -e $HOME/dev/$name ]] || continue
      key=$(tk_apply_key "$op-$kind" "$name")
      [[ -n $(tk_state_get $key) ]] && continue
      choice=$all
      [[ -z $choice ]] && choice=$(tk_choose "  + repo $name is on the travel laptop with nothing unpushed. [s]kip, [c]lone, [a]ll repos, [n]o repos?" scan)
      [[ $choice == a ]] && all=c choice=c
      [[ $choice == n ]] && all=s choice=s
      if [[ $choice == s ]]; then
        tk_state_set $key skipped
      elif tk_git clone -q "$extra" "$HOME/dev/$name"; then
        tk_state_set $key ok
        tk_say "    ${TK_GREEN}✓${TK_RESET} cloned"
      else
        tk_warn "    couldn't clone $extra"
      fi
      continue
    fi
    tk_info "repo $name"
    tk_git_import "$HOME/dev/$name" "$bundle" "$meta" "$SRC_HOME" | sed -e 's/^/    /'
  done <"$changes"
}

tk_apply_bb() {
  local payload=$TK_STAGE/bb
  [[ -d $payload ]] || return 0
  local key=$(tk_apply_key bb content)
  [[ $(tk_state_get $key) == ok ]] && return 0
  local count=$(grep -c . "$TK_HB/payload/bb/threads.txt" 2>/dev/null)
  tk_say "  bb: ${count:-0} threads changed on the travel laptop. The travel copy wins."
  local host=$(tk_bb_host_id)
  [[ -n $host ]] || { tk_error "bb isn't set up on this laptop"; return 1 }
  if [[ -z ${TK_BB_SETTINGS:-} ]]; then
    TK_BB_SETTINGS=$(tk_choose "  bb settings, theme and skills from the travel laptop: [k]eep this laptop's, [t]ake the travel laptop's?" kt)
    [[ $TK_BB_SETTINGS == t ]] && TK_BB_SETTINGS=take || TK_BB_SETTINGS=keep
  fi
  local was_running=0
  tk_bb_running && was_running=1
  if (( was_running )) && ! tk_confirm "  bb has to quit for a moment to merge them. Quit bb now?"; then
    tk_warn "  skipped bb; run travel-kit apply again when you're ready"
    return 0
  fi
  tk_bb_quit || return 1
  mkdir -p "$TK_BACKUP_DIR/bb"
  tk_sqlite_snapshot "$HOME/.bb/bb.db" "$TK_BACKUP_DIR/bb/bb.db" || return 1
  tk_say "  backed up bb's database to $TK_BACKUP_DIR/bb/bb.db"
  local rc=0
  tk_bb_merge_payload "$payload" "$host" upsert $TK_BB_SETTINGS || rc=1
  (( was_running )) && tk_bb_launch
  (( rc == 0 )) && tk_state_set $key ok
  return $rc
}

tk_apply_one() {
  TK_HB=$1
  tk_join_parts "$TK_HB"
  tk_load_env "$TK_HB/kit.env" || { tk_error "$TK_HB has no kit.env"; return 1 }
  TK_STAGE=$TK_ROOT/staging/handback-$KIT_SEQ
  tk_banner "Handback $KIT_SEQ from $SRC_HOSTNAME ($(strftime '%F %R' $(( KIT_CREATED_MS / 1000 ))))"
  tk_stage "$TK_HB/payload" "$TK_STAGE" "$KIT_ID"
  local changes=$TK_HB/changes.tsv
  tk_info "Packages and apps"
  tk_apply_packages "$changes"
  tk_info "Dotfiles, config and scripts"
  tk_apply_files "$changes"
  tk_info "Repos"
  tk_apply_repos "$changes"
  tk_info "bb threads and plugin data"
  tk_apply_bb
}

tk_handback_repos() {
  gh repo list --limit 200 --json nameWithOwner -q '.[].nameWithOwner' | grep '/travel-kit-'
}

tk_apply() {
  local from=$1 repo=$2 dir
  if [[ -n $from && -d $from/handbacks ]]; then
    dir=$from
    repo=${repo:-$(tk_git -C "$dir" remote get-url origin 2>/dev/null | sed -E 's#.*github.com[:/]##; s#\.git$##')}
  else
    if [[ -z $repo ]]; then
      local -a repos=(${(f)"$(tk_handback_repos)"})
      (( ${#repos} )) || tk_die "No travel-kit-* repos on your GitHub account yet."
      if (( ${#repos} == 1 )); then
        repo=${repos[1]}
      else
        local i=0 r
        for r in $repos; do (( i++ )); tk_say "  $i. $r"; done
        local pick
        read -r "pick?Which travel laptop? " </dev/tty
        repo=${repos[$pick]}
      fi
    fi
    dir=$TK_ROOT/handbacks/${repo:t}
    if [[ -d $dir/.git ]]; then
      tk_git -C "$dir" pull -q --ff-only || tk_die "Couldn't update $dir"
    else
      mkdir -p "${dir:h}"
      tk_git clone -q "git@github.com:$repo.git" "$dir" || tk_die "Couldn't clone $repo (is SSH to GitHub working?)"
    fi
  fi
  local applied_file=$TK_ROOT/applied/${repo:t}.env APPLIED_SEQ=0
  mkdir -p "${applied_file:h}"
  tk_load_env "$applied_file"
  local hb seq found=0
  for hb in $dir/handbacks/*(N/on); do
    seq=$(( 10#${${hb:t}%%-*} ))
    (( seq > APPLIED_SEQ )) || continue
    found=1
    tk_apply_one "$hb" || { tk_error "Handback $seq didn't finish. Fix the problem above and run travel-kit apply again; finished items are skipped."; return 1 }
    print -r -- "APPLIED_SEQ=$seq" >"$applied_file"
  done
  (( found )) || tk_info "Nothing new from $repo (last applied: handback $APPLIED_SEQ)."
  return 0
}
