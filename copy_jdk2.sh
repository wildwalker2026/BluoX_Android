#!/bin/sh
echo "正在复制JDK到/data/local/tmp/..."
cp -r /data/user/0/aidepro.top/files/framework/jdk /data/local/tmp/jdk
if [ $? -eq 0 ]; then
  chmod -R 755 /data/local/tmp/jdk
  echo "复制成功！"
  /data/local/tmp/jdk/bin/java -version
else
  echo "复制失败"
fi
