# Sei update progress window (261030).
#
# Started by Sei (src/main/updateProgressHelper.ts) from a private copy in
# %TEMP% just before "Update Sei" quits into a SILENT installer run, so this
# process holds nothing inside the install folder. It shows Sei's own window
# while the installer works and closes itself when the new Sei shows a window.
#
# Everything it says, and the time-based bar curve, comes from config.json
# (built and unit-tested in TypeScript). This script only plays the plan back
# and reacts to what it can see from outside:
#   - the installer process (name from config) appearing and exiting,
#   - a Sei process newer than the installer appearing ("Opening Sei"),
#   - that process showing its first window (sprint to 100%, fade, exit).
# Fallbacks: no installer within installerWaitSec -> close quietly. Installer
# gone but no Sei after 20 s -> start Sei.exe once. Still none 30 s later ->
# say so, close on a click or after a minute. Hard cap 15 minutes.
#
# Contract with the app: it writes `ready` into its folder once the window
# has drawn its first frame. No `ready` = the app shows the stock installer
# window instead, so a failure here never leaves the user with nothing.
#
# Keep this file ASCII: Windows PowerShell 5.1 reads a BOM-less script in the
# ANSI code page. Non-English text arrives through config.json (UTF-8).
param([Parameter(Mandatory = $true)][string]$ConfigPath)

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $ConfigPath
$logPath = Join-Path $dir 'helper.log'
$clock = [Diagnostics.Stopwatch]::StartNew()
$startedAt = Get-Date

function Log([string]$m) {
  try { [IO.File]::AppendAllText($logPath, ('{0,7:n2}s {1}' -f $clock.Elapsed.TotalSeconds, $m) + "`r`n") } catch { }
}

# Shared mutable state for the event handlers (a hashtable sidesteps the
# script-scope rules of PowerShell scriptblocks).
$S = @{
  phase = 'running'      # running | opening | done | failed | closing
  p = 0.0                # bar position shown, never decreases
  t0 = $null             # seconds on $clock when the first frame was drawn
  installer = $null
  installerSeenAt = $null
  installerStart = $null   # the installer process StartTime (DateTime)
  installerExitAt = $null
  installerExitCode = $null
  appSeenAt = $null
  appWindowAt = $null
  launchedApp = $false
  doneAt = $null
  doneFrom = 0.0
  failedAt = $null
  ribX = 0.0
  lastTick = 0.0
  outcome = ''
  status = ''
}

function Write-Result {
  try {
    $r = [ordered]@{
      outcome = $S.outcome
      windowShownAt = $S.t0
      installerSeenAt = $S.installerSeenAt
      installerExitAt = $S.installerExitAt
      installerExitCode = $S.installerExitCode
      appSeenAt = $S.appSeenAt
      appWindowAt = $S.appWindowAt
      launchedApp = $S.launchedApp
      closedAt = $clock.Elapsed.TotalSeconds
      lastProgress = $S.p
    }
    [IO.File]::WriteAllText((Join-Path $dir 'result.json'), ($r | ConvertTo-Json -Compress))
  } catch { }
}

try {
  $cfg = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
} catch {
  Log "init failed: $($_.Exception.Message)"
  exit 2
}
Log "start lang=$($cfg.lang) theme=$($cfg.theme) estimate=$($cfg.plan.estimateSec)s"

# ---- plan --------------------------------------------------------------------
$curveP = New-Object 'System.Collections.Generic.List[double]'
foreach ($pt in $cfg.plan.curve) { $curveP.Add([double]$pt[1]) }
$statusT = New-Object 'System.Collections.Generic.List[double]'
$statusS = New-Object 'System.Collections.Generic.List[string]'
foreach ($st in $cfg.plan.status) { $statusT.Add([double]$st[0]); $statusS.Add([string]$st[1]) }

function CurveAt([double]$t) {
  if ($t -le 0 -or $curveP.Count -eq 0) { return 0.0 }
  $i = [math]::Floor($t)
  if ($i -ge $curveP.Count - 1) { return $curveP[$curveP.Count - 1] }
  $f = $t - $i
  return $curveP[[int]$i] + ($curveP[[int]$i + 1] - $curveP[[int]$i]) * $f
}
function StatusAt([double]$t) {
  $s = $statusS[0]
  for ($k = 0; $k -lt $statusT.Count; $k++) { if ($statusT[$k] -le $t) { $s = $statusS[$k] } else { break } }
  return $s
}

