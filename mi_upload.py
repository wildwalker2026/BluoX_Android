#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小米应用商店发布工具"""

import os
import hashlib
import json
import requests
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5

# ===== 配置 =====
USER_NAME = "1121636565@qq.com"
PRIVATE_KEY = "mh1hubimeissmf58idf553ntevnpc3xjyp6dlc4fby0f55k24q"
PACKAGE_NAME = "com.cnaichat.app"
APK_PATH = "/storage/emulated/0/AideProjects/BluoX/app/build/outputs/apk/release/protected/app-release_signed.apk"
CER_PATH = "/storage/emulated/0/AideProjects/BluoX/dev.api.public.cer"

DOMAIN = "http://api.developer.xiaomi.com/devupload"
PUSH = DOMAIN + "/dev/push"
QUERY = DOMAIN + "/dev/query"

KEY_SIZE = 1024
GROUP_SIZE = 128
ENCRYPT_GROUP_SIZE = GROUP_SIZE - 11

UPDATE_DESC = """v1.3.9 更新内容：
1. 选中文本高亮：选中任意文本时自动高亮聊天中其他位置的相同文本
2. 生成完成提示音：AI 回复完成后播放提示音
3. 横屏模式优化：平板横屏启动不再闪烁
4. 消息气泡改为扁平化设计风格
5. 流式输出滚动优化，响应更快
6. 修复工具调用详情复制按钮无效
7. 修复部分场景下的死循环问题
8. 移除广告相关功能"""


def array_copy(src, src_pos, dest, dest_pos, length):
    for i in range(length):
        dest[i + dest_pos] = src[i + src_pos]


def get_public_key_pem():
    """从证书中提取公钥 PEM（用 openssl 命令行）"""
    import subprocess
    result = subprocess.run(
        ["openssl", "x509", "-in", CER_PATH, "-pubkey", "-noout"],
        capture_output=True, text=True
    )
    return result.stdout


def encrypt_by_public_key(param):
    """RSA 公钥加密"""
    pub_pem = get_public_key_pem()
    cipher_public = PKCS1_v1_5.new(RSA.importKey(pub_pem))

    text_bytes = param.encode('UTF-8')
    text_bytes_len = len(text_bytes)
    idx = 0
    encrypt_bytes = bytearray()
    while idx < text_bytes_len:
        remain = text_bytes_len - idx
        segsize = min(ENCRYPT_GROUP_SIZE, remain)
        segment = bytearray(segsize)
        array_copy(text_bytes, idx, segment, 0, segsize)
        encrypt_bytes = encrypt_bytes + cipher_public.encrypt(segment)
        idx += segsize
    return encrypt_bytes.hex()


def get_file_md5(file_path):
    hasher = hashlib.md5()
    with open(file_path, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def query_app():
    """查询应用信息"""
    request_data = {
        "packageName": PACKAGE_NAME,
        "userName": USER_NAME
    }
    sig = {
        "sig": [
            {
                "name": "RequestData",
                "hash": hashlib.md5(json.dumps(request_data).encode()).hexdigest()
            }
        ],
        "password": PRIVATE_KEY
    }
    encrypted_sig = encrypt_by_public_key(json.dumps(sig))
    resp = requests.post(QUERY, data={"RequestData": json.dumps(request_data), "SIG": encrypted_sig})
    return resp.text


def push_update():
    """更新应用 (synchroType=1)"""
    print(f"📦 APK: {APK_PATH}")
    print(f"   大小: {os.path.getsize(APK_PATH) / 1024 / 1024:.1f} MB")

    app_detail = {
        "appName": "小蓝AI盒子",
        "packageName": PACKAGE_NAME,
        "updateDesc": UPDATE_DESC,
    }

    request_data = {
        "userName": USER_NAME,
        "appInfo": json.dumps(app_detail),
        "synchroType": 1
    }

    sig_json = {
        "sig": [],
        "password": PRIVATE_KEY
    }

    sig_json["sig"].append({
        "name": "RequestData",
        "hash": hashlib.md5(json.dumps(request_data).encode('utf-8')).hexdigest()
    })

    apk_md5 = get_file_md5(APK_PATH)
    sig_json["sig"].append({
        "name": "apk",
        "hash": apk_md5
    })

    encrypted_sig = encrypt_by_public_key(json.dumps(sig_json))

    files = {
        "apk": (os.path.basename(APK_PATH), open(APK_PATH, "rb")),
    }

    print("   正在传输...")
    resp = requests.post(
        PUSH,
        data={"RequestData": json.dumps(request_data), "SIG": encrypted_sig},
        files=files,
        timeout=600
    )
    return resp.text


if __name__ == "__main__":
    print("=" * 50)
    print("  小米应用商店 APK 发布")
    print("=" * 50)

    # 先查询应用状态
    print("\n🔍 查询应用信息...")
    info = query_app()
    print(f"   {info[:500]}")

    # 推送更新
    print("\n📤 推送更新...")
    result = push_update()
    print(f"\n结果: {result}")