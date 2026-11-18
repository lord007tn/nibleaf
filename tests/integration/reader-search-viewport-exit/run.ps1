$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
Set-Location -LiteralPath $root
if (!$env:NIBLEAF_DEVSTACK_LOCK) { throw 'Set NIBLEAF_DEVSTACK_LOCK to the canonical machine-wide directory before running' }
$lockPath = [IO.Path]::GetFullPath($env:NIBLEAF_DEVSTACK_LOCK)
$token = 'reader848-' + [guid]::NewGuid().ToString('N')
$env:READER848_DEVSTACK_TOKEN = $token
$manifest = Join-Path $env:TEMP ($token + '.json')
$node = (Get-Command node).Source
$runtime = @{ token=$token; lockPath=$lockPath; startedUtc=[datetime]::UtcNow.ToString('o'); browserChildren=@() }
$acquired = $false
try {
  if ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory * 1KB -lt 5GB) { throw 'Less than 5 GiB free RAM' }
  $heavy = Join-Path $env:TEMP 'nibleaf-heavy.lock'
  if ((Test-Path -LiteralPath $heavy) -and [IO.File]::ReadAllText($heavy).StartsWith('reader/848 ')) { throw 'Release reader/848 heavy lock before taking devstack' }
  & netstat -ano | findstr /R ':4310 .*LISTEN :4410 .*LISTEN'
  if (@(Get-NetTCPConnection -LocalPort 4310,4410 -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in @(4310,4410)).Count) { throw 'Ports 4310/4410 occupied; do not start the stack' }
  $branch = (& git branch --show-current).Trim()
  if ($branch -ne 'test/reader-search-real-exit') { throw ('Unexpected branch: ' + $branch) }
  # Atomic directory creation; never borrow or remove another owner's lock.
  do {
    & $node tests/integration/reader-search-viewport-exit/run.mjs --acquire
    if ($LASTEXITCODE -ne 0) { Write-Output 'Devstack lock held; retrying in two minutes'; Start-Sleep -Seconds 120 }
  } until ($LASTEXITCODE -eq 0)
  $acquired = $true
  $runtime | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding UTF8
  foreach ($kind in @('mock', 'app', 'capture')) {
    $launchArgs = switch ($kind) {
      'mock' { @('scripts/site-preview-mock.mjs', '--port', '4410') }
      'app' { @('tests/integration/reader-search-viewport-exit/run.mjs', '--serve') }
      'capture' { @('tests/integration/reader-search-viewport-exit/run.mjs', '--capture') }
    }
    $launchArgs += @('--reader-owner=reader/848', ('--reader-token=' + $token))
    $proc = Start-Process -FilePath $node -ArgumentList $launchArgs -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:TEMP "$token-$kind.log") -RedirectStandardError (Join-Path $env:TEMP "$token-$kind.err")
    $handle = $proc.Handle
    $identity = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)"
    if (!$identity) { throw ('Failed to start ' + $kind) }
    $runtime[$kind + 'Id'] = $proc.Id
    $runtime[$kind + 'StartedUtc'] = $identity.CreationDate.ToUniversalTime().ToString('o')
    $runtime | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding UTF8
    if ($kind -eq 'app') {
      $deadline = [datetime]::UtcNow.AddSeconds(30)
      do {
        $ready = $false
        try { $ready = (Invoke-WebRequest 'http://127.0.0.1:4310/' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $startupError = $_.Exception.Message }
        if (!$ready) { Start-Sleep -Milliseconds 300 }
      } until ($ready -or [datetime]::UtcNow -gt $deadline)
      if (!$ready) { throw ('App startup timed out: ' + $startupError) }
    }
  }
  $deadline = [datetime]::UtcNow.AddMinutes(3)
  do {
    $all = @(Get-CimInstance Win32_Process)
    $parents = @($proc.Id)
    do {
      $children = @($all | Where-Object { $_.ParentProcessId -in $parents -and $_.ProcessId -notin $parents })
      $parents += @($children | ForEach-Object ProcessId)
    } while ($children.Count)
    foreach ($child in $all | Where-Object { $_.ProcessId -in $parents -and $_.ProcessId -ne $proc.Id }) {
      if ($child.ProcessId -notin $runtime.browserChildren.pid) { $runtime.browserChildren += @{ pid=$child.ProcessId; createdUtc=$child.CreationDate.ToUniversalTime().ToString('o') } }
    }
    $runtime | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding UTF8
    $proc.Refresh()
    if (!$proc.HasExited) { Start-Sleep -Milliseconds 500 }
  } until ($proc.HasExited -or [datetime]::UtcNow -gt $deadline)
  if (!$proc.HasExited) { throw 'Browser capture exceeded three minutes' }
  $proc.WaitForExit()
  if (!$handle -or $null -eq $proc.ExitCode) { throw 'Capture exit status unavailable' }
  if ($proc.ExitCode -ne 0) { throw ('Capture failed: ' + [IO.File]::ReadAllText((Join-Path $env:TEMP "$token-capture.err"))) }
  Get-Content -LiteralPath (Join-Path $env:TEMP "$token-capture.log") -Encoding UTF8
} finally {
  # A separate, ownership-guarded cleanup always runs before this runner returns.
  if ($acquired) { & (Join-Path $PSScriptRoot 'release.ps1') -Manifest $manifest -ExpectedLock $lockPath }
}