# ---- palette (mirrors src/renderer/src/styles/tokens.css + the 261029 poster) --
$palettes = @{
  midnight = @{
    bg = '#04070F'; text = '#F4F2EC'; text2 = '#C6CEE0'; muted = '#8A93A8'; track = '#1FFFFFFF'; edge = '#14FFFFFF'
    under = 0.34; dots = 0.62; ribs = '#33FFFFFF'; tip = '#66FFFFFF'; pocket = '#B302040B'; vignette = '#9E010206'; shadow = 0.55
    core = '#3A6CFF'; green = '#14B084'; halo = '#7860FF'; indigo = '#3A60E6'; fill = '#5064F0'; hot = '#96ECD6'
    ribbon = @('#28C896', '#3CBED2', '#6E96FF', '#8C6EFF'); bar = @('#14B084', '#3CBED2', '#6E96FF', '#8C6EFF')
  }
  ice = @{
    bg = '#F3F8FF'; text = '#2A3340'; text2 = '#586273'; muted = '#7D92AB'; track = '#1416202E'; edge = '#1416202E'
    under = 0.30; dots = 0.42; ribs = '#40FFFFFF'; tip = '#557FB0FF'; pocket = '#C7F3F8FF'; vignette = '#00FFFFFF'; shadow = 0.22
    core = '#7FB0FF'; green = '#5CCB93'; halo = '#A497FF'; indigo = '#6F8FE8'; fill = '#8FA8F5'; hot = '#9DE3D2'
    ribbon = @('#5CCB93', '#6CC8DC', '#7FB0FF', '#A497FF'); bar = @('#3F7FD6', '#5A92E6', '#7FB0FF', '#8F9BFF')
  }
  acorn = @{
    bg = '#F8F3EA'; text = '#3B3126'; text2 = '#6A5C4B'; muted = '#94836F'; track = '#1A3B2D1A'; edge = '#1A3B2D1A'
    under = 0.34; dots = 0.42; ribs = '#40FFFFFF'; tip = '#55AD8A63'; pocket = '#C7F8F3EA'; vignette = '#00FFFFFF'; shadow = 0.22
    core = '#E2B98A'; green = '#B7C99A'; halo = '#E8A98C'; indigo = '#C9A27A'; fill = '#D9B48C'; hot = '#F3DEC0'
    ribbon = @('#B7C99A', '#E2C29A', '#D9A57E', '#C9967A'); bar = @('#8A6A44', '#AD8A63', '#C9A27A', '#D9B48C')
  }
  mint = @{
    bg = '#EFF8F2'; text = '#24352B'; text2 = '#52665A'; muted = '#7B9587'; track = '#1A142D20'; edge = '#1A142D20'
    under = 0.32; dots = 0.42; ribs = '#40FFFFFF'; tip = '#5557B47C'; pocket = '#C7EFF8F2'; vignette = '#00FFFFFF'; shadow = 0.22
    core = '#6CC79A'; green = '#57B47C'; halo = '#7FB0FF'; indigo = '#7FD0C0'; fill = '#A6DCB8'; hot = '#B5E8D5'
    ribbon = @('#57B47C', '#7FD0C0', '#8FC4F0', '#7FB0FF'); bar = @('#359961', '#57B47C', '#6CC79A', '#7FD0C0')
  }
}
$pal = $palettes[[string]$cfg.theme]
if ($null -eq $pal) { $pal = $palettes['midnight'] }
$highContrast = [Windows.SystemParameters]::HighContrast
$reduceMotion = -not [Windows.SystemParameters]::ClientAreaAnimation

function Col([string]$hex) { return [Windows.Media.ColorConverter]::ConvertFromString($hex) }
function WithAlpha($c, [double]$a) { return [Windows.Media.Color]::FromArgb([byte]([math]::Round(255 * $a)), $c.R, $c.G, $c.B) }
function Solid([string]$hex) { $b = New-Object Windows.Media.SolidColorBrush (Col $hex); $b.Freeze(); return $b }

