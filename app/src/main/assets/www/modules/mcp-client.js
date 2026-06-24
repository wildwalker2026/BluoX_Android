/**
 * mcp-client.js — MCP (Model Context Protocol) 客户端模块
 * 
 * 作为 MCP 客户端，连接外部 MCP Server（Streamable HTTP 传输），
 * 将 MCP Server 暴露的工具纳入 AI 可用工具列表。
 *
 * 使用方式：在 tool-calling.js 之前加载，调用 initMcpClient() 初始化
 * 
 * MCP 协议版本：2025-03-26 (Streamable HTTP)
 */

// ==================== 配置和状态 ====================

const MCP_PROTOCOL_VERSION = '2025-03-26';

// MCP Server 配置（持久化在 localStorage）
// 格式: [{ id, name, url, headers, enabled, status, tools, error }]
let mcpServers = [];

// 工具映射表: mcpToolName → { serverId, originalName, serverName }
const mcpToolMap = new Map();

// JSON-RPC 请求 ID 计数器
let mcpRequestId = 1;

// ==================== 配置持久化 ====================

const MCP_STORAGE_KEY = 'cnai_mcp_servers';

function loadMcpServers() {
    try {
        const raw = localStorage.getItem(MCP_STORAGE_KEY);
        mcpServers = raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('[MCP] 加载配置失败:', e);
        mcpServers = [];
    }
}

function saveMcpServers() {
    try {
        // 只保存配置字段，不保存运行时状态
        const config = mcpServers.map(s => ({
            id: s.id,
            name: s.name,
            url: s.url,
            headers: s.headers || {},
            enabled: s.enabled !== false
        }));
        localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
        console.error('[MCP] 保存配置失败:', e);
    }
}

function generateServerId() {
    return 'mcp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

// ==================== MCP Server CRUD ====================

function addMcpServer(name, url, headers = {}, enabled = true) {
    const server = {
        id: generateServerId(),
        name: name.trim(),
        url: url.trim(),
        headers: headers,
        enabled: enabled,
        status: 'disconnected', // disconnected | connecting | connected | error
        tools: [],
        error: null,
        sessionId: null
    };
    mcpServers.push(server);
    saveMcpServers();
    return server;
}

function updateMcpServer(id, updates) {
    const server = mcpServers.find(s => s.id === id);
    if (!server) return null;
    Object.assign(server, updates);
    saveMcpServers();
    return server;
}

function deleteMcpServer(id) {
    const idx = mcpServers.findIndex(s => s.id === id);
    if (idx >= 0) {
        // 清理工具映射
        for (const [key, val] of mcpToolMap.entries()) {
            if (val.serverId === id) mcpToolMap.delete(key);
        }
        mcpServers.splice(idx, 1);
        saveMcpServers();
        return true;
    }
    return false;
}

function getMcpServers() {
    return mcpServers;
}

function getEnabledMcpServers() {
    return mcpServers.filter(s => s.enabled);
}

function getConnectedMcpServers() {
    return mcpServers.filter(s => s.enabled && s.status === 'connected');
}

// ==================== MCP Streamable HTTP 传输层 ====================

/**
 * 向 MCP Server 发送 JSON-RPC 请求（Streamable HTTP）
 * @param {object} server - MCP Server 配置
 * @param {string} method - JSON-RPC 方法名
 * @param {object} params - 方法参数
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<object>} JSON-RPC 响应的 result 字段
 */
async function mcpRequest(server, method, params = {}, timeout = 30000) {
    const requestId = mcpRequestId++;
    const body = {
        jsonrpc: '2.0',
        id: requestId,
        method: method,
        params: params
    };

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...server.headers
    };

    // 携带 session ID（如果已有）
    if (server.sessionId) {
        headers['Mcp-Session-Id'] = server.sessionId;
    }

    console.log(`[MCP] → ${server.name} ${method}`, JSON.stringify(params).substring(0, 200));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(server.url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            signal: controller.signal
        });

        clearTimeout(timer);

        // 捕获 session ID
        const sessionId = response.headers.get('Mcp-Session-Id');
        if (sessionId) {
            server.sessionId = sessionId;
        }

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
        }

        const contentType = response.headers.get('Content-Type') || '';

        // 处理 SSE 流式响应
        if (contentType.includes('text/event-stream')) {
            return await parseSseResponse(response, requestId);
        }

        // 普通 JSON 响应
        const data = await response.json();
        console.log(`[MCP] ← ${server.name} ${method}`, JSON.stringify(data).substring(0, 200));

        if (data.error) {
            throw new Error(`MCP Error ${data.error.code}: ${data.error.message}`);
        }

        return data.result;
    } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') {
            throw new Error(`请求超时（${timeout / 1000}s）`);
        }
        throw e;
    }
}

