#!/bin/zsh
set -eu
LABEL="com.local.workbuddy.daily-checkin"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
print 'Schedule removed. Program and logs retained in ~/Library/Application Support/WorkBuddyAutoCheckin'
