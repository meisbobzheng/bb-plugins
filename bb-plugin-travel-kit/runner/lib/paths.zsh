TK_SECRET_EXCLUDES=(
  .ssh .gnupg '*.pem' '*.key' '*.p12' '*.pfx' '*.jks' '*.keystore' '*.kdbx' 'id_rsa*' 'id_ed25519*' 'id_ecdsa*' 'id_dsa*'
  credentials '*credentials' .netrc .npmrc .pgpass .git-credentials .env '.env.*' auth.json .credentials.json hosts.yml
  .zsh_history .bash_history '*.sock'
)
for _w in credential secret token password; do
  for _e in json yaml yml txt toml ini conf db sqlite; do TK_SECRET_EXCLUDES+="*${_w}*.${_e}"; done
done
unset _w _e
TK_SECRET_SQL_LIKE="(lower(%s) LIKE '%%token%%' OR lower(%s) LIKE '%%secret%%' OR lower(%s) LIKE '%%password%%' OR lower(%s) LIKE '%%credential%%' OR lower(%s) LIKE '%%apikey%%' OR lower(%s) LIKE '%%api_key%%' OR lower(%s) LIKE '%%auth%%')"
TK_SECRET_TABLE_RE='(auth|token|secret|credential|session|password)'

tk_slug() { print -r -- "${1//[^A-Za-z0-9]/-}" }

tk_sql() { print -r -- "'${1//\'/\'\'}'" }

tk_secret_like() {
  local col=$1
  printf "$TK_SECRET_SQL_LIKE" $col $col $col $col $col $col $col
}

tk_tar_excludes() {
  local glob
  for glob in $TK_SECRET_EXCLUDES "$@"; do print -r -- "--exclude=$glob"; done
}

tk_copy_tree() {
  local from=$1 to=$2
  shift 2
  [[ -e $from ]] || return 1
  if [[ -d $from ]]; then
    mkdir -p "$to"
    tar -C "$from" -cf - $(tk_tar_excludes "$@") . | tar -C "$to" -xpf -
  else
    mkdir -p "${to:h}"
    cp -p "$from" "$to"
  fi
}

tk_tree_files() {
  local root=$1
  if [[ -d $root ]]; then
    (cd "$root" && find . -type f -print0)
  elif [[ -f $root ]]; then
    print -rn -- "."$'\0'
  fi
}

tk_tree_matches() {
  local from=$1 to=$2 file
  [[ -e $to ]] || return 1
  while IFS= read -r -d '' file; do
    cmp -s "$from/$file" "$to/$file" 2>/dev/null || { [[ $file == . ]] && cmp -s "$from" "$to" } || return 1
  done < <(tk_tree_files "$from")
}

tk_overlay() {
  local from=$1 to=$2 backup=$3 file
  if [[ -e $to ]] && ! tk_tree_matches "$from" "$to"; then
    if [[ -f $from ]]; then
      mkdir -p "${backup:h}" && cp -p "$to" "$backup"
    else
      while IFS= read -r -d '' file; do
        [[ -f $to/$file ]] && ! cmp -s "$from/$file" "$to/$file" && mkdir -p "${backup}/${file:h}" && cp -p "$to/$file" "$backup/$file"
      done < <(tk_tree_files "$from")
    fi
  fi
  tk_copy_tree "$from" "$to"
}

tk_home_pairs() {
  local src_home=$1 dst_home=$2
  [[ $src_home == $dst_home ]] && return
  print -r -- "$src_home"$'\t'"$dst_home"
  print -r -- "$(tk_slug $src_home)-"$'\t'"$(tk_slug $dst_home)-"
}

tk_sed_escape() { print -r -- "${${${1//\\/\\\\}//\#/\\#}//&/\\&}" }

tk_rewrite_files() {
  local root=$1 src_home=$2 dst_home=$3
  [[ $src_home == $dst_home || ! -e $root ]] && return 0
  local from=$(tk_sed_escape $src_home) to=$(tk_sed_escape $dst_home)
  local sfrom=$(tk_sed_escape "$(tk_slug $src_home)-") sto=$(tk_sed_escape "$(tk_slug $dst_home)-")
  /usr/bin/grep -rlIF --null --exclude='*.db' --exclude='*.db-*' --exclude='*.sqlite' -e "$src_home" -e "$(tk_slug $src_home)-" "$root" 2>/dev/null |
    LC_ALL=C xargs -0 -r sed -i '' -E -e "s#${from}(/|\"|'|\$|[^A-Za-z0-9_.-])#${to}\\1#g" -e "s#${sfrom}#${sto}#g"
}

tk_rename_slug_dirs() {
  local root=$1 src_home=$2 dst_home=$3 dir
  [[ $src_home == $dst_home || ! -d $root ]] && return 0
  local from="$(tk_slug $src_home)-" to="$(tk_slug $dst_home)-"
  for dir in $root/${~${(b)from}}*(N/); do
    local target=$root/${${dir:t}/#$from/$to}
    if [[ -e $target ]]; then
      tk_copy_tree "$dir" "$target" && rm -rf "$dir"
    else
      mv "$dir" "$target"
    fi
  done
}

tk_sqlite_text_columns() {
  sqlite3 -separator $'\t' "$1" "
    SELECT m.name, c.name FROM sqlite_master m JOIN pragma_table_info(m.name) c
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.sql NOT LIKE 'CREATE VIRTUAL%'
      AND m.name NOT GLOB '*_fts_*' AND (c.type = '' OR upper(c.type) LIKE '%TEXT%' OR upper(c.type) LIKE '%CHAR%' OR upper(c.type) LIKE '%JSON%')"
}

tk_rewrite_sqlite() {
  local db=$1
  shift
  (( $# % 2 == 0 )) || tk_die "tk_rewrite_sqlite needs from/to pairs"
  local -a pairs=("$@")
  (( ${#pairs} )) || return 0
  local sql="PRAGMA foreign_keys=OFF; PRAGMA recursive_triggers=ON; BEGIN;" table column i
  while IFS=$'\t' read -r table column; do
    local expr="\"$column\"" where=()
    for (( i = 1; i <= ${#pairs}; i += 2 )); do
      expr="replace($expr, $(tk_sql ${pairs[i]}), $(tk_sql ${pairs[i+1]}))"
      where+="instr(\"$column\", $(tk_sql ${pairs[i]})) > 0"
    done
    sql+="UPDATE \"$table\" SET \"$column\" = $expr WHERE ${(j: OR :)where};"
  done < <(tk_sqlite_text_columns "$db")
  sql+="COMMIT;"
  sqlite3 "$db" "$sql"
}

tk_hash_path() {
  local target=$1
  if [[ -d $target ]]; then
    (cd "$target" && find . $(tk_find_excludes) -print0 | LC_ALL=C sort -z | xargs -0 -r shasum -a 256 | shasum -a 256)
  elif [[ -f $target ]]; then
    shasum -a 256 <"$target"
  else
    print -r -- "absent"
  fi | cut -c1-16
}

tk_find_excludes() {
  local glob first=1
  print -r -- "("
  for glob in $TK_SECRET_EXCLUDES; do
    (( first )) || print -r -- "-o"
    first=0
    print -r -- "-path" "*/${glob}" "-o" "-path" "*/${glob}/*"
  done
  print -r -- ")" "-prune" "-o" "-type" "f"
}
