# 📦 小蓝AI盒子 / BluoX AI

> **一台手机，即可 Vibe Coding。**
> 隐私优先的多平台 AI 助手，支持工具调用、终端集成、跨设备协同。

> ⚠️ **Note:** Currently supports **Simplified Chinese** only.

---

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🤖 **多 AI 平台聚合** | 支持通义千问、DeepSeek、豆包、智谱清言、MiniMax、Kimi 等主流大模型 |
| 🛠️ **AI 工具调用** | 文件读写、代码编辑、网页搜索，AI 自主完成复杂任务，敏感操作弹卡片确认 |
| 💻 **终端集成** | 搭配 Termux，AI 可在手机上执行命令、编译项目、安装 APK |
| 🔒 **隐私安全** | 所有数据 100% 本地存储，零上传，对话只属于你自己 |
| 📚 **本地知识库** | 上传文档构建专属知识库，离线检索，真正为用户所有 |
| 📱 **跨设备协同** | 手机连接电脑，AI 直接帮你编辑文件、执行命令、传输文件 |
| 🎨 **多 Agent** | 创建多个 AI 角色，独立配置模型、提示词和工具 |
| 🖼️ **图片识别** | 选图发给 AI，支持视觉理解 |
| 🌙 **主题系统** | 亮色/暗色自动切换，多种背景主题 |

---

## 📥 下载安装

### Android
- **最低要求**：Android 8.0 (API 26)
- **下载地址**：[最新版本 Release](../../releases/latest)

### Windows
- 搜索 **BluoX_PC** 获取 Windows 客户端

---

## 🚀 快速开始

1. **下载并安装** APK
2. **配置 API Key**：打开应用 → 设置 → 选择 AI 平台 → 填入 API Key
3. **开始对话**：直接聊天，或让 AI 帮你处理文件、搜索网页
4. **进阶**（可选）：
   - 安装 **Termux** 解锁终端能力
   - 连接电脑解锁跨设备协同

---

## 🔧 技术栈

- **前端**：HTML/CSS/JavaScript (WebView)
- **原生层**：Java (Android)
- **终端**：Termux RUN_COMMAND
- **存储**：IndexedDB + SQLite (全本地)
- **无后端依赖**：直连 AI 平台官方 API

---

## 📋 更新日志

### v1.3.8
- 🆕 Termux 支持：AI 可在终端执行命令、编译项目
- 🆕 生成期间屏幕常亮（Wake Lock）
- 🆕 Git 只读命令白名单，免确认
- 🆕 确认卡片全新设计，支持自定义标题
- ⚡ HTTP 请求全面异步化，支持中止
- ⚡ Diff 算法升级为 LCS，精准显示差异
- 🐛 修复知识库上传、空话题清理等大量 Bug

[完整更新日志](../../releases)

---

## 📞 联系方式

- 🌐 官网：[xiaolanbox.com](https://www.xiaolanbox.com)
- 💬 QQ 群：284957094
- 📕 小红书：[@小蓝AI盒子](https://www.xiaohongshu.com/user/profile/615d7a1c0000000002018733)

---

## 📄 License

Copyright © 2026 新蓝域（广州）科技有限责任公司. All rights reserved.

本项目为闭源项目，源代码不公开。APK 可免费下载使用。
