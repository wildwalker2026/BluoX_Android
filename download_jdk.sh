#!/bin/sh
# 尝试多个镜像源下载 JDK
echo "尝试镜像1: ghproxy"
wget -O /storage/emulated/0/jdk/openjdk.tar.gz "https://ghproxy.com/https://github.com/itsaky/openjdk-17-android/releases/download/v17.3/android-java-17-aarch64.tar.gz"
if [ $? -eq 0 ] && [ -s /storage/emulated/0/jdk/openjdk.tar.gz ]; then
  echo "下载成功！"
  exit 0
fi

echo "尝试镜像2: gh-proxy"
wget -O /storage/emulated/0/jdk/openjdk.tar.gz "https://gh-proxy.com/https://github.com/itsaky/openjdk-17-android/releases/download/v17.3/android-java-17-aarch64.tar.gz"
if [ $? -eq 0 ] && [ -s /storage/emulated/0/jdk/openjdk.tar.gz ]; then
  echo "下载成功！"
  exit 0
fi

echo "尝试镜像3: mirror.ghproxy"
wget -O /storage/emulated/0/jdk/openjdk.tar.gz "https://mirror.ghproxy.com/https://github.com/itsaky/openjdk-17-android/releases/download/v17.3/android-java-17-aarch64.tar.gz"
if [ $? -eq 0 ] && [ -s /storage/emulated/0/jdk/openjdk.tar.gz ]; then
  echo "下载成功！"
  exit 0
fi

echo "所有镜像都失败了"
