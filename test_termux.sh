#!/bin/sh
am startservice --user 0 -n com.termux/com.termux.app.RunCommandService \
  -a com.termux.RUN_COMMAND \
  --es com.termux.RUN_COMMAND_PATH "/data/data/com.termux/files/usr/bin/bash" \
  --esa com.termux.RUN_COMMAND_ARGUMENTS "-c,pkg install openjdk-17 -y" \
  --es com.termux.RUN_COMMAND_WORKDIR "/data/data/com.termux/files/home" \
  --ez com.termux.RUN_COMMAND_BACKGROUND true
