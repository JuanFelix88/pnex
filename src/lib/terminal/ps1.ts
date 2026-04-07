export const PS1_PROMPT_BASH =
  ' PS1="\\[\\e]7777;exit=\$?\\a\\e]7777;cwd=\${PWD}\\a\\]\n  "; clear\r';

export const PS1_PROMPT_PSW =
  'function prompt { $code = if ($?) { 0 } else { 1 }; $d=(Get-Location).Path; Write-Host -NoNewline ("$([char]27)]7777;exit=${code}$([char]7)$([char]27)]7777;cwd=${d}$([char]7)"); "`n  "; }; cls\r\r';
