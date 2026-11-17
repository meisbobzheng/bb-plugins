TK_DOTFILES=(
  .zshrc .zprofile .zshenv .zlogin .zlogout .profile .bashrc .bash_profile .inputrc .hushlogin
  .gitconfig .gitignore_global .gitignore .vimrc .vim .tmux.conf .p10k.zsh .editorconfig .oh-my-zsh .aws/config
)
TK_CLAUDE_ENTRIES=(
  settings.json CLAUDE.md keybindings.json statusline-command.sh loop.md
  skills agents commands hooks output-styles rules workflows routines plugins
)
TK_SCRIPT_DIRS=(/opt/homebrew/bin /usr/local/bin '~/.local/bin' '~/bin')
TK_SCRIPT_IGNORE=(brew travel-kit)

tk_emit() { print -r -- "$1"$'\t'"$2"$'\t'"${3:-}"$'\t'"${4:-}" }

tk_scan_brew() {
  (( $+commands[brew] )) || return 0
  local name version
  for name in ${(f)"$(brew tap 2>/dev/null)"}; do
    [[ $name == homebrew/(core|cask) ]] || tk_emit tap "$name"
  done
  local -a leaves=(${(f)"$(brew leaves --installed-on-request 2>/dev/null)"})
  if (( ${#leaves} )); then
    brew list --formula --versions $leaves 2>/dev/null | while read -r name version _; do
      tk_emit formula "$name" "$version"
    done
  fi
  typeset -A apps
  local token app
  while IFS=$'\t' read -r token app; do
    [[ ,${apps[$token]:-}, == *,$app,* ]] || apps[$token]=${apps[$token]:+${apps[$token]},}$app
  done < <(tk_scan_cask_apps)
  brew list --cask --versions 2>/dev/null | while read -r name version _; do
    tk_emit cask "$name" "$version" "${apps[$name]:-}"
  done
}

tk_scan_cask_apps() {
  (( $+commands[brew] )) || return 0
  local json=$TK_TMP/casks.json
  brew info --cask --json=v2 --installed >"$json" 2>/dev/null || return 0
  sqlite3 -separator $'\t' :memory: "
    SELECT DISTINCT json_extract(c.value, '\$.token'), replace(t.value, rtrim(t.value, replace(t.value, '/', '')), '')
    FROM json_each(readfile($(tk_sql $json)), '\$.casks') c, json_tree(c.value, '\$.artifacts') t
    WHERE t.type = 'text' AND t.value LIKE '%.app'"
}

tk_scan_apps() {
  local -a cask_apps=(${${(f)"$(tk_scan_cask_apps)"}#*$'\t'})
  local app id
  for app in /Applications/*.app(N) $HOME/Applications/*.app(N); do
    [[ -d $app/Contents/_MASReceipt ]] && continue
    (( ${cask_apps[(Ie)${app:t}]} )) && continue
    id=$(plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist" 2>/dev/null)
    [[ $id == com.apple.* || $id == dev.bb.desktop || ${app:t} == Iru* ]] && continue
    local version=$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist" 2>/dev/null)
    tk_emit app "${app:t:r}" "$version" iru
  done
}

tk_scan_mas() {
  (( $+commands[mas] )) || return 0
  local id rest
  mas list 2>/dev/null | while read -r id rest; do
    local version=${${rest##*\(}%\)}
    tk_emit mas "$id" "$version" "${${rest% \(*}%%[[:space:]]#}"
  done
}

tk_scan_npm() {
  (( $+commands[npm] )) || return 0
  local line spec
  for line in ${(f)"$(npm ls -g --depth=0 --parseable --long 2>/dev/null)"}; do
    spec=${line#*:}
    [[ $spec == *@* && $line == */node_modules/* ]] || continue
    local name=${spec%@*} version=${spec##*@}
    [[ $name == (npm|corepack) ]] && continue
    tk_emit npm "$name" "$version"
  done
}

tk_scan_uv() {
  (( $+commands[uv] )) || return 0
  local name version
  uv tool list 2>/dev/null | while read -r name version _; do
    [[ $name == -* || -z $name ]] && continue
    tk_emit uv "$name" "${version#v}"
  done
}

tk_scan_pipx() {
  (( $+commands[pipx] )) || return 0
  local name version
  pipx list --short 2>/dev/null | while read -r name version _; do
    tk_emit pipx "$name" "$version"
  done
}

tk_app_shim() {
  local -a body=(${(f)"$(sed 1d "$1" 2>/dev/null)"})
  (( ${#body} == 1 )) && [[ ${body[1]} == *.app/Contents/MacOS/* ]]
}

tk_scan_scripts() {
  local dir file
  for dir in ${~TK_SCRIPT_DIRS}; do
    for file in $dir/*(N.x); do
      (( ${TK_SCRIPT_IGNORE[(Ie)${file:t}]} )) && continue
      [[ $(head -c 2 "$file" 2>/dev/null) == '#!' ]] || continue
      tk_app_shim "$file" && continue
      tk_emit script "${file/#$HOME/~}" "$(tk_hash_path "$file")"
    done
  done
}

tk_scan_home() {
  local entry
  for entry in $TK_DOTFILES; do
    [[ -e $HOME/$entry ]] && tk_emit dotfile "$entry" "$(tk_hash_path "$HOME/$entry")"
  done
  for entry in $HOME/.config/*(N) $HOME/.config/.*(N); do
    [[ ${entry:t} == (gh|op|1Password|gcloud|configstore) ]] && [[ ${entry:t} != gh ]] && continue
    tk_emit config "${entry:t}" "$(tk_hash_path "$entry")"
  done
  for entry in $TK_CLAUDE_ENTRIES; do
    [[ -e $HOME/.claude/$entry ]] && tk_emit claude "$entry" "$(tk_hash_path "$HOME/.claude/$entry")"
  done
}

tk_scan_repos() {
  local git repo remote branch
  for git in $HOME/dev/*/.git(N/) $HOME/dev/*/*/.git(N/) $HOME/dev/*/*/*/.git(N/); do
    repo=${git:h}
    remote=$(tk_git -C "$repo" remote get-url origin 2>/dev/null)
    branch=$(tk_git -C "$repo" symbolic-ref --short -q HEAD)
    tk_emit repo "${repo#$HOME/dev/}" "$branch" "$remote"
  done
}

tk_scan_bb() {
  local db=$HOME/.bb/bb.db
  [[ -f $db ]] || return 0
  local uri="file:$db?mode=ro"
  local since=$(( (EPOCHSECONDS - ${TK_DAYS:-7} * 86400) * 1000 ))
  tk_emit bb threads "$(sqlite3 "$uri" "SELECT count(*) FROM threads WHERE deleted_at IS NULL AND archived_at IS NULL AND updated_at >= $since")"
  tk_emit bb settings
  tk_emit bb plugin-data
  sqlite3 -separator $'\t' "$uri" "
    SELECT 'marketplace', name, manifest_url, '' FROM plugin_marketplaces WHERE name NOT IN ('bb-official', 'bb-community')" 2>/dev/null
  sqlite3 -separator $'\t' "$uri" "
    SELECT 'bbplugin', id, source, enabled || ':' || coalesce(source_git_subdirectory, '') FROM plugins
    WHERE removed_at IS NULL AND source NOT LIKE 'builtin:%' ORDER BY id" 2>/dev/null
}

tk_scan() {
  tk_scan_brew
  tk_scan_mas
  tk_scan_apps
  tk_scan_npm
  tk_scan_uv
  tk_scan_pipx
  tk_scan_scripts
  tk_scan_home
  tk_scan_repos
  tk_scan_bb
}

tk_profile_apply() {
  local profile=$1 kind name version extra action pkind pname value
  typeset -A excluded classes
  if [[ -f $profile ]]; then
    while IFS=$'\t' read -r action pkind pname value; do
      case $action in
        exclude) excluded[$pkind:$pname]=1 ;;
        class) classes[$pkind:$pname]=$value ;;
      esac
    done <"$profile"
  fi
  while IFS=$'\t' read -r kind name version extra; do
    (( ${+excluded[$kind:$name]} )) && continue
    (( ${+classes[$kind:$name]} )) && extra=${classes[$kind:$name]}
    tk_emit "$kind" "$name" "$version" "$extra"
  done
}
