export const PS1_PROMPT_BASH =
  ' __pnex_prompt(){ local exit_code="$?"; local d="$(pwd)"; printf "\\033]7777;exit=%s\\007\\033]7777;cwd=%s\\007" "$exit_code" "$d"; }; PROMPT_COMMAND=__pnex_prompt; PS1="\n  "; clear\r';

export const PS1_PROMPT_PSW =
  'function prompt { $code = if ($?) { 0 } else { 1 }; $d=(Get-Location).Path; Write-Host -NoNewline ("$([char]27)]7777;exit=${code}$([char]7)$([char]27)]7777;cwd=${d}$([char]7)"); "`n  "; }; cls\r\r';
