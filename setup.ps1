# setup.ps1 - prepara MathApp su Windows in modo rapido.
#
# Uso:
#   .\setup.ps1              Node.js portatile + controllo ambiente
#   .\setup.ps1 -Math        aggiunge Python, SymPy e pypdf
#   .\setup.ps1 -Full        aggiunge anche faster-whisper (dettatura)
#   .\setup.ps1 -Check       solo controllo, non scarica nulla
#   .\setup.ps1 -Force       riscarica Node anche se e' gia' presente
#
# Non richiede privilegi di amministratore per il core (Node viene messo in
# .tools dentro la cartella dell'app). Python, se richiesto e assente, viene
# installato con winget (puo' comparire UAC).
param(
  [switch]$Check,
  [switch]$Math,
  [switch]$Full,
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSCommandPath
$tools = Join-Path $root ".tools"

function Say($message) { Write-Host $message }

function Find-PortableNode {
  if (-not (Test-Path $tools)) { return $null }
  $dirs = Get-ChildItem -Path $tools -Directory -Filter "node-v*-win-x64" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  foreach ($dir in $dirs) {
    $exe = Join-Path $dir.FullName "node.exe"
    if (Test-Path $exe) { return $exe }
  }
  return $null
}

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return Find-PortableNode
}

function Find-Python {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    $out = (& py -3 -c "import sys; print(sys.executable)" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $out) {
      return @{ Exe = "py"; Args = @("-3"); Path = ($out | Select-Object -First 1).Trim() }
    }
  }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    $out = (& python -c "import sys; print(sys.executable)" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $out) {
      return @{ Exe = $python.Source; Args = @(); Path = ($out | Select-Object -First 1).Trim() }
    }
  }
  return $null
}

function Show-Node($exe) {
  if (-not $exe) { return }
  $version = (& $exe -v 2>$null)
  Say ("Node:      " + $version + "  (" + $exe + ")")
}

function Show-Python($py) {
  if (-not $py) {
    Say "Python:    non installato (opzionale: SymPy, PDF, dettatura)"
    return
  }
  $a = $py.Args + @("-c", "import sys; print(sys.version.split()[0])")
  $version = (& $py.Exe @a 2>$null)
  Say ("Python:    " + ($version | Select-Object -First 1) + "  (" + $py.Path + ")")
  $a = $py.Args + @("-c", "import sympy; print(sympy.__version__)")
  $sympy = (& $py.Exe @a 2>$null)
  if ($LASTEXITCODE -eq 0 -and $sympy) { Say ("SymPy:     " + ($sympy | Select-Object -First 1) + " OK") }
  else { Say "SymPy:     non installato (calcolo esatto opzionale)" }
  $a = $py.Args + @("-c", "import pypdf; print(pypdf.__version__)")
  $pypdf = (& $py.Exe @a 2>$null)
  if ($LASTEXITCODE -eq 0 -and $pypdf) { Say ("pypdf:     " + ($pypdf | Select-Object -First 1) + " OK") }
  else { Say "pypdf:     non installato (estrazione PDF opzionale)" }
  $a = $py.Args + @("-c", "import faster_whisper; print('ok')")
  $whisper = (& $py.Exe @a 2>$null)
  if ($LASTEXITCODE -eq 0) { Say "Whisper:   OK" }
  else { Say "Whisper:   non installato (dettatura opzionale)" }
}

Say ""
Say "MathApp - setup Windows"
Say "Cartella:  $root"
Say ""

$nodeExe = Find-Node

if ($Check) {
  Show-Node $nodeExe
  $py = Find-Python
  Show-Python $py
  if (-not $nodeExe) {
    Say ""
    Say "Node non trovato. Esegui .\setup.ps1 (senza -Check) per scaricare Node LTS portatile."
    exit 1
  }
  Say ""
  Say "Controllo completato. Avvio: .\start-mathapp.ps1"
  exit 0
}

