# start-mathapp.ps1 — avvia il server MathApp e apre il browser.
$root = Split-Path -Parent $PSCommandPath
$port = if ($env:MATHAPP_PORT) { [int]$env:MATHAPP_PORT } else { 8790 }
if (-not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath "node.exe" -ArgumentList "`"$root\server.mjs`"" -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Seconds 2
}
Start-Process "http://127.0.0.1:$port/"
