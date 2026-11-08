/**
 * @file The tab-completion scripts `ork completion <shell>` prints, one per
 *   shell. Each is thin: it runs `ork __complete -- <words…>` with the word
 *   under the cursor last, and offers the lines it prints, `value<TAB>
 *   description`. A line `:group <title>` starts a group (zsh labels the menu
 *   with it); `:files` asks for file names too. A new shell is one more entry.
 */

/** The hidden command the scripts run. */
export const COMPLETE_COMMAND = "__complete";

const ZSH = `#compdef ork
# Tab completion for ork, in zsh. Save it as _ork in a folder on your fpath
# (ork completion zsh > ~/.zsh/completions/_ork), or source it.

_ork() {
  local -a lines cands
  local line group=commands files=0 n=0 ret=1
  lines=("\${(@f)$("\${words[1]}" ${COMPLETE_COMMAND} -- "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  for line in "\${lines[@]}"; do
    case $line in
      (:files) files=1 ;;
      (:group\\ *)
        if (( \${#cands} )); then
          _describe -V -t "ork-$(( ++n ))" "$group" cands && ret=0
        fi
        cands=()
        group=\${line#:group }
        ;;
      (?*) cands+=("\${\${line%%$'\\t'*}//:/\\\\:}:\${line#*$'\\t'}") ;;
    esac
  done
  if (( \${#cands} )); then
    _describe -V -t "ork-$(( ++n ))" "$group" cands && ret=0
  fi
  if (( files )); then
    _files && ret=0
  fi
  return ret
}

if [[ "\${funcstack[1]}" == _ork ]]; then
  _ork "$@"
else
  compdef _ork ork
fi
`;

const BASH = `# Tab completion for ork, in bash. Add to your ~/.bashrc:
#   eval "$(ork completion bash)"
# (macOS's bash 3.2 can't source <(…); saving it to a file and sourcing that
# works too.) Every expansion is quoted and lines are read with read -r, so a
# candidate is never split or glob-expanded.

_ork() {
  local line="\${COMP_LINE:0:COMP_POINT}" cur files=0 strip="" out
  local -a words
  read -r -a words <<< "$line"
  if [[ "$line" == *[[:space:]] ]]; then words+=(""); fi
  cur="\${words[\${#words[@]}-1]}"
  COMPREPLY=()
  # bash splits a word at ":" (ork:feature); offer only what follows it.
  if [[ "$cur" == *:* && "$COMP_WORDBREAKS" == *:* ]]; then
    strip="\${cur%"\${cur##*:}"}"
  fi
  out="$("\${words[0]}" ${COMPLETE_COMMAND} -- "\${words[@]:1}" 2>/dev/null)"
  while IFS= read -r line; do
    case "$line" in
      :files) files=1 ;;
      :* | "") ;;
      *)
        line="\${line%%$'\\t'*}"
        COMPREPLY+=("\${line#"$strip"}")
        ;;
    esac
  done <<< "$out"
  if (( files )); then
    out="$(compgen -f -- "$cur")"
    while IFS= read -r line; do
      if [[ -n "$line" ]]; then COMPREPLY+=("\${line#"$strip"}"); fi
    done <<< "$out"
  fi
}

complete -F _ork ork
`;

const FISH = `# Tab completion for ork, in fish. Save it as
# ~/.config/fish/completions/ork.fish (ork completion fish > …), or source it.

function __ork_complete
    # -x is fish 4's name for -o, which it deprecates; fish 3 has only -o.
    set -l tokens (commandline -xpc 2>/dev/null; or commandline -opc)
    set -l current (commandline -ct)
    set -l out ($tokens[1] ${COMPLETE_COMMAND} -- $tokens[2..-1] "$current" 2>/dev/null)
    string match -v -r '^:' -- $out
    if contains -- :files $out
        __fish_complete_path "$current"
    end
end

complete -c ork -f -a '(__ork_complete)'
`;

/** Each shell's script, by the name `ork completion` takes. */
export const SHELL_SCRIPTS: Readonly<Record<string, string>> = {
  zsh: ZSH,
  bash: BASH,
  fish: FISH,
};

/** The shells there is a script for. */
export const SHELLS = Object.keys(SHELL_SCRIPTS);
