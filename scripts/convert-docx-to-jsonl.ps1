param(
  [Parameter(Mandatory = $true)]
  [string]$InputDocx,

  [Parameter(Mandatory = $true)]
  [string]$OutputJsonl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-DocxLines {
  param([string]$Path)

  $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Path))
  try {
    $entry = $zip.GetEntry("word/document.xml")
    if (-not $entry) {
      throw "word/document.xml not found in docx."
    }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try {
      [xml]$xml = $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }

    $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
    $ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")

    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($paragraph in $xml.SelectNodes("//w:body/w:p", $ns)) {
      $text = (($paragraph.SelectNodes(".//w:t", $ns) | ForEach-Object { $_."#text" }) -join "").Trim()
      if ($text) {
        $lines.Add($text)
      }
    }

    return $lines
  } finally {
    $zip.Dispose()
  }
}

function Convert-Type {
  param([string]$ChineseType)

  if ($ChineseType.Contains([string][char]0x5355)) { return "single" }
  if ($ChineseType.Contains([string][char]0x591A)) { return "multiple" }
  if ($ChineseType.Contains([string][char]0x5224)) { return "judge" }
  throw "Unsupported question type: $ChineseType"
}

function Complete-Question {
  param(
    [hashtable]$Question,
    [System.Collections.Generic.List[object]]$Output
  )

  if (-not $Question) {
    return
  }

  if (-not $Question.ContainsKey("answerLine")) {
    throw "Question $($Question.id) has no answer line."
  }

  $answerLine = [string]$Question.answerLine
  $colonIndex = $answerLine.IndexOf(":")
  if ($colonIndex -lt 0) {
    $colonIndex = $answerLine.IndexOf([string][char]0xFF1A)
  }
  if ($colonIndex -lt 0) {
    throw "Question $($Question.id) has invalid answer: $answerLine"
  }

  $answerText = $answerLine.Substring($colonIndex + 1).Trim()
  $match = [regex]::Match($answerText, "^([A-Z]+)")
  if (-not $match.Success) {
    $match = [regex]::Match($answerText, "(TRUE|FALSE)", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  }
  if (-not $match.Success) {
    throw "Question $($Question.id) has invalid answer: $answerLine"
  }
  $answerToken = $match.Groups[1].Value.ToUpperInvariant()
  $answerLetters = $answerToken.ToCharArray() | ForEach-Object { [string]$_ }
  $type = [string]$Question.type
  $answer = [System.Collections.Generic.List[string]]::new()
  $explanation = $answerLine
  if ($type -eq "judge") {
    if ($answerToken -eq "TRUE" -or $answerLetters[0] -eq "A") {
      $answer.Add("true")
      $explanation = (([string][char]0x7B54) + ([string][char]0x6848) + ([string][char]0xFF1A) + "TRUE")
    } else {
      $answer.Add("false")
      $explanation = (([string][char]0x7B54) + ([string][char]0x6848) + ([string][char]0xFF1A) + "FALSE")
    }
  } else {
    foreach ($letter in $answerLetters) {
      $answer.Add($letter)
    }
  }

  $item = [ordered]@{
    id = $Question.id
    type = $Question.chineseType
    question = (($Question.questionParts -join " ") -replace "\s+", " ").Trim()
    answer = $answer
    explanation = $explanation
    source = [System.IO.Path]::GetFileNameWithoutExtension($InputDocx)
  }

  if ($type -ne "judge") {
    $item.options = @($Question.options)
  }

  $Output.Add([pscustomobject]$item)
}

$lines = Get-DocxLines -Path $InputDocx
$questions = [System.Collections.Generic.List[object]]::new()
$current = $null
$lastOptionIndex = -1

foreach ($line in $lines) {
  $questionMatch = [regex]::Match($line, "^(\d+)\.\s*\[([^\]]+)\]\s*(.+)$")
  if ($questionMatch.Success) {
    Complete-Question -Question $current -Output $questions
    $number = [int]$questionMatch.Groups[1].Value
    $chineseType = $questionMatch.Groups[2].Value.Trim()
    $current = @{
      id = "gbys-2026-{0:D3}" -f $number
      type = Convert-Type -ChineseType $chineseType
      chineseType = $chineseType
      questionParts = [System.Collections.Generic.List[string]]::new()
      options = [System.Collections.Generic.List[string]]::new()
    }
    $current.questionParts.Add($questionMatch.Groups[3].Value.Trim())
    $lastOptionIndex = -1
    continue
  }

  if (-not $current) {
    continue
  }

  $optionMatch = [regex]::Match($line, "^([A-Z])\.\s*(.+)$")
  if ($optionMatch.Success) {
    if ($current.type -ne "judge") {
      $current.options.Add($optionMatch.Groups[2].Value.Trim())
      $lastOptionIndex = $current.options.Count - 1
    }
    continue
  }

  if ($line.StartsWith(([string][char]0x7B54) + ([string][char]0x6848))) {
    $current.answerLine = $line
    $lastOptionIndex = -1
    continue
  }

  if ($lastOptionIndex -ge 0) {
    $current.options[$lastOptionIndex] = (($current.options[$lastOptionIndex], $line) -join " ").Trim()
  } else {
    $current.questionParts.Add($line)
  }
}

Complete-Question -Question $current -Output $questions

$outputDir = Split-Path -Parent $OutputJsonl
if ($outputDir) {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$jsonLines = foreach ($question in $questions) {
  $question | ConvertTo-Json -Compress -Depth 8
}

[System.IO.File]::WriteAllLines((Join-Path (Get-Location) $OutputJsonl), $jsonLines, [System.Text.UTF8Encoding]::new($false))

$typeSummary = $questions | Group-Object type | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Count)" }
Write-Host "Converted $($questions.Count) questions -> $OutputJsonl"
Write-Host "Types: $($typeSummary -join ', ')"
