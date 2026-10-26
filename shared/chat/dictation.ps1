param([switch]$Probe)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
 Add-Type -AssemblyName System.Speech
 $recognizer=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
 if(-not $recognizer){throw '请在 Windows 语言设置安装中文语音识别功能。'}
 if($Probe){@{ok=$true;culture=$recognizer.Culture.Name} | ConvertTo-Json -Compress;exit 0}
 $engine=New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizer)
 try {
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.InitialSilenceTimeout=[TimeSpan]::FromSeconds(12)
  $engine.BabbleTimeout=[TimeSpan]::FromSeconds(12)
  $engine.EndSilenceTimeout=[TimeSpan]::FromMilliseconds(700)
  $engine.EndSilenceTimeoutAmbiguous=[TimeSpan]::FromMilliseconds(1000)
  $engine.SetInputToDefaultAudioDevice()
  @{ready=$true} | ConvertTo-Json -Compress
  $result=$engine.Recognize([TimeSpan]::FromSeconds(20))
  # Low confidence is common with headset and Bluetooth microphones. Keep any
  # non-empty recognition result and let the user edit it before sending.
  if(-not $result -or [string]::IsNullOrWhiteSpace($result.Text)){throw '没有识别到语音。请确认麦克风未静音，并在“正在听”后说话。'}
  @{ok=$true;text=$result.Text;confidence=$result.Confidence} | ConvertTo-Json -Compress
 } finally {if($engine){$engine.Dispose()}}
} catch {@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress;exit 1}
