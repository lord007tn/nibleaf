Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BrandDir = Join-Path $Root "apps/app/public/brand"
$RasterDir = Join-Path $BrandDir "raster"
$AppPublic = Join-Path $Root "apps/app/public"
$AdminPublic = Join-Path $Root "apps/admin/public"

$Paper = [System.Drawing.ColorTranslator]::FromHtml("#FBF7EE")
$Paper2 = [System.Drawing.ColorTranslator]::FromHtml("#EEE4D3")
$Ink = [System.Drawing.ColorTranslator]::FromHtml("#181612")
$Ink2 = [System.Drawing.ColorTranslator]::FromHtml("#4E453A")
$Umber = [System.Drawing.ColorTranslator]::FromHtml("#8A4B2E")
$Copper = [System.Drawing.ColorTranslator]::FromHtml("#B96A3D")

$Browser = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconBitmap([int]$size, [switch]$Reverse, [switch]$Monochrome, [switch]$AppTile, [switch]$SocialTile) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  if ($AppTile) {
    $g.Clear($Paper)
    $outer = New-RoundedRectPath ($size * 0.129) ($size * 0.129) ($size * 0.742) ($size * 0.742) ($size * 0.172)
    $outerBrush = [System.Drawing.SolidBrush]::new($Ink)
    $g.FillPath($outerBrush, $outer)
    $outerBrush.Dispose()
    $outer.Dispose()
  } elseif ($SocialTile) {
    $g.Clear($Ink)
  }

  $sx = $size / 512.0
  $markColor = if ($AppTile -or $SocialTile -or $Reverse) { $Paper } else { $Ink }
  $pen = [System.Drawing.Pen]::new($markColor, [Math]::Max(2, 88 * $sx))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $points = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(148 * $sx, 368 * $sx),
    [System.Drawing.PointF]::new(148 * $sx, 144 * $sx),
    [System.Drawing.PointF]::new(364 * $sx, 368 * $sx),
    [System.Drawing.PointF]::new(364 * $sx, 144 * $sx)
  )
  $g.DrawLines($pen, $points)
  $pen.Dispose()
  $g.Dispose()
  return $bmp
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function Save-Jpeg([System.Drawing.Bitmap]$bmp, [string]$path) {
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bmp.Dispose()
}

function Render-BrandSvgPng([string]$sourceName, [string]$outPath, [int]$width, [int]$height) {
  if (-not $Browser) {
    throw "Chrome or Edge is required for browser-accurate SVG raster exports."
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null
  $sourcePath = Join-Path $BrandDir $sourceName
  $htmlPath = Join-Path ([System.IO.Path]::GetTempPath()) "nibleaf-brand-$PID-$([System.Guid]::NewGuid().ToString('N')).html"
  $sourceUrl = ([System.Uri](Resolve-Path $sourcePath).Path).AbsoluteUri
  $html = @"
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }

      img {
        display: block;
        width: 100vw;
        height: 100vh;
        object-fit: contain;
      }
    </style>
  </head>
  <body>
    <img alt="" src="$sourceUrl" />
  </body>
</html>
"@
  Set-Content -LiteralPath $htmlPath -Value $html -Encoding utf8
  try {
    & $Browser "--headless=new" "--disable-gpu" "--hide-scrollbars" "--default-background-color=00000000" "--window-size=$width,$height" "--screenshot=$outPath" ([System.Uri]$htmlPath).AbsoluteUri | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Browser SVG render failed for $sourceName"
    }
  } finally {
    Remove-Item -LiteralPath $htmlPath -Force -ErrorAction SilentlyContinue
  }
}

function Convert-PngToJpeg([string]$pngPath, [string]$jpgPath, [System.Drawing.Color]$background) {
  New-Item -ItemType Directory -Force -Path (Split-Path $jpgPath) | Out-Null
  $source = [System.Drawing.Image]::FromFile($pngPath)
  $bmp = [System.Drawing.Bitmap]::new($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.Clear($background)
    $g.DrawImage($source, 0, 0, $source.Width, $source.Height)
  } finally {
    $g.Dispose()
    $source.Dispose()
  }
  Save-Jpeg $bmp $jpgPath
}