# ---- window ------------------------------------------------------------------
# Card 460 x 224 inside a 30 px transparent margin for the soft shadow.
$CW = 460; $CH = 224
$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        ResizeMode="NoResize" ShowInTaskbar="True" ShowActivated="True"
        Width="520" Height="284" WindowStartupLocation="Manual" Opacity="0"
        UseLayoutRounding="True" SnapsToDevicePixels="True">
  <Grid Margin="30">
    <Border x:Name="Shadow" CornerRadius="16" Background="#FF000000">
      <Border.Effect><DropShadowEffect x:Name="ShadowFx" BlurRadius="30" ShadowDepth="8" Direction="270" Color="#000000"/></Border.Effect>
      <Border.CacheMode><BitmapCache/></Border.CacheMode>
    </Border>
    <Grid x:Name="Card" Width="$CW" Height="$CH">
      <Grid.Clip><RectangleGeometry Rect="0,0,$CW,$CH" RadiusX="16" RadiusY="16"/></Grid.Clip>
      <Rectangle x:Name="Base"/>
      <Border x:Name="UnderWrap"><Canvas x:Name="Glow" Width="$CW" Height="$CH" ClipToBounds="True"/></Border>
      <Rectangle x:Name="Dots"/>
      <Rectangle x:Name="Pocket"/>
      <Rectangle x:Name="Vignette"/>
      <Border x:Name="Edge" CornerRadius="16" BorderThickness="1"/>
      <Grid Margin="30,24,30,22">
        <Grid.RowDefinitions>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="*"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>
        <Rectangle x:Name="Logo" Grid.Row="0" Height="20" Width="62" HorizontalAlignment="Left"/>
        <TextBlock x:Name="Title" Grid.Row="1" Margin="0,16,0,0" FontSize="31"/>
        <TextBlock x:Name="Sub" Grid.Row="2" Margin="0,1,0,0" FontSize="16.5" TextWrapping="Wrap"/>
        <Grid x:Name="Track" Grid.Row="4" Height="8" UseLayoutRounding="False" SnapsToDevicePixels="False">
          <Border x:Name="TrackBg" CornerRadius="4"/>
          <Rectangle x:Name="Fill" RadiusX="4" RadiusY="4" HorizontalAlignment="Left" Width="0"/>
          <Rectangle x:Name="Ribs" RadiusX="4" RadiusY="4" HorizontalAlignment="Left" Width="0"/>
          <Ellipse x:Name="Tip" Width="28" Height="28" HorizontalAlignment="Left" VerticalAlignment="Center" Margin="-14,-10,0,-10" IsHitTestVisible="False"/>
        </Grid>
        <DockPanel Grid.Row="5" Margin="0,11,0,0" LastChildFill="True">
          <TextBlock x:Name="Version" DockPanel.Dock="Right" FontSize="13.5" VerticalAlignment="Bottom" Margin="12,0,0,1"/>
          <TextBlock x:Name="Status" FontSize="15.5" TextTrimming="CharacterEllipsis"/>
        </DockPanel>
      </Grid>
    </Grid>
  </Grid>
</Window>
"@

try {
  $window = [Windows.Markup.XamlReader]::Parse($xaml)
} catch {
  Log "xaml failed: $($_.Exception.Message)"
  exit 3
}
function N([string]$name) { return $window.FindName($name) }
$Shadow = N 'Shadow'; $ShadowFx = N 'ShadowFx'; $Card = N 'Card'; $Base = N 'Base'; $UnderWrap = N 'UnderWrap'; $Glow = N 'Glow'
$Dots = N 'Dots'; $Pocket = N 'Pocket'; $Vignette = N 'Vignette'; $Edge = N 'Edge'; $Logo = N 'Logo'
$Title = N 'Title'; $Sub = N 'Sub'; $Track = N 'Track'; $TrackBg = N 'TrackBg'; $Fill = N 'Fill'; $Ribs = N 'Ribs'
$Tip = N 'Tip'; $Version = N 'Version'; $Status = N 'Status'

$window.Title = [string]$cfg.copy.title
try { $window.Icon = [Windows.Media.Imaging.BitmapFrame]::Create([Uri](Join-Path $dir 'icon-64.png')) } catch { Log "icon: $($_.Exception.Message)" }

# ---- fonts: the app's own Oswald + Rajdhani, loaded from the private copy ------
$fontBase = [Uri]('file:///' + (($dir -replace '\\', '/').TrimEnd('/')) + '/fonts/')
$cjk = 'Microsoft YaHei UI, Microsoft YaHei, Segoe UI'
function Fam([string]$family) { return New-Object Windows.Media.FontFamily($fontBase, "./#$family, $cjk") }
$fDisplay = Fam 'Sei Oswald SemiBold'
$fBody = Fam 'Sei Rajdhani Medium'
$fBodyStrong = Fam 'Sei Rajdhani SemiBold'
foreach ($pair in @(@('display', $fDisplay), @('body', $fBody), @('strong', $fBodyStrong))) {
  $gt = $null
  $tf = New-Object Windows.Media.Typeface($pair[1], [Windows.FontStyles]::Normal, [Windows.FontWeights]::Normal, [Windows.FontStretches]::Normal)
  if ($tf.TryGetGlyphTypeface([ref]$gt)) { Log "font $($pair[0]) -> $($gt.FontUri)" } else { Log "font $($pair[0]) -> NOT RESOLVED" }
}

