$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Read-Control($element) {
    $state = $element.Current
    if ($state.IsPassword -or $state.IsOffscreen) { return }
    $bounds = $state.BoundingRectangle
    if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { return }
    $role = $state.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    $value = $null
    $operations = @()
    $pattern = $null
    if ($element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $operations += 'invoke' }
    if ('invoke' -notin $operations -and $element.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
        $operations += 'invoke'
        if ($request.query) { $value = $pattern.Current.IsSelected }
    }
    if ($element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        $operations += 'set-value'
        $value = $pattern.Current.ToggleState.ToString().ToLowerInvariant()
    }
    if ($element.TryGetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern, [ref]$pattern)) {
        if (!$pattern.Current.IsReadOnly) { $operations += 'set-value' }
        if ($request.query) { $value = $pattern.Current.Value }
    }
    if ($element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        if (!$pattern.Current.IsReadOnly) { $operations += 'set-value' }
        # Only expose editable values on explicit reads and cap their size. Never read password controls.
        if ($request.query -and $role -in @('Edit', 'ComboBox', 'Spinner', 'Slider')) {
            $raw = [string]$pattern.Current.Value
            if ($raw.Length -le 300) { $value = $raw }
        }
    }
    $name = [string]$state.Name
    if ($role -notin @('Edit', 'ComboBox', 'Spinner', 'Slider', 'Button', 'CheckBox', 'RadioButton', 'TabItem', 'MenuItem', 'Hyperlink', 'ListItem', 'Text', 'TreeItem', 'HeaderItem') -and !$operations.Count) { return }
    if (!$name -and !$operations.Count) { return }
    return @{
        identity = ($element.GetRuntimeId() -join ','); name = $name.Substring(0, [Math]::Min(160, $name.Length));
        role = $role; value = $value; enabled = $state.IsEnabled; operations = @($operations | Select-Object -Unique);
        bounds = @{ x = $bounds.X; y = $bounds.Y; width = $bounds.Width; height = $bounds.Height }
    }
}

function Confirm-ControlValue([scriptblock]$read) {
    try { return (& $read) }
    catch [Windows.Automation.ElementNotAvailableException] { return $false }
}

function Set-ControlValue($element, [string]$value) {
    $pattern = $null
    if ($element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        if ($value -notin @('on', 'off')) { throw 'Use on or off for this toggle.' }
        $before = $pattern.Current.ToggleState.ToString()
        if ($before -eq 'indeterminate') { throw 'This control is in an indeterminate state. Inspect it again.' }
        if ($before -ne $value) { $pattern.Toggle() }
        return (Confirm-ControlValue { $pattern.Current.ToggleState.ToString() -eq $value })
    }
    if ($element.TryGetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern, [ref]$pattern) -and !$pattern.Current.IsReadOnly) {
        $number = 0.0
        if (![double]::TryParse($value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number) -or
            [double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt $pattern.Current.Minimum -or $number -gt $pattern.Current.Maximum) {
            throw 'Use a number within the valid control range.'
        }
        $pattern.SetValue($number)
        return (Confirm-ControlValue { $pattern.Current.Value -eq $number })
    }
    $pattern = $element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    $pattern.SetValue($value)
    return (Confirm-ControlValue { $pattern.Current.Value -ceq $value })
}

try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
    $handle = [IntPtr]::new([long]$request.windowId)
    $root = [Windows.Automation.AutomationElement]::FromHandle($handle)
    if (!$root -or $root.Current.ProcessId -ne $request.pid) { throw 'The observed window closed or changed.' }
    $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
    $pending = [Collections.Generic.Queue[Windows.Automation.AutomationElement]]::new()
    $pending.Enqueue($root)
    $controls = [Collections.Generic.List[object]]::new()
    $seen = 0
    while ($pending.Count -and $seen -lt 400 -and $controls.Count -lt 40) {
        $parent = $pending.Dequeue()
        $seen++
        try {
            if ($parent.Current.IsPassword) { continue }
            if ($parent -ne $root) {
                if ($request.operation -eq 'inspect') {
                    $label = [string]$parent.Current.Name
                    if (!$request.query -or $label.IndexOf($request.query, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                        $item = Read-Control $parent
                        if ($item) { $controls.Add($item) }
                    }
                } elseif (($parent.GetRuntimeId() -join ',') -eq $request.control.identity) {
                    $target = Read-Control $parent
                    if (!$target -or $target.name -cne $request.control.name -or $target.role -ne $request.control.role) { throw 'The control changed. Inspect the window again.' }
                    if ($request.operation -eq 'locate') { $result = @{ control = $target }; break }
                    if (!$target.enabled -or $request.operation -notin $target.operations) { throw 'The selected action is unavailable on this control.' }
                    Add-Type -Name Desktop -Namespace Capri -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
'@
                    if ([Capri.Desktop]::GetForegroundWindow() -ne $handle) { throw 'The target window is no longer in front.' }
                    if ($request.operation -eq 'set-value') {
                        $verified = Set-ControlValue $parent ([string]$request.value)
                        $result = @{ dispatched = $true; verified = $verified }
                    } else {
                        $pattern = $null
                        $verified = $false
                        if ($parent.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
                        else {
                            $pattern = $parent.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
                            $pattern.Select()
                            try { $verified = $pattern.Current.IsSelected } catch [Windows.Automation.ElementNotAvailableException] {}
                        }
                        $result = @{ dispatched = $true; verified = $verified }
                    }
                    break
                }
            }
            $child = $walker.GetFirstChild($parent)
            while ($child -and ($seen + $pending.Count) -lt 400) {
                $pending.Enqueue($child)
                $child = $walker.GetNextSibling($child)
            }
        } catch [Windows.Automation.ElementNotAvailableException] {
            if ($request.operation -ne 'inspect') { throw }
        }
    }
    if ($request.operation -eq 'inspect') { $result = @{ controls = @($controls.ToArray()); limited = ($pending.Count -gt 0 -or $seen -ge 400) } }
    if (!$result) { throw 'The control is no longer available in the observed window.' }
    $result | ConvertTo-Json -Depth 6 -Compress
} catch {
    @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