function Write-Ico([string[]]$pngPaths, [string]$outPath) {
  $pngs = @($pngPaths | ForEach-Object { ,([System.IO.File]::ReadAllBytes($_)) })
  $fs = [System.IO.File]::Create($outPath)
  $bw = [System.IO.BinaryWriter]::new($fs)
  try {
    $bw.Write([UInt16]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]$pngs.Count)
    $offset = 6 + (16 * $pngs.Count)
    for ($i = 0; $i -lt $pngs.Count; $i++) {
      $img = [System.Drawing.Image]::FromFile($pngPaths[$i])
      try {
        $w = if ($img.Width -ge 256) { 0 } else { [byte]$img.Width }
        $h = if ($img.Height -ge 256) { 0 } else { [byte]$img.Height }
        $bw.Write([byte]$w)
        $bw.Write([byte]$h)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([UInt16]1)
        $bw.Write([UInt16]32)
        $bw.Write([UInt32]$pngs[$i].Length)
        $bw.Write([UInt32]$offset)
        $offset += $pngs[$i].Length
      } finally {
        $img.Dispose()
      }
    }
    foreach ($png in $pngs) { $bw.Write($png) }
  } finally {
    $bw.Dispose()
    $fs.Dispose()
  }
}

function Draw-LogoRaster([string]$path, [string]$Variant, [int]$width, [int]$height, [switch]$Jpeg) {
  $bmp = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $isDark = $Variant -in @("dark", "horizontal-ltr-reverse", "horizontal-reverse", "wordmark-reverse", "wordmark-ar-reverse")
  $isMono = $Variant -eq "monochrome"
  $isArabic = $Variant -in @("stacked-ar", "horizontal-rtl", "horizontal-reverse", "sidebar-ar", "wordmark-ar", "wordmark-ar-reverse")
  $transparent = $Variant -in @("stacked-transparent", "wordmark", "wordmark-reverse", "wordmark-ar", "wordmark-ar-reverse")

  if ($transparent -and -not $Jpeg) {
    $g.Clear([System.Drawing.Color]::Transparent)
  } elseif ($isDark) {
    $g.Clear($Ink)
  } else {
    $g.Clear($Paper)
  }

  if ($Variant -like "wordmark*") {
    $brush = [System.Drawing.SolidBrush]::new($(if ($isDark) { $Paper } else { $Ink }))
    $fontName = if ($isArabic) { "Tahoma" } else { "Arial" }
    $font = [System.Drawing.Font]::new($fontName, 142, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    if ($isArabic) {
      $format = [System.Drawing.StringFormat]::new()
      $format.Alignment = [System.Drawing.StringAlignment]::Far
      $format.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft
      $g.DrawString("Nibleaf", $font, $brush, [System.Drawing.RectangleF]::new(0, 58, $width - 18, 170), $format)
      $format.Dispose()
    } else {
      $g.DrawString("Nibleaf", $font, $brush, 0, 48)
    }
    $font.Dispose()
    $brush.Dispose()
  } elseif ($Variant -like "horizontal*" -or $Variant -like "sidebar*") {
    $iconSize = if ($Variant -like "sidebar*") { 136 } else { 286 }
    $iconY = if ($Variant -like "sidebar*") { 28 } else { 77 }
    $iconX = if ($Variant -in @("horizontal-rtl", "horizontal-reverse")) { $width - $iconSize - 30 } elseif ($Variant -eq "horizontal-icon-right") { $width - $iconSize - 30 } else { if ($Variant -like "sidebar-ar") { $width - $iconSize - 24 } else { 30 } }
    $icon = New-IconBitmap $iconSize
    $g.DrawImage($icon, $iconX, $iconY, $iconSize, $iconSize)
    $icon.Dispose()

    $brush = [System.Drawing.SolidBrush]::new($(if ($isDark) { $Paper } else { $Ink }))
    if ($isArabic) {
      $format = [System.Drawing.StringFormat]::new()
      $format.Alignment = [System.Drawing.StringAlignment]::Far
      $format.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft
      $fontSize = if ($Variant -like "sidebar*") { 84 } else { 190 }
      $font = [System.Drawing.Font]::new("Tahoma", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      $rect = if ($Variant -like "sidebar*") { [System.Drawing.RectangleF]::new(24, 51, 470, 110) } else { [System.Drawing.RectangleF]::new(30, 112, 1080, 220) }
      $g.DrawString("Nibleaf", $font, $brush, $rect, $format)
      $font.Dispose()
      $format.Dispose()
    } else {
      $fontSize = if ($Variant -like "sidebar*") { 84 } else { 190 }
      $font = [System.Drawing.Font]::new("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      $textX = if ($Variant -eq "horizontal-icon-right") { 30 } else { if ($Variant -like "sidebar*") { 190 } else { 370 } }
      $textY = if ($Variant -like "sidebar*") { 42 } else { 92 }
      $g.DrawString("Nibleaf", $font, $brush, $textX, $textY)
      $font.Dispose()
    }
    $brush.Dispose()
  } else {
    $icon = New-IconBitmap 400 -Monochrome:($isMono)
    $g.DrawImage($icon, 312, 170, 400, 400)
    $icon.Dispose()

    $primaryBrush = [System.Drawing.SolidBrush]::new($(if ($isDark) { $Paper } else { $Ink }))
    $secondaryBrush = [System.Drawing.SolidBrush]::new($(if ($isDark) { $Paper2 } else { $Ink2 }))
    $latinFont = [System.Drawing.Font]::new("Arial", 150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $arabicFont = [System.Drawing.Font]::new("Tahoma", 132, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $center = [System.Drawing.StringFormat]::new()
    $center.Alignment = [System.Drawing.StringAlignment]::Center
    $center.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rtlCenter = [System.Drawing.StringFormat]::new()
    $rtlCenter.Alignment = [System.Drawing.StringAlignment]::Center
    $rtlCenter.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rtlCenter.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft

    if ($isArabic) {
      $g.DrawString("Nibleaf", $arabicFont, $primaryBrush, [System.Drawing.RectangleF]::new(0, 720, $width, 170), $rtlCenter)
      $g.DrawString("Nibleaf", $latinFont, $secondaryBrush, [System.Drawing.RectangleF]::new(0, 890, $width, 150), $center)
    } else {
      $g.DrawString("Nibleaf", $latinFont, $primaryBrush, [System.Drawing.RectangleF]::new(0, 700, $width, 170), $center)
      $g.DrawString("Nibleaf", $arabicFont, $secondaryBrush, [System.Drawing.RectangleF]::new(0, 870, $width, 150), $rtlCenter)
    }

    $center.Dispose()
    $rtlCenter.Dispose()
    $latinFont.Dispose()
    $arabicFont.Dispose()
    $primaryBrush.Dispose()
    $secondaryBrush.Dispose()
  }

  $g.Dispose()
  if ($Jpeg) {
    Save-Jpeg $bmp $path
  } else {
    Save-Png $bmp $path
  }
}

function Draw-SocialCard([string]$path, [switch]$Arabic, [switch]$Jpeg) {
  $bmp = [System.Drawing.Bitmap]::new(1200, 630, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear($Paper)
  $g.FillRectangle([System.Drawing.SolidBrush]::new($Paper2), 0, 502, 1200, 128)

  $icon = New-IconBitmap 96
  if ($Arabic) {
    $g.DrawImage($icon, 1018, 84, 96, 96)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Far
    $format.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft
    $g.DrawString("Nibleaf", [System.Drawing.Font]::new("Tahoma", 52, [System.Drawing.FontStyle]::Bold), [System.Drawing.SolidBrush]::new($Ink), [System.Drawing.RectangleF]::new(650, 98, 340, 72), $format)
    $g.DrawString("وثائق تظل", [System.Drawing.Font]::new("Tahoma", 70, [System.Drawing.FontStyle]::Bold), [System.Drawing.SolidBrush]::new($Ink), [System.Drawing.RectangleF]::new(500, 244, 614, 82), $format)
    $g.DrawString("بين يديك.", [System.Drawing.Font]::new("Tahoma", 70, [System.Drawing.FontStyle]::Bold), [System.Drawing.SolidBrush]::new($Umber), [System.Drawing.RectangleF]::new(500, 328, 614, 82), $format)
    $g.DrawString("منصة لنشر وثائق المنتج مع تحرير عربي وبحث مدمج.", [System.Drawing.Font]::new("Tahoma", 27), [System.Drawing.SolidBrush]::new($Ink2), [System.Drawing.RectangleF]::new(124, 448, 990, 50), $format)
    $g.DrawString("Markdown · العربية و RTL", [System.Drawing.Font]::new("Tahoma", 24), [System.Drawing.SolidBrush]::new($Copper), [System.Drawing.RectangleF]::new(124, 536, 990, 42), $format)
    $format.Dispose()
  } else {
    $g.DrawImage($icon, 86, 84, 96, 96)
    $g.DrawString("Nibleaf", [System.Drawing.Font]::new("Arial", 54, [System.Drawing.FontStyle]::Bold), [System.Drawing.SolidBrush]::new($Ink), 206, 98)
    $g.DrawString("Docs that stay", [System.Drawing.Font]::new("Arial", 70, [System.Drawing.FontStyle]::Bold), [System.Drawing.SolidBrush]::new($Ink), 86, 232)
    $g.DrawString("in your hands.", [System.Drawing.Font]::new("Arial", 70, [System.Drawing.FontStyle]::Bold), [System.Drawing.SolidBrush]::new($Umber), 86, 316)
    $g.DrawString("Documentation publishing with Arabic-ready authoring and search.", [System.Drawing.Font]::new("Arial", 28), [System.Drawing.SolidBrush]::new($Ink2), 86, 448)
    $g.DrawString("Markdown · Arabic and RTL", [System.Drawing.Font]::new("Consolas", 24), [System.Drawing.SolidBrush]::new($Copper), 86, 536)
  }
  $icon.Dispose()
  $g.Dispose()
  if ($Jpeg) {
    Save-Jpeg $bmp $path
  } else {
    Save-Png $bmp $path
  }
}

if (Test-Path $RasterDir) {
  Remove-Item -LiteralPath $RasterDir -Recurse -Force
}

$jobs = @()
foreach ($size in @(16, 32, 48, 64)) {
  $path = Join-Path $RasterDir "favicon/favicon-$size.png"
  Save-Png (New-IconBitmap $size -SocialTile) $path
  $jobs += @{ file = "apps/app/public/brand/raster/favicon/favicon-$size.png"; width = $size; height = $size; group = "favicon" }
}

$appIconSizes = @{ "apple-touch-icon-180" = 180; "mstile-150" = 150; "android-chrome-192" = 192; "android-chrome-512" = 512; "app-icon-1024" = 1024 }
foreach ($name in $appIconSizes.Keys) {
  $size = [int]$appIconSizes[$name]
  $path = Join-Path $RasterDir "app-icon/$name.png"
  Save-Png (New-IconBitmap $size -AppTile) $path
  $jobs += @{ file = "apps/app/public/brand/raster/app-icon/$name.png"; width = $size; height = $size; group = "app-icon" }
}

foreach ($size in @(64, 128, 256, 512, 1024)) {
  $path = Join-Path $RasterDir "icon/nibleaf-icon-$size.png"
  Save-Png (New-IconBitmap $size) $path
  $jobs += @{ file = "apps/app/public/brand/raster/icon/nibleaf-icon-$size.png"; width = $size; height = $size; group = "icon" }
}
$reverseIconPath = Join-Path $RasterDir "icon/nibleaf-icon-reverse-512.png"
$monochromeIconPath = Join-Path $RasterDir "icon/nibleaf-icon-monochrome-512.png"
Save-Png (New-IconBitmap 512 -Reverse) $reverseIconPath
Save-Png (New-IconBitmap 512 -Monochrome) $monochromeIconPath
$jobs += @{ file = "apps/app/public/brand/raster/icon/nibleaf-icon-reverse-512.png"; source = "nibleaf-icon-reverse.svg"; width = 512; height = 512; format = "png"; group = "icon" }
$jobs += @{ file = "apps/app/public/brand/raster/icon/nibleaf-icon-monochrome-512.png"; source = "nibleaf-icon-monochrome.svg"; width = 512; height = 512; format = "png"; group = "icon" }
Save-Png (New-IconBitmap 512 -SocialTile) (Join-Path $RasterDir "social/nibleaf-social-avatar-512.png")
Save-Png (New-IconBitmap 1024 -SocialTile) (Join-Path $RasterDir "social/nibleaf-social-avatar-1024.png")
Render-BrandSvgPng "nibleaf-og-card.svg" (Join-Path $RasterDir "social/nibleaf-og-card.png") 1200 630
Render-BrandSvgPng "nibleaf-og-card-ar.svg" (Join-Path $RasterDir "social/nibleaf-og-card-ar.png") 1200 630
Convert-PngToJpeg (Join-Path $RasterDir "social/nibleaf-og-card.png") (Join-Path $RasterDir "social/nibleaf-og-card.jpg") $Paper
Convert-PngToJpeg (Join-Path $RasterDir "social/nibleaf-og-card-ar.png") (Join-Path $RasterDir "social/nibleaf-og-card-ar.jpg") $Paper

$logoJobs = @(
  @{ source = "nibleaf-wordmark.svg"; name = "nibleaf-wordmark"; width = 840; height = 300; variant = "wordmark"; format = "png" },
  @{ source = "nibleaf-wordmark-reverse.svg"; name = "nibleaf-wordmark-reverse"; width = 840; height = 300; variant = "wordmark-reverse"; format = "png" },
  @{ source = "nibleaf-wordmark-ar.svg"; name = "nibleaf-wordmark-ar"; width = 840; height = 300; variant = "wordmark-ar"; format = "png" },
  @{ source = "nibleaf-wordmark-ar-reverse.svg"; name = "nibleaf-wordmark-ar-reverse"; width = 840; height = 300; variant = "wordmark-ar-reverse"; format = "png" },
  @{ source = "nibleaf-logo-stacked.svg"; name = "nibleaf-logo-stacked"; width = 1024; height = 1180; variant = "stacked"; format = "png" },
  @{ source = "nibleaf-logo-stacked-transparent.svg"; name = "nibleaf-logo-stacked-transparent"; width = 1024; height = 1180; variant = "stacked-transparent"; format = "png" },
  @{ source = "nibleaf-logo-dark.svg"; name = "nibleaf-logo-dark"; width = 1024; height = 1180; variant = "dark"; format = "png" },
  @{ source = "nibleaf-logo-monochrome.svg"; name = "nibleaf-logo-monochrome"; width = 1024; height = 1180; variant = "monochrome"; format = "png" },
  @{ source = "nibleaf-logo-stacked-ar.svg"; name = "nibleaf-logo-stacked-ar"; width = 1024; height = 1180; variant = "stacked-ar"; format = "png" },
  @{ source = "nibleaf-logo-horizontal-ltr.svg"; name = "nibleaf-logo-horizontal-ltr"; width = 1520; height = 440; variant = "horizontal-ltr"; format = "png" },
  @{ source = "nibleaf-logo-horizontal-ltr-reverse.svg"; name = "nibleaf-logo-horizontal-ltr-reverse"; width = 1520; height = 440; variant = "horizontal-ltr-reverse"; format = "png" },
  @{ source = "nibleaf-logo-horizontal-rtl.svg"; name = "nibleaf-logo-horizontal-rtl"; width = 1520; height = 440; variant = "horizontal-rtl"; format = "png" },
  @{ source = "nibleaf-logo-horizontal-icon-right.svg"; name = "nibleaf-logo-horizontal-icon-right"; width = 1520; height = 440; variant = "horizontal-icon-right"; format = "png" },
  @{ source = "nibleaf-logo-horizontal-reverse.svg"; name = "nibleaf-logo-horizontal-reverse"; width = 1520; height = 440; variant = "horizontal-reverse"; format = "png" },
  @{ source = "nibleaf-sidebar-lockup.svg"; name = "nibleaf-sidebar-lockup"; width = 680; height = 192; variant = "sidebar"; format = "png" },
  @{ source = "nibleaf-sidebar-lockup-ar.svg"; name = "nibleaf-sidebar-lockup-ar"; width = 680; height = 192; variant = "sidebar-ar"; format = "png" },
  @{ source = "nibleaf-logo-stacked.svg"; name = "nibleaf-logo-stacked"; width = 1024; height = 1180; variant = "stacked"; format = "jpg" },
  @{ source = "nibleaf-logo-dark.svg"; name = "nibleaf-logo-dark"; width = 1024; height = 1180; variant = "dark"; format = "jpg" }
)

foreach ($job in $logoJobs) {
  $ext = [string]$job.format
  $name = [string]$job.name
  $path = Join-Path $RasterDir "logo/$name.$ext"
  if ($ext -eq "jpg") {
    $tempPng = Join-Path ([System.IO.Path]::GetTempPath()) "nibleaf-brand-$PID-$name.png"
    Render-BrandSvgPng ([string]$job.source) $tempPng ([int]$job.width) ([int]$job.height)
    $jpgBackground = if ([string]$job.variant -eq "dark") { $Ink } else { $Paper }
    Convert-PngToJpeg $tempPng $path $jpgBackground
    Remove-Item -LiteralPath $tempPng -Force -ErrorAction SilentlyContinue
  } else {
    Render-BrandSvgPng ([string]$job.source) $path ([int]$job.width) ([int]$job.height)
  }
  $jobs += @{
    file = "apps/app/public/brand/raster/logo/$name.$ext"
    source = [string]$job.source
    width = [int]$job.width
    height = [int]$job.height
    format = $ext
    group = "logo"
  }
}

$jobs += @{ file = "apps/app/public/brand/raster/social/nibleaf-social-avatar-512.png"; source = "nibleaf-social-avatar.svg"; width = 512; height = 512; format = "png"; group = "social" }
$jobs += @{ file = "apps/app/public/brand/raster/social/nibleaf-social-avatar-1024.png"; source = "nibleaf-social-avatar.svg"; width = 1024; height = 1024; format = "png"; group = "social" }
$jobs += @{ file = "apps/app/public/brand/raster/social/nibleaf-og-card.png"; source = "nibleaf-og-card.svg"; width = 1200; height = 630; format = "png"; group = "social" }
$jobs += @{ file = "apps/app/public/brand/raster/social/nibleaf-og-card.jpg"; source = "nibleaf-og-card.svg"; width = 1200; height = 630; format = "jpg"; group = "social" }
$jobs += @{ file = "apps/app/public/brand/raster/social/nibleaf-og-card-ar.png"; source = "nibleaf-og-card-ar.svg"; width = 1200; height = 630; format = "png"; group = "social" }
$jobs += @{ file = "apps/app/public/brand/raster/social/nibleaf-og-card-ar.jpg"; source = "nibleaf-og-card-ar.svg"; width = 1200; height = 630; format = "jpg"; group = "social" }

$manifestPath = Join-Path $RasterDir "manifest.json"
New-Item -ItemType Directory -Force -Path (Split-Path $manifestPath) | Out-Null
($jobs | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $manifestPath -Encoding utf8

$publicApps = @(
  @{
    path = $AppPublic
    name = "Nibleaf"
    shortName = "Nibleaf"
    description = "Documentation publishing with Arabic-ready authoring, search, and versioned releases."
    lang = "en"
    dir = "ltr"
  },
  @{
    path = $AdminPublic
    name = "Nibleaf Admin"
    shortName = "Nibleaf Admin"
    description = "Internal Nibleaf administration console."
    lang = "en"
    dir = "ltr"
  }
)

foreach ($publicApp in $publicApps) {
  $publicDir = [string]$publicApp.path
  New-Item -ItemType Directory -Force -Path $publicDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $BrandDir "nibleaf-favicon.svg") -Destination (Join-Path $publicDir "favicon.svg") -Force
  Copy-Item -LiteralPath (Join-Path $RasterDir "favicon/favicon-16.png") -Destination (Join-Path $publicDir "favicon-16x16.png") -Force
  Copy-Item -LiteralPath (Join-Path $RasterDir "favicon/favicon-32.png") -Destination (Join-Path $publicDir "favicon-32x32.png") -Force
  Copy-Item -LiteralPath (Join-Path $RasterDir "app-icon/apple-touch-icon-180.png") -Destination (Join-Path $publicDir "apple-touch-icon.png") -Force
  Copy-Item -LiteralPath (Join-Path $RasterDir "app-icon/mstile-150.png") -Destination (Join-Path $publicDir "mstile-150x150.png") -Force
  Copy-Item -LiteralPath (Join-Path $RasterDir "app-icon/android-chrome-192.png") -Destination (Join-Path $publicDir "android-chrome-192x192.png") -Force
  Copy-Item -LiteralPath (Join-Path $RasterDir "app-icon/android-chrome-512.png") -Destination (Join-Path $publicDir "android-chrome-512x512.png") -Force
  Write-Ico @(
    (Join-Path $RasterDir "favicon/favicon-16.png"),
    (Join-Path $RasterDir "favicon/favicon-32.png"),
    (Join-Path $RasterDir "favicon/favicon-48.png")
  ) (Join-Path $publicDir "favicon.ico")

  $manifest = [ordered]@{
    name = [string]$publicApp.name
    short_name = [string]$publicApp.shortName
    description = [string]$publicApp.description
    lang = [string]$publicApp.lang
    dir = [string]$publicApp.dir
    start_url = "/"
    scope = "/"
    display = "standalone"
    theme_color = "#181612"
    background_color = "#FBF7EE"
    icons = @(
      [ordered]@{ src = "/favicon.svg"; type = "image/svg+xml"; sizes = "any"; purpose = "any" },
      [ordered]@{ src = "/apple-touch-icon.png"; type = "image/png"; sizes = "180x180"; purpose = "any" },
      [ordered]@{ src = "/android-chrome-192x192.png"; type = "image/png"; sizes = "192x192"; purpose = "any maskable" },
      [ordered]@{ src = "/android-chrome-512x512.png"; type = "image/png"; sizes = "512x512"; purpose = "any maskable" }
    )
  }
  ($manifest | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath (Join-Path $publicDir "site.webmanifest") -Encoding utf8
}

Write-Host "Exported Nibleaf brand raster assets to $RasterDir"