# ---- paint -------------------------------------------------------------------
if ($highContrast) {
  $Base.Fill = [Windows.SystemColors]::WindowBrush
  $Shadow.Background = [Windows.SystemColors]::WindowFrameBrush
  $Edge.BorderBrush = [Windows.SystemColors]::WindowFrameBrush
  $Edge.BorderThickness = 2
  $textBrush = [Windows.SystemColors]::WindowTextBrush
  $text2Brush = [Windows.SystemColors]::WindowTextBrush
  $mutedBrush = [Windows.SystemColors]::GrayTextBrush
  $TrackBg.Background = [Windows.SystemColors]::ControlBrush
  $Fill.Fill = [Windows.SystemColors]::HighlightBrush
} else {
  $Base.Fill = Solid $pal.bg
  $ShadowFx.Opacity = $pal.shadow
  $Edge.BorderBrush = Solid $pal.edge
  $textBrush = Solid $pal.text
  $text2Brush = Solid $pal.text2
  $mutedBrush = Solid $pal.muted
  $TrackBg.Background = Solid $pal.track
}
$Title.Foreground = $textBrush; $Sub.Foreground = $text2Brush; $Status.Foreground = $textBrush; $Version.Foreground = $mutedBrush
$Title.FontFamily = $fDisplay; $Sub.FontFamily = $fBody; $Status.FontFamily = $fBodyStrong; $Version.FontFamily = $fBodyStrong
$Title.Text = [string]$cfg.copy.title
$Sub.Text = [string]$cfg.copy.subtitle
if ($cfg.version) { $Version.Text = 'v' + [string]$cfg.version }
$Status.Text = StatusAt 0

try {
  $logo = New-Object Windows.Media.Imaging.BitmapImage
  $logo.BeginInit(); $logo.CacheOption = 'OnLoad'; $logo.UriSource = [Uri](Join-Path $dir 'sei-text.png'); $logo.EndInit(); $logo.Freeze()
  $Logo.Width = [math]::Round($Logo.Height * $logo.PixelWidth / $logo.PixelHeight)
  $Logo.Fill = $textBrush
  $Logo.OpacityMask = New-Object Windows.Media.ImageBrush $logo
  [Windows.Media.RenderOptions]::SetBitmapScalingMode($Logo, [Windows.Media.BitmapScalingMode]::HighQuality)
} catch { Log "logo: $($_.Exception.Message)"; $Logo.Visibility = 'Collapsed' }

# Animations run at 30 fps: the motion is slow, and the installer wants the CPU.
$animations = New-Object System.Collections.ArrayList
function Drift($target, $prop, [double]$amp, [double]$seconds, [double]$phase) {
  if ($reduceMotion) { return }
  $a = New-Object Windows.Media.Animation.DoubleAnimation(-$amp, $amp, (New-Object Windows.Duration([TimeSpan]::FromSeconds($seconds))))
  $a.AutoReverse = $true
  $a.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever
  $e = New-Object Windows.Media.Animation.SineEase; $e.EasingMode = 'EaseInOut'; $a.EasingFunction = $e
  $a.BeginTime = [TimeSpan]::FromSeconds(-$seconds * $phase)
  [Windows.Media.Animation.Timeline]::SetDesiredFrameRate($a, 30)
  [void]$animations.Add(@($target, $prop, $a))
}

function Add-Blob([double]$x, [double]$y, [double]$w, [double]$h, [string]$hex, [double]$a0, [double]$a1, [double]$rot, [double]$dx, [double]$dy, [double]$sec, [double]$phase) {
  $c = Col $hex
  $b = New-Object Windows.Media.RadialGradientBrush
  $b.GradientStops.Add((New-Object Windows.Media.GradientStop((WithAlpha $c $a0), 0)))
  $b.GradientStops.Add((New-Object Windows.Media.GradientStop((WithAlpha $c $a1), 0.45)))
  $b.GradientStops.Add((New-Object Windows.Media.GradientStop((WithAlpha $c 0), 1)))
  $b.Freeze()
  $e = New-Object Windows.Shapes.Ellipse
  $e.Width = $w; $e.Height = $h; $e.Fill = $b
  [Windows.Controls.Canvas]::SetLeft($e, $x); [Windows.Controls.Canvas]::SetTop($e, $y)
  $g = New-Object Windows.Media.TransformGroup
  $r = New-Object Windows.Media.RotateTransform($rot, ($w / 2), ($h / 2))
  $t = New-Object Windows.Media.TranslateTransform
  $g.Children.Add($r); $g.Children.Add($t)
  $e.RenderTransform = $g
  [void]$Glow.Children.Add($e)
  Drift $t ([Windows.Media.TranslateTransform]::XProperty) $dx $sec $phase
  Drift $t ([Windows.Media.TranslateTransform]::YProperty) $dy ($sec * 1.37) (1 - $phase)
}