/**
 * 解析 SSE 流式响应，提取 JSON-RPC 结果
 */
async function parseSseResponse(response, expectedId) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventData = '';
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                eventData += line.substring(6);
            } else if (line.trim() === '' && eventData) {
                // 空行表示一个 event 结束
                try {
                    const parsed = JSON.parse(eventData);
                    console.log('[MCP] SSE event:', JSON.stringify(parsed).substring(0, 200));
                    if (parsed.id === expectedId) {
                        result = parsed;
                    }
                } catch (e) {
                    // 忽略解析失败的 event
                }
                eventData = '';
            }
        }
    }

    if (result) {
        if (result.error) {
            throw new Error(`MCP Error ${result.error.code}: ${result.error.message}`);
        }
        return result.result;
    }

    throw new Error('SSE 响应中未找到匹配的结果');
}

// ==================== MCP Server 连接管理 ====================

/**
 * 连接单个 MCP Server
 * 执行 initialize → tools/list 流程
 */
async function connectMcpServer(server) {
    if (server.status === 'connecting' || server.status === 'connected') return;

    server.status = 'connecting';
    server.error = null;
    updateMcpServerUI();

    try {
        // 1. Initialize
        const initResult = await mcpRequest(server, 'initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
                roots: { listChanged: false }
            },
            clientInfo: {
                name: 'Bluox-AI',
                version: '1.0.0'
            }
        }, 15000);

        console.log(`[MCP] ${server.name} 初始化成功:`, initResult?.serverInfo);

        // 2. 发送 initialized 通知（通知类请求，不需要响应）
        try {
            await mcpRequest(server, 'notifications/initialized', {}, 10000);
        } catch (e) {
            // 某些 Server 可能不处理通知的响应，忽略错误
            console.log(`[MCP] ${server.name} initialized 通知已发送（可能无响应）`);
        }

        // 3. 获取工具列表
        const toolsResult = await mcpRequest(server, 'tools/list', {}, 15000);
        const tools = toolsResult?.tools || [];

        console.log(`[MCP] ${server.name} 发现 ${tools.length} 个工具`);

        server.tools = tools;
        server.status = 'connected';

        // 注册工具到映射表
        registerMcpTools(server);

        updateMcpServerUI();
        return true;
    } catch (e) {
        console.error(`[MCP] ${server.name} 连接失败:`, e);
        server.status = 'error';
        server.error = e.message;
        // 清理已注册的工具
        unregisterMcpTools(server.id);
        updateMcpServerUI();
        return false;
    }
}

/**
 * 断开 MCP Server 连接
 */
async function disconnectMcpServer(server) {
    if (server.status === 'connected' && server.sessionId) {
        try {
            // 发送 DELETE 请求关闭 session
            await fetch(server.url, {
                method: 'DELETE',
                headers: {
                    'Mcp-Session-Id': server.sessionId,
                    ...server.headers
                }
            });
        } catch (e) {
            // 忽略断开错误
        }
    }

    server.status = 'disconnected';
    server.sessionId = null;
    unregisterMcpTools(server.id);
    updateMcpServerUI();
}

/**
 * 连接所有已启用的 MCP Server
 */
async function connectAllMcpServers() {
    const enabled = getEnabledMcpServers();
    console.log(`[MCP] 连接 ${enabled.length} 个已启用的 MCP Server`);

    for (const server of enabled) {
        await connectMcpServer(server);
    }
}

// ==================== 工具注册与映射 ====================

/**
 * 将 MCP Server 的工具注册到映射表
 * 工具名格式: mcp__{serverName}__{toolName}
 */
function registerMcpTools(server) {
    // 先清理旧的工具
    unregisterMcpTools(server.id);

    for (const tool of server.tools) {
        const safeName = server.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const mcpToolName = `mcp__${safeName}__${tool.name}`;
        mcpToolMap.set(mcpToolName, {
            serverId: server.id,
            originalName: tool.name,
            serverName: server.name,
            serverUrl: server.url
        });
    }
}

/**
 * 清理某个 Server 的工具映射
 */
function unregisterMcpTools(serverId) {
    for (const [key, val] of mcpToolMap.entries()) {
        if (val.serverId === serverId) {
            mcpToolMap.delete(key);
        }
    }
}

/**
 * 获取所有已连接 MCP Server 的工具定义（OpenAI function-calling 格式）
 * @returns {Array} tools 数组
 */