if (-not $nodeExe -or $Force) {
  Say "Scarico Node.js LTS portatile (circa 30 MB, nessun admin)..."
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  try {
    $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 30
    $lts = @($index | Where-Object { $_.lts })[0]
    if (-not $lts) { throw "elenco versioni Node non disponibile" }
    $version = [string]$lts.version
    $name = "node-$version-win-x64"
    $dest = Join-Path $tools $name
    $destExe = Join-Path $dest "node.exe"
    if ((Test-Path $destExe) -and -not $Force) {
      $nodeExe = $destExe
    } else {
      $zip = Join-Path $env:TEMP ($name + ".zip")
      $url = "https://nodejs.org/dist/$version/$name.zip"
      Say ("  " + $url)
      if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -L --fail --retry 2 --silent --show-error -o $zip $url
        if ($LASTEXITCODE -ne 0) { throw "download Node fallito" }
      } else {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
      }
      if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tools)
      if (Test-Path $zip) { [IO.File]::Delete($zip) }
      if (-not (Test-Path $destExe)) { throw "Node estratto ma node.exe non trovato" }
      $nodeExe = $destExe
    }
  } catch {
    Say ""
    Say ("ERRORE Node: " + $_.Exception.Message)
    Say "Puoi installare Node manualmente da https://nodejs.org/ (LTS, Windows) e rilanciare questo script."
    exit 1
  }
}

if ($nodeExe) {
  $env:Path = "$(Split-Path -Parent $nodeExe);$env:Path"
  Show-Node $nodeExe
}

$py = Find-Python
if ($py) {
  $env:Path = "$(Split-Path -Parent $py.Path);$env:Path"
}

if (($Math -or $Full) -and -not $py) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Say ""
    Say "Python non trovato: provo a installarlo con winget (puo' comparire UAC)..."
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & winget install --id Python.Python.3.12 -e --source winget --silent --accept-package-agreements --accept-source-agreements
    $wingetExit = $LASTEXITCODE
    $ErrorActionPreference = $oldEap
    if ($wingetExit -ne 0) {
      Say "winget non ha completato l'installazione: installa Python da python.org (Add to PATH) e rilancia -Math."
    } else {
      $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
      if ($nodeExe) { $env:Path = "$(Split-Path -Parent $nodeExe);$env:Path" }
      $py = Find-Python
    }
  } else {
    Say ""
    Say "Python non trovato. Installalo da https://www.python.org/downloads/windows/ (seleziona 'Add python.exe to PATH') e rilancia .\setup.ps1 -Math."
  }
}

if ($py) {
  if ($Math -or $Full) {
    Say ""
    Say "Installo le dipendenze Python..."
    $pipArgs = $py.Args + @("-m", "pip", "--version")
    & $py.Exe @pipArgs 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Say "  pip non disponibile: provo ensurepip..."
      $ensureArgs = $py.Args + @("-m", "ensurepip", "--upgrade")
      $oldEap = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      & $py.Exe @ensureArgs
      $ErrorActionPreference = $oldEap
    }
    $req = if ($Full) { "requirements-whisper.txt" } else { "requirements.txt" }
    $installArgs = $py.Args + @("-m", "pip", "install", "--user", "-r", (Join-Path $root $req))
    # cmd /c evita che gli avvisi di pip su stderr diventino errori PowerShell.
    $argLine = ($installArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + $_ + '"' } else { $_ } }) -join ' '
    $pipOut = & cmd.exe /d /c ('"' + $py.Exe + '" ' + $argLine + ' 2>&1')
    $pipExit = $LASTEXITCODE
    $pipOut | ForEach-Object { Write-Host $_ }
    if ($pipExit -ne 0) {
      Say ""
      Say ("pip install non riuscito. Riprova manualmente: " + $py.Exe + " " + ($py.Args -join " ") + " -m pip install --user -r $req")
    }
  }
  Show-Python $py
} elseif (-not ($Math -or $Full)) {
  Say "Python:    non installato (opzionale: usa -Math per SymPy/PDF, -Full per la dettatura)"
}

Say ""
if ($nodeExe) {
  Say "Ambiente pronto. Avvio:"
  Say "  .\start-mathapp.ps1"
  Say ""
  Say "Poi apri http://127.0.0.1:8790 e inserisci la API key in Impostazioni."
  Say "Guida: docs\SETUP-WINDOWS.md"
  Say ""
  if (Test-Path (Join-Path $root "start-mathapp.ps1")) {
    & (Join-Path $root "start-mathapp.ps1") -Check
  }
} else {
  Say "Node non disponibile: l'app non puo' partire."
  exit 1
}