function Add-Ribbon([double]$x, [double]$y, [double]$w, [double]$h, [string[]]$hexes, [double]$alpha, [double]$rot, [double]$sec) {
  $lb = New-Object Windows.Media.LinearGradientBrush
  $lb.StartPoint = '0,0.5'; $lb.EndPoint = '1,0.5'
  $offs = @(0, 0.38, 0.7, 1)
  for ($k = 0; $k -lt 4; $k++) { $lb.GradientStops.Add((New-Object Windows.Media.GradientStop((WithAlpha (Col $hexes[$k]) $alpha), $offs[$k]))) }
  $lb.Freeze()
  $mask = New-Object Windows.Media.RadialGradientBrush
  $mask.GradientStops.Add((New-Object Windows.Media.GradientStop((Col '#FF000000'), 0.2)))
  $mask.GradientStops.Add((New-Object Windows.Media.GradientStop((Col '#00000000'), 1)))
  $mask.Freeze()
  $rc = New-Object Windows.Shapes.Rectangle
  $rc.Width = $w; $rc.Height = $h; $rc.Fill = $lb; $rc.OpacityMask = $mask
  [Windows.Controls.Canvas]::SetLeft($rc, $x); [Windows.Controls.Canvas]::SetTop($rc, $y)
  $g = New-Object Windows.Media.TransformGroup
  $r = New-Object Windows.Media.RotateTransform($rot, ($w / 2), ($h / 2))
  $t = New-Object Windows.Media.TranslateTransform
  $g.Children.Add($r); $g.Children.Add($t)
  $rc.RenderTransform = $g
  [void]$Glow.Children.Add($rc)
  Drift $t ([Windows.Media.TranslateTransform]::XProperty) 34 $sec 0.3
  Drift $t ([Windows.Media.TranslateTransform]::YProperty) 9 ($sec * 0.71) 0.6
  Drift $r ([Windows.Media.RotateTransform]::AngleProperty) 2.5 ($sec * 1.3) 0.1
}