function getMcpToolDefinitions() {
    const tools = [];
    for (const server of getConnectedMcpServers()) {
        for (const tool of server.tools) {
            const safeName = server.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            const mcpToolName = `mcp__${safeName}__${tool.name}`;
            tools.push({
                type: 'function',
                function: {
                    name: mcpToolName,
                    description: `[MCP:${server.name}] ${tool.description || tool.name}`,
                    parameters: tool.inputSchema || {
                        type: 'object',
                        properties: {}
                    }
                }
            });
        }
    }
    return tools;
}

/**
 * 判断是否有 MCP 工具可用
 */
function hasMcpTools() {
    return mcpToolMap.size > 0;
}

/**
 * 判断工具名是否为 MCP 工具
 */
function isMcpTool(toolName) {
    return mcpToolMap.has(toolName);
}

/**
 * 执行 MCP 工具调用
 * @param {string} toolName - MCP 工具名（mcp__serverName__originalName 格式）
 * @param {object} args - 工具参数
 * @returns {Promise<string>} 执行结果
 */
async function executeMcpTool(toolName, args) {
    const mapping = mcpToolMap.get(toolName);
    if (!mapping) {
        return `未知的 MCP 工具: ${toolName}`;
    }

    const server = mcpServers.find(s => s.id === mapping.serverId);
    if (!server) {
        return `MCP Server 不存在: ${mapping.serverName}`;
    }

    if (server.status !== 'connected') {
        // 尝试重新连接
        console.log(`[MCP] ${server.name} 未连接，尝试重新连接...`);
        const connected = await connectMcpServer(server);
        if (!connected) {
            return `MCP Server "${server.name}" 连接失败: ${server.error || '未知错误'}`;
        }
    }

    try {
        console.log(`[MCP] 调用 ${server.name}.${mapping.originalName}`, JSON.stringify(args).substring(0, 300));

        const result = await mcpRequest(server, 'tools/call', {
            name: mapping.originalName,
            arguments: args || {}
        }, 60000);

        // MCP 工具结果格式: { content: [{ type: 'text', text: '...' }], isError: false }
        if (result?.isError) {
            const errorText = extractMcpResultText(result);
            return `❌ MCP 工具执行错误: ${errorText}`;
        }

        return extractMcpResultText(result);
    } catch (e) {
        console.error(`[MCP] 工具调用失败 ${toolName}:`, e);
        return `❌ MCP 工具调用失败: ${e.message}`;
    }
}

/**
 * 从 MCP 工具调用结果中提取文本
 */
function extractMcpResultText(result) {
    if (!result) return '';

    // MCP 标准格式: { content: [{ type: 'text', text: '...' }] }
    if (result.content && Array.isArray(result.content)) {
        return result.content
            .map(item => {
                if (item.type === 'text') return item.text;
                if (item.type === 'image') return `[图片: ${item.mimeType}]`;
                if (item.type === 'resource') return `[资源: ${item.resource?.uri || ''}]`;
                return JSON.stringify(item);
            })
            .join('\n');
    }

    // 兼容直接返回文本的情况
    if (typeof result === 'string') return result;

    return JSON.stringify(result);
}

// ==================== UI 更新 ====================

function updateMcpServerUI() {
    const listEl = document.getElementById('mcpServerList');
    if (!listEl) return;

    if (mcpServers.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;font-size:13px;">暂无 MCP 服务器，点击上方按钮添加</div>';
        return;
    }

    listEl.innerHTML = mcpServers.map(server => {
        const statusText = server.status === 'connected' ? `已连接 · ${server.tools.length}个工具`
            : server.status === 'connecting' ? '连接中'
            : '未连接';
        const statusBg = server.status === 'connected' ? 'rgba(16,185,129,0.12)'
            : server.status === 'connecting' ? 'rgba(59,130,246,0.12)'
            : 'rgba(156,163,175,0.12)';
        const statusColor = server.status === 'connected' ? '#10b981'
            : server.status === 'connecting' ? '#3b82f6'
            : '#9ca3af';
        const errorTip = '';
        const errorIcon = server.error ? `<span class="mcp-error-icon" data-error="${encodeURIComponent(server.error)}" style="flex-shrink:0;color:#ef4444;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></span>` : '';

        const activeClass = server.status === 'connected' ? 'active' : '';

        return `
        <div class="agent-item mcp-server-item ${activeClass}" data-id="${server.id}" style="display:flex;align-items:center;gap:10px;padding:12px 14px;">
            <div class="agent-item-info" style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <span class="agent-item-name">${escapeHtml(server.name)}</span>
                    <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${statusBg};color:${statusColor};white-space:nowrap;">${statusText}</span>
                </div>
                <small style="display:block;word-break:break-all;color:var(--text-secondary);font-size:11px;margin-top:2px;">${escapeHtml(server.url)}</small>
                ${errorTip}
            </div>
            ${errorIcon}
        </div>`;
    }).join('');
}

