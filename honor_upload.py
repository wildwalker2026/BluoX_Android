#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""荣耀应用市场发布工具"""

import os
import hashlib
import requests

# ===== 配置 =====
CLIENT_ID = "8e6bb54768e7431e8643d3baa48b6355"
CLIENT_SECRET = "2l61LeKUoDrYX5OYTqBF4jjb99ebr5D7"
PACKAGE_NAME = "com.cnaichat.app"
APK_PATH = "/storage/emulated/0/AideProjects/BluoX/app/build/outputs/apk/release/protected/app-release_signed.apk"

IAM_URL = "https://iam.developer.honor.com/auth/token"
API_BASE = "https://appmarket-openapi-drcn.cloud.honor.com/openapi/v1/publish"

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
    print(f"✅ Token 获取成功，有效期 {result.get('expires_in')}s")
    return token


def get_app_id(token):
    """根据包名查询 APPID"""
    print(f"\n🔍 查询 APPID (包名: {PACKAGE_NAME})...")
    resp = requests.get(
        f"{API_BASE}/get-app-id",
        params={"pkgName": PACKAGE_NAME},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    result = resp.json()
    if result.get("code") != 0:
        print(f"❌ 查询失败: {result}")
        return None
    data = result.get("data", [])
    if not data:
        print("❌ 未找到应用")
        return None
    app_id = data[0].get("appId")
    print(f"✅ APPID: {app_id}")
    return app_id


def get_file_sha256(file_path):
    """计算文件 SHA256"""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def get_upload_url(token, app_id, file_name, file_size, file_sha256):
    """获取文件上传路径"""
    print("\n📍 获取上传地址...")
    resp = requests.post(
        f"{API_BASE}/get-file-upload-url",
        params={"appId": app_id},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=[{
            "fileName": file_name,
            "fileType": 100,
            "fileSize": file_size,
            "fileSha256": file_sha256,
        }],
        timeout=30,
    )
    result = resp.json()
    if result.get("code") != 0:
        print(f"❌ 获取上传地址失败: {result}")
        return None, None
    data = result.get("data", [])
    if not data:
        print(f"❌ 未返回上传地址: {result}")
        return None, None
    upload_url = data[0].get("uploadUrl")
    object_id = data[0].get("objectId")
    print(f"✅ 上传地址获取成功，objectId: {object_id}")
    return upload_url, object_id


def upload_file(token, app_id, object_id, apk_path):
    """上传文件"""
    print(f"\n📦 上传 APK ({os.path.getsize(apk_path) / 1024 / 1024:.1f} MB)...")
    with open(apk_path, "rb") as f:
        resp = requests.post(
            f"{API_BASE}/file-upload",
            params={"appId": app_id, "objectId": object_id},
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("app-release_signed.apk", f, "application/vnd.android.package-archive")},
            timeout=600,
        )
    result = resp.json()
    if result.get("code") != 0:
        print(f"❌ 上传失败: {result}")
        return False
    print(f"✅ 上传成功")
    return True


def update_file_info(token, app_id, object_id, file_name):
    """更新应用文件信息"""
    print("\n📝 更新应用文件信息...")
    resp = requests.post(
        f"{API_BASE}/update-file-info",
        params={"appId": app_id},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "fileType": 100,
            "objectId": object_id,
            "fileName": file_name,
        },
        timeout=30,
    )
    result = resp.json()
    print(f"   响应: {result}")
    return result.get("code") == 0


def update_language_info(token, app_id):
    """更新多语言信息（新版特性）"""
    print("\n📝 更新新版特性...")
    resp = requests.post(
        f"{API_BASE}/update-language-info",
        params={"appId": app_id},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "languageInfoList": [{
                "languageId": "zh-CN",
                "newFeature": UPDATE_DESC,
            }],
            "setAll": 0,
        },
        timeout=30,
    )
    result = resp.json()
    print(f"   响应: {result}")
    return result.get("code") == 0


def submit_review(token, app_id):
    """提交审核"""
    print("\n📤 提交审核...")
    resp = requests.post(
        f"{API_BASE}/submit-review",
        params={"appId": app_id},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "releaseType": 1,
            "forceUpdate": 0,
        },
        timeout=30,
    )
    result = resp.json()
    print(f"   响应: {result}")
    return result.get("code") == 0


if __name__ == "__main__":
    print("=" * 50)
    print("  荣耀应用市场 APK 发布")
    print("=" * 50)

    token = get_access_token()
    if not token:
        exit(1)

    app_id = get_app_id(token)
    if not app_id:
        exit(1)

    file_name = "app-release_signed.apk"
    file_size = os.path.getsize(APK_PATH)
    file_sha256 = get_file_sha256(APK_PATH)
    print(f"\n📄 文件: {file_name}")
    print(f"   大小: {file_size} bytes ({file_size / 1024 / 1024:.1f} MB)")
    print(f"   SHA256: {file_sha256}")

    upload_url, object_id = get_upload_url(token, app_id, file_name, file_size, file_sha256)
    if not upload_url:
        exit(1)

    if not upload_file(token, app_id, object_id, APK_PATH):
        exit(1)

    update_file_info(token, app_id, object_id, file_name)
    update_language_info(token, app_id)
    submit_review(token, app_id)

    print("\n✅ 完成！等待荣耀审核。")
