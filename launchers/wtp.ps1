# wtp-launcher 3
# Written by "worktree-pool setup". It runs worktree-pool, then moves this PowerShell session
# to the folder that worktree-pool picked. "worktree-pool setup --remove" deletes this file.
if (-not (Get-Command worktree-pool -CommandType Application, ExternalScript -ErrorAction SilentlyContinue)) {
  [Console]::Error.WriteLine("wtp: worktree-pool is not installed. Reinstall git-worktree-pool, or delete $PSCommandPath.")
  exit 1
}
# worktree-pool runs setup and teardown scripts in the shell that called it: this host's exe.
# This script runs in the caller's session, so put WTP_SHELL back afterwards.
$prevShell = $env:WTP_SHELL
$env:WTP_SHELL = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
function Restore-WtpShell { if ($null -eq $prevShell) { Remove-Item Env:WTP_SHELL -ErrorAction SilentlyContinue } else { $env:WTP_SHELL = $prevShell } }
if ($env:WTP_CWD_FILE) {
  try {
    & worktree-pool @args
    $rc = $LASTEXITCODE
  } finally {
    Restore-WtpShell
  }
  exit $rc
}
# .NET, not New-TemporaryFile: a Windows PowerShell 5.1 started from pwsh inherits pwsh's
# PSModulePath and then cannot load New-TemporaryFile.
$f = [IO.Path]::GetTempFileName()
$env:WTP_CWD_FILE = $f
$rc = 0
try {
  & worktree-pool @args
  $rc = $LASTEXITCODE
} finally {
  Remove-Item Env:WTP_CWD_FILE -ErrorAction SilentlyContinue
  Restore-WtpShell
  # Inside finally: after Ctrl+C during a setup script, worktree-pool still names the slot,
  # but PowerShell stops the lines after the try block.
  $dir = Get-Content -LiteralPath $f -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $f -ErrorAction SilentlyContinue
  if ($dir) { Set-Location -LiteralPath $dir.Trim() }
}
exit $rc