// ==================== MCP 编辑弹窗 ====================

function openMcpEditModal(serverId = null) {
    const modal = document.getElementById('mcpEditModal');
    if (!modal) return;

    const titleEl = document.getElementById('mcpEditTitle');
    const nameInput = document.getElementById('mcpEditName');
    const urlInput = document.getElementById('mcpEditUrl');
    const headersInput = document.getElementById('mcpEditHeaders');

    if (serverId) {
        const server = mcpServers.find(s => s.id === serverId);
        if (!server) return;
        titleEl.textContent = '编辑 MCP 服务器';
        nameInput.value = server.name;
        urlInput.value = server.url;
        headersInput.value = server.headers ? JSON.stringify(server.headers, null, 2) : '';
        modal.dataset.editId = serverId;
    } else {
        titleEl.textContent = '添加 MCP 服务器';
        nameInput.value = '';
        urlInput.value = '';
        headersInput.value = '';
        delete modal.dataset.editId;
    }

    modal.classList.add('active');
    const modalInner = modal.querySelector('.modal.fullscreen-modal');
    const mcpSettingsInner = document.querySelector('#mcpSettingsModal .modal.fullscreen-modal');
    // MCP设置页向左滑出
    if (mcpSettingsInner) {
        mcpSettingsInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        mcpSettingsInner.style.transform = 'translateX(-10%)';
    }
    // 编辑弹窗从右滑入
    if (modalInner) {
        modalInner.style.transition = 'none';
        modalInner.style.transform = 'translateX(30%)';
        void modalInner.offsetHeight;
        modalInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        modalInner.style.transform = 'translateX(0)';
    }
}

function closeMcpEditModal() {
    const modal = document.getElementById('mcpEditModal');
    if (!modal || !modal.classList.contains('active')) return;
    const modalInner = modal.querySelector('.modal.fullscreen-modal');
    const mcpSettingsInner = document.querySelector('#mcpSettingsModal .modal.fullscreen-modal');
    // 编辑弹窗向右滑出+淡出
    if (modalInner) {
        modalInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease';
        modalInner.style.transform = 'translateX(10%)';
        modalInner.style.opacity = '0';
    }
    // MCP设置页从左滑入回来
    if (mcpSettingsInner) {
        mcpSettingsInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        mcpSettingsInner.style.transform = 'translateX(0)';
    }
    setTimeout(() => {
        modal.classList.remove('active');
        if (modalInner) {
            modalInner.style.transition = '';
            modalInner.style.transform = '';
            modalInner.style.opacity = '';
        }
        if (mcpSettingsInner) {
            mcpSettingsInner.style.transition = '';
            mcpSettingsInner.style.transform = '';
            mcpSettingsInner.style.opacity = '';
        }
    }, 250);
}

async function saveMcpServerFromForm() {
    console.log('[MCP] saveMcpServerFromForm 开始执行');
    const name = document.getElementById('mcpEditName').value.trim();
    const url = document.getElementById('mcpEditUrl').value.trim();
    const headersStr = document.getElementById('mcpEditHeaders').value.trim();
    console.log('[MCP] 表单数据:', { name, url, headersStr });

    if (!name) {
        showToast('请输入服务器名称');
        return;
    }
    if (!url) {
        showToast('请输入服务器 URL');
        return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        showToast('URL 必须以 http:// 或 https:// 开头');
        return;
    }

    let headers = {};
    if (headersStr) {
        try {
            headers = JSON.parse(headersStr);
        } catch (e) {
            showToast('Headers 格式错误，请输入有效的 JSON');
            return;
        }
    }

    const modal = document.getElementById('mcpEditModal');
    const editId = modal.dataset.editId;

    try {
        if (editId) {
            // 编辑现有服务器
            const server = updateMcpServer(editId, { name, url, headers });
            // 先刷新列表
            updateMcpServerUI();
            // 重新连接
            await disconnectMcpServer(server);
            if (server.enabled) {
                await connectMcpServer(server);
            }
        } else {
            // 添加新服务器（先保存）
            const server = addMcpServer(name, url, headers, true);
            console.log('[MCP] 服务器已保存:', server.id, '当前列表:', mcpServers.length);
            // 先刷新列表显示
            updateMcpServerUI();
            // 再尝试连接
            await connectMcpServer(server);
        }
    } catch (e) {
        console.error('[MCP] 保存服务器异常:', e);
    }

    // 无论连接是否成功，都关闭弹窗并刷新列表
    closeMcpEditModal();
    updateMcpServerUI();
    console.log('[MCP] 保存流程结束，服务器数量:', mcpServers.length);
}

