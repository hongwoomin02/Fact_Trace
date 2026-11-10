param(
    [string]$Server = "pukyong@112.175.148.181",
    [string]$RemoteRoot = "/home/pukyong/FactTraceAI_gpu"
)
$ErrorActionPreference = "Stop"
$TemplateFolder = Join-Path (Split-Path $PSScriptRoot -Parent) "templates"
$VideoFiles = @(Get-ChildItem -LiteralPath $TemplateFolder -File | Where-Object { $_.Extension -ieq ".mp4" })
if ($VideoFiles.Count -eq 0) { Write-Host "원본 영상 폴더에 MP4를 먼저 넣어 주세요: $TemplateFolder"; exit 0 }
foreach ($VideoFile in $VideoFiles) {
    & scp -- $VideoFile.FullName "${Server}:${RemoteRoot}/video-generation/templates/"
    if ($LASTEXITCODE -ne 0) { throw "영상 전송 실패: $($VideoFile.Name)" }
}
Write-Host "전송 완료. 프론트에서 [목록 새로고침]을 눌러 주세요."
