#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""华为 AppGallery Connect 发布工具"""

import os
import hashlib
import requests

# ===== 配置 =====
CLIENT_ID = "1982991770547443904"
CLIENT_SECRET = "FF600114F58F3F3989E4A912014A0B31B2161B60E408175F4D67A9B435D78C09"
APP_ID = "117238707"
PACKAGE_NAME = "com.cnaichat.app"
APK_PATH = "/storage/emulated/0/AideProjects/BluoX/app/build/outputs/apk/release/protected/app-release_signed.apk"

IAM_URL = "https://connect-api.cloud.huawei.com/api/oauth2/v1/token"
API_BASE = "https://connect-api.cloud.huawei.com/api/publish/v2"

UPDATE_DESC = "v1.3.9 更新内容：选中文本高亮、生成完成提示音、横屏模式优化、UI扁平化设计、流式输出优化、修复若干bug、移除部分广告功能"


def get_access_token():
    """获取 Access Token"""
    print("\n🔑 获取 Access Token...")
    resp = requests.post(IAM_URL, data={
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }, timeout=30)
    result = resp.json()
    token = result.get("access_token")
    if not token:
        print(f"❌ 获取Token失败: {result}")
        return None
    print(f"✅ Token 获取成功")
    return token


def get_file_sha256(file_path):
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def upload_apk(token):
    """上传APK"""
    print(f"\n📦 上传 APK ({os.path.getsize(APK_PATH) / 1024 / 1024:.1f} MB)...")

    file_sha256 = get_file_sha256(APK_PATH)
    headers = {
        "Authorization": f"Bearer {token}",
        "client_id": CLIENT_ID,
    }

    with open(APK_PATH, "rb") as f:
        resp = requests.post(
            f"{API_BASE}/apps/{APP_ID}/apks/upload",
            headers=headers,
            files={"file": ("app-release_signed.apk", f, "application/vnd.android.package-archive")},
            timeout=600,
        )

    result = resp.json()
    print(f"   响应: {result}")
    if result.get("resultCode") != 0:
        print(f"❌ 上传失败: {result}")
        return None

    upload_result = result.get("result", {})
    print(f"✅ 上传成功")
    return upload_result


def submit_review(token, apk_info):
    """提交审核"""
    print("\n📤 提交审核...")

    headers = {
        "Authorization": f"Bearer {token}",
        "client_id": CLIENT_ID,
        "Content-Type": "application/json",
    }

    body = {
        "appId": APP_ID,
        "apkListing": {
            "releaseType": "1",
            "releaseTime": "",
            "newFeatures": UPDATE_DESC,
        },
        "apkFile": {
            "fileType": 5,
            "files": [{
                "fileName": "app-release_signed.apk",
                "fileSize": os.path.getsize(APK_PATH),
                "fileSha256": get_file_sha256(APK_PATH),
            }],
        },
    }

    resp = requests.post(
        f"{API_BASE}/apps/{APP_ID}/submit-for-review",
        headers=headers,
        json=body,
        timeout=60,
    )

    result = resp.json()
    print(f"   响应: {result}")
    if result.get("resultCode") == 0:
        print(f"✅ 提交成功！等待华为审核。")
    else:
        print(f"❌ 提交失败: {result}")

    return result


if __name__ == "__main__":
    print("=" * 50)
    print("  华为 AppGallery APK 发布")
    print("=" * 50)

    token = get_access_token()
    if not token:
        exit(1)

    apk_info = upload_apk(token)
    if apk_info:
        submit_review(token, apk_info)
