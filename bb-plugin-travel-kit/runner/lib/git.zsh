tk_git() { git -c advice.detachedHead=false -c core.hooksPath=/dev/null "$@" }

tk_git_worktrees() {
  local repo=$1 line wt= branch=
  tk_git -C "$repo" worktree list --porcelain | while IFS= read -r line; do
    case $line in
      worktree\ *) wt=${line#worktree } branch= ;;
      branch\ *) branch=${line#branch refs/heads/} ;;
      '') [[ -n $wt ]] && print -r -- "$wt"$'\t'"$branch"; wt= ;;
    esac
  done
  [[ -n $wt ]] && print -r -- "$wt"$'\t'"$branch"
}

tk_git_export() {
  local repo=$1 out=$2
  shift 2
  local -a keep=(${^@:A})
  local meta=$out:r.tsv wt branch wip ref kind n=0 main=${$(tk_git -C "$repo" rev-parse --show-toplevel):A} dev=${HOME:A}/dev
  local remote=$(tk_git -C "$repo" remote get-url origin 2>/dev/null)
  local head=$(tk_git -C "$repo" symbolic-ref --short -q HEAD)
  mkdir -p "${out:h}"
  : >"$meta"
  print -r -- "remote"$'\t'"$remote" >>"$meta"
  print -r -- "head"$'\t'"$head" >>"$meta"
  local -a refs=()
  while IFS=$'\t' read -r wt branch; do
    [[ ! -d $wt ]] && continue
    wt=${wt:A}
    [[ $wt != $main ]] && (( ! ${keep[(Ie)$wt]} )) && [[ $wt != $dev/* ]] && continue
    (( n++ ))
    wip=$(tk_git_snapshot "$wt")
    ref=-
    if [[ -n $wip ]]; then
      ref=refs/travel-kit/wip/$n
      tk_git -C "$repo" update-ref "$ref" "$wip"
      refs+=$ref
    fi
    kind=worktree
    [[ $wt == $main ]] && kind=main
    print -r -- "$kind"$'\t'"$wt"$'\t'"$branch"$'\t'"$ref" >>"$meta"
  done < <(tk_git_worktrees "$repo")
  local rc=0
  if [[ -n $(tk_git -C "$repo" for-each-ref --count=1 refs/heads refs/tags refs/travel-kit) ]]; then
    tk_git -C "$repo" bundle create "$out" --branches --tags --glob=refs/travel-kit/wip || rc=$?
  fi
  for ref in $refs; do tk_git -C "$repo" update-ref -d "$ref"; done
  return $rc
}

tk_git_snapshot() {
  local wt=$1 index=$TK_TMP/index-$RANDOM
  local head=$(tk_git -C "$wt" rev-parse -q --verify HEAD) || return 0
  cp "$(tk_git -C "$wt" rev-parse --path-format=absolute --git-path index)" "$index" 2>/dev/null
  GIT_INDEX_FILE=$index tk_git -C "$wt" add -A . >/dev/null 2>&1
  local tree=$(GIT_INDEX_FILE=$index tk_git -C "$wt" write-tree)
  rm -f "$index"
  [[ -z $tree || $tree == $(tk_git -C "$wt" rev-parse "HEAD^{tree}") ]] && return 0
  tk_git -C "$wt" commit-tree "$tree" -p "$head" -m "travel-kit: uncommitted work"
}

tk_git_map_home() {
  local target=$1 src_home=$2 prefix
  for prefix in $src_home ${src_home:A}; do
    [[ $target == $prefix/* ]] && { print -r -- "$HOME/${target#$prefix/}"; return }
  done
  print -r -- "$target"
}

tk_git_branch_worktree() {
  local repo=$1 branch=$2 wt b
  while IFS=$'\t' read -r wt b; do
    [[ $b == $branch ]] && { print -r -- "$wt"; return }
  done < <(tk_git_worktrees "$repo")
}

tk_git_clean() {
  [[ -z $(tk_git -C "$1" status --porcelain 2>/dev/null) ]]
}

tk_git_integrate_branch() {
  local repo=$1 branch=$2 incoming=$3 stamp=$4
  local current=$(tk_git -C "$repo" rev-parse -q --verify "refs/heads/$branch")
  if [[ -z $current ]]; then
    tk_git -C "$repo" branch "$branch" "$incoming" >/dev/null
    print -r -- "added $branch"
    return
  fi
  [[ $current == $(tk_git -C "$repo" rev-parse "$incoming") ]] && return
  if tk_git -C "$repo" merge-base --is-ancestor "$incoming" "$current"; then
    return
  fi
  if tk_git -C "$repo" merge-base --is-ancestor "$current" "$incoming"; then
    local wt=$(tk_git_branch_worktree "$repo" "$branch")
    if [[ -z $wt ]]; then
      tk_git -C "$repo" update-ref "refs/heads/$branch" "$incoming" "$current"
      print -r -- "fast-forwarded $branch"
      return
    elif tk_git_clean "$wt"; then
      tk_git -C "$wt" merge --ff-only -q "$incoming" && { print -r -- "fast-forwarded $branch"; return }
    fi
  fi
  local side="travel-kit/${branch}-${stamp}"
  tk_git -C "$repo" branch -f "$side" "$incoming" >/dev/null
  print -r -- "kept both: $branch moved on both sides, incoming copy is $side"
}

tk_git_apply_wip() {
  local wt=$1 wip=$2 stamp=$3
  [[ -z $wip || $wip == - ]] && return 0
  local sha=$(tk_git -C "$wt" rev-parse -q --verify "$wip") || return 0
  if tk_git_clean "$wt" && [[ $(tk_git -C "$wt" rev-parse "$sha^1") == $(tk_git -C "$wt" rev-parse HEAD) ]]; then
    tk_git -C "$wt" read-tree --reset -u "$sha^{tree}" && tk_git -C "$wt" reset -q && {
      print -r -- "restored uncommitted work in ${wt:t}"
      return
    }
  fi
  local side="travel-kit/wip-${wt:t}-${stamp}"
  tk_git -C "$wt" branch -f "$side" "$sha" >/dev/null
  print -r -- "${wt:t} has its own changes, so the other laptop's uncommitted work is on branch $side"
}

tk_git_import() {
  local repo=$1 bundle=$2 meta=$3 src_home=$4
  local stamp=$(strftime '%Y%m%d' $EPOCHSECONDS) remote= head= key value
  while IFS=$'\t' read -r key value _; do
    case $key in remote) remote=$value ;; head) head=$value ;; esac
  done <"$meta"
  if [[ ! -d $repo/.git && ! -f $repo/.git ]]; then
    mkdir -p "${repo:h}"
    tk_git clone -q "$bundle" "$repo" || return 1
    [[ -n $head ]] && tk_git -C "$repo" checkout -q "$head" 2>/dev/null
    if [[ -n $remote ]]; then
      tk_git -C "$repo" remote set-url origin "$remote"
      tk_git -C "$repo" for-each-ref --format='delete %(refname)' refs/remotes/origin | tk_git -C "$repo" update-ref --stdin
      tk_git -C "$repo" fetch -q origin 2>/dev/null || print -r -- "could not reach $remote yet; run git fetch later"
      [[ -n $head ]] && tk_git -C "$repo" branch -q --set-upstream-to="origin/$head" "$head" 2>/dev/null
    else
      tk_git -C "$repo" remote remove origin
    fi
  fi
  tk_git -C "$repo" fetch -q "$bundle" '+refs/heads/*:refs/travel-kit/in/*' '+refs/travel-kit/wip/*:refs/travel-kit/wip/*' 2>/dev/null ||
    tk_git -C "$repo" fetch -q "$bundle" '+refs/heads/*:refs/travel-kit/in/*' || return 1
  tk_git -C "$repo" fetch -q "$bundle" '+refs/tags/*:refs/tags/*' 2>/dev/null
  local ref branch
  for ref in ${(f)"$(tk_git -C "$repo" for-each-ref --format='%(refname)' refs/travel-kit/in)"}; do
    branch=${ref#refs/travel-kit/in/}
    tk_git_integrate_branch "$repo" "$branch" "$ref" "$stamp"
  done
  local kind wt wip
  while IFS=$'\t' read -r kind wt branch wip; do
    [[ $kind == (main|worktree) ]] || continue
    wt=$(tk_git_map_home "$wt" "$src_home")
    if [[ $kind == worktree && ! -e $wt ]]; then
      mkdir -p "${wt:h}"
      tk_git -C "$repo" worktree prune
      if [[ -n $branch ]]; then
        tk_git -C "$repo" worktree add -q "$wt" "$branch" || continue
      else
        tk_git -C "$repo" worktree add -q --detach "$wt" || continue
      fi
    fi
    [[ $kind == main ]] && wt=$repo
    [[ -d $wt ]] && tk_git_apply_wip "$wt" "$wip" "$stamp"
  done <"$meta"
  for ref in ${(f)"$(tk_git -C "$repo" for-each-ref --format='%(refname)' refs/travel-kit)"}; do
    tk_git -C "$repo" update-ref -d "$ref"
  done
  return 0
}

tk_git_import_check() {
  local repo=$1 bundle=$2 meta=$3 src_home=$4 sha ref kind wt branch wip
  [[ -d $repo/.git || -f $repo/.git ]] || return 1
  while read -r sha ref; do
    [[ $ref == refs/heads/* ]] || continue
    tk_git -C "$repo" cat-file -e "$sha^{commit}" 2>/dev/null || return 1
  done < <(tk_git bundle list-heads "$bundle")
  while IFS=$'\t' read -r kind wt branch wip; do
    [[ $kind == worktree ]] || continue
    [[ -e $(tk_git_map_home "$wt" "$src_home") ]] || return 1
  done <"$meta"
}