if (-not $highContrast) {
  # The 261029 poster's glow geometry (siwc-popup a6), scaled from 960 x 540 to
  # the card, softer and drifting. Order matches the poster's stacking.
  Add-Blob -92 -90 276 207 $pal.indigo 0.62 0.30 0 22 12 15 0.2
  Add-Blob 267 -99 322 224 $pal.halo 0.85 0.40 0 -26 14 17 0.7
  Add-Blob 285 49 258 139 $pal.fill 0.60 0.30 0 -18 16 13 0.4
  Add-Blob -110 103 340 215 $pal.green 0.95 0.50 0 28 -14 16 0.9
  Add-Blob 138 130 414 215 $pal.core 1.00 0.55 0 -30 -12 19 0.5
  Add-Ribbon -64 112 589 58 $pal.ribbon 0.80 -14 14
  Add-Blob 120 157 138 45 $pal.hot 0.80 0.35 -14 24 -8 11 0.15

  $UnderWrap.Opacity = $pal.under

  # Halftone: the same glow seen through a 5 px dot grid, over the soft copy.
  $vb = New-Object Windows.Media.VisualBrush $Glow
  $vb.ViewboxUnits = 'Absolute'; $vb.Viewbox = New-Object Windows.Rect(0, 0, $CW, $CH)
  $vb.ViewportUnits = 'Absolute'; $vb.Viewport = New-Object Windows.Rect(0, 0, $CW, $CH)
  $vb.Stretch = 'Fill'
  $Dots.Fill = $vb
  $dotGroup = New-Object Windows.Media.DrawingGroup
  $dotGroup.Children.Add((New-Object Windows.Media.GeometryDrawing((Solid '#00000000'), $null, (New-Object Windows.Media.RectangleGeometry(New-Object Windows.Rect(0, 0, 5, 5))))))
  $dotGroup.Children.Add((New-Object Windows.Media.GeometryDrawing((Solid '#FFFFFFFF'), $null, (New-Object Windows.Media.EllipseGeometry((New-Object Windows.Point(2.5, 2.5)), 1.65, 1.65)))))
  $dotGroup.Freeze()
  $db = New-Object Windows.Media.DrawingBrush $dotGroup
  $db.TileMode = 'Tile'; $db.Stretch = 'None'
  $db.ViewportUnits = 'Absolute'; $db.Viewport = New-Object Windows.Rect(0, 0, 5, 5)
  $db.ViewboxUnits = 'Absolute'; $db.Viewbox = New-Object Windows.Rect(0, 0, 5, 5)
  $db.Freeze()
  $Dots.OpacityMask = $db
  $Dots.Opacity = $pal.dots

  # A calm pocket behind the words, and the poster's vignette (dark theme).
  $pk = New-Object Windows.Media.RadialGradientBrush
  $pk.Center = '0.30,0.46'; $pk.GradientOrigin = '0.30,0.46'; $pk.RadiusX = 0.62; $pk.RadiusY = 0.66
  $pc = Col $pal.pocket
  $pk.GradientStops.Add((New-Object Windows.Media.GradientStop($pc, 0)))
  $pk.GradientStops.Add((New-Object Windows.Media.GradientStop((WithAlpha $pc ($pc.A / 255 * 0.5)), 0.55)))
  $pk.GradientStops.Add((New-Object Windows.Media.GradientStop((WithAlpha $pc 0), 1)))
  $pk.Freeze(); $Pocket.Fill = $pk
  $vg = New-Object Windows.Media.RadialGradientBrush
  $vg.Center = '0.5,0.55'; $vg.GradientOrigin = '0.5,0.55'; $vg.RadiusX = 0.75; $vg.RadiusY = 0.85
  $vc = Col $pal.vignette
  $vg.GradientStops.Add((New-Object Windows.Media.GradientStop((WithAlpha $vc 0), 0.5)))
  $vg.GradientStops.Add((New-Object Windows.Media.GradientStop($vc, 1)))
  $vg.Freeze(); $Vignette.Fill = $vg

  # Bar fill: the poster's ribbon colours, laid across the whole track so the
  # colour at the head says how far along it is.
  $barBrush = New-Object Windows.Media.LinearGradientBrush
  $barBrush.MappingMode = 'Absolute'; $barBrush.StartPoint = '0,0'; $barBrush.EndPoint = '400,0'
  $boffs = @(0, 0.4, 0.75, 1)
  for ($k = 0; $k -lt 4; $k++) { $barBrush.GradientStops.Add((New-Object Windows.Media.GradientStop((Col $pal.bar[$k]), $boffs[$k]))) }
  $Fill.Fill = $barBrush
  $tc = Col $pal.tip
  $tipBrush = New-Object Windows.Media.RadialGradientBrush
  $tipBrush.GradientStops.Add((New-Object Windows.Media.GradientStop($tc, 0)))
  $tipBrush.GradientStops.Add((New-Object Windows.Media.GradientStop((WithAlpha $tc 0), 1)))
  $tipBrush.Freeze(); $Tip.Fill = $tipBrush
}

# Backward-moving diagonal ribbing over the fill (Harrison et al., CHI 2010).
$ribGeo = [Windows.Media.Geometry]::Parse('M0,8 L5,0 L10,0 L5,8 Z')
$ribGroup = New-Object Windows.Media.DrawingGroup
$ribGroup.Children.Add((New-Object Windows.Media.GeometryDrawing((Solid '#00000000'), $null, (New-Object Windows.Media.RectangleGeometry(New-Object Windows.Rect(0, 0, 12, 8))))))
$ribColor = '#33FFFFFF'; if ($pal.ribs) { $ribColor = $pal.ribs }
$ribGroup.Children.Add((New-Object Windows.Media.GeometryDrawing((Solid $ribColor), $null, $ribGeo)))
$ribGroup.Freeze()
$ribBrush = New-Object Windows.Media.DrawingBrush $ribGroup
$ribBrush.TileMode = 'Tile'; $ribBrush.Stretch = 'None'
$ribBrush.ViewportUnits = 'Absolute'; $ribBrush.Viewport = New-Object Windows.Rect(0, 0, 12, 8)
$ribBrush.ViewboxUnits = 'Absolute'; $ribBrush.Viewbox = New-Object Windows.Rect(0, 0, 12, 8)
$ribShift = New-Object Windows.Media.TranslateTransform
$ribBrush.Transform = $ribShift
$Ribs.Fill = $ribBrush
if ($highContrast) { $Ribs.Visibility = 'Collapsed'; $Tip.Visibility = 'Collapsed' }

