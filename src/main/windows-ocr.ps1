$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Wait-WindowsResult($operation, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    return $task.GetAwaiter().GetResult()
}

try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $engine = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]::TryCreateFromUserProfileLanguages()
    if (!$engine) { throw 'Windows OCR needs a text recognition language installed.' }
    $decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
    $bitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime]
    $resultType = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $memory = [IO.MemoryStream]::new([Convert]::FromBase64String($request.image))
    $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
    $bitmap = $null
    try {
        $decoder = Wait-WindowsResult ($decoderType::CreateAsync($stream)) $decoderType
        $bitmap = Wait-WindowsResult ($decoder.GetSoftwareBitmapAsync()) $bitmapType
        $phrase = ($request.query.Trim() -split '\s+') -join ' '
        $size = ($phrase -split ' ').Count
        $edge = '^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$'
        $wanted = (@($phrase -split ' ' | ForEach-Object { $_ -replace $edge, '' })) -join ' '
        $hits = [Collections.Generic.List[object]]::new()
        # Small UI text is often missed at native size, so retry once at 2x.
        foreach ($factor in 1, 2) {
            $source = $bitmap
            if ($factor -gt 1) {
                $transform = [Windows.Graphics.Imaging.BitmapTransform, Windows.Foundation, ContentType=WindowsRuntime]::new()
                $transform.ScaledWidth = [uint32]($decoder.PixelWidth * $factor)
                $transform.ScaledHeight = [uint32]($decoder.PixelHeight * $factor)
                $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Fant
                $source = Wait-WindowsResult ($decoder.GetSoftwareBitmapAsync($bitmap.BitmapPixelFormat, $bitmap.BitmapAlphaMode, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) $bitmapType
            }
            try { $recognized = Wait-WindowsResult ($engine.RecognizeAsync($source)) $resultType }
            finally { if ($factor -gt 1) { $source.Dispose() } }
            foreach ($line in $recognized.Lines) {
                $words = @($line.Words)
                for ($i = 0; $i + $size -le $words.Count -and $hits.Count -lt 12; $i++) {
                    $span = @($words[$i..($i + $size - 1)])
                    $clean = @($span | ForEach-Object { $_.Text -replace $edge, '' })
                    if (($clean -join ' ') -ine $wanted) { continue }
                    $rects = @($span | ForEach-Object { $_.BoundingRect })
                    $left = ($rects | Measure-Object X -Minimum).Minimum
                    $top = ($rects | Measure-Object Y -Minimum).Minimum
                    $right = ($rects | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
                    $bottom = ($rects | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
                    $hits.Add(@{name = ($clean -join ' '); bounds = @{x = $left / $factor; y = $top / $factor; width = ($right - $left) / $factor; height = ($bottom - $top) / $factor}})
                }
                if ($hits.Count -ge 12) { break }
            }
            if ($hits.Count) { break }
        }
        @{ matches = @($hits.ToArray()) } | ConvertTo-Json -Depth 5 -Compress
    } finally {
        if ($bitmap) { $bitmap.Dispose() }
        $stream.Dispose()
        $memory.Dispose()
    }
} catch {
    @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
