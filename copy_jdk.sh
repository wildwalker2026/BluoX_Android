#!/bin/sh
echo "正在从AIDE复制JDK..."
cp -r /data/user/0/aidepro.top/files/framework/jdk /storage/emulated/0/jdk/
if [ $? -eq 0 ]; then
  echo "复制成功！"
  ls -lh /storage/emulated/0/jdk/
else
  echo "复制失败，尝试tar打包..."
  cd /data/user/0/aidepro.top/files/framework
  tar czf /storage/emulated/0/jdk/openjdk.tar.gz jdk/
  if [ $? -eq 0 ]; then
    echo "tar打包成功！"
    ls -lh /storage/emulated/0/jdk/
  else
    echo "tar也失败了"
  fi
fi