# ---- placement: centred on Sei's window, kept on screen --------------------------
$window.Add_SourceInitialized({
  try {
    $src = [Windows.PresentationSource]::FromVisual($window)
    $scale = 1.0
    if ($src -and $src.CompositionTarget) { $scale = $src.CompositionTarget.TransformToDevice.M11 }
    if ($cfg.center) {
      $cx = [double]$cfg.center.x / $scale; $cy = [double]$cfg.center.y / $scale
    } else {
      $wa = [Windows.SystemParameters]::WorkArea
      $cx = $wa.Left + $wa.Width / 2; $cy = $wa.Top + $wa.Height / 2
    }
    $left = $cx - $window.Width / 2; $top = $cy - $window.Height / 2
    $vl = [Windows.SystemParameters]::VirtualScreenLeft; $vt = [Windows.SystemParameters]::VirtualScreenTop
    $vw = [Windows.SystemParameters]::VirtualScreenWidth; $vh = [Windows.SystemParameters]::VirtualScreenHeight
    $window.Left = [math]::Max($vl, [math]::Min($left, $vl + $vw - $window.Width))
    $window.Top = [math]::Max($vt, [math]::Min($top, $vt + $vh - $window.Height))
  } catch { Log "placement: $($_.Exception.Message)" }
})

$window.Add_MouseLeftButtonDown({
  try {
    if ($S.phase -eq 'failed') { Close-Window 'failed-dismissed'; return }
    $window.DragMove()
  } catch { }
})

function Fade([double]$to, [double]$ms) {
  if ($reduceMotion -or $ms -le 0) { $window.Opacity = $to; return }
  $a = New-Object Windows.Media.Animation.DoubleAnimation($to, (New-Object Windows.Duration([TimeSpan]::FromMilliseconds($ms))))
  $window.BeginAnimation([Windows.Window]::OpacityProperty, $a)
}

function Close-Window([string]$outcome) {
  if ($S.phase -eq 'closing') { return }
  $S.phase = 'closing'
  $S.outcome = $outcome
  Log "close: $outcome"
  Write-Result
  Fade 0 280
  $closer = New-Object Windows.Threading.DispatcherTimer
  $closer.Interval = [TimeSpan]::FromMilliseconds(320)
  $closer.Add_Tick({ try { $this.Stop(); $window.Close() } catch { } })
  $closer.Start()
}
$window.Add_Closed({ try { $window.Dispatcher.InvokeShutdown() } catch { } })

# ---- frame tick: bar, ribbing, status --------------------------------------------
$frame = New-Object Windows.Threading.DispatcherTimer([Windows.Threading.DispatcherPriority]::Render)
$frame.Interval = [TimeSpan]::FromMilliseconds(33)
$frame.Add_Tick({
  try {
    if ($null -eq $S.t0) { return }
    $now = $clock.Elapsed.TotalSeconds
    $dt = [math]::Min(0.25, [math]::Max(0, $now - $S.lastTick)); $S.lastTick = $now
    $t = $now - $S.t0
    $target = CurveAt $t
    switch ($S.phase) {
      'opening' { $target = [math]::Max($target, $S.p + (0.93 - $S.p) * (1 - [math]::Exp(-$dt / 0.6))) }
      'done' {
        # The real finish: accelerate to 100% (ease-in), then fade.
        $u = [math]::Min(1, ($now - $S.doneAt) / 0.45)
        $target = $S.doneFrom + (1 - $S.doneFrom) * $u * $u
        if ($u -ge 1 -and ($now - $S.doneAt) -ge 0.75) { Close-Window 'reopened' }
      }
    }
    if ($target -gt $S.p) { $S.p = [math]::Min(1, $target) }
    $w = $Track.ActualWidth
    if ($w -gt 0) {
      $fw = [math]::Max(8, $S.p * $w)
      $Fill.Width = $fw; $Ribs.Width = $fw
      $Tip.Margin = New-Object Windows.Thickness(($fw - 18), -10, 0, -10)
    }
    if (-not $reduceMotion) {
      # 40 px/s easing to 14 px/s as the bar fills; leftward, against progress.
      $v = 40 - 26 * $S.p
      $S.ribX = ($S.ribX - $v * $dt) % 12
      $ribShift.X = $S.ribX
    }
    $line = $null
    switch ($S.phase) {
      'running' { $line = StatusAt $t }
      'opening' { $line = [string]$cfg.copy.opening }
      'done' { $line = [string]$cfg.copy.opening }
      'failed' { $line = [string]$cfg.copy.failed }
    }
    if ($line -and $line -ne $S.status) { $S.status = $line; $Status.Text = $line; Log "status: $line" }
  } catch { Log "frame: $($_.Exception.Message)" }
})

