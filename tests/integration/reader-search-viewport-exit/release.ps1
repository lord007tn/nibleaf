param([Parameter(Mandatory=$true)][string]$Manifest, [Parameter(Mandatory=$true)][string]$ExpectedLock)
$ErrorActionPreference = 'Stop'
$runtime = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($runtime.lockPath) -ne [IO.Path]::GetFullPath($ExpectedLock)) { throw 'Unexpected lock path' }
$ownerFile = Join-Path $ExpectedLock 'owner.txt'
$expectedOwner = 'reader/848 token=' + $runtime.token
if (!(Test-Path -LiteralPath $ownerFile) -or !([IO.File]::ReadAllText($ownerFile).StartsWith($expectedOwner + "`n"))) { throw 'Devstack owner mismatch' }
foreach ($kind in @('capture', 'app', 'mock')) {
  $processId = $runtime.($kind + 'Id')
  if (!$processId) { continue }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
  if (!$proc) { continue }
  $started = [datetime]::Parse($runtime.($kind + 'StartedUtc')).ToUniversalTime()
  if (!$proc.CommandLine.Contains($runtime.token) -or [math]::Abs(($proc.CreationDate.ToUniversalTime() - $started).TotalSeconds) -gt 2) { throw "Process identity mismatch: $kind" }
  Stop-Process -Id $processId -Force
  Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue
}
foreach ($child in $runtime.browserChildren) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.pid)"
  if (!$proc) { continue }
  $started = [datetime]::Parse($child.createdUtc).ToUniversalTime()
  if ([math]::Abs(($proc.CreationDate.ToUniversalTime() - $started).TotalSeconds) -gt 2) { throw 'Browser process identity mismatch' }
  Stop-Process -Id $proc.ProcessId -Force
}
$remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($runtime.token) })
if ($remaining.Count) { throw 'Owned processes remain alive' }
if (@(Get-NetTCPConnection -LocalPort 4310,4410 -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in @(4310,4410)).Count) { throw 'Dev ports remain occupied; preserve lock for investigation' }
if (!([IO.File]::ReadAllText($ownerFile).StartsWith($expectedOwner + "`n"))) { throw 'Owner changed before release' }
# The resolved target is the exact lock directory checked above, with our token.
Remove-Item -LiteralPath ([IO.Path]::GetFullPath($ExpectedLock)) -Recurse -Force
Write-Output ('DEVSTACK RELEASED ' + [datetime]::UtcNow.ToString('o') + '; owned processes stopped; ports 4310/4410 free')
