TK_PACKAGE_KINDS=(tap formula cask mas npm uv pipx app)
TK_FILE_KINDS=(dotfile config claude script)
TK_SPLIT_BYTES=$(( 90 * 1024 * 1024 ))

tk_home_rel() {
  case $1 in
    dotfile) print -r -- "$2" ;;
    config) print -r -- ".config/$2" ;;
    claude) print -r -- ".claude/$2" ;;
  esac
}

tk_kit_env() {
  local kind=$1 seq=${2:-0}
  local app=$(tk_bb_app 2>/dev/null)
  print -r -- "KIT_KIND=$kind"
  print -r -- "KIT_ID=$(hostname -s)-$(strftime '%Y%m%d-%H%M%S' $EPOCHSECONDS)"
  print -r -- "KIT_SEQ=$seq"
  print -r -- "KIT_CREATED_MS=$(( EPOCHSECONDS * 1000 ))"
  print -r -- "SRC_HOME=$HOME"
  print -r -- "SRC_USER=$USER"
  print -r -- "SRC_HOSTNAME=$(hostname -s)"
  print -r -- "SRC_HOST_ID=$(tk_bb_host_id)"
  print -r -- "BB_VERSION=${app:+$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist" 2>/dev/null)}"
  print -r -- "BB_MIGRATIONS=$(tk_bb_migrations "$HOME/.bb/bb.db")"
}