# ---- process watch -------------------------------------------------------------
function Since($at) { if ($null -eq $at) { return 0 } return $clock.Elapsed.TotalSeconds - $at }
$watch = New-Object Windows.Threading.DispatcherTimer
$watch.Interval = [TimeSpan]::FromMilliseconds(400)
$watch.Add_Tick({
  try {
    if ($S.phase -eq 'closing') { return }
    $now = $clock.Elapsed.TotalSeconds
    if ($null -eq $S.installer -and $null -eq $S.installerExitAt) {
      $ip = Get-Process -Name ([string]$cfg.installerName) -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($ip) {
        try { $null = $ip.Handle } catch { }
        $S.installer = $ip; $S.installerSeenAt = $now
        try { $S.installerStart = $ip.StartTime } catch { $S.installerStart = $startedAt }
        Log "installer seen (pid $($ip.Id))"
      } elseif ($null -eq $S.appSeenAt -and $now -gt [double]$cfg.installerWaitSec) {
        Close-Window 'no-installer'; return
      }
    }
    if ($S.installer -and $null -eq $S.installerExitAt) {
      $gone = $false
      try { $gone = $S.installer.HasExited } catch { $gone = -not (Get-Process -Id $S.installer.Id -ErrorAction SilentlyContinue) }
      if ($gone) {
        $S.installerExitAt = $now
        try { $S.installerExitCode = $S.installer.ExitCode } catch { }
        Log "installer exited (code $($S.installerExitCode))"
      }
    }
    # Only a Sei started AFTER the installer counts as the new one: the old Sei
    # (and any child it starts while quitting) predates it.
    if ($null -ne $S.installerStart -and ($S.phase -eq 'running' -or $S.phase -eq 'opening' -or $S.phase -eq 'failed')) {
      $since = $S.installerStart
      $apps = @(Get-Process -Name ([string]$cfg.appName) -ErrorAction SilentlyContinue | Where-Object { try { $_.StartTime -gt $since } catch { $false } })
      if ($apps.Count -gt 0) {
        if ($null -eq $S.appSeenAt) { $S.appSeenAt = $now; Log "new $($cfg.appName) process (pid $($apps[0].Id))" }
        if ($S.phase -ne 'opening') { $S.phase = 'opening' }
        $shown = @($apps | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
        if ($shown.Count -gt 0) {
          $S.appWindowAt = $now
          Log "new $($cfg.appName) window: '$($shown[0].MainWindowTitle)'"
          $S.phase = 'done'; $S.doneAt = $now; $S.doneFrom = $S.p
          return
        }
        if ((Since $S.appSeenAt) -gt 60 -and $null -ne $S.installerExitAt) { Close-Window 'no-app-window'; return }
      }
    }
    if ($null -ne $S.installerExitAt -and $null -eq $S.appSeenAt) {
      $after = Since $S.installerExitAt
      if (-not $S.launchedApp -and $after -gt 20 -and $cfg.appExe -and (Test-Path -LiteralPath ([string]$cfg.appExe))) {
        $S.launchedApp = $true
        Log "starting $($cfg.appExe) (installer gone, no app yet)"
        try { Start-Process -FilePath ([string]$cfg.appExe) -WorkingDirectory (Split-Path -Parent ([string]$cfg.appExe)) } catch { Log "start app: $($_.Exception.Message)" }
      }
      if ($S.phase -eq 'running' -and $after -gt 50) { $S.phase = 'failed'; $S.failedAt = $now; Log 'failed: no app after install' }
    }
    if ($S.phase -eq 'failed' -and (Since $S.failedAt) -gt 60) { Close-Window 'failed'; return }
    if ($now -gt 900) { Close-Window 'timeout' }
  } catch { Log "watch: $($_.Exception.Message)" }
})

# ---- go ------------------------------------------------------------------------
$window.Add_ContentRendered({
  try {
    if ($null -ne $S.t0) { return }
    $S.t0 = $clock.Elapsed.TotalSeconds; $S.lastTick = $S.t0
    [IO.File]::WriteAllText((Join-Path $dir 'ready'), 'ready')
    Log "first frame (reduceMotion=$reduceMotion highContrast=$highContrast)"
    foreach ($a in $animations) { $a[0].BeginAnimation($a[1], $a[2]) }
    Fade 1 220
    $frame.Start(); $watch.Start()
    $window.Activate() | Out-Null
  } catch { Log "rendered: $($_.Exception.Message)" }
})

try {
  # Started with windowsHide, the process's first ShowWindow call may be turned
  # into SW_HIDE (STARTUPINFO). Showing twice makes the second call the real
  # one; the window is fully transparent until the fade-in, so either way
  # nothing flickers.
  $window.Show(); $window.Hide(); $window.Show()
  [Windows.Threading.Dispatcher]::Run()
} catch {
  Log "run: $($_.Exception.Message)"
  exit 4
}
if (-not $S.outcome) { $S.outcome = 'closed'; Write-Result }
Log 'exit'
exit 0
