#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""vivo 应用商店发布工具"""

import os
import time
import hmac
import hashlib
import requests

# ===== 配置 =====
ACCESS_KEY = "20260627afdxsmc5"
ACCESS_SECRET = "4ddde5c0f0db1e848d680f00eff72893"
PACKAGE_NAME = "com.cnaichat.app"
APK_PATH = "/storage/emulated/0/AideProjects/BluoX/app/build/outputs/apk/release/protected/app-release_signed.apk"
BASE_URL = "https://developer-api.vivo.com.cn/router/rest"

UPDATE_DESC = "v1.3.9 更新内容：选中文本高亮、生成完成提示音、横屏模式优化、UI扁平化设计、流式输出优化、修复若干bug、移除部分广告功能"


def build_sign_str(params):
    sorted_keys = sorted(params.keys())
    return "&".join(f"{k}={params[k]}" for k in sorted_keys)


def hmac_sha256(data, key):
    return hmac.new(key.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).hexdigest()


def make_request(method, business_params=None, files=None):
    params = {
        "method": method,
        "access_key": ACCESS_KEY,
        "timestamp": str(int(time.time() * 1000)),
        "format": "json",
        "v": "1.0",
        "sign_method": "HMAC-SHA256",
        "target_app_key": "developer",
    }
    if business_params:
        params.update(business_params)

    # 签名（文件上传时签名不含file参数）
    sign_str = build_sign_str(params)
    sign = hmac_sha256(sign_str, ACCESS_SECRET)
    params["sign"] = sign

    if files:
        resp = requests.post(BASE_URL, data=params, files=files, timeout=600)
    else:
        resp = requests.post(BASE_URL, data=params, timeout=60)

    return resp.json()


def get_file_md5(file_path):
    hasher = hashlib.md5()
    with open(file_path, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def query_app():
    print("\n🔍 查询应用详情...")
    result = make_request("app.query.details", {"packageName": PACKAGE_NAME})
    if result.get("code") == 0:
        data = result["data"]
        print(f"   应用名: {data.get('cnName')}")
        print(f"   当前版本: v{data.get('versionName')} (code: {data.get('versionCode')})")
    else:
        print(f"   查询失败: {result}")
    return result


def upload_apk():
    """上传APK，返回流水号"""
    print(f"\n📦 上传 APK: {APK_PATH}")
    size_mb = os.path.getsize(APK_PATH) / 1024 / 1024
    print(f"   大小: {size_mb:.1f} MB")

    file_md5 = get_file_md5(APK_PATH)
    print(f"   MD5: {file_md5}")

    with open(APK_PATH, "rb") as f:
        files = {"file": ("app-release_signed.apk", f, "application/vnd.android.package-archive")}
        print("   正在传输...")
        result = make_request("app.upload.apk.app", {
            "packageName": PACKAGE_NAME,
            "fileMd5": file_md5,
        }, files=files)

    print(f"   响应: {result}")
    if result.get("code") == 0 and result.get("subCode", "0") == "0":
        data = result.get("data", {})
        serialnumber = data.get("serialnumber")
        print(f"✅ 上传成功，流水号: {serialnumber}")
        return serialnumber
    else:
        print(f"❌ 上传失败: {result}")
        return None


def update_app(serialnumber, file_md5):
    """提交更新"""
    print(f"\n📝 提交更新...")

    result = make_request("app.sync.update.app", {
        "packageName": PACKAGE_NAME,
        "versionCode": 26,
        "apk": serialnumber,
        "fileMd5": file_md5,
        "onlineType": 1,
        "updateDesc": UPDATE_DESC,
        "compatibleDevice": 2,
    })

    print(f"   响应: {result}")
    if result.get("code") == 0 and result.get("subCode", "0") == "0":
        print(f"✅ 提交成功！等待 vivo 审核。")
    else:
        print(f"❌ 提交失败: {result}")

    return result


if __name__ == "__main__":
    print("=" * 50)
    print("  vivo 应用商店 APK 发布")
    print("=" * 50)

    query_app()

    serialnumber = upload_apk()
    if serialnumber:
        file_md5 = get_file_md5(APK_PATH)
        update_app(serialnumber, file_md5)