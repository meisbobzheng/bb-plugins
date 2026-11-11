TK_OP_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"
TK_BB_FEED=https://github.com/get-bb/bb/releases/download/desktop-latest
TK_ESSENTIAL_FORMULAE=(git gh awscli node mas uv pipx jq)

tk_phase preflight "Preflight"
tk_phase admin "Admin rights and Homebrew"
tk_phase essentials "Essential tools"
tk_phase iru "Iru Self Service"
tk_phase signin "Sign-ins"
tk_phase packages "Packages"
tk_phase config "Shell, config and scripts"
tk_phase cloud "AWS SSO"
tk_phase repos "Repos in ~/dev"
tk_phase bb "bb"
tk_phase handback "Handback"

tk_kind macos preflight "macOS"
tk_kind disk preflight "disk"
tk_kind network preflight "net"
tk_kind clt preflight "xcode" interactive
tk_kind sudo admin "admin" interactive
tk_kind homebrew admin "brew"
tk_kind essential essentials "brew"
tk_kind iru iru "iru" interactive
tk_kind app iru "app"
tk_kind gate-1password signin "1pass" interactive
tk_kind gate-github signin "github" interactive
tk_kind gate-aws cloud "aws" interactive
tk_kind tap packages "tap"
tk_kind formula packages "brew"
tk_kind cask packages "cask"
tk_kind mas packages "mas"
tk_kind npm packages "npm"
tk_kind uv packages "uv"
tk_kind pipx packages "pipx"
tk_kind dotfile config "file"
tk_kind config config "config"
tk_kind claude config "claude"
tk_kind script config "script"
tk_kind repo repos "repo"
tk_kind bb-app bb "bb"
tk_kind bb-start bb "bb"
tk_kind marketplace bb "market"
tk_kind bbplugin bb "plugin"
tk_kind bb-content bb "bb"
tk_kind handback-repo handback "repo"
tk_kind baseline handback "state"
tk_kind command handback "cmd"

tk_bb() {
  local cli=$HOME/.bb/bin/bb
  [[ -x $cli ]] || return 127
  "$cli" "$@"
}

tk_bb_running() { tk_bb status >/dev/null 2>&1 }

tk_bb_app() {
  local app
  for app in $HOME/Applications/bb.app /Applications/bb.app; do
    [[ -d $app ]] && { print -r -- "$app"; return }
  done
  return 1
}

tk_need_cmd() {
  rehash
  local cmd
  for cmd in "$@"; do (( $+commands[$cmd] )) || { print -r -- "$cmd"; return } done
}

tk_version_major() { print -r -- "${${1%%.*}//[^0-9]/}" }

tk_macos_check() { (( $(tk_version_major "$(sw_vers -productVersion)") >= 13 )) }
tk_macos_run() { print -r -- "macOS $(sw_vers -productVersion) is older than bb supports (13+)"; return 1 }

TK_MIN_FREE_GB=20
tk_disk_check() { (( $(df -g "$HOME" | awk 'NR == 2 { print $4 }') >= TK_MIN_FREE_GB )) }
tk_disk_run() { print -r -- "Less than $TK_MIN_FREE_GB GB free on $HOME; free up space and rerun"; return 1 }