tk_load_env() {
  local file=$1 line
  [[ -f $file ]] || return 1
  while IFS= read -r line; do
    [[ $line == [A-Z_]##=* ]] && typeset -g "${line%%=*}=${line#*=}"
  done <"$file"
}

tk_has_item() { grep -q "^$1"$'\t'"$2"$'\t' "$3" }

tk_kit_payload() {
  local kit=$1 items=$2 since=$3 include_inactive=$4
  local payload=$kit/payload kind name version extra rel id dir sub slug from to pair env_id env_path is_wt provider n=0
  local -A slugs
  mkdir -p "$payload"
  local -a keep_worktrees=()
  if tk_has_item bb threads "$items"; then
    tk_info "Exporting bb threads active since $(strftime '%F %R' $(( since / 1000 )))"
    mkdir -p "$payload/bb"
    tk_bb_export_content "$HOME/.bb/bb.db" "$payload/bb/content.db" "$(tk_bb_host_id)" "$since" "$include_inactive" || return 1
    if ! tk_has_item bb settings "$items"; then
      sqlite3 "$payload/bb/content.db" "DELETE FROM app_settings; DELETE FROM app_settings_values; DELETE FROM ui_preferences; DELETE FROM app_theme;"
    fi
    tk_bb_content_threads "$payload/bb/content.db" >"$payload/bb/threads.txt"
    tk_info "  $(grep -c . "$payload/bb/threads.txt") threads"
    for id in ${(f)"$(<$payload/bb/threads.txt)"}; do
      [[ -d $HOME/.bb/thread-storage/$id ]] && tk_copy_tree "$HOME/.bb/thread-storage/$id" "$payload/bb/thread-storage/$id" .git
    done
    if [[ $include_inactive == 0 ]]; then
      for dir in $HOME/.bb/thread-storage/*(N/); do
        [[ ${dir:t} == thr_* ]] || tk_copy_tree "$dir" "$payload/bb/thread-storage/${dir:t}" .git
      done
    fi
    [[ -d $HOME/.bb/attachments ]] && tk_copy_tree "$HOME/.bb/attachments" "$payload/bb/attachments"
    while IFS=$'\t' read -r env_id env_path is_wt provider; do
      [[ $is_wt == 1 ]] && keep_worktrees+=$env_path
      slugs[$(tk_slug "$env_path")]=1
      if [[ $env_path == $HOME/.bb/plugins/*/host-data/workspaces/* && -d $env_path ]]; then
        tk_copy_tree "$env_path" "$payload/bb/plugins/${${env_path#$HOME/.bb/plugins/}%%/*}/host-data/${env_path#*/host-data/}" .git
      fi
    done < <(tk_bb_content_env_paths "$payload/bb/content.db")
    for env_path in ${(f)"$(sqlite3 "$payload/bb/content.db" 'SELECT path FROM project_sources')"}; do
      slugs[$(tk_slug "$env_path")]=1
    done
    for slug in ${(k)slugs}; do
      [[ -d $HOME/.claude/projects/$slug ]] && tk_copy_tree "$HOME/.claude/projects/$slug" "$payload/bb/claude-projects/$slug"
    done
  fi
  if tk_has_item bb settings "$items"; then
    for sub in theme skills; do
      [[ -d $HOME/.bb/$sub ]] && tk_copy_tree "$HOME/.bb/$sub" "$payload/bb/$sub"
    done
  fi
  if tk_has_item bb plugin-data "$items"; then
    tk_info "Exporting bb plugin data (without auth or token tables)"
    for id in ${(f)"$(sqlite3 "file:$HOME/.bb/bb.db?mode=ro" 'SELECT id FROM plugins WHERE removed_at IS NULL')"}; do
      from=$HOME/.bb/plugins/$id to=$payload/bb/plugins/$id
      [[ -d $from ]] || continue
      if [[ -f $from/data.db ]]; then
        mkdir -p "$to"
        tk_sqlite_snapshot "$from/data.db" "$to/data.db" && tk_bb_scrub_secrets "$to/data.db"
      fi
      [[ -d $from/host-data ]] && tk_copy_tree "$from/host-data" "$to/host-data" ./worktrees ./workspaces
    done
  fi
  local -a file_items=() repo_items=()
  while IFS=$'\t' read -r kind name version extra; do
    case $kind in
      dotfile|config|claude)
        rel=$(tk_home_rel $kind "$name")
        [[ -e $HOME/$rel ]] && file_items+="$HOME/$rel"$'\t'"$payload/home/$rel" ;;
      script)
        if [[ $name == '~/'* ]]; then
          file_items+="$HOME/${name#\~/}"$'\t'"$payload/home/${name#\~/}"
        else
          file_items+="$name"$'\t'"$payload/root$name"
        fi ;;
      repo) repo_items+=$name ;;
    esac
  done <"$items"
  (( ${#file_items} )) && tk_info "Copying ${#file_items} dotfiles, config folders and scripts (secrets excluded)"
  for pair in $file_items; do
    IFS=$'\t' read -r from to <<<"$pair"
    tk_copy_tree "$from" "$to" || tk_warn "couldn't copy $from"
  done
  for name in $repo_items; do
    (( n++ ))
    tk_info "[$n/${#repo_items}] bundling repo $name"
    tk_git_export "$HOME/dev/$name" "$payload/git/$name.bundle" $keep_worktrees || tk_warn "couldn't bundle $name"
  done
  return 0
}

tk_kit_runner() {
  local kit=$1
  mkdir -p "$kit/runner"
  tk_copy_tree "$TK_RUNNER" "$kit/runner"
  cat >"$kit/install.sh" <<'EOF'
#!/bin/zsh
exec /bin/zsh "${0:A:h}/runner/travel-kit" install --kit "${0:A:h}" "$@"
EOF
  cat >"$kit/apply.sh" <<'EOF'
#!/bin/zsh
exec /bin/zsh "${0:A:h}/runner/travel-kit" apply --from "${0:A:h}" "$@"
EOF
  chmod +x "$kit/install.sh" "$kit/apply.sh"
}

tk_generate() {
  local out=$1 profile=$2 zip=$3
  local since=$(( (EPOCHSECONDS - ${TK_DAYS:-7} * 86400) * 1000 ))
  local kit=$out/travel-kit-$(strftime '%Y%m%d-%H%M' $EPOCHSECONDS)
  [[ -e $kit ]] && rm -rf "$kit"
  mkdir -p "$kit"
  tk_info "Scanning this Mac"
  tk_scan | tk_profile_apply "$profile" >"$kit/items.tsv" || return 1
  local counts=$(cut -f1 "$kit/items.tsv" | sort | uniq -c | awk '{ printf "%s %s, ", $1, $2 }')
  tk_info "  ${counts%, }"
  tk_kit_env install >"$kit/kit.env"
  tk_kit_payload "$kit" "$kit/items.tsv" "$since" 0 || return 1
  tk_kit_runner "$kit"
  if [[ $zip == 1 ]]; then
    tk_info "Zipping the kit"
    (cd "${kit:h}" && ditto -c -k --sequesterRsrc --keepParent "${kit:t}" "${kit:t}.zip") || return 1
    rm -rf "$kit"
    kit=$kit.zip
  fi
  tk_info "Kit ready: $kit ($(du -sh "$kit" | cut -f1))"
  print -r -- "::kit $kit"
}

tk_repo_fingerprints() {
  local git repo
  for git in $HOME/dev/*/.git(N/) $HOME/dev/*/*/.git(N/) $HOME/dev/*/*/*/.git(N/); do
    repo=${git:h}
    print -r -- "${repo#$HOME/dev/}"$'\t'"$( { tk_git -C "$repo" for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags; tk_git -C "$repo" status --porcelain; tk_git_worktrees "$repo" } 2>/dev/null | shasum -a 256 | cut -c1-16)"
  done
}

tk_diff_items() {
  local base=$1 now=$2 kind name version extra
  typeset -A old new
  while IFS=$'\t' read -r kind name version extra; do old[$kind:$name]=$version; done <"$base"
  while IFS=$'\t' read -r kind name version extra; do
    new[$kind:$name]=1
    if (( ! ${+old[$kind:$name]} )); then
      print -r -- "add"$'\t'"$kind"$'\t'"$name"$'\t'"$version"$'\t'"$extra"
    elif (( ${TK_FILE_KINDS[(Ie)$kind]} )) && [[ ${old[$kind:$name]} != $version ]]; then
      print -r -- "change"$'\t'"$kind"$'\t'"$name"$'\t'"$version"$'\t'"$extra"
    fi
  done <"$now"
  while IFS=$'\t' read -r kind name version extra; do
    [[ $kind == bb ]] && continue
    (( ${+new[$kind:$name]} )) || print -r -- "remove"$'\t'"$kind"$'\t'"$name"$'\t'"$version"$'\t'"$extra"
  done <"$base"
}

tk_split_large() {
  local root=$1 file
  for file in ${(f)"$(find "$root" -type f -size +$(( TK_SPLIT_BYTES / 1024 ))k 2>/dev/null)"}; do
    split -b $TK_SPLIT_BYTES "$file" "$file.part-" && rm -f "$file"
  done
}

tk_join_parts() {
  local root=$1 first
  for first in ${(f)"$(find "$root" -type f -name '*.part-aa' 2>/dev/null)"}; do
    local base=${first%.part-aa}
    cat "$base".part-* >"$base" && rm -f "$base".part-*
  done
}

tk_handback() {
  local dry=$1
  tk_load_env "$TK_ROOT/handback.env" || tk_die "No handback repo yet. Run travel-kit install first (it creates one)."
  [[ -s $TK_ROOT/baseline.tsv ]] || tk_die "No baseline from install; run travel-kit retry 'baseline:*'"
  local started=$(( EPOCHSECONDS * 1000 )) seq=$(( HANDBACK_SEQ + 1 ))
  local repo=$TK_ROOT/handback
  tk_info "Updating the handback repo ($HANDBACK_REPO)"
  tk_git -C "$repo" pull -q --rebase 2>/dev/null
  local now=$TK_TMP/now.tsv changes=$TK_TMP/changes.tsv
  tk_info "Scanning this laptop for changes since the last handback"
  tk_scan >"$now" || return 1
  tk_diff_items "$TK_ROOT/baseline.tsv" "$now" >"$changes"
  tk_repo_fingerprints >"$TK_TMP/repos.tsv"
  local name print_fp
  typeset -A old_fp
  while IFS=$'\t' read -r name print_fp; do old_fp[$name]=$print_fp; done <"$TK_ROOT/baseline-repos.tsv"
  while IFS=$'\t' read -r name print_fp; do
    [[ ${old_fp[$name]:-} == $print_fp ]] && continue
    grep -q "^add"$'\t'"repo"$'\t'"$name"$'\t' "$changes" || print -r -- "change"$'\t'"repo"$'\t'"$name"$'\t'$'\t' >>"$changes"
  done <"$TK_TMP/repos.tsv"
  local dir=$repo/handbacks/$(printf '%04d' $seq)-$(strftime '%Y%m%d-%H%M' $EPOCHSECONDS)
  local items=$TK_TMP/payload-items.tsv
  awk -F'\t' '$1 != "remove" { print $2 "\t" $3 "\t" $4 "\t" $5 }' "$changes" >"$items"
  print -r -- "bb"$'\t'"threads"$'\t'$'\t' >>"$items"
  print -r -- "bb"$'\t'"plugin-data"$'\t'$'\t' >>"$items"
  local -A summary
  local op kind version extra
  while IFS=$'\t' read -r op kind name version extra; do (( summary[$op]++ )); done <"$changes"
  tk_info "Changes: ${summary[add]:-0} added, ${summary[change]:-0} changed, ${summary[remove]:-0} removed, plus bb threads updated since $(strftime '%F %R' $(( HANDBACK_SINCE_MS / 1000 )))"
  if [[ $dry == 1 ]]; then
    column -t -s $'\t' "$changes" 2>/dev/null || cat "$changes"
    return 0
  fi
  mkdir -p "$dir"
  cp "$changes" "$dir/changes.tsv"
  tk_kit_env handback $seq >"$dir/kit.env"
  print -r -- "MAIN_HOME=$MAIN_HOME" >>"$dir/kit.env"
  tk_kit_payload "$dir" "$items" "$HANDBACK_SINCE_MS" 1 || return 1
  tk_split_large "$dir"
  tk_kit_runner "$repo"
  [[ -f $repo/README.md ]] || print -r -- "# travel-kit handbacks\n\nOn your main laptop, quit bb, then run \`./apply.sh\` from a clone of this repo, or \`travel-kit apply $HANDBACK_REPO\`." >"$repo/README.md"
  tk_git -C "$repo" add -A
  tk_git -C "$repo" commit -qm "Handback $seq from $(hostname -s)" || return 1
  tk_info "Pushing handback $seq"
  SSH_AUTH_SOCK=${SSH_AUTH_SOCK:-$TK_OP_SOCK} tk_git -C "$repo" push -q origin HEAD || { tk_error "Push failed; it's committed locally, so run travel-kit handback again to retry the push"; return 1 }
  cp "$now" "$TK_ROOT/baseline.tsv"
  cp "$TK_TMP/repos.tsv" "$TK_ROOT/baseline-repos.tsv"
  tk_handback_env_set HANDBACK_SEQ $seq
  tk_handback_env_set HANDBACK_SINCE_MS $started
  tk_info "Handback $seq is on GitHub: $HANDBACK_REPO"
}

tk_handback_env_set() {
  local key=$1 value=$2 file=$TK_ROOT/handback.env
  { grep -v "^$key=" "$file"; print -r -- "$key=$value" } >"$file.tmp" && mv "$file.tmp" "$file"
}
