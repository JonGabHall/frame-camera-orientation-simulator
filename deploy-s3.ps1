[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Profile,
    [ValidatePattern('^s3://[^/]+/.+/$')]
    [string]$Destination = 's3://esri-jhall-public/apps/frame-camera-simulator/'
)

$ErrorActionPreference = 'Stop'
$buildDirectory = Join-Path $PSScriptRoot 'dist'
$indexFile = Join-Path $buildDirectory 'index.html'
$profileArguments = @()
if ($Profile) {
    $profileArguments = @('--profile', $Profile)
}

Push-Location $PSScriptRoot
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed; nothing was uploaded.' }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; nothing was uploaded.' }
    if (-not (Test-Path -LiteralPath $indexFile -PathType Leaf)) {
        throw 'Build did not produce dist/index.html; nothing was uploaded.'
    }

    if ($PSCmdlet.ShouldProcess($Destination, 'Upload the production build')) {
        & aws s3 sync $buildDirectory $Destination --exclude 'index.html' --no-progress @profileArguments
        if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed; index.html was not updated.' }

        & aws s3 cp $indexFile "${Destination}index.html" --content-type 'text/html' --cache-control 'no-cache' --no-progress @profileArguments
        if ($LASTEXITCODE -ne 0) { throw 'index.html upload failed.' }

        Write-Host "Deployment complete: ${Destination}index.html"
    }
} finally {
    Pop-Location
}