# start-mathapp.ps1 - avvia MathApp, con controllo ambiente e dipendenze opzionali.
# Uso:
#   .\start-mathapp.ps1            avvia (come prima)
#   .\start-mathapp.ps1 -Check     solo diagnostica, non avvia
#   .\start-mathapp.ps1 -NoBrowser avvia senza aprire il browser
param(
  [switch]$Check,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSCommandPath
$port = if ($env:MATHAPP_PORT) { [int]$env:MATHAPP_PORT } else { 8790 }

# Node portatile scaricato da setup.ps1 in .tools (nessun admin, nessun PATH globale).
$portableTools = Join-Path $root '.tools'
if (Test-Path $portableTools) {
  $portableNode = Get-ChildItem -Path $portableTools -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($portableNode -and (Test-Path (Join-Path $portableNode.FullName 'node.exe'))) {
    $env:Path = "$($portableNode.FullName);$env:Path"
  }
}

function Line($label, $value) { "  {0,-12} {1}" -f ($label + ':'), $value }

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeVer = $null
if ($nodeCmd) { $nodeVer = (& node -v 2>$null) }
$nodeOk = $nodeCmd -and ($LASTEXITCODE -eq 0)

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
$pyVer = $null
$sympyVer = $null
$whisperOk = $false
if ($pyCmd) {
  $pyVer = (& python -c "import sys; print(sys.version.split()[0])" 2>$null)
  if ($LASTEXITCODE -eq 0) {
    $sympyVer = (& python -c "import sympy; print(sympy.__version__)" 2>$null)
    if ($LASTEXITCODE -ne 0) { $sympyVer = $null }
    $null = (& python -c "import faster_whisper; print('ok')" 2>$null)
    $whisperOk = ($LASTEXITCODE -eq 0)
  } else {
    $pyVer = $null
  }
}

$listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue

$settingsFile = Join-Path $root 'settings.json'
$settingsText = ''
if (Test-Path $settingsFile) { try { $settingsText = Get-Content $settingsFile -Raw } catch {} }
$authFile = Join-Path $env:USERPROFILE '.local\share\opencode\auth.json'
$authText = ''
if (Test-Path $authFile) { try { $authText = Get-Content $authFile -Raw } catch {} }
$hasSettingsKey = $settingsText -match '"apiKey"\s*:\s*"[^"]+"'
$hasLegacyKey = $authText -match '"opencode-go"|"openrouter"'
$hasKey = $hasSettingsKey -or $hasLegacyKey

$nodeText = if ($nodeOk) { "$nodeVer OK" } else { 'NON TROVATO (richiesto)' }
$pyText = if ($pyVer) { "$pyVer (opzionale)" } else { 'non installato (opzionale)' }
$sympyText = if ($sympyVer) { "$sympyVer OK (calcolo esatto)" } else { 'non disponibile (opzionale)' }
$whisperText = if ($whisperOk) { 'OK (dettatura)' } else { 'non disponibile (opzionale)' }
$portText = if ($listening) { "$port gia' in ascolto" } else { "$port libera" }
$keyText = if ($hasKey) { 'configurata' } else { 'da inserire in Impostazioni' }

'MathApp - controllo ambiente'
Line 'Cartella' $root
Line 'Node' $nodeText
Line 'Python' $pyText
Line 'SymPy' $sympyText
Line 'Whisper' $whisperText
Line 'Porta' $portText
Line 'API key' $keyText
'  Core: chat + GeoGebra + conversazioni funzionano con il solo Node.'
''

if (-not $nodeOk) {
  'ERRORE: Node.js non trovato. Esegui .\setup.ps1 (scarica Node portatile) oppure installa Node 18+ e riprova.'
  exit 1
}
if ($Check) { 'Controllo completato.'; exit 0 }

if (-not $listening) {
  Start-Process -FilePath "node.exe" -ArgumentList "`"$root\server.mjs`"" -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { break }
  }
  if (-not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
    'ERRORE: il server non si e'' avviato. Controlla mathapp.log nella cartella dell''app.'
    exit 1
  }
}

if ($NoBrowser) { "MathApp attiva su http://127.0.0.1:$port/" }
else { Start-Process "http://127.0.0.1:$port/" }
