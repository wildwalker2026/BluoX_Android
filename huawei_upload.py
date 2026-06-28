#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""华为 AppGallery Connect 发布工具 (Service Account 方式)"""

import os
import time
import json
import base64
import hashlib
import requests
from Crypto.PublicKey import RSA
from Crypto.Signature import pss
from Crypto.Hash import SHA256

# ===== 配置 =====
CRED_PATH = "/storage/emulated/0/AideProjects/BluoX/huawei_private.json"
APP_ID = "117238707"
APK_PATH = "/storage/emulated/0/AideProjects/BluoX/app/build/outputs/apk/release/protected/app-release_signed.apk"

API_BASE = "https://connect-api.cloud.huawei.com/api/publish/v2"

UPDATE_DESC = "v1.3.10 更新内容：专家模式新增Termux桥接独立开关、网格布局优化、异步命令取消机制、UI统一2列网格卡片、修复AI消息空白气泡、修复工具调用400错误、优化Termux桥接稳定性、移除部分广告功能"


def base64_url_encode(data):
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def create_jwt():
    with open(CRED_PATH) as f:
        content = f.read()
    json_start = content.index("{")
    json_end = content.index("}") + 1
    cred = json.loads(content[json_start:json_end])

    key = RSA.importKey(cred["private_key"])
    iat = int(time.time())
    exp = iat + 3600

    header = json.dumps({"alg": "PS256", "kid": cred["key_id"], "typ": "JWT"}, separators=(",", ":"))
    payload = json.dumps({
        "aud": "https://oauth-login.cloud.huawei.com/oauth2/v3/token",
        "iss": cred["sub_account"],
        "exp": exp,
        "iat": iat,
    }, separators=(",", ":"))

    b64h = base64_url_encode(header.encode("utf-8"))
    b64p = base64_url_encode(payload.encode("utf-8"))
    msg = f"{b64h}.{b64p}".encode("utf-8")
    h = SHA256.new(msg)
    sig = pss.new(key).sign(h)
    b64s = base64_url_encode(sig)

    return f"{b64h}.{b64p}.{b64s}"


def get_jwt_token():
    print("\n🔑 生成 JWT 令牌...")
    jwt = create_jwt()
    print(f"✅ JWT 生成成功")
    return jwt


def get_file_sha256(file_path):
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def get_upload_url(jwt):
    file_size = os.path.getsize(APK_PATH)
    file_sha256 = get_file_sha256(APK_PATH)
    file_name = "app-release_signed.apk"

    print(f"\n📍 获取上传地址...")
    print(f"   文件: {file_name}")
    print(f"   大小: {file_size / 1024 / 1024:.1f} MB")

    params = {
        "appId": APP_ID,
        "fileName": file_name,
        "sha256": file_sha256,
        "contentLength": file_size,
        "releaseType": 1,
    }
    headers = {"Authorization": f"Bearer {jwt}"}

    resp = requests.get(f"{API_BASE}/upload-url/for-obs", params=params, headers=headers, timeout=30)
    result = resp.json()

    ret = result.get("ret", {})
    if ret.get("code") != 0:
        print(f"❌ 获取上传地址失败: {result}")
        return None, None, None

    url_info = result.get("urlInfo", {})
    upload_url = url_info.get("url")
    upload_headers = url_info.get("headers", {})
    object_id = url_info.get("objectId")

    print(f"✅ 获取成功，objectId: {object_id}")
    return upload_url, upload_headers, object_id


def upload_file(upload_url, upload_headers):
    print(f"\n📦 上传 APK...")
    with open(APK_PATH, "rb") as f:
        resp = requests.put(upload_url, data=f, headers=upload_headers, timeout=600)

    if resp.status_code == 200:
        print(f"✅ 上传成功")
        return True
    else:
        print(f"❌ 上传失败: HTTP {resp.status_code} {resp.text[:200]}")
        return False


def bind_apk(jwt, object_id):
    """绑定APK文件到应用"""
    print(f"\n🔗 绑定APK文件到应用...")

    headers = {
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
    }

    body = {
        "fileType": 5,
        "files": {
            "fileName": "app-release_signed.apk",
            "fileDestUrl": object_id,
        }
    }

    resp = requests.put(
        f"{API_BASE}/app-file-info",
        params={"appId": APP_ID},
        headers=headers,
        json=body,
        timeout=30,
    )

    result = resp.json()
    ret = result.get("ret", {})
    print(f"   响应: {result}")
    if ret.get("code") == 0:
        print(f"✅ APK绑定成功")
        return True
    else:
        print(f"❌ APK绑定失败: {result}")
        return False


def submit_review(jwt):
    print(f"\n📤 提交发布...")

    headers = {
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
    }

    resp = requests.post(
        f"{API_BASE}/app-submit",
        params={"appId": APP_ID},
        headers=headers,
        json={},
        timeout=60,
    )

    result = resp.json()
    ret = result.get("ret", {})
    print(f"   响应: {result}")
    if ret.get("code") == 0:
        print(f"✅ 提交成功！等待华为审核。")
    else:
        print(f"❌ 提交失败: {result}")

    return result


if __name__ == "__main__":
    print("=" * 50)
    print("  华为 AppGallery APK 发布")
    print("=" * 50)

    jwt = get_jwt_token()

    upload_url, upload_headers, object_id = get_upload_url(jwt)
    if not upload_url:
        exit(1)

    if not upload_file(upload_url, upload_headers):
        exit(1)

    # 绑定APK到应用
    if not bind_apk(jwt, object_id):
        exit(1)

    print("\n⏳ 等待2分钟，让华为异步解析APK...")
    time.sleep(120)

    submit_review(jwt)
