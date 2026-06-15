# notify-toast.ps1 - fire a non-blocking Windows desktop notification.
# Used by the no-touch routine to flag a match stuck "upcoming" past its expected
# finish. Tries a native toast first, then a tray balloon; both are best-effort and
# never throw (the routine must never fail because a notification could not show).
param(
  [string]$Title = "Soccer Stats",
  [string]$Message = ""
)

$ErrorActionPreference = "SilentlyContinue"

function Show-Toast {
  param([string]$Title, [string]$Message)
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $nodes = $xml.GetElementsByTagName("text")
    $nodes.Item(0).AppendChild($xml.CreateTextNode($Title)) | Out-Null
    $nodes.Item(1).AppendChild($xml.CreateTextNode($Message)) | Out-Null
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Soccer Stats")
    $notifier.Show($toast)
    return $true
  } catch {
    return $false
  }
}

function Show-Balloon {
  param([string]$Title, [string]$Message)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Warning
    $icon.Visible = $true
    $icon.BalloonTipTitle = $Title
    $icon.BalloonTipText = $Message
    $icon.ShowBalloonTip(15000)
    Start-Sleep -Seconds 2
    $icon.Dispose()
    return $true
  } catch {
    return $false
  }
}

if (-not (Show-Toast -Title $Title -Message $Message)) {
  [void](Show-Balloon -Title $Title -Message $Message)
}
exit 0
