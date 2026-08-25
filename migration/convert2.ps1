$ErrorActionPreference = "Stop"
$rawFile = Join-Path $PSScriptRoot "raw-v2.dat"
$outFile = Join-Path $PSScriptRoot "imported-notes.json"

$colorMap = @("default","red","orange","yellow","green","teal","blue","purple","pink","gray")

Write-Host "Reading raw decrypted file..."
$bytes = [System.IO.File]::ReadAllBytes($rawFile)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
Write-Host "Loaded $($text.Length) chars. Scanning for note objects..."

$marker = '{"_id":'
$objects = New-Object System.Collections.Generic.List[string]
$idx = $text.IndexOf($marker, [StringComparison]::Ordinal)
$len = $text.Length

while ($idx -ge 0) {
  $depth = 0
  $inStr = $false
  $esc = $false
  $endIdx = -1
  for ($p = $idx; $p -lt $len; $p++) {
    $c = $text[$p]
    if ($esc) { $esc = $false; continue }
    if ($c -eq '\') { if ($inStr) { $esc = $true }; continue }
    if ($c -eq '"') { $inStr = -not $inStr; continue }
    if (-not $inStr) {
      if ($c -eq '{') { $depth++ }
      elseif ($c -eq '}') {
        $depth--
        if ($depth -eq 0) { $endIdx = $p; break }
      }
    }
  }
  if ($endIdx -lt 0) {
    Write-Host "Unterminated object starting at $idx - stopping scan."
    break
  }
  $objects.Add($text.Substring($idx, $endIdx - $idx + 1))
  $idx = $text.IndexOf($marker, $endIdx + 1, [StringComparison]::Ordinal)
}

Write-Host "Found $($objects.Count) candidate note objects."

$parsed = 0
$parseFailed = 0
$skippedEmpty = 0
$skippedTrash = 0
$imported = @()
$colorCounts = @{}
$failedSamples = @()

foreach ($t in $objects) {
  try {
    $obj = $t | ConvertFrom-Json
  } catch {
    $parseFailed++
    if ($failedSamples.Count -lt 5) { $failedSamples += $t.Substring(0, [Math]::Min(200,$t.Length)) }
    continue
  }
  $parsed++

  if ($obj.folder_id -eq 256 -or $obj.type -eq 16) {
    $skippedTrash++
    continue
  }
  $title = [string]$obj.title
  $note = [string]$obj.note
  if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($note)) {
    $skippedEmpty++
    continue
  }

  $colorIdx = [int]$obj.color_index
  if ($colorIdx -lt 0 -or $colorIdx -gt 9) { $colorIdx = 0 }
  $color = $colorMap[$colorIdx]
  if ($colorCounts.ContainsKey($color)) { $colorCounts[$color]++ } else { $colorCounts[$color] = 1 }

  $id = [string]$obj.uuid
  if ([string]::IsNullOrWhiteSpace($id)) { $id = [guid]::NewGuid().ToString() }

  $created = [int64]$obj.created_date
  $modified = [int64]$obj.modified_date
  if ($modified -le 0) { $modified = $created }
  if ($created -le 0) { $created = $modified }

  $imported += [PSCustomObject]@{
    id          = $id
    title       = $title.Trim()
    type        = "text"
    content     = $note
    items       = @()
    color       = $color
    folderId    = ""
    dueDate     = ""
    pinned      = $false
    notifiedAt  = $null
    createdAt   = $created
    updatedAt   = $modified
  }
}

$result = [PSCustomObject]@{
  notes   = $imported
  folders = @()
  version = 1
}

$result | ConvertTo-Json -Depth 6 | Out-File -FilePath $outFile -Encoding utf8

Write-Host ""
Write-Host "=== Migration report (v2 scanner) ==="
Write-Host "Candidate objects found:   $($objects.Count)"
Write-Host "Parsed as JSON:            $parsed"
Write-Host "Parse failures:            $parseFailed"
Write-Host "Skipped (trash marker):    $skippedTrash"
Write-Host "Skipped (empty title+note): $skippedEmpty"
Write-Host "Imported notes:            $($imported.Count)"
Write-Host ""
Write-Host "Color distribution:"
$colorCounts.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host "  $($_.Key): $($_.Value)" }
if ($failedSamples.Count -gt 0) {
  Write-Host ""
  Write-Host "Sample failures:"
  $failedSamples | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
Write-Host "Output: $outFile"
