#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OPPO应用商店 - 已上架应用更新脚本"""

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
UPDATE_DESC = "v1.3.12 更新：1.Skill系统支持动态加载工具和参考文档 2.数据目录前缀可自定义 3.DeepSeek思考与工具调用可共存 4.UI优化与Bug修复"

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
    """第3步：提交版本发布（已上架应用更新，只传必要的字段）"""
    print("\n📝 提交版本发布...")
    ts = str(int(time.time()))

    # 已上架应用更新：传标识+新版本信息+必要的分类ID
    # 其他资料（截图/隐私政策等）沿用已有数据
    all_params = {
        # 公共参数
        "access_token": token,
        "timestamp": ts,
        # 业务参数
        "pkg_name": PACKAGE_NAME,
        "version_code": str(VERSION_CODE),
        "apk_url": json.dumps([{"url": apk_url, "md5": apk_md5, "cpu_code": 0}], separators=(',', ':')),
        "app_name": "小蓝AI盒子",
        "update_desc": UPDATE_DESC,
        "summary": "移动端Agent",
        "privacy_source_url": "http://www.xiaolanbox.com/right/privacy-policy.html",
        "detail_desc": """小蓝AI盒子是一款主打隐私保护、全平台兼容、功能丰富的轻量化AI助手应用，核心数据存储在用户本地设备，大幅降低数据泄露风险。应用集成国内主流AI服务平台，内置智能体系统、本地知识库、多模态交互等核心功能，满足不同场景下的AI使用需求。

为什么选择小蓝AI盒子？
在AI产品越来越普及的今天，小蓝AI盒子为国内用户量身打造了四大核心优势，是您的AI工具选择：

隐私安全，数据主权归用户所有
所有聊天记录、API密钥、知识库文档存储在本地设备，不会上传数据到第三方服务器
API请求直接从本地发起，无中转环节，降低数据泄露风险，满足企业与个人敏感场景的使用需求
“支持免注册、免登录使用”下载即可用，用户信息收集少

缓存优化技术，帮助降低使用成本
研发的动态上下文缓存机制，对支持隐式缓存的大模型自动调节发送的消息数量，在不影响对话连贯性的前提下可降低部分成本消耗，长期使用可节省API费用
缓存命中率实时展示，用量透明可控，成本花在刀刃上
搭配豆包Session缓存、智能上下文截断等优化特性，在保障对话质量的前提下实现成本控制

深度适配国内AI生态，使用体验贴合本土用户
支持通义千问、DeepSeek、豆包、智谱清言、MiniMax、Kimi等主流AI平台的轻量客户端
深度适配各平台专属特性：千问/DeepSeek深度思考、豆包Session缓存/联网搜索、视觉模型对接等，不需要在多个平台APP之间来回切换
兼容国内网络环境，API请求速度快、稳定性高，无需特殊网络配置即可流畅使用
支持自定义添加开源模型、私有部署模型，灵活适配使用场景

全场景生产力特性，满足多样化使用需求
内置本地知识库功能，支持多种格式文档上传，本地向量检索实现智能文档问答，文档数据本地化存储，降低企业内部资料泄露风险
支持自定义选择历史消息作为对话上下文，精准控制AI参考的内容范围，避免无关信息干扰，或需要历史信息支持，长对话处理效率更高，适合专业场景的精细化对话需求""",
        "second_category_id": "8192",   # 人工智能
        "third_category_id": "8199",     # 融合AI
    }

    # 签名：所有参数（不含api_sign自身）按key排序后HmacSHA256
    api_sign = gen_sign(all_params, CLIENT_SECRET)

    # URL公共参数
    pub_params = {"access_token": token, "timestamp": ts, "api_sign": api_sign}

    # POST body（只含业务参数）
    body = {k: v for k, v in all_params.items() if k not in ("access_token", "timestamp")}

    print(f"   请求参数: {json.dumps(all_params, ensure_ascii=False)[:300]}")
    print(f"   api_sign: {api_sign[:32]}...")

    resp = requests.post(
        f"{BASE_URL}/resource/v1/app/upd",
        params=pub_params,
        data=body,
        timeout=60
    )

    result = resp.json()
    print(f"   响应: {json.dumps(result, ensure_ascii=False, indent=2)}")

    if result.get("errno") == 0:
        print(f"✅ 提交成功！等待OPPO审核。")
    else:
        print(f"❌ 提交失败")

    return result


if __name__ == "__main__":
    print("=" * 50)
    print("  OPPO 应用商店 - 已上架应用更新")
    print("=" * 50)

    token = get_token()
    if not token:
        exit(1)

    # 已有上传好的APK信息，直接提交
    apk_url = "http://storedl1.nearme.com.cn/apk/tmp_apk/202606/29/63d376039b57bf97f896836691f66138.apk"
    apk_md5 = "6abfafd9478104d3bd53218705e1831f"
    submit_update(token, apk_url, apk_md5)