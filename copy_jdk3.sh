#!/bin/sh
echo "正在复制JDK到CNAI Chat目录..."
cp -r /data/user/0/aidepro.top/files/framework/jdk /data/data/com.cnaichat.app/files/terminal/home/jdk
if [ $? -eq 0 ]; then
  chmod -R 755 /data/data/com.cnaichat.app/files/terminal/home/jdk
  echo "复制成功！正在测试..."
  /data/data/com.cnaichat.app/files/terminal/home/jdk/bin/java -version
else
  echo "复制失败"
fi
