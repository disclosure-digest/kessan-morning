$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$AppRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkDir = Join-Path $Root "work"
$VendorDir = Join-Path $WorkDir "vendor_py"
$XlsPath = Join-Path $WorkDir "data_j.xls"
$Python = "C:\Users\kosek\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$JpxUrl = "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls"

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

Invoke-WebRequest -UseBasicParsing $JpxUrl -OutFile $XlsPath

if (-not (Test-Path (Join-Path $VendorDir "xlrd\__init__.py"))) {
  & $Python -m pip install xlrd --target $VendorDir --upgrade
}

$env:PYTHONPATH = (Resolve-Path $VendorDir)
& $Python (Join-Path $AppRoot "tools\import-jpx-metadata.py") $XlsPath
