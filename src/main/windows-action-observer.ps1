$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$timer = [Diagnostics.Stopwatch]::StartNew()

if ($env:STELLA_OBSERVE_ACTION -eq 'workspace') {
    $shell = New-Object -ComObject Shell.Application
    $expected = $env:STELLA_OBSERVE_PATH.TrimEnd('\')
    do {
        foreach ($window in @($shell.Windows())) {
            try {
                if ([IO.Path]::GetFileName($window.FullName) -ieq 'explorer.exe' -and $window.Visible) {
                    $folder = $window.Document.Folder.Self.Path
                    if ($folder -and $folder.TrimEnd('\') -ieq $expected) { 'confirmed'; return }
                }
            } catch { }
        }
        Start-Sleep -Milliseconds 125
    } while ($timer.ElapsedMilliseconds -lt 2800)
    return
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-Operation($operation, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if ($task.Wait(700)) { $task.Result }
}
function Media-Key([string]$text) {
    $text.Normalize([Text.NormalizationForm]::FormD).ToLowerInvariant() -replace '[\u2019\x27\p{M}]', '' -replace '[^\p{L}\p{N}]+', ' '
}
function Invoke-FirefoxTrack {
    if ($env:STELLA_OBSERVE_BROWSER -ne 'Firefox' -or $env:STELLA_OBSERVE_VIDEO -notmatch '^[\w-]{11}$') { return $false }
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $element = [System.Windows.Automation.AutomationElement]
    $kind = [System.Windows.Automation.ControlType]
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $matchVideo = '^(?:https://)?music\.youtube\.com/watch\?(?:[^#&]+&)*v=' +
        [regex]::Escape($env:STELLA_OBSERVE_VIDEO) + '(?:&|$)'
    $edit = [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, $kind::Edit)
    $document = [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, $kind::Document)
    $button = [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, $kind::Button)
    foreach ($browser in Get-Process firefox -ErrorAction SilentlyContinue) {
        if (!$browser.MainWindowHandle) { continue }
        $window = $element::FromHandle($browser.MainWindowHandle)
        # Only accept the URL bar value. A website can put a lookalike address in its own inputs.
        $address = @($window.FindAll($scope, $edit) | Where-Object {
            $_.Current.AutomationId -eq 'urlbar-input'
        })
        if ($address.Count -ne 1) { continue }
        $value = $address[0].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($value.Current.Value -cnotmatch $matchVideo) { continue }
        $page = $window.FindFirst($scope, $document)
        if (!$page -or $page.Current.IsOffscreen) { continue }
        $play = @($page.FindAll($scope, $button) | Where-Object {
            $_.Current.IsEnabled -and !$_.Current.IsOffscreen -and
            $_.Current.Name -in @('Play', 'Reproducir')
        })
        if ($play.Count -ne 1 -or $value.Current.Value -cnotmatch $matchVideo) { continue }
        $invoke = $play[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
        return $true
    }
    return $false
}
$manager = Wait-Operation ($managerType::RequestAsync()) $managerType
if (!$manager) { return }
$title = (Media-Key $env:STELLA_OBSERVE_TITLE).Trim()
$artist = (Media-Key $env:STELLA_OBSERVE_ARTIST).Trim()
$browserPattern = switch ($env:STELLA_OBSERVE_BROWSER) {
    'Firefox' { '(^|[.\\/])firefox([.\\/-]|$)' }
    'Google Chrome' { '(^|[.\\/])chrome([.\\/]|$)' }
    'Microsoft Edge' { '(^|[.\\/])msedge([.\\/]|$)' }
    'Brave' { '(^|[.\\/])brave([.\\/]|$)' }
}
if (!$browserPattern -or !$title -or !$artist) { return }
$playRequested = $false
$browserChecked = $false
do {
    $matches = @(foreach ($session in $manager.GetSessions()) {
        if ($session.SourceAppUserModelId -notmatch $browserPattern) { continue }
        $properties = Wait-Operation ($session.TryGetMediaPropertiesAsync()) $propertiesType
        if ($properties -and (Media-Key $properties.Title).Trim() -eq $title -and
            (Media-Key $properties.Artist).Trim() -eq $artist) { $session }
    })
    if ($matches.Count -eq 1) {
        $session = $matches[0]
        $playback = $session.GetPlaybackInfo()
        if ($playback.PlaybackStatus -eq 'Playing') { 'confirmed'; return }
        if (!$playRequested -and $playback.Controls.IsPlayEnabled) {
            $playRequested = $true
            $null = Wait-Operation ($session.TryPlayAsync()) ([bool])
        }
    }
    if (!$browserChecked -and !$playRequested -and $timer.ElapsedMilliseconds -ge 1500) {
        $browserChecked = $true
        try { $playRequested = Invoke-FirefoxTrack } catch { }
    }
    Start-Sleep -Milliseconds 220
} while ($timer.ElapsedMilliseconds -lt 5200)
