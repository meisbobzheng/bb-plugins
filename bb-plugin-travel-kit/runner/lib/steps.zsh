typeset -ga TK_STEPS TK_PHASES
typeset -gA TK_PHASE_TITLE TK_KIND_PHASE TK_KIND_LABEL TK_KIND_INTERACTIVE TK_RESULT TK_NOTE
typeset -ga TK_HANDS_ON TK_DRIFT

tk_phase() { TK_PHASES+=$1; TK_PHASE_TITLE[$1]=$2 }

tk_kind() {
  local kind=$1 phase=$2 label=$3
  TK_KIND_PHASE[$kind]=$phase
  TK_KIND_LABEL[$kind]=$label
  [[ ${4:-} == interactive ]] && TK_KIND_INTERACTIVE[$kind]=1
}

tk_step() {
  local kind=$1 name=$2 version=${3:-} extra=${4:-}
  (( ${+TK_KIND_PHASE[$kind]} )) || tk_die "unknown step kind: $kind"
  TK_STEPS+=("$kind"$'\t'"$name"$'\t'"$version"$'\t'"$extra")
}

tk_key() {
  local kind=$1 name=$2
  print -r -- "${kind}:${name//[^A-Za-z0-9._@-]/_}"
}

tk_state_file() { print -r -- "$TK_STATE_DIR/${1//:/__}" }

tk_state_get() {
  local file=$(tk_state_file $1)
  [[ -f $file ]] && print -r -- "${$(<$file)%%$'\t'*}"
}

tk_state_set() {
  local key=$1 state=$2 message=${3:-} file=$(tk_state_file $1)
  print -r -- "$state"$'\t'"$EPOCHSECONDS"$'\t'"$message" >"$file.tmp" && mv -f "$file.tmp" "$file"
}

tk_has_fn() { (( ${+functions[$1]} )) }

tk_call() {
  local fn=tk_${1}_$2
  shift 2
  tk_has_fn $fn || return 0
  $fn "$@"
}

tk_label() {
  local kind=$1 name=$2 version=$3
  print -r -- "${(r:6:)TK_KIND_LABEL[$kind]} ${name}${version:+ ${TK_DIM}${version}${TK_RESET}}"
}

tk_selected() {
  local key=$1
  [[ -z ${TK_ONLY:-} ]] && return 0
  [[ $key == ${~TK_ONLY} ]]
}

tk_last_log_line() {
  local log=$1 line
  [[ -s $log ]] || return 0
  line=$(tail -c 400 "$log" | tr '\r' '\n' | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -v '^[[:space:]]*$' | tail -1)
  print -r -- "$line"
}