// ==================== 初始化 ====================

/**
 * 显示 MCP 服务器操作菜单（底部弹出）
 */
function showMcpServerMenu(server) {
    if (typeof createBottomSheetPicker !== 'function') return;
    createBottomSheetPicker({
        items: [
            { value: 'toggle', label: server.enabled ? '禁用' : '启用' },
            { value: 'reconnect', label: '重新连接' },
            { value: 'edit', label: '编辑' },
            'divider',
            { value: 'delete', label: '删除', className: 'bs-item-danger' },
        ],
        onSelect: async (item) => {
            if (item.value === 'toggle') {
                server.enabled = !server.enabled;
                saveMcpServers();
                if (server.enabled && server.status !== 'connected') {
                    await connectMcpServer(server);
                } else if (!server.enabled && server.status === 'connected') {
                    await disconnectMcpServer(server);
                }
                updateMcpServerUI();
            } else if (item.value === 'reconnect') {
                await disconnectMcpServer(server);
                await connectMcpServer(server);
            } else if (item.value === 'edit') {
                openMcpEditModal(server.id);
            } else if (item.value === 'delete') {
                await disconnectMcpServer(server);
                deleteMcpServer(server.id);
                updateMcpServerUI();
                showToast('已删除');
            }
        },
    }).show();
}

let mcpInitialized = false;
function initMcpClient() {
    if (mcpInitialized) return;
    mcpInitialized = true;
    console.log('[MCP] 初始化 MCP 客户端模块');
    loadMcpServers();

    // 使用事件委托绑定 UI 事件（避免时机问题）
    document.addEventListener('click', async (e) => {
        // 添加服务器按钮
        if (e.target.closest('#mcpAddServerBtn')) {
            openMcpEditModal(null);
            return;
        }
        // 编辑弹窗保存按钮
        if (e.target.closest('#mcpEditSaveBtn')) {
            await saveMcpServerFromForm();
            return;
        }
        // 编辑弹窗取消按钮
        if (e.target.closest('#mcpEditCancelBtn')) {
            closeMcpEditModal();
            return;
        }
        // 编辑弹窗背景点击关闭
        if (e.target.id === 'mcpEditModal') {
            closeMcpEditModal();
            return;
        }
        // 点击错误图标显示错误详情
        const errorIcon = e.target.closest('.mcp-error-icon');
        if (errorIcon) {
            e.stopPropagation();
            const errorMsg = decodeURIComponent(errorIcon.dataset.error || '未知错误');
            if (typeof createBottomSheetPicker === 'function') {
                createBottomSheetPicker({
                    title: '错误详情',
                    items: [],
                    onSelect: () => {},
                    customContent: `<div style="padding:12px 16px;font-size:13px;color:#ef4444;line-height:1.6;word-break:break-all;white-space:pre-wrap;">${escapeHtml(errorMsg)}</div>`,
                }).show();
            } else {
                alert(errorMsg);
            }
            return;
        }
        // 点击服务器标签触发菜单
        const serverItem = e.target.closest('.mcp-server-item');
        if (serverItem) {
            const id = serverItem.dataset.id;
            const server = mcpServers.find(s => s.id === id);
            if (server) {
                showMcpServerMenu(server);
            }
            return;
        }
    });

    // 更新服务器列表 UI
    updateMcpServerUI();

    // 自动连接已启用的服务器
    connectAllMcpServers();
}

// ==================== 工具函数 ====================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 确保 showToast 可用（可能由 app.js 提供）
if (typeof showToast !== 'function') {
    window.showToast = function(msg) {
        console.log('[Toast]', msg);
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;z-index:99999;max-width:80%;text-align:center;';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    };
}

// ==================== 暴露到全局作用域 ====================
// 确保内联 onclick 和外部调用都能访问
window.openMcpEditModal = openMcpEditModal;
window.closeMcpEditModal = closeMcpEditModal;
window.saveMcpServerFromForm = saveMcpServerFromForm;
window.updateMcpServerUI = updateMcpServerUI;
window.connectMcpServer = connectMcpServer;
window.disconnectMcpServer = disconnectMcpServer;

console.log('[MCP] 模块已加载（Streamable HTTP 客户端）');

// 自动初始化（不依赖外部调用）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initMcpClient());
} else {
    initMcpClient();
}
