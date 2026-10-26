$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$records = [System.Collections.Generic.List[object]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
function Add-Application($name, $launch, $target) {
    if ($records.Count -ge 1800 -or -not $target -or -not $launch) { return }
    $target = [Environment]::ExpandEnvironmentVariables($target.Trim('"'))
    if ([IO.Path]::GetExtension($target) -ine '.exe' -or -not [IO.File]::Exists($target) -or -not [IO.File]::Exists($launch)) { return }
    if ($seen.Add($launch)) { $records.Add(@{name=$name;path=$launch;executable=$target}) }
}
$shell = New-Object -ComObject WScript.Shell
try {
    foreach ($root in @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'))) {
        if (-not $root -or -not [IO.Directory]::Exists($root)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $root -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1200) {
            try { $shortcut=$shell.CreateShortcut($file.FullName); Add-Application $file.BaseName $file.FullName $shortcut.TargetPath } catch { }
        }
    }
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
        $base=$null; $root=$null
        try {
            $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
            $root=$base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\App Paths')
            if ($null -eq $root) { continue }
            foreach ($name in $root.GetSubKeyNames()) {
                $key=$null
                try { $key=$root.OpenSubKey($name); $target=[string]$key.GetValue(''); if ($target) { $target=[Environment]::ExpandEnvironmentVariables($target.Trim('"')); Add-Application ([IO.Path]::GetFileNameWithoutExtension($name)) $target $target } } catch { } finally { if ($key) {$key.Dispose()} }
            }
        } catch { } finally { if ($root) {$root.Dispose()}; if ($base) {$base.Dispose()} }
    }
}
foreach ($item in @(@('记事本','notepad.exe'),@('计算器','calc.exe'))) {
    $target=Join-Path $env:SystemRoot ('System32\'+$item[1]); Add-Application $item[0] $target $target
}
ConvertTo-Json -InputObject @($records.ToArray()) -Depth 3 -Compress
