$ErrorActionPreference = "Stop"

$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw "C# compiler not found"
}

$outputDirectory = Join-Path $PSScriptRoot "bin"
$outputFile = Join-Path $outputDirectory "GlobalMouseHook.exe"
$sourceFile = Join-Path $PSScriptRoot "GlobalMouseHook.cs"

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
& $compiler /nologo /target:winexe /optimize+ /platform:x64 "/out:$outputFile" $sourceFile
if ($LASTEXITCODE -ne 0) {
    throw "Global mouse helper compilation failed"
}

Write-Output "Built $outputFile"
