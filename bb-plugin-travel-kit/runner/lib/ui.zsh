zmodload zsh/datetime zsh/zselect

if [[ -t 1 ]]; then
  TK_BOLD=$'\e[1m' TK_DIM=$'\e[2m' TK_RED=$'\e[31m' TK_GREEN=$'\e[32m' TK_YELLOW=$'\e[33m' TK_BLUE=$'\e[34m' TK_RESET=$'\e[0m' TK_CLEAR=$'\r\e[K'
else
  TK_BOLD= TK_DIM= TK_RED= TK_GREEN= TK_YELLOW= TK_BLUE= TK_RESET= TK_CLEAR=$'\n'
fi
TK_SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)

tk_say() { print -r -- "$*" }
tk_info() { print -r -- "${TK_BLUE}›${TK_RESET} $*" }
tk_warn() { print -r -- "${TK_YELLOW}!${TK_RESET} $*" }
tk_error() { print -ru2 -- "${TK_RED}✗${TK_RESET} $*" }
tk_die() { tk_error "$*"; exit 1 }

tk_banner() {
  local title=$1 width=${COLUMNS:-80}
  (( width > 90 )) && width=90
  local line="━━ $title "
  local bar=
  repeat $(( width - ${#line} )) bar+=━
  print -r -- ""
  print -r -- "${TK_BOLD}${line}${bar}${TK_RESET}"
}

tk_duration() {
  local s=$1
  (( s < 60 )) && { print -r -- "${s}s"; return }
  print -r -- "$(( s / 60 ))m$(( s % 60 ))s"
}

tk_fit() {
  local text=$1 max=$2
  text=${text//$'\t'/ }
  text=${text//$'\r'/}
  (( ${#text} > max )) && text="${text[1,max-1]}…"
  print -r -- "$text"
}

tk_interactive() { [[ -t 0 && -t 1 && ${TK_YES:-0} != 1 ]] }

tk_pause() {
  local message=$1
  tk_interactive || return 1
  print -r -- ""
  print -r -- "${TK_YELLOW}⏸  Waiting for you:${TK_RESET} $message"
  local reply
  read -r "reply?   Press Enter when done, or type s to skip: " </dev/tty
  [[ $reply != [sS]* ]]
}

tk_choose() {
  local prompt=$1 keys=$2 reply
  tk_interactive || { print -r -- ${keys[1]}; return }
  while true; do
    read -r -k 1 "reply?$prompt " </dev/tty
    print -u2 ""
    [[ $keys == *${reply:l}* ]] && { print -r -- ${reply:l}; return }
  done
}

tk_confirm() {
  [[ $(tk_choose "$1 [y/n]" yn) == y ]]
}