tk_network_check() { curl -fsS -m 15 -o /dev/null https://github.com }
tk_network_run() { print -r -- "Can't reach github.com. Connect to the internet (and VPN if needed), then rerun"; return 1 }

tk_clt_check() { xcode-select -p >/dev/null 2>&1 && [[ -x $(xcode-select -p)/usr/bin/git || -x /Library/Developer/CommandLineTools/usr/bin/git ]] }
tk_clt_run() {
  tk_say "   Installing Apple's Command Line Tools (git, compilers). A system dialog will open: click Install."
  xcode-select --install 2>/dev/null
  local waited=0
  until tk_clt_check; do
    (( waited % 30 == 0 )) && tk_say "   ${TK_DIM}still waiting for the Command Line Tools installer ($(tk_duration $waited))…${TK_RESET}"
    sleep 5
    (( waited += 5 ))
    (( waited > 3600 )) && return 1
  done
}

tk_sudo_check() { sudo -n true 2>/dev/null }
tk_sudo_run() {
  if ! id -Gn | tr ' ' '\n' | grep -qx admin; then
    tk_pause "You're not an admin right now. Open Privileges (or ask IT) to get admin rights" || return 3
  fi
  tk_say "   Your Mac password is needed once. It stays valid while this script runs."
  sudo -v || return 1
  tk_sudo_keepalive
}
tk_sudo_keepalive() {
  [[ -n ${TK_SUDO_PID:-} ]] && return
  { while kill -0 $$ 2>/dev/null; do sudo -n true 2>/dev/null; sleep 45; done } &!
  TK_SUDO_PID=$!
}

tk_homebrew_needs() { tk_sudo_check || print -r -- "admin rights (sudo)" }
tk_homebrew_check() { [[ -x /opt/homebrew/bin/brew || -x /usr/local/bin/brew ]] }
tk_homebrew_run() {
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

tk_brew_env() {
  local brew
  for brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [[ -x $brew ]] && { eval "$($brew shellenv)"; path=(/usr/bin /bin /usr/sbin /sbin ${path:#(/usr/bin|/bin|/usr/sbin|/sbin)}); break }
  done
  rehash
}

tk_formula_needs() { tk_need_cmd brew }
tk_formula_check() { brew list --formula --versions "$1" >/dev/null 2>&1 }
tk_formula_run() { brew install --formula "$1" }
tk_formula_drift() {
  local name=$1 want=$2 have=$(brew list --formula --versions "$1" 2>/dev/null | awk '{ print $NF }')
  [[ -n $want && -n $have && $want != $have ]] && TK_DRIFT+=("brew $name: $have here, $want on main")
}
tk_essential_needs() { tk_formula_needs "$@" }
tk_essential_check() { tk_formula_check "$@" }
tk_essential_run() { tk_formula_run "$@" }
tk_essential_drift() { tk_formula_drift "$@" }

tk_tap_needs() { tk_need_cmd brew }
tk_tap_check() { brew tap | grep -qix "$1" }
tk_tap_run() { brew tap "$1" }

tk_app_present() {
  local app
  for app in "$@"; do
    [[ -d /Applications/$app || -d $HOME/Applications/$app || -d /Applications/${app:r}.app ]] && return 0
  done
  return 1
}

tk_cask_needs() { tk_need_cmd brew }
tk_cask_check() {
  brew list --cask "$1" >/dev/null 2>&1 && return 0
  [[ -n $3 ]] && tk_app_present ${(s:,:)3}
}
tk_cask_run() { brew install --cask "$1" }
tk_cask_drift() {
  local name=$1 want=$2 have=$(brew list --cask --versions "$1" 2>/dev/null | awk '{ print $NF }')
  [[ -n $want && -n $have && $want != $have ]] && TK_DRIFT+=("cask $name: $have here, $want on main")
}

tk_mas_needs() { tk_need_cmd mas }
tk_mas_check() { mas list 2>/dev/null | awk '{ print $1 }' | grep -qx "$1" }
tk_mas_run() {
  mas get "$1" 2>/dev/null || mas install "$1" || {
    print -r -- "App Store install failed for ${3:-$1}: sign in to the App Store, then travel-kit retry mas:$1"
    return 1
  }
}

tk_app_check() { tk_app_present "$1.app" }
tk_app_run() {
  if [[ $3 == manual ]]; then
    print -r -- "$1 isn't installed. Download it from its vendor, then rerun"
  else
    print -r -- "$1 isn't installed yet. Get it from Iru Self Service, then rerun"
  fi
  return 1
}

tk_iru_apps() {
  local entry kind name version extra
  for entry in $TK_STEPS; do
    IFS=$'\t' read -r kind name version extra <<<"$entry"
    [[ $kind == app && $extra == iru ]] && ! tk_app_present "$name.app" && print -r -- "$name"
  done
}
tk_iru_check() { [[ -z $(tk_iru_apps) ]] }
tk_iru_run() {
  local -a missing=(${(f)"$(tk_iru_apps)"})
  tk_say "   These come from Iru, so install them in ${TK_BOLD}Iru Self Service${TK_RESET}:"
  print -rl -- "     · "${^missing}
  open -a "Iru Self Service" 2>/dev/null || open "/Applications/Iru Self Service.app" 2>/dev/null
  tk_say "   ${TK_DIM}Checking every 5 seconds. Press Enter to stop waiting and continue.${TK_RESET}"
  local reply
  while true; do
    missing=(${(f)"$(tk_iru_apps)"})
    (( ${#missing} == 0 )) && { tk_say "   ${TK_GREEN}✓${TK_RESET} all Iru apps are installed"; return 0 }
    print -nr -- "${TK_CLEAR}   waiting on ${#missing}: ${(j:, :)missing[1,4]}${missing[5]:+, …}"
    if read -r -t 5 reply </dev/tty; then
      print -r -- ""
      return 3
    fi
  done
}

tk_gate_1password_needs() { tk_app_present 1Password.app || print -r -- "the 1Password app (Iru)" }
tk_gate_1password_check() {
  [[ -S $TK_OP_SOCK ]] && SSH_AUTH_SOCK=$TK_OP_SOCK ssh-add -l >/dev/null 2>&1
}
tk_gate_1password_run() {
  open -a 1Password 2>/dev/null
  local tries=0
  until tk_gate_1password_check; do
    (( tries++ >= 3 )) && return 1
    tk_pause "In 1Password: sign in, then Settings → Developer → turn on \"Use the SSH agent\"" || return 3
  done
  tk_ssh_config_agent
}
tk_ssh_config_agent() {
  local config=$HOME/.ssh/config
  mkdir -p -m 700 "$HOME/.ssh"
  grep -qi IdentityAgent "$config" 2>/dev/null && return
  print -r -- $'\nHost *\n  IdentityAgent "~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"' >>"$config"
  chmod 600 "$config"
  tk_say "   added the 1Password SSH agent to ~/.ssh/config"
}

tk_gate_github_needs() { tk_need_cmd gh }
tk_gate_github_check() {
  gh auth status -h github.com >/dev/null 2>&1 || return 1
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | grep -q "successfully authenticated"
}
tk_gate_github_run() {
  if ! gh auth status -h github.com >/dev/null 2>&1; then
    tk_say "   Signing in to GitHub. A browser window opens; enter the code shown here."
    gh auth login -h github.com -p ssh --skip-ssh-key -w </dev/tty || return 1
  fi
  local tries=0
  until tk_gate_github_check; do
    (( tries++ >= 3 )) && return 1
    tk_pause "SSH to GitHub isn't working yet. Approve the 1Password prompt, or check your key is on GitHub" || return 3
  done
}

tk_aws_sessions() { grep -E '^\[sso-session ' "$HOME/.aws/config" 2>/dev/null | sed -E 's/^\[sso-session ([^]]+)\].*/\1/' }
tk_aws_profile_for() {
  awk -v s="$1" '/^\[profile /{ p=$2; sub(/\]$/, "", p) } $1 == "sso_session" && $3 == s && p != "" { print p; exit }' "$HOME/.aws/config"
}
tk_gate_aws_needs() { tk_need_cmd aws }
tk_gate_aws_check() {
  local profile=$(tk_aws_profile_for "$1")
  [[ -n $profile ]] && aws sts get-caller-identity --profile "$profile" >/dev/null 2>&1
}
tk_gate_aws_run() {
  tk_say "   Signing in to AWS SSO session $1. A browser window opens."
  aws sso login --sso-session "$1" </dev/tty
}

tk_npm_needs() { tk_need_cmd npm }
tk_npm_check() { npm ls -g --depth=0 "$1" >/dev/null 2>&1 }
tk_npm_run() { npm install -g --no-fund --no-audit "$1" }
tk_npm_drift() {
  local have=$(npm ls -g --depth=0 --parseable --long "$1" 2>/dev/null | tail -1)
  have=${have##*@}
  [[ -n $2 && -n $have && $have != $2 ]] && TK_DRIFT+=("npm $1: $have here, $2 on main")
}

tk_uv_needs() { tk_need_cmd uv }
tk_uv_check() { uv tool list 2>/dev/null | awk '{ print $1 }' | grep -qx "$1" }
tk_uv_run() { uv tool install "$1" }

tk_pipx_needs() { tk_need_cmd pipx }
tk_pipx_check() { pipx list --short 2>/dev/null | awk '{ print $1 }' | grep -qx "$1" }
tk_pipx_run() { pipx install "$1" }

tk_home_item_paths() {
  local kind=$1 name=$2 rel
  case $kind in
    dotfile) rel=$name ;;
    config) rel=.config/$name ;;
    claude) rel=.claude/$name ;;
  esac
  print -r -- "$TK_STAGE/home/$rel"$'\t'"$HOME/$rel"$'\t'"$rel"
}
tk_home_item_check() {
  local from to rel
  IFS=$'\t' read -r from to rel <<<"$(tk_home_item_paths "$@")"
  tk_tree_matches "$from" "$to"
}
tk_home_item_run() {
  local from to rel
  IFS=$'\t' read -r from to rel <<<"$(tk_home_item_paths "$@")"
  [[ -e $from ]] || { print -r -- "not in this kit: $rel"; return 1 }
  tk_overlay "$from" "$to" "$TK_BACKUP_DIR/$rel"
}
for kind in dotfile config claude; do
  functions[tk_${kind}_check]="tk_home_item_check $kind \"\$@\""
  functions[tk_${kind}_run]="tk_home_item_run $kind \"\$@\""
done
unset kind

tk_script_target() {
  local name=$1
  [[ $name == '~/'* ]] && { print -r -- "$HOME/${name#\~/}"; return }
  print -r -- "$name"
}
tk_script_source() {
  local name=$1
  [[ $name == '~/'* ]] && { print -r -- "$TK_STAGE/home/${name#\~/}"; return }
  print -r -- "$TK_STAGE/root$name"
}
tk_script_needs() {
  local target=$(tk_script_target "$1")
  [[ $target == /opt/homebrew/* && ! -d /opt/homebrew/bin ]] && print -r -- "Homebrew"
}
tk_script_check() { cmp -s "$(tk_script_source "$1")" "$(tk_script_target "$1")" }
tk_script_run() {
  local from=$(tk_script_source "$1") to=$(tk_script_target "$1")
  [[ -f $from ]] || { print -r -- "not in this kit: $1"; return 1 }
  [[ -f $to ]] && mkdir -p "$TK_BACKUP_DIR/scripts" && cp -p "$to" "$TK_BACKUP_DIR/scripts/${to:t}"
  if mkdir -p "${to:h}" 2>/dev/null && [[ -w ${to:h} ]]; then
    cp -p "$from" "$to" && chmod +x "$to"
  else
    sudo -n mkdir -p "${to:h}" && sudo -n cp -p "$from" "$to" && sudo -n chmod +x "$to"
  fi
}

tk_repo_paths() {
  print -r -- "$HOME/dev/$1"$'\t'"$TK_KIT/payload/git/$1.bundle"$'\t'"$TK_KIT/payload/git/$1.tsv"
}
tk_repo_needs() { tk_need_cmd git }
tk_repo_check() {
  local repo bundle meta
  IFS=$'\t' read -r repo bundle meta <<<"$(tk_repo_paths "$1")"
  [[ -f $bundle ]] || { [[ -d $repo/.git ]]; return }
  tk_git_import_check "$repo" "$bundle" "$meta" "$SRC_HOME"
}
tk_repo_run() {
  local repo bundle meta
  IFS=$'\t' read -r repo bundle meta <<<"$(tk_repo_paths "$1")"
  if [[ ! -f $bundle ]]; then
    [[ -n $3 ]] || { print -r -- "no bundle and no remote for $1"; return 1 }
    tk_git clone "$3" "$repo"
    return
  fi
  tk_git_import "$repo" "$bundle" "$meta" "$SRC_HOME"
}

tk_bb_app_check() { tk_bb_app >/dev/null }
tk_bb_app_run() {
  local feed=$TK_TMP/latest-mac.yml arch=$(uname -m)
  curl -fsSL "$TK_BB_FEED/latest-mac.yml" -o "$feed" || return 1
  local file=$(awk '/- url:/ { print $3 }' "$feed" | grep '\.zip$' | { [[ $arch == arm64 ]] && grep arm64 || grep -v arm64 } | head -1)
  [[ -n $file ]] || { print -r -- "no bb download for $arch in the release feed"; return 1 }
  local want=$(awk -v f="$file" '$0 ~ "url: "f { getline; print $2; exit }' "$feed")
  local zip=$TK_TMP/$file
  print -r -- "downloading $file"
  curl -fL --progress-bar "$TK_BB_FEED/$file" -o "$zip" || return 1
  local have=$(shasum -a 512 "$zip" | awk '{ print $1 }' | xxd -r -p | base64)
  [[ -z $want || $have == $want ]] || { print -r -- "bb download is corrupt (sha512 mismatch)"; return 1 }
  mkdir -p "$HOME/Applications"
  ditto -x -k "$zip" "$HOME/Applications"
}
tk_bb_app_drift() {
  local app=$(tk_bb_app) have
  have=$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist" 2>/dev/null)
  [[ -n ${BB_VERSION:-} && -n $have && $have != $BB_VERSION ]] && TK_DRIFT+=("bb: $have here, $BB_VERSION on main")
}

tk_bb_start_needs() { tk_bb_app >/dev/null || print -r -- "the bb app" }
tk_bb_start_check() { [[ -s $HOME/.bb/host-id ]] && tk_bb_running }
tk_bb_start_run() { tk_bb_launch }

tk_bb_launch() {
  tk_bb_running && return 0
  open "$(tk_bb_app)" || return 1
  print -r -- "waiting for bb to start (finish its first-run screen if it shows one)"
  local waited=0
  until [[ -s $HOME/.bb/host-id ]] && tk_bb_running; do
    sleep 2
    (( waited += 2 ))
    (( waited % 20 == 0 )) && print -r -- "still waiting for bb ($(tk_duration $waited))"
    (( waited > 600 )) && return 1
  done
}

tk_bb_quit() {
  tk_bb_running || return 0
  print -r -- "quitting bb so its database can be updated safely"
  osascript -e 'tell application id "dev.bb.desktop" to quit' >/dev/null 2>&1
  local waited=0
  while tk_bb_running || pgrep -qf '/bb\.app/Contents/'; do
    sleep 1
    (( waited++ > 60 )) && { print -r -- "bb didn't quit; quit it with ⌘Q and rerun"; return 1 }
  done
}

tk_bb_needs_running() {
  tk_bb_running || print -r -- "bb running"
}

tk_marketplace_needs() { tk_bb_needs_running }
tk_marketplace_check() { tk_bb marketplace list 2>/dev/null | grep -qw -- "$1" }
tk_marketplace_run() { tk_bb marketplace add "$2" }

tk_bbplugin_source() {
  local source=$1
  [[ $source == path:* ]] || { print -r -- "$source"; return }
  local dir=${source#path:}
  dir=$(tk_git_map_home "$dir" "$SRC_HOME")
  [[ -d $dir ]] || dir=$HOME/${${dir#/Users/*/}}
  print -r -- "path:$dir"
}
tk_bbplugin_needs() {
  local missing=$(tk_bb_needs_running)
  [[ -n $missing ]] && { print -r -- "$missing"; return }
  local source=$(tk_bbplugin_source "$2")
  [[ $source == path:* && ! -d ${source#path:} ]] && print -r -- "${source#path:} (repo)"
  [[ $source == path:* ]] && tk_need_cmd npm
}
tk_bbplugin_check() { tk_bb plugin source "$1" >/dev/null 2>&1 }
tk_bbplugin_run() {
  local id=$1 source=$(tk_bbplugin_source "$2") enabled=${3%%:*} subdir=${3#*:}
  if [[ $source == path:* ]]; then
    local dir=${source#path:}
    (cd "$dir" && npm install --no-fund --no-audit) || return 1
    tk_bb plugin install --yes "$dir" || return 1
  else
    local spec=${source#git:} args=()
    [[ -n $subdir && $subdir != $3 ]] && args+=(--subdirectory "$subdir")
    if [[ $source == git:*@semver:* ]]; then
      local prefix=${${spec#*@semver:}%%:*}
      args+=(--tag-prefix "$prefix")
      spec="${spec%%@semver:*}@${spec##*:}"
    fi
    [[ $source == git:* ]] && spec=git:$spec
    tk_bb plugin install --yes $args "$spec" || return 1
  fi
  [[ $enabled == 0 ]] && tk_bb plugin disable "$id"
  return 0
}

tk_bb_content_needs() {
  [[ -s $HOME/.bb/host-id ]] || print -r -- "bb's first start"
}
tk_bb_content_check() {
  local list=$TK_KIT/payload/bb/threads.txt
  [[ -f $list ]] || return 0
  local want=$(grep -c . "$list") have
  (( want == 0 )) && return 0
  have=$(sqlite3 "file:$HOME/.bb/bb.db?mode=ro" "SELECT count(*) FROM threads WHERE id IN ($(sed -e "s/.*/'&'/" "$list" | paste -sd, -))" 2>/dev/null)
  [[ $have == $want ]]
}
tk_bb_content_run() {
  local host=$(tk_bb_host_id) payload=$TK_STAGE/bb
  [[ -n $host ]] || { print -r -- "bb has no host id yet"; return 1 }
  local migrations=$(tk_bb_migrations "$HOME/.bb/bb.db")
  [[ -n ${BB_MIGRATIONS:-} && $migrations != $BB_MIGRATIONS ]] &&
    print -r -- "bb versions differ ($migrations vs $BB_MIGRATIONS database migrations); copying the columns both have"
  tk_bb_quit || return 1
  local backup=$TK_BACKUP_DIR/bb
  mkdir -p "$backup"
  tk_sqlite_snapshot "$HOME/.bb/bb.db" "$backup/bb.db" || return 1
  print -r -- "backed up bb's database to $backup/bb.db"
  tk_bb_merge_payload "$payload" "$host" fresh || { tk_bb_launch; return 1 }
  tk_bb_launch
}

tk_bb_merge_payload() {
  local payload=$1 host=$2 mode=$3
  local work=$TK_TMP/content.db
  if [[ -f $payload/content.db ]]; then
    cp "$payload/content.db" "$work"
    tk_rewrite_sqlite "$work" ${(f)"$(tk_home_pairs "$SRC_HOME" "$HOME" | tr '\t' '\n')"} "$SRC_HOST_ID" "$host" || return 1
    [[ $mode == upsert ]] && { tk_bb_align_ids "$work" "$HOME/.bb/bb.db" || return 1 }
    tk_sqlite_merge "$work" "$HOME/.bb/bb.db" "$mode" || return 1
    print -r -- "merged $(sqlite3 "$work" 'SELECT count(*) FROM threads') threads into bb"
  fi
  local dir id
  for dir in $payload/plugins/*(N/); do
    id=${dir:t}
    mkdir -p "$HOME/.bb/plugins/$id"
    if [[ -f $dir/data.db ]]; then
      cp "$dir/data.db" "$TK_TMP/plugin.db"
      tk_rewrite_sqlite "$TK_TMP/plugin.db" ${(f)"$(tk_home_pairs "$SRC_HOME" "$HOME" | tr '\t' '\n')"} "$SRC_HOST_ID" "$host"
      if [[ -f $HOME/.bb/plugins/$id/data.db ]]; then
        tk_sqlite_merge "$TK_TMP/plugin.db" "$HOME/.bb/plugins/$id/data.db" "$mode" || print -r -- "couldn't merge $id's data"
      else
        cp "$TK_TMP/plugin.db" "$HOME/.bb/plugins/$id/data.db"
      fi
    fi
    [[ -d $dir/host-data ]] && tk_copy_tree "$dir/host-data" "$HOME/.bb/plugins/$id/host-data"
  done
  local sub
  for sub in thread-storage attachments theme skills; do
    [[ -d $payload/$sub ]] && tk_copy_tree "$payload/$sub" "$HOME/.bb/$sub"
  done
  if [[ -d $payload/claude-projects ]]; then
    mkdir -p "$HOME/.claude/projects"
    tk_copy_tree "$payload/claude-projects" "$HOME/.claude/projects"
  fi
  return 0
}

tk_handback_repo_needs() { tk_need_cmd gh git }
tk_handback_repo_check() { [[ -f $TK_ROOT/handback.env && -d $TK_ROOT/handback/.git ]] }
tk_handback_repo_run() {
  local owner=$(gh api user -q .login) || return 1
  local name="travel-kit-$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '-')"
  if ! gh repo view "$owner/$name" >/dev/null 2>&1; then
    gh repo create "$owner/$name" --private --description "travel-kit handbacks from $(hostname -s)" || return 1
  fi
  rm -rf "$TK_ROOT/handback"
  tk_git clone -q "git@github.com:$owner/$name.git" "$TK_ROOT/handback" || return 1
  {
    print -r -- "HANDBACK_REPO=$owner/$name"
    print -r -- "HANDBACK_SINCE_MS=${KIT_CREATED_MS:-$(( EPOCHSECONDS * 1000 ))}"
    print -r -- "HANDBACK_SEQ=0"
    print -r -- "MAIN_HOME=$SRC_HOME"
    print -r -- "MAIN_HOST_ID=$SRC_HOST_ID"
  } >"$TK_ROOT/handback.env"
  print -r -- "handbacks go to github.com/$owner/$name (private)"
}

tk_baseline_check() { [[ -s $TK_ROOT/baseline.tsv ]] }
tk_baseline_run() {
  tk_scan >"$TK_ROOT/baseline.tsv.tmp" && mv "$TK_ROOT/baseline.tsv.tmp" "$TK_ROOT/baseline.tsv"
  tk_repo_fingerprints >"$TK_ROOT/baseline-repos.tsv"
}

tk_command_target() {
  [[ -d /opt/homebrew/bin && -w /opt/homebrew/bin ]] && { print -r -- /opt/homebrew/bin/travel-kit; return }
  print -r -- "$HOME/.local/bin/travel-kit"
}
tk_command_check() { [[ $(readlink "$(tk_command_target)") == $TK_ROOT/kit/runner/travel-kit ]] }
tk_command_run() {
  local target=$(tk_command_target)
  mkdir -p "${target:h}"
  ln -sfn "$TK_ROOT/kit/runner/travel-kit" "$target"
}
