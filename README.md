# 📦 小蓝AI盒子 / BluoX AI

> **一台手机，即可 Vibe Coding。**
> 隐私优先的多平台 AI 助手，支持工具调用、终端集成、跨设备协同。

---

## ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🤖 **多 AI 平台聚合** | 支持通义千问、DeepSeek、豆包、智谱清言、MiniMax、Kimi 等主流大模型 |
| 🛠️ **AI 工具调用** | 文件读写、代码编辑、网页搜索，AI 自主完成复杂任务，敏感操作弹卡片确认 |
| 💻 **终端集成** | 搭配 Termux，AI 可在手机上执行命令、运行脚本 |
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

### v1.3.11
- 🆕 重新生成消息时显示"正在思考…"占位文字
- 🐛 修复大文件(100MB+)备份恢复卡退问题
- 🐛 消息ID加入时间戳防止重复，加载时自动修复旧数据重复ID
- 🐛 级联删除 startIndex 改为 actualIndex，避免反向追溯
- ⚡ 版本号升级至 1.3.11 (versionCode 28)

### v1.3.11
- 🆕 重新生成消息时显示"正在思考…"占位文字
- 🐛 修复大文件(100MB+)备份恢复卡退问题
- ⚡ 版本号升级至 1.3.11 (versionCode 28)

### v1.3.11
- 🆕 重新生成消息时显示"正在思考…"占位文字
- 🐛 修复大文件(100MB+)备份恢复卡退问题
- 🐛 消息ID加入时间戳防止重复，加载时自动修复旧数据重复ID
- ⚡ 版本号升级至 1.3.11 (versionCode 28)

### v1.3.10
- 🆕 专家模式新增 Termux 桥接独立开关
- 🆕 BottomSheetPicker 支持网格布局，聊天菜单改为两列网格卡片
- 🆕 异步命令取消机制，支持取消正在执行的 Termux 命令
- 🎨 话题面板、API Key 面板、历史模型面板统一改为 2 列网格卡片布局
- 🎨 管理模型面板、自定义服务商面板改为 2 列网格
- 🎨 三个操作按钮边框统一为实线，边框颜色加深
- 🎨 话题抽屉激活项改用伪元素高亮
- 🐛 AI 消息内容为空时显示"正在思考…"占位文本
- 🐛 版本切换时同步 tool_calls，工具调用数据不丢失
- 🐛 工具调用 400 错误时停止生成并触发话题刷新
- 🐛 用户停止生成时清理孤立 tool 消息
- ⚡ 增强 Termux 服务稳定性，优化桥接生命周期管理

### v1.3.9
- 🆕 选中文本高亮：选中任意文本时自动高亮聊天中其他位置的相同文本
- 🆕 生成完成提示音：AI 回复完成后播放提示音
- 🆕 横屏模式优化：平板横屏启动不再闪烁
- 🎨 消息气泡扁平化设计，统一各主题背景色和透明度
- 🎨 深度思考指示器新增边框
- ⚡ 流式输出滚动优化，响应更快
- ⚡ `cd` 命令加入安全命令白名单
- 🐛 修复工具调用详情复制按钮无效
- 🐛 修复部分场景下的死循环问题
- 🗑️ 移除广告相关功能

### v1.3.8
- 🆕 Termux 支持：AI 可在终端执行命令、运行脚本
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

---

---

# 📦 BluoX AI (English)

> **One phone is all you need for Vibe Coding.**
> A privacy-first multi-platform AI assistant with tool calling, terminal integration, and cross-device collaboration.

> ⚠️ **Note:** This app currently supports **Simplified Chinese UI only**. English localization is on the roadmap.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🤖 **Multi-Model Support** | Qwen, DeepSeek, Doubao, Zhipu, MiniMax, Kimi and more |
| 🛠️ **AI Tool Calling** | File read/write, code editing, web search — AI handles complex tasks autonomously, with confirmation cards for sensitive operations |
| 💻 **Terminal Integration** | Works with Termux — AI can execute commands and run scripts on your phone |
| 🔒 **Privacy First** | 100% local storage, zero upload — your conversations belong only to you |
| 📚 **Local Knowledge Base** | Upload documents to build a private knowledge base with offline retrieval |
| 📱 **Cross-Device** | Connect phone to PC — AI directly edits files, runs commands, and transfers files |
| 🎨 **Multi-Agent** | Create multiple AI roles with independent models, prompts, and tools |
| 🖼️ **Image Recognition** | Send images to AI for visual understanding |
| 🌙 **Theming** | Auto light/dark mode with multiple background themes |

---

## 📥 Download

### Android
- **Requirement**: Android 8.0+ (API 26)
- **Get it**: [Latest Release](../../releases/latest)

### Windows
- Search **BluoX_PC** for the Windows client

---

## 🚀 Quick Start

1. **Download & install** the APK
2. **Configure API Key**: Open app → Settings → Select AI platform → Enter API Key
3. **Start chatting**: Talk to AI, or let it handle files and search the web
4. **Advanced** (optional):
   - Install **Termux** to unlock terminal capabilities
   - Connect to PC for cross-device collaboration

---

## 🔧 Tech Stack

- **Frontend**: HTML/CSS/JavaScript (WebView)
- **Native**: Java (Android)
- **Terminal**: Termux RUN_COMMAND
- **Storage**: IndexedDB + SQLite (fully local)
- **No backend**: Connects directly to AI platform APIs

---

## 📞 Contact

- 🌐 Website: [xiaolanbox.com](https://www.xiaolanbox.com)
- 💬 QQ Group: 284957094
- 📕 Xiaohongshu: [@小蓝AI盒子](https://www.xiaohongshu.com/user/profile/615d7a1c0000000002018733)

---

## 📄 License

Copyright © 2026 新蓝域（广州）科技有限责任公司. All rights reserved.

This is a closed-source project. The APK is free to download and use.
