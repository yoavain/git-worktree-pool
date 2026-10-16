# wtp-launcher 1
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
$f = New-TemporaryFile
$env:WTP_CWD_FILE = $f.FullName
$rc = 0
try {
  & worktree-pool @args
  $rc = $LASTEXITCODE
} finally {
  Remove-Item Env:WTP_CWD_FILE -ErrorAction SilentlyContinue
}
$dir = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $f.FullName -ErrorAction SilentlyContinue
if ($dir) { Set-Location -LiteralPath $dir.Trim() }
exit $rc
