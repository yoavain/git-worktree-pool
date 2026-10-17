# wtp-launcher 2
# Written by "worktree-pool setup". It runs worktree-pool, then moves this PowerShell session
# to the folder that worktree-pool picked. "worktree-pool setup --remove" deletes this file.
if (-not (Get-Command worktree-pool -CommandType Application, ExternalScript -ErrorAction SilentlyContinue)) {
  [Console]::Error.WriteLine("wtp: worktree-pool is not installed. Reinstall git-worktree-pool, or delete $PSCommandPath.")
  exit 1
}
if ($env:WTP_CWD_FILE) {
  & worktree-pool @args
  exit $LASTEXITCODE
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
}
$dir = Get-Content -LiteralPath $f -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $f -ErrorAction SilentlyContinue
if ($dir) { Set-Location -LiteralPath $dir.Trim() }
exit $rc
