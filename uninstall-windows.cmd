@echo off
powershell.exe -NoProfile -Command "Unregister-ScheduledTask -TaskName 'WorkBuddy-DailyCheckin' -Confirm:$false -ErrorAction SilentlyContinue"
echo Schedule removed. Program and logs retained in %%LOCALAPPDATA%%\WorkBuddyAutoCheckin
pause
