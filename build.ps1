$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$manifestPath = Join-Path $root 'info.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$dist = Join-Path $root 'dist'
$staging = Join-Path $root '.build-stage'
$baseName = 'SyllableLyrics-' + $manifest.version
$archivePath = Join-Path $dist ($baseName + '.zip')
$packagePath = Join-Path $dist ($baseName + '.mmip')

$files = @(
    'info.json',
    'config.js',
    'config.html',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'license.txt',
    'skin\skin_base_add.less'
)
$bundleSources = @(
    'lib\lyricsCore.js',
    'controls\lyricsWindow_add.js'
)

if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging | Out-Null
if (-not (Test-Path -LiteralPath $dist)) {
    New-Item -ItemType Directory -Path $dist | Out-Null
}

try {
    foreach ($relativePath in $files) {
        $source = Join-Path $root $relativePath
        if (-not (Test-Path -LiteralPath $source)) {
            throw "Required package file is missing: $relativePath"
        }
        $target = Join-Path $staging $relativePath
        $targetDirectory = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetDirectory)) {
            New-Item -ItemType Directory -Path $targetDirectory | Out-Null
        }
        Copy-Item -LiteralPath $source -Destination $target
    }

    foreach ($relativePath in $bundleSources) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $relativePath))) {
            throw "Required bundle source is missing: $relativePath"
        }
    }
    $bundleTarget = Join-Path $staging 'controls\lyricsWindow_add.js'
    $bundleDirectory = Split-Path -Parent $bundleTarget
    New-Item -ItemType Directory -Path $bundleDirectory -Force | Out-Null
    $bundle = [IO.File]::ReadAllText((Join-Path $root $bundleSources[0])) + "`r`n" +
        [IO.File]::ReadAllText((Join-Path $root $bundleSources[1]))
    $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
    [IO.File]::WriteAllText($bundleTarget, $bundle, $utf8NoBom)

    Get-ChildItem -LiteralPath $dist -Filter 'SyllableLyrics-*.mmip' -File |
        Where-Object { $_.FullName -ne $packagePath } |
        Remove-Item -Force
    Remove-Item -LiteralPath $archivePath, $packagePath -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archivePath -CompressionLevel Optimal
    Move-Item -LiteralPath $archivePath -Destination $packagePath
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "Built $packagePath"
