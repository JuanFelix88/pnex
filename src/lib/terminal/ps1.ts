export const PS1_PROMPT_BASH =
  ' __pnex_prompt(){ local exit_code="$?"; local d="$(pwd)"; printf "\n\n__PNEX_EXIT__%s__PNEX_EXIT____PNEX_CWD__%s__PNEX_CWD__" "$exit_code" "$d"; }; PROMPT_COMMAND=__pnex_prompt; PS1="\\$ "; clear\r';

export const PS1_PROMPT_PSW =
  'function prompt { $code = if ($?) { 0 } else { 1 }; $d=(Get-Location).Path; Write-Host -NoNewline "`n__PNEX_EXIT__${code}__PNEX_EXIT____PNEX_CWD__${d}__PNEX_CWD__"; "$ "; }; cls\r\r';
