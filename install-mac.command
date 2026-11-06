#!/bin/zsh
set -eu
SRC="${0:A:h}"
DEST="$HOME/Library/Application Support/WorkBuddyAutoCheckin"
LABEL="com.local.workbuddy.daily-checkin"
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]]; then NODE="$candidate"; break; fi
  done
fi
if [[ -z "$NODE" ]] || ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0])>=18?0:1)'; then
  print 'Please install Node.js 18+ (LTS) from https://nodejs.org then run again.'
  exit 1
fi
mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
chmod 700 "$DEST"
if [[ "$SRC/checkin.cjs" != "$DEST/checkin.cjs" ]]; then cp "$SRC/checkin.cjs" "$DEST/checkin.cjs"; fi
export WB_INSTALL_NODE="$NODE" WB_INSTALL_DEST="$DEST" WB_INSTALL_LABEL="$LABEL"
"$NODE" <<'JS'
const fs=require('fs'),os=require('os'),path=require('path');
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const {WB_INSTALL_NODE:n,WB_INSTALL_DEST:d,WB_INSTALL_LABEL:l}=process.env;
const xml=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${l}</string>
<key>ProgramArguments</key><array><string>${escape(n)}</string><string>${escape(path.join(d,'checkin.cjs'))}</string></array>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>3600</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${escape(path.join(d,'scheduler.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(d,'scheduler-error.log'))}</string>
</dict></plist>`;
fs.writeFileSync(path.join(os.homedir(),'Library/LaunchAgents',l+'.plist'),xml,{mode:0o600});
JS
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
print "Installed: checks now and every hour while your account is logged in."
print "Log: $DEST/checkin.log"
