#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OPPO应用商店更新脚本"""

import hmac
import hashlib
import json
import os
import time
import requests

# ===== 配置 =====
CLIENT_ID = "1660667836114196645"
CLIENT_SECRET = "9cf1590af7ca4abcb4b8f3942d5f475f55d258c782f90ffe7f9750e870110cfb"
PACKAGE_NAME = "com.cnaichat.app"
APK_PATH = "/storage/emulated/0/AideProjects/BluoX/app/build/outputs/apk/release/protected/app-release_signed.apk"
VERSION_CODE = 29
VERSION_NAME = "1.3.12"
UPDATE_DESC = """v1.3.9 更新内容：
1. 选中文本高亮：选中任意文本时自动高亮聊天中其他位置的相同文本
2. 生成完成提示音：AI 回复完成后播放提示音
3. 横屏模式优化：平板横屏启动不再闪烁
4. 消息气泡改为扁平化设计风格
5. 流式输出滚动优化，响应更快
6. 修复工具调用详情复制按钮无效
7. 修复部分场景下的死循环问题
8. 移除广告相关功能"""

BASE_URL = "https://oop-openapi-cn.heytapmobi.com"


def gen_sign(params: dict, secret: str) -> str:
    """HmacSHA256 签名"""
    sorted_keys = sorted(params.keys())
    raw = "&".join(f"{k}={params[k]}" for k in sorted_keys if params[k] is not None)
    h = hmac.new(secret.encode(), raw.encode(), hashlib.sha256)
    return h.hexdigest()


def get_token():
    """第1步：获取 Access Token"""
    print("🔑 获取 Access Token...")
    url = f"{BASE_URL}/developer/v1/token"
    resp = requests.get(url, params={
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET
    })
    data = resp.json()
    if data.get("errno") != 0:
        print(f"❌ 获取token失败: {data}")
        return None
    token = data["data"]["access_token"]
    print(f"   Token: {token[:20]}...")
    return token


def get_upload_url(token):
    """第2a步：获取上传地址"""
    print("\n📤 获取上传地址...")
    ts = str(int(time.time()))
    params = {
        "access_token": token,
        "timestamp": ts,
        "api_sign": gen_sign({"access_token": token, "timestamp": ts}, CLIENT_SECRET)
    }
    resp = requests.get(f"{BASE_URL}/resource/v1/upload/get-upload-url", params=params)
    data = resp.json()
    if data.get("errno") != 0:
        print(f"❌ 获取上传地址失败: {data}")
        return None, None
    upload_url = data["data"]["upload_url"]
    sign = data["data"]["sign"]
    print(f"   upload_url: {upload_url[:60]}...")
    print(f"   sign: {sign[:16]}...")
    return upload_url, sign


def upload_apk(token, upload_url, sign):
    """第2b步：上传APK"""
    print(f"\n📦 上传APK ({os.path.getsize(APK_PATH) / 1024 / 1024:.1f} MB)...")
    with open(APK_PATH, "rb") as f:
        files = {"file": ("app-release.apk", f, "application/vnd.android.package-archive")}
        data = {"type": "apk", "sign": sign}
        resp = requests.post(upload_url, data=data, files=files, timeout=600)

    result = resp.json()
    if result.get("errno") != 0:
        print(f"❌ 上传APK失败: {result}")
        return None

    apk_url = result["data"]["url"]
    apk_md5 = result["data"]["md5"]
    print(f"✅ 上传成功")
    print(f"   APK URL: {apk_url[:60]}...")
    print(f"   MD5: {apk_md5}")
    return apk_url, apk_md5


def submit_update(token, apk_url, apk_md5):
    """第3步：提交版本发布"""
    print("\n📝 提交版本发布...")
    ts = str(int(time.time()))

    body = {
        "pkg_name": PACKAGE_NAME,
        "version_code": str(VERSION_CODE),
        "version_name": VERSION_NAME,
        "apk_url": json.dumps([{"url": apk_url, "md5": apk_md5, "cpu_code": 0}]),
        "update_desc": UPDATE_DESC,
        "app_name": "小蓝AI盒子",
    }

    body["sign"] = gen_sign(body, CLIENT_SECRET)

    params = {
        "access_token": token,
        "timestamp": ts,
        "api_sign": gen_sign({"access_token": token, "timestamp": ts}, CLIENT_SECRET)
    }

    resp = requests.post(
        f"{BASE_URL}/resource/v1/app/upd",
        params=params,
        data=body,
        timeout=60
    )

    result = resp.json()
    print(f"   响应: {result}")

    if result.get("errno") == 0:
        print(f"✅ 提交成功！等待OPPO审核。")
    else:
        print(f"❌ 提交失败")

    return result


if __name__ == "__main__":
    print("=" * 50)
    print("  OPPO 应用商店 APK 发布")
    print("=" * 50)

    token = get_token()
    if not token:
        exit(1)

    upload_url, sign = get_upload_url(token)
    if not upload_url:
        exit(1)

    result = upload_apk(token, upload_url, sign)
    if not result:
        exit(1)

    apk_url, apk_md5 = result
    submit_update(token, apk_url, apk_md5)
