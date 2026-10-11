#!/bin/sh
# Converts the gameNN.svg files that tools/report.js wrote into PNGs using headless Chrome.
# Usage: sh tools/render-png.sh <results folder>
dir="$1"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
while read -r name w h; do
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size="$w,$h" --screenshot="$dir/$name.png" "file://$(cd "$dir" && pwd)/$name.svg" >/dev/null 2>&1
done < "$dir/sizes.txt"
ls "$dir"/*.png | wc -l