tk_run_logged() {
  local log=$1 label=$2 index=$3 total=$4
  shift 4
  local started=$EPOCHSECONDS frame=0 width=$(( ${COLUMNS:-100} - 2 ))
  ( "$@" ) >>"$log" 2>&1 </dev/null &
  local pid=$!
  if [[ -t 1 ]]; then
    while kill -0 $pid 2>/dev/null; do
      local head="[$index/$total] $label ${TK_SPIN[$(( frame % 10 + 1 ))]} $(tk_duration $(( EPOCHSECONDS - started )))"
      local tail=$(tk_last_log_line "$log")
      local plain=${(S)head//$'\e'\[[0-9;]#m/}
      local room=$(( width - ${#plain} - 3 ))
      (( room > 10 )) && [[ -n $tail ]] && head+=" ${TK_DIM}· $(tk_fit "$tail" $room)${TK_RESET}"
      print -nr -- "${TK_CLEAR}${head}"
      (( frame++ ))
      zselect -t 15
    done
  fi
  wait $pid
}

tk_needs() {
  local kind=$1 name=$2 version=$3 extra=$4 missing
  missing=$(tk_call $kind needs "$name" "$version" "$extra")
  [[ -n $missing ]] && print -r -- "$missing"
}

tk_check_all() {
  local entry kind name version extra key
  for entry in $TK_STEPS; do
    IFS=$'\t' read -r kind name version extra <<<"$entry"
    key=$(tk_key $kind $name)
    tk_selected $key || continue
    if [[ -n $(tk_needs $kind "$name" "$version" "$extra") ]]; then
      TK_RESULT[$key]=pending
    elif tk_call $kind check "$name" "$version" "$extra" >/dev/null 2>&1; then
      TK_RESULT[$key]=done
    else
      TK_RESULT[$key]=pending
    fi
  done
}

tk_print_plan() {
  local phase entry kind name version extra key done=0 todo=0 you=0 total=0
  typeset -A phase_todo phase_done
  for entry in $TK_STEPS; do
    IFS=$'\t' read -r kind name version extra <<<"$entry"
    key=$(tk_key $kind $name)
    tk_selected $key || continue
    (( total++ ))
    phase=${TK_KIND_PHASE[$kind]}
    if [[ ${TK_RESULT[$key]} == done ]]; then
      (( done++, phase_done[$phase]++ ))
    else
      (( phase_todo[$phase]++ ))
      if (( ${+TK_KIND_INTERACTIVE[$kind]} )); then (( you++ )); else (( todo++ )); fi
    fi
  done
  tk_banner "Plan"
  print -r -- "${TK_BOLD}$total steps${TK_RESET} · ${TK_GREEN}$done already done${TK_RESET} · $todo to install · ${TK_YELLOW}$you need you${TK_RESET}"
  local n=0
  for phase in $TK_PHASES; do
    (( n++ ))
    local d=${phase_done[$phase]:-0} t=${phase_todo[$phase]:-0}
    (( d + t == 0 )) && continue
    local mark="${TK_GREEN}✓${TK_RESET}"
    (( t > 0 )) && mark="${TK_YELLOW}${t} left${TK_RESET}"
    print -r -- "  $(( n )). ${(r:28:)TK_PHASE_TITLE[$phase]} $mark"
  done
  if [[ ${TK_VERBOSE:-0} == 1 || ${TK_MODE:-} == check ]]; then
    print -r -- ""
    for entry in $TK_STEPS; do
      IFS=$'\t' read -r kind name version extra <<<"$entry"
      key=$(tk_key $kind $name)
      tk_selected $key || continue
      [[ ${TK_RESULT[$key]} == done ]] && continue
      local why=$(tk_needs $kind "$name" "$version" "$extra")
      print -r -- "  ${TK_YELLOW}·${TK_RESET} $(tk_label $kind "$name" "$version")${why:+  ${TK_DIM}(needs $why)${TK_RESET}}  ${TK_DIM}$key${TK_RESET}"
    done
  fi
}

tk_run_all() {
  local entry kind name version extra key phase current= index=0 total=${#TK_STEPS} phase_n=0
  for entry in $TK_STEPS; do
    IFS=$'\t' read -r kind name version extra <<<"$entry"
    (( index++ ))
    key=$(tk_key $kind $name)
    tk_selected $key || continue
    phase=${TK_KIND_PHASE[$kind]}
    if [[ $phase != $current ]]; then
      current=$phase
      phase_n=${TK_PHASES[(i)$phase]}
      tk_banner "$phase_n/${#TK_PHASES}  ${TK_PHASE_TITLE[$phase]}"
      tk_call phase start $phase
    fi
    tk_run_one $index $total "$kind" "$name" "$version" "$extra"
  done
}

tk_run_one() {
  local index=$1 total=$2 kind=$3 name=$4 version=$5 extra=$6
  local key=$(tk_key $kind $name) label=$(tk_label $kind "$name" "$version")
  local prefix="[$index/$total]" log="$TK_LOG_DIR/${index}-${key//[:\/]/_}.log"
  local missing=$(tk_needs $kind "$name" "$version" "$extra")
  if [[ -n $missing ]]; then
    TK_RESULT[$key]=blocked TK_NOTE[$key]="needs $missing"
    tk_state_set $key blocked "needs $missing"
    print -r -- "$prefix $label  ${TK_YELLOW}⊘ blocked — needs $missing${TK_RESET}"
    return
  fi
  if tk_call $kind check "$name" "$version" "$extra" >/dev/null 2>&1; then
    TK_RESULT[$key]=done
    tk_state_set $key ok
    print -r -- "$prefix $label  ${TK_GREEN}✓${TK_RESET} ${TK_DIM}already done${TK_RESET}"
    tk_call $kind drift "$name" "$version" "$extra"
    return
  fi
  if [[ $(tk_state_get $key) == skipped && ${TK_RETRY_SKIPPED:-0} != 1 ]]; then
    TK_RESULT[$key]=skipped
    print -r -- "$prefix $label  ${TK_DIM}↷ skipped earlier (travel-kit retry $key)${TK_RESET}"
    return
  fi
  if [[ ${TK_MODE:-} == check ]]; then
    TK_RESULT[$key]=pending
    return
  fi
  local started=$EPOCHSECONDS rc
  print -r -- "# $key  $(strftime '%F %T' $EPOCHSECONDS)" >"$log"
  if (( ${+TK_KIND_INTERACTIVE[$kind]} )); then
    print -r -- "$prefix $label"
    if ! tk_interactive; then
      TK_RESULT[$key]=skipped TK_NOTE[$key]="needs you; rerun in a terminal"
      TK_HANDS_ON+=("$label — rerun \`travel-kit retry $key\` in a terminal")
      print -r -- "   ${TK_YELLOW}↷ needs you — skipped in non-interactive mode${TK_RESET}"
      return
    fi
    tk_call $kind run "$name" "$version" "$extra" 2> >(tee -a "$log" >&2)
    rc=$?
  else
    tk_run_logged "$log" "$label" $index $total tk_call $kind run "$name" "$version" "$extra"
    rc=$?
  fi
  local took=$(tk_duration $(( EPOCHSECONDS - started )))
  if (( rc == 0 )) && tk_call $kind check "$name" "$version" "$extra" >>"$log" 2>&1; then
    TK_RESULT[$key]=done
    tk_state_set $key ok
    print -r -- "${TK_CLEAR}$prefix $label  ${TK_GREEN}✓${TK_RESET} ${TK_DIM}$took${TK_RESET}"
    tk_call $kind drift "$name" "$version" "$extra"
  elif (( rc == 3 )); then
    TK_RESULT[$key]=skipped
    tk_state_set $key skipped "skipped by you"
    print -r -- "${TK_CLEAR}$prefix $label  ${TK_DIM}↷ skipped${TK_RESET}"
  else
    local why=$(tk_last_log_line "$log")
    (( rc == 0 )) && why="ran, but the check afterwards still fails"
    TK_RESULT[$key]=failed TK_NOTE[$key]="$why"
    tk_state_set $key failed "$why"
    print -r -- "${TK_CLEAR}$prefix $label  ${TK_RED}✗ $took${TK_RESET} — $(tk_fit "$why" 70)"
    print -r -- "   ${TK_DIM}log: $log${TK_RESET}"
    [[ -t 1 ]] && tail -n 5 "$log" | sed -e 's/^/   │ /'
  fi
}

tk_summary() {
  local entry kind name version extra key
  local -a done failed blocked skipped
  for entry in $TK_STEPS; do
    IFS=$'\t' read -r kind name version extra <<<"$entry"
    key=$(tk_key $kind $name)
    tk_selected $key || continue
    case ${TK_RESULT[$key]:-pending} in
      done) done+=$key ;;
      failed) failed+=("$key"$'\t'"${TK_NOTE[$key]}") ;;
      blocked) blocked+=("$key"$'\t'"${TK_NOTE[$key]}") ;;
      skipped) skipped+=("$key"$'\t'"${TK_NOTE[$key]:-skipped}") ;;
    esac
  done
  tk_banner "Summary"
  print -r -- "${TK_GREEN}${#done} done${TK_RESET} · ${TK_RED}${#failed} failed${TK_RESET} · ${TK_YELLOW}${#blocked} blocked${TK_RESET} · ${#skipped} skipped"
  local row k note
  if (( ${#failed} )); then
    print -r -- "\n${TK_BOLD}Failed${TK_RESET}"
    for row in $failed; do
      IFS=$'\t' read -r k note <<<"$row"
      print -r -- "  ${TK_RED}✗${TK_RESET} $k — $(tk_fit "$note" 80)"
      print -r -- "    ${TK_DIM}travel-kit retry $k${TK_RESET}"
    done
  fi
  if (( ${#blocked} )); then
    print -r -- "\n${TK_BOLD}Blocked${TK_RESET}"
    for row in $blocked; do
      IFS=$'\t' read -r k note <<<"$row"
      print -r -- "  ${TK_YELLOW}⊘${TK_RESET} $k — $note"
    done
  fi
  if (( ${#skipped} )); then
    print -r -- "\n${TK_BOLD}Skipped${TK_RESET}"
    for row in $skipped; do
      IFS=$'\t' read -r k note <<<"$row"
      print -r -- "  ↷ $k — $note  ${TK_DIM}(travel-kit retry $k)${TK_RESET}"
    done
  fi
  if (( ${#TK_DRIFT} )); then
    print -r -- "\n${TK_BOLD}Version differences${TK_RESET} ${TK_DIM}(installed what's current; your main laptop has the other version)${TK_RESET}"
    for row in $TK_DRIFT; do print -r -- "  ≠ $row"; done
  fi
  if (( ${#TK_HANDS_ON} )); then
    print -r -- "\n${TK_BOLD}Still needs you${TK_RESET}"
    for row in $TK_HANDS_ON; do print -r -- "  ☐ $row"; done
  fi
  print -r -- "\n${TK_DIM}Full logs: $TK_LOG_DIR${TK_RESET}"
  (( ${#failed} == 0 ))
}

tk_engine_init() {
  local root=$1
  TK_STATE_DIR=$root/state
  TK_LOG_DIR=$root/logs/$(strftime '%Y%m%d-%H%M%S' $EPOCHSECONDS)
  mkdir -p "$TK_STATE_DIR" "$TK_LOG_DIR"
  ln -sfn "$TK_LOG_DIR" "$root/logs/latest"
}
