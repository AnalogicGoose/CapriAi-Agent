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
        $recognized = Wait-WindowsResult ($engine.RecognizeAsync($bitmap)) $resultType
        $hits = [Collections.Generic.List[object]]::new()
        $phrase = ($request.query.Trim() -split '\s+') -join ' '
        $size = ($phrase -split ' ').Count
        foreach ($line in $recognized.Lines) {
            $words = @($line.Words)
            for ($i = 0; $i + $size -le $words.Count -and $hits.Count -lt 12; $i++) {
                $span = $words[$i..($i + $size - 1)]
                if (($span.Text -join ' ') -ine $phrase) { continue }
                $rects = @($span | ForEach-Object { $_.BoundingRect })
                $left = ($rects | Measure-Object X -Minimum).Minimum
                $top = ($rects | Measure-Object Y -Minimum).Minimum
                $right = ($rects | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
                $bottom = ($rects | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
                $hits.Add(@{name = ($span.Text -join ' '); bounds = @{x = $left; y = $top; width = $right - $left; height = $bottom - $top}})
            }
            if ($hits.Count -ge 12) { break }
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
