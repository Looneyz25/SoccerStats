' run-hidden.vbs - launch the no-touch controller with no visible console window,
' inside the logged-on user's session so desktop notifications still display.
' Used as the action for the "SoccerStats NoTouch" scheduled task.
' Arg 2 = 0 hides the window; arg 3 = False means do not wait.
CreateObject("WScript.Shell").Run "cmd /c ""C:\Betting\Soccer Stats\run_notouch.bat""", 0, False
