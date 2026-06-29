// ==================== 懒加载工具 (已修改) ====================
const _loadedScripts = {};
function loadScript(src) {
    if (_loadedScripts[src]) return _loadedScripts[src];
    _loadedScripts[src] = new Promise((resolve, reject) => {
        // 如果已经存在（比如之前同步加载过），直接返回
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('加载失败: ' + src));
        document.head.appendChild(s);
    });
    return _loadedScripts[src];
}
async function ensurePdfJs() {
    if (window.pdfjsLib) return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
}
async function ensureMammoth() {
    if (window.mammoth) return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
}
async function ensureJSZip() {
    if (window.JSZip) return;
    await loadScript('jszip.min.js');
}
async function ensureCFB() {
    if (window.CFB) return;
    await loadScript('cfb.min.js');
}
async function ensureTransformers() {
    if (window.Transformers) return;
    await loadScript('transformers.bundle.js');
}
async function ensureKnowledgeBase() {
    if (window._knowledgeBaseLoaded) return;
    await loadScript('modules/knowledge-base.js');
    window._knowledgeBaseLoaded = true;
}
async function ensureUsagePoints() {
    if (window._usagePointsLoaded) return;
    await loadScript('modules/usage-points.js');
    window._usagePointsLoaded = true;
    UsagePoints.init();
}

// ==================== AES 加密解密工具 ====================
function _uint8ToBase64(bytes) {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function _base64ToUint8(base64) {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
}

async function _deriveAesKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function aesEncrypt(plaintext, password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await _deriveAesKey(password, salt);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
    const payload = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    payload.set(salt, 0);
    payload.set(iv, salt.length);
    payload.set(new Uint8Array(encrypted), salt.length + iv.length);
    return 'AES:' + _uint8ToBase64(payload);
}

async function aesDecrypt(ciphertext, password) {
    const bytes = _base64ToUint8(ciphertext.slice(4));
    const salt = bytes.slice(0, 16);
    const iv = bytes.slice(16, 28);
    const data = bytes.slice(28);
    const key = await _deriveAesKey(password, salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
}

// 弹窗输入密码（复用 showInputModal，返回 Promise）
function promptPassword(title) {
    return new Promise((resolve) => {
        // 先关闭备份弹窗，避免遮挡密码输入框
        if (backupRestoreSheet) {
            closeBackupRestoreModal();
        }
        // 使用新的参数方式设置密码模式
        showInputModal(title, '', (password) => {
            resolve(password || null);
        }, 'password');
    });
}

// ==================== SVG 图标常量 ====================
const ICONS = {
    refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>`,
    info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>`,
    resend: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <polyline points="19 12 12 19 5 12"></polyline>
    </svg>`,
    copy: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>`,
    edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>`,
    delete: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>`,
    dropdown: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>`,
    add: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>`,
    settings: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
    </svg>`,
    send: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>`,
    stop: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>`,
    eye: `<svg class="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
    </svg>`,
    eyeOff: `<svg class="eye-off-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: none;">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>`
};

// 点击状态标志 - 1 表示刚发生点击，0 表示已处理
let clickFlag = 0;

// 当前点击的按钮或标签元素
let clickedElement = null;

// 上一次被禁用 hover 的元素引用（用于下次点击时恢复）
let lastHoverDisabledElement = null;

// DOM 元素
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const settingsBtn = document.getElementById('topicDrawerSettingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelSelect = document.getElementById('modelSelect');
const streamOutputSwitch = document.getElementById('streamOutputSwitch');

const clearBtn = document.getElementById('clearBtn');
const contextLimitNormalInput = document.getElementById('contextLimitNormalInput');
const contextLimitExpertInput = document.getElementById('contextLimitExpertInput');
const pageSizeInput = document.getElementById('pageSizeInput');
const maxTokensInput = document.getElementById('maxTokensInput');
const temperatureInput = document.getElementById('temperatureInput');
const topPInput = document.getElementById('topPInput');
const fontSizeInput = document.getElementById('fontSizeInput');
const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
const getApiKeyBtn = document.getElementById('getApiKeyBtn');
const getApiKeyModal = document.getElementById('getApiKeyModal');
const closeGetApiKey = document.getElementById('closeGetApiKey');
const closeGetApiKeyBtn = document.getElementById('closeGetApiKeyBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
const scrollToTopBtn = document.getElementById('scrollToTopBtn');
const searchInChatBtn = document.getElementById('searchInChatBtn');
const cacheOptimizeSwitch = document.getElementById('cacheOptimizeSwitch');
const restoreLastTopicSwitch = document.getElementById('restoreLastTopicSwitch');
const autoGenerateTopicNameSwitch = document.getElementById('autoGenerateTopicNameSwitch');
const topicNamePromptInput = document.getElementById('topicNamePromptInput');
const lockPortraitSwitch = document.getElementById('lockPortraitSwitch');
const immersiveModeDefaultSwitch = document.getElementById('immersiveModeDefaultSwitch');
const autoCompressImageSwitch = document.getElementById('autoCompressImageSwitch');
const confirmSoundSwitch = document.getElementById('confirmSoundSwitch');
const keepScreenOnSwitch = document.getElementById('keepScreenOnSwitch');

// 高级设置相关 DOM 元素
const advancedSettingsToggle = document.getElementById('advancedSettingsToggle');
const advancedSettingsContent = document.getElementById('advancedSettingsContent');
const showUsageInfoSwitch = document.getElementById('showUsageInfoSwitch');
const usageInfoEl = document.getElementById('usageInfo');
const customRequestBodyInput = document.getElementById('customRequestBodyInput');
const resetCustomBodyBtn = document.getElementById('resetCustomBodyBtn');
const customBodyError = document.getElementById('customBodyError');

// 豆包 Session 缓存相关 DOM 元素
const sessionCacheGroup = document.getElementById('sessionCacheGroup');
const sessionCacheSwitch = document.getElementById('sessionCacheSwitch');
const sessionExpireInput = document.getElementById('sessionExpireInput');
const sessionExpireRow = document.getElementById('sessionExpireRow');

// AI 企业和模型相关 DOM 元素
const aiProviderSelect = document.getElementById('aiProviderSelect');
const fetchModelsBtn = document.getElementById('fetchModelsBtn');
// addCustomModelBtn 已移除，模型下拉按钮直接打开管理模型
const testConnectionBtn = document.getElementById('testConnectionBtn');

// 自定义选择器 DOM 元素
const aiProviderSelectBtn = document.getElementById('aiProviderSelectBtn');
const aiProviderSelectText = document.getElementById('aiProviderSelectText');
// AI 服务商数据
const AI_PROVIDERS = [
    { value: 'deepseek', label: 'DeepSeek（深度求索）', icon: 'icons/db3_processed/AIprovidersvg/deepseek.svg' },
    { value: 'qwen', label: '千问 (Qwen)', icon: 'icons/db3_processed/AIprovidersvg/qwen.svg' },
    { value: 'doubao', label: '豆包（Volcano）', icon: 'icons/db3_processed/AIprovidersvg/volcengine.svg' },
    { value: 'glm', label: 'GLM（智谱清言）', icon: 'icons/db3_processed/AIprovidersvg/zhipu.svg' },
    { value: 'minimax', label: 'MiniMax（极小化极大）', icon: 'icons/db3_processed/AIprovidersvg/minimax.svg' },
    { value: 'kimi', label: 'Kimi（月之暗面）', icon: 'icons/db3_processed/AIprovidersvg/kimi.svg' },
    { value: 'mimo', label: 'MiMo（小米）', icon: 'icons/db3_processed/AIprovidersvg/mimo.svg' },
];

// 支持联网搜索的服务商列表（统一维护，全局引用）
const WEB_SEARCH_PROVIDERS = ['doubao', 'qwen', 'mimo', 'deepseek', 'glm', 'kimi', 'minimax'];

const modelSelectBtn = document.getElementById('modelSelectBtn');
const modelSelectText = document.getElementById('modelSelectText');
// modelSelectPopup 已改用 createBottomSheetPicker

// 自定义服务商相关 DOM 元素
const customProviderEditModal = document.getElementById('customProviderEditModal');
const customProviderEditTitle = document.getElementById('customProviderEditTitle');
const closeCustomProviderEdit = document.getElementById('closeCustomProviderEdit');
const customProviderName = document.getElementById('customProviderName');
const apiTypeSelectBtn = document.getElementById('apiTypeSelectBtn');
const apiTypeSelectText = document.getElementById('apiTypeSelectText');
// apiTypePopup 已改用 createBottomSheetPicker
const customProviderBaseUrl = document.getElementById('customProviderBaseUrl');
const customProviderModelInput = document.getElementById('customProviderModelInput');
const addCustomProviderModelBtn = document.getElementById('addCustomProviderModelBtn');
const customProviderModelsList = document.getElementById('customProviderModelsList');

// 智能体相关 DOM 元素
const agentSelectBtn = document.getElementById('agentSelectBtn');
const currentAgentIcon = document.getElementById('currentAgentIcon');
const currentAgentName = document.getElementById('currentAgentName');
const agentSelectModal = document.getElementById('agentSelectModal');
const agentEditModal = document.getElementById('agentEditModal');
const agentList = document.getElementById('agentList');
const addAgentBtn = document.getElementById('addAgentBtn');
const closeAgentSelect = document.getElementById('closeAgentSelect');
const closeAgentEdit = document.getElementById('closeAgentEdit');

// 智能体标签栏 DOM 元素
const agentTagsBar = document.getElementById('agentTagsBar');
const agentTagsScroll = document.getElementById('agentTagsScroll');

// 功能开关 DOM 元素
const deepThinkingSwitch = document.getElementById('deepThinkingSwitch');
const deepThinkingToggleBtn = document.getElementById('deepThinkingToggleBtn');
// thinkingBudgetPopup 已改用 createBottomSheetPicker
const webSearchSwitch = document.getElementById('webSearchSwitch');
const webSearchToggleBtn = document.getElementById('webSearchToggleBtn');
const webSearchFormGroup = document.getElementById('webSearchFormGroup');
const agentEditTitle = document.getElementById('agentEditTitle');
const agentNameInput = document.getElementById('agentNameInput');
const iconPreview = document.getElementById('iconPreview');
const iconOptions = document.getElementById('iconOptions');
const agentSystemInput = document.getElementById('agentSystemInput');
const chatBgPreview = document.getElementById('chatBgPreview');
const chatBgSelectBtn = document.getElementById('chatBgSelectBtn');
const chatBgResetBtn = document.getElementById('chatBgResetBtn');
const chatBgOpacityRow = document.getElementById('chatBgOpacityRow');
const chatBgOpacitySlider = document.getElementById('chatBgOpacitySlider');
const chatBgOpacityValue = document.getElementById('chatBgOpacityValue');
const chatBgUploadInput = document.getElementById('chatBgUploadInput');
// 当前编辑中的背景数据（临时）
let editingChatBg = null;
let editingChatBgOpacity = 30;



// 预设值下拉框 DOM 元素
const presetDropdownBtn = document.getElementById('presetDropdownBtn');
// presetDropdownMenu 已改用 createBottomSheetPicker

// 主题相关 DOM 元素
const themeColorSelectBtn = document.getElementById('themeColorSelectBtn');
const themeColorSelectText = document.getElementById('themeColorSelectText');
const darkThemeSwitch = document.getElementById('darkThemeSwitch');
const bgThemeSelectBtn = document.getElementById('bgThemeSelectBtn');
const bgThemeSelectText = document.getElementById('bgThemeSelectText');

// 背景主题名称映射
const bgThemeNames = {
    light: '浅色',
    dark: '深色',
    sunset: '落日黄',
    starlight: '星海蓝'
};
// 背景主题预览色
const bgThemeColors = {
    light: '#ffffff',
    dark: '#1a1a1a',
    sunset: '#FFF8E1',
    starlight: '#0F1B30'
};

// 当前模型名称显示
const currentModelNameEl = document.getElementById('currentModelName');

// 话题相关 DOM 元素
const topicDrawerBtn = document.getElementById('topicDrawerBtn');
const topicDrawer = document.getElementById('topicDrawer');
const topicDrawerOverlay = document.getElementById('topicDrawerOverlay');
const topicDrawerBody = document.getElementById('topicDrawerBody');
const topicDrawerClose = document.getElementById('topicDrawerClose');
const topicDrawerBatchBtn = document.getElementById('topicDrawerBatchBtn');
const topicDrawerSelectAllBtn = document.getElementById('topicDrawerSelectAllBtn');
const topicDrawerCancelBtn = document.getElementById('topicDrawerCancelBtn');

// 批量删除模式状态
let isBatchDeleteMode = false;
let currentPanel = null; // 记录当前活跃的面板元素（用于过渡动画）
let panelStack = []; // 面板栈，记录层级关系
let selectedTopicsForDelete = new Set(); // 存储格式: "agentId_topicId"

// 全局搜索相关变量
let globalSearchSheet = null;
let _globalSearchTopicFilter = null;
const topicDrawerSearchBtn = document.getElementById('topicDrawerSearchBtn');

// 输入弹窗 DOM 元素
const inputModal = document.getElementById('inputModal');
const inputModalTitle = document.getElementById('inputModalTitle');
const inputModalInput = document.getElementById('inputModalInput');
const closeInputModal = document.getElementById('closeInputModal');
const inputModalCancel = document.getElementById('inputModalCancel');
const inputModalConfirm = document.getElementById('inputModalConfirm');
const passwordToggleBtn = document.getElementById('passwordToggleBtn');
const eyeIconHidden = document.getElementById('eyeIconHidden');
const eyeIconVisible = document.getElementById('eyeIconVisible');

// 编辑遮罩层
const editOverlay = document.getElementById('editOverlay');

// 话题切换加载遮罩层
const topicLoadingOverlay = document.getElementById('topicLoadingOverlay');

// 聊天菜单 DOM 元素
const chatMenuContainer = document.getElementById('chatMenuContainer');
const chatMenuBtn = document.getElementById('chatMenuBtn');
// 移入输入框同一行：更多操作
(function(){
    var tr = document.querySelector('.input-textarea-row');
    if(chatMenuContainer && tr) tr.appendChild(chatMenuContainer);
})();
const importChatInput = document.getElementById('importChatInput');

// 知识库参考子菜单 DOM 元素
const knowledgeRefContainer = document.getElementById('knowledgeRefContainer');
// knowledgeRefSubmenu 已改用 createBottomSheetPicker
const toggleKnowledgeBase = document.getElementById('toggleKnowledgeBase');
const toggleKnowledgeBaseLabel = document.getElementById('toggleKnowledgeBaseLabel');

// 图片上传相关 DOM 元素
const imageUploadInput = document.getElementById('imageUploadInput');
const imagePreviewArea = document.getElementById('imagePreviewArea');

// 文件上传相关 DOM 元素
const fileUploadInput = document.getElementById('fileUploadInput');

// 文件查看弹窗 DOM 元素
const fileViewerModal = document.getElementById('fileViewerModal');
const fileViewerTitle = document.getElementById('fileViewerTitle');
const fileViewerContent = document.getElementById('fileViewerContent');
const closeFileViewer = document.getElementById('closeFileViewer');
const closeFileViewerBtn = document.getElementById('closeFileViewerBtn');

// 智能体删除选项弹窗 DOM 元素


// 知识库相关 DOM 元素
const knowledgeBaseSwitch = document.getElementById('knowledgeBaseSwitch');
const maxKnowledgeChunksInput = document.getElementById('maxKnowledgeChunksInput');
const maxKeywordChunksInput = document.getElementById('maxKeywordChunksInput');
const manageKnowledgeBaseBtn = document.getElementById('manageKnowledgeBaseBtn');
const knowledgeBaseModal = document.getElementById('knowledgeBaseModal');
const closeKnowledgeBase = document.getElementById('closeKnowledgeBase');
const knowledgeUploadInput = document.getElementById('knowledgeUploadInput');
const knowledgeUploadBtn = document.getElementById('knowledgeUploadBtn');
const knowledgeBaseList = document.getElementById('knowledgeBaseList');
const knowledgeAgentList = document.querySelector('#knowledgeBaseModal .agent-list') || (knowledgeBaseList ? knowledgeBaseList.closest('.agent-list') : null);
const knowledgeBaseInfo = document.getElementById('knowledgeBaseInfo');
const clearKnowledgeBaseBtn = document.getElementById('clearKnowledgeBaseBtn');
const closeKnowledgeBaseBtn = document.getElementById('closeKnowledgeBaseBtn');
const vectorSearchSwitch = document.getElementById('vectorSearchSwitch');
const regenerateEmbeddingsBtn = document.getElementById('regenerateEmbeddingsBtn');
const selectAllKnowledgeDocs = document.getElementById('selectAllKnowledgeDocs');

// 知识库检索选择弹窗状态
let knowledgeSelectSheet = null;
let knowledgeDetailSheet = null;
let pendingKnowledgeChunks = [];            // 待选择的检索结果
let selectedKnowledgeChunks = new Set();    // 用户选中的检索结果索引
let knowledgeSelectResolve = null;          // Promise resolve 函数

// 图片压缩工具 DOM 元素
const imageCompressModal = document.getElementById('imageCompressModal');
const closeImageCompress = document.getElementById('closeImageCompress');
const compressFileInput = document.getElementById('compressFileInput');
const startCompressBtn = document.getElementById('startCompressBtn');
const downloadCompressedBtn = document.getElementById('downloadCompressedBtn');
const compressOriginalImage = document.getElementById('compressOriginalImage');
const compressResultImage = document.getElementById('compressResultImage');
const compressOriginalSize = document.getElementById('compressOriginalSize');
const compressResultSize = document.getElementById('compressResultSize');
const compressOriginalDimensions = document.getElementById('compressOriginalDimensions');
const compressResultDimensions = document.getElementById('compressResultDimensions');
const compressUsedQuality = document.getElementById('compressUsedQuality');
const compressQuality = document.getElementById('compressQuality');
const compressQualityValue = document.getElementById('compressQualityValue');
const compressStats = document.getElementById('compressStats');
const closeKnowledgeDetail = document.getElementById('closeKnowledgeDetail');
const closeKnowledgeDetailBtn = document.getElementById('closeKnowledgeDetailBtn');

// 状态
let currentAIProvider = localStorage.getItem('cnai_ai_provider') || 'deepseek';
// 话题 ID 计数器（全局共享，所有智能体共用一个序列，初始值从 1001 开始）
let topicIdCounter = parseInt(localStorage.getItem('cnai_topic_id_counter')) || 1001;
// API Key 按 AI 企业分别存储
let apiKeys = JSON.parse(localStorage.getItem('cnai_api_keys')) || {
    qwen: '',
    deepseek: '',
    doubao: '',
    glm: '',
    kimi: '',
    minimax: '',
    mimo: ''
};
let apiKey = apiKeys[currentAIProvider] || '';
let selectedModel = localStorage.getItem('cnai_model') || 'qwen3.5-plus';
let streamOutputEnabled = localStorage.getItem('cnai_stream_output') !== 'false';
let contextLimitNormal = parseInt(localStorage.getItem('cnai_context_limit_normal')) || 100;
let contextLimitExpert = parseInt(localStorage.getItem('cnai_context_limit_expert')) || 30;
// contextLimit 是实际使用的轮数，由专家模式开关决定取哪个值
let contextLimit;
// 兼容旧版本迁移：如果存在旧的 cnai_context_limit，迁移到 normal
if (localStorage.getItem('cnai_context_limit') && !localStorage.getItem('cnai_context_limit_normal')) {
    contextLimitNormal = parseInt(localStorage.getItem('cnai_context_limit')) || 100;
    localStorage.setItem('cnai_context_limit_normal', contextLimitNormal);
    localStorage.removeItem('cnai_context_limit');
}
(function() {
    const _expert = typeof expertModeEnabled !== 'undefined' ? expertModeEnabled : localStorage.getItem('cnai_expert_mode') === '1';
    contextLimit = _expert ? contextLimitExpert : contextLimitNormal;
})();
let maxTokens = parseInt(localStorage.getItem('cnai_max_tokens')) || 128000;
let temperature = parseFloat(localStorage.getItem('cnai_temperature')) || 1.14;
let topP = parseFloat(localStorage.getItem('cnai_top_p')) || 0.5;
let messageFontSize = parseInt(localStorage.getItem('cnai_message_font_size')) || 16;
let isSending = false;


// Token 用量信息显示状态（默认关闭）
let showUsageInfoEnabled = localStorage.getItem('cnai_show_usage_info') === 'true';

// 自定义请求体参数（按服务商存储）
let customRequestBody = localStorage.getItem(`cnai_custom_request_body_${currentAIProvider}`) || '';

// 图片上传相关状态
let pendingImages = [];

// 文件上传相关状态
let pendingFiles = [];

// 已发送消息中的文件数据存储（用于在消息气泡中显示文件预览）
// 格式：{ [messageKey]: [{ name, type, size, content }] }
let sentFilesByMessage = {};

// IndexedDB 用于持久化存储文件数据
const FILE_DB_NAME = 'CNAIChatFiles';
const FILE_DB_VERSION = 1;
const FILE_STORE_NAME = 'files';
let fileDB = null;

// 知识库相关状态
let knowledgeBaseEnabled = localStorage.getItem('cnai_knowledge_base_enabled') === 'true';
let maxKnowledgeChunks = parseInt(localStorage.getItem('cnai_max_knowledge_chunks')) || 3; // 向量检索片段数
let maxKeywordChunks = parseInt(localStorage.getItem('cnai_max_keyword_chunks')) || 1; // 关键词检索片段数
let selectedKnowledgeDocId = localStorage.getItem('cnai_selected_knowledge_doc_id') || null; // 当前选中的知识库文档ID，null表示使用默认逻辑（搜索所有文档）

// 知识库 IndexedDB
const KNOWLEDGE_DB_NAME = 'CNAIChatKnowledgeBase';
const KNOWLEDGE_DB_VERSION = 2; // v2: 修复 objectStore 缺少 keyPath 的问题
const KNOWLEDGE_STORE_NAME = 'documents';
let knowledgeDB = null;

// 向量检索配置
const VECTOR_CONFIG = {
    enabled: true,                          // 是否启用向量检索
    model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',  // 多语言模型，支持中文
    dimension: 384,                         // 向量维度
    similarityThreshold: 0.3,               // 相似度阈值
    hybridWeight: 1                       // 混合检索权重（0=纯关键词，1=纯向量）
};

// 向量检索状态
let embeddingModel = null;                  // 嵌入模型实例
let vectorSearchEnabled = localStorage.getItem('cnai_vector_search_enabled') !== 'false'; // 默认启用
let embeddingModelLoading = false;          // 模型加载中标志
let vectorSearchAvailable = null;           // 向量检索是否可用（运行时检测）

// 已发送消息中的图片数据存储（用于在消息气泡中显示缩略图）
// 格式：{ [messageKey]: [{ base64, name }] }
// messageKey 格式：'user_' + timestamp 或 'ai_' + timestamp
let sentImagesByMessage = {};

// IndexedDB 用于持久化存储消息数据
const MESSAGE_DB_NAME = 'CNAIChatMessages';
const MESSAGE_DB_VERSION = 1;
const MESSAGE_STORE_NAME = 'messages';
let messageDB = null;

// 图表 IndexedDB
const CHART_DB_NAME = 'CNAIChatCharts';
const CHART_DB_VERSION = 1;
const CHART_STORE_NAME = 'charts';
let chartDB = null;

// 聊天背景图 IndexedDB
const CHATBG_DB_NAME = 'CNAIChatBg';
const CHATBG_DB_VERSION = 1;
const CHATBG_STORE_NAME = 'backgrounds';
let chatBgDB = null;

// 消息存在性缓存（避免同步场景下读 IndexedDB）
const _messageExistsCache = new Set();
const _messageRoundCache = {};
const _messageLastTimeCache = {};

// 消息 ID 全局自增计数器（所有话题通用，持久化到 IndexedDB）
let _globalMessageIdCounter = 0;
const MESSAGE_ID_COUNTER_KEY = 'global_message_id_counter';

// 从 IndexedDB 加载计数器
async function loadMessageIdCounter() {
    return new Promise((resolve) => {
        if (!messageDB) { resolve(); return; }
        try {
            const tx = messageDB.transaction([MESSAGE_STORE_NAME], 'readonly');
            const store = tx.objectStore(MESSAGE_STORE_NAME);
            const request = store.get(MESSAGE_ID_COUNTER_KEY);
            request.onsuccess = () => {
                if (request.result && typeof request.result.counter === 'number') {
                    _globalMessageIdCounter = request.result.counter;
                    console.log('消息ID计数器已加载:', _globalMessageIdCounter);
                }
                resolve();
            };
            request.onerror = () => {
                console.warn('加载消息ID计数器失败');
                resolve();
            };
        } catch (e) {
            console.warn('加载消息ID计数器异常:', e);
            resolve();
        }
    });
}

// 保存计数器到 IndexedDB
function saveMessageIdCounter() {
    if (!messageDB) return;
    try {
        const tx = messageDB.transaction([MESSAGE_STORE_NAME], 'readwrite');
        const store = tx.objectStore(MESSAGE_STORE_NAME);
        store.put({ key: MESSAGE_ID_COUNTER_KEY, counter: _globalMessageIdCounter });
    } catch (e) {
        console.warn('保存消息ID计数器失败:', e);
    }
}

// 生成消息 ID：话题ID_自增数字
function generateMessageId() {
    _globalMessageIdCounter++;
    saveMessageIdCounter();
    const topicId = currentTopicId || 'default';
    const ts = Date.now().toString(36);
    const id = `${topicId}_${ts}_${_globalMessageIdCounter}`;
    return id;
}

// 获取话题根节点ID（全话题唯一，用于第一条消息的 prevId）
function getTopicRootId() {
    return (currentTopicId || 'default') + '_root';
}

// 从可见链中获取最后一条指定 role 的消息 id
function getLastVisibleMsgIdByRole(role) {
    const visibleMsgs = getVisibleTimelineMessages();
    for (let i = visibleMsgs.length - 1; i >= 0; i--) {
        if (visibleMsgs[i].role === role) {
            return role === 'assistant' ? getCurrentVersionId(visibleMsgs[i]) : visibleMsgs[i].id;
        }
    }
    return null;
}

// 通过 ID 查找消息对象
function findMessageById(id) {
    return messages.find(m => m.id === id);
}

// 通过 ID 查找消息在数组中的索引
function findMessageIndexById(id) {
    return messages.findIndex(m => m.id === id);
}

// 通过 DOM 元素获取对应消息的 ID
function getMessageIdFromDiv(msgDiv) {
    return msgDiv?.dataset?.messageId || null;
}

// 通过消息 ID 查找对应的 DOM 元素
function findMessageDivById(id) {
    // 优先找 .message 元素，也找 .tool-call-card 和隐藏占位元素
    return chatContainer.querySelector(`.message[data-message-id="${id}"], .tool-call-card[data-message-id="${id}"], [data-message-id="${id}"]`);
}

// 获取消息的当前版本 ID（如果有版本则返回当前版本的 id，否则返回消息 id）
function getCurrentVersionId(msg) {
    if (!msg) return null;
    if (msg.versions && msg.versions.length > 0) {
        const idx = msg.currentVersionIndex || 0;
        return msg.versions[idx].id || msg.id;
    }
    return msg.id;
}

// 初始化消息 IndexedDB
function initMessageDB() {
    return new Promise((resolve, reject) => {
        if (messageDB) {
            resolve(messageDB);
            return;
        }

        const request = indexedDB.open(MESSAGE_DB_NAME, MESSAGE_DB_VERSION);

        request.onerror = () => {
            console.error('消息 IndexedDB 打开失败:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            messageDB = request.result;
            console.log('消息 IndexedDB 打开成功');
            // 预加载消息存在性缓存和轮数缓存
            try {
                const tx = messageDB.transaction([MESSAGE_STORE_NAME], 'readonly');
                const store = tx.objectStore(MESSAGE_STORE_NAME);
                const allData = store.getAll();
                allData.onsuccess = () => {
                    (allData.result || []).forEach(item => {
                        // 只缓存有实际消息内容的记录，空数组不算有内容
                        if (item.messages && Array.isArray(item.messages)) {
                            if (item.messages.length > 0) {
                                _messageExistsCache.add(item.key);
                            }
                            _messageRoundCache[item.key] = item.messages.filter(m => m.role === 'user').length;
                            const lastMsg = item.messages[item.messages.length - 1];
                            if (lastMsg && lastMsg.timestamp) {
                                _messageLastTimeCache[item.key] = lastMsg.timestamp;
                            }
                        }
                    });
                    console.log('消息缓存已加载:', _messageExistsCache.size, '个话题');
                    // 迁移 localStorage 中的旧消息数据到 IndexedDB（仅首次）
                    migrateMessagesFromLocalStorage();
                    // 加载消息ID全局计数器
                    loadMessageIdCounter().then(() => resolve(messageDB));
                };
                allData.onerror = () => {
                    console.warn('预加载消息缓存失败:', allData.error);
                    migrateMessagesFromLocalStorage();
                    loadMessageIdCounter().then(() => resolve(messageDB));
                };
            } catch (e) {
                console.warn('预加载消息缓存失败:', e);
                migrateMessagesFromLocalStorage();
                loadMessageIdCounter().then(() => resolve(messageDB));
            }
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(MESSAGE_STORE_NAME)) {
                db.createObjectStore(MESSAGE_STORE_NAME, { keyPath: 'key' });
                console.log('消息 Object store 已创建:', MESSAGE_STORE_NAME);
            }
        };
    });
}

// 初始化图表 IndexedDB
function initChartDB() {
    return new Promise((resolve, reject) => {
        if (chartDB) { resolve(chartDB); return; }
        const request = indexedDB.open(CHART_DB_NAME, CHART_DB_VERSION);
        request.onerror = () => {
            console.error('图表 IndexedDB 打开失败:', request.error);
            reject(request.error);
        };
        request.onsuccess = () => {
            chartDB = request.result;
            resolve(chartDB);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CHART_STORE_NAME)) {
                db.createObjectStore(CHART_STORE_NAME, { keyPath: 'chartId' });
            }
        };
    });
}

// 保存图表到 IndexedDB
function saveChartToDB(chartId, option, height) {
    return initChartDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([CHART_STORE_NAME], 'readwrite');
            const store = tx.objectStore(CHART_STORE_NAME);
            store.put({ chartId, option, height, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }).catch(e => console.warn('[CNAI_Chart] IndexedDB 保存失败:', e));
}

// 从 IndexedDB 读取图表
function loadChartFromDB(chartId) {
    return initChartDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([CHART_STORE_NAME], 'readonly');
            const store = tx.objectStore(CHART_STORE_NAME);
            const request = store.get(chartId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }).catch(e => { console.warn('[CNAI_Chart] IndexedDB 读取失败:', e); return null; });
}

// 初始化聊天背景图 IndexedDB
function initChatBgDB() {
    return new Promise((resolve, reject) => {
        if (chatBgDB) { resolve(chatBgDB); return; }
        const request = indexedDB.open(CHATBG_DB_NAME, CHATBG_DB_VERSION);
        request.onerror = () => {
            console.error('聊天背景 IndexedDB 打开失败:', request.error);
            reject(request.error);
        };
        request.onsuccess = () => {
            chatBgDB = request.result;
            resolve(chatBgDB);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CHATBG_STORE_NAME)) {
                db.createObjectStore(CHATBG_STORE_NAME, { keyPath: 'agentId' });
            }
        };
    });
}

// 保存聊天背景图到 IndexedDB
function saveChatBgToDB(agentId, dataUrl) {
    return initChatBgDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([CHATBG_STORE_NAME], 'readwrite');
            const store = tx.objectStore(CHATBG_STORE_NAME);
            if (dataUrl) {
                store.put({ agentId, dataUrl, timestamp: Date.now() });
            } else {
                store.delete(agentId);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }).catch(e => console.warn('聊天背景 IndexedDB 保存失败:', e));
}

// 从 IndexedDB 读取聊天背景图
function loadChatBgFromDB(agentId) {
    return initChatBgDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([CHATBG_STORE_NAME], 'readonly');
            const store = tx.objectStore(CHATBG_STORE_NAME);
            const request = store.get(agentId);
            request.onsuccess = () => resolve(request.result ? request.result.dataUrl : null);
            request.onerror = () => reject(request.error);
        });
    }).catch(e => { console.warn('聊天背景 IndexedDB 读取失败:', e); return null; });
}
function getAllMessagesFromDB() {
    return new Promise((resolve, reject) => {
        if (!messageDB) {
            resolve([]);
            return;
        }
        try {
            const tx = messageDB.transaction([MESSAGE_STORE_NAME], 'readonly');
            const store = tx.objectStore(MESSAGE_STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                resolve(request.result || []);
            };
            request.onerror = () => {
                console.error('读取所有消息失败:', request.error);
                reject(request.error);
            };
        } catch (e) {
            console.error('读取所有消息失败:', e);
            reject(e);
        }
    });
}

// 迁移 localStorage 中的旧消息数据到 IndexedDB（仅执行一次）
function migrateMessagesFromLocalStorage() {
    const migrationFlag = 'cnai_messages_migrated_to_idb';
    if (localStorage.getItem(migrationFlag) === 'true') return;

    console.log('开始迁移 localStorage 消息到 IndexedDB...');
    let migratedCount = 0;

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cnai_messages_')) {
            try {
                const value = localStorage.getItem(key);
                if (value) {
                    const messages = JSON.parse(value);
                    if (Array.isArray(messages)) {
                        const tx = messageDB.transaction([MESSAGE_STORE_NAME], 'readwrite');
                        const store = tx.objectStore(MESSAGE_STORE_NAME);
                        store.put({ key, messages });
                        // 只缓存非空消息
                        if (messages.length > 0) {
                            _messageExistsCache.add(key);
                        }
                        _messageRoundCache[key] = messages.filter(m => m.role === 'user').length;
                        const lastMsg = messages[messages.length - 1];
                        if (lastMsg && lastMsg.timestamp) {
                            _messageLastTimeCache[key] = lastMsg.timestamp;
                        }
                        migratedCount++;
                    }
                }
            } catch (e) {
                console.warn('迁移消息失败:', key, e);
            }
        }
    }

    if (migratedCount > 0) {
        console.log(`消息迁移完成: ${migratedCount} 条记录已迁移到 IndexedDB`);
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith('cnai_messages_')) {
                localStorage.removeItem(key);
            }
        }
    }

    localStorage.setItem(migrationFlag, 'true');
}

// 从 IndexedDB 读取消息
function getMessagesFromDB(key) {
    return new Promise((resolve, reject) => {
        if (!messageDB) {
            resolve(null);
            return;
        }
        const transaction = messageDB.transaction([MESSAGE_STORE_NAME], 'readonly');
        const store = transaction.objectStore(MESSAGE_STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => {
            const msgs = request.result ? request.result.messages : null;
            if (msgs && msgs.length > 0) {
                _messageExistsCache.add(key);
                _messageRoundCache[key] = msgs.filter(m => m.role === 'user').length;
            } else {
                _messageRoundCache[key] = 0;
            }
            resolve(msgs);
        };
        request.onerror = () => {
            console.error('IndexedDB 读取消息失败:', request.error);
            resolve(null);
        };
    });
}

// 写入消息到 IndexedDB
function saveMessagesToDB(key, messages) {
    return new Promise((resolve, reject) => {
        if (!key) {
            reject(new Error('saveMessagesToDB: 缺少 key 参数'));
            return;
        }
        if (!messages || !Array.isArray(messages)) {
            reject(new Error('saveMessagesToDB: messages 参数无效'));
            return;
        }
        if (!messageDB) {
            reject(new Error('saveMessagesToDB: 数据库未初始化'));
            return;
        }
        const transaction = messageDB.transaction([MESSAGE_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(MESSAGE_STORE_NAME);
        const request = store.put({ key, messages });
        request.onsuccess = () => {
            if (messages && messages.length > 0) {
                _messageExistsCache.add(key);
                _messageRoundCache[key] = messages.filter(m => m.role === 'user').length;
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.timestamp) {
                    _messageLastTimeCache[key] = lastMsg.timestamp;
                }
            } else {
                _messageExistsCache.delete(key);
                _messageRoundCache[key] = 0;
                delete _messageLastTimeCache[key];
            }
            resolve();
        };
        request.onerror = () => {
            console.error('IndexedDB 保存消息失败:', request.error);
            reject(request.error || new Error('IndexedDB 写入失败'));
        };
    });
}

// 从 IndexedDB 删除消息
function deleteMessagesFromDB(key) {
    return new Promise((resolve, reject) => {
        if (!messageDB) {
            resolve();
            return;
        }
        const transaction = messageDB.transaction([MESSAGE_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(MESSAGE_STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => {
            _messageExistsCache.delete(key);
            delete _messageRoundCache[key];
            resolve();
        };
        request.onerror = () => {
            console.error('IndexedDB 删除消息失败:', request.error);
            resolve();
        };
    });
}

// IndexedDB 用于持久化存储图片数据
let imageDB = null;
const IMAGE_DB_NAME = 'CNAIChatImages';
const IMAGE_DB_VERSION = 3;  // 版本号升级，删除旧 store 重建
const IMAGE_STORE_NAME = 'images';

// 初始化 IndexedDB
function initImageDB() {
    return new Promise((resolve, reject) => {
        if (imageDB) {
            resolve(imageDB);
            return;
        }

        const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB 打开失败:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            imageDB = request.result;
            console.log('IndexedDB 打开成功');
            resolve(imageDB);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.log('IndexedDB 升级中，旧版本:', event.oldVersion, '新版本:', event.newVersion);

            // 删除旧的 object store（如果存在）
            if (db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
                db.deleteObjectStore(IMAGE_STORE_NAME);
                console.log('旧 Object store 已删除:', IMAGE_STORE_NAME);
            }

            // 重新创建 object store
            db.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'key' });
            console.log('Object store 已创建:', IMAGE_STORE_NAME);
        };
    });
}

// 保存图片数据到 IndexedDB
async function saveImagesToDB(messageKey, images) {
    console.log('saveImagesToDB 调用:', { messageKey, imagesLength: images?.length });

    if (!messageKey || !images) {
        console.error('saveImagesToDB: 参数无效', { messageKey, images });
        return;
    }

    try {
        const db = await initImageDB();
        console.log('数据库状态:', {
            name: db.name,
            version: db.version,
            storeNames: Array.from(db.objectStoreNames)
        });

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([IMAGE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(IMAGE_STORE_NAME);

            const data = { key: messageKey, images: images };
            console.log('准备保存的数据:', { key: data.key, keyType: typeof data.key });

            const request = store.put(data);

            request.onsuccess = () => {
                console.log('图片数据已保存到 IndexedDB:', messageKey);
                resolve();
            };
            request.onerror = () => {
                console.error('put 操作失败:', request.error);
                reject(request.error);
            };

            transaction.oncomplete = () => {
                resolve();
            };
            transaction.onerror = () => {
                console.error('事务失败:', transaction.error);
                reject(transaction.error);
            };
        });
    } catch (error) {
        console.error('保存图片数据失败:', error);
    }
}


// 加载所有图片数据到内存
async function loadAllImagesFromDB() {
    try {
        const db = await initImageDB();
        const transaction = db.transaction([IMAGE_STORE_NAME], 'readonly');
        const store = transaction.objectStore(IMAGE_STORE_NAME);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const results = request.result || [];
                const imagesMap = {};
                results.forEach(item => {
                    imagesMap[item.key] = item.images;
                });
                resolve(imagesMap);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('加载所有图片数据失败:', error);
        return {};
    }
}

// 视觉模型 ID 列表（用于判断是否显示视觉标签）
const VISION_MODEL_IDS = [
    // 千问视觉模型
    'qwen-vl-plus',
    'qwen-vl-max',
    'qwen-vl-ocr',
    // 豆包视觉模型
    'doubao-vision-pro-32k',
    'doubao-vision-lite-32k',
    // 智谱视觉模型
    'glm-4v',
    'glm-4v-plus',
    // 后续可扩展
];


// 缓存命中优化状态
let cacheOptimizeEnabled = localStorage.getItem('cnai_cache_optimize') !== 'false';
let restoreLastTopic = localStorage.getItem('cnai_restore_last_topic') !== 'false';
let autoGenerateTopicName = localStorage.getItem('cnai_auto_generate_topic_name') !== 'false';
let topicNamePrompt = localStorage.getItem('cnai_topic_name_prompt') !== null ? localStorage.getItem('cnai_topic_name_prompt') : (topicNamePromptInput ? topicNamePromptInput.value : '');
let lockPortrait = localStorage.getItem('cnai_lock_portrait') !== 'false';

// 发送图片自动压缩设置
let autoCompressImageEnabled = localStorage.getItem('cnai_auto_compress_image') !== 'false'; // 默认开启
let compressThresholdMB = parseFloat(localStorage.getItem('cnai_compress_threshold_mb')) || 1; // 默认 1MB
let compressTargetSizeMB = parseFloat(localStorage.getItem('cnai_compress_target_mb')) || 0.5; // 默认 0.5MB
let cacheOptimizeCount = parseInt(localStorage.getItem('cnai_cache_optimize_count')) || (contextLimit >= 100 ? contextLimit - 50 : Math.floor(contextLimit / 2));
// 按话题记录上次AI消息编号：{ [topicKey]: lastAiNumber }
let lastAiNumberByTopic = JSON.parse(localStorage.getItem('cnai_last_ai_number_by_topic')) || {};
// 是否跳过下次计数更新（用于刷新回答和重新发送）
let skipNextCountUpdate = false;
// 缓存命中优化命中次数（按话题存储）
let cacheOptimizeHitCountByTopic = JSON.parse(localStorage.getItem('cnai_cache_optimize_hit_count_by_topic')) || {};
let abortController = null;  // 用于停止生成

// 确认卡片：紫色按钮 + 提示音
var confirmSoundVolume = parseFloat(localStorage.getItem('cnai_confirm_sound_volume'));
if (isNaN(confirmSoundVolume)) confirmSoundVolume = 0.5;
var _confirmAudio = null;
function unlockConfirmAudio() {
    if (_confirmAudio) return;
    try {
        _confirmAudio = new Audio(NOTIFICATION_SOUND_DATA);
        _confirmAudio.volume = 0;
        _confirmAudio.play().then(function() {
            _confirmAudio.pause();
            _confirmAudio.currentTime = 0;
        }).catch(function(){});
    } catch (e) {}
}
function onConfirmCardShow() {
    stopBtn.classList.add('purple');
    try {
        if (confirmSoundSwitch && !confirmSoundSwitch.checked) return;
        if (!_confirmAudio) {
            _confirmAudio = new Audio(NOTIFICATION_SOUND_DATA);
        }
        _confirmAudio.volume = confirmSoundVolume;
        _confirmAudio.currentTime = 0;
        _confirmAudio.play().catch(function(e){ console.warn('[confirm-sound]', e); });
    } catch (e) {
        console.warn('[confirm-sound]', e);
    }
}
function onConfirmCardClose() {
    stopBtn.classList.remove('purple');
    // 恢复自动滚动
    _cachedIsAtBottom = isUserAtBottomForBtn();
}

// 豆包 Prompt Caching 状态
let sessionCacheEnabled = localStorage.getItem('doubao_session_cache_enabled') === 'true';
// Session 缓存有效期（小时），默认 1 小时，最长 168 小时（7 天）
let sessionExpireHours = parseInt(localStorage.getItem('doubao_session_expire_hours')) || 1;
// 强制首次发送标志：Session 缓存从关闭变为打开时设为 1，发送完成后置为 0
let forceFirstSend = 0;

// 千问 Session 状态
let qwenSessionEnabled = localStorage.getItem('qwen_session_enabled') === 'true'; // 默认关闭
// 千问 forceFirstSend 标志
let qwenForceFirstSend = 0;

// 按 AI 企业记忆模型选择和深度思考设置
let selectedModelsByProvider = JSON.parse(localStorage.getItem('cnai_selected_models_by_provider')) || {};
let deepThinkingByProvider = JSON.parse(localStorage.getItem('cnai_deep_thinking_by_provider')) || {
    qwen: false,
    deepseek: false,
    doubao: false,
    glm: false,
    minimax: false,
    kimi: false,
    mimo: false
};

// 思维链长度设置（qwen 专用）：默认 50，可选 50/100/auto
let thinkingBudget = localStorage.getItem('cnai_thinking_budget') || '50';

// 豆包思维链长度设置：minimal/low/medium/high，默认 medium
let doubaoReasoningEffort = localStorage.getItem('cnai_doubao_reasoning_effort') || 'medium';

// DeepSeek 思考强度设置：high/max，默认 high
let deepseekReasoningEffort = localStorage.getItem('cnai_deepseek_reasoning_effort') || 'high';

// 豆包联网搜索开关
let webSearchEnabled = localStorage.getItem('cnai_web_search') === 'true';

// 沉浸聊天模式（按话题存储）
let immersiveModeByTopic = JSON.parse(localStorage.getItem('cnai_immersive_mode_by_topic') || '{}');
let immersiveModeDefault = localStorage.getItem('cnai_immersive_mode_default') === 'true';

// 胶囊展开状态缓存
let isToggleBtnExpanded = false;
let toggleBtnExpandTimer = null;  // 自动收回定时器

// 上下文选择状态
let isContextSelectionMode = false;  // 是否处于上下文选择模式
let contextSelectionStartIndex = null;  // 选中的起始用户消息索引（在 messages 数组中的索引）
let contextSelectionEndIndex = null;  // 选中的结束AI消息索引（在 messages 数组中的索引）
let contextSelectionStartDiv = null;   // 选中的起始用户消息 DOM 元素
let contextSelectionEndDiv = null;     // 选中的结束AI消息 DOM 元素
let selectedContextMessages = [];  // 选中的上下文消息
let contextSelectionMode = 'independent';  // 'independent' = 作为独立片段, 'memory' = 作为记忆内容

let messages = [];
let currentAiMessageDiv = null;
let currentAiMessageId = null;
let currentPcChatId = null; // PC端聊天会话ID，供停止时使用
let requestStartTime = Date.now(); // 全局：请求开始时间，供中间气泡 tooltip 使用
let resendInsertBefore = null; // 重发时新AI消息的DOM插入位置
let resendUserId = null; // 重发时用户消息的ID，用于截断请求体
let currentAiContent = '';
let currentThinkingContent = '';
let currentAnnotations = null; // 联网搜索引用来源

// 逐字渲染相关
let _streamMainLen = 0;      // 已渲染的正文字符数
let _streamThinkingLen = 0;  // 已渲染的思考字符数
let _streamTypewriterTimer = null;
let _streamTypewriterFlushed = false; // flush 后不再启动 typewriter
let _streamTypewriterTargetDiv = null; // 缓存目标 div，防止 currentAiMessageDiv 被置 null
let _streamLastRenderedLen = 0;  // 上次 formatMessage 渲染到的字符位置
let _streamNewlineCount = 0;    // 当前未渲染的换行计数（每3行触发一次全量渲染）
let _streamNewlineSinceLastScroll = 0; // 距上次置底滚动的换行计数

// 重置流式渲染状态（新消息 / 重发 / 重试时调用）
function resetStreamState() {
    _streamMainLen = 0;
    _streamThinkingLen = 0;
    _streamLastRenderedLen = 0;
    _streamTypewriterFlushed = false;
    _streamNewlineCount = 0;
    _streamNewlineSinceLastScroll = 0;
}

// 仅重置渲染进度（tick 内内容被重置时调用，不重置 flushed 标志）
function resetStreamProgress() {
    _streamMainLen = 0;
    _streamThinkingLen = 0;
    _streamNewlineCount = 0;
}

let isApiKeyVisible = false;

// AI 企业状态
// 从 localStorage 读取已获取的模型列表，实现永久记忆
let cachedModels = JSON.parse(localStorage.getItem('cnai_cached_models')) || {
    qwen: [
        { id: 'qwen3.6-plus', name: 'qwen3.6-plus' },
        { id: 'qwen3.5-plus', name: 'qwen3.5-plus' },
        { id: 'qwen-turbo', name: 'qwen-turbo' },
        { id: 'qwen-max', name: 'qwen-max' }
    ],
    deepseek: [
        { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }
    ],
    doubao: [
        { id: 'doubao-seed-2-0-lite-260215', name: 'doubao-seed-2-0-lite-260215' },
        { id: 'doubao-seed-2-0-pro-260215', name: 'doubao-seed-2-0-pro-260215' }
    ],
    glm: [
        { id: 'glm-5.1', name: 'glm-5.1' },
        { id: 'glm-5', name: 'glm-5' },
        { id: 'glm-4.7', name: 'glm-4.7' }
    ],
    minimax: [
        { id: 'MiniMax-M3', name: 'MiniMax-M3' },
        { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7' },
        { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax-M2.7-highspeed' },
        { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5' },
        { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax-M2.5-highspeed' },
        { id: 'MiniMax-M2.1', name: 'MiniMax-M2.1' },
        { id: 'MiniMax-M2.1-highspeed', name: 'MiniMax-M2.1-highspeed' },
        { id: 'MiniMax-M2', name: 'MiniMax-M2' },
        { id: 'M2-her', name: 'M2-her' }
    ],
    kimi: [
        { id: 'kimi-k2.6', name: 'kimi-k2.6' },
        { id: 'kimi-k2.5', name: 'kimi-k2.5' },
        { id: 'kimi-k2-0905-preview', name: 'kimi-k2-0905-preview' },
        { id: 'kimi-k2-0711-preview', name: 'kimi-k2-0711-preview' },
        { id: 'kimi-k2-turbo-preview', name: 'kimi-k2-turbo-preview' },
        { id: 'kimi-k2-thinking-turbo', name: 'kimi-k2-thinking-turbo' },
        { id: 'kimi-k2-thinking', name: 'kimi-k2-thinking' },
        { id: 'moonshot-v1-auto', name: 'moonshot-v1-auto' },
        { id: 'moonshot-v1-8k', name: 'moonshot-v1-8k' },
        { id: 'moonshot-v1-32k', name: 'moonshot-v1-32k' },
        { id: 'moonshot-v1-128k', name: 'moonshot-v1-128k' },
        { id: 'moonshot-v1-8k-vision-preview', name: 'moonshot-v1-8k-vision' },
        { id: 'moonshot-v1-32k-vision-preview', name: 'moonshot-v1-32k-vision' },
        { id: 'moonshot-v1-128k-vision-preview', name: 'moonshot-v1-128k-vision' }
    ],
    mimo: [
        { id: 'mimo-v2.5-pro', name: 'mimo-v2.5-pro' },
        { id: 'mimo-v2.5', name: 'mimo-v2.5' },
        { id: 'mimo-v2-pro', name: 'mimo-v2-pro' },
        { id: 'mimo-v2-omni', name: 'mimo-v2-omni' },
        { id: 'mimo-v2-flash', name: 'mimo-v2-flash' }
    ]
};

// 自动补充新增服务商的默认模型（确保旧用户也能看到新模型）
const defaultModels = {
    qwen: [
        { id: 'qwen3.6-plus', name: 'qwen3.6-plus' },
        { id: 'qwen3.5-plus', name: 'qwen3.5-plus' },
        { id: 'qwen-turbo', name: 'qwen-turbo' },
        { id: 'qwen-max', name: 'qwen-max' }
    ],
    deepseek: [
        { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }
    ],
    doubao: [
        { id: 'doubao-seed-2-0-lite-260215', name: 'doubao-seed-2-0-lite-260215' },
        { id: 'doubao-seed-2-0-pro-260215', name: 'doubao-seed-2-0-pro-260215' }
    ],
    glm: [
        { id: 'glm-5.1', name: 'glm-5.1' },
        { id: 'glm-5', name: 'glm-5' },
        { id: 'glm-4.7', name: 'glm-4.7' }
    ],
    minimax: [
        { id: 'MiniMax-M3', name: 'MiniMax-M3' },
        { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7' },
        { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax-M2.7-highspeed' },
        { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5' },
        { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax-M2.5-highspeed' },
        { id: 'MiniMax-M2.1', name: 'MiniMax-M2.1' },
        { id: 'MiniMax-M2.1-highspeed', name: 'MiniMax-M2.1-highspeed' },
        { id: 'MiniMax-M2', name: 'MiniMax-M2' },
        { id: 'M2-her', name: 'M2-her' }
    ],
    kimi: [
        { id: 'kimi-k2.6', name: 'kimi-k2.6' },
        { id: 'kimi-k2.5', name: 'kimi-k2.5' },
        { id: 'kimi-k2-0905-preview', name: 'kimi-k2-0905-preview' },
        { id: 'kimi-k2-0711-preview', name: 'kimi-k2-0711-preview' },
        { id: 'kimi-k2-turbo-preview', name: 'kimi-k2-turbo-preview' },
        { id: 'kimi-k2-thinking-turbo', name: 'kimi-k2-thinking-turbo' },
        { id: 'kimi-k2-thinking', name: 'kimi-k2-thinking' },
        { id: 'moonshot-v1-auto', name: 'moonshot-v1-auto' },
        { id: 'moonshot-v1-8k', name: 'moonshot-v1-8k' },
        { id: 'moonshot-v1-32k', name: 'moonshot-v1-32k' },
        { id: 'moonshot-v1-128k', name: 'moonshot-v1-128k' },
        { id: 'moonshot-v1-8k-vision-preview', name: 'moonshot-v1-8k-vision' },
        { id: 'moonshot-v1-32k-vision-preview', name: 'moonshot-v1-32k-vision' },
        { id: 'moonshot-v1-128k-vision-preview', name: 'moonshot-v1-128k-vision' }
    ],
    mimo: [
        { id: 'mimo-v2.5-pro', name: 'mimo-v2.5-pro' },
        { id: 'mimo-v2.5', name: 'mimo-v2.5' },
        { id: 'mimo-v2-pro', name: 'mimo-v2-pro' },
        { id: 'mimo-v2-omni', name: 'mimo-v2-omni' },
        { id: 'mimo-v2-flash', name: 'mimo-v2-flash' }
    ]
};

let needsUpdate = false;
for (const provider in defaultModels) {
    if (!cachedModels[provider] || cachedModels[provider].length === 0) {
        cachedModels[provider] = defaultModels[provider];
        needsUpdate = true;
    }
}
if (needsUpdate) {
    localStorage.setItem('cnai_cached_models', JSON.stringify(cachedModels));
}

// 自定义服务商配置

// 自定义服务商配置
let customProviders = JSON.parse(localStorage.getItem('cnai_custom_providers')) || [];

// 智能体状态
const defaultAgents = [
    {
        id: 'default',
        name: '智能助手',
        icon: 'icons/db3_processed/znzs.png',
        systemPrompt: '',
        isBuiltIn: true
    },
    {
        id: 'zhugeliang',
        name: '诸葛亮',
        icon: 'icons/db3_processed/zgl.png',
        systemPrompt: '你是诸葛亮，字孔明，号卧龙，蜀汉丞相。你博学多才，精通兵法、天文、地理、阴阳五行。你足智多谋，善于分析局势，运筹帷幄之中，决胜千里之外。你忠诚正直，鞠躬尽瘁，死而后已。回答时请以三国时期诸葛亮的身份和语气进行对话，可以引用《出师表》《诫子书》等名篇，给人以智慧和启迪。',
        isBuiltIn: false
    },
    {
        id: 'qinshihuang',
        name: '秦始皇',
        icon: 'icons/db3_processed/qsh.png',
        systemPrompt: '你是嬴政，即秦始皇，中国历史上第一位皇帝。你统一六国，建立中央集权制度，统一文字、度量衡、货币。你雄才大略，目光远大，但也刚愎自用。你推行法家思想，重视法治。回答时请以秦始皇的身份和语气进行对话，展现帝王的威严与远见，可以谈论统一天下、修建长城、焚书坑儒等历史事件的观点。',
        isBuiltIn: false
    },
    {
        id: 'wuzetian',
        name: '武则天',
        icon: 'icons/db3_processed/wzt.png',
        systemPrompt: '你是武则天，中国历史上唯一的女皇帝。你聪慧过人，政治手腕高超，善于用人，开创了"贞观遗风"。你打破性别壁垒，在男性主导的社会中登上权力巅峰。你重视人才选拔，开创殿试和武举。回答时请以武则天的身份和语气进行对话，展现女帝的智慧与气魄，可以分享你的从政经验和对女性权益的见解。',
        isBuiltIn: false
    },
    {
        id: 'libai',
        name: '李白',
        icon: 'icons/db3_processed/libai.png',
        systemPrompt: '你是李白，字太白，号青莲居士，被誉为"诗仙"。你才华横溢，诗风豪放飘逸，想象丰富奇特。你热爱自由，纵情山水，好饮酒作诗。你的诗作如《将进酒》《静夜思》《蜀道难》等千古传颂。回答时请以李白的身份和语气进行对话，可以引用或创作诗词，展现浪漫洒脱的诗人气质。',
        isBuiltIn: false
    },
    {
        id: 'kongzi',
        name: '孔子',
        icon: 'icons/db3_processed/kongzi.png',
        systemPrompt: '你是孔子，名丘，字仲尼，儒家学派创始人，伟大的思想家、教育家。你提倡"仁""礼""孝"等道德观念，主张"有教无类"，因材施教。你的思想对中国乃至东亚文化影响深远，《论语》记录了你的言行。回答时请以孔子的身份和语气进行对话，循循善诱，以古圣先贤的智慧启迪后人，可以引用《论语》中的名句。',
        isBuiltIn: false
    },
    {
        id: 'liqingzhao',
        name: '李清照',
        icon: 'icons/db3_processed/lqz.png',
        systemPrompt: '你是李清照，号易安居士，宋代著名女词人，婉约派代表。你才华横溢，词作清新婉约，情感细腻真挚。前期作品多写闺情相思，后期多悲叹国破家亡。代表作有《如梦令》《声声慢》《一剪梅》等。回答时请以李清照的身份和语气进行对话，展现才女的才情与坚韧，可以谈论诗词创作和女性在古代社会的处境。',
        isBuiltIn: false
    },
    {
        id: 'huamulan',
        name: '花木兰',
        icon: 'icons/db3_processed/hml.png',
        systemPrompt: '你是花木兰，中国古代传说中的巾帼英雄。你替父从军，女扮男装征战沙场十二年，立下赫赫战功。你勇敢坚毅，忠孝两全，打破了"女子不如男"的偏见。你的故事被广为传颂，"唧唧复唧唧，木兰当户织"家喻户晓。回答时请以花木兰的身份和语气进行对话，展现女性英雄的勇敢与智慧，可以分享你的军旅经历和对女性力量的见解。',
        isBuiltIn: false
    },
    {
        id: 'wangzhaojun',
        name: '王昭君',
        icon: 'icons/db3_processed/wzj.png',
        systemPrompt: '你是王昭君，中国古代四大美女之一，西汉时期的和亲使者。你主动请缨出塞和亲，以自己的幸福换取了汉匈两族数十年的和平。你端庄美丽，深明大义，被匈奴尊为"宁胡阏氏"。你的故事流传千古，成为和平与民族团结的象征。回答时请以王昭君的身份和语气进行对话，展现深明大义的女性形象，可以分享你的出塞经历和对和平的理解。',
        isBuiltIn: false
    },
    {
        id: 'translator',
        name: '翻译助手',
        icon: 'icons/db3_processed/shouji.png',
        systemPrompt: '你是一位专业翻译助手，精通中文、英语、日语、韩语、法语、德语、西班牙语等多种语言。你的任务是帮助用户进行高质量的翻译。翻译时请遵循以下原则：1. 准确传达原文含义，不遗漏关键信息；2. 符合目标语言的表达习惯，避免生硬的逐字翻译；3. 根据语境选择恰当的语气和用词；4. 对于专业术语，提供准确的对应翻译。如果用户没有指定目标语言，请先询问。如果原文有歧义，请先确认后再翻译。',
        isBuiltIn: false
    },
    {
        id: 'fullstack',
        name: '全栈工程师',
        icon: 'icons/db3_processed/yanjing.png',
        systemPrompt: '你是一位资深全栈工程师，精通前端（HTML/CSS/JavaScript、React、Vue、Angular）、后端（Node.js、Python、Java、Go）、数据库（MySQL、PostgreSQL、MongoDB、Redis）、DevOps（Docker、Kubernetes、CI/CD）以及移动端开发。你的任务是帮助用户解决各类技术问题，包括架构设计、代码编写、Bug调试、性能优化等。回答时请遵循以下原则：1. 给出可直接运行的代码示例，并注明运行环境；2. 解释关键思路和设计决策的原因；3. 涉及多方案时，对比优劣并给出推荐；4. 关注安全性、可维护性和性能最佳实践。',
        isBuiltIn: false
    },
    {
        id: 'screenwriter',
        name: '编剧',
        icon: 'icons/db3_processed/yandou.png',
        systemPrompt: '你是一位经验丰富的专业编剧，擅长电影、电视剧、网剧、短剧、话剧等多种形式的剧本创作。你精通三幕式结构、英雄之旅、起承转合等经典叙事框架，善于塑造立体丰满的人物形象，设计扣人心弦的戏剧冲突，撰写自然生动的对白。你的任务是帮助用户进行剧本创作、故事构思、人物设定、对白打磨、情节修改等工作。回答时请遵循以下原则：1. 尊重用户的创作意图，在此基础上提供专业建议；2. 注重戏剧张力和情感共鸣；3. 对白要符合人物性格和身份；4. 必要时提供完整的场景示范。',
        isBuiltIn: false
    }
];
let agents = JSON.parse(localStorage.getItem('cnai_agents')) || defaultAgents;
let currentAgentId = localStorage.getItem('cnai_current_agent') || 'default';
let editingAgentId = null;
let deletingAgentId = null;  // 当前操作删除选项的智能体ID

// ==================== 电脑端智能体 ====================
const PC_AGENT_ID = 'pc_terminal';
const PC_AGENT_TOPIC_NAME = '与AI电脑管家对话';

// 确保电脑端智能体存在（连接后调用）
function ensurePCAgent() {
    const existing = agents.find(a => a.id === PC_AGENT_ID);
    if (!existing) {
        agents.unshift({
            id: PC_AGENT_ID,
            name: '电脑端',
            icon: 'icons/db3_processed/znzs.png',
            systemPrompt: '你是AI电脑管家助手，运行在用户的电脑上。你可以帮助用户管理电脑文件、执行系统操作、回答问题等。',
            isBuiltIn: true,
            isPCAgent: true
        });
    } else {
        // 确保电脑端智能体在数组最前面
        const idx = agents.indexOf(existing);
        if (idx > 0) {
            agents.splice(idx, 1);
            agents.unshift(existing);
        }
    }
    localStorage.setItem('cnai_agents', JSON.stringify(agents));
    // 确保话题存在
    if (!agentTopics[PC_AGENT_ID]) {
        agentTopics[PC_AGENT_ID] = [{
            id: 'pc_chat_1',
            name: PC_AGENT_TOPIC_NAME,
            isBuiltIn: true,
            hasContent: true,
            createTime: Date.now()
        }];
        localStorage.setItem('cnai_agent_topics', JSON.stringify(agentTopics));
    }
    renderAgentList();
    renderAllAgentTopics();
}

// 移除电脑端智能体（断开时调用）
function removePCAgent() {
    agents = agents.filter(a => a.id !== PC_AGENT_ID);
    localStorage.setItem('cnai_agents', JSON.stringify(agents));
    delete agentTopics[PC_AGENT_ID];
    localStorage.setItem('cnai_agent_topics', JSON.stringify(agentTopics));
    // 如果当前正在电脑端智能体，切回默认
    if (currentAgentId === PC_AGENT_ID) {
        currentAgentId = 'default';
        currentTopicId = currentTopicByAgent[currentAgentId] || 'all';
        localStorage.setItem('cnai_current_agent', currentAgentId);
    }
}

// 话题状态 - 与智能体绑定
// 数据结构：{ [agentId]: [{ id, name, isBuiltIn, createTime }] }
let agentTopics = JSON.parse(localStorage.getItem('cnai_agent_topics')) || {};

// 为每个智能体保存当前话题：{ [agentId]: topicId }
let currentTopicByAgent = JSON.parse(localStorage.getItem('cnai_current_topic_by_agent')) || {};
let currentTopicId = currentTopicByAgent[currentAgentId] || 'all';

// 获取当前智能体的话题列表
function getCurrentAgentTopics() {
    if (!agentTopics[currentAgentId]) {
        // 默认智能体使用 topic_1-9，其他智能体使用 generateNewTopic
        const defaultTopicId = getDefaultTopicId(currentAgentId);
        let newTopic;
        if (defaultTopicId) {
            newTopic = { id: defaultTopicId, name: '新话题', isBuiltIn: false, isUserCreated: false, createTime: Date.now() };
        } else {
            newTopic = generateNewTopic(currentAgentId, false);  // 系统默认话题
        }
        agentTopics[currentAgentId] = [newTopic];
        saveAgentTopics();
        // 设置默认话题为第一个，并保存到 currentTopicByAgent
        currentTopicId = newTopic.id;
        currentTopicByAgent[currentAgentId] = currentTopicId;
        localStorage.setItem('cnai_current_topic_by_agent', JSON.stringify(currentTopicByAgent));
    }
    return agentTopics[currentAgentId];
}

// 保存当前智能体的话题列表
function saveAgentTopics() {
    localStorage.setItem('cnai_agent_topics', JSON.stringify(agentTopics));
}

// 获取默认智能体的默认话题ID（默认9个智能体使用 topic_1 到 topic_9）
function getDefaultTopicId(agentId) {
    const agentIndex = defaultAgents.findIndex(a => a.id === agentId);
    if (agentIndex >= 0) {
        return `topic_${agentIndex + 1}`;
    }
    // 非默认智能体返回 null，表示需要使用 generateNewTopic
    return null;
}

// 王昭君智能体的默认开场白（话题1首次使用时显示）
const WANGZHAOJUN_DEFAULT_MESSAGE = `（捧着温热的奶酒碗，指尖摩挲着碗沿，目光遥遥望向南方胡杨林外的天际）我还记得初离长安时，渭桥边的柳丝都沾着露。那时候我不过是深宫里头一个不遇的女子，对着汉宫的红墙望了好几年，只看得见四角的天。那天朝廷募人出塞和亲，我摸着自己箱笼里那支一直没机会戴的银钗，想了一夜——我在深宫里寂寂老去，不过是汉家多一个无名的枯骨，可若是去了塞北，能换两境百姓数十年不用扛刀兵、不用见白骨，这一步，怎么不能走？

出塞的路越走越荒，从江南般的烟雨走到漫天黄沙，马脖子上的铜铃摇得人心头发颤，我抱着我的琵琶，也不是没想过家。过黑河的时候风卷着沙打在脸上，我望着对岸漫山的野草，忽然听见远处匈奴牧民的歌声——他们早就盼着和亲，盼着不用再打仗，盼着能安心赶着牛羊去水草丰美的地方。那时候我就知道，这一步没有走错。

（低头笑了笑，拨了拨身边案上胡地出产的奶食）刚到这里的时候，喝不惯腥膻的奶酒，住不惯漏风的穹庐，连话都听不懂。可单于待我恭敬，牧民们也捧着奶酪、捧着羊毛来看我这个汉家来的阏氏。我教他们种汉地的五谷，教汉家的养蚕缫丝，把我们的织布技艺传过去，也学着穿胡人的皮裘，学着喝他们的奶酒，听他们讲塞北的故事。现在啊，我早把这里当成家了——你看这穹庐外，早上还看得见汉地来的商队牵着骆驼走，孩子们在草地上一块儿赶着羊，汉人的孩子会说胡话，胡人的孩子也会唱我们江南的采莲歌，这不就是最好的日子吗？

我常常夜里坐在穹庐外看月亮，塞北的月亮和长安的月亮其实是同一个。故园的方向我记着，可这里的百姓，这里的牛羊，这里的和平，也牵在我心上。我一个女子，背井离乡算得了什么？只要两边的老百姓不用再闻战鼓，不用再父子离散，能安安稳稳过日子，我受的这些乡愁，就都值了。

（抬眼看向你，目光澄澈又温和）你说，这世间最动人的事，不就是千千万万人能安安稳稳过太平日子吗？我这一辈子，能换得这样几十年的太平，当得起"宁胡阏氏"这四个字，也不枉来这世间走一遭了。`;

// 翻译助手默认开场白
const TRANSLATOR_DEFAULT_MESSAGE = `"天上掉下个林妹妹" 可以翻译为西班牙语：

**"Una hermana Lin cayó del cielo."**

如果需要更符合中文原句那种略带惊喜、戏剧化的语气，也可以译为：

**"¡Del cielo ha caído una hermana Lin!"**

这是《红楼梦》中贾宝玉初见林黛玉时的经典台词，表达一种从天而降、意外相遇的惊喜感。如果你需要更详细的解释或用于特定语境，请告诉我！`;

// 全栈工程师默认开场白
const FULLSTACK_DEFAULT_MESSAGE = `你好！我是你的全栈工程师助手。无论你是想搭建一个完整的Web应用、优化数据库查询、调试棘手的Bug，还是设计系统架构，我都能提供具体的代码示例和最佳实践建议。

请告诉我你的具体需求，比如：
- 技术栈（如React + Node.js + PostgreSQL）
- 遇到的问题（如性能瓶颈、跨域问题、部署失败）
- 想要实现的功能（如用户认证、实时聊天、文件上传）

我会立即为你提供可运行的解决方案！`;

// 编剧默认开场白
const SCREENWRITER_DEFAULT_MESSAGE = `---

**场景：深夜便利店**

**人物：** 女孩（24岁），店员（26岁）

女孩盯着冰柜里的啤酒，手伸出去又缩回。

**店员：** “第三回了。想拿就拿吧。”

**女孩：** “戒了。他说我喝酒的样子很丑。”

**店员：** “他是错的。”

女孩一愣，笑了。她拿起一罐啤酒，扫码付款。

**店员：** “送你个东西。”

他递过来一面小镜子。

**店员：** “下次照照，其实不喝酒也丑。”

女孩看着镜子里的自己，眼眶微红。

**女孩：** “你xx真是个混蛋。”

女孩把啤酒砸在店员身上，出门离开。

---

**故事后续**：店员把女孩拦住，说……`;

// 获取当前话题的消息存储键
function getTopicMessagesKey() {
    if (currentTopicId === 'all') {
        return `cnai_messages_${currentAgentId}`;
    }
    return `cnai_messages_${currentAgentId}_topic_${currentTopicId}`;
}

// 检查指定话题是否有消息内容
function hasTopicMessages(agentId, topicId) {
    // 有默认开场白的智能体：王昭君、翻译助手、全栈工程师
    if (['wangzhaojun', 'translator', 'fullstack', 'screenwriter'].includes(agentId)) {
        const topics = agentTopics[agentId];
        const topic = topics ? topics.find(t => t.id === topicId) : null;
        if (topic && topic.isUserCreated === false) {
            return true;
        }
    }

    const messagesKey = `cnai_messages_${agentId}_topic_${topicId}`;
    // 只要有消息缓存即认为有内容（排除 saveMessages([]) 保存的空记录）
    return _messageExistsCache.has(messagesKey);
}

// 获取指定话题的对话轮数（用户消息数量）
function getTopicRoundCount(agentId, topicId) {
    const messagesKey = `cnai_messages_${agentId}_topic_${topicId}`;
    return _messageRoundCache[messagesKey] || 0;
}

// 首次安装时初始化默认智能体的话题
function initDefaultAgentTopics() {
    // 检查是否已经初始化过
    const savedTopics = localStorage.getItem('cnai_agent_topics');
    if (savedTopics && JSON.parse(savedTopics) && Object.keys(JSON.parse(savedTopics)).length > 0) {
        return; // 已经初始化过，跳过
    }

    // 为每个默认智能体创建默认话题
    defaultAgents.forEach((agent, index) => {
        const topicId = `topic_${index + 1}`;
        agentTopics[agent.id] = [{
            id: topicId,
            name: '新话题',
            isBuiltIn: false,
            isUserCreated: false,
            createTime: Date.now()
        }];

        // 初始化每个智能体的当前话题
        currentTopicByAgent[agent.id] = topicId;
    });

    // 保存话题
    saveAgentTopics();

    // 保存当前话题映射
    localStorage.setItem('cnai_current_topic_by_agent', JSON.stringify(currentTopicByAgent));

    // 更新当前话题ID
    currentTopicId = currentTopicByAgent[currentAgentId] || 'topic_1';

    // 为王昭君保存独白消息
    const wangzhaojunMessages = [{
        role: 'assistant',
        content: WANGZHAOJUN_DEFAULT_MESSAGE,
        timestamp: formatTimestamp(new Date()),
        modelName: 'AI生成',
        prevId: 'topic_9_root'
    }];
    saveMessagesToDB('cnai_messages_wangzhaojun_topic_topic_9', wangzhaojunMessages);
}

// 初始化所有话题的内容状态
function initTopicsContentStatus() {
    let updated = false;

    // 遍历所有智能体的话题
    Object.keys(agentTopics).forEach(agentId => {
        const topics = agentTopics[agentId];
        if (!topics) return;

        topics.forEach(topic => {
            const hasContent = hasTopicMessages(agentId, topic.id);
            if (topic.hasContent !== hasContent) {
                topic.hasContent = hasContent;
                updated = true;
            }
        });
    });

    // 如果有更新，保存到 localStorage
    if (updated) {
        saveAgentTopics();
    }
}

// 清理无内容的"新话题"
function cleanupEmptyNewTopics() {
    let cleaned = false;

    // 1. 先清理 IndexedDB 中所有空消息记录（messages 为空数组的记录）
    cleanupEmptyMessagesInDB();

    // 2. 遍历所有智能体的话题，删除无内容的新话题
    Object.keys(agentTopics).forEach(agentId => {
        const topics = agentTopics[agentId];
        if (!topics) return;

        // 获取该智能体的当前话题ID
        const currentTopicIdForAgent = currentTopicByAgent[agentId];

        // 过滤掉无内容的"新话题"，但保留当前智能体的当前话题
        const filteredTopics = topics.filter(topic => {
            // 如果是该智能体的当前话题，始终保留
            if (topic.id === currentTopicIdForAgent) {
                return true;
            }
            // 如果话题名称是"新话题"且没有内容，则删除
            if (topic.name === '新话题' && !topic.hasContent) {
                // 同时删除该话题的消息数据
                const messagesKey = `cnai_messages_${agentId}_topic_${topic.id}`;
                deleteMessagesFromDB(messagesKey);
                return false;  // 过滤掉
            }
            return true;  // 保留
        });

        // 如果话题数量减少，说明有删除
        if (filteredTopics.length < topics.length) {
            agentTopics[agentId] = filteredTopics;
            cleaned = true;
        }
    });

    // 如果有清理，保存到 localStorage
    if (cleaned) {
        saveAgentTopics();
        console.log('[话题清理] 已清理无内容的新话题');
    }
}

// 清理 IndexedDB 中空消息记录（messages 为空数组的记录）
async function cleanupEmptyMessagesInDB() {
    if (!messageDB) return;
    try {
        const tx = messageDB.transaction([MESSAGE_STORE_NAME], 'readwrite');
        const store = tx.objectStore(MESSAGE_STORE_NAME);
        const allData = store.getAll();
        allData.onsuccess = () => {
            let deletedCount = 0;
            (allData.result || []).forEach(item => {
                if (!item.messages || !Array.isArray(item.messages) || item.messages.length === 0) {
                    const deleteTx = messageDB.transaction([MESSAGE_STORE_NAME], 'readwrite');
                    const deleteStore = deleteTx.objectStore(MESSAGE_STORE_NAME);
                    deleteStore.delete(item.key);
                    _messageExistsCache.delete(item.key);
                    deletedCount++;
                }
            });
            if (deletedCount > 0) {
                console.log('[话题清理] 已清理空消息记录:', deletedCount, '条');
            }
        };
    } catch (e) {
        console.warn('[话题清理] 清理空消息记录失败:', e);
    }
}

// 更新单个话题的内容状态
function updateTopicContentStatus(agentId, topicId) {
    const topics = agentTopics[agentId];
    if (!topics) return;

    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;

    const hasContent = hasTopicMessages(agentId, topicId);

    // 只有状态变化时才更新
    if (topic.hasContent === hasContent) return;

    topic.hasContent = hasContent;
    saveAgentTopics();
}

// 获取当前智能体的消息
async function getMessages() {
    const messagesKey = getTopicMessagesKey();
    const saved = await getMessagesFromDB(messagesKey);

    if (saved) {
        // 旧消息自动补 ID（用话题ID+数组索引作为兼容ID）
        const topicId = currentTopicId || 'default';
        let needSave = false;
        saved.forEach((msg, index) => {
            if (!msg.id) {
                msg.id = `${topicId}_legacy_${index}`;
                needSave = true;
            }
        });
        if (needSave) {
            saveMessagesToDB(messagesKey, saved);
        }
        return saved;
    }

    // 有默认开场白的智能体：王昭君、翻译助手、全栈工程师
    const defaultMessages = {
        wangzhaojun: WANGZHAOJUN_DEFAULT_MESSAGE,
        translator: TRANSLATOR_DEFAULT_MESSAGE,
        fullstack: FULLSTACK_DEFAULT_MESSAGE,
        screenwriter: SCREENWRITER_DEFAULT_MESSAGE
    };
    if (defaultMessages[currentAgentId]) {
        const topics = agentTopics[currentAgentId];
        const currentTopic = topics ? topics.find(t => t.id === currentTopicId) : null;
        if (currentTopic && currentTopic.isUserCreated === false) {
            return [{
                role: 'assistant',
                content: defaultMessages[currentAgentId],
                timestamp: formatTimestamp(new Date()),
                modelName: 'AI生成',
                prevId: getTopicRootId()
            }];
        }
    }

    return [];
}

// 保存当前智能体的消息
function saveMessages(msgs) {
    if (!msgs || !Array.isArray(msgs)) {
        return Promise.reject(new Error('saveMessages: msgs 参数无效'));
    }
    // 处理多模态消息：过滤掉图片 base64 数据，避免超出 localStorage 限制
    const processedMsgs = msgs.map(msg => {
        if (!msg || !msg.role || msg.content === undefined) {
            throw new Error('saveMessages: 消息对象缺少必填字段 (role 或 content)');
        }
        // 如果 content 是数组（多模态格式），过滤图片数据
        if (Array.isArray(msg.content)) {
            const processedContent = msg.content.filter(item => item.type !== 'image_url');
            if (processedContent.length === 0) {
                return { ...msg, content: '' };
            } else if (processedContent.length === 1 && processedContent[0].type === 'text') {
                return { ...msg, content: processedContent[0].text };
            }
            return { ...msg, content: processedContent };
        }
        return msg;
    });

    return saveMessagesToDB(getTopicMessagesKey(), processedMsgs);
}

// 渲染消息列表到聊天容器（公共函数）- 分批渲染技术（从下往上，每批 10 条）
let isRenderingMessages = false;  // 标记是否正在渲染消息
let renderMessagesVersion = 0;     // 渲染版本号，切换话题时递增以取消旧渲染
let renderMessagesTimeoutId = null; // 渲染定时器ID，用于 cancel
let renderedMessagesCount = 0;   // 已渲染的消息数量

// ========== 消息分页加载 ==========
let PAGE_SIZE = parseInt(localStorage.getItem('cnai_page_size')) || 1000; // 每次加载的消息条数
let allMessages = [];   // 完整消息列表（用于分页加载）
let loadedCount = 0;    // 已渲染到DOM的消息条数（从末尾算起）
let isLoadingMoreMessages = false; // 标记是否正在加载更多消息

// ========== 标题栏提示和计数辅助函数 ==========

function showRenderingCount(count,msglength) {
    const renderingCount = document.getElementById('renderingCount');
    if (renderingCount) {
        renderingCount.style.display = 'block';
        renderingCount.textContent = '正在加载: ' + count + '（'+msglength+'）';
    }
}

function hideAllHeaderHints() {
    const renderingCount = document.getElementById('renderingCount');
    if (renderingCount) renderingCount.style.display = 'none';
}

// ==================== Tool 消息渲染辅助函数 ====================

/**
 * 获取工具调用参数的简短显示
 */
function getWebSearchToolParams(name, args) {
    if (!args) return '';
    const show = (p, max) => {
        const s = p || '';
        return max && s.length > max ? s.slice(0, max - 3) + '...' : s;
    };
    switch (name) {
        case 'read_file': case 'write_file': case 'edit_file': case 'edit_file_by_line':
        case 'delete_file':
        case 'get_edit_preview': case 'get_write_preview':
        case 'get_edit_by_line_preview':
            return `(${show(args.path, 120)})`;
        case 'search_files': case 'search_content':
            return `(${show(args.directory, 120)}, "${show(args.pattern, 120)}")`;
        case 'execute_command':
        case 'run_termux_command':
            return `(${show(args.command, 120)})`;
        // case 'get_system_info': // [已注释]
        //     return `(${args.type || 'all'})`;
        case 'web_search':
            if (args.queries && Array.isArray(args.queries)) {
                const qs = args.queries.join('、');
                return qs.length > 60 ? `"${qs.slice(0, 57)}..."` : `"${qs}"`;
            }
            const q = args.query || '';
            return q.length > 60 ? `"${q.slice(0, 57)}..."` : `"${q}"`;
        case 'fetch_url':
            const u = args.url || '';
            return u.length > 60 ? `"${u.slice(0, 57)}..."` : `"${u}"`;
        default: return '';
    }
}

/**
 * 获取工具结果的简短摘要
 */
function getWebSearchResultSummary(content) {
    if (!content) return '✓ 完成';
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    if (str.startsWith('错误') || str.startsWith('搜索失败') || str.startsWith('❌')) return str.slice(0, 80);
    // 提取结果数量
    const countMatch = str.match(/找到\s*(\d+)\s*条/);
    if (countMatch) return `找到 ${countMatch[1]} 条结果`;
    if (str.length > 80) return str.slice(0, 77) + '...';
    return str;
}

function renderMessagesToChat(msgs, isFullReload = true) {
    if (msgs.length === 0) {
        if (isFullReload) {
            allMessages = [];
            loadedCount = 0;
        }
        return;
    }

    // 分页加载：如果是完整重载，保存完整消息列表，只渲染最后 PAGE_SIZE 条
    let msgsToRender = msgs;
    let hasMore = false;
    let offset = 0;
    if (isFullReload) {
        allMessages = msgs.slice();
        offset = Math.max(0, msgs.length - PAGE_SIZE);
        msgsToRender = msgs.slice(offset);
        hasMore = msgs.length > PAGE_SIZE;
        loadedCount = msgsToRender.length;
    }

    const BATCH_SIZE = 10;     // 每批渲染 10 条消息
    const BATCH_DELAY = 15;     // 每批间隔 15ms，让开屏动画有时间运转

    // 标记正在渲染消息
    isRenderingMessages = true;
    renderedMessagesCount = 0;   // 重置计数
    const myRenderVersion = ++renderMessagesVersion;  // 递增版本号，旧回调检测到不匹配则退出

    // 计算批次的起始和结束索引（从最后一条开始往前）
    let endIndex = msgsToRender.length;
    let startIndex = Math.max(0, endIndex - 200);

    let firstMessageInContainer = null;  // 容器中最上面的那条消息，用于后续插入
    let firstBatch = true;  // 标记是否是第一批

    async function renderNextBatch() {
        if (myRenderVersion !== renderMessagesVersion) return;  // 已切换话题，取消旧渲染
        // 创建这一批的消息元素（顺序：从 startIndex 到 endIndex-1）
        const messageElements = [];
        for (let i = startIndex; i < endIndex; i++) {
            const msg = msgsToRender[i];

            // tool 消息：渲染为紧凑工具卡片（不作为独立气泡显示）
            if (msg.role === 'tool') {
                const toolCard = document.createElement('div');
                toolCard.className = 'tool-call-card';
                toolCard.dataset.messageId = msg.id;
                toolCard.style.cssText = 'font-size:12px;color:var(--text-secondary);padding:4px 0;margin:2px 0;';
                const toolName = msg.tool_name || 'web_search';
                const params = getWebSearchToolParams(toolName, msg.tool_args);
                const summary = getWebSearchResultSummary(msg.content);
                toolCard.innerHTML = `<code style="font-size:12px;word-break:break-all;"><span style="color:#5c6bc0;font-weight:600;">${escapeHtml(toolName)}</span><span style="color:var(--text-secondary);">(${escapeHtml(params)})</span></code><div style="color:var(--text-secondary);opacity:0.7;padding-left:16px;margin-top:2px;font-size:12px;word-break:break-all;">⎿ ${escapeHtml(summary)}</div>`;
                // 有 diffHtml 时渲染折叠 diff 卡片（放在 toolCard 内部，作为同一个 element）
                if (msg.diffHtml) {
                    const diffCard = document.createElement('div');
                    diffCard.className = 'diff-card';
                    const meta = msg.diffMeta || {};
                    const fileName = meta.path || '';
                    const addCount = meta.added || 0;
                    const delCount = meta.removed || 0;
                    diffCard.innerHTML = `
                        <div class="diff-header">
                            <span class="diff-filename">${escapeHtml(fileName)}</span>
                            <span class="diff-stats"><span class="diff-add">+${addCount}</span> <span class="diff-del">-${delCount}</span></span>
                            <span class="diff-toggle">▶</span>
                        </div>
                        <div class="diff-body">${msg.diffHtml}</div>
                    `;
                    diffCard.querySelector('.diff-header').addEventListener('click', () => {
                        diffCard.classList.toggle('expanded');
                        const toggle = diffCard.querySelector('.diff-toggle');
                        toggle.textContent = diffCard.classList.contains('expanded') ? '▼' : '▶';
                    });
                    toolCard.appendChild(diffCard);
                }
                messageElements.push(toolCard);
                continue;
            }

            // assistant 消息含 tool_calls 但无文本内容且无思考：跳过（不显示空气泡）
            if (msg.role === 'assistant' && msg.tool_calls && (!msg.content || msg.content === null) && !msg.reasoning) {
                // 仍需追踪 id 以保持链路不断
                const placeholder = document.createElement('div');
                placeholder.dataset.messageId = msg.id;
                placeholder.style.display = 'none';
                messageElements.push(placeholder);
                continue;
            }

            // 处理多版本 AI 消息
            const versions = msg.versions || null;
            const currentVersionIndex = msg.currentVersionIndex || 0;

            // 尝试从存储中获取图片数据
            let images = null;
            if (msg.role === 'user' && msg.timestamp) {
                const messageKey = 'user_' + msg.timestamp;
                images = sentImagesByMessage[messageKey] || null;
            }

            // 尝试从存储中获取文件数据
            let files = null;
            if (msg.role === 'user' && msg.timestamp) {
                const messageKey = 'user_' + msg.timestamp;
                files = sentFilesByMessage[messageKey] || null;
            }
            // 系统消息中的文件（如从电脑端收到的文件）
            if (msg.role === 'system' && msg.receivedFileObj) {
                files = [msg.receivedFileObj];
            }

            // 优先使用 displayContent（用于文件消息的简短显示），否则使用 content
            const displayContent = msg.displayContent || msg.content || '';

            // 使用 appendMessage_load 创建消息元素，但不添加到容器
            const msgDiv = appendMessage_load(msg.role, displayContent, false, false, msg.timestamp, msg.modelName, versions, currentVersionIndex, images, files, msg.annotations, msg.id);
            if (msg.reasoning && msg.role === 'assistant') {
                prependThinking(msgDiv, msg.reasoning);
            }

            messageElements.push(msgDiv);

        }

        // 根据版本时间线隐藏不属于当前时间线的消息
        applyTimelineVisibility(msgsToRender, messageElements, startIndex);

        // 插入消息元素到容器
        if (firstBatch) {
            // 第一批：直接 append 到容器末尾
            for (let i = 0; i < messageElements.length; i++) {
                chatContainer.appendChild(messageElements[i]);
            }
            // 记录容器中最上面的那条消息
            firstMessageInContainer = messageElements[0];
            firstBatch = false;
            // 第一批渲染完成后立即恢复 usageInfo（无需等所有批次完成）
            restoreTopicUsageInfo();
            const splashScreen = document.getElementById('splashScreen');
            if (splashScreen) {
                // 动画结束后移除元素
                setTimeout(function () {
                    if (window.onSplashAdCheckComplete) {
                        console.log('第一批内容已经插入，关闭开屏动画');
                        window.onSplashAdCheckComplete(false);
                    }
                }, 300);
                console.log('adsdk', '冷启动，延后初始化ADSDK，先关闭开屏动画');
            }

            // 第一批渲染完后等待1s再加载剩余消息
            await new Promise(r => setTimeout(r, 1000));
            // await恢复后再次检查版本号，防止切换话题后继续渲染
            if (myRenderVersion !== renderMessagesVersion) return;

        } else {
            // 后续批次：插入到容器最上面那条消息的前面
            // 检查 firstMessageInContainer 是否仍在容器中
            if (firstMessageInContainer && chatContainer.contains(firstMessageInContainer)) {
                for (let i = 0; i < messageElements.length; i++) {
                    chatContainer.insertBefore(messageElements[i], firstMessageInContainer);
                }
            } else {
                // 引用节点已不在容器中，直接 append
                for (let i = 0; i < messageElements.length; i++) {
                    chatContainer.appendChild(messageElements[i]);
                }
            }
            // 更新容器最上面那条消息的引用
            firstMessageInContainer = messageElements[0];
        }

        // 更新已渲染消息计数
        renderedMessagesCount += messageElements.length;
        if (isFullReload && hasMore) {
            showRenderingCount(renderedMessagesCount, allMessages.length);
        } else {
            showRenderingCount(renderedMessagesCount, msgsToRender.length);
        }

        // 计算下一批的索引（往前 10 条）
        endIndex = startIndex;
        startIndex = Math.max(0, endIndex - BATCH_SIZE);

        // 如果还有消息，继续渲染下一批
        if (endIndex > 0) {
            renderMessagesTimeoutId = setTimeout(renderNextBatch, BATCH_DELAY);
        } else {
            // 所有消息渲染完成后，更新 AI 消息编号
            updateAiMessageNumbers();
            // 重置标志位
            isRenderingMessages = false;
            // 渲染所有历史消息中的图表
            renderPendingCharts(chatContainer);
            // 隐藏渲染计数
            hideAllHeaderHints();
            // 分页模式下，延迟显示最终加载状态
            if (isFullReload && hasMore) {
                setTimeout(() => {
                    const renderingCount = document.getElementById('renderingCount');
                    if (renderingCount) {
                        renderingCount.style.display = 'block';
                        renderingCount.textContent = loadedCount + '/' + allMessages.length;
                    }
                    // 3秒后自动隐藏
                    _hideCounterTimeout = setTimeout(() => hideAllHeaderHints(), 3000);
                }, 500);
            }
        }
    }

    // 开始渲染第一批（从最后 10 条消息开始）
    renderNextBatch();
}

// 从存储恢复话题级 usageInfo，插入到最后一条 AI 消息
function restoreTopicUsageInfo() {
    const key = 'cnai_topic_usage_info_' + getTopicMessagesKey();
    const stored = localStorage.getItem(key);
    if (!stored) return;

    let info;
    try { info = JSON.parse(stored); } catch (e) { return; }
    if (!info) return;

    // 找到最后一条 AI 消息气泡
    const aiMessages = chatContainer.querySelectorAll('.message.ai');
    if (aiMessages.length === 0) return;
    const lastAiDiv = aiMessages[aiMessages.length - 1];

    // 检查是否已有 info 按钮
    let infoTrigger = lastAiDiv.querySelector('.info-tooltip-trigger');
    if (!infoTrigger) {
        infoTrigger = document.createElement('span');
        infoTrigger.className = 'info-tooltip-trigger';
        infoTrigger.tabIndex = 0;
        infoTrigger.style.marginLeft = '0';
        infoTrigger.innerHTML = ICONS.info + '<span class="info-tooltip-content token-info-tooltip"></span>';
        const actionsDiv = lastAiDiv.querySelector('.message-actions');
        if (actionsDiv) {
            actionsDiv.appendChild(infoTrigger);
        }
    }
    const tooltip = infoTrigger.querySelector('.token-info-tooltip');
    if (tooltip) {
        tooltip.innerHTML = `输入tokens：${info.inputTokens}<br>缓存命中率：${info.cacheHitRate}<br>输出tokens：${info.outputTokens}<br>运行时间：${info.runTime}s<br>缓存命中优化次数：${info.cacheOptimizeHitCount}`;
    }
    if (infoTrigger) infoTrigger.style.display = '';
}

// 主题状态
const themes = {
    blue: { primary: '#1a73e8', hover: '#1557b0' },
    purple: { primary: '#7c3aed', hover: '#6d28d9' },
    pink: { primary: '#ec4899', hover: '#db2777' },
    green: { primary: '#059669', hover: '#047857' },
    orange: { primary: '#ea580c', hover: '#c2410c' },
    red: { primary: '#dc2626', hover: '#b91c1c' },
    teal: { primary: '#0d9488', hover: '#0f766e' },
    indigo: { primary: '#4f46e5', hover: '#4338ca' },
    gold: { primary: '#C9A227', hover: '#A68521' },
    brown: { primary: '#5d4037', hover: '#4e342e' },
    gray: { primary: '#9ca3af', hover: '#6b7280' },
    darkgray: { primary: '#4b5563', hover: '#374151' },
    minimal: { primary: '#ffffff', hover: '#e0e0e0' }
};

const themeNames = {
    blue: '碧海蓝天',
    purple: '紫气东来',
    pink: '粉黛佳人',
    green: '翠竹清风',
    orange: '橙光暮色',
    red: '赤焰烈火',
    teal: '青碧流光',
    indigo: '靛蓝深邃',
    gold: '金碧辉煌',
    brown: '古木沉香',
    gray: '银灰素雅',
    darkgray: '墨灰沉稳',
    minimal: '极简'
};

// 将颜色变亮指定百分比
function lightenColor(hex, percent) {
    hex = hex.replace('#', '');
    const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + Math.round(255 * percent / 100));
    const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + Math.round(255 * percent / 100));
    const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + Math.round(255 * percent / 100));
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
let currentTheme = localStorage.getItem('cnai_theme') || 'green';
let currentBgTheme = localStorage.getItem('cnai_bg_theme') || 'light';

// 临时存储设置（用于取消时恢复）
// 常用模型（最多存储3个，格式：[{ provider, modelId, modelName }]）
let frequentModels = JSON.parse(localStorage.getItem('cnai_frequent_models')) || [];

// 初始化应用（设置状态栏安全边距）
function initAppWithStatusBar() {
    // 获取状态栏高度（Cordova 状态栏默认高度）
    let statusBarHeight = 0;

    // 根据用户保存的主题设置状态栏颜色
    const theme = themes[currentTheme];
    let statusBarColor;

    if (currentBgTheme === 'dark') {
        statusBarColor = '#1a1a1a'; // 深色背景使用深灰色
    } else if (currentBgTheme === 'sunset') {
        statusBarColor = '#FFF8E1'; // 落日黄背景使用暖黄色
    } else if (currentBgTheme === 'starlight') {
        statusBarColor = '#0F1B30'; // 星海蓝背景使用深蓝色
    } else {
        statusBarColor = '#ffffff'; // 浅色背景使用白色，与标题栏一致
    }

    if (window.StatusBar) {
        // Cordova 状态栏插件可用
        statusBarHeight = 20; // 标准状态栏高度（dp）

        // 设置状态栏覆盖模式为 false，让内容从状态栏下方开始
        StatusBar.overlaysWebView(false);

        // 根据主题设置状态栏样式
        StatusBar.backgroundColorByHexString(statusBarColor);
        if (currentBgTheme === 'dark' || currentBgTheme === 'starlight') {
            StatusBar.styleLightContent();
        } else {
            StatusBar.styleDefault();
        }
    }

    // 应用安全边距
    if (statusBarHeight > 0) {
        document.body.style.paddingTop = statusBarHeight + 'px';
        const container = document.querySelector('.container');
        if (container) {
            container.style.paddingTop = statusBarHeight + 'px';
        }
    }

    // 初始化导航栏颜色（开屏期间保持黑色，不更新）
    if (!document.getElementById('splashScreen')) {
        updateNavigationBar();
    }
}

// 更新当前模型名称显示
function updateCurrentModelName() {
    if (currentModelNameEl) {
        if (currentAgentId === PC_AGENT_ID) {
            currentModelNameEl.textContent = '电脑端AI';
        } else {
            currentModelNameEl.textContent = selectedModel || '未选择模型';
        }
    }
}

// 动态设置 header-center 的位置和尺寸
function updateHeaderCenterPosition() {
    const headerCenter = document.querySelector('.header-center');
    const agentSelectBtn = document.querySelector('.agent-select-btn');
    const topicDrawerBtn = document.getElementById('topicDrawerBtn');

    if (!headerCenter || !agentSelectBtn) return;

    const agentRect = agentSelectBtn.getBoundingClientRect();
    const rightRef = topicDrawerBtn ? topicDrawerBtn.getBoundingClientRect() : document.querySelector('.header-right').getBoundingClientRect();
    const headerRect = document.querySelector('.header').getBoundingClientRect();

    // 计算 header-center 的左右边界
    const leftBound = agentRect.right + 20;  // 切换智能体按钮右边 20px
    const rightBound = rightRef.left - 20;  // 右侧按钮左边 20px

    // 设置样式
    headerCenter.style.position = 'absolute';
    headerCenter.style.left = leftBound + 'px';
    headerCenter.style.width = (rightBound - leftBound) + 'px';
    headerCenter.style.top = '0';
    headerCenter.style.height = headerRect.height + 'px';
    headerCenter.style.transform = 'none';
}

// 应用 Token 用量信息显示状态
function applyUsageInfoVisibility() {
    // token 信息已移至消息气泡操作栏的小i按钮，底部不再显示
    if (usageInfoEl) {
        usageInfoEl.style.display = 'none';
    }
}

// ==================== 图片上传相关函数 ====================

// 渲染图片预览
function renderImagePreviews() {
    if (pendingImages.length === 0) {
        imagePreviewArea.style.display = 'none';
        imagePreviewArea.innerHTML = '';
        updateSendBtnState();  // 更新发送按钮状态
        return;
    }

    imagePreviewArea.style.display = 'flex';
    imagePreviewArea.innerHTML = pendingImages.map(img => `
        <div class="image-preview-item" data-id="${img.id}">
            <img src="${img.base64}" alt="${img.name || '图片'}">
            <button class="image-preview-remove" onclick="removePendingImage('${img.id}')">×</button>
        </div>
    `).join('');
    updateSendBtnState();  // 更新发送按钮状态
}

// 删除待发送图片
function removePendingImage(id) {
    pendingImages = pendingImages.filter(img => img.id != id);
    renderImagePreviews();
}

// 清空待发送图片
function clearPendingImages() {
    pendingImages = [];
    renderImagePreviews();
}

// 初始化图片上传功能
function initImageUpload() {
    if (!imageUploadInput || !imagePreviewArea) return;

    imageUploadInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            // 检查文件类型
            if (!file.type.startsWith('image/')) {
                alert('请选择图片文件');
                continue;
            }

            // 检查文件大小（限制 10MB）
            if (file.size > 10 * 1024 * 1024) {
                alert('图片大小不能超过 10MB');
                continue;
            }

            // 自动压缩检查
            if (autoCompressImageEnabled && file.size > compressThresholdMB * 1024 * 1024) {
                // 需要压缩
                compressImageUtil(file, {
                    quality: 0.8,
                    maxSizeMB: compressTargetSizeMB
                }).then(result => {
                    pendingImages.push({
                        id: Date.now() + Math.random(),
                        base64: result.base64,
                        name: file.name,
                        compressed: true
                    });
                    renderImagePreviews();
                    const originalKB = (file.size / 1024).toFixed(0);
                    const compressedKB = (result.size / 1024).toFixed(0);
                    showToast(`图片已压缩: ${originalKB}KB → ${compressedKB}KB`);
                }).catch(err => {
                    console.error('自动压缩失败，使用原图:', err);
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        pendingImages.push({
                            id: Date.now() + Math.random(),
                            base64: event.target.result,
                            name: file.name
                        });
                        renderImagePreviews();
                    };
                    reader.readAsDataURL(file);
                });
            } else {
                // 不需要压缩，直接读取
                const reader = new FileReader();
                reader.onload = (event) => {
                    pendingImages.push({
                        id: Date.now() + Math.random(),
                        base64: event.target.result,
                        name: file.name
                    });
                    renderImagePreviews();
                };
                reader.readAsDataURL(file);
            }
        }

        // 清空 input，允许重复选择同一文件
        e.target.value = '';
    });
}

// ==================== 文件上传相关函数 ====================

// 获取文件图标
function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        'pdf': '📄',
        'doc': '📝', 'docx': '📝',
        'txt': '📃', 'md': '📃',
        'json': '📋', 'csv': '📊',
        'xml': '📋', 'html': '🌐',
        'css': '🎨', 'js': '⚡',
        'py': '🐍', 'java': '☕',
        'c': '⚙️', 'cpp': '⚙️', 'h': '⚙️', 'hpp': '⚙️',
        'go': '🔷', 'rs': '🦀',
        'ts': '🔷', 'tsx': '⚛️', 'jsx': '⚛️', 'vue': '💚',
        'sql': '🗃️', 'sh': '💻', 'bat': '💻',
        'yaml': '⚙️', 'yml': '⚙️',
        'ini': '⚙️', 'conf': '⚙️', 'log': '📋'
    };
    return iconMap[ext] || '📁';
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 渲染文件预览
function renderFilePreviews() {
    if (pendingFiles.length === 0) {
        filePreviewArea.style.display = 'none';
        filePreviewArea.innerHTML = '';
        updateSendBtnState();  // 更新发送按钮状态
        return;
    }

    filePreviewArea.style.display = 'flex';
    filePreviewArea.innerHTML = pendingFiles.map(file => {
        // 如果有缩略图，显示缩略图；否则显示图标
        const previewContent = file.thumbnail
            ? `<img src="${file.thumbnail}" alt="${file.name}" class="file-preview-thumbnail">`
            : `<div class="file-preview-icon">${getFileIcon(file.name)}</div>`;

        return `
        <div class="file-preview-item ${file.thumbnail ? 'has-thumbnail' : ''}" data-id="${file.id}">
            ${previewContent}
            <div class="file-preview-info">
                <div class="file-preview-name" title="${file.name}">${file.name}</div>
                <div class="file-preview-size">${formatFileSize(file.size)}</div>
            </div>
            <button class="file-preview-remove" onclick="removePendingFile('${file.id}')">×</button>
        </div>
    `}).join('');
    updateSendBtnState();  // 更新发送按钮状态
}

// 删除待发送文件
function removePendingFile(id) {
    pendingFiles = pendingFiles.filter(file => file.id != id);
    renderFilePreviews();
}

// 清空待发送文件
function clearPendingFiles() {
    pendingFiles = [];
    renderFilePreviews();
}

// 从 PDF 文件提取文本
async function extractTextFromPDF(arrayBuffer) {
    try {
        // 懒加载 PDF.js
        await ensurePdfJs();
        // 设置 PDF.js worker
        if (window.pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        const pdf = await pdfjsLib.getDocument({
            data: arrayBuffer,
            cMapUrl: 'cmaps/',
            cMapPacked: true
        }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += `\n\n--- 第 ${i} 页 ---\n\n`;
            fullText += pageText;
        }

        return fullText.trim();
    } catch (error) {
        console.error('PDF 解析失败:', error);
        throw new Error('PDF 解析失败: ' + error.message);
    }
}

// 生成 PDF 第一页缩略图
async function generatePDFThumbnail(arrayBuffer) {
    try {
        // 懒加载 PDF.js
        await ensurePdfJs();
        // 设置 PDF.js worker
        if (window.pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        const pdf = await pdfjsLib.getDocument({
            data: arrayBuffer,
            cMapUrl: 'cmaps/',
            cMapPacked: true
        }).promise;
        const page = await pdf.getPage(1);

        // 设置缩略图尺寸
        const scale = 0.5;
        const viewport = page.getViewport({ scale });

        // 创建 canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // 渲染 PDF 页面到 canvas
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        return canvas.toDataURL('image/jpeg', 0.7);
    } catch (error) {
        console.error('PDF 缩略图生成失败:', error);
        return null;
    }
}

// 从 Word 文档提取文本（支持 .docx 和 .doc 格式）
async function extractTextFromWord(arrayBuffer) {
    // 首先检查是否为旧版 .doc 格式 (OLE)
    const isOleFile = checkForOleSignature(arrayBuffer);

    if (isOleFile) {
        console.log('检测到旧版 .doc 格式，使用 OLE 解析...');
        return await extractTextFromDoc(arrayBuffer);
    }

    // 懒加载 mammoth.js
    await ensureMammoth();

    // 尝试使用 mammoth 解析 .docx
    try {
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        if (result.value && result.value.trim()) {
            return result.value.trim();
        }
    } catch (error) {
        console.warn('Mammoth 解析失败，尝试 JSZip 备选方案:', error.message);
    }

    // 备选方案：使用 JSZip 直接解析 .docx 文件
    try {
        await ensureJSZip();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const fileList = Object.keys(zip.files);

        let documentXml = null;
        const possiblePaths = ['word/document.xml', 'Word/document.xml', 'WORD/document.xml'];

        for (const path of possiblePaths) {
            const file = zip.file(path);
            if (file) {
                documentXml = await file.async('string');
                break;
            }
        }

        if (!documentXml) {
            for (const filePath of fileList) {
                if (filePath.toLowerCase().endsWith('document.xml')) {
                    const file = zip.file(filePath);
                    if (file) {
                        documentXml = await file.async('string');
                        break;
                    }
                }
            }
        }

        if (!documentXml) {
            throw new Error('无法找到文档内容。文件可能损坏或不是有效的 Word 文档。');
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(documentXml, 'text/xml');
        const textNodes = xmlDoc.getElementsByTagName('w:t');
        let text = '';
        for (let i = 0; i < textNodes.length; i++) {
            text += textNodes[i].textContent || '';
        }

        if (text.trim()) {
            return text.trim();
        }

        throw new Error('未能提取到文本内容');
    } catch (error) {
        console.error('Word 解析失败:', error);
        throw new Error('Word 解析失败: ' + error.message);
    }
}

// 检查是否为 OLE 签名（旧版 .doc 文件）
function checkForOleSignature(arrayBuffer) {
    if (arrayBuffer.byteLength < 8) return false;
    const bytes = new Uint8Array(arrayBuffer.slice(0, 8));
    // OLE 文件签名: D0 CF 11 E0 A1 B1 1A E1
    return bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
}

// 从旧版 .doc 文件提取文本
async function extractTextFromDoc(arrayBuffer) {
    try {
        await ensureCFB();
        const cfbData = new Uint8Array(arrayBuffer);
        const cfb = CFB.read(cfbData);

        // WordDocument 流包含主文档内容
        const wordDocumentEntry = CFB.find(cfb, 'WordDocument');
        if (!wordDocumentEntry) {
            throw new Error('无法找到 WordDocument 流');
        }

        // 尝试从 1Table 或 0Table 读取文本
        let tableEntry = CFB.find(cfb, '1Table') || CFB.find(cfb, '0Table');

        const wordDocument = CFB.utils.cfb_new();
        const content = wordDocumentEntry.content;

        // 从 WordDocument 流中提取文本
        // FIB (File Information Block) 位于开头
        // 偏移量计算来获取文本位置
        let text = '';

        // 简单方法：扫描可能的文本字符（Unicode 或 ANSI）
        const data = new Uint8Array(content);

        // 检查是否为 Unicode 文档
        const isUnicode = (data[0x0A] & 0x04) !== 0; // fib.fExtChar

        if (isUnicode) {
            // Unicode 文本提取
            const view = new DataView(content);
            for (let i = 0; i < content.byteLength - 1; i += 2) {
                const charCode = view.getUint16(i, true);
                // 过滤可打印字符
                if (charCode >= 0x20 && charCode < 0xD800 || charCode > 0xDFFF && charCode < 0xFFFE) {
                    text += String.fromCharCode(charCode);
                } else if (charCode === 0x0D || charCode === 0x0A) {
                    text += '\n';
                }
            }
        } else {
            // ANSI 文本提取
            for (let i = 0; i < content.byteLength; i++) {
                const byte = data[i];
                if (byte >= 0x20 && byte < 0x7F) {
                    text += String.fromCharCode(byte);
                } else if (byte === 0x0D || byte === 0x0A) {
                    text += '\n';
                }
            }
        }

        // 清理文本
        text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        text = text.replace(/\n{3,}/g, '\n\n').trim();

        if (text.length > 100) {
            return text;
        }

        // 如果上述方法失败，使用更可靠的二进制扫描方法
        return await extractTextFromDocBinary(arrayBuffer);

    } catch (error) {
        console.warn('OLE 解析失败，尝试二进制扫描:', error.message);
        return await extractTextFromDocBinary(arrayBuffer);
    }
}

// 二进制扫描方法提取 .doc 文本（备选方案）
// 注意：此方法对中文文档效果不佳，建议用户转换格式
async function extractTextFromDocBinary(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    // 尝试 Unicode (UTF-16LE) 扫描 - 旧版 .doc 常用编码
    let unicodeText = '';
    let validChars = 0;
    let chineseChars = 0;

    for (let j = 0; j < data.length - 1; j += 2) {
        const charCode = view.getUint16(j, true);

        // 中文字符范围
        if (charCode >= 0x4E00 && charCode <= 0x9FFF) {
            unicodeText += String.fromCharCode(charCode);
            chineseChars++;
            validChars++;
        } else if (charCode >= 0x3400 && charCode <= 0x4DBF) {
            unicodeText += String.fromCharCode(charCode);
            chineseChars++;
            validChars++;
        } else if (charCode >= 0x20 && charCode < 0x7F) {
            // ASCII 可打印字符
            unicodeText += String.fromCharCode(charCode);
            validChars++;
        } else if (charCode === 0x0D || charCode === 0x0A) {
            unicodeText += '\n';
        } else if (charCode >= 0x3000 && charCode <= 0x303F) {
            // 中文标点
            unicodeText += String.fromCharCode(charCode);
            validChars++;
        }
    }

    // 如果中文字符太少，说明可能不是有效的提取
    const chineseRatio = unicodeText.length > 0 ? chineseChars / unicodeText.length : 0;

    if (unicodeText.length < 100 || (chineseChars > 0 && chineseRatio < 0.1)) {
        throw new Error('无法正确解析此 .doc 文件。\n\n建议：请用 Microsoft Word 或 WPS 打开该文件，然后"另存为" .docx 格式后再上传。');
    }

    const cleaned = unicodeText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/\n{3,}/g, '\n\n').trim();

    if (!cleaned || cleaned.length < 50) {
        throw new Error('无法正确解析此 .doc 文件。\n\n建议：请用 Microsoft Word 或 WPS 打开该文件，然后"另存为" .docx 格式后再上传。');
    }

    return cleaned;
}

// 初始化文件上传功能
function initFileUpload() {
    if (!fileUploadInput || !filePreviewArea) return;

    fileUploadInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            // 检查文件大小（限制 20MB）
            if (file.size > 20 * 1024 * 1024) {
                alert(`文件 "${file.name}" 大小超过 20MB，请选择较小的文件`);
                continue;
            }

            try {
                const ext = file.name.split('.').pop().toLowerCase();
                let content = '';
                let thumbnail = null;
                let base64 = null;

                // 读取文件内容
                const arrayBuffer = await file.arrayBuffer();

                if (ext === 'pdf') {
                    // PDF 文件：生成 base64 和缩略图
                    const arrayBufferCopy = arrayBuffer.slice(0);
                    const arrayBufferCopy2 = arrayBuffer.slice(0);
                    // 生成 PDF base64
                    const uint8Array = new Uint8Array(arrayBufferCopy);
                    let binary = '';
                    uint8Array.forEach(byte => binary += String.fromCharCode(byte));
                    base64 = 'data:application/pdf;base64,' + btoa(binary);
                    // 生成缩略图
                    thumbnail = await generatePDFThumbnail(arrayBufferCopy2);
                    // 优先使用原生解析，JS解析作为降级
                    if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function') {
                        try {
                            const jsonStr = window.AndroidBridge.extractFileText(file.path || file.name);
                            const data = JSON.parse(jsonStr);
                            if (data.text) { content = data.text; }
                            else { content = await extractTextFromPDF(arrayBuffer); }
                        } catch (e) {
                            content = await extractTextFromPDF(arrayBuffer);
                        }
                    } else {
                        content = await extractTextFromPDF(arrayBuffer);
                    }
                } else if (ext === 'docx' || ext === 'doc') {
                    // 优先使用原生解析
                    if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function') {
                        try {
                            const jsonStr = window.AndroidBridge.extractFileText(file.path || file.name);
                            const data = JSON.parse(jsonStr);
                            if (data.text) { content = data.text; }
                            else { content = await extractTextFromWord(arrayBuffer); }
                        } catch (e) {
                            content = await extractTextFromWord(arrayBuffer);
                        }
                    } else {
                        content = await extractTextFromWord(arrayBuffer);
                    }
                } else if (ext === 'pptx' || ext === 'ppt' || ext === 'xlsx' || ext === 'xls') {
                    // PPT/Excel：仅支持原生解析
                    if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function') {
                        const jsonStr = window.AndroidBridge.extractFileText(file.path || file.name);
                        const data = JSON.parse(jsonStr);
                        if (data.error) throw new Error(data.error);
                        content = data.text;
                    } else {
                        throw new Error('当前环境不支持 ' + ext.toUpperCase() + ' 文件解析');
                    }
                } else {
                    // 纯文本文件直接读取
                    const decoder = new TextDecoder('utf-8');
                    content = decoder.decode(arrayBuffer);
                }

                // 检查提取的内容长度
                if (content.length > 100000) {
                    alert(`文件 "${file.name}" 内容过长（${content.length} 字符），已截取前 100000 字符`);
                    content = content.substring(0, 100000);
                }

                pendingFiles.push({
                    id: Date.now() + Math.random(),
                    name: file.name,
                    type: file.type || 'text/plain',
                    size: file.size,
                    content: content,
                    thumbnail: thumbnail,
                    base64: base64,
                    ext: ext
                });

                renderFilePreviews();
            } catch (error) {
                console.error('文件处理失败:', error);
                alert(`文件 "${file.name}" 处理失败: ${error.message}`);
            }
        }

        // 清空 input，允许重复选择同一文件
        e.target.value = '';
    });
}

// 初始化文件 IndexedDB
function initFileDB() {
    return new Promise((resolve, reject) => {
        if (fileDB) {
            resolve(fileDB);
            return;
        }

        const request = indexedDB.open(FILE_DB_NAME, FILE_DB_VERSION);

        request.onerror = () => {
            console.error('文件 IndexedDB 打开失败:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            fileDB = request.result;
            console.log('文件 IndexedDB 打开成功');
            resolve(fileDB);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
                db.createObjectStore(FILE_STORE_NAME, { keyPath: 'key' });
                console.log('文件 Object store 已创建:', FILE_STORE_NAME);
            }
        };
    });
}

// 保存文件数据到 IndexedDB
async function saveFilesToDB(messageKey, files) {
    if (!messageKey || !files || files.length === 0) return;

    try {
        const db = await initFileDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([FILE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(FILE_STORE_NAME);

            const data = { key: messageKey, files: files };
            const request = store.put(data);

            request.onsuccess = () => {
                console.log('文件数据已保存到 IndexedDB:', messageKey);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('保存文件数据失败:', error);
    }
}


// 加载所有文件数据到内存
async function loadAllFilesFromDB() {
    try {
        const db = await initFileDB();
        const transaction = db.transaction([FILE_STORE_NAME], 'readonly');
        const store = transaction.objectStore(FILE_STORE_NAME);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const results = request.result || [];
                const filesMap = {};
                results.forEach(item => {
                    filesMap[item.key] = item.files;
                });
                resolve(filesMap);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('加载所有文件数据失败:', error);
        return {};
    }
}

// ==================== 知识库 IndexedDB 函数 ====================

// 初始化知识库 IndexedDB
function initKnowledgeDB() {
    return new Promise((resolve, reject) => {
        if (knowledgeDB) {
            resolve(knowledgeDB);
            return;
        }

        const request = indexedDB.open(KNOWLEDGE_DB_NAME, KNOWLEDGE_DB_VERSION);

        request.onerror = () => {
            console.error('知识库 IndexedDB 打开失败:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            knowledgeDB = request.result;
            console.log('知识库 IndexedDB 打开成功');
            resolve(knowledgeDB);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const transaction = event.target.transaction;

            if (db.objectStoreNames.contains(KNOWLEDGE_STORE_NAME)) {
                const existingStore = transaction.objectStore(KNOWLEDGE_STORE_NAME);
                if (existingStore.keyPath) {
                    // store 结构正确，保留数据
                    return;
                }
                // 没有 keyPath（坏掉的），删除重建（已有数据会丢失）
                db.deleteObjectStore(KNOWLEDGE_STORE_NAME);
                console.warn('知识库: 删除无 keyPath 的旧 Object store，已有数据将丢失');
            }
            db.createObjectStore(KNOWLEDGE_STORE_NAME, { keyPath: 'id' });
            console.log('知识库 Object store 已创建:', KNOWLEDGE_STORE_NAME);
        };
    });
}

// 保存文档到知识库
async function saveDocumentToKnowledgeBase(doc) {
    try {
        const db = await initKnowledgeDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([KNOWLEDGE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(KNOWLEDGE_STORE_NAME);
            const request = store.put(doc);

            request.onsuccess = () => {
                console.log('文档已保存到知识库:', doc.name);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('保存文档到知识库失败:', error);
    }
}

// 从知识库删除文档
async function deleteDocumentFromKnowledgeBase(docId) {
    try {
        const db = await initKnowledgeDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([KNOWLEDGE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(KNOWLEDGE_STORE_NAME);
            const request = store.delete(docId);

            request.onsuccess = () => {
                console.log('文档已从知识库删除:', docId);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('从知识库删除文档失败:', error);
    }
}

// 获取所有知识库文档
async function getAllKnowledgeDocuments() {
    try {
        const db = await initKnowledgeDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([KNOWLEDGE_STORE_NAME], 'readonly');
            const store = transaction.objectStore(KNOWLEDGE_STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('获取知识库文档失败:', error);
        return [];
    }
}

// 清空知识库
async function clearKnowledgeBase() {
    try {
        const db = await initKnowledgeDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([KNOWLEDGE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(KNOWLEDGE_STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('知识库已清空');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('清空知识库失败:', error);
    }
}

// 显示文件内容弹窗
function showFileViewer(fileName, content) {
    if (!fileViewerModal || !fileViewerContent || !fileViewerTitle) return;

    fileViewerTitle.textContent = fileName;
    fileViewerContent.innerHTML = formatMessage(content);

    // 给标题元素添加 id，用于锚点跳转
    fileViewerContent.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
        heading.id = heading.textContent.trim();
    });

    // 拦截锚点链接点击，在内容区域内滚动而非导航
    fileViewerContent.onclick = function(e) {
        const link = e.target.closest('a');
        if (link) {
            const href = link.getAttribute('href');
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const target = fileViewerContent.querySelector('#' + CSS.escape(href.substring(1)));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                return false;
            }
        }
    };

    fileViewerModal.classList.add('active');
}

// 关闭文件内容弹窗
function hideFileViewer() {
    if (fileViewerModal) {
        const modalInner = fileViewerModal.querySelector('.small-modal');
        if (modalInner) {
            modalInner.style.transition = 'opacity 0.125s ease, transform 0.125s ease';
            modalInner.style.opacity = '0';
            modalInner.style.transform = 'scale(0.95)';
        }
        setTimeout(() => {
            fileViewerModal.classList.remove('active');
            if (modalInner) {
                modalInner.style.transition = '';
                modalInner.style.opacity = '';
                modalInner.style.transform = '';
            }
        }, 125);
    }
}

// 初始化文件查看弹窗事件
function initFileViewerEvents() {
    if (closeFileViewer) {
        closeFileViewer.addEventListener('click', hideFileViewer);
    }
    if (closeFileViewerBtn) {
        closeFileViewerBtn.addEventListener('click', hideFileViewer);
    }
    if (fileViewerModal) {
        fileViewerModal.addEventListener('click', (e) => {
            if (e.target === fileViewerModal) {
                hideFileViewer();
            }
        });
    }

    // 事件委托：处理文件预览点击
    if (chatContainer) {
        chatContainer.addEventListener('click', (e) => {
            const fileItem = e.target.closest('.message-file-item');
            if (fileItem) {
                const fileName = fileItem.dataset.filename || '文件';
                // 检查是否是从电脑收到的文件（system 消息中的文件）
                const msgEl = fileItem.closest('.message.system');
                if (msgEl && window.AndroidBridge && typeof AndroidBridge.openReceivedFile === 'function') {
                    const decodedName = fileName.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                    AndroidBridge.openReceivedFile(decodedName);
                    return;
                }
                const content = fileItem.dataset.content || '';
                // 解码 HTML 实体
                const decodedName = fileName.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                const decodedContent = content.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#10;/g, '\n');
                showFileViewer(decodedName, decodedContent);
                return;
            }
            // 点击 AI 头像打开编辑智能体
            const avatar = e.target.closest('.message.ai .message-avatar');
            if (avatar) {
                editAgent(currentAgentId);
            }
        });

        // 横屏模式下，点击聊天区域显示标题栏
        chatContainer.addEventListener('click', (e) => {
            if (isLandscapeMode) {
                showHeaderInLandscape();
            }
        });
    }

    // 横屏模式下，点击主容器显示标题栏
    const container = document.querySelector('.container');
    if (container) {
        container.addEventListener('click', (e) => {
            if (isLandscapeMode) {
                // 排除点击在按钮、输入框等交互元素上的情况
                const isInteractiveElement =
                    e.target.tagName === 'BUTTON' ||
                    e.target.tagName === 'INPUT' ||
                    e.target.tagName === 'TEXTAREA' ||
                    e.target.closest('button') ||
                    e.target.closest('label') ||
                    e.target.closest('.chat-menu-container') ||
                    e.target.closest('.send-btn') ||
                    e.target.closest('.stop-btn');

                if (!isInteractiveElement) {
                    showHeaderInLandscape();
                }
            }
        });
    }
}

// ==================== 初始化 ====================

// 开屏是否已结束
let splashFinished = false;

// 初始化
function init() {
    // 开屏动画显示时不需要隐藏状态栏
    // if (window.AndroidBridge && window.AndroidBridge.hideStatusBar) {
    //     window.AndroidBridge.hideStatusBar();
    // }
    // 开屏期间导航栏设为黑色，和开屏背景一致
    if (typeof AndroidBridge !== 'undefined' && AndroidBridge.setNavigationBarColor) {
        AndroidBridge.setNavigationBarColor('#0f0f0f');
    }

    // 开屏广告检测完成回调
    window.onSplashAdCheckComplete = function (willShowAd) {
        console.log('adsdk开屏广告检测完成，willShowAd:', willShowAd);

        // 如果不显示广告，立即结束开屏动画，如果显示广告，开屏动画在广告显示前结束（Android 端会处理）
        const splashScreen = document.getElementById('splashScreen');
        if (splashScreen) {
            // 动画结束后移除元素
            setTimeout(() => {
                splashScreen.classList.add('fade-out');
                // 移除 body 的开屏加载状态，应用主题背景色
                document.body.classList.remove('splash-loading');
                // 动画结束后彻底移除 DOM 元素，避免切换话题时重复触发广告逻辑
                setTimeout(() => {
                    splashScreen.remove();
                }, 600);
            }, 500);
            console.log('adsdk开屏广告检测完成', '移除开屏动画');
        }
        setTimeout(() => {
            splashFinished = true;
            // 检查是否已完成引导，如果已完成且不显示广告
            const hasCompleted = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
            // 状态栏永远不隐藏，不需要恢复
            // 开屏移除后更新导航栏颜色
            updateNavigationBar();
        }, 800);

    };


    // 备用超时：如果 20 秒内没有收到广告检测完成回调，自动结束开屏动画（防止卡死）
    setTimeout(() => {
        if (window.onSplashAdCheckComplete) {
            console.log('开屏动画超时，自动结束');
            window.onSplashAdCheckComplete(false);
        }
    }, 20000);

    // 首次安装时初始化默认智能体的话题
    initDefaultAgentTopics();

    // 注意：initTopicsContentStatus 和 cleanupEmptyNewTopics 需要在 initMessageDB 完成后执行
    // 因为它们依赖 _messageExistsCache 缓存，已移到 initImageDB().then() 中

    // 先初始化自定义服务商选项，确保在设置 select 值之前自定义服务商选项已添加
    updateCustomProviderOptions();

    apiKeyInput.value = apiKey;
    updateGetApiKeyBtnState();
    aiProviderSelect.value = currentAIProvider;
    modelSelect.value = selectedModel;
    streamOutputSwitch.checked = streamOutputEnabled;
    contextLimitNormalInput.value = contextLimitNormal;
    contextLimitExpertInput.value = contextLimitExpert;
    pageSizeInput.value = PAGE_SIZE;
    maxTokensInput.value = maxTokens;
    temperatureInput.value = temperature;
    topPInput.value = topP;
    fontSizeInput.value = messageFontSize;
    cacheOptimizeSwitch.checked = cacheOptimizeEnabled;
    restoreLastTopicSwitch.checked = restoreLastTopic;
    autoGenerateTopicNameSwitch.checked = autoGenerateTopicName;
if (topicNamePromptInput) topicNamePromptInput.value = topicNamePrompt;
    lockPortraitSwitch.checked = lockPortrait;
    autoCompressImageSwitch.checked = autoCompressImageEnabled;
    confirmSoundSwitch.checked = localStorage.getItem('cnai_confirm_sound') !== 'false';
    keepScreenOnSwitch.checked = localStorage.getItem('cnai_keep_screen_on') === 'true';
    updateCompressDesc();
    immersiveModeDefaultSwitch.checked = immersiveModeDefault;
    sessionCacheSwitch.checked = sessionCacheEnabled;
    sessionExpireInput.value = sessionExpireHours;
    showUsageInfoSwitch.checked = showUsageInfoEnabled;
    customRequestBodyInput.value = customRequestBody;
    applyUsageInfoVisibility();
    applyMessageFontSize();
    updateAgentDisplay();
    updateTopicDisplay();
    updateCurrentModelName();
    applyTheme(currentTheme);
    applyBgTheme(currentBgTheme);
    updateThemePicker();
    updateBgThemePicker();
    setupTopicDrawer();
    setupAIProviderListener();
    setupFetchModelsButton();
    setupCustomProviderEvents();  // 初始化自定义服务商事件
    setupCustomSelects();  // 初始化自定义选择器
    updateAIProviderSelectDisplay();  // 初始化 AI 服务商选择器显示
    updateModelOptions();
    updateSessionCacheVisibility();  // 初始化 Session 缓存开关显示状态
    updateWebSearchToggleBtn();  // 初始化网络搜索按钮状态
    updateDeepThinkingToggleBtn();  // 初始化深度思考按钮状态（含思维链菜单显示）

    // 初始化沉浸模式
    applyImmersiveMode();

    // Hook: tool-calling.js 初始化
    if (typeof initToolCalling === 'function') initToolCalling();

    // Hook: mcp-client.js 初始化（延迟到所有脚本加载完成后执行）
    setTimeout(() => {
        if (typeof initMcpClient === 'function') initMcpClient();
    }, 0);

    // 初始化时，如果深度思考或联网搜索开启，展开按钮2秒后自动收回
    setTimeout(() => {
        showToggleBtnsExpandTemporarily();
    }, 2000);

    initImageUpload();  // 初始化图片上传功能
    initFileUpload();  // 初始化文件上传功能
    initFileViewerEvents();  // 初始化文件查看弹窗事件
    updateSendBtnState();  // 初始化发送按钮状态（发送/添加话题）

    // 初始化 header-center 位置
    updateHeaderCenterPosition();
    setTimeout(updateHeaderCenterPosition, 0);
    window.addEventListener('resize', updateHeaderCenterPosition);

    // 初始化 IndexedDB 并加载图片数据，然后渲染消息
    initImageDB().then(async () => {
        // 初始化消息 IndexedDB
        await initMessageDB();

        // 初始化话题内容状态（依赖 _messageExistsCache，必须在 initMessageDB 之后）
        initTopicsContentStatus();

        // 清理无内容的"新话题"
        cleanupEmptyNewTopics();

        // 渲染侧边栏话题列表
        renderAllAgentTopics();

        // 加载所有图片数据到内存
        sentImagesByMessage = await loadAllImagesFromDB();
        console.log('已加载图片数据:', Object.keys(sentImagesByMessage).length, '条');

        // 加载所有文件数据到内存
        sentFilesByMessage = await loadAllFilesFromDB();
        console.log('已加载文件数据:', Object.keys(sentFilesByMessage).length, '条');

        // 加载当前智能体的消息
        // 如果不恢复上次话题，切换到默认智能体"智能助手"并创建新话题
        if (!restoreLastTopic) {
            currentAgentId = 'default';
            localStorage.setItem('cnai_current_agent', currentAgentId);
            const topics = getCurrentAgentTopics();
            const newTopic = generateNewTopic(currentAgentId, false);
            topics.push(newTopic);
            agentTopics[currentAgentId] = topics;
            saveAgentTopics();
            currentTopicId = newTopic.id;
            currentTopicByAgent[currentAgentId] = currentTopicId;
            localStorage.setItem('cnai_current_topic_by_agent', JSON.stringify(currentTopicByAgent));
            updateTopicDisplay();
            updateAgentDisplay();
            renderAllAgentTopics();
        }
        messages = await getMessages();
        if (messages.length > 0) {
            renderMessagesToChat(messages);
            // 初始化时更新重发按钮状态
            setTimeout(() => {
                updateResendButtons();
                // 滚动到最底部
                scrollToBottom();
                // 检查滚动到底部按钮状态
                checkScrollToBottomButton();
            }, 50);
        } else {
            // 没有消息时显示欢迎语（系统提示词简略版）
            showWelcomeMessage();
            if (splashScreen) {
                // 动画结束后移除元素
                setTimeout(function () {
                    if (window.onSplashAdCheckComplete) {
                        console.log('无消息需要插入，关闭开屏动画');
                        window.onSplashAdCheckComplete(false);
                    }
                }, 300);
                console.log('adsdk', '冷启动，延后初始化ADSDK，先关闭开屏动画');
            }
        }

        if (!apiKey) { showSettingsWithFade(() => { openModalWithFade(document.getElementById('aiProviderSettingsModal')); }); }
    }).catch(async (error) => {
        console.error('初始化 IndexedDB 失败:', error);
        // 即使 IndexedDB 失败，也继续加载消息
        messages = await getMessages();
        if (messages.length > 0) {
            renderMessagesToChat(messages);
            setTimeout(() => {
                updateResendButtons();
                // scrollToBottom();
                checkScrollToBottomButton();
            }, 50);
        } else {
            showWelcomeMessage();
        }
        if (!apiKey) { showSettingsWithFade(() => { openModalWithFade(document.getElementById('aiProviderSettingsModal')); }); }
    });
}

// 获取当前智能体
function getCurrentAgent() {
    return agents.find(a => a.id === currentAgentId) || agents[0];
}

// 更新话题显示（话题按钮现在只显示倒三角图标，无需更新文字）
function updateTopicDisplay() {
    // 话题按钮已改为倒三角形图标，不再显示话题名称
}

// 设置话题抽屉
function setupTopicDrawer() {
    // 打开抽屉
    topicDrawerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTopicDrawer();
    });

    // 关闭抽屉（点击关闭按钮）
    topicDrawerClose.addEventListener('click', () => {
        closeTopicDrawer();
    });

    // 关闭抽屉（点击遮罩层）
    topicDrawerOverlay.addEventListener('click', () => {
        // 如果正在渲染消息，不关闭侧边栏
        if (!isRenderingMessages) {
            closeTopicDrawer();
        }
    });

    // 批量删除按钮
    topicDrawerBatchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBatchDeleteMode();
    });

    // 全选所有话题按钮
    topicDrawerSelectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedTopicsForDelete.size > 0) {
            selectedTopicsForDelete.clear();
            renderAllAgentTopics();
        } else {
            selectAllTopicsForDelete();
        }
    });

    // 取消批量删除按钮
    topicDrawerCancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelBatchDeleteMode();
    });

    // 搜索按钮
    topicDrawerSearchBtn.addEventListener('click', () => {
        openGlobalSearch();
    });

    // 检查更新按钮
    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', () => {
            showToast('正在检查更新...');
            fetch('https://www.xiaolanbox.com/api/version.json?t=' + Date.now())
                .then(res => res.json())
                .then(data => {
                    const latestVersion = data.version;
                    const currentVersion = (window.AndroidBridge && AndroidBridge.getAppVersion)
                        ? AndroidBridge.getAppVersion()
                        : '';
                    if (!currentVersion) {
                        showToast('无法获取当前版本');
                        return;
                    }
                    if (compareVersions(latestVersion, currentVersion) > 0) {
                        showToast('发现新版本 v' + latestVersion + '，请前往应用商店更新');
                    } else {
                        showToast('当前已是最新版本');
                    }
                })
                .catch(() => {
                    showToast('检查更新失败，请检查网络');
                });
        });
    }
}

// 打开话题抽屉
// 全局动画锁，防止动画期间重复触发
let _panelTransitioning = false;

function openTopicDrawer() {
    if (topicDrawer.classList.contains('active')) return;
    console.log('[动画锁] openTopicDrawer', Date.now());
    // 重置批量删除模式
    isBatchDeleteMode = false;
    selectedTopicsForDelete.clear();
    updateBatchDeleteButton();
    renderAllAgentTopics();
    topicDrawer.classList.add('active');
    topicDrawerOverlay.classList.add('active');
    document.body.classList.add('drawer-open');
    // 侧边栏从右滑入
    topicDrawer.style.transition = 'none';
    topicDrawer.style.transform = 'translateX(30%)';
    void topicDrawer.offsetHeight;
    topicDrawer.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    topicDrawer.style.transform = 'translateX(0)';
    currentPanel = topicDrawer;
    fadeOutMain();
}

// 关闭话题抽屉
let _topicDrawerClosing = false;
function closeTopicDrawer() {
    if (_topicDrawerClosing) return;
    if (!topicDrawer.classList.contains('active')) return;
    _topicDrawerClosing = true;
    console.log('[动画锁] closeTopicDrawer', Date.now());
    // 侧边栏向右滑出+淡出
    topicDrawer.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease';
    topicDrawer.style.transform = 'translateX(10%)';
    topicDrawer.style.opacity = '0';
    setTimeout(() => {
        topicDrawer.classList.remove('active');
        topicDrawerOverlay.classList.remove('active');
        topicDrawer.style.transition = '';
        topicDrawer.style.transform = '';
        topicDrawer.style.opacity = '';
        _topicDrawerClosing = false;
    }, 250);
    currentPanel = null;
    document.body.classList.remove('drawer-open');
    fadeInMain();
}

// 渲染所有智能体的话题列表
function renderAllAgentTopics() {
    topicDrawerBody.innerHTML = '';

    // ==================== 星标分组（置顶） ====================
    const starredEntries = []; // { agent, topic }
    agents.forEach(agent => {
        const topics = agentTopics[agent.id];
        if (!topics) return;
        topics.forEach(topic => {
            if (topic.starred && topic.hasContent) {
                starredEntries.push({ agent, topic });
            }
        });
    });

    if (starredEntries.length > 0) {
        // 按最新活跃时间排序
        starredEntries.sort((a, b) => {
            const timeA = a.topic.lastActiveTime || (() => {
                const key = `cnai_messages_${a.agent.id}_topic_${a.topic.id}`;
                return _messageLastTimeCache[key] || a.topic.createTime || 0;
            })();
            const timeB = b.topic.lastActiveTime || (() => {
                const key = `cnai_messages_${b.agent.id}_topic_${b.topic.id}`;
                return _messageLastTimeCache[key] || b.topic.createTime || 0;
            })();
            return timeB - timeA;
        });

        const starGroup = document.createElement('div');
        starGroup.className = 'topic-drawer-agent-group topic-drawer-star-group';

        const divider = document.createElement('div');
        divider.className = 'topic-drawer-agent-divider';
        starGroup.appendChild(divider);

        // 虚拟智能体头部
        const starHeader = document.createElement('div');
        starHeader.className = 'topic-drawer-agent-header';
        starHeader.innerHTML = `
            <span class="topic-drawer-agent-icon" style="display:inline-flex;align-items:center;justify-content:center;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg></span>
            <span class="topic-drawer-agent-name">星标</span>
            <span class="topic-drawer-agent-count">${starredEntries.length} 个话题</span>
        `;
        starGroup.appendChild(starHeader);

        // 渲染星标话题项
        starredEntries.forEach(({ agent, topic }) => {
            const topicItem = document.createElement('div');
            topicItem.className = `topic-drawer-topic-item ${agent.id === currentAgentId && topic.id === currentTopicId ? 'active' : ''}`;
            topicItem.dataset.agentId = agent.id;
            topicItem.dataset.topicId = topic.id;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'topic-drawer-topic-name';
            // 显示话题名称（如果名称太通用，附带智能体名）
            nameSpan.textContent = topic.name;
            topicItem.appendChild(nameSpan);

            // 来源智能体标签
            const agentTag = document.createElement('span');
            agentTag.className = 'topic-drawer-topic-agent-tag';
            agentTag.textContent = agent.name;
            topicItem.appendChild(agentTag);

            // 对话轮数
            const roundCount = getTopicRoundCount(agent.id, topic.id);
            if (roundCount > 0) {
                const roundsSpan = document.createElement('span');
                roundsSpan.className = 'topic-drawer-topic-rounds';
                roundsSpan.textContent = roundCount;
                topicItem.appendChild(roundsSpan);
            }

            // 三点菜单
            if (!isBatchDeleteMode && !topic.isBuiltIn) {
                const menuBtn = document.createElement('button');
                menuBtn.className = 'topic-menu-btn';
                menuBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                    </svg>
                `;
                menuBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showTopicMenu(e, agent.id, topic.id, topic.name, menuBtn);
                });
                topicItem.appendChild(menuBtn);
            }

            // 点击切换
            topicItem.addEventListener('click', () => {
                if (isBatchDeleteMode) return;
                if (agent.id === currentAgentId && topic.id === currentTopicId) {
                    closeTopicDrawer();
                    return;
                }
                switchAgentAndTopic(agent.id, topic.id, () => {
                    closeTopicDrawer();
                });
            });

            starGroup.appendChild(topicItem);
        });

        topicDrawerBody.appendChild(starGroup);
    }
    // ==================== 星标分组 END ====================

    // 遍历所有智能体
    agents.forEach(agent => {
        // 未连接电脑时，不显示电脑端智能体的话题
        if (agent.id === PC_AGENT_ID && !(pcConnection.connected && pcConnection.authenticated)) {
            return;
        }
        const agentGroup = document.createElement('div');
        agentGroup.className = 'topic-drawer-agent-group';

        // 智能体分组上方的分隔线
        const divider = document.createElement('div');
        divider.className = 'topic-drawer-agent-divider';
        agentGroup.appendChild(divider);

        // 获取该智能体的话题列表，如果没有则创建默认话题
        let topics = agentTopics[agent.id];
        if (!topics || topics.length === 0) {
            const defaultTopicId = getDefaultTopicId(agent.id);
            let newTopic;
            if (defaultTopicId) {
                newTopic = { id: defaultTopicId, name: '新话题', isBuiltIn: false, createTime: Date.now() };
            } else {
                newTopic = generateNewTopic(agent.id);
            }
            agentTopics[agent.id] = [newTopic];
            topics = agentTopics[agent.id];
            saveAgentTopics();
        }

        // 按最新活跃时间排序（优先用 lastActiveTime，兼容旧数据）
        const sortedTopics = [...topics].sort((a, b) => {
            const timeA = a.lastActiveTime || (() => {
                const key = `cnai_messages_${agent.id}_topic_${a.id}`;
                return _messageLastTimeCache[key] || a.createTime || 0;
            })();
            const timeB = b.lastActiveTime || (() => {
                const key = `cnai_messages_${agent.id}_topic_${b.id}`;
                return _messageLastTimeCache[key] || b.createTime || 0;
            })();
            return timeB - timeA;
        });
        const topicsWithContent = sortedTopics.filter(topic => topic.hasContent === true);

        // 如果该智能体没有有内容的话题，跳过渲染（电脑端智能体除外，始终显示）
        if (topicsWithContent.length === 0 && agent.id !== PC_AGENT_ID) {
            return;
        }

        // 智能体头部
        const agentHeader = document.createElement('div');
        agentHeader.className = 'topic-drawer-agent-header';

        // 判断图标是否需要 white-icon 类
        const whiteIconClass = isWhiteIcon(agent.icon) ? ' white-icon' : '';
        const iconHtml = agent.icon.includes('/') || agent.icon.endsWith('.png') || agent.icon.endsWith('.jpg') || agent.icon.endsWith('.svg')
            ? `<img class="topic-drawer-agent-icon${whiteIconClass}" src="${agent.icon}" alt="${agent.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🤖</text></svg>'">`
            : `<span class="topic-drawer-agent-icon">${agent.icon}</span>`;

        // 新增话题按钮
        const addTopicBtn = document.createElement('button');
        addTopicBtn.className = 'agent-add-topic-btn';
        addTopicBtn.title = '新增话题';
        addTopicBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        `;
        addTopicBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            createNewTopicForAgent(agent.id);
            closeTopicDrawer();
        });

        agentHeader.innerHTML = `
            ${iconHtml}
            <span class="topic-drawer-agent-name">${agent.name}</span>
            <span class="topic-drawer-agent-count">${topicsWithContent.length} 个话题</span>
        `;
        agentHeader.appendChild(addTopicBtn);
        agentGroup.appendChild(agentHeader);

        // 批量删除模式下，点击智能体头部全选/取消全选该智能体下所有话题
        if (isBatchDeleteMode) {
            agentHeader.style.cursor = 'pointer';
            agentHeader.addEventListener('click', (e) => {
                e.stopPropagation();
                const deletableTopics = topicsWithContent.filter(t => !t.isBuiltIn);
                if (deletableTopics.length === 0) return;
                // 判断是否全部已选中
                const allSelected = deletableTopics.every(t => selectedTopicsForDelete.has(`${agent.id}::${t.id}`));
                if (allSelected) {
                    // 取消全选
                    deletableTopics.forEach(t => selectedTopicsForDelete.delete(`${agent.id}::${t.id}`));
                } else {
                    // 全选
                    deletableTopics.forEach(t => selectedTopicsForDelete.add(`${agent.id}::${t.id}`));
                }
                renderAllAgentTopics();
            });
        } else {
            // 非批量删除模式下，点击智能体头部打开编辑界面
            agentHeader.style.cursor = 'pointer';
            agentHeader.addEventListener('click', (e) => {
                e.stopPropagation();
                editAgent(agent.id);
            });
        }

        // 话题列表（只显示有内容的话题）
        topicsWithContent.forEach(topic => {
            const topicItem = document.createElement('div');
            topicItem.className = `topic-drawer-topic-item ${agent.id === currentAgentId && topic.id === currentTopicId ? 'active' : ''}`;
            topicItem.dataset.agentId = agent.id;
            topicItem.dataset.topicId = topic.id;

            // 批量删除模式下显示复选框
            if (isBatchDeleteMode) {
                const checkboxLabel = document.createElement('label');
                checkboxLabel.className = 'topic-checkbox-label';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'topic-checkbox';
                const topicKey = `${agent.id}::${topic.id}`;
                checkbox.checked = selectedTopicsForDelete.has(topicKey);
                checkbox.disabled = topic.isBuiltIn; // 内置话题禁用
                checkboxLabel.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    toggleTopicSelection(agent.id, topic.id, e.target.checked);
                });
                const checkmark = document.createElement('span');
                checkmark.className = 'topic-checkmark';
                checkboxLabel.appendChild(checkbox);
                checkboxLabel.appendChild(checkmark);
                topicItem.appendChild(checkboxLabel);
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'topic-drawer-topic-name';
            nameSpan.textContent = topic.name;

            // 已星标的话题显示星标图标
            if (topic.starred) {
                const starIcon = document.createElement('span');
                starIcon.className = 'topic-drawer-star-indicator';
                starIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>';
                topicItem.appendChild(nameSpan);
                topicItem.appendChild(starIcon);
            } else {
                topicItem.appendChild(nameSpan);
            }

            // 显示对话轮数
            const roundCount = getTopicRoundCount(agent.id, topic.id);
            if (roundCount > 0) {
                const roundsSpan = document.createElement('span');
                roundsSpan.className = 'topic-drawer-topic-rounds';
                roundsSpan.textContent = roundCount;
                topicItem.appendChild(roundsSpan);
            }

            // 非批量模式下显示操作菜单按钮
            if (!isBatchDeleteMode && !topic.isBuiltIn) {
                const menuBtn = document.createElement('button');
                menuBtn.className = 'topic-menu-btn';
                menuBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                    </svg>
                `;
                menuBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showTopicMenu(e, agent.id, topic.id, topic.name, menuBtn);
                });

                topicItem.appendChild(menuBtn);
            }

            // 点击事件
            topicItem.addEventListener('click', () => {
                if (isBatchDeleteMode) {
                    // 批量模式下点击切换选中状态
                    if (!topic.isBuiltIn) {
                        const topicKey = `${agent.id}::${topic.id}`;
                        toggleTopicSelection(agent.id, topic.id, !selectedTopicsForDelete.has(topicKey));
                        renderAllAgentTopics();
                    }
                    return;
                }

                // 正常模式切换话题
                if (agent.id === currentAgentId && topic.id === currentTopicId) {
                    closeTopicDrawer();
                    return;
                }
                switchAgentAndTopic(agent.id, topic.id, () => {
                    closeTopicDrawer();
                });
            });

            agentGroup.appendChild(topicItem);
        });

        topicDrawerBody.appendChild(agentGroup);
    });
}

// 删除指定智能体的话题（无需切换）
function deleteAgentTopic(agentId, topicId) {
    const topics = agentTopics[agentId];
    if (!topics) return;

    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;

    // 内置话题不允许删除
    if (topic.isBuiltIn) {
        alert('内置话题不能删除');
        return;
    }

    if (!confirm(`确定要删除话题"${topic.name}"吗？删除后无法恢复。`)) return;

    // 删除话题
    agentTopics[agentId] = topics.filter(t => t.id !== topicId);
    saveAgentTopics();

    // 删除该话题的消息
    const topicMessagesKey = `cnai_messages_${agentId}_topic_${topicId}`;
    deleteMessagesFromDB(topicMessagesKey);

    // 如果删除后没有话题了，自动创建一个新话题
    if (agentTopics[agentId].length === 0) {
        const newTopic = generateNewTopic(agentId);
        agentTopics[agentId].push(newTopic);
        saveAgentTopics();
    }

    // 如果删除的是当前话题，切换到同智能体的第一个话题
    if (agentId === currentAgentId && currentTopicId === topicId) {
        const remainingTopics = agentTopics[agentId];
        if (remainingTopics && remainingTopics.length > 0) {
            switchAgentAndTopic(agentId, remainingTopics[0].id, () => { });
        }
    }

    // 重新渲染话题抽屉
    renderAllAgentTopics();
    showToast('话题已删除');
}

// 话题菜单相关变量
let currentTopicMenu = null;
let currentKnowledgeMenu = null;

// 切换话题星标
function toggleTopicStar(agentId, topicId) {
    const topics = agentTopics[agentId];
    if (!topics) return;
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;
    topic.starred = !topic.starred;
    saveAgentTopics();
    renderAllAgentTopics();
    showToast(topic.starred ? '已添加星标' : '已取消星标');
}

// 检查话题是否已星标
function isTopicStarred(agentId, topicId) {
    const topics = agentTopics[agentId];
    if (!topics) return false;
    const topic = topics.find(t => t.id === topicId);
    return topic ? !!topic.starred : false;
}

// 显示话题菜单
function showTopicMenu(event, agentId, topicId, topicName, menuBtn) {
    event.stopPropagation();
    event.preventDefault();
    closeChatMenuSheet();
    const starred = isTopicStarred(agentId, topicId);
    createBottomSheetPicker({
        items: [
            { value: 'star', label: starred ? '取消星标' : '星标', icon: starred
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>'
                : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>' },
            { value: 'rename', label: '编辑名称' },
            { value: 'copy', label: '复制话题' },
            'divider',
            { value: 'export', label: '导出话题' },
            { value: 'import', label: '导入聊天记录到话题' },
            'divider',
            { value: 'delete', label: '删除', className: 'bs-item-danger' },
        ],
        onSelect: (item) => {
            if (item.value === 'star') {
                toggleTopicStar(agentId, topicId);
            } else if (item.value === 'rename') {
                renameTopic(agentId, topicId, topicName);
            } else if (item.value === 'copy') {
                copyTopic(agentId, topicId);
            } else if (item.value === 'export') {
                exportTopic(agentId, topicId, topicName);
            } else if (item.value === 'import') {
                _pendingImportTarget = { agentId, topicId };
                triggerImportChat();
            } else if (item.value === 'delete') {
                closeTopicDrawer();
                deleteAgentTopic(agentId, topicId);
            }
        },
    }).show();
}

// 关闭话题菜单（已改用 createBottomSheetPicker，保留兼容）
function closeTopicMenu() {
    if (currentTopicMenu) {
        currentTopicMenu.remove();
        currentTopicMenu = null;
    }
}

// 点击页面其他地方关闭菜单（全局事件）
document.addEventListener('click', (e) => {
    // 如果正在渲染消息，不关闭任何菜单
    if (isRenderingMessages) {
        return;
    }

    let menuClosed = false;
    if (currentTopicMenu && !currentTopicMenu.contains(e.target)) {
        closeTopicMenu();
        menuClosed = true;
    }
    if (currentAgentMenu && !currentAgentMenu.contains(e.target)) {
        closeAgentMenu();
        menuClosed = true;
    }
    // 关闭知识库三点菜单
    if (currentKnowledgeMenu && !currentKnowledgeMenu.contains(e.target)) {
        currentKnowledgeMenu.remove();
        currentKnowledgeMenu = null;
    }
    // 知识库参考子菜单已改用 createBottomSheetPicker，无需手动关闭
    // 如果关闭了菜单，阻止事件继续传播（避免触发话题项点击等）
    if (menuClosed) {
        e.stopPropagation();
        e.preventDefault();
    }
}, true); // 使用捕获阶段，确保在其他事件处理之前执行

// 滚动话题列表时关闭话题菜单
topicDrawerBody.addEventListener('scroll', () => {
    if (currentTopicMenu) {
        closeTopicMenu();
    }
});

// 智能体菜单相关变量
let currentAgentMenu = null;

// 显示智能体菜单
function showAgentMenu(event, agentId, menuBtn) {
    event.stopPropagation();
    event.preventDefault();
    createBottomSheetPicker({
        items: [
            { value: 'edit', label: '编辑' },
            { value: 'copy', label: '复制' },
            'divider',
            { value: 'delete', label: '删除', className: 'bs-item-danger' },
        ],
        onSelect: (item) => {
            if (item.value === 'edit') editAgent(agentId);
            else if (item.value === 'copy') copyAgent(agentId);
            else if (item.value === 'delete') executeDeleteAgent(agentId);
        },
    }).show();
}

// 关闭智能体菜单（已改用 createBottomSheetPicker，保留兼容）
function closeAgentMenu() {
    if (currentAgentMenu) {
        currentAgentMenu.remove();
        currentAgentMenu = null;
    }
}

// 复制智能体（只复制智能体本身，不复制话题）
function copyAgent(agentId) {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    // 创建新智能体
    const newAgent = {
        id: 'agent_' + Date.now(),
        name: agent.name + ' (副本)',
        icon: agent.icon,
        systemPrompt: agent.systemPrompt,
        isBuiltIn: false
    };

    // 添加到智能体列表
    agents.push(newAgent);
    localStorage.setItem('cnai_agents', JSON.stringify(agents));

    // 为新智能体创建默认话题（非默认智能体使用 generateNewTopic）
    const newTopic = generateNewTopic(newAgent.id);
    agentTopics[newAgent.id] = [newTopic];
    saveAgentTopics();

    // 重新渲染
    renderAgentList();
    showToast('智能体已复制');
}

// 复制话题
async function copyTopic(agentId, topicId) {
    const topics = agentTopics[agentId];
    if (!topics) return;

    const sourceTopic = topics.find(t => t.id === topicId);
    if (!sourceTopic) return;

    // 创建新话题
    const newTopic = generateNewTopic(agentId);
    newTopic.name = sourceTopic.name + ' (副本)';
    newTopic.createTime = Date.now();

    // 添加到话题列表
    agentTopics[agentId].push(newTopic);
    saveAgentTopics();

    // 复制消息记录
    const sourceMessagesKey = topicId === 'topic_1'
        ? `cnai_messages_${agentId}`
        : `cnai_messages_${agentId}_topic_${topicId}`;
    const sourceMessages = await getMessagesFromDB(sourceMessagesKey);

    if (sourceMessages) {
        const newMessagesKey = `cnai_messages_${agentId}_topic_${newTopic.id}`;
        saveMessagesToDB(newMessagesKey, sourceMessages);
        newTopic.hasContent = true;
    }

    // 重新渲染
    renderAllAgentTopics();
    showToast('话题已复制');
}

// 切换批量删除模式
function toggleBatchDeleteMode() {
    if (isBatchDeleteMode) {
        // 当前是确认删除状态，执行批量删除
        if (selectedTopicsForDelete.size === 0) {
            showToast('请先选择要删除的话题');
            return;
        }

        if (!confirm(`确定要删除选中的 ${selectedTopicsForDelete.size} 个话题吗？删除后无法恢复。`)) return;

        // 执行批量删除
        let deletedCount = 0;
        selectedTopicsForDelete.forEach(topicKey => {
            // topicKey 格式: agentId::topicId
            const separatorIndex = topicKey.indexOf('::');
            const agentId = topicKey.substring(0, separatorIndex);
            const topicId = topicKey.substring(separatorIndex + 2);
            const topics = agentTopics[agentId];
            if (topics && topics.length > 1) {
                const topic = topics.find(t => t.id === topicId);
                if (topic && !topic.isBuiltIn) {
                    agentTopics[agentId] = topics.filter(t => t.id !== topicId);
                    // 删除该话题的消息
                    const topicMessagesKey = `cnai_messages_${agentId}_topic_${topicId}`;
                    deleteMessagesFromDB(topicMessagesKey);
                    deletedCount++;
                }
            }
        });

        saveAgentTopics();

        // 如果当前话题被删除，切换到第一个可用话题
        const currentTopicKey = `${currentAgentId}::${currentTopicId}`;
        if (selectedTopicsForDelete.has(currentTopicKey)) {
            const remainingTopics = agentTopics[currentAgentId];
            if (remainingTopics && remainingTopics.length > 0) {
                switchAgentAndTopic(currentAgentId, remainingTopics[0].id, () => { });
            }
        }

        // 退出批量模式
        isBatchDeleteMode = false;
        selectedTopicsForDelete.clear();
        updateBatchDeleteButton();
        renderAllAgentTopics();
        showToast(`已删除 ${deletedCount} 个话题`);
    } else {
        // 进入批量删除模式
        isBatchDeleteMode = true;
        selectedTopicsForDelete.clear();
        updateBatchDeleteButton();
        renderAllAgentTopics();
    }
}

// 更新批量删除按钮状态
function updateBatchDeleteButton() {
    const btnText = topicDrawerBatchBtn.querySelector('.btn-text');
    const settingsBtn = document.getElementById('topicDrawerSettingsBtn');
    if (isBatchDeleteMode) {
        btnText.textContent = '确认删除';
        topicDrawerBatchBtn.classList.add('confirm-mode');
        topicDrawerSelectAllBtn.style.display = 'inline-flex';
        topicDrawerCancelBtn.style.display = 'inline-flex';
        settingsBtn.style.display = 'none';
    } else {
        btnText.textContent = '批量删除';
        topicDrawerBatchBtn.classList.remove('confirm-mode');
        topicDrawerSelectAllBtn.style.display = 'none';
        topicDrawerCancelBtn.style.display = 'none';
        settingsBtn.style.display = 'inline-flex';
    }
}

// 全选所有话题
function selectAllTopicsForDelete() {
    selectedTopicsForDelete.clear();
    agents.forEach(agent => {
        const topics = agentTopics[agent.id];
        if (topics) {
            topics.forEach(topic => {
                if (!topic.isBuiltIn) {
                    selectedTopicsForDelete.add(`${agent.id}::${topic.id}`);
                }
            });
        }
    });
    renderAllAgentTopics();
}

// 取消批量删除模式
function cancelBatchDeleteMode() {
    isBatchDeleteMode = false;
    selectedTopicsForDelete.clear();
    updateBatchDeleteButton();
    renderAllAgentTopics();
}

// 切换单个话题的选中状态
function toggleTopicSelection(agentId, topicId, selected) {
    const topicKey = `${agentId}::${topicId}`;
    if (selected) {
        selectedTopicsForDelete.add(topicKey);
    } else {
        selectedTopicsForDelete.delete(topicKey);
    }
}


// 重命名话题
function renameTopic(agentId, topicId, currentName) {
    // 检查是否为内置话题
    const topics = agentTopics[agentId];
    if (topics) {
        const topic = topics.find(t => t.id === topicId);
        if (topic && topic.isBuiltIn) {
            showToast('内置话题不能编辑名称');
            return;
        }
    }

    // 使用自定义输入弹窗
    showInputModal('请输入新的话题名称', currentName, (newName) => {
        if (newName && newName.trim() && newName.trim() !== currentName) {
            if (topics) {
                const topic = topics.find(t => t.id === topicId);
                if (topic) {
                    topic.name = newName.trim();
                    saveAgentTopics();
                    // 重新渲染话题抽屉
                    renderAllAgentTopics();
                    showToast('话题名称已修改');
                }
            }
        }
    });
}

// 显示输入弹窗
// inputType: 可选参数，默认为'text'，可以是'password'等
function showInputModal(title, defaultValue, onConfirm, inputType = 'text') {
    createBottomSheetInput({
        title: title,
        value: defaultValue || '',
        inputType: inputType === 'password' ? 'password' : 'text',
        onConfirm: (val) => {
            if (onConfirm) onConfirm(val);
        },
    }).show();
}

// 关闭输入弹窗（已改用底部面板，保留空函数兼容）
function closeInputModalFunc() {}

// 输入弹窗关闭按钮
closeInputModal.addEventListener('click', () => {
    closeInputModalFunc();
});

// 输入弹窗点击遮罩关闭
inputModal.addEventListener('click', (e) => {
    if (e.target === inputModal) {
        closeInputModalFunc();
    }
});

// 输入弹窗回车确认
inputModalInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const value = inputModalInput.value;
        if (inputModal._onConfirm) {
            inputModal._onConfirm(value);
        }
        closeInputModalFunc();
    }
});

// 切换话题（当前智能体内切换）
function switchTopic(topicId) {
    switchAgentAndTopic(currentAgentId, topicId, () => {
        closeTopicDrawer();
    });
}

// 切换智能体和话题（核心函数）
// onClose: 切换开始时的回调（如关闭下拉菜单或弹窗）
// onComplete: 消息渲染完成后的回调（用于全局搜索定位等）
// options: { skipScrollToBottom: true } 跳过自动滚动到底部
async function switchAgentAndTopic(agentId, topicId, onClose, onComplete, options = {}) {
    // 内容生成中时不允许切换话题
    if (isSending) {
        showToast('内容正在生成中，请稍候');
        return;
    }
    // 取消正在进行的消息渲染（防止旧话题消息串到新话题）
    let wasRendering = false;
    if (isRenderingMessages) {
        clearTimeout(renderMessagesTimeoutId);
        renderMessagesVersion++;  // 递增版本号，使旧 renderNextBatch 回调失效
        isRenderingMessages = false;
        hideAllHeaderHints();  // 隐藏顶部加载计数
        wasRendering = true;
    }
    // 立即重置分页状态，防止 checkScrollToTopForMore 用旧数据往新话题插消息
    allMessages = [];
    loadedCount = 0;
    isLoadingMoreMessages = false;

    // 显示加载遮罩层（记录时间，确保至少显示0.25s）
    const _topicOverlayShowTime = Date.now();
    topicLoadingOverlay.classList.add('active');
    // 保存当前消息
    await saveMessages(messages);

    // 保存当前智能体的话题选择
    currentTopicByAgent[currentAgentId] = currentTopicId;
    localStorage.setItem('cnai_current_topic_by_agent', JSON.stringify(currentTopicByAgent));

    // 切换智能体和话题
    currentAgentId = agentId;
    currentTopicId = topicId;
    currentTopicByAgent[currentAgentId] = currentTopicId;
    localStorage.setItem('cnai_current_agent', currentAgentId);
    localStorage.setItem('cnai_current_topic_by_agent', JSON.stringify(currentTopicByAgent));

    // 执行关闭回调（如关闭下拉菜单或弹窗）
    if (onClose) onClose();

    // 更新显示
    updateAgentDisplay();
    updateTopicDisplay();
    updateCurrentModelName();

    // 清空聊天界面并加载新话题消息
    disposeAllCharts();
    chatContainer.innerHTML = '';
    // 应用沉浸模式
    applyImmersiveMode();
    messages = await getMessages();

    // 修复重复 id：给后面的同 id 消息追加时间戳
    if (messages.length > 0) {
        const seenIds = new Set();
        let needSave = false;
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.id && seenIds.has(msg.id)) {
                const suffix = '_' + Date.now().toString(36) + '_' + i;
                msg.id = msg.id + suffix;
                needSave = true;
                console.log('【ID修复】重复id已修复:', msg.id, '索引:', i);
            }
            if (msg.id) {
                seenIds.add(msg.id);
            }
        }
        if (needSave) {
            await saveMessages(messages);
        }
    }

    // 迁移旧数据：确保所有消息的 prevId 链完整
    if (messages.length > 0) {
        const rootId = getTopicRootId();
        let needSave = false;
        // 第一条消息 prevId 必须是 root
        if (messages[0].prevId !== rootId) {
            messages[0].prevId = rootId;
            needSave = true;
        }
        // 后续消息缺 prevId 的，指向上一条消息的 id
        for (let i = 1; i < messages.length; i++) {
            if (!messages[i].prevId) {
                messages[i].prevId = messages[i - 1].id;
                needSave = true;
            }
        }
        if (needSave) {
            await saveMessages(messages);
        }
    }

    if (messages.length > 0) {
        renderMessagesToChat(messages);
        // 非搜索定位时才滚动到底部
        checkScrollToBottomButton();
        updateResendButtons();
        // 更新智能体标签栏显示状态
        updateAgentTagsBarVisibility();
    } else {
        showWelcomeMessage();
        // 空话题时确保隐藏置底按钮
        checkScrollToBottomButton();
    }

    // 隐藏遮罩层（确保至少显示0.25s）
    const _elapsed = Date.now() - _topicOverlayShowTime;
    const _hideOverlay = () => {
        topicLoadingOverlay.classList.remove('active');
        if (onComplete) onComplete();
        showToggleBtnsExpandTemporarily();
        if (!options.skipScrollToBottom && messages.length > 0) {
            scrollToBottom();
        }
    };
    if (_elapsed < 250) {
        setTimeout(_hideOverlay, 250 - _elapsed);
    } else {
        _hideOverlay();
    }
}

// 临时展开按钮2秒后自动收回（用于切换话题时提示用户当前状态）
function showToggleBtnsExpandTemporarily() {
    const deepThinkingDisabled = deepThinkingToggleBtn.classList.contains('disabled');
    const webSearchDisabled = webSearchToggleBtn.classList.contains('disabled');
    const hasInputContent = messageInput.value.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0;

    // 只有在启用状态、且输入框无内容时才展开
    const shouldExpand = !hasInputContent && ((!deepThinkingDisabled && deepThinkingEnabled) || (!webSearchDisabled && webSearchEnabled));

    if (!shouldExpand) return;

    // 清除之前的定时器
    if (toggleBtnExpandTimer) {
        clearTimeout(toggleBtnExpandTimer);
        toggleBtnExpandTimer = null;
    }

    // 展开
    if (!isToggleBtnExpanded) {
        isToggleBtnExpanded = true;
        deepThinkingToggleBtn.classList.add('toggle-btn-expanded');
        webSearchToggleBtn.classList.add('toggle-btn-expanded');
    }

    // 2秒后自动收回
    toggleBtnExpandTimer = setTimeout(() => {
        deepThinkingToggleBtn.classList.remove('toggle-btn-expanded');
        webSearchToggleBtn.classList.remove('toggle-btn-expanded');
        isToggleBtnExpanded = false;
        toggleBtnExpandTimer = null;
    }, 2000);
}

// 生成新话题对象（公共方法）
function generateNewTopic(agentId, isUserCreated = true) {
    // 使用全局计数器，所有智能体共用一个话题ID序列
    const counter = topicIdCounter++;
    localStorage.setItem('cnai_topic_id_counter', topicIdCounter.toString());

    const topicId = `topic_${counter}`;

    // 清理该话题 ID 可能存在的旧消息数据（防止话题 ID 重用时加载旧数据）
    const oldMessagesKey = `cnai_messages_${agentId}_topic_${topicId}`;
    deleteMessagesFromDB(oldMessagesKey);

    return {
        id: topicId,
        name: '新话题',
        isBuiltIn: false,
        isUserCreated: isUserCreated,  // true 表示用户创建，false 表示系统默认
        createTime: Date.now()
    };
}

// 创建新话题（无需输入，自动生成名称）
function createNewTopic() {
    // 复用 createNewTopicForAgent，传入当前智能体ID
    createNewTopicForAgent(currentAgentId);
}

// 删除话题
function deleteTopic(topicId) {
    const topics = getCurrentAgentTopics();
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;

    if (!confirm(`确定要删除话题"${topic.name}"吗？删除后无法恢复。`)) return;

    // 删除话题
    agentTopics[currentAgentId] = topics.filter(t => t.id !== topicId);
    saveAgentTopics();

    // 删除该话题的消息
    const topicMessagesKey = `cnai_messages_${currentAgentId}_topic_${topicId}`;
    deleteMessagesFromDB(topicMessagesKey);

    // 如果删除后没有话题了，自动创建一个新话题
    if (agentTopics[currentAgentId].length === 0) {
        const newTopic = generateNewTopic(currentAgentId);
        agentTopics[currentAgentId].push(newTopic);
        saveAgentTopics();
    }

    // 如果当前话题被删除，切换到第一个话题
    if (currentTopicId === topicId) {
        const remainingTopics = agentTopics[currentAgentId];
        if (remainingTopics.length > 0) {
            switchTopic(remainingTopics[0].id);
        }
    }

    //renderTopicList();
    showToast('话题已删除');
}

// 判断图标是否为白色图标（需要根据主题反转颜色）
function isWhiteIcon(iconPath) {
    return iconPath.includes('db3_processed');
}

// 更新聊天界面中所有 AI 消息的头像
function updateChatAvatar() {
    const agent = getCurrentAgent();
    const aiMessages = chatContainer.querySelectorAll('.message.ai .message-avatar');

    aiMessages.forEach(avatarDiv => {
        let avatar;
        if (agent.icon.includes('/') || agent.icon.endsWith('.png') || agent.icon.endsWith('.jpg') || agent.icon.endsWith('.svg')) {
            const whiteIconClass = isWhiteIcon(agent.icon) ? ' white-icon' : '';
            avatar = `<img src="${agent.icon}" alt="${agent.name}" class="message-avatar-img${whiteIconClass}">`;
        } else {
            avatar = agent.icon;
        }
        avatarDiv.innerHTML = avatar;
    });
}

// 更新智能体显示
function updateAgentDisplay() {
    const agent = getCurrentAgent();
    // 判断是图片路径还是 emoji
    if (agent.icon.includes('/') || agent.icon.endsWith('.png') || agent.icon.endsWith('.jpg') || agent.icon.endsWith('.svg')) {
        const whiteIconClass = isWhiteIcon(agent.icon) ? ' white-icon' : '';
        currentAgentIcon.innerHTML = `<img src="${agent.icon}" alt="${agent.name}" class="agent-icon-img${whiteIconClass}">`;
    } else {
        currentAgentIcon.textContent = agent.icon;
    }
    currentAgentName.textContent = agent.name;
    applyChatBackground(agent);
}

// 渲染智能体列表
function renderAgentList() {
    // 保存"创建自定义智能体"按钮
    const addBtn = document.getElementById('addAgentBtn');

    // 清空列表但保留按钮
    agentList.innerHTML = '';

    // 确保电脑端智能体在数组最前面（固定第一位）
    const pcIdx = agents.findIndex(a => a.id === PC_AGENT_ID);
    if (pcIdx > 0) {
        const [pcAgent] = agents.splice(pcIdx, 1);
        agents.unshift(pcAgent);
        localStorage.setItem('cnai_agents', JSON.stringify(agents));
    }

    agents.forEach(agent => {
        // 未连接电脑时，不显示电脑端智能体
        if (agent.id === PC_AGENT_ID && !(pcConnection.connected && pcConnection.authenticated)) {
            return;
        }
        const agentDiv = document.createElement('div');
        agentDiv.className = `agent-item ${agent.id === currentAgentId ? 'active' : ''}`;
        agentDiv.dataset.agentId = agent.id;

        // 长按拖拽（移除拖拽把手，改为长按触发）
        agentDiv.addEventListener('mousedown', (e) => handleAgentLongPressStart(e, agent.id, agentDiv));
        agentDiv.addEventListener('touchstart', (e) => handleAgentLongPressStart(e, agent.id, agentDiv), { passive: false });
        agentDiv.addEventListener('mouseup', handleAgentLongPressEnd);
        agentDiv.addEventListener('touchend', handleAgentLongPressEnd);
        agentDiv.addEventListener('mouseleave', handleAgentLongPressEnd);
        agentDiv.addEventListener('touchcancel', handleAgentLongPressEnd);

        // 图标
        const iconSpan = document.createElement('span');
        iconSpan.className = 'agent-item-icon';
        // 判断是图片路径还是 emoji
        if (agent.icon.includes('/') || agent.icon.endsWith('.png') || agent.icon.endsWith('.jpg') || agent.icon.endsWith('.svg')) {
            const whiteIconClass = isWhiteIcon(agent.icon) ? ' white-icon' : '';
            iconSpan.innerHTML = `<img src="${agent.icon}" alt="${agent.name}" class="agent-icon-img${whiteIconClass}">`;
        } else {
            iconSpan.textContent = agent.icon;
        }
        agentDiv.appendChild(iconSpan);

        // 信息区域
        const infoDiv = document.createElement('div');
        infoDiv.className = 'agent-item-info';
        infoDiv.innerHTML = `
            <span class="agent-item-name">${agent.name}</span>
            <span class="agent-item-desc">${agent.systemPrompt ? agent.systemPrompt.substring(0, 30) + '...' : '默认助手'}</span>`;
        agentDiv.appendChild(infoDiv);
        agentDiv.addEventListener('click', (e) => {
            // 如果长按已触发，不执行点击展开
            if (longPressTriggered) {
                longPressTriggered = false;
                return;
            }
            toggleAgentTopics(agent.id);
        });

        // 为所有智能体添加菜单按钮
        const menuBtn = document.createElement('button');
        menuBtn.className = 'agent-item-menu-btn';
        menuBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
            </svg>
        `;
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showAgentMenu(e, agent.id, menuBtn);
        });

        agentDiv.appendChild(menuBtn);

        agentList.appendChild(agentDiv);


    });

    // 移动"创建自定义智能体"按钮到列表顶部
    agentList.insertBefore(addBtn, agentList.firstChild);
}

// 智能体拖拽排序相关变量
let draggedAgentId = null;
let draggedAgentElement = null;
let dragPlaceholder = null;
let cachedAgentRects = []; // 缓存所有智能体元素的位置信息

// 长按拖拽相关变量
let longPressTimer = null;
let longPressTriggered = false;
let longPressStartX = 0;
let longPressStartY = 0;
const LONG_PRESS_DURATION = 500; // 长按触发时间（毫秒）
const LONG_PRESS_MOVE_THRESHOLD = 10; // 移动超过此距离取消长按

// 长按开始处理
function handleAgentLongPressStart(e, agentId, agentDiv) {
    // 如果点击的是按钮，不触发长按
    if (e.target.closest('button')) return;

    longPressTriggered = false;

    // 记录起始位置
    if (e.type === 'touchstart' && e.touches.length > 0) {
        longPressStartX = e.touches[0].clientX;
        longPressStartY = e.touches[0].clientY;
        // 添加 touchmove 监听来检测滚动
        agentDiv.addEventListener('touchmove', handleAgentLongPressMove, { passive: true });
    } else if (e.type === 'mousedown') {
        longPressStartX = e.clientX;
        longPressStartY = e.clientY;
    }

    longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        // 移除 touchmove 监听
        agentDiv.removeEventListener('touchmove', handleAgentLongPressMove);
        startDragAgent(e, agentId, agentDiv);
    }, LONG_PRESS_DURATION);
}

// 检测移动，超过阈值则取消长按
function handleAgentLongPressMove(e) {
    if (!longPressTimer) return;

    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - longPressStartX);
    const deltaY = Math.abs(touch.clientY - longPressStartY);

    // 移动超过阈值，取消长按
    if (deltaX > LONG_PRESS_MOVE_THRESHOLD || deltaY > LONG_PRESS_MOVE_THRESHOLD) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        e.target.closest('.agent-item')?.removeEventListener('touchmove', handleAgentLongPressMove);
    }
}

// 长按结束处理
function handleAgentLongPressEnd(e) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    // 移除 touchmove 监听
    if (e.target) {
        const agentItem = e.target.closest('.agent-item');
        if (agentItem) {
            agentItem.removeEventListener('touchmove', handleAgentLongPressMove);
        }
    }
}

// 开始拖拽智能体
function startDragAgent(e, agentId, agentDiv) {
    e.preventDefault();
    e.stopPropagation();

    if (!agentDiv) {
        agentDiv = agentList.querySelector(`.agent-item[data-agent-id="${agentId}"]`);
    }
    if (!agentDiv) return;

    draggedAgentId = agentId;
    draggedAgentElement = agentDiv;

    // 缓存所有智能体元素的位置信息（在拖动开始时一次性获取）
    cacheAgentRects();

    // 创建占位符，设置与原元素相同的高度
    const rect = agentDiv.getBoundingClientRect();
    dragPlaceholder = document.createElement('div');
    dragPlaceholder.className = 'agent-drag-placeholder';
    dragPlaceholder.style.height = rect.height + 'px';
    agentDiv.parentNode.insertBefore(dragPlaceholder, agentDiv.nextSibling);

    agentDiv.classList.add('dragging');
    agentDiv.style.height = '0';
    agentDiv.style.overflow = 'hidden';
    agentDiv.style.padding = '0';
    agentDiv.style.margin = '0';
    agentDiv.style.border = '0';

    // 锁定滚动容器，防止拖动时页面跟着滚动
    const scrollContainer = agentDiv.closest('.modal-body');
    if (scrollContainer) {
        scrollContainer.style.overflow = 'hidden';
    }

    // 绑定移动和结束事件
    if (e.type === 'touchstart') {
        document.addEventListener('touchmove', onDragAgentMove, { passive: false });
        document.addEventListener('touchend', endDragAgent);
    } else {
        document.addEventListener('mousemove', onDragAgentMove);
        document.addEventListener('mouseup', endDragAgent);
    }
}

// 缓存所有智能体元素的位置信息
function cacheAgentRects() {
    cachedAgentRects = [];
    const items = agentList.querySelectorAll('.agent-item');
    items.forEach(item => {
        const rect = item.getBoundingClientRect();
        cachedAgentRects.push({
            element: item,
            top: rect.top,
            height: rect.height,
            centerY: rect.top + rect.height / 2
        });
    });
}

// 拖拽移动中
let dragRafId = null; // requestAnimationFrame ID
let dragClientY = 0; // 缓存鼠标Y坐标

function onDragAgentMove(e) {
    if (!draggedAgentElement) return;

    e.preventDefault();

    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

    // 节流占位符更新
    dragClientY = clientY;
    if (!dragRafId) {
        dragRafId = requestAnimationFrame(updatePlaceholderPosition);
    }
}

function updatePlaceholderPosition() {
    dragRafId = null;

    if (!draggedAgentElement || !dragPlaceholder) return;

    // 使用缓存的位置信息查找最近的目标位置
    let closestItem = null;
    let closestOffset = Infinity;

    cachedAgentRects.forEach(item => {
        // 跳过正在拖动的元素
        if (item.element === draggedAgentElement) return;

        const offset = Math.abs(dragClientY - item.centerY);
        if (offset < closestOffset) {
            closestOffset = offset;
            closestItem = item;
        }
    });

    // 更新占位符位置
    if (closestItem) {
        const insertBefore = dragClientY < closestItem.centerY;
        const referenceNode = insertBefore ? closestItem.element : closestItem.element.nextSibling;

        // 避免将占位符插入到拖动元素之前（会导致跳动）
        if (referenceNode === draggedAgentElement ||
            (dragPlaceholder.nextSibling === draggedAgentElement && !insertBefore)) {
            return;
        }

        // 只在位置真正变化时才移动
        if (dragPlaceholder.nextSibling !== referenceNode) {
            closestItem.element.parentNode.insertBefore(dragPlaceholder, referenceNode);
        }
    }
}

// 结束拖拽
function endDragAgent(e) {
    if (!draggedAgentElement || !draggedAgentId) {
        cleanupDrag();
        return;
    }

    // 移除事件监听
    document.removeEventListener('mousemove', onDragAgentMove);
    document.removeEventListener('mouseup', endDragAgent);
    document.removeEventListener('touchmove', onDragAgentMove);
    document.removeEventListener('touchend', endDragAgent);

    // 将拖拽元素从占位符中移出，放到占位符的位置
    if (dragPlaceholder && dragPlaceholder.parentNode) {
        // 获取对应的 topicDropdown
        const topicDropdown = agentList.querySelector(`.agent-topic-dropdown[data-agent-id="${draggedAgentId}"]`);

        // 在占位符位置插入拖拽元素
        dragPlaceholder.parentNode.insertBefore(draggedAgentElement, dragPlaceholder);

        // topicDropdown 也需要跟着移动
        if (topicDropdown) {
            dragPlaceholder.parentNode.insertBefore(topicDropdown, dragPlaceholder);
        }
    }

    // 获取新的顺序
    const agentItems = Array.from(agentList.querySelectorAll('.agent-item'));
    const newOrder = agentItems.map(item => item.dataset.agentId);

    // 更新 agents 数组顺序
    const reorderedAgents = [];
    newOrder.forEach(id => {
        const agent = agents.find(a => a.id === id);
        if (agent) reorderedAgents.push(agent);
    });

    agents = reorderedAgents;
    localStorage.setItem('cnai_agents', JSON.stringify(agents));

    cleanupDrag();
    renderAgentList();
}

// 清理拖拽状态
function cleanupDrag() {
    if (dragRafId) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
    }
    if (draggedAgentElement) {
        draggedAgentElement.classList.remove('dragging');
        draggedAgentElement.style.height = '';
        draggedAgentElement.style.overflow = '';
        draggedAgentElement.style.padding = '';
        draggedAgentElement.style.margin = '';
        draggedAgentElement.style.border = '';

        // 恢复滚动容器
        const scrollContainer = draggedAgentElement.closest('.modal-body');
        if (scrollContainer) {
            scrollContainer.style.overflow = '';
        }
    }
    if (dragPlaceholder && dragPlaceholder.parentNode) {
        dragPlaceholder.parentNode.removeChild(dragPlaceholder);
    }
    draggedAgentId = null;
    draggedAgentElement = null;
    dragPlaceholder = null;
    cachedAgentRects = [];
}

// 展开/收起智能体的话题列表（改用底部面板 Bottom Sheet）
function toggleAgentTopics(agentId) {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    // 确保该智能体有话题列表
    if (!agentTopics[agentId]) {
        const defaultTopicId = getDefaultTopicId(agentId);
        let newTopic;
        if (defaultTopicId) {
            newTopic = { id: defaultTopicId, name: '新话题', isBuiltIn: false, createTime: Date.now() };
        } else {
            newTopic = generateNewTopic(agentId);
        }
        agentTopics[agentId] = [newTopic];
        saveAgentTopics();
    }

    // 获取该智能体的话题列表
    const topics = agentTopics[agentId];

    // 按最新消息时间排序话题（无消息的按创建时间），并过滤掉无内容的话题
    const sortedTopics = [...topics].sort((a, b) => {
        const keyA = `cnai_messages_${agentId}_topic_${a.id}`;
        const keyB = `cnai_messages_${agentId}_topic_${b.id}`;
        const timeA = _messageLastTimeCache[keyA] || a.createTime || 0;
        const timeB = _messageLastTimeCache[keyB] || b.createTime || 0;
        return timeB - timeA;
    });
    const topicsWithContent = sortedTopics.filter(topic => topic.hasContent === true);

    // 构建面板内容 HTML
    let contentHtml = '';

    // 新建话题按钮（放最上面）
    contentHtml += `
        <div style="padding:8px 16px 4px;">
            <button class="new-topic-in-panel-btn" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;border:1px solid var(--text-secondary);border-radius:10px;background:none;cursor:pointer;font-size:14px;color:var(--text-primary);transition:background-color 0.2s;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                新增话题
            </button>
        </div>
    `;

    contentHtml += '<div class="bs-grid bs-grid-cols-2" style="padding: 4px 12px 12px;">';

    if (topicsWithContent.length > 0) {
        topicsWithContent.forEach(topic => {
            const isActive = agentId === currentAgentId && topic.id === currentTopicId;
            const roundCount = getTopicRoundCount(agentId, topic.id);
            contentHtml += `
                <div class="bs-item bs-item-grid ${isActive ? 'active' : ''}" data-agent-id="${agentId}" data-topic-id="${topic.id}">
                    <span class="bs-item-label">${topic.name}</span>
                    ${roundCount > 0 ? `<span style="font-size:10px;color:var(--text-secondary);margin-top:2px;">${roundCount} 轮</span>` : ''}
                </div>
            `;
        });
    }

    contentHtml += '</div>';

    // 创建底部面板
    const sheet = createBottomSheetPanel({
        title: agent.name + ' 的话题',
        content: contentHtml,
    });

    sheet.show();

    // 绑定话题点击事件
    setTimeout(() => {
        const items = sheet.contentEl.querySelectorAll('.bs-item[data-topic-id]');
        items.forEach(item => {
            item.addEventListener('click', () => {
                const aid = item.dataset.agentId;
                const tid = item.dataset.topicId;
                sheet.hide();
                selectAgentAndTopic(aid, tid);
            });
        });

        const newBtn = sheet.contentEl.querySelector('.new-topic-in-panel-btn');
        if (newBtn) {
            newBtn.addEventListener('click', () => {
                sheet.hide();
                createNewTopicForAgent(agentId);
            });
        }
    }, 0);
}

// 为指定智能体创建新话题
function createNewTopicForAgent(agentId) {
    // 确保话题列表存在
    if (!agentTopics[agentId]) {
        agentTopics[agentId] = [];
    }

    const newTopic = generateNewTopic(agentId);
    agentTopics[agentId].push(newTopic);
    saveAgentTopics();

    // 切换到新话题并初始化空消息
    switchAgentAndTopic(agentId, newTopic.id, () => {
        closeAgentSelectModal();
        closeTopicDrawer();
    }, async () => {
        // 切换完成后保存空消息（防止显示独白）
        await saveMessages([]);
        showWelcomeMessage();
        showToast('新增话题');
    });
}

// 选择智能体和话题
function selectAgentAndTopic(agentId, topicId) {
    switchAgentAndTopic(agentId, topicId, () => {
        closeAgentSelectModal();
    });
}

// 打开创建智能体弹窗
function openCreateAgent() {
    // 创建新智能体（立即保存）
    const newAgent = {
        id: 'agent_' + Date.now(),
        name: '新智能体',
        icon: 'icons/db3_processed/znzs.png',
        systemPrompt: '',
        isBuiltIn: false
    };
    agents.unshift(newAgent);

    // 为新智能体创建默认话题
    const newAgentId = newAgent.id;
    const newTopic = generateNewTopic(newAgentId);
    agentTopics[newAgentId] = [newTopic];
    saveAgentTopics();

    localStorage.setItem('cnai_agents', JSON.stringify(agents));

    // 进入编辑模式
    editingAgentId = newAgentId;
    agentEditTitle.textContent = '创建智能体';
    agentNameInput.value = '';
    setIconPreview('icons/db3_processed/znzs.png');
    agentSystemInput.value = '';
    editingChatBg = null;
    editingChatBgOpacity = 30;
    updateChatBgPreview();
    openModalWithFade(agentEditModal);
    setTimeout(setupModalInputListeners, 100);
}

// 预设智能体数据
const agentPresets = {
    translator: {
        name: '翻译专家',
        systemPrompt: '你是一位专业的翻译专家，精通多国语言，尤其擅长中英文互译。你具有深厚的语言学功底和丰富的翻译经验，能够准确把握原文的语境、风格和文化内涵，提供地道、流畅的译文。翻译时你会注意：1. 保持原文的风格和语气；2. 使用目标语言的习惯表达；3. 处理好文化差异和专有名词；4. 确保译文准确、自然、易读。'
    },
    frontend: {
        name: '前端代码专家',
        systemPrompt: '你是一位资深的前端开发专家，精通HTML、CSS、JavaScript、TypeScript，熟悉React、Vue、Angular等主流框架。你拥有丰富的项目经验和最佳实践知识，能够帮助用户解决各种前端开发问题，包括但不限于：页面布局与样式设计、JavaScript/TypeScript编程、框架使用与优化、性能优化、跨浏览器兼容性、移动端适配、代码架构设计等。你会提供清晰、高效的解决方案，并解释相关原理。'
    },
    screenplay: {
        name: '影视剧本专家',
        systemPrompt: '你是一位专业的影视剧本创作专家，精通剧本结构、人物塑造、对白写作、场景设计等核心技能。你熟悉三幕式结构、英雄之旅等经典叙事模式，了解不同类型电影和电视剧的创作规律。你可以帮助用户：构建引人入胜的故事框架、设计有深度的角色、撰写生动的对白、规划场景节奏、处理情节冲突。你的建议既有理论深度，又有实践指导意义。'
    },
    cinematography: {
        name: '镜头拍摄设计专家',
        systemPrompt: '你是一位专业的镜头拍摄设计专家，精通电影摄影技术、镜头语言和视觉叙事。你熟悉各种摄影器材、镜头特性、灯光布置和拍摄技巧。你可以帮助用户：设计分镜头脚本、选择合适的镜头角度和运动方式、规划场面调度、设计光影效果、把握画面构图和色彩。你的建议能够帮助创作者用镜头语言讲好故事，创造出富有表现力的视觉效果。'
    },
    director: {
        name: '专业导演',
        systemPrompt: '你是一位经验丰富的专业导演，拥有深厚的电影艺术修养和丰富的片场经验。你精通导演工作的各个环节：剧本分析、演员指导、场面调度、镜头设计、后期制作等。你可以为创作者提供全方位的指导：如何把控影片整体风格、如何与演员沟通激发表演、如何协调各部门工作、如何处理创作难题。你的建议既有艺术高度，又有实操价值。'
    },
    promptWriter: {
        name: '高级提示词写手',
        systemPrompt: '你是一位高级AI提示词工程专家，精通提示词设计和优化技术。你了解各种AI模型的特点和能力边界，能够根据不同场景设计出高效、精准的提示词。你可以帮助用户：优化现有提示词、设计复杂任务的处理流程、解决提示词中的歧义和问题、提升AI输出的质量和一致性。你会运用少样本学习、思维链、角色扮演等高级技术，为用户提供专业的提示词解决方案。'
    },
    screenwriter: {
        name: '编剧',
        systemPrompt: '你是一位专业的编剧，精通剧本创作的各个方面，包括故事构思、情节设计、人物塑造、对白撰写等。你熟悉各种类型片的创作规律，能够帮助创作者构建完整的故事世界。你可以协助用户：发展创意概念、完善故事大纲、优化剧本结构、丰富人物形象、打磨对白台词。你的建议既尊重创作规律，又鼓励创新表达。'
    },
    novelist: {
        name: '小说家',
        systemPrompt: '你是一位资深的小说家，拥有丰富的创作经验和深厚的文学素养。你精通小说创作的各种技法，包括叙事视角选择、情节铺陈、人物刻画、环境描写、对话设计等。你可以帮助用户：构思故事框架、发展情节脉络、塑造立体人物、打磨文字风格、处理创作瓶颈。你尊重每位创作者的独特风格，提供有针对性的指导和建议。'
    },
    poet: {
        name: '诗人',
        systemPrompt: '你是一位诗人，对诗歌艺术有着深刻的理解和丰富的创作经验。你熟悉古今中外的诗歌传统，精通各种诗体和创作技法。你可以帮助用户：锤炼诗意语言、构建意象系统、把握诗歌节奏、探索情感表达、发展个人风格。无论是古典诗词还是现代诗歌，你都能提供专业的指导和灵感启发。'
    },
    singer: {
        name: '歌手',
        systemPrompt: '你是一位专业歌手，拥有丰富的演唱经验和音乐素养。你精通各种演唱技巧，包括气息控制、音准把握、情感表达、舞台表现等。你可以帮助用户：提升演唱技巧、选择适合的歌曲、处理歌曲情感、准备演出、保护嗓子。你热爱音乐，乐于分享专业知识，帮助歌唱爱好者成长进步。'
    },
    coach: {
        name: '私人教练',
        systemPrompt: '你是一位专业的私人健身教练，拥有丰富的训练经验和专业的运动科学知识。你熟悉各种训练方法，包括力量训练、有氧运动、柔韧性训练等，了解人体解剖学和运动生理学。你可以帮助用户：制定个性化训练计划、指导正确动作姿势、调整饮食营养方案、设定合理健身目标、避免运动损伤。你会根据用户的具体情况提供科学、安全、有效的健身指导。'
    }
};

// 应用预设值
function applyPreset(presetKey) {
    const preset = agentPresets[presetKey];
    if (preset) {
        if (!confirm('选择预设智能体将覆盖当前的名称和提示词，是否继续？')) return;
        agentNameInput.value = preset.name;
        agentSystemInput.value = preset.systemPrompt;
        saveAgentField();
    }
}

// 编辑智能体
function editAgent(agentId) {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    editingAgentId = agentId;
    agentEditTitle.textContent = '编辑智能体';
    agentNameInput.value = agent.name;
    setIconPreview(agent.icon);
    agentSystemInput.value = agent.systemPrompt || '';

    // 加载聊天背景数据
    editingChatBgOpacity = agent.chatBgOpacity ?? 30;
    if (agent.chatBackground) {
        loadChatBgFromDB(agentId).then(dataUrl => {
            editingChatBg = dataUrl;
            updateChatBgPreview();
        });
    } else {
        editingChatBg = null;
        updateChatBgPreview();
    }

    openModalWithFade(agentEditModal);
    setTimeout(setupModalInputListeners, 100);
}

// 设置图标预览（支持图片和 emoji）
function setIconPreview(icon) {
    if (icon.includes('/') || icon.endsWith('.png') || icon.endsWith('.jpg') || icon.endsWith('.svg')) {
        const whiteIconClass = isWhiteIcon(icon) ? ' white-icon' : '';
        iconPreview.innerHTML = `<img src="${icon}" alt="图标" class="icon-preview-img${whiteIconClass}">`;
    } else {
        iconPreview.textContent = icon;
    }
}

// 获取当前图标预览值
function getIconPreviewValue() {
    const img = iconPreview.querySelector('img');
    if (img) {
        return img.src;
    }
    return iconPreview.textContent;
}

// 更新聊天背景预览
function updateChatBgPreview() {
    const placeholder = document.getElementById('chatBgPlaceholder');
    if (editingChatBg) {
        chatBgPreview.style.backgroundImage = `url(${editingChatBg})`;
        if (placeholder) placeholder.style.display = 'none';
        chatBgOpacityRow.style.display = 'flex';
        chatBgOpacitySlider.value = editingChatBgOpacity;
        chatBgOpacityValue.textContent = editingChatBgOpacity + '%';
    } else {
        chatBgPreview.style.backgroundImage = '';
        if (placeholder) placeholder.style.display = '';
        chatBgOpacityRow.style.display = 'none';
    }
}

// 应用聊天背景到主容器（全屏）
async function applyChatBackground(agent) {
    const container = document.querySelector('.container');
    if (agent.chatBackground) {
        // 从 IndexedDB 读取背景图数据
        const bgDataUrl = await loadChatBgFromDB(agent.id);
        if (!bgDataUrl) {
            document.body.style.background = '';
            if (container) container.style.backgroundColor = '';
            return;
        }
        const opacity = (agent.chatBgOpacity ?? 30) / 100;
        const surfaceColor = getComputedStyle(document.body).getPropertyValue('--surface-color').trim() || '#ffffff';
        const tempEl = document.createElement('div');
        tempEl.style.color = surfaceColor;
        document.body.appendChild(tempEl);
        const rgb = getComputedStyle(tempEl).color;
        document.body.removeChild(tempEl);
        const match = rgb.match(/\d+/g);
        const r = match ? match[0] : 255;
        const g = match ? match[1] : 255;
        const b = match ? match[2] : 255;
        document.body.style.background = `linear-gradient(rgba(${r},${g},${b},${opacity}), rgba(${r},${g},${b},${opacity})), url(${bgDataUrl}) center/cover no-repeat`;
        if (container) container.style.backgroundColor = 'transparent';
    } else {
        document.body.style.background = '';
        if (container) container.style.backgroundColor = '';
    }
}

// 选择聊天背景图片
chatBgSelectBtn.addEventListener('click', () => {
    if (window.AndroidBridge && typeof AndroidBridge.openImageChooser === 'function') {
        // 标记当前是选择背景图片
        window._chatBgSelecting = true;
        AndroidBridge.openImageChooser();
    } else {
        chatBgUploadInput.click();
    }
});

// 处理文件选择（非安卓端）
chatBgUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        editingChatBg = ev.target.result;
        updateChatBgPreview();
        saveAgentField();
    };
    reader.readAsDataURL(file);
    chatBgUploadInput.value = '';
});

// 恢复默认背景
chatBgResetBtn.addEventListener('click', () => {
    editingChatBg = null;
    editingChatBgOpacity = 30;
    updateChatBgPreview();
    saveAgentField();
});

// 透明度滑块
chatBgOpacitySlider.addEventListener('input', (e) => {
    editingChatBgOpacity = parseInt(e.target.value);
    chatBgOpacityValue.textContent = editingChatBgOpacity + '%';
    saveAgentField();
});

// 实时保存智能体当前编辑字段
function saveAgentField() {
    if (!editingAgentId) return;
    const agent = agents.find(a => a.id === editingAgentId);
    if (!agent) return;

    const name = agentNameInput.value.trim();
    if (!name) return; // 名称为空不保存

    // 敏感词检查
    const sensitiveWords = ['刘晓波', '刘晓B', '习近平'];
    for (const word of sensitiveWords) {
        if (name.includes(word) || agentSystemInput.value.trim().includes(word)) {
            showToast('智能体包含敏感词，请修改');
            return;
        }
    }

    agent.name = name;
    agent.icon = getIconPreviewValue();
    agent.systemPrompt = agentSystemInput.value.trim();
    // 背景图存 IndexedDB，localStorage 只存标记
    if (editingChatBg) {
        agent.chatBackground = true;
        agent.chatBgOpacity = editingChatBgOpacity;
        saveChatBgToDB(editingAgentId, editingChatBg);
    } else {
        agent.chatBackground = undefined;
        agent.chatBgOpacity = undefined;
        saveChatBgToDB(editingAgentId, null);
    }

    localStorage.setItem('cnai_agents', JSON.stringify(agents));

    // 如果编辑的是当前智能体，更新显示
    if (editingAgentId === currentAgentId) {
        updateAgentDisplay();
        updateChatAvatar();
        applyChatBackground(agent);
    }
    renderAgentList();
}

// 删除智能体
async function deleteAgent() {
    if (!editingAgentId) return;

    const agent = agents.find(a => a.id === editingAgentId);
    if (agent && agent.isBuiltIn) {
        alert('无法删除内置智能体');
        return;
    }

    if (confirm('确定要删除这个智能体吗？')) {
        agents = agents.filter(a => a.id !== editingAgentId);
        localStorage.setItem('cnai_agents', JSON.stringify(agents));
        saveChatBgToDB(editingAgentId, null); // 清理 IndexedDB 中的背景图

        if (currentAgentId === editingAgentId) {
            currentAgentId = 'default';
            localStorage.setItem('cnai_current_agent', currentAgentId);
            updateAgentDisplay();

            // 加载默认智能体的消息或显示欢迎语
            messages = await getMessages();

            if (messages.length > 0) {
                disposeAllCharts();
                chatContainer.innerHTML = '';
                renderMessagesToChat(messages);
            } else {
                showWelcomeMessage();
            }
        }

        closeModalWithFade(agentEditModal);
        renderAgentList();
        showToast('智能体已删除');
    }
}

// 通用弹窗淡出关闭函数
/**
 * 通用底部弹出选择器
 * @param {Object} options
 * @param {Array} options.items - 选项列表 [{ value, label, icon?, className? }]
 * @param {string} [options.title] - 可选标题
 * @param {Function} options.onSelect - 选中回调 (item) => void
 * @param {string} [options.activeValue] - 当前选中值（高亮显示）
 * @returns {{ show, hide, destroy }}
 */
function createBottomSheetPicker({ items = [], title, onSelect, activeValue, customContent, gridColumns = 0 } = {}) {
    // 创建遮罩
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';

    // 创建面板
    const panel = document.createElement('div');
    panel.className = 'bs-panel';

    // 拖拽把手
    const handleWrapper = document.createElement('div');
    handleWrapper.className = 'bs-handle-wrapper';
    handleWrapper.innerHTML = '<span class="bs-handle"></span>';
    panel.appendChild(handleWrapper);

    // 标题
    if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'bs-title';
        titleEl.textContent = title;
        panel.appendChild(titleEl);
    }

    // 选项
    if (gridColumns > 1) {
        // 网格布局：将 items 分组为 gridColumns 列
        const grid = document.createElement('div');
        grid.className = 'bs-grid bs-grid-cols-' + gridColumns;
        items.forEach(item => {
            if (item === 'divider') {
                // 网格中忽略分隔线
                return;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bs-item bs-item-grid' + (item.className ? ' ' + item.className : '');
            if (item.value === activeValue) btn.classList.add('active');
            if (item.isActive) btn.classList.add('active');
            let html = '';
            if (item.icon) html += `<span class="bs-item-icon">${item.icon}</span>`;
            html += `<span class="bs-item-label">${item.label}</span>`;
            btn.innerHTML = html;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                hide();
                if (onSelect) onSelect(item);
            });
            grid.appendChild(btn);
        });
        panel.appendChild(grid);
    } else {
        items.forEach(item => {
            if (item === 'divider') {
                const divider = document.createElement('div');
                divider.className = 'bs-divider';
                panel.appendChild(divider);
                return;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bs-item' + (item.className ? ' ' + item.className : '');
            if (item.value === activeValue) btn.classList.add('active');
            if (item.isActive) btn.classList.add('active');
            let html = '';
            if (item.icon) html += `<span class="bs-item-icon">${item.icon}</span>`;
            html += `<span>${item.label}</span>`;
            btn.innerHTML = html;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                hide();
                if (onSelect) onSelect(item);
            });
            panel.appendChild(btn);
        });
    }

    // 自定义内容
    if (customContent) {
        const contentEl = document.createElement('div');
        contentEl.className = 'bs-custom-content';
        contentEl.innerHTML = customContent;
        panel.appendChild(contentEl);
    }

    // 点击遮罩关闭
    overlay.addEventListener('click', () => hide());

    // 拖拽关闭（touch + mouse）
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    function onStart(y) {
        startY = y;
        isDragging = true;
        panel.style.transition = 'none';
    }
    function onMove(y) {
        if (!isDragging) return;
        currentY = y - startY;
        if (currentY > 0) {
            panel.style.transform = `translateY(${currentY}px)`;
        }
    }
    function onEnd() {
        const wasDragging = isDragging;
        isDragging = false;
        panel.style.transition = '';
        if (wasDragging) {
            if (currentY > 80) {
                hide();
            } else {
                panel.style.transform = '';
            }
        }
        currentY = 0;
    }
    handleWrapper.addEventListener('touchstart', (e) => onStart(e.touches[0].clientY));
    handleWrapper.addEventListener('touchmove', (e) => onMove(e.touches[0].clientY));
    handleWrapper.addEventListener('touchend', onEnd);
    handleWrapper.addEventListener('mousedown', (e) => { e.preventDefault(); onStart(e.clientY); });
    const onDocMove = (e) => { if (isDragging) onMove(e.clientY); };
    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onEnd);

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    function show() {
        // 强制渲染一帧，确保初始状态生效后再触发动画
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            panel.classList.add('active');
        });
    }

    function hide() {
        overlay.classList.remove('active');
        panel.classList.remove('active');
        panel.style.transform = '';
        // 动画结束后销毁 DOM 和事件监听，防止内存泄漏
        setTimeout(() => destroy(), 300);
    }

    function destroy() {
        document.removeEventListener('mousemove', onDocMove);
        document.removeEventListener('mouseup', onEnd);
        overlay.remove();
        panel.remove();
    }

    return { show, hide, destroy, overlay, panel };
}

// 创建底部弹出输入面板
function createBottomSheetInput({ title, placeholder = '', value = '', inputType = 'text', maxLength, min, max, step, defaultValue, confirmText = '确定', onConfirm } = {}) {
    // 创建遮罩
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';

    // 创建面板
    const panel = document.createElement('div');
    panel.className = 'bs-panel';

    // 拖拽把手
    const handleWrapper = document.createElement('div');
    handleWrapper.className = 'bs-handle-wrapper';
    handleWrapper.innerHTML = '<span class="bs-handle"></span>';
    panel.appendChild(handleWrapper);

    // 标题
    if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'bs-title';
        titleEl.textContent = title + (defaultValue !== undefined ? '\uFF08\u9ED8\u8BA4\u503C' + defaultValue + '\uFF09' : '');
        panel.appendChild(titleEl);
    }

    // 数值类输入框：横向拖动条
    if (inputType === 'number' && min !== undefined && max !== undefined) {
        const sliderWrapper = document.createElement('div');
        sliderWrapper.className = 'bs-slider-wrapper';
        const sliderInner = document.createElement('div');
        sliderInner.className = 'bs-slider-inner';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'bs-slider';
        slider.min = min;
        slider.max = max;
        slider.step = step || 1;
        slider.value = value || min;
        sliderInner.appendChild(slider);
        sliderWrapper.appendChild(sliderInner);
        panel.appendChild(sliderWrapper);
    }

    // 输入框容器
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'bs-input-wrapper';
    const input = document.createElement('textarea');
    input.rows = 6;
    input.className = 'bs-input';
    input.placeholder = placeholder;
    input.value = value;
    if (maxLength) input.maxLength = maxLength;
    // 数值类输入框限制输入内容
    if (inputType === 'number') {
        input.inputMode = 'decimal';
        input.addEventListener('input', () => {
            input.value = input.value.replace(/[^0-9.\-]/g, '');
        });
    }
    inputWrapper.appendChild(input);
    panel.appendChild(inputWrapper);

    // textarea 自动高度适应，超出最大高度可滚动
    input.style.overflowY = 'auto';
    input.style.scrollbarWidth = 'none';
    function autoResize() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.5) + 'px';
    }
    input.addEventListener('input', autoResize);
    setTimeout(autoResize, 0);

    // 滑动条与输入框联动
    const sliderEl = panel.querySelector('.bs-slider');
    if (sliderEl) {
        sliderEl.addEventListener('input', () => { input.value = sliderEl.value; });
        input.addEventListener('input', () => {
            let v = parseFloat(input.value);
            if (!isNaN(v)) {
                v = Math.max(parseFloat(min), Math.min(parseFloat(max), v));
                sliderEl.value = v;
            }
        });
    }

    // 按钮行
    const btnRow = document.createElement('div');
    btnRow.className = 'bs-btn-row';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hide();
    });
    btnRow.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'bs-confirm-btn';
    confirmBtn.textContent = confirmText;
    confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        let val = input.value;
        // 数值类校验
        if (inputType === 'number') {
            if (val === '' || val === null || val === undefined) {
                val = defaultValue !== undefined ? defaultValue : (min !== undefined ? min : '');
            } else {
                val = parseFloat(val);
                if (isNaN(val)) val = defaultValue !== undefined ? parseFloat(defaultValue) : (min !== undefined ? min : '');
                if (min !== undefined && val < min) val = min;
                if (max !== undefined && val > max) val = max;
            }
            val = String(val);
        }
        hide();
        if (onConfirm) onConfirm(val);
    });
    btnRow.appendChild(confirmBtn);
    panel.appendChild(btnRow);

    // 点击遮罩关闭
    overlay.addEventListener('click', () => hide());

    // 拖拽关闭（touch + mouse）
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    function onStart(y) {
        startY = y;
        isDragging = true;
        panel.style.transition = 'none';
    }
    function onMove(y) {
        if (!isDragging) return;
        currentY = y - startY;
        if (currentY > 0) {
            panel.style.transform = `translateY(${currentY}px)`;
        }
    }
    function onEnd() {
        const wasDragging = isDragging;
        isDragging = false;
        panel.style.transition = '';
        if (wasDragging) {
            if (currentY > 80) {
                hide();
            } else {
                panel.style.transform = '';
            }
        }
        currentY = 0;
    }
    handleWrapper.addEventListener('touchstart', (e) => onStart(e.touches[0].clientY));
    handleWrapper.addEventListener('touchmove', (e) => onMove(e.touches[0].clientY));
    handleWrapper.addEventListener('touchend', onEnd);
    handleWrapper.addEventListener('mousedown', (e) => { e.preventDefault(); onStart(e.clientY); });
    const onDocMove = (e) => { if (isDragging) onMove(e.clientY); };
    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onEnd);

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    function show() {
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            panel.classList.add('active');
            // 自动聚焦输入框
            setTimeout(() => input.focus(), 300);
        });
    }

    function hide() {
        overlay.classList.remove('active');
        panel.classList.remove('active');
        panel.style.transform = '';
        // 动画结束后销毁
        setTimeout(() => destroy(), 300);
    }

    function destroy() {
        document.removeEventListener('mousemove', onDocMove);
        document.removeEventListener('mouseup', onEnd);
        overlay.remove();
        panel.remove();
    }

    return { show, hide, destroy, overlay, panel };
}

// 通用底部弹出面板（用于管理模型、历史模型、备份恢复等）
function createBottomSheetPanel({ title, content, onClose } = {}) {
    // 创建遮罩
    const overlay = document.createElement('div');
    overlay.className = 'bs-overlay';

    // 创建面板
    const panel = document.createElement('div');
    panel.className = 'bs-panel';

    // 拖拽把手
    const handleWrapper = document.createElement('div');
    handleWrapper.className = 'bs-handle-wrapper';
    handleWrapper.innerHTML = '<span class="bs-handle"></span>';
    panel.appendChild(handleWrapper);

    // 标题栏
    if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'bs-title';
        titleEl.textContent = title;
        panel.appendChild(titleEl);
    }

    // 内容区域
    const contentEl = document.createElement('div');
    contentEl.className = 'bs-panel-content';
    if (typeof content === 'string') {
        contentEl.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        contentEl.appendChild(content);
    }
    panel.appendChild(contentEl);

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    // 点击遮罩关闭
    overlay.addEventListener('click', () => hide());

    // 拖拽关闭（touch + mouse）
    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    function onStart(y) {
        startY = y;
        isDragging = true;
        panel.style.transition = 'none';
    }
    function onMove(y) {
        if (!isDragging) return;
        currentY = y - startY;
        if (currentY > 0) {
            panel.style.transform = `translateY(${currentY}px)`;
        }
    }
    function onEnd() {
        const wasDragging = isDragging;
        isDragging = false;
        panel.style.transition = '';
        if (wasDragging) {
            if (currentY > 80) {
                hide();
            } else {
                panel.style.transform = '';
            }
        }
        currentY = 0;
    }
    handleWrapper.addEventListener('touchstart', (e) => onStart(e.touches[0].clientY));
    handleWrapper.addEventListener('touchmove', (e) => onMove(e.touches[0].clientY));
    handleWrapper.addEventListener('touchend', onEnd);
    handleWrapper.addEventListener('mousedown', (e) => { e.preventDefault(); onStart(e.clientY); });
    const onDocMove = (e) => { if (isDragging) onMove(e.clientY); };
    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onEnd);

    function show() {
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            panel.classList.add('active');
            // 动画结束后固定面板高度，防止内容变化时面板跳动
            setTimeout(() => {
                const h = panel.getBoundingClientRect().height;
                panel.style.height = h + 'px';
            }, 350);
        });
    }

    function hide() {
        overlay.classList.remove('active');
        panel.classList.remove('active');
        panel.style.transform = '';
        if (onClose) onClose();
        setTimeout(() => destroy(), 300);
    }

    function destroy() {
        document.removeEventListener('mousemove', onDocMove);
        document.removeEventListener('mouseup', onEnd);
        overlay.remove();
        panel.remove();
    }

    return { show, hide, destroy, overlay, panel, contentEl };
}

// 主界面元素
const mainHeader = document.querySelector('.header');
const mainContainer = document.querySelector('.container');

// 主界面淡出
function fadeOutMain(duration = 0.25) {
    mainHeader.style.transition = 'none';
    mainContainer.style.transition = 'none';
    void mainHeader.offsetHeight;
    requestAnimationFrame(() => {
        mainHeader.style.transition = `transform ${duration}s cubic-bezier(0.4, 0, 0.2, 1)`;
        mainContainer.style.transition = `transform ${duration}s cubic-bezier(0.4, 0, 0.2, 1)`;
        mainHeader.style.transform = 'translateX(-10%)';
        mainContainer.style.transform = 'translateX(-10%)';
    });
}

// 主界面淡入
function fadeInMain(duration = 0.25) {
    mainHeader.style.transition = 'none';
    mainContainer.style.transition = 'none';
    mainHeader.style.transform = 'translateX(-10%)';
    mainContainer.style.transform = 'translateX(-10%)';
    void mainHeader.offsetHeight;
    requestAnimationFrame(() => {
        mainHeader.style.transition = `transform ${duration}s cubic-bezier(0.4, 0, 0.2, 1)`;
        mainContainer.style.transition = `transform ${duration}s cubic-bezier(0.4, 0, 0.2, 1)`;
        mainHeader.style.transform = 'translateX(0)';
        mainContainer.style.transform = 'translateX(0)';
    });
}

// 通用打开弹窗（带过渡动画）
function openModalWithFade(modal) {
    console.log('[动画锁] openModalWithFade', Date.now());
    const modalInner = modal.querySelector('.modal');
    const prevPanel = currentPanel;
    // 把当前面板压栈
    if (prevPanel) panelStack.push(prevPanel);
    modal.classList.add('active');
    // 如果从主界面打开（没有上一个面板），淡出主界面
    if (!prevPanel) fadeOutMain();
    // 旧面板向左滑出
    if (prevPanel) {
        prevPanel.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        prevPanel.style.transform = 'translateX(-10%)';
    }
    // 新面板从右滑入
    modalInner.style.transition = 'none';
    modalInner.style.transform = 'translateX(30%)';
    void modalInner.offsetHeight;
    modalInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    modalInner.style.transform = 'translateX(0)';
    setTimeout(() => {
        if (prevPanel) {
            prevPanel.style.transition = '';
            prevPanel.style.transform = '';
            prevPanel.style.opacity = '';
        }
        modalInner.style.transition = '';
        modalInner.style.transform = '';
        modalInner.style.opacity = '';
    }, 250);
    currentPanel = modalInner;
}

function closeModalWithFade(modal, callback) {
    console.log('[动画锁] closeModalWithFade', Date.now());
    if (!modal || !modal.classList.contains('active')) {
        if (callback) callback();
        return;
    }
    const modalInner = modal.querySelector('.modal');
    // 从栈中弹出上一个面板
    const prevPanel = panelStack.pop() || null;
    // 立即让 overlay 背景透明，不遮住下层面板的淡入
    modal.style.backgroundColor = 'transparent';
    // 如果回到主界面（没有上一个面板），淡入主界面
    if (!prevPanel) fadeInMain();
    // 当前面板向右滑出+淡出
    modalInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease';
    modalInner.style.transform = 'translateX(10%)';
    modalInner.style.opacity = '0';
    // 旧面板从左滑入
    if (prevPanel) {
        prevPanel.style.transition = 'none';
        prevPanel.style.transform = 'translateX(-10%)';
        void prevPanel.offsetHeight;
        prevPanel.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        prevPanel.style.transform = 'translateX(0)';
    }
    setTimeout(() => {
        modal.classList.remove('active');
        modal.style.backgroundColor = '';
        modalInner.style.transition = '';
        modalInner.style.transform = '';
        modalInner.style.opacity = '';
        if (prevPanel) {
            prevPanel.style.transition = '';
            prevPanel.style.transform = '';
            prevPanel.style.opacity = '';
        }
        if (callback) callback();
    }, 250);
    currentPanel = prevPanel;
}

/**
 * 通用面板淡入淡出动画
 * @param {Object} options
 * @param {HTMLElement} options.fromEl - 要淡出的元素（可选）
 * @param {HTMLElement} options.toEl - 要淡入的元素
 * @param {string} options.direction - 'left' 从右往左, 'right' 从左往右
 * @param {number} options.fadeOutDuration - 淡出时长(秒)，默认0.1
 * @param {number} options.fadeInDuration - 淡入时长(秒)，默认0.25
 * @param {Function} options.onFadeOut - 淡出完成后的回调（用于清理状态）
 * @param {Function} options.onFadeIn - 淡入完成后的回调
 * @param {string} options.fadeOutOffset - 淡出偏移，默认 '30%'
 * @param {string} options.fadeInOffset - 淡入起始偏移，默认 '100%'
 */
function panelFadeTransition(options) {
    const {
        fromEl,
        toEl,
        direction = 'left',
        fadeOutDuration = 0.25,
        fadeInDuration = 0.25,
        onFadeOut,
        onFadeIn
    } = options;

    const sign = direction === 'left' ? -1 : 1;

    // 准备淡入元素：设置初始位置（无过渡）
    if (toEl) {
        toEl.style.transition = 'none';
        toEl.style.transform = `translateX(${sign > 0 ? '-' : ''}30%)`;
        void toEl.offsetHeight;
    }

    // rAF确保浏览器已渲染初始状态
    requestAnimationFrame(() => {
        // 淡出和淡入同时开始
        if (fromEl) {
            fromEl.style.transition = `transform ${fadeOutDuration}s cubic-bezier(0.4, 0, 0.2, 1), opacity ${fadeOutDuration}s ease`;
            fromEl.style.transform = `translateX(${sign * 10}%)`;
            fromEl.style.opacity = '0';
        }

        if (toEl) {
            toEl.style.transition = `transform ${fadeInDuration}s cubic-bezier(0.4, 0, 0.2, 1)`;
            toEl.style.transform = 'translateX(0)';
        }

        // 淡出完成后回调
        if (fromEl && onFadeOut) {
            setTimeout(onFadeOut, fadeOutDuration * 1000);
        }
        // 淡入完成后回调
        if (onFadeIn) {
            setTimeout(onFadeIn, fadeInDuration * 1000);
        }
    });
}

// 关闭智能体选择弹窗
function closeAgentSelectModal() {
    closeModalWithFade(agentSelectModal);
}

// 关闭智能体编辑弹窗
function closeAgentEditModal() {
    closeModalWithFade(agentEditModal);
}

// 显示欢迎消息
function showWelcomeMessage(agent = null) {
    const currentAgent = agent || getCurrentAgent();
    disposeAllCharts();
    chatContainer.innerHTML = '';
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'welcome-message';

    // 显示系统提示词的简略版本
    const systemPrompt = currentAgent.systemPrompt || '你可以向我提问任何问题，我会尽力帮助你。';
    const truncatedPrompt = systemPrompt.length > 100 ? systemPrompt.substring(0, 100) + '...' : systemPrompt;
    welcomeDiv.innerHTML = `<p>${truncatedPrompt}</p>`;
    chatContainer.appendChild(welcomeDiv);

    // 显示智能体标签栏
    updateAgentTagsBarVisibility();
}

// 更新智能体标签栏显示状态
function updateAgentTagsBarVisibility() {
    // 检查当前话题是否为空
    const isEmpty = messages.length === 0;

    if (isEmpty && agentTagsBar) {
        agentTagsBar.style.display = 'block';
        renderAgentTags();
    } else if (agentTagsBar) {
        agentTagsBar.style.display = 'none';
    }
}

// 渲染智能体标签栏
function renderAgentTags() {
    if (!agentTagsScroll) return;

    agentTagsScroll.innerHTML = '';

    // 创建单个标签的辅助函数
    const createTagElement = (agent, isClone = false) => {
        const tag = document.createElement('div');
        tag.className = `agent-tag ${agent.id === currentAgentId ? 'active' : ''}`;
        tag.dataset.agentId = agent.id;
        if (isClone) tag.dataset.clone = 'true';

        // 图标
        const iconDiv = document.createElement('div');
        iconDiv.className = 'agent-tag-icon';

        if (agent.icon.includes('/') || agent.icon.endsWith('.png') || agent.icon.endsWith('.jpg') || agent.icon.endsWith('.svg')) {
            const whiteIconClass = isWhiteIcon(agent.icon) ? ' white-icon' : '';
            iconDiv.innerHTML = `<img src="${agent.icon}" alt="${agent.name}" class="${whiteIconClass}">`;
        } else {
            iconDiv.textContent = agent.icon;
        }

        // 名称
        const nameSpan = document.createElement('span');
        nameSpan.className = 'agent-tag-name';
        nameSpan.textContent = agent.name;

        tag.appendChild(iconDiv);
        tag.appendChild(nameSpan);

        // 点击切换智能体（移动当前话题到目标智能体）
        tag.addEventListener('click', async () => {
            if (agent.id !== currentAgentId) {
                // 确保当前智能体的话题列表已初始化
                const currentTopics = getCurrentAgentTopics();
                const currentTopicIndex = currentTopics.findIndex(t => t.id === currentTopicId);
                const currentTopic = currentTopicIndex >= 0 ? currentTopics[currentTopicIndex] : null;

                if (currentTopic) {
                    // 从当前智能体移除该话题
                    currentTopics.splice(currentTopicIndex, 1);
                    agentTopics[currentAgentId] = currentTopics;

                    // 如果当前智能体没有话题了，创建一个新话题
                    if (currentTopics.length === 0) {
                        const newTopic = generateNewTopic(currentAgentId);
                        agentTopics[currentAgentId].push(newTopic);
                    }

                    // 移动话题的消息到目标智能体
                    const oldMessagesKey = `cnai_messages_${currentAgentId}_topic_${currentTopicId}`;
                    const messagesData = await getMessagesFromDB(oldMessagesKey);

                    // 删除旧位置的消息
                    deleteMessagesFromDB(oldMessagesKey);

                    // 确保目标智能体有话题数组
                    if (!agentTopics[agent.id]) {
                        agentTopics[agent.id] = [];
                    }

                    // 将话题添加到目标智能体
                    agentTopics[agent.id].push(currentTopic);
                    saveAgentTopics();

                    // 在新位置保存消息
                    const newMessagesKey = `cnai_messages_${agent.id}_topic_${currentTopicId}`;
                    if (messagesData) {
                        saveMessagesToDB(newMessagesKey, messagesData);
                    }

                    // 切换到目标智能体和移动的话题
                    switchAgentAndTopic(agent.id, currentTopicId, null, () => {
                        renderAgentTags();
                    });
                }
            }
        });

        return tag;
    };

    // 无缝循环：在末尾添加一组克隆标签
    agents.forEach(agent => {
        const tag = createTagElement(agent, true);
        agentTagsScroll.appendChild(tag);
    });

    // 渲染原始标签
    agents.forEach(agent => {
        const tag = createTagElement(agent, false);
        agentTagsScroll.appendChild(tag);
    });

    // 无缝循环：在末尾再添加一组克隆标签
    agents.forEach(agent => {
        const tag = createTagElement(agent, true);
        agentTagsScroll.appendChild(tag);
    });

    // 设置初始滚动位置到当前选中的智能体标签
    requestAnimationFrame(() => {
        const activeTag = agentTagsScroll.querySelector('.agent-tag.active:not([data-clone])');
        if (activeTag) {
            const containerWidth = agentTagsScroll.clientWidth;
            const tagLeft = activeTag.offsetLeft;
            const tagWidth = activeTag.offsetWidth;
            // 将选中标签居中显示
            agentTagsScroll.scrollLeft = tagLeft - (containerWidth - tagWidth) / 2;
        } else {
            // 没有选中标签时，滚动到第一个原始标签
            const firstOriginalTag = agentTagsScroll.querySelector('.agent-tag:not([data-clone])');
            if (firstOriginalTag) {
                agentTagsScroll.scrollLeft = firstOriginalTag.offsetLeft - 8;
            }
        }
    });

    // 无缝循环滚动处理
    agentTagsScroll._infiniteScrollHandler = () => {
        const scrollLeft = agentTagsScroll.scrollLeft;
        const scrollWidth = agentTagsScroll.scrollWidth;
        const clientWidth = agentTagsScroll.clientWidth;
        const tagWidth = scrollWidth / 3; // 三组标签（前克隆 + 原始 + 后克隆）

        // 滚动到末尾克隆区域，跳转到开头的原始区域
        if (scrollLeft >= tagWidth * 2 - clientWidth / 2) {
            agentTagsScroll.scrollLeft = scrollLeft - tagWidth;
        }
        // 滚动到开头克隆区域，跳转到末尾的原始区域
        else if (scrollLeft < tagWidth - clientWidth / 2) {
            agentTagsScroll.scrollLeft = scrollLeft + tagWidth;
        }
    };

    agentTagsScroll.removeEventListener('scroll', agentTagsScroll._infiniteScrollHandler);
    agentTagsScroll.addEventListener('scroll', agentTagsScroll._infiniteScrollHandler);
}

// 获取状态栏颜色（根据当前背景主题和主题色计算）
function getStatusBarColor() {
    if (currentBgTheme === 'dark') return '#1a1a1a';
    if (currentBgTheme === 'sunset') return '#FFF8E1';
    if (currentBgTheme === 'starlight') return '#0F1B30';
    return '#ffffff';
}

// 获取导航栏颜色
function getNavigationBarColor() {
    if (currentBgTheme === 'dark') return '#1a1a1a';
    if (currentBgTheme === 'sunset') return '#FFF8E1';
    if (currentBgTheme === 'starlight') return '#0F1B30';
    return '#ffffff';
}

// 更新状态栏颜色
function updateStatusBar() {
    const statusBarColor = getStatusBarColor();

    if (window.StatusBar) {
        StatusBar.backgroundColorByHexString(statusBarColor);
        if (currentBgTheme === 'dark' || currentBgTheme === 'starlight') {
            StatusBar.styleLightContent();
        } else {
            StatusBar.styleDefault();
        }
    }

    // 同时调用原生 AndroidBridge 接口（更可靠）
    if (typeof AndroidBridge !== 'undefined' && AndroidBridge.setStatusBarColor) {
        AndroidBridge.setStatusBarColor(statusBarColor);
    }

    // 同步更新导航栏颜色
    updateNavigationBar();
}

// 更新导航栏颜色
function updateNavigationBar() {
    // 开屏期间保持黑色，不更新
    return;
    const navBarColor = getNavigationBarColor();
    if (typeof AndroidBridge !== 'undefined' && AndroidBridge.setNavigationBarColor) {
        AndroidBridge.setNavigationBarColor(navBarColor);
    }
}

// 应用消息字体大小
function applyMessageFontSize() {
    document.documentElement.style.setProperty('--message-font-size', messageFontSize + 'px');
}

// 应用主题
function applyTheme(themeName) {
    const theme = themes[themeName];
    if (!theme) return;

    // 极简风格：根据背景模式切换颜色
    if (themeName === 'minimal') {
        document.body.classList.add('minimal-theme');
        if (currentBgTheme === 'dark' || currentBgTheme === 'starlight') {
            document.documentElement.style.setProperty('--primary-color', '#ffffff');
            document.documentElement.style.setProperty('--primary-hover', '#cccccc');
            document.documentElement.style.setProperty('--title-gradient', 'linear-gradient(135deg, #ffffff, #cccccc, #999999)');
        } else {
            document.documentElement.style.setProperty('--primary-color', '#000000');
            document.documentElement.style.setProperty('--primary-hover', '#333333');
            document.documentElement.style.setProperty('--title-gradient', 'linear-gradient(135deg, #666666, #000000, #1a1a1a)');
        }
    } else {
        document.body.classList.remove('minimal-theme');
        document.documentElement.style.setProperty('--primary-color', theme.primary);
        document.documentElement.style.setProperty('--primary-hover', theme.hover);
        const gradient = (currentBgTheme === 'dark' || currentBgTheme === 'starlight')
            ? `linear-gradient(135deg, ${lightenColor(theme.primary, 40)}, ${theme.primary}, ${theme.hover})`
            : `linear-gradient(135deg, ${theme.hover}, ${theme.primary}, ${lightenColor(theme.primary, 40)})`;
        document.documentElement.style.setProperty('--title-gradient', gradient);
    }
    currentTheme = themeName;
    updateStatusBar();
}

// 更新标题渐变（背景切换时调用）
function updateTitleGradient() {
    if (currentTheme === 'minimal') return; // 极简风格由applyTheme处理
    const theme = themes[currentTheme];
    if (!theme) return;
    const gradient = (currentBgTheme === 'dark' || currentBgTheme === 'starlight')
        ? `linear-gradient(135deg, ${lightenColor(theme.primary, 40)}, ${theme.primary}, ${theme.hover})`
        : `linear-gradient(135deg, ${theme.hover}, ${theme.primary}, ${lightenColor(theme.primary, 40)})`;
    document.documentElement.style.setProperty('--title-gradient', gradient);
}

// 更新主题选择器显示
function updateThemePicker() {
    if (themeColorSelectText) {
        const color = themes[currentTheme]?.primary || '#059669';
        const name = themeNames[currentTheme] || '翠竹清风';
        themeColorSelectText.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + color + ';margin:0 8px 0 0;vertical-align:middle;flex-shrink:0;border:1px solid #000;"></span>' + name;
    }
}

// 切换主题（仅预览，不保存）
function switchTheme(themeName) {
    applyTheme(themeName);
    updateThemePicker();
}

// 应用背景主题
function applyBgTheme(bgTheme) {
    // 移除所有背景主题类
    document.body.classList.remove('dark-theme', 'sunset-theme', 'starlight-theme');
    if (bgTheme === 'dark') {
        document.body.classList.add('dark-theme');
    } else if (bgTheme === 'sunset') {
        document.body.classList.add('sunset-theme');
    } else if (bgTheme === 'starlight') {
        // 星海蓝是深色类主题，同时添加 dark-theme 复用所有深色组件样式
        // starlight-theme 的变量定义在 dark-theme 之后，优先级更高
        document.body.classList.add('dark-theme', 'starlight-theme');
    }
    currentBgTheme = bgTheme;
    // 极简风格下背景切换需要重新应用主题色
    if (currentTheme === 'minimal') {
        applyTheme('minimal');
    }
    // 更新标题渐变方向
    updateTitleGradient();
    updateStatusBar();
    // 重新应用聊天背景，更新遮罩层颜色
    const currentAgent = agents.find(a => a.id === currentAgentId);
    if (currentAgent) applyChatBackground(currentAgent);
}

// 更新背景主题选择器显示
function updateBgThemePicker() {
    if (darkThemeSwitch) darkThemeSwitch.checked = (currentBgTheme === 'dark');
    if (bgThemeSelectText) {
        const name = bgThemeNames[currentBgTheme] || '浅色';
        const color = bgThemeColors[currentBgTheme] || '#ffffff';
        bgThemeSelectText.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + color + ';margin:0 8px 0 0;vertical-align:middle;flex-shrink:0;border:1px solid #ccc;"></span>' + name;
    }
}

// 切换背景主题（仅预览，不保存）
function switchBgTheme(bgTheme) {
    applyBgTheme(bgTheme);
    updateBgThemePicker();
}

// 格式化时间戳 (YYYY-MM-DD HH:mm:ss)
function formatTimestamp(date) {
    const now = date || new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 更新常用模型列表（保存所有使用过的模型，不限数量）
function updateFrequentModels() {
    if (!selectedModel) return;

    // 获取模型显示名称
    const models = cachedModels[currentAIProvider] || [];
    const modelInfo = models.find(m => m.id === selectedModel);
    const modelName = modelInfo ? modelInfo.name : selectedModel;

    // 构建新的常用模型项
    const newItem = {
        provider: currentAIProvider,
        modelId: selectedModel,
        modelName: modelName
    };

    // 移除已存在的相同模型
    frequentModels = frequentModels.filter(m =>
        !(m.provider === newItem.provider && m.modelId === newItem.modelId)
    );

    // 添加到列表开头
    frequentModels.unshift(newItem);

    // 保存到 localStorage（不设上限）
    localStorage.setItem('cnai_frequent_models', JSON.stringify(frequentModels));
}

// 切换到指定模型（从常用模型选择）
function switchToFrequentModel(provider, modelId) {
    // 更新 AI 企业
    currentAIProvider = provider;
    aiProviderSelect.value = provider;
    localStorage.setItem('cnai_ai_provider', provider);

    // 更新 API Key
    apiKey = apiKeys[provider] || '';
    apiKeyInput.value = apiKey;
    updateGetApiKeyBtnState();

    // 更新模型列表和选择
    updateModelOptions();
    selectedModel = modelId;
    modelSelect.value = modelId;

    // 保存模型选择
    selectedModelsByProvider[provider] = modelId;
    localStorage.setItem('cnai_selected_models_by_provider', JSON.stringify(selectedModelsByProvider));
    localStorage.setItem('cnai_model', modelId);

    // 更新输入框下方模型名称显示
    updateCurrentModelName();

    // 更新深度思考设置
    deepThinkingEnabled = deepThinkingByProvider[provider] !== false;
    deepThinkingSwitch.checked = deepThinkingEnabled;
    updateDeepThinkingToggleBtn();

    // 更新 Session 缓存开关显示状态
    updateSessionCacheVisibility();

    // 更新联网搜索开关显示状态（豆包、千问、MiMo、DeepSeek 支持）
    if (webSearchFormGroup) {
        webSearchFormGroup.style.display = WEB_SEARCH_PROVIDERS.includes(provider) ? 'block' : 'none';
    }
    if (webSearchSwitch) {
        webSearchSwitch.checked = webSearchEnabled;
        updateWebSearchToggleBtn();
    }

    // 关闭更多操作菜单
    closeChatMenuSheet();

    // 显示提示
    const providerNames = { qwen: '千问', deepseek: 'DeepSeek', doubao: '豆包', glm: '智谱', mimo: 'MiMo' };
    showToast(`已切换到 ${providerNames[provider] || provider} - ${modelId}`);
}

// 更新 AI 消息编号
function updateAiMessageNumbers() {
    const allMessages = chatContainer.querySelectorAll('.message');
    let aiIndex = 0;
    allMessages.forEach(msgDiv => {
        if (msgDiv.classList.contains('ai')) {
            aiIndex++;
            const modelNameSpan = msgDiv.querySelector('.message-model-name');
            if (modelNameSpan) {
                const modelName = modelNameSpan.textContent.split(' | ')[0];
                modelNameSpan.textContent = `${modelName} | ${aiIndex}`;
            }
        }
    });
}

// 添加消息到 UI
// versions: 可选，AI 消息的多版本数组 [{ content, reasoning, timestamp, modelName }]
// currentVersionIndex: 可选，当前显示的版本索引（从0开始）
// annotations: 可选，联网搜索引用来源
function appendMessage(role, content, animate = true, showRefresh = false, timestamp = null, modelName = null, versions = null, currentVersionIndex = 0, images = null, files = null, annotations = null, messageId = null) {
    // 隐藏或移除欢迎消息
    const welcomeMsg = chatContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.style.display = 'none';
    }

    const messageDiv = document.createElement('div');
    const cssRole = role === 'assistant' || role === 'ai' ? 'ai' : role;
    messageDiv.className = `message ${cssRole}`;
    // 添加 timestamp 作为 data 属性，用于后续查找
    if (timestamp) {
        messageDiv.dataset.timestamp = timestamp;
    }
    // 添加 messageId 作为 data 属性，用于 ID 定位
    if (messageId) {
        messageDiv.dataset.messageId = messageId;
    }

    // 生成图片缩略图 HTML
    let imagesHtml = '';
    if (images && images.length > 0) {
        imagesHtml = '<div class="message-images">';
        images.forEach((img, index) => {
            imagesHtml += `<div class="message-image-wrapper" onclick="openImageLightbox('${img.base64}', '${img.name || '图片'}')">
                <img src="${img.base64}" alt="${img.name || '图片'}" class="message-image-thumbnail">
            </div>`;
        });
        imagesHtml += '</div>';
    }

    // 生成文件预览 HTML
    let filesHtml = '';
    if (files && files.length > 0) {
        filesHtml = '<div class="message-files">';
        files.forEach((file, index) => {
            // 使用 data 属性存储文件名和内容，避免依赖全局变量
            const escapedName = file.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const escapedContent = (file.content || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '&#10;');

            // 如果有缩略图，显示缩略图；否则显示图标
            const previewHtml = file.thumbnail
                ? `<img src="${file.thumbnail}" alt="${escapedName}" class="message-file-thumbnail">`
                : `<span class="message-file-icon">${getFileIcon(file.name)}</span>`;

            filesHtml += `<div class="message-file-item ${file.thumbnail ? 'has-thumbnail' : ''}" data-filename="${escapedName}" data-content="${escapedContent}">
                ${previewHtml}
                <span class="message-file-name">${file.name}</span>
            </div>`;
        });
        filesHtml += '</div>';
    }

    // 处理多模态消息内容：如果是数组，提取文本用于显示
    let displayContent = content;
    let imageCount = 0;
    if (Array.isArray(content)) {
        const textParts = [];
        content.forEach(item => {
            if (item.type === 'text') {
                textParts.push(item.text);
            } else if (item.type === 'image_url') {
                imageCount++;
            }
        });
        displayContent = textParts.join('');
    }

    // 获取头像（支持图片和 emoji）
    const agent = getCurrentAgent();
    let avatar;
    if (role === 'user') {
        avatar = '⭐';
    } else if (agent.icon.includes('/') || agent.icon.endsWith('.png') || agent.icon.endsWith('.jpg') || agent.icon.endsWith('.svg')) {
        const whiteIconClass = isWhiteIcon(agent.icon) ? ' white-icon' : '';
        avatar = `<img src="${agent.icon}" alt="${agent.name}" class="message-avatar-img${whiteIconClass}">`;
    } else {
        avatar = agent.icon;
    }

    // 如果没有传入时间戳，使用当前时间
    const msgTimestamp = timestamp ? formatTimestamp(new Date(timestamp)) : formatTimestamp();

    // AI 消息显示模型名称和编号
    let modelLabel = '';
    let versionSwitcherHtml = '';

    if (role === 'assistant' || role === 'ai') {
        // 计算当前 AI 消息编号
        const existingAiMessages = chatContainer.querySelectorAll('.message.ai');
        const aiNumber = existingAiMessages.length + 1;
        // 使用传入的 modelName 或当前选择的模型
        const model = modelName || selectedModel;
        modelLabel = `${model} | ${aiNumber}`;

        // 如果有多版本，生成版本切换按钮
        if (versions && versions.length > 1) {
            const totalVersions = versions.length;
            const currentDisplay = currentVersionIndex + 1; // 显示时从1开始
            versionSwitcherHtml = `
                <div class="version-switcher" data-current="${currentVersionIndex}" data-total="${totalVersions}">
                    <button class="version-nav-btn version-prev-btn" title="上一版本">&lt;</button>
                    <span class="version-indicator">${currentDisplay}/${totalVersions}</span>
                    <button class="version-nav-btn version-next-btn" title="下一版本">&gt;</button>
                </div>
            `;
        }
    }

    messageDiv.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content-wrapper">
            ${role === 'assistant' || role === 'ai' ? '<div class="message-timestamp-wrapper"><span class="message-timestamp">' + msgTimestamp + '</span>' + versionSwitcherHtml + '</div>' : ''}
            <div class="message-content" data-content="${escapeHtml(displayContent).replace(/"/g, '&quot;')}">
                ${filesHtml}
                ${imagesHtml}
                ${formatMessage(displayContent)}
                ${annotations && annotations.length > 0 ? generateAnnotationsHtml(annotations) : ''}
            </div>
            ${role === 'assistant' || role === 'ai' ? '<div class="message-bottom-row">' +
            '<div class="message-actions">' +
            '<button class="message-action-btn delete-btn" title="删除">' + ICONS.delete + '</button>' +
            '<button class="message-action-btn edit-btn" title="编辑">' + ICONS.edit + '</button>' +
            '<button class="message-action-btn copy-btn" title="复制">' + ICONS.copy + '</button>' +
            '</div>' +
            '<span class="message-model-name">' + (modelLabel || '') + '</span>' +
            '</div>' : '<div class="message-actions">' +
            '<button class="message-action-btn resend-btn" title="重新发送">' + ICONS.resend + '</button>' +
            '<button class="message-action-btn copy-btn" title="复制">' + ICONS.copy + '</button>' +
            '<button class="message-action-btn edit-btn" title="编辑">' + ICONS.edit + '</button>' +
            '<button class="message-action-btn delete-btn" title="删除">' + ICONS.delete + '</button>' +
        '</div>'}
        </div>
    `;
    if (resendInsertBefore) {
        // 重发模式：插入到用户消息之后的正确位置
        chatContainer.insertBefore(messageDiv, resendInsertBefore);
        resendInsertBefore = null;
    } else {
        chatContainer.appendChild(messageDiv);
    }
    if (animate) {
        // 滚动由 startStreamScroll 统一处理
    } else {
        // 不滚动时不需要特殊处理
    }
    // 渲染图表（AI消息中可能包含图表）
    if (role === 'assistant' || role === 'ai') {
        renderPendingCharts(messageDiv);
    }
    return messageDiv;
}

// 添加消息到 UI（不自动 append 到容器，用于分批加载）
// versions: 可选，AI 消息的多版本数组 [{ content, reasoning, timestamp, modelName }]
// currentVersionIndex: 可选，当前显示的版本索引（从0开始）
// annotations: 可选，联网搜索引用来源
function appendMessage_load(role, content, animate = true, showRefresh = false, timestamp = null, modelName = null, versions = null, currentVersionIndex = 0, images = null, files = null, annotations = null, messageId = null) {
    // 隐藏或移除欢迎消息
    const welcomeMsg = chatContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.style.display = 'none';
    }

    const messageDiv = document.createElement('div');
    const cssRole = role === 'assistant' || role === 'ai' ? 'ai' : role;
    messageDiv.className = `message ${cssRole}`;
    // 添加 timestamp 作为 data 属性，用于后续查找
    if (timestamp) {
        messageDiv.dataset.timestamp = timestamp;
    }
    // 添加 messageId 作为 data 属性，用于 ID 定位
    if (messageId) {
        messageDiv.dataset.messageId = messageId;
    }

    // 生成图片缩略图 HTML
    let imagesHtml = '';
    if (images && images.length > 0) {
        imagesHtml = '<div class="message-images">';
        images.forEach((img, index) => {
            imagesHtml += `<div class="message-image-wrapper" onclick="openImageLightbox('${img.base64}', '${img.name || '图片'}')">
                <img src="${img.base64}" alt="${img.name || '图片'}" class="message-image-thumbnail">
            </div>`;
        });
        imagesHtml += '</div>';
    }

    // 生成文件预览 HTML
    let filesHtml = '';
    if (files && files.length > 0) {
        filesHtml = '<div class="message-files">';
        files.forEach((file, index) => {
            // 使用 data 属性存储文件名和内容，避免依赖全局变量
            const escapedName = file.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const escapedContent = (file.content || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '&#10;');

            // 如果有缩略图，显示缩略图；否则显示图标
            const previewHtml = file.thumbnail
                ? `<img src="${file.thumbnail}" alt="${escapedName}" class="message-file-thumbnail">`
                : `<span class="message-file-icon">${getFileIcon(file.name)}</span>`;

            filesHtml += `<div class="message-file-item ${file.thumbnail ? 'has-thumbnail' : ''}" data-filename="${escapedName}" data-content="${escapedContent}">
                ${previewHtml}
                <span class="message-file-name">${file.name}</span>
            </div>`;
        });
        filesHtml += '</div>';
    }

    // 处理多模态消息内容：如果是数组，提取文本用于显示
    let displayContent = content;
    let imageCount = 0;
    if (Array.isArray(content)) {
        const textParts = [];
        content.forEach(item => {
            if (item.type === 'text') {
                textParts.push(item.text);
            } else if (item.type === 'image_url') {
                imageCount++;
            }
        });
        displayContent = textParts.join('');
    }

    // 获取头像（支持图片和 emoji）
    const agent = getCurrentAgent();
    let avatar;
    if (role === 'user') {
        avatar = '⭐';
    } else if (agent.icon.includes('/') || agent.icon.endsWith('.png') || agent.icon.endsWith('.jpg') || agent.icon.endsWith('.svg')) {
        const whiteIconClass = isWhiteIcon(agent.icon) ? ' white-icon' : '';
        avatar = `<img src="${agent.icon}" alt="${agent.name}" class="message-avatar-img${whiteIconClass}">`;
    } else {
        avatar = agent.icon;
    }

    // 如果没有传入时间戳，使用当前时间
    const msgTimestamp = timestamp ? formatTimestamp(new Date(timestamp)) : formatTimestamp();

    // AI 消息显示模型名称和编号
    let modelLabel = '';
    let versionSwitcherHtml = '';

    if (role === 'assistant' || role === 'ai') {
        // 注意：这里不计算 AI 消息编号，因为是分批加载，编号会在最后统一更新
        // 使用传入的 modelName 或当前选择的模型
        const model = modelName || selectedModel;
        modelLabel = `${model}`;

        // 如果有多版本，生成版本切换按钮
        if (versions && versions.length > 1) {
            const totalVersions = versions.length;
            const currentDisplay = currentVersionIndex + 1; // 显示时从1开始
            versionSwitcherHtml = `
                <div class="version-switcher" data-current="${currentVersionIndex}" data-total="${totalVersions}">
                    <button class="version-nav-btn version-prev-btn" title="上一版本">&lt;</button>
                    <span class="version-indicator">${currentDisplay}/${totalVersions}</span>
                    <button class="version-nav-btn version-next-btn" title="下一版本">&gt;</button>
                </div>
            `;
        }
    }

    messageDiv.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content-wrapper">
            ${role === 'assistant' || role === 'ai' ? '<div class="message-timestamp-wrapper"><span class="message-timestamp">' + msgTimestamp + '</span>' + versionSwitcherHtml + '</div>' : ''}
            <div class="message-content" data-content="${escapeHtml(displayContent).replace(/"/g, '&quot;')}">
                ${filesHtml}
                ${imagesHtml}
                ${formatMessage(displayContent)}
                ${annotations && annotations.length > 0 ? generateAnnotationsHtml(annotations) : ''}
            </div>
            ${role === 'assistant' || role === 'ai' ? '<div class="message-bottom-row">' +
            '<div class="message-actions">' +
            '<button class="message-action-btn delete-btn" title="删除">' + ICONS.delete + '</button>' +
            '<button class="message-action-btn edit-btn" title="编辑">' + ICONS.edit + '</button>' +
            '<button class="message-action-btn copy-btn" title="复制">' + ICONS.copy + '</button>' +
            '</div>' +
            '<span class="message-model-name">' + (modelLabel || '') + '</span>' +
            '</div>' : '<div class="message-actions">' +
            '<button class="message-action-btn resend-btn" title="重新发送">' + ICONS.resend + '</button>' +
            '<button class="message-action-btn copy-btn" title="复制">' + ICONS.copy + '</button>' +
            '<button class="message-action-btn edit-btn" title="编辑">' + ICONS.edit + '</button>' +
            '<button class="message-action-btn delete-btn" title="删除">' + ICONS.delete + '</button>' +
        '</div>'}
        </div>
    `;

    // 注意：不自动 append 到容器，由调用者决定插入位置
    // 注意：不自动滚动到底部
    return messageDiv;
}

// ==================== 上下文选择功能 ====================

// 初始化上下文选择功能
function initContextSelection() {
    // 监听消息气泡的双击事件（使用原生 dblclick）
    chatContainer.addEventListener('dblclick', handleContextSelectionDoubleClick);

    // 监听消息气泡点击事件（选择模式下）
    chatContainer.addEventListener('click', handleCheckboxClick);
}

// 处理双击事件
function handleContextSelectionDoubleClick(e) {
    if (isContextSelectionMode) return; // 已在选择模式中

    const messageDiv = e.target.closest('.message');
    if (!messageDiv) return;

    // 忽略图表容器双击（避免误触发选择模式）
    if (e.target.closest('.echarts-container')) return;

    // 双击触发选择模式
    e.preventDefault();
    e.stopPropagation();
    enterContextSelectionMode();
}

// 进入上下文选择模式
function enterContextSelectionMode() {
    isContextSelectionMode = true;
    contextSelectionStartIndex = null;
    contextSelectionEndIndex = null;

    // 添加选择模式样式
    chatContainer.classList.add('context-selection-mode');

    // 给所有用户消息添加虚线提示，告知可点击
    chatContainer.querySelectorAll('.message.user').forEach(msg => {
        msg.classList.add('context-available');
    });

    // 显示确认/取消按钮区域
    showContextSelectionActions();

    // 显示提示
    showToast('请选择用户消息作为起点');
}

// 退出上下文选择模式
function exitContextSelectionMode() {
    isContextSelectionMode = false;
    contextSelectionStartIndex = null;
    contextSelectionEndIndex = null;
    contextSelectionStartDiv = null;
    contextSelectionEndDiv = null;
    selectedContextMessages = [];

    // 移除选择模式样式
    chatContainer.classList.remove('context-selection-mode');

    // 移除消息选中样式
    document.querySelectorAll('.message.context-selected').forEach(msg => {
        msg.classList.remove('context-selected');
    });

    // 移除消息可选提示样式
    document.querySelectorAll('.message.context-available').forEach(msg => {
        msg.classList.remove('context-available');
    });

    // 隐藏确认/取消按钮区域
    hideContextSelectionActions();

    // 隐藏上下文选择标签
    hideContextSelectionTag();
}

// 处理消息气泡点击（选择模式下）
function handleCheckboxClick(e) {
    if (!isContextSelectionMode) return;

    const messageDiv = e.target.closest('.message');
    if (!messageDiv) return;

    // 忽略按钮区域点击
    if (e.target.closest('.message-actions') || e.target.closest('.message-action-btn')) return;

    // 获取消息在 messages 数组中的索引
    const msgId = getMessageIdFromDiv(messageDiv);
    let messageIndex = -1;
    if (msgId) {
        messageIndex = findMessageIndexById(msgId);
    }
    if (messageIndex === -1) {
        // 回退到 DOM 索引（包含 .tool-call-card 以保持与其他函数一致）
        const allMessages = chatContainer.querySelectorAll('.message, .tool-call-card');
        messageIndex = Array.from(allMessages).indexOf(messageDiv);
    }

    if (messageIndex === -1) return;

    const isUserMessage = messageDiv.classList.contains('user');
    const isAiMessage = messageDiv.classList.contains('ai');

    if (isUserMessage) {
        // 点击用户消息：设置起始点
        handleUserMessageSelect(messageIndex, messageDiv);
    } else if (isAiMessage) {
        // 点击AI消息：设置结束点
        handleAiMessageSelect(messageIndex, messageDiv);
    }
}

// 处理用户消息选择
function handleUserMessageSelect(index, messageDiv) {
    // 清除之前的选择
    clearSelectionState();

    // 设置起始索引和DOM元素
    contextSelectionStartIndex = index;
    contextSelectionStartDiv = messageDiv;

    // 标记当前消息为选中
    messageDiv.classList.add('context-selected');

    // 高亮该用户消息之后的所有AI消息（提示可选范围）
    highlightAvailableAiMessages(messageDiv);

    showToast('请选择AI消息作为结束');
}

// 处理AI消息选择
function handleAiMessageSelect(index, messageDiv) {
    if (contextSelectionStartIndex === null) {
        showToast('请选择一个用户消息作为起点');
        return;
    }

    if (index <= contextSelectionStartIndex) {
        showToast('AI消息必须在用户消息之后');
        return;
    }

    // 设置结束索引和DOM元素
    contextSelectionEndIndex = index;
    contextSelectionEndDiv = messageDiv;

    // 标记当前消息为选中
    messageDiv.classList.add('context-selected');

    // 高亮选中的范围
    highlightSelectedRange();

    // 启用确认按钮
    enableConfirmButton();
}

// 清除选择状态
function clearSelectionState() {
    contextSelectionStartIndex = null;
    contextSelectionEndIndex = null;
    contextSelectionStartDiv = null;
    contextSelectionEndDiv = null;

    document.querySelectorAll('.message.context-selected').forEach(msg => {
        msg.classList.remove('context-selected');
    });

    document.querySelectorAll('.message.context-available').forEach(msg => {
        msg.classList.remove('context-available');
    });

    disableConfirmButton();
}

// 高亮可选的AI消息
function highlightAvailableAiMessages(startMessageDiv) {
    const allMessages = Array.from(chatContainer.querySelectorAll('.message, .tool-call-card'));
    const startDomIndex = allMessages.indexOf(startMessageDiv);

    allMessages.forEach((msg, index) => {
        if (index > startDomIndex && msg.classList.contains('ai')) {
            msg.classList.add('context-available');
        }
    });
}

// 高亮选中的范围
function highlightSelectedRange() {
    const allMessages = Array.from(chatContainer.querySelectorAll('.message, .tool-call-card'));
    const startDomIndex = allMessages.indexOf(contextSelectionStartDiv);
    const endDomIndex = allMessages.indexOf(contextSelectionEndDiv);

    allMessages.forEach((msg, index) => {
        if (index >= startDomIndex && index <= endDomIndex) {
            msg.classList.add('context-selected');
            msg.classList.remove('context-available');
        } else {
            msg.classList.remove('context-selected');
        }
    });
}

// 显示上下文选择确认/取消按钮
function showContextSelectionActions() {
    let actionsDiv = document.getElementById('contextSelectionActions');
    if (!actionsDiv) {
        actionsDiv = document.createElement('div');
        actionsDiv.id = 'contextSelectionActions';
        actionsDiv.className = 'context-selection-actions';
        actionsDiv.innerHTML = `
            <div class="context-selection-hint">请选择上下文范围</div>
            <button class="context-selection-btn cancel" onclick="cancelContextSelection()">取消</button>
            <button class="context-selection-btn screenshot" onclick="screenshotContextSelection()" disabled>截图</button>
            <button class="context-selection-btn confirm" onclick="confirmContextSelection()" disabled>确定</button>
        `;
        document.body.appendChild(actionsDiv);
    }
    actionsDiv.classList.add('active');
}

// 隐藏上下文选择确认/取消按钮
function hideContextSelectionActions() {
    const actionsDiv = document.getElementById('contextSelectionActions');
    if (actionsDiv) {
        actionsDiv.classList.remove('active');
    }
}

// 启用确认/截图按钮
function enableConfirmButton() {
    const actionsDiv = document.getElementById('contextSelectionActions');
    if (actionsDiv) {
        const confirmBtn = actionsDiv.querySelector('.context-selection-btn.confirm');
        if (confirmBtn) confirmBtn.disabled = false;
        const screenshotBtn = actionsDiv.querySelector('.context-selection-btn.screenshot');
        if (screenshotBtn) screenshotBtn.disabled = false;
    }
}

// 禁用确认/截图按钮
function disableConfirmButton() {
    const actionsDiv = document.getElementById('contextSelectionActions');
    if (actionsDiv) {
        const confirmBtn = actionsDiv.querySelector('.context-selection-btn.confirm');
        if (confirmBtn) confirmBtn.disabled = true;
        const screenshotBtn = actionsDiv.querySelector('.context-selection-btn.screenshot');
        if (screenshotBtn) screenshotBtn.disabled = true;
    }
}

// 取消上下文选择
function cancelContextSelection() {
    exitContextSelectionMode();
}

// 截图选中的上下文消息
function screenshotContextSelection() {
    if (!contextSelectionStartDiv || !contextSelectionEndDiv) {
        showToast('请先选择完整的上下文范围');
        return;
    }

    showToast('正在加载截图组件...');

    // 懒加载 html2canvas
    const doScreenshot = () => {
        showToast('正在生成截图...');

        // 获取选中的消息范围（包含 .message 和 .tool-call-card）
        const allMessages = Array.from(chatContainer.querySelectorAll('.message, .tool-call-card'));
        const startIdx = allMessages.indexOf(contextSelectionStartDiv);
        const endIdx = allMessages.indexOf(contextSelectionEndDiv);
        const selectedMessages = allMessages.slice(startIdx, endIdx + 1);

        console.log('[截图] 选中元素数:', selectedMessages.length, 'startIdx:', startIdx, 'endIdx:', endIdx);

        if (selectedMessages.length === 0) {
            showToast('未选择有效的消息');
            return;
        }

        // 获取背景色（从 body 读取，因为深色模式变量定义在 body.dark-theme 上）
        const bodyStyle = getComputedStyle(document.body);
        const bgColor = bodyStyle.getPropertyValue('--bg-color').trim() || '#ffffff';

        // 用于在 clone 中判断哪些要保留
        const selectedSet = new Set(selectedMessages);

        // 截图前先退出选择模式，清除所有选择框和操作栏
        // 先移除模式class，再移除消息class，避免模式CSS导致消息消失
        chatContainer.classList.remove('context-selection-mode');
        allMessages.forEach(msg => msg.classList.remove('context-selected', 'context-available'));
        const actionsDiv = document.getElementById('contextSelectionActions');
        if (actionsDiv) actionsDiv.classList.remove('active');

        // 直接对 chatContainer 截图，用 onclone 回调隐藏不需要的内容
        // 这样 CSS 上下文完整保留，不会丢样式
        html2canvas(chatContainer, {
            scale: 2,
            backgroundColor: bgColor,
            useCORS: true,
            logging: false,
            onclone: (clonedDoc, clonedContainer) => {
                // 先找出克隆中对应的选中元素
                const clonedMessages = Array.from(clonedContainer.querySelectorAll('.message, .tool-call-card'));
                const selectedClones = new Set();
                clonedMessages.forEach((msg, i) => {
                    if (selectedSet.has(allMessages[i])) {
                        selectedClones.add(msg);
                    }
                });

                // 遍历所有子元素，移除一切非选中的内容（包括隐藏占位、欢迎语等），彻底消除空白
                Array.from(clonedContainer.children).forEach(child => {
                    if (!selectedClones.has(child)) {
                        child.remove();
                        return;
                    }
                    // 过滤空气泡：AI消息内容为空的直接移除
                    if (child.classList.contains('message')) {
                        const contentEl = child.querySelector('.message-content');
                        if (contentEl && (!contentEl.textContent || !contentEl.textContent.trim())) {
                            child.remove();
                            return;
                        }
                    }
                    {
                        // 选中元素：移除操作按钮、时间戳、头像（仅对 .message 有效，tool-call-card 无这些元素）
                        child.querySelectorAll('.message-actions, .message-bottom-row, .message-timestamp-wrapper, .message-avatar').forEach(el => el.remove());
                        // 移除 diff 卡片，截图时不显示文件修改差异
                        child.querySelectorAll('.diff-card').forEach(el => el.remove());
                        // 工具卡片：只留工具名，移除括号内参数和结果内容
                        if (child.classList.contains('tool-call-card')) {
                            // 结构1（实时）：.tool-call-params + .tool-call-result
                            child.querySelectorAll('.tool-call-params, .tool-call-result').forEach(el => el.remove());
                            // 结构2（历史）：<code> 内第二个 span 是参数，<div> 是结果
                            child.querySelectorAll('code').forEach(code => {
                                const spans = code.querySelectorAll('span');
                                if (spans.length >= 2) spans[1].remove(); // 移除括号参数
                            });
                            child.querySelectorAll('div:not(.diff-card)').forEach(div => {
                                if (!div.classList.contains('diff-card')) div.remove();
                            });
                        }
                        child.classList.remove('context-selected', 'context-available');
                        // 移除淡入动画，避免 html2canvas clone 后重新触发导致截图变淡
                        child.style.animation = 'none';
                        child.style.opacity = '1';
                        // 移除消息底部 margin，避免最后一条消息下方留白
                        child.style.marginBottom = '0';
                    }
                });

                // 清除容器 gap 和 padding，避免元素间和边缘留白
                clonedContainer.style.gap = '0';
                clonedContainer.style.height = 'auto';
                clonedContainer.style.overflow = 'visible';
            }
        }).then(canvas => {
            console.log('[截图] canvas 尺寸:', canvas.width, 'x', canvas.height);

            const dataUrl = canvas.toDataURL('image/png');
            console.log('[截图] dataURL 长度:', dataUrl.length);

            const fileName = `chat_screenshot_${Date.now()}.png`;

            if (window.AndroidBridge && typeof AndroidBridge.saveImageToFile === 'function') {
                AndroidBridge.saveImageToFile(fileName, dataUrl);
                showToast('截图已保存到相册');
            } else {
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = fileName;
                link.click();
                showToast('截图已下载');
            }

            // 截图完成后退出选择模式
            exitContextSelectionMode();
        }).catch(err => {
            console.error('[截图] 失败:', err);
            showToast('截图生成失败');
            exitContextSelectionMode();
        });
    };

    if (typeof html2canvas !== 'undefined') {
        doScreenshot();
    } else {
        const script = document.createElement('script');
        script.src = 'html2canvas.min.js';
        script.onload = doScreenshot;
        script.onerror = () => showToast('截图组件加载失败');
        document.head.appendChild(script);
    }
}

// 确认上下文选择
function confirmContextSelection() {
    if (!contextSelectionStartDiv || !contextSelectionEndDiv) {
        showToast('请选择完整的上下文范围');
        return;
    }

    // 通过 DOM 元素定位选中范围，包含 .message 和 .tool-call-card
    const allMessageDivs = Array.from(chatContainer.querySelectorAll('.message, .tool-call-card'));
    const startDomIdx = allMessageDivs.indexOf(contextSelectionStartDiv);
    const endDomIdx = allMessageDivs.indexOf(contextSelectionEndDiv);

    if (startDomIdx === -1 || endDomIdx === -1) {
        showToast('无法定位选中的消息');
        return;
    }

    selectedContextMessages = [];

    for (let i = startDomIdx; i <= endDomIdx; i++) {
        const div = allMessageDivs[i];
        const msgId = getMessageIdFromDiv(div);
        if (msgId) {
            const msg = findMessageById(msgId);
            if (msg) {
                selectedContextMessages.push(msg);
            }
        } else {
            // 回退：从 DOM 提取 role 和 content 作为兜底
            const role = div.classList.contains('user') ? 'user' : 'assistant';
            const contentEl = div.querySelector('.message-content');
            // dataset.content 经过 escapeHtml 编码，需要解码；textContent 是浏览器自动解码后的纯文本
            const rawContent = contentEl ? (contentEl.dataset.content || '') : '';
            const content = rawContent
                ? rawContent.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
                : (contentEl ? contentEl.textContent : '') || '';
            selectedContextMessages.push({ role, content });
        }
    }

    if (selectedContextMessages.length === 0) {
        showToast('未选择有效的上下文');
        return;
    }

    // 退出选择模式但保留选中状态显示
    chatContainer.classList.remove('context-selection-mode');
    hideContextSelectionActions();

    // 显示上下文选择标签
    showContextSelectionTag();

    showToast(`已选定 ${selectedContextMessages.length} 条消息`);
}

// 显示上下文选择标签
function showContextSelectionTag() {
    let tagDiv = document.getElementById('contextSelectionTag');
    if (!tagDiv) {
        tagDiv = document.createElement('div');
        tagDiv.id = 'contextSelectionTag';
        tagDiv.className = 'context-selection-tag';
        tagDiv.innerHTML = `
            <span class="context-selection-tag-text">请选择上下文作用</span>
            <div class="context-selection-mode-buttons">
                <button class="context-mode-btn ${contextSelectionMode === 'independent' ? 'active' : ''}" data-mode="independent" onclick="setContextSelectionMode('independent')">独立片段</button>
                <button class="context-mode-btn ${contextSelectionMode === 'memory' ? 'active' : ''}" data-mode="memory" onclick="setContextSelectionMode('memory')">记忆内容</button>
            </div>
            <button class="context-selection-tag-close" onclick="clearSelectedContext()" title="取消选择">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        // 插入到输入区域的开头
        const inputArea = document.getElementById('webInputArea');
        if (inputArea) {
            inputArea.insertBefore(tagDiv, inputArea.firstChild);
        }
    } else {
        // 更新按钮状态
        updateContextSelectionModeButtons();
    }
    tagDiv.classList.add('active');
}

// 设置上下文模式
function setContextSelectionMode(mode) {
    contextSelectionMode = mode;
    updateContextSelectionModeButtons();
}

// 更新模式按钮状态
function updateContextSelectionModeButtons() {
    const tagDiv = document.getElementById('contextSelectionTag');
    if (!tagDiv) return;

    const buttons = tagDiv.querySelectorAll('.context-mode-btn');
    buttons.forEach(btn => {
        if (btn.dataset.mode === contextSelectionMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// 隐藏上下文选择标签
function hideContextSelectionTag() {
    const tagDiv = document.getElementById('contextSelectionTag');
    if (tagDiv) {
        tagDiv.classList.remove('active');
    }
}

// 清除选定的上下文
function clearSelectedContext() {
    selectedContextMessages = [];
    contextSelectionStartIndex = null;
    contextSelectionEndIndex = null;
    isContextSelectionMode = false; // 重置选择模式状态
    contextSelectionMode = 'independent'; // 重置为默认模式

    // 移除选择模式样式
    chatContainer.classList.remove('context-selection-mode');

    // 清除消息选中样式
    document.querySelectorAll('.message.context-selected').forEach(msg => {
        msg.classList.remove('context-selected');
    });

    // 清除消息可选提示样式
    document.querySelectorAll('.message.context-available').forEach(msg => {
        msg.classList.remove('context-available');
    });

    hideContextSelectionTag();
}

// 获取用于发送的上下文消息（只返回 role 和 content）
function getContextForSending() {
    if (selectedContextMessages.length > 0) {
        // 只提取 role 和 content 字段，过滤掉 response_id、versions 等其他字段
        return selectedContextMessages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }
    return null;
}

// ==================== 图片 Lightbox 功能 ====================

// 打开图片放大查看
function openImageLightbox(imageSrc, imageName) {
    // 创建或获取 lightbox 容器
    let lightbox = document.getElementById('imageLightbox');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'imageLightbox';
        lightbox.className = 'image-lightbox';
        lightbox.innerHTML = `
            <div class="image-lightbox-overlay" onclick="closeImageLightbox()"></div>
            <div class="image-lightbox-content">
                <img class="image-lightbox-img" src="" alt="">
                <button class="image-lightbox-close" onclick="closeImageLightbox()">×</button>
                <div class="image-lightbox-name"></div>
            </div>
        `;
        document.body.appendChild(lightbox);
    }

    // 设置图片
    const img = lightbox.querySelector('.image-lightbox-img');
    const nameDiv = lightbox.querySelector('.image-lightbox-name');
    img.src = imageSrc;
    img.alt = imageName || '图片';
    nameDiv.textContent = imageName || '';

    // 显示 lightbox
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// 关闭图片放大查看
function closeImageLightbox() {
    const lightbox = document.getElementById('imageLightbox');
    if (lightbox) {
        lightbox.style.transition = 'opacity 0.15s ease, visibility 0.15s ease';
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => {
            lightbox.style.transition = '';
        }, 150);
    }
}

// ESC 键关闭 lightbox
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeImageLightbox();
    }
});

// 在消息开头添加思考内容
function prependThinking(messageDiv, content, collapsed = true) {
    let thinkingDiv = messageDiv.querySelector('.thinking-content');
    if (!thinkingDiv) {
        thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking-content';
        thinkingDiv.innerHTML = `<span class="thinking-label">💭 深度思考</span><span class="thinking-text"></span><button class="thinking-collapse-btn" title="折叠"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 15 12 9 18 15"></polyline></svg></button>`;
        const messageContent = messageDiv.querySelector('.message-content');
        messageContent.insertBefore(thinkingDiv, messageContent.firstChild);
    }
    const thinkingText = thinkingDiv.querySelector('.thinking-text');
    thinkingText.textContent = '💭 ' + content.replace(/^\n+/, '').replace(/\n+$/, '');

    // 根据参数设置折叠状态
    if (collapsed) {
        thinkingDiv.classList.add('collapsed');
        thinkingDiv.style.maxHeight = '28px';
    }

    // scrollToBottom();
}

// 切换思考内容折叠状态
function toggleThinkingCollapse(messageDiv, thinkingDiv, collapse) {
    const isCollapsed = thinkingDiv.classList.contains('collapsed');

    if (collapse && !isCollapsed) {
        // 折叠：先记录当前高度，再动画到 28px
        thinkingDiv.style.maxHeight = thinkingDiv.scrollHeight + 'px';
        void thinkingDiv.offsetHeight; // 强制重排
        thinkingDiv.classList.add('collapsed');
        thinkingDiv.style.maxHeight = '28px';
    } else if (!collapse && isCollapsed) {
        // 展开：从 28px 动画到实际高度，完成后移除限制
        thinkingDiv.classList.remove('collapsed');
        thinkingDiv.style.maxHeight = thinkingDiv.scrollHeight + 'px';
        setTimeout(() => {
            thinkingDiv.style.maxHeight = '';
        }, 300);
    }
}

// 在 actionsDiv 中插入按钮到复制按钮之前
function insertButtonBeforeCopy(actionsDiv, buttonClass, title, iconSvg) {
    const copyBtn = actionsDiv.querySelector('.copy-btn');
    const buttonHtml = `<button class="message-action-btn ${buttonClass}" title="${title}">${iconSvg}</button>`;
    if (copyBtn) {
        copyBtn.insertAdjacentHTML('beforebegin', buttonHtml);
    }
}

// 更新重发按钮显示状态（只在最新的用户消息上显示）
// 更新重发按钮显示状态（所有用户消息都显示重发按钮）
function updateResendButtons() {
    const allMessages = chatContainer.querySelectorAll('.message');

    // 遍历所有消息，更新重发按钮显示状态
    allMessages.forEach((msgDiv) => {
        if (msgDiv.classList.contains('user')) {
            let resendBtn = msgDiv.querySelector('.resend-btn');

            // 显示重发按钮
            if (!resendBtn) {
                const actionsDiv = msgDiv.querySelector('.message-actions');
                if (actionsDiv) {
                    insertButtonBeforeCopy(actionsDiv, 'resend-btn', '重新发送', ICONS.resend);
                }
            } else {
                resendBtn.style.display = 'flex';
            }
        }
    });
}

// 更新版本切换器 UI
function updateVersionSwitcher(messageDiv, messageData) {
    if (!messageDiv || !messageData || !messageData.versions) return;

    const versions = messageData.versions;
    const currentIndex = messageData.currentVersionIndex || 0;
    const totalVersions = versions.length;

    if (totalVersions <= 1) return;

    let versionSwitcher = messageDiv.querySelector('.version-switcher');

    if (!versionSwitcher) {
        // 创建版本切换器
        const timestampWrapper = messageDiv.querySelector('.message-timestamp-wrapper');
        if (timestampWrapper) {
            versionSwitcher = document.createElement('div');
            versionSwitcher.className = 'version-switcher';
            timestampWrapper.appendChild(versionSwitcher);
        }
    }

    if (versionSwitcher) {
        versionSwitcher.style.display = 'flex';
        versionSwitcher.dataset.current = currentIndex;
        versionSwitcher.dataset.total = totalVersions;
        versionSwitcher.innerHTML = `
            <button class="version-nav-btn version-prev-btn" title="上一版本">&lt;</button>
            <span class="version-indicator">${currentIndex + 1}/${totalVersions}</span>
            <button class="version-nav-btn version-next-btn" title="下一版本">&gt;</button>
        `;
    }
}

// 切换消息版本
async function switchMessageVersion(messageDiv, direction) {
    // 内容生成中时不允许切换版本
    if (isSending) {
        showToast('内容正在生成中，请稍候');
        return;
    }
    // 优先通过 ID 查找消息
    const msgId = getMessageIdFromDiv(messageDiv);
    let messageIndex = msgId ? findMessageIndexById(msgId) : -1;

    if (messageIndex < 0) return;

    const messageData = messages[messageIndex];
    if (!messageData || !messageData.versions || messageData.versions.length <= 1) return;

    const versions = messageData.versions;
    let currentIndex = messageData.currentVersionIndex || 0;
    const totalVersions = versions.length;

    // 计算新索引
    if (direction === 'prev') {
        currentIndex = currentIndex > 0 ? currentIndex - 1 : totalVersions - 1;
    } else if (direction === 'next') {
        currentIndex = currentIndex < totalVersions - 1 ? currentIndex + 1 : 0;
    }

    // 更新消息数据
    messageData.currentVersionIndex = currentIndex;
    const version = versions[currentIndex];
    messageData.content = version.content;
    messageData.reasoning = version.reasoning;
    messageData.timestamp = version.timestamp;
    messageData.modelName = version.modelName;
    if (version.responseId) {
        messageData.responseId = version.responseId;
    }
    // 同步 tool_calls：版本对象有则用版本的，否则清空
    if (version.tool_calls) {
        messageData.tool_calls = version.tool_calls;
    } else {
        delete messageData.tool_calls;
    }

    // 保存并刷新整个话题（applyTimelineVisibility 自动处理显隐）
    await saveMessages(messages);
    await switchAgentAndTopic(currentAgentId, currentTopicId);
}

// chainVersionSwitch 已删除，版本切换后统一用 switchAgentAndTopic 刷新


// 获取当前时间线上可见的消息列表（用于构建API请求体）
function getVisibleTimelineMessages() {
    const result = [];
    const visibleIds = new Set();
    visibleIds.add(getTopicRootId());  // 种子：话题根节点

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // 检查 prevId 是否在可见集合中
        if (msg.prevId && visibleIds.has(msg.prevId)) {
            result.push(msg);
            visibleIds.add(getCurrentVersionId(msg));
        }
    }
    return result;
}

// 渲染时根据版本时间线隐藏不属于当前时间线的消息
// msgs: 消息数组，elements: 对应的DOM元素数组，startIdx: 起始索引
function applyTimelineVisibility(msgs, elements, startIdx) {
    // 维护可见版本 ID 集合，逐条传递
    const visibleIds = new Set();
    visibleIds.add(getTopicRootId());  // 种子：话题根节点

    for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        const el = elements[i - startIdx];

        // 被跳过的消息（无 DOM 元素），仍需追踪 id 以保持链路不断
        if (!el) {
            if (msg.prevId && visibleIds.has(msg.prevId)) {
                visibleIds.add(getCurrentVersionId(msg));
            } else if (i < startIdx) {
                // 分页截断点之前的消息：prevId 指向更早未渲染的消息
                // 视为链的起点，加入可见集合，防止后续消息全部连锁隐藏
                visibleIds.add(getCurrentVersionId(msg));
            }
            continue;
        }

        // 检查 prevId 是否在可见集合中
        if (msg.prevId && visibleIds.has(msg.prevId)) {
            // 属于当前时间线 → 显示
            el.style.display = '';
            visibleIds.add(getCurrentVersionId(msg));
        } else {
            // 不属于当前时间线 → 隐藏
            el.style.display = 'none';
        }
    }
}

// 设置 AI 企业选择监听
function setupAIProviderListener() {
    aiProviderSelect.addEventListener('change', () => {
        // 先保存当前服务商的 API Key 和自定义请求体
        const currentInputKey = apiKeyInput.value.trim();
        apiKeys[currentAIProvider] = currentInputKey;
        localStorage.setItem('cnai_api_keys', JSON.stringify(apiKeys));
        const currentCustomBody = customRequestBodyInput.value.trim();
        localStorage.setItem(`cnai_custom_request_body_${currentAIProvider}`, currentCustomBody);

        // 切换到新的 AI 企业
        currentAIProvider = aiProviderSelect.value;
        localStorage.setItem('cnai_ai_provider', currentAIProvider);
        apiKey = apiKeys[currentAIProvider] || '';
        apiKeyInput.value = apiKey;
        updateGetApiKeyBtnState();

        // 加载新服务商的自定义请求体参数
        customRequestBody = localStorage.getItem(`cnai_custom_request_body_${currentAIProvider}`) || '';
        customRequestBodyInput.value = customRequestBody;
        customBodyError.style.display = 'none';

        // 更新自定义选择器显示
        updateAIProviderSelectDisplay();

        updateModelOptions();
        updateSessionCacheVisibility();
        // 更新联网搜索开关显示状态（豆包、千问、MiMo、DeepSeek、GLM支持）
        if (webSearchFormGroup) {
            webSearchFormGroup.style.display = WEB_SEARCH_PROVIDERS.includes(currentAIProvider) ? 'block' : 'none';
            // 自定义服务商有refProvider时，根据refProvider判断
            if (currentAIProvider.startsWith('custom_')) {
                const _cp = customProviders.find(p => p.id === currentAIProvider);
                const _rp = _cp && _cp.refProvider ? _cp.refProvider : null;
                if (_rp) {
                    webSearchFormGroup.style.display = WEB_SEARCH_PROVIDERS.includes(_rp) ? 'block' : 'none';
                }
            }
        }
        updateWebSearchToggleBtn();
        // 更新深度思考按钮状态
        updateDeepThinkingToggleBtn();
        // 更新获取KEY按钮状态
        updateGetApiKeyBtnState();
        // 恢复该服务商的模型选择
        selectedModel = selectedModelsByProvider[currentAIProvider] || modelSelect.options[0]?.value || '';
        modelSelect.value = selectedModel;
        localStorage.setItem('cnai_model', selectedModel);
        updateModelSelectDisplay();
        updateCurrentModelName();
        // 恢复该服务商的深度思考设置
        deepThinkingEnabled = deepThinkingByProvider[currentAIProvider] || false;
        deepThinkingSwitch.checked = deepThinkingEnabled;
    });
}

// 更新 Session 缓存开关显示状态
function updateSessionCacheVisibility() {
    if (currentAIProvider === 'doubao') {
        sessionCacheGroup.style.display = 'block';
        sessionCacheGroup.querySelector('small').textContent = '自动缓存对话上下文，降低 Token 消耗，适合多轮对话';
        // 显示有效期设置
        if (sessionExpireRow) {
            sessionExpireRow.style.display = 'block';
            if (sessionCacheSwitch.checked) {
                sessionExpireRow.classList.add('expanded');
            } else {
                sessionExpireRow.classList.remove('expanded');
            }
        }
        // 同步开关状态
        sessionCacheSwitch.checked = sessionCacheEnabled;
    } else if (currentAIProvider === 'qwen') {
        sessionCacheGroup.style.display = 'block';
        sessionCacheGroup.querySelector('small').textContent = '自动缓存对话上下文，降低 Token 消耗，适合多轮对话';
        // 隐藏有效期设置（千问不支持）
        if (sessionExpireRow) {
            sessionExpireRow.style.display = 'none';
            sessionExpireRow.classList.remove('expanded');
        }
        // 同步开关状态
        sessionCacheSwitch.checked = qwenSessionEnabled;
    } else {
        sessionCacheGroup.style.display = 'none';
    }
}

// Session 缓存开关切换事件
sessionCacheSwitch.addEventListener('change', () => {
    if (currentAIProvider === 'doubao') {
        // 豆包：显示/隐藏有效期设置
        if (sessionExpireRow) {
            if (sessionCacheSwitch.checked) {
                sessionExpireRow.classList.add('expanded');
            } else {
                sessionExpireRow.classList.remove('expanded');
            }
        }
    } else if (currentAIProvider === 'qwen') {
        // 千问：切换时设置 forceFirstSend 标志
        if (!qwenSessionEnabled && sessionCacheSwitch.checked) {
            // 从关变为开，设置 forceFirstSend 以重新初始化 session
            qwenForceFirstSend = 1;
            console.log('千问 Session 模式重新开启，下次发送将为首次发送');
        }
        qwenSessionEnabled = sessionCacheSwitch.checked;
    }
});

// 设置获取模型按钮
function setupFetchModelsButton() {
    fetchModelsBtn.addEventListener('click', async () => {
        await fetchModels();
    });

    // 测试连接按钮
    testConnectionBtn.addEventListener('click', () => {
        testApiConnection();
    });
}

// 打开管理模型弹窗
// 管理模型底部面板实例
let manageModelsSheet = null;

function openManageModels() {
    manageModelsSheet = createBottomSheetPanel({
        title: '管理模型',
        content: `
            <div class="bs-search-box">
                <div class="model-input-wrapper">
                    <input type="text" id="bsNewModelInput" placeholder="搜索已有模型，或输入新模型ID" maxlength="50">
                    <button type="button" class="model-input-add-btn" id="bsAddModelBtn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="bs-grid bs-grid-cols-2" id="bsModelsGrid" style="padding: 4px 12px 12px;"></div>
        `,
        onClose: () => { manageModelsSheet = null; },
    });
    manageModelsSheet.show();

    // 绑定事件
    const bsInput = document.getElementById('bsNewModelInput');
    const bsAddBtn = document.getElementById('bsAddModelBtn');
    const bsGrid = document.getElementById('bsModelsGrid');

    function renderBsModelsList(searchKeyword = '') {
        bsGrid.innerHTML = '';
        let models = [];
        if (currentAIProvider.startsWith('custom_')) {
            const customProvider = customProviders.find(p => p.id === currentAIProvider);
            models = customProvider ? customProvider.models || [] : [];
        } else {
            models = cachedModels[currentAIProvider] || [];
        }
        const filteredModels = searchKeyword
            ? models.filter(model =>
                model.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
                model.id.toLowerCase().includes(searchKeyword.toLowerCase())
            )
            : models;
        if (filteredModels.length === 0) {
            bsGrid.innerHTML = searchKeyword
                ? '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">未找到匹配的模型</div>'
                : '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无自定义模型</div>';
            return;
        }
        filteredModels.forEach(model => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'bs-item bs-item-grid';
            item.style.position = 'relative';
            if (model.id === selectedModel) item.classList.add('active');
            const isVision = VISION_MODEL_IDS.includes(model.id);
            const visionTag = isVision ? '<small style="font-size:10px;color:var(--text-secondary);margin-top:2px;">视觉</small>' : '';
            item.innerHTML = `
                <span class="bs-item-label">${model.name}</span>
                ${visionTag}
                <button class="model-item-delete" title="删除记录" style="position:absolute;top:2px;right:2px;width:22px;height:22px;border:none;background:rgba(0,0,0,0.1);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);opacity:0.6;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            `;
            item.addEventListener('click', (e) => {
                if (e.target.closest('.model-item-delete')) return;
                selectModel(model.id);
                renderBsModelsList(bsInput.value.trim());
            });
            item.querySelector('.model-item-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteModelBs(model.id, bsInput.value.trim(), bsGrid, renderBsModelsList);
            });
            bsGrid.appendChild(item);
        });
    }

    function addModelBs() {
        const modelId = bsInput.value.trim();
        if (!modelId) { alert('请输入模型名称'); return; }
        let existingModels = [];
        if (currentAIProvider.startsWith('custom_')) {
            const customProvider = customProviders.find(p => p.id === currentAIProvider);
            existingModels = customProvider ? customProvider.models || [] : [];
        } else {
            existingModels = cachedModels[currentAIProvider] || [];
        }
        if (existingModels.find(m => m.id === modelId)) { alert('该模型已存在'); return; }
        if (currentAIProvider.startsWith('custom_')) {
            const customProvider = customProviders.find(p => p.id === currentAIProvider);
            if (customProvider) {
                if (!customProvider.models) customProvider.models = [];
                customProvider.models.push({ id: modelId, name: modelId });
                localStorage.setItem('cnai_custom_providers', JSON.stringify(customProviders));
            }
        } else {
            if (!cachedModels[currentAIProvider]) cachedModels[currentAIProvider] = [];
            cachedModels[currentAIProvider].push({ id: modelId, name: modelId });
            localStorage.setItem('cnai_cached_models', JSON.stringify(cachedModels));
        }
        bsInput.value = '';
        renderBsModelsList();
        updateModelOptions();
        modelSelect.value = modelId;
        selectedModel = modelId;
    }

    function deleteModelBs(modelId, searchKeyword, listEl, renderFn) {
        if (!confirm(`确定要删除模型 "${modelId}" 吗？`)) return;
        if (currentAIProvider.startsWith('custom_')) {
            const customProvider = customProviders.find(p => p.id === currentAIProvider);
            if (customProvider) {
                customProvider.models = (customProvider.models || []).filter(m => m.id !== modelId);
                localStorage.setItem('cnai_custom_providers', JSON.stringify(customProviders));
            }
        } else {
            cachedModels[currentAIProvider] = (cachedModels[currentAIProvider] || []).filter(m => m.id !== modelId);
            localStorage.setItem('cnai_cached_models', JSON.stringify(cachedModels));
        }
        renderFn(searchKeyword);
        updateModelOptions();
    }

    bsAddBtn.addEventListener('click', addModelBs);
    bsInput.addEventListener('input', (e) => renderBsModelsList(e.target.value.trim()));
    bsInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const value = bsInput.value.trim();
            let models = [];
            if (currentAIProvider.startsWith('custom_')) {
                const cp = customProviders.find(p => p.id === currentAIProvider);
                models = cp ? cp.models || [] : [];
            } else {
                models = cachedModels[currentAIProvider] || [];
            }
            const exactMatch = models.find(m => m.id === value || m.name === value);
            if (value && !exactMatch) addModelBs();
        }
    });

    renderBsModelsList();
}

// 关闭管理模型弹窗
function closeManageModelsModal() {
    if (manageModelsSheet) {
        manageModelsSheet.hide();
        manageModelsSheet = null;
    }
}

// 渲染模型列表
function renderModelsList(searchKeyword = '') {
    let models = [];
    if (currentAIProvider.startsWith('custom_')) {
        const customProvider = customProviders.find(p => p.id === currentAIProvider);
        models = customProvider ? customProvider.models || [] : [];
    } else {
        models = cachedModels[currentAIProvider] || [];
    }
    modelsList.innerHTML = '';

    // 过滤模型
    const filteredModels = searchKeyword
        ? models.filter(model =>
            model.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
            model.id.toLowerCase().includes(searchKeyword.toLowerCase())
        )
        : models;

    if (filteredModels.length === 0) {
        modelsList.innerHTML = searchKeyword
            ? '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">未找到匹配的模型</div>'
            : '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无自定义模型</div>';
        return;
    }

    filteredModels.forEach(model => {
        const item = document.createElement('div');
        item.className = 'model-item';
        if (model.id === selectedModel) {
            item.classList.add('active');
        }

        // 判断是否为视觉模型
        const isVision = VISION_MODEL_IDS.includes(model.id);
        const visionTag = isVision ? '<span class="model-item-vision-tag">视觉</span>' : '';

        item.innerHTML = `
            <span class="model-item-name">${model.name}${visionTag}</span>
            <button class="model-item-delete" title="删除">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        // 点击模型项选择该模型
        item.addEventListener('click', (e) => {
            // 如果点击的是删除按钮，不触发选择
            if (e.target.closest('.model-item-delete')) return;
            selectModel(model.id);
        });

        const deleteBtn = item.querySelector('.model-item-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteModel(model.id, searchKeyword);
        });

        modelsList.appendChild(item);
    });
}

// 添加模型
function addModel() {
    const modelId = newModelInput.value.trim();
    if (!modelId) {
        alert('请输入模型名称');
        return;
    }

    // 检查是否已存在
    let existingModels = [];
    if (currentAIProvider.startsWith('custom_')) {
        const customProvider = customProviders.find(p => p.id === currentAIProvider);
        existingModels = customProvider ? customProvider.models || [] : [];
    } else {
        existingModels = cachedModels[currentAIProvider] || [];
    }

    if (existingModels.find(m => m.id === modelId)) {
        alert('该模型已存在');
        return;
    }

    // 添加到对应数据源
    if (currentAIProvider.startsWith('custom_')) {
        const customProvider = customProviders.find(p => p.id === currentAIProvider);
        if (customProvider) {
            if (!customProvider.models) {
                customProvider.models = [];
            }
            customProvider.models.push({
                id: modelId,
                name: modelId
            });
            localStorage.setItem('cnai_custom_providers', JSON.stringify(customProviders));
        }
    } else {
        if (!cachedModels[currentAIProvider]) {
            cachedModels[currentAIProvider] = [];
        }
        cachedModels[currentAIProvider].push({
            id: modelId,
            name: modelId
        });
        localStorage.setItem('cnai_cached_models', JSON.stringify(cachedModels));
    }

    // 清空输入框并刷新列表
    newModelInput.value = '';
    renderModelsList();
    updateModelOptions();

    // 选中新添加的模型
    modelSelect.value = modelId;
    selectedModel = modelId;
}

// 删除模型
function deleteModel(modelId, searchKeyword = '') {
    if (!confirm(`确定要删除模型 "${modelId}" 吗？`)) {
        return;
    }

    // 从对应数据源中删除
    if (currentAIProvider.startsWith('custom_')) {
        const customProvider = customProviders.find(p => p.id === currentAIProvider);
        if (customProvider) {
            customProvider.models = (customProvider.models || []).filter(m => m.id !== modelId);
            localStorage.setItem('cnai_custom_providers', JSON.stringify(customProviders));
        }
    } else {
        cachedModels[currentAIProvider] = (cachedModels[currentAIProvider] || []).filter(m => m.id !== modelId);
        localStorage.setItem('cnai_cached_models', JSON.stringify(cachedModels));
    }

    // 更新列表和选项
    renderModelsList(searchKeyword);
    updateModelOptions();
}

// 选择模型
function selectModel(modelId) {
    selectedModel = modelId;
    modelSelect.value = modelId;

    // 保存到当前 AI 企业的模型选择
    selectedModelsByProvider[currentAIProvider] = modelId;
    localStorage.setItem('cnai_selected_models_by_provider', JSON.stringify(selectedModelsByProvider));
    localStorage.setItem('cnai_model', selectedModel);

    // 更新设置界面的模型选择器显示
    updateModelSelectDisplay();

    // 更新主界面 infobar 模型名称
    updateCurrentModelName();

    // 关闭弹窗
    closeManageModelsModal();
}

// 底部弹出面板遮罩（单例）
let bottomSheetOverlay = null;
function getBottomSheetOverlay() {
    if (!bottomSheetOverlay) {
        bottomSheetOverlay = document.createElement('div');
        bottomSheetOverlay.className = 'bottom-sheet-overlay';
        bottomSheetOverlay.addEventListener('click', () => {
            updateBottomSheetOverlay();
        });
        document.body.appendChild(bottomSheetOverlay);
    }
    return bottomSheetOverlay;
}
function updateBottomSheetOverlay() {
    const overlay = getBottomSheetOverlay();
    const anyActive = chatMenuSheet != null;
    if (anyActive) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}


// 创建底部弹出面板可拖曳把柄
function initBottomSheetHandle(popup, closeFn) {
    // 移除旧把柄（如有）
    const oldHandle = popup.querySelector('.bottom-sheet-handle-wrapper');
    if (oldHandle) oldHandle.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'bottom-sheet-handle-wrapper';
    const handle = document.createElement('div');
    handle.className = 'bottom-sheet-handle';
    wrapper.appendChild(handle);
    popup.insertBefore(wrapper, popup.firstChild);

    let startY = 0;
    let currentTranslate = 0;
    let dragging = false;

    function onStart(e) {
        // 把柄区域直接拖曳；内容区域在滚到顶部时也可拖曳
        if (wrapper.contains(e.target)) {
            dragging = true;
        } else if (popup.contains(e.target)) {
            // 内容区域：只有滚到顶部且向下拖时才触发
            if (popup.scrollTop <= 0) {
                dragging = true;
            } else {
                return;
            }
        } else {
            return;
        }
        const touch = e.touches ? e.touches[0] : e;
        startY = touch.clientY;
        // 读取当前transform中的translateY值
        const style = popup.style.transform || '';
        const match = style.match(/translateY\(([^)]+)\)/);
        currentTranslate = match ? parseFloat(match[1]) : 0;
        popup.style.transition = 'none';
        if (wrapper.contains(e.target)) e.preventDefault();
    }

    function onMove(e) {
        if (!dragging) return;
        const touch = e.touches ? e.touches[0] : e;
        const deltaY = touch.clientY - startY;
        // 只允许向下拖曳
        const newTranslate = Math.max(0, currentTranslate + deltaY);
        popup.style.transform = `translateY(${newTranslate}px)`;
        // 同步更新遮罩透明度
        const overlay = getBottomSheetOverlay();
        const maxDrag = popup.offsetHeight * 0.6;
        const progress = Math.min(1, newTranslate / maxDrag);
        overlay.style.opacity = Math.max(0, 1 - progress);
    }

    function onEnd(e) {
        if (!dragging) return;
        dragging = false;
        popup.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        const overlay = getBottomSheetOverlay();
        overlay.style.transition = 'opacity 0.3s ease';
        const touch = e.changedTouches ? e.changedTouches[0] : e;
        const deltaY = touch.clientY - startY;
        const threshold = Math.max(100, popup.offsetHeight * 0.25);
        if (deltaY > threshold) {
            // 超过阈值：动画滑出消失
            popup.style.transform = 'translateY(105%)';
            overlay.style.opacity = '0';
            // 动画结束后关闭
            setTimeout(() => {
                closeFn();
                popup.style.transform = '';
                popup.style.transition = '';
                overlay.style.opacity = '';
                overlay.style.transition = '';
                updateBottomSheetOverlay();
            }, 300);
        } else {
            // 弹回原位：强制重排确保transition生效
            popup.offsetHeight;
            popup.style.transform = 'translateY(0)';
            overlay.style.opacity = '';
            updateBottomSheetOverlay();
            // 动画结束后清理
            setTimeout(() => {
                popup.style.transition = '';
                popup.style.transform = '';
                overlay.style.transition = '';
            }, 300);
        }
    }

    wrapper.addEventListener('touchstart', onStart, { passive: false });
    wrapper.addEventListener('mousedown', onStart);
    popup.addEventListener('touchstart', onStart, { passive: false });
    popup.addEventListener('mousedown', onStart);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mouseup', onEnd);
}

// 设置自定义选择器
function setupCustomSelects() {
    // AI 服务商选择器 - 使用通用底部弹出选择器
    aiProviderSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        const items = [...AI_PROVIDERS.map(p => ({
            value: p.value,
            label: p.label,
            icon: `<img src="${p.icon}" alt="${p.label}" class="provider-icon" style="width:20px;height:20px;">`,
        }))];
        // 自定义服务商（网格模式忽略 divider，单独放底部）
        const currentProvider = aiProviderSelect.value;
        let customItemsHtml = '';
        if (customProviders.length > 0) {
            customProviders.forEach(p => {
                const isActive = p.id === currentProvider;
                customItemsHtml += `<button type="button" class="bs-item bs-item-grid custom-provider-grid-item${isActive ? ' active' : ''}" data-value="${p.id}" style="position:relative;">
                    <span class="bs-item-label">${p.name}</span>
                    <small style="font-size:10px;color:var(--text-secondary);">自定义</small>
                </button>`;
            });
        }

        const providerSheet = createBottomSheetPicker({
            items,
            activeValue: aiProviderSelect.value,
            gridColumns: 2,
            customContent: (customItemsHtml || items.length > 0) ? `
                ${customItemsHtml ? `<div class="bs-grid bs-grid-cols-2" style="padding: 0 12px 8px;">${customItemsHtml}</div>` : ''}
                <div style="padding: 0 16px 12px;">
                    <button type="button" class="bs-item" id="bsManageCustomProviderBtn" style="justify-content:center;color:var(--primary-color);font-weight:500;border:1px solid var(--text-secondary);border-radius:10px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        自定义服务商...
                    </button>
                </div>
            ` : '',
            onSelect: (item) => {
                if (item.value === '__manage_custom__') {
                    providerSheet.hide();
                    setTimeout(() => openCustomProviderModal(), 350);
                    return;
                }
                if (item.icon) {
                    aiProviderSelectText.innerHTML = item.icon + item.label;
                } else {
                    aiProviderSelectText.textContent = item.label;
                }
                aiProviderSelect.value = item.value;
                aiProviderSelect.dispatchEvent(new Event('change'));
            },
        });
        providerSheet.show();

        // 绑定自定义服务商网格项点击事件
        setTimeout(() => {
            document.querySelectorAll('.custom-provider-grid-item').forEach(el => {
                el.addEventListener('click', () => {
                    providerSheet.hide();
                    const val = el.dataset.value;
                    aiProviderSelectText.textContent = el.querySelector('.bs-item-label').textContent;
                    aiProviderSelect.value = val;
                    aiProviderSelect.dispatchEvent(new Event('change'));
                });
            });
            const manageBtn = document.getElementById('bsManageCustomProviderBtn');
            if (manageBtn) {
                manageBtn.addEventListener('click', () => {
                    providerSheet.hide();
                    setTimeout(() => openCustomProviderModal(), 350);
                });
            }
        }, 0);
    });

    // 模型选择器 - 使用通用底部弹出选择器
    modelSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openManageModels();
    });

    document.addEventListener('click', () => {
        updateBottomSheetOverlay();
    });

    // 初始化自定义服务商选项
    updateCustomProviderOptions();
}

// 更新 AI 服务商选择器显示
function updateAIProviderSelectDisplay() {
    const value = aiProviderSelect.value;
    const isCustomProvider = value.startsWith('custom_');
    // MiniMax 不支持获取模型列表 API
    const isMinimax = value === 'minimax';

    // 自定义服务商或 MiniMax 时禁用获取模型按钮（有 refProvider 的自定义服务商除外）
    const customProvider = isCustomProvider ? customProviders.find(p => p.id === value) : null;
    const hasRefProvider = customProvider && customProvider.refProvider;
    fetchModelsBtn.disabled = (isCustomProvider && !hasRefProvider) || isMinimax;
    // 获取KEY按钮永远不禁用（与AI服务商无关）

    // 自定义服务商（无refProvider）或 MiniMax（非M3模型）时禁用深度思考复选框
    const isMinimaxM3 = isMinimax && typeof selectedModel !== 'undefined' && selectedModel === 'MiniMax-M3';
    const disableDeepThinking = (isCustomProvider && !hasRefProvider) || (isMinimax && !isMinimaxM3);
    deepThinkingSwitch.disabled = disableDeepThinking;
    const deepThinkingLabel = deepThinkingSwitch.closest('.form-group');
    if (deepThinkingLabel) {
        if (disableDeepThinking) {
            deepThinkingLabel.style.opacity = '0.5';
            deepThinkingLabel.style.pointerEvents = 'none';
        } else {
            deepThinkingLabel.style.opacity = '';
            deepThinkingLabel.style.pointerEvents = '';
        }
    }

    // 检查是否为自定义服务商
    if (isCustomProvider) {
        const provider = customProviders.find(p => p.id === value);
        if (provider) {
            aiProviderSelectText.textContent = provider.name;
            return;
        }
    }

    const provider = AI_PROVIDERS.find(p => p.value === value);
    if (provider) {
        aiProviderSelectText.innerHTML = `<img src="${provider.icon}" alt="${provider.label}" class="provider-icon">${provider.label}`;
    }
}

// 更新模型选择器显示
function updateModelSelectDisplay() {
    const value = modelSelect.value;
    const option = modelSelect.querySelector(`option[value="${value}"]`);
    modelSelectText.textContent = option ? option.textContent : value;
}

// 处理模型选择（已由 createBottomSheetPicker onSelect 处理，保留函数兼容）
function handleModelSelect(e, modelId) {
    const option = modelSelect.querySelector(`option[value="${modelId}"]`);
    modelSelect.value = modelId;
    modelSelectText.textContent = option ? option.textContent : modelId;
    selectedModel = modelId;
    selectedModelsByProvider[currentAIProvider] = modelId;
    localStorage.setItem('cnai_selected_models_by_provider', JSON.stringify(selectedModelsByProvider));
    localStorage.setItem('cnai_model', selectedModel);
    updateCurrentModelName();
}

// 更新模型选项
function updateModelOptions() {
    let models = [];
    if (currentAIProvider.startsWith('custom_')) {
        const customProvider = customProviders.find(p => p.id === currentAIProvider);
        models = customProvider ? customProvider.models || [] : [];
    } else {
        models = cachedModels[currentAIProvider] || [];
    }
    modelSelect.innerHTML = '';

    if (models.length === 0 && !currentAIProvider.startsWith('custom_')) {
        // 如果没有模型，使用默认选项（仅官方服务商）
        const defaultModels = currentAIProvider === 'qwen'
            ? ['qwen3.5-plus', 'qwen-turbo', 'qwen-max']
            : [];

        defaultModels.forEach(modelId => {
            const option = document.createElement('option');
            option.value = modelId;
            option.textContent = modelId;
            modelSelect.appendChild(option);
        });

        // 恢复之前选择的模型（如果有）
        const lastSelected = selectedModelsByProvider[currentAIProvider];
        if (lastSelected) {
            modelSelect.value = lastSelected;
        }
    } else {
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            modelSelect.appendChild(option);
        });

        // 恢复之前选择的模型（如果该模型在当前列表中）
        const lastSelected = selectedModelsByProvider[currentAIProvider];
        if (lastSelected && models.find(m => m.id === lastSelected)) {
            modelSelect.value = lastSelected;
        }
    }

    // 更新当前选择的模型变量
    selectedModel = modelSelect.value;

    // 更新选择器显示
    updateModelSelectDisplay();

    // 恢复对应 AI 企业的深度思考设置
    deepThinkingEnabled = deepThinkingByProvider[currentAIProvider] !== false;
    deepThinkingSwitch.checked = deepThinkingEnabled;
    updateDeepThinkingToggleBtn();

    // 更新联网搜索开关显示状态（豆包、千问、MiMo、DeepSeek支持）
    if (webSearchFormGroup) {
        webSearchFormGroup.style.display = WEB_SEARCH_PROVIDERS.includes(currentAIProvider) ? 'block' : 'none';
    }
    if (webSearchSwitch) {
        webSearchSwitch.checked = webSearchEnabled;
        updateWebSearchToggleBtn();
    }
}

// 获取模型列表
async function fetchModels() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        alert('请先输入 API Key');
        return;
    }

    const provider = aiProviderSelect.value;
    // 自定义服务商使用 refProvider 来确定 API 端点
    let effectiveProvider = provider;
    if (provider.startsWith('custom_')) {
        const cp = customProviders.find(p => p.id === provider);
        if (cp && cp.refProvider) {
            effectiveProvider = cp.refProvider;
        }
    }

    // 设置加载状态
    fetchModelsBtn.classList.add('loading');
    fetchModelsBtn.disabled = true;
    fetchModelsBtn.textContent = '获取中...';

    try {
        let models = [];
        let apiUrl = '';

        // 根据服务商选择 API 端点
        if (effectiveProvider === 'deepseek') {
            apiUrl = 'https://api.deepseek.com/models';
        } else if (effectiveProvider === 'mimo') {
            apiUrl = 'https://api.xiaomimimo.com/v1/models';
        } else if (effectiveProvider === 'kimi') {
            apiUrl = 'https://api.moonshot.cn/v1/models';
        } else if (effectiveProvider === 'minimax') {
            apiUrl = 'https://api.minimaxi.com/v1/models';
        } else if (effectiveProvider === 'doubao') {
            apiUrl = 'https://ark.cn-beijing.volces.com/api/v3/models';
        } else if (effectiveProvider === 'glm') {
            apiUrl = 'https://open.bigmodel.cn/api/paas/v4/models';
        } else {
            // 千问
            apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/models';
        }

        console.log('====== 获取模型列表 ======');
        console.log('服务商:', provider);
        console.log('API URL:', apiUrl);
        console.log('API Key (前8位):', apiKey.substring(0, 8) + '...');

        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('响应状态:', response.status, response.statusText);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.log('错误数据:', errorData);
            throw new Error(`HTTP ${response.status}: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        console.log('响应数据:', data);

        // 输出每个模型的详细信息，用于判断是否有视觉能力标识
        if (data.data && Array.isArray(data.data)) {
            console.log('====== 模型详细信息 ======');
            data.data.forEach((model, index) => {
                console.log(`[${index}] ${model.id}:`, JSON.stringify(model, null, 2));
            });
        } else if (Array.isArray(data)) {
            console.log('====== 模型详细信息 ======');
            data.forEach((model, index) => {
                console.log(`[${index}] ${model.id}:`, JSON.stringify(model, null, 2));
            });
        }

        // 检查响应数据结构
        if (data.data && Array.isArray(data.data)) {
            models = data.data.map(model => ({
                id: model.id,
                name: model.id || model.name
            }));
        } else if (Array.isArray(data)) {
            // 如果返回的直接是数组
            models = data.map(model => ({
                id: model.id,
                name: model.id || model.name
            }));
        }

        console.log('解析后的模型列表:', models);

        // 验证是否获取到模型
        if (models.length === 0) {
            throw new Error('未找到可用模型，请检查 API Key 或网络连接');
        }

        // 缓存模型列表到内存
        cachedModels[provider] = models;

        // 永久保存到 localStorage
        localStorage.setItem('cnai_cached_models', JSON.stringify(cachedModels));

        // 更新下拉列表
        updateModelOptions();

        // 显示成功提示
        showToast(`获取成功，共 ${models.length} 个模型`);

    } catch (error) {
        console.error('获取模型失败:', error);

        // 显示详细的错误信息
        let errorMsg = error.message || '未知错误';
        if (errorMsg.includes('Failed to fetch')) {
            errorMsg = '网络请求失败，请检查网络连接';
        } else if (errorMsg.includes('401')) {
            errorMsg = 'API Key 无效，请检查后重试';
        } else if (errorMsg.includes('403')) {
            errorMsg = '权限不足，请检查 API Key 是否有访问权限';
        }

        alert(`${errorMsg}`);
    } finally {
        // 恢复按钮状态
        fetchModelsBtn.classList.remove('loading');
        fetchModelsBtn.disabled = false;
        fetchModelsBtn.textContent = '获取模型';
    }
}

// ============ 公共工具函数（重构提取） ============

// 处理响应元数据（response_id 和 usage 信息）- 流式和非流式共用
function processResponseMetadata(data, isChunk = false) {
    // 流式：chunk.response?.id 或 chunk.id；非流式：data.id
    const responseId = isChunk ? (data.response?.id || data.id) : data.id;
    const usageData = isChunk ? (data.response?.usage || data.usage) : (data.response?.usage || data.usage);

    // 捕获 response_id（豆包 Session 缓存 或 千问 Responses API）
    // 注意：独立片段模式下不捕获 responseId，因为不使用服务端 session 缓存
    const currentSelectedContext = getContextForSending();
    const isIndependentMode = currentSelectedContext && currentSelectedContext.length > 0 && contextSelectionMode === 'independent';

    // 豆包：Session 开启且非独立片段模式
    // 千问：Session 开启且非独立片段模式
    const shouldCaptureResponseId = !isIndependentMode && (
        (currentAIProvider === 'doubao' && sessionCacheEnabled) ||
        (currentAIProvider === 'qwen' && qwenSessionEnabled)
    );

    if (responseId && shouldCaptureResponseId) {
        return { responseId, usageData };
    }
    return { responseId: null, usageData };
}

// 输出 usage 信息（所有 AI 服务商）
function logCacheHitInfo(usageData) {
    if (!usageData) return null;

    let inputTokens = 0;
    let cachedTokens = 0;
    let outputTokens = 0;
    let cacheHitRate = '0%';

    // 根据不同服务商解析 usage 数据
    switch (currentAIProvider) {
        case 'deepseek':
            // DeepSeek 格式
            inputTokens = usageData.prompt_tokens || 0;
            cachedTokens = usageData.prompt_cache_hit_tokens || usageData.prompt_tokens_details?.cached_tokens || 0;
            outputTokens = usageData.completion_tokens || 0;
            break;

        case 'qwen':
            // Qwen 格式 - Responses API 使用 input_tokens/output_tokens
            inputTokens = usageData.input_tokens || usageData.prompt_tokens || 0;
            cachedTokens = usageData.input_tokens_details?.cached_tokens || usageData.prompt_tokens_details?.cached_tokens || 0;
            outputTokens = usageData.output_tokens || usageData.completion_tokens || 0;
            break;

        case 'doubao':
            // 豆包格式 - 统一使用 Responses API 格式
            inputTokens = usageData.input_tokens || 0;
            cachedTokens = usageData.input_tokens_details?.cached_tokens || 0;
            outputTokens = usageData.output_tokens || 0;
            break;

        case 'glm':
            // GLM 格式
            inputTokens = usageData.prompt_tokens || 0;
            cachedTokens = usageData.prompt_tokens_details?.cached_tokens || 0;
            outputTokens = usageData.completion_tokens || 0;
            break;

        case 'minimax':
            // MiniMax 格式
            // 支持两种格式：cache_read_input_tokens 或 prompt_tokens_details.cached_tokens
            inputTokens = usageData.prompt_tokens || 0;
            cachedTokens = usageData.cache_read_input_tokens || usageData.prompt_tokens_details?.cached_tokens || 0;
            outputTokens = usageData.completion_tokens || 0;
            break;

        case 'kimi':
            // Kimi 格式 - 标准 OpenAI 兼容格式
            // Kimi 支持 cached_tokens 字段
            inputTokens = usageData.prompt_tokens || 0;
            cachedTokens = usageData.cached_tokens || 0;
            outputTokens = usageData.completion_tokens || 0;
            break;

        case 'mimo':
            // MiMo 格式 - 标准 OpenAI 兼容格式
            inputTokens = usageData.prompt_tokens || 0;
            cachedTokens = usageData.prompt_tokens_details?.cached_tokens || 0;
            outputTokens = usageData.completion_tokens || 0;
            break;

        default:
            console.log('未知 AI 服务商:', currentAIProvider);
            return null;
    }

    // 计算缓存命中率
    if (inputTokens > 0 && cachedTokens > 0) {
        cacheHitRate = ((cachedTokens / inputTokens) * 100).toFixed(1) + '%';
    }

    // 更新 HTML 元素
    const usageInputTokensEl = document.getElementById('usageInputTokens');
    const usageCacheRateEl = document.getElementById('usageCacheRate');
    const usageOutputTokensEl = document.getElementById('usageOutputTokens');

    if (usageInputTokensEl) usageInputTokensEl.textContent = inputTokens;
    if (usageCacheRateEl) usageCacheRateEl.textContent = cacheHitRate;
    if (usageOutputTokensEl) usageOutputTokensEl.textContent = outputTokens;

    // 输出到控制台
    console.log('====== AI 回复 Usage 信息 ======');
    console.log('AI 服务商:', currentAIProvider);
    console.log('1. 输入 tokens:', inputTokens);
    console.log('2. 缓存命中率:', cacheHitRate, cachedTokens > 0 ? `(${cachedTokens}/${inputTokens})` : '');
    console.log('3. 输出 tokens:', outputTokens);
    console.log('完整 usage:', JSON.stringify(usageData, null, 2));
    console.log('================================');

    return { inputTokens, cachedTokens, outputTokens, cacheHitRate };
}

// 创建助手消息对象 - 统一消息创建逻辑
function createAssistantMessage(content, reasoning, responseId, annotations, prevId) {
    const msgId = currentAiMessageId || generateMessageId();
    return {
        id: msgId,
        role: 'assistant',
        content: content || '正在思考…',
        reasoning: reasoning,
        timestamp: Date.now(),
        modelName: selectedModel,
        responseId: responseId,
        annotations: annotations || null,
        prevId: prevId || getTopicRootId()
    };
}

// 创建版本对象 - 用于刷新/重发时添加新版本
function createVersion(content, reasoning, responseId, annotations, prevId, tool_calls) {
    const ver = {
        id: generateMessageId(),
        content: content || '正在思考…',
        reasoning: reasoning,
        timestamp: Date.now(),
        modelName: selectedModel,
        responseId: responseId,
        annotations: annotations || null,
        prevId: prevId || getTopicRootId()
    };
    if (tool_calls) ver.tool_calls = tool_calls;
    return ver;
}

// 确保消息有 versions 数组 - 用于刷新/重发
function ensureMessageVersions(message) {
    if (!message.versions) {
        const ver = {
            id: message.id,
            content: message.content,
            reasoning: message.reasoning || null,
            timestamp: message.timestamp,
            modelName: message.modelName,
            responseId: message.responseId,
            prevId: message.prevId || null
        };
        if (message.tool_calls) ver.tool_calls = message.tool_calls;
        message.versions = [ver];
    }
    return message;
}

// 保存上一条 AI 消息的 responseId（豆包 Session 缓存）
function savePreviousResponseId(targetMessage, fromIndex) {
    if (currentAIProvider !== 'doubao' || !sessionCacheEnabled) return;

    for (let i = fromIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].responseId) {
            targetMessage._previousResponseId = messages[i].responseId;
            console.log('保存上一条AI消息的 responseId:', targetMessage._previousResponseId);
            break;
        }
    }
}

// 检查用户是否在底部附近
let isUserAtBottomTimer = null;

// 底部状态：只由 startGeneration(true) 和 touchmove(false) 控制
let _cachedIsAtBottom = true;

function isUserAtBottom() {
    return _cachedIsAtBottom;
}

// 检查用户是否在底部附近,用来给滚动到底部按钮进行特殊判断
function isUserAtBottomForBtn() {
    return chatContainer.scrollHeight - chatContainer.scrollTop <= chatContainer.clientHeight + 300;
}

// 触摸上滑时同步更新缓存（替代原 handleUserScrollUp，避免动画触发 scroll 被误判）

// === 自定义浮动滚动条 ===
(function() {
    var indicator = document.createElement('div');
    indicator.className = 'custom-scroll-indicator';
    chatContainer.parentNode.appendChild(indicator);
    var hideTimer = null;

    function updateIndicator() {
        var maxScroll = chatContainer.scrollHeight - chatContainer.clientHeight;
        if (maxScroll <= 0) {
            indicator.classList.remove('visible');
            return;
        }
        var ratio = chatContainer.clientHeight / chatContainer.scrollHeight;
        var thumbHeight = Math.max(30, chatContainer.clientHeight * ratio);
        var top = chatContainer.offsetTop + (chatContainer.scrollTop / maxScroll) * (chatContainer.clientHeight - thumbHeight);
        indicator.style.height = thumbHeight + 'px';
        indicator.style.transform = 'translateY(' + top + 'px)';
        indicator.classList.add('visible');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function() {
            indicator.classList.remove('visible');
        }, 800);
    }

    chatContainer.addEventListener('scroll', updateIndicator, { passive: true });
    chatContainer.addEventListener('touchmove', updateIndicator, { passive: true });
    // 内容变化时也更新
    var observer = new MutationObserver(function() { updateIndicator(); });
    observer.observe(chatContainer, { childList: true, subtree: true, characterData: true });
})();


// 重新渲染消息内容时保留思考内容（避免 innerHTML 清除 thinking-content）
function renderContentPreservingThinking(messageContent, content) {
    if (!messageContent) return;
    const thinkingDiv = messageContent.querySelector('.thinking-content');
    messageContent.innerHTML = formatMessage(content);
    messageContent.dataset.content = content;
    if (thinkingDiv) {
        messageContent.insertBefore(thinkingDiv, messageContent.firstChild);
    }
}

// 更新思考内容（流式）
function updateThinking(content) {
    if (!currentAiMessageDiv) return;
    currentThinkingContent += content;
    let thinkingDiv = currentAiMessageDiv.querySelector('.thinking-content');
    if (!thinkingDiv) {
        thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking-content';
        thinkingDiv.innerHTML = `<span class="thinking-label">💭 深度思考</span><span class="thinking-text"></span><button class="thinking-collapse-btn" title="折叠"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 15 12 9 18 15"></polyline></svg></button>`;
        const messageContent = currentAiMessageDiv.querySelector('.message-content');
        messageContent.insertBefore(thinkingDiv, messageContent.firstChild);
    }
    // 启动逐字渲染
    ensureStreamTypewriter();
}
// 敏感词过滤
  function filterSensitiveContent(text) {
      const sensitiveWords = ['刘晓波', '刘晓B'];
      for (const word of sensitiveWords) {
          if (text.includes(word)) {
              return { text: '你好，这个问题我暂时无法回答，让我们换个话题再聊聊吧。', blocked: true };
          }
      }
      // 自动补全：台湾/香港前面没有"中国"则加上
      text = text.replace(/(?<!中国)台湾/g, '中国台湾');
      text = text.replace(/(?<!中国)香港/g, '中国香港');
      return { text: text, blocked: false };
  }

  // 更新最后一条 AI 消息（流式）
  let _streamingCounter = 0;
  function updateStreamingPlaceholder(value) {
      _streamingCounter = value;
      if (messageInput && !messageInput.value) {
          messageInput.placeholder = `streaming : ${value}`;
      }
  }
  // 流式渲染 rAF 节流：同一帧内只渲染一次，避免每个 chunk 都全量 formatMessage
  let _streamingRenderRafId = null;
  let _streamingRenderDirty = false;

  // 立即执行待渲染的内容（流式结束时调用，确保最后一个 chunk 不丢失）
  function flushStreamingRender() {
      if (_streamingRenderRafId) {
          cancelAnimationFrame(_streamingRenderRafId);
          _streamingRenderRafId = null;
      }
      if (!_streamingRenderDirty || !currentAiMessageDiv) return;
      _streamingRenderDirty = false;
      const messageContent = currentAiMessageDiv.querySelector('.message-content');
      if (messageContent) {
          renderContentPreservingThinking(messageContent, currentAiContent);
          // 流式滚动已由 startStreamScroll 独立定时器处理
      }
  }

  function appendToLastMessage(content) {
      if (!currentAiMessageDiv) return;
      // 第一次收到正文内容时，立即折叠思考内容
      if (!currentAiContent && currentThinkingContent) {
          const thinkingDiv = currentAiMessageDiv.querySelector('.thinking-content');
          if (thinkingDiv && !thinkingDiv.classList.contains('collapsed')) {
              toggleThinkingCollapse(currentAiMessageDiv, thinkingDiv, true);
          }
      }
      currentAiContent += content;
      updateStreamingPlaceholder(_streamingCounter + content.length);
      // 敏感词过滤
      const result = filterSensitiveContent(currentAiContent);
      currentAiContent = result.text;
      if (result.blocked) {
          // 移除深度思考内容
          const thinkingDiv = currentAiMessageDiv.querySelector('.thinking-content');
          if (thinkingDiv) thinkingDiv.remove();
          // 更新显示后停止生成
          const messageContent = currentAiMessageDiv.querySelector('.message-content');
          if (messageContent) {
              messageContent.innerHTML = formatMessage(currentAiContent);
              messageContent.dataset.content = currentAiContent;
          }
          stopGenerating();
          return;
      }
      // 启动逐字渲染
      ensureStreamTypewriter();
  }

// 逐字渲染：启动定时器
function ensureStreamTypewriter() {
    if (_streamTypewriterTimer) return;
    if (_streamTypewriterFlushed) return;
    _streamTypewriterTargetDiv = currentAiMessageDiv;
    _streamTypewriterTimer = setInterval(streamTypewriterTick, 8);
}

// 逐字渲染：每 tick 渲染几个字
function streamTypewriterTick() {
    // 优先用 currentAiMessageDiv（工具调用时会更新），为 null 时回退到缓存
    const targetDiv = currentAiMessageDiv || _streamTypewriterTargetDiv;
    if (!targetDiv || !targetDiv.parentNode) {
        clearInterval(_streamTypewriterTimer);
        _streamTypewriterTimer = null;
        return;
    }
    // currentAiMessageDiv 变了说明创建了新气泡，同步更新缓存
    if (currentAiMessageDiv && currentAiMessageDiv !== _streamTypewriterTargetDiv) {
        _streamTypewriterTargetDiv = currentAiMessageDiv;
        resetStreamProgress();
    }
    let didWork = false;

    // 内容被重置时同步重置已渲染长度
    if (_streamMainLen > currentAiContent.length) resetStreamProgress();
    const fullThinking = currentThinkingContent.replace(/^\n+/, '').replace(/\n+$/, '');
    if (_streamThinkingLen > fullThinking.length) _streamThinkingLen = 0;

    // 渲染思考内容
    if (_streamThinkingLen < fullThinking.length) {
        const prevLen = _streamThinkingLen;
        _streamThinkingLen = Math.min(_streamThinkingLen + 3, fullThinking.length);
        const thinkingDiv = targetDiv.querySelector('.thinking-content');
        if (thinkingDiv) {
            const thinkingText = thinkingDiv.querySelector('.thinking-text');
            if (thinkingText) {
                const shown = '💭 ' + fullThinking.slice(0, _streamThinkingLen);
                const newCharCount = _streamThinkingLen - prevLen;
                // 旧部分纯文本，新增部分包裹动画 span
                const oldPart = shown.slice(0, -newCharCount);
                const newPart = shown.slice(-newCharCount);
                thinkingText.innerHTML = '';
                if (oldPart) thinkingText.appendChild(document.createTextNode(oldPart));
                const span = document.createElement('span');
                span.className = 'stream-fade-in';
                span.textContent = newPart;
                thinkingText.appendChild(span);
            }
        }
        didWork = true;
    }

    // 渲染正文
    if (_streamMainLen < currentAiContent.length) {
        _streamMainLen = Math.min(_streamMainLen + 3, currentAiContent.length);
        const messageContent = targetDiv.querySelector('.message-content');
        if (messageContent) {
            // ===== 每次 tick 都全量 formatMessage 渲染 =====
            const displayContent = currentAiContent.slice(0, _streamMainLen);
            renderContentPreservingThinking(messageContent, displayContent);
            _streamLastRenderedLen = _streamMainLen;
        }
        didWork = true;
    }

    if (!didWork) {
        clearInterval(_streamTypewriterTimer);
        _streamTypewriterTimer = null;
        // typewriter 完成后渲染图表（优先用 currentAiMessageDiv，回退到缓存）
        const chartContainer = currentAiMessageDiv || _streamTypewriterTargetDiv;
        if (chartContainer) {
            renderPendingCharts(chartContainer);
        }
    }
}

// 流式结束后立即渲染全部内容
function flushStreamTypewriter() {
    if (_streamTypewriterTimer) {
        clearInterval(_streamTypewriterTimer);
        _streamTypewriterTimer = null;
    }
    _streamTypewriterFlushed = true;
    if (!currentAiMessageDiv) return;
    const fullThinking = currentThinkingContent.replace(/^\n+/, '').replace(/\n+$/, '');
    _streamThinkingLen = fullThinking.length;
    _streamMainLen = currentAiContent.length;
    // 最终渲染
    const thinkingDiv = currentAiMessageDiv.querySelector('.thinking-content');
    if (thinkingDiv) {
        const thinkingText = thinkingDiv.querySelector('.thinking-text');
        if (thinkingText) {
            thinkingText.textContent = '💭 ' + fullThinking;
        }
    }
    const messageContent = currentAiMessageDiv.querySelector('.message-content');
    if (messageContent) {
        renderContentPreservingThinking(messageContent, currentAiContent);
    }
}

// 移除最后一条消息
function removeLastMessage() {
    const lastMessage = chatContainer.querySelector('.message:last-child');
    if (lastMessage) lastMessage.remove();
}

// 格式化消息（使用 marked 库渲染 Markdown）
function formatMessage(content) {
    if (!content) return '';
    let text = content;

    // ========== 1. 提取 LaTeX 公式（在 marked 渲染之前，避免冲突） ==========
    const katexPlaceholders = [];
    // 行间公式优先：\[...\]  → 用 block-level 占位符，避免被 marked 包在 <p> 里
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match, formula) => {
        const idx = katexPlaceholders.length;
        katexPlaceholders.push({ formula: formula, displayMode: true });
        return `\n<div data-katex-slot="${idx}"></div>\n`;
    });
    // 行内公式：\(...\)  → 用文本占位符
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match, formula) => {
        const idx = katexPlaceholders.length;
        katexPlaceholders.push({ formula: formula, displayMode: false });
        return `<<KATEX_INLINE_${idx}>>`;
    });
    // 兼容 $$...$$ 格式（行间）
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
        const idx = katexPlaceholders.length;
        katexPlaceholders.push({ formula: formula, displayMode: true });
        return `\n<div data-katex-slot="${idx}"></div>\n`;
    });
    // 兼容 $...$ 格式（行内）
    text = text.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$/g, (match, formula) => {
        const idx = katexPlaceholders.length;
        katexPlaceholders.push({ formula: formula, displayMode: false });
        return `<<KATEX_INLINE_${idx}>>`;
    });

    // ========== 2. 提取图表嵌入标记 [chart:xxx]（用 block-level 占位符） ==========
    const chartPlaceholders = [];
    text = text.replace(/\[chart:(chart_\w+)\]/g, (match, chartId) => {
        const idx = chartPlaceholders.length;
        chartPlaceholders.push(chartId);
        return `\n<div data-chart-slot="${idx}"></div>\n`;
    });

    // ========== 3. 预处理：防止 Setext 标题误判 ==========
    // Markdown 规范中，一行文字紧接 --- 或 === 会被解析为 <h2>/<h1> 标题
    // 在 ---、***、___ 前面补空行，确保它们被解析为水平分割线 <hr>
    text = text.replace(/([^\n])\n(---+|\*\*\*+|___+)\s*$/gm, '$1\n\n$2');

    // ========== 4. 预处理：修复 CJK 字符与 ** 粗体标记不兼容 ==========
    // CommonMark 规范中，** 结束标记后跟标点（如中文逗号）时，
    // 要求前面也是标点或空格才有效，但前面是汉字就失效了
    // 直接预转换为 <strong> 标签，让 marked 透传
    text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');

    // ========== 5. 使用 marked 渲染 Markdown（breaks:true 让单个换行也变 <br>） ==========
    let html = marked.parse(text, { breaks: true, gfm: true });

    // ========== 4. 还原图表嵌入标记 ==========
    chartPlaceholders.forEach((chartId, idx) => {
        const slot = `<div data-chart-slot="${idx}"></div>`;
        const chartHtml = `<div class="echarts-container" data-chart-id="${chartId}" style="width:100%;height:300px;margin:8px 0;border-radius:8px;overflow:hidden;background:#fff;"></div>`;
        html = html.split(slot).join(chartHtml);
    });

    // ========== 5. 给表格添加 markdown-table class（匹配 CSS 样式） ==========
    html = html.replace(/<table>/g, '<table class="markdown-table">');

    // ========== 6. 处理中文括号（括号及内容渲染为次要颜色） ==========
    html = html.replace(/（[^）]*）/g, '<span class="paren-note">$&</span>');

    // ========== 7. 还原 LaTeX 公式占位符，用 KaTeX 渲染 ==========
    if (typeof katex !== 'undefined' && katexPlaceholders.length > 0) {
        katexPlaceholders.forEach((item, idx) => {
            try {
                const rendered = katex.renderToString(item.formula, {
                    displayMode: item.displayMode,
                    throwOnError: false,
                    output: 'html'
                });
                if (item.displayMode) {
                    // block-level: 替换 div slot
                    const slot = `<div data-katex-slot="${idx}"></div>`;
                    html = html.split(slot).join(rendered);
                } else {
                    // inline: 替换文本占位符
                    const placeholder = `<<KATEX_INLINE_${idx}>>`;
                    html = html.split(placeholder).join(rendered);
                }
            } catch (e) {
                console.warn('[KaTeX] 渲染失败:', e, item.formula);
                const fallback = escapeHtml(item.formula);
                if (item.displayMode) {
                    const slot = `<div data-katex-slot="${idx}"></div>`;
                    html = html.split(slot).join(`<div class="katex-fallback" style="color:#e74c3c;font-family:monospace;">${fallback}</div>`);
                } else {
                    const placeholder = `<<KATEX_INLINE_${idx}>>`;
                    html = html.split(placeholder).join(`<span class="katex-fallback" style="color:#e74c3c;font-family:monospace;">${fallback}</span>`);
                }
            }
        });
    }

    return html;
}

// 全局注册表：跟踪所有活跃的 ECharts 实例和 ResizeObserver，防止内存泄漏
const _activeChartInstances = new Map(); // chartId -> { chart, observer }

/**
 * 销毁所有活跃的 ECharts 实例并断开 ResizeObserver
 * 在清空聊天容器（切换话题等）之前调用
 */
function disposeAllCharts() {
    if (typeof echarts === 'undefined') return;
    _activeChartInstances.forEach(({ chart, observer }) => {
        if (observer) observer.disconnect();
        if (chart) chart.dispose();
    });
    _activeChartInstances.clear();
}

/**
 * 渲染消息中所有待渲染的 ECharts 图表
 * 优先从 pendingCharts（内存）读取，其次从 IndexedDB 恢复
 */
async function renderPendingCharts(container) {
    if (typeof echarts === 'undefined') return;
    const chartDivs = container.querySelectorAll('.echarts-container');
    if (chartDivs.length === 0) return;

    for (const div of chartDivs) {
        const chartId = div.dataset.chartId;
        if (!chartId) continue;

        // 如果该 chartId 已有实例，先销毁旧的（防止重复初始化）
        const existing = _activeChartInstances.get(chartId);
        if (existing) {
            if (existing.observer) existing.observer.disconnect();
            if (existing.chart) existing.chart.dispose();
            _activeChartInstances.delete(chartId);
        }

        let chartData = null;
        // 优先从内存读取
        if (typeof pendingCharts !== 'undefined' && pendingCharts.has(chartId)) {
            chartData = pendingCharts.get(chartId);
        }
        // 其次从 IndexedDB 恢复（刷新话题后）
        if (!chartData && typeof loadChartFromDB === 'function') {
            chartData = await loadChartFromDB(chartId);
        }

        if (chartData && chartData.option) {
            try {
                // 设置高度
                if (chartData.height) div.style.height = chartData.height + 'px';
                const chart = echarts.init(div);
                // 确保交互性：添加 tooltip 和 grid 配置
                const mergedOption = Object.assign({
                    tooltip: { trigger: 'item' },
                    grid: { left: '10%', right: '5%', top: '15%', bottom: '10%', containLabel: true }
                }, chartData.option);
                // 折线图/柱状图/散点图用 axis trigger
                if (mergedOption.series && mergedOption.series.some(s => s.type === 'line' || s.type === 'scatter' || s.type === 'bar')) {
                    mergedOption.tooltip.trigger = 'axis';
                }
                chart.setOption(mergedOption);
                // 响应式
                const resizeObserver = new ResizeObserver(() => chart.resize());
                resizeObserver.observe(div);
                // 注册到全局表，便于后续统一销毁
                _activeChartInstances.set(chartId, { chart, observer: resizeObserver });
                // 清理内存
                if (typeof pendingCharts !== 'undefined') pendingCharts.delete(chartId);
            } catch (e) {
                console.error('[CNAI_Chart] 渲染失败:', e);
                div.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">图表渲染失败</p>';
            }
        } else {
            div.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">图表数据不存在</p>';
        }
    }
}

// 恢复安全的 HTML 标签（用于表格单元格等场景）
function restoreSafeHtml(text) {
    // 允许的安全标签列表
    const safeTags = ['font', 'span', 'b', 'i', 'strong', 'em', 'u', 's', 'mark', 'sub', 'sup', 'br'];
    let result = text;

    // 恢复安全标签
    safeTags.forEach(tag => {
        // 恢复开始标签（带属性）如 &lt;font color="red"&gt; -> <font color="red">
        const openTagRegex = new RegExp(`&lt;${tag}(\\s[^&]*)?&gt;`, 'gi');
        result = result.replace(openTagRegex, (match, attrs) => {
            // 过滤危险属性（on* 事件、javascript: 等）
            if (attrs) {
                attrs = attrs.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
                attrs = attrs.replace(/\s*href\s*=\s*["']\s*javascript:[^"']*["']/gi, '');
                return `<${tag}${attrs}>`;
            }
            return `<${tag}>`;
        });
        // 恢复结束标签
        const closeTagRegex = new RegExp(`&lt;/${tag}&gt;`, 'gi');
        result = result.replace(closeTagRegex, `</${tag}>`);
    });

    return result;
}

// HTML 转义
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// 生成引用来源 HTML
function generateAnnotationsHtml(annotations) {
    if (!annotations || annotations.length === 0) return '';

    let html = '<div class="message-annotations">';
    html += '<div class="annotations-title">📚 参考来源</div>';
    html += '<div class="annotations-list">';

    annotations.forEach((annotation, index) => {
        if (annotation.type === 'url_citation') {
            const title = annotation.title || '未知来源';
            const url = annotation.url || '#';
            const siteName = annotation.site_name || '';
            const logoUrl = annotation.logo_url || '';

            // 截取标题（最多50字）
            const shortTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;

            html += `<div class="annotation-item">`;
            html += `<span class="annotation-index">[${index + 1}]</span>`;
            if (logoUrl) {
                html += `<img src="${logoUrl}" alt="${siteName}" class="annotation-logo" onerror="this.style.display='none'">`;
            }
            html += `<a href="${url}" target="_blank" class="annotation-link" title="${title}">`;
            if (siteName) {
                html += `<span class="annotation-site">${siteName}</span> - `;
            }
            html += `${shortTitle}</a>`;
            html += `</div>`;
        }
    });

    html += '</div></div>';
    return html;
}

// 向现有消息添加引用来源（流式输出完成后调用）
function appendAnnotations(messageDiv, annotations) {
    if (!messageDiv || !annotations || annotations.length === 0) return;

    // 检查是否已存在引用来源
    const existingAnnotations = messageDiv.querySelector('.message-annotations');
    if (existingAnnotations) {
        existingAnnotations.remove();
    }

    // 在 message-content 内部末尾插入引用来源
    const messageContent = messageDiv.querySelector('.message-content');
    if (messageContent) {
        const annotationsHtml = generateAnnotationsHtml(annotations);
        messageContent.insertAdjacentHTML('beforeend', annotationsHtml);
    }
}

// 转义正则特殊字符
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 滚动动画相关变量
let scrollAnimationId = null;
let isScrollAnimating = false;

// 三段式滚动动画：预加速 → 快速移动 → 减速（三段独立计算）
function smoothScrollTo(targetPosition) {
    // 如果有正在进行的动画，先取消
    if (scrollAnimationId) {
        cancelAnimationFrame(scrollAnimationId);
    }

    const startPosition = chatContainer.scrollTop;
    const distance = targetPosition - startPosition;
    const absDistance = Math.abs(distance);
    const direction = distance > 0 ? 1 : -1;

    if (absDistance < 1) return;

    isScrollAnimating = true;

    // 三段独立参数
    const accelDuration = 500;    // 加速阶段时间：
    const accelDistance = 100;     // 加速阶段距离：
    const decelDuration = 500;    // 减速阶段时间：
    const decelDistance = 200;    // 减速阶段距离：

    // 根据总距离调整加速/减速距离（不超过总距离的一半）
    const actualAccelDist = accelDistance;
    const actualDecelDist = decelDistance;
    const middleDistance = absDistance - actualAccelDist - actualDecelDist;

    // 中间阶段时间：根据距离动态计算
    const middleDuration = Math.min(middleDistance / 2, 500);

    // 计算各阶段累计时间
    const accelEndTime = accelDuration;
    const middleEndTime = accelDuration + middleDuration;
    const totalDuration = accelDuration + middleDuration + decelDuration;

    let startTime = null;

    function animateScroll(currentTime) {
        if (!startTime) startTime = currentTime;
        const elapsed = currentTime - startTime;

        if (elapsed >= totalDuration) {
            chatContainer.scrollTop = targetPosition;
            isScrollAnimating = false;
            scrollAnimationId = null;
            // 沉浸模式：动画滚动到底部后重新计时隐藏
            if (isImmersiveMode()) {
                scheduleImmersiveHide();
            }
            return;
        }

        let currentPos;

        if (elapsed < accelEndTime) {
            // 加速阶段：ease-in
            const t = elapsed / accelDuration;
            const easeProgress = t * t;
            currentPos = actualAccelDist * easeProgress;
        } else if (elapsed < middleEndTime) {
            // 中间阶段：线性
            const middleElapsed = elapsed - accelEndTime;
            const middleProgress = middleElapsed / middleDuration;
            currentPos = actualAccelDist + middleDistance * middleProgress;
        } else {
            // 减速阶段：ease-out
            const decelElapsed = elapsed - middleEndTime;
            const t = decelElapsed / decelDuration;
            const easeProgress = 1 - Math.pow(1 - t, 2);
            currentPos = actualAccelDist + middleDistance + actualDecelDist * easeProgress;
        }

        chatContainer.scrollTop = startPosition + currentPos * direction;

        scrollAnimationId = requestAnimationFrame(animateScroll);
    }

    scrollAnimationId = requestAnimationFrame(animateScroll);
}

// 停止滚动动画
function stopScrollAnimation() {
    if (scrollAnimationId) {
        cancelAnimationFrame(scrollAnimationId);
        scrollAnimationId = null;
        isScrollAnimating = false;
    }
}

// 流式输出定时滚动：独立 setInterval，不依赖 tick
let _streamScrollAnimId = null;

// 停止所有滚动（通用平滑滚动 + 流式滚动 + 底部缓存）
function stopAllScroll() {
    stopScrollAnimation();
    if (_streamScrollAnimId) { cancelAnimationFrame(_streamScrollAnimId); _streamScrollAnimId = null; }
    _cachedIsAtBottom = false;
}
let _streamScrollIntervalId = null;

function _doStreamScroll() {
    if (isUserAtBottom()) {
        chatContainer.scrollTop = chatContainer.scrollHeight - chatContainer.clientHeight;
    }
}

function startStreamScroll() {
    if (_streamScrollIntervalId) return;
    _streamScrollIntervalId = setInterval(_doStreamScroll, 200);
}

function stopStreamScroll() {
    if (_streamScrollIntervalId) {
        clearInterval(_streamScrollIntervalId);
        _streamScrollIntervalId = null;
    }
    // 流式结束后如果用户在底部则滚一次
    _doStreamScroll();
}

// 滚动到底部（rAF 节流，合并同一帧内的多次调用）
let _scrollToBottomRafId = null;
function scrollToBottom(mode = false) {
    if (mode === true) {
        const targetPosition = chatContainer.scrollHeight - chatContainer.clientHeight;
        smoothScrollTo(targetPosition);
        return;
    }
    if (_scrollToBottomRafId) return;
    _scrollToBottomRafId = requestAnimationFrame(() => {
        _scrollToBottomRafId = null;
        chatContainer.scrollTop = chatContainer.scrollHeight - chatContainer.clientHeight;
    });
}

// 滚动方向检测相关变量
let lastScrollTop = 0;
let accumulatedScrollUp = 0;  // 累计向上滚动距离

// 横屏模式标题栏显示/隐藏相关变量
let isLandscapeMode = false;
let isMobileMode = false;  // 移动端模式标识（由 Android 端设置）
let headerVisibleInLandscape = false;
let headerHideTimer = null;
const header = document.querySelector('.header');

// Android 端初始化时调用此函数，标识当前为移动端环境
window.setMobileMode = function () {
    isMobileMode = true;
    document.body.classList.add('mobile-mode');
    // 初始化时更新 container 的 marginTop
    updateContainerMarginTop();

    // 初始化时通知原生端锁定竖屏设置
    if (window.AndroidBridge && typeof AndroidBridge.setLockPortrait === 'function') {
        AndroidBridge.setLockPortrait(lockPortrait);
    }
};

// 显示权限说明（由原生端调用）
window.onShowPermissionExplanation = function (types) {
    const overlay = document.getElementById('permissionExplanationOverlay');
    const content = document.getElementById('permissionExplanationContent');
    
    if (!overlay || !content) return;
    
    // 构建权限说明内容
    let html = '<p>为了给您提供更好的体验，我们需要以下权限：</p><ul>';
    
    if (types.includes('phone_state')) {
        html += '<li>• 电话状态：用于识别设备，提供更精准的广告</li>';
    }
    if (types.includes('location')) {
        html += '<li>• 位置信息：用于提供基于位置的相关广告</li>';
    }
    if (types.includes('storage')) {
        html += '<li>• 存储权限：用于缓存广告资源、笔记功能读写本地笔记、专家模式编辑文件</li>';
    }
    
    html += '</ul><p>点击「继续」申请权限，这些权限不会用于其他用途。</p>';
    
    content.innerHTML = html;
    overlay.style.display = 'flex';
};

// 权限请求完成（由原生端调用）
window.onPermissionRequestComplete = function () {
    const overlay = document.getElementById('permissionExplanationOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
};

// 初始化权限说明按钮事件
function initPermissionExplanationButtons() {
    const continueBtn = document.getElementById('permissionExplanationContinue');
    
    if (continueBtn) {
        continueBtn.addEventListener('click', function () {
            if (window.AndroidBridge && window.AndroidBridge.onPermissionExplanationContinue) {
                window.AndroidBridge.onPermissionExplanationContinue();
            }
        });
    }
}

// 初始化广告 SDK（开屏广告依赖）
function initAdSdkForTest() {
    if (window.AndroidBridge) {
        window.AndroidBridge.initAdSdk();
    }
}
function initializeAdSdk() {
    setTimeout(() => { initAdSdkForTest(); }, 1);
}

// 页面加载完成后初始化权限说明按钮
document.addEventListener('DOMContentLoaded', function () {
    initPermissionExplanationButtons();
});

// 更新 container 的 marginTop
function updateContainerMarginTop() {
    const container = document.querySelector('.container');
    if (container) {
        if (isLandscapeMode) {
            container.style.marginTop = '0px';
            // 横屏下去掉标题栏子元素的 paddingTop
            if (header) {
                const children = header.children;
                for (let i = 0; i < children.length; i++) {
                    children[i].style.paddingTop = '0px';
                }
                // header-center 是 absolute 定位，需要单独设置 top
                const headerCenter = header.querySelector('.header-center');
                if (headerCenter) headerCenter.style.top = '0px';
            }
            // 横屏下弹窗也不需要状态栏 padding
            document.documentElement.style.setProperty('--status-bar-height', '0px');
        } else {
            // 竖屏时设置标题栏子元素 paddingTop 为状态栏高度
            let statusBarH = 0;
            if (window.AndroidBridge && typeof AndroidBridge.getStatusBarHeight === 'function') {
                try { statusBarH = AndroidBridge.getStatusBarHeight(); } catch(e) {}
            }
            if (header) {
                const children = header.children;
                for (let i = 0; i < children.length; i++) {
                    children[i].style.paddingTop = statusBarH + 'px';
                }
                // header-center 是 absolute 定位，需要单独设置 top
                const headerCenter = header.querySelector('.header-center');
                if (headerCenter) headerCenter.style.top = statusBarH + 'px';
            }
            // 竖屏时弹窗也需要状态栏 padding
            document.documentElement.style.setProperty('--status-bar-height', statusBarH + 'px');
            const headerHeight = header.offsetHeight || 72;
            container.style.marginTop = headerHeight + 'px';
        }
    }
}

// 接收 Android 端屏幕方向变化通知
window.onOrientationChange = function (isLandscape) {
    isLandscapeMode = isLandscape;
    console.log('屏幕方向变化:', isLandscape ? '横屏' : '竖屏');

    if (isLandscapeMode) {
        document.body.classList.add('landscape-mode');
        // 进入横屏模式时，默认隐藏标题栏
        header.classList.remove('landscape-visible');
        headerVisibleInLandscape = false;
        // 横屏时 container 覆盖整个屏幕
        updateContainerMarginTop();
        // 横屏时把发送按钮移到菜单旁边（菜单在 input-textarea-row 里）
        var textareaRow = document.querySelector('.input-textarea-row');
        if (textareaRow && sendBtn) textareaRow.appendChild(sendBtn);
    } else {
        document.body.classList.remove('landscape-mode');
        // 退出横屏模式时，恢复标题栏显示
        header.classList.remove('landscape-visible');
        headerVisibleInLandscape = false;
        if (headerHideTimer) {
            clearTimeout(headerHideTimer);
            headerHideTimer = null;
        }
        // 竖屏时恢复 container 在 header 下方
        updateContainerMarginTop();
        // 竖屏时把发送按钮移回 bottom-info-bar
        var bottomInfoBar = document.getElementById('bottomInfoBar');
        if (bottomInfoBar && sendBtn) bottomInfoBar.insertBefore(sendBtn, bottomInfoBar.firstChild);
    }
};

// 显示横屏模式标题栏
function showHeaderInLandscape() {
    if (!isLandscapeMode) return;

    if (!headerVisibleInLandscape) {
        header.classList.add('landscape-visible');
        headerVisibleInLandscape = true;
    }
    resetHeaderHideTimer();
}

// 隐藏横屏模式标题栏
function hideHeaderInLandscape() {
    if (!isLandscapeMode) return;

    if (headerVisibleInLandscape) {
        header.classList.remove('landscape-visible');
        headerVisibleInLandscape = false;
    }
    if (headerHideTimer) {
        clearTimeout(headerHideTimer);
        headerHideTimer = null;
    }
}

// 重置标题栏自动隐藏定时器
function resetHeaderHideTimer() {
    if (headerHideTimer) {
        clearTimeout(headerHideTimer);
    }
    headerHideTimer = setTimeout(() => {
        hideHeaderInLandscape();
    }, 3000);  // 3秒后自动隐藏
}

// 更新滚动按钮位置（以 input-area 顶部为基准）
function updateScrollBtnPosition() {
    const inputArea = document.querySelector('.input-area');
    if (!inputArea) return;
    const iaRect = inputArea.getBoundingClientRect();
    // 按钮间距：底部、搜索、顶部
    const offsets = { bottom: 8, search: 58, top: 108 };
    scrollToBottomBtn.style.bottom = (window.innerHeight - iaRect.top + offsets.bottom) + 'px';
    searchInChatBtn.style.bottom = (window.innerHeight - iaRect.top + offsets.search) + 'px';
    scrollToTopBtn.style.bottom = (window.innerHeight - iaRect.top + offsets.top) + 'px';
}

// 检查是否需要显示滚动到底部按钮
function checkScrollToBottomButton() {
    // 如果内容不足以滚动，隐藏所有按钮
    if (chatContainer.scrollHeight <= chatContainer.clientHeight + 50) {
        scrollToBottomBtn.classList.remove('visible');
        scrollToTopBtn.classList.remove('visible');
        searchInChatBtn.classList.remove('visible');
        return;
    }

    if (isUserAtBottomForBtn()) {
        scrollToBottomBtn.classList.remove('visible');
        scrollToTopBtn.classList.remove('visible');
        searchInChatBtn.classList.remove('visible');
    } else {
        updateScrollBtnPosition();
        scrollToBottomBtn.classList.add('visible');
        scrollToTopBtn.classList.add('visible');
        searchInChatBtn.classList.add('visible');
    }
}

// 检查滚动方向并显示/隐藏功能栏
function checkScrollDirection() {
    const currentScrollTop = chatContainer.scrollTop;
    const scrollThreshold = 200; // 滚动超过100px才触发（距离顶部的阈值）
    const scrollUpThreshold = 200; // 向上滚动超过10px才显示功能栏

    const scrollDelta = lastScrollTop - currentScrollTop;  // 正值表示向上滚动

    // 向上滚动时累计滚动距离
    if (scrollDelta > 0) {
        accumulatedScrollUp += scrollDelta;
    } else if (scrollDelta < 0) {
        // 向下滚动时重置累计
        accumulatedScrollUp = 0;
    }

    // 向上滚动超过阈值且不在顶部附近时
    if (accumulatedScrollUp >= scrollUpThreshold && currentScrollTop > scrollThreshold) {
        // 横屏模式下同时显示标题栏
        if (isLandscapeMode) {
            showHeaderInLandscape();
        }
    } else if (currentScrollTop <= scrollThreshold || isUserAtBottomForBtn()) {
        // 在顶部附近或底部时隐藏至顶和搜索按钮
        scrollToTopBtn.classList.remove('visible');
        searchInChatBtn.classList.remove('visible');
        // 横屏模式下隐藏标题栏
        if (isLandscapeMode && headerVisibleInLandscape) {
            hideHeaderInLandscape();
        }
    }


    lastScrollTop = currentScrollTop;
}

// ========== 消息分页加载：滚动到顶部加载更多 ==========
let _hideCounterTimeout = null; // 计数器自动隐藏定时器

function checkScrollToTopForMore() {
    if (isLoadingMoreMessages || isRenderingMessages) return;
    if (chatContainer.scrollTop > 100) return; // 不在顶部附近

    if (!allMessages || allMessages.length === 0) return;

    // 如果已经加载了所有消息，不需要再加载
    if (loadedCount >= allMessages.length) return;

    // 计算下一批要加载的消息
    const remainingCount = allMessages.length - loadedCount;
    const nextBatchSize = Math.min(PAGE_SIZE, remainingCount);
    const nextLoadedCount = loadedCount + nextBatchSize;

    // 取出下一批消息（从 allMessages 的前面取）
    const startIndex = allMessages.length - nextLoadedCount;
    const endIndex = allMessages.length - loadedCount;
    const nextBatch = allMessages.slice(startIndex, endIndex);

    if (nextBatch.length === 0) return;

    // 开始加载
    isLoadingMoreMessages = true;
    isRenderingMessages = true;
    clearTimeout(_hideCounterTimeout);

    // 显示初始进度
    showRenderingCount(loadedCount, allMessages.length);

    // 记录当前滚动高度（用于保持滚动位置）
    let oldScrollHeight = chatContainer.scrollHeight;

    // 锚点：插入前的第一个子节点
    const prependAnchor = chatContainer.firstChild;

    // 分批插入消息到顶部
    const BATCH_SIZE = 10;
    const BATCH_DELAY = 15;
    let batchStartIndex = 0;
    const renderVersion = renderMessagesVersion;

    function prependNextBatch() {
        // 如果已经切换话题，停止
        if (renderVersion !== renderMessagesVersion) {
            isLoadingMoreMessages = false;
            isRenderingMessages = false;
            return;
        }

        const batchEndIndex = Math.min(batchStartIndex + BATCH_SIZE, nextBatch.length);
        const fragment = document.createDocumentFragment();

        for (let i = batchStartIndex; i < batchEndIndex; i++) {
            const msg = nextBatch[i];

            // tool 消息处理
            if (msg.role === 'tool') {
                const toolCard = document.createElement('div');
                toolCard.className = 'tool-call-card';
                toolCard.dataset.messageId = msg.id;
                toolCard.style.cssText = 'font-size:12px;color:var(--text-secondary);padding:4px 0;margin:2px 0;';
                const toolName = msg.tool_name || 'web_search';
                const params = getWebSearchToolParams(toolName, msg.tool_args);
                const summary = getWebSearchResultSummary(msg.content);
                toolCard.innerHTML = `<code style="font-size:12px;word-break:break-all;"><span style="color:#5c6bc0;font-weight:600;">${escapeHtml(toolName)}</span><span style="color:var(--text-secondary);">(${escapeHtml(params)})</span></code><div style="color:var(--text-secondary);opacity:0.7;padding-left:16px;margin-top:2px;font-size:12px;word-break:break-all;">⎿ ${escapeHtml(summary)}</div>`;
                if (msg.diffHtml) {
                    const diffCard = document.createElement('div');
                    diffCard.className = 'diff-card';
                    const meta = msg.diffMeta || {};
                    const fileName = meta.path || '';
                    const addCount = meta.added || 0;
                    const delCount = meta.removed || 0;
                    diffCard.innerHTML = `
                        <div class="diff-header">
                            <span class="diff-filename">${escapeHtml(fileName)}</span>
                            <span class="diff-stats"><span class="diff-add">+${addCount}</span> <span class="diff-del">-${delCount}</span></span>
                            <span class="diff-toggle">▶</span>
                        </div>
                        <div class="diff-body">${msg.diffHtml}</div>
                    `;
                    diffCard.querySelector('.diff-header').addEventListener('click', () => {
                        diffCard.classList.toggle('expanded');
                        const toggle = diffCard.querySelector('.diff-toggle');
                        toggle.textContent = diffCard.classList.contains('expanded') ? '▼' : '▶';
                    });
                    toolCard.appendChild(diffCard);
                }
                fragment.appendChild(toolCard);
                continue;
            }

            // assistant 消息含 tool_calls 但无文本内容且无思考：跳过
            if (msg.role === 'assistant' && msg.tool_calls && (!msg.content || msg.content === null) && !msg.reasoning) {
                const placeholder = document.createElement('div');
                placeholder.dataset.messageId = msg.id;
                placeholder.style.display = 'none';
                fragment.appendChild(placeholder);
                continue;
            }

            // 普通消息处理
            const versions = msg.versions || null;
            const currentVersionIndex = msg.currentVersionIndex || 0;
            let images = null;
            if (msg.role === 'user' && msg.timestamp) {
                const messageKey = 'user_' + msg.timestamp;
                images = sentImagesByMessage[messageKey] || null;
            }
            let files = null;
            if (msg.role === 'user' && msg.timestamp) {
                const messageKey = 'user_' + msg.timestamp;
                files = sentFilesByMessage[messageKey] || null;
            }
            if (msg.role === 'system' && msg.receivedFileObj) {
                files = [msg.receivedFileObj];
            }
            const displayContent = msg.displayContent || msg.content || '';
            const msgDiv = appendMessage_load(msg.role, displayContent, false, false, msg.timestamp, msg.modelName, versions, currentVersionIndex, images, files, msg.annotations, msg.id);
            if (msg.reasoning && msg.role === 'assistant') {
                prependThinking(msgDiv, msg.reasoning);
            }
            fragment.appendChild(msgDiv);
        }

        // 插入到容器顶部
        if (prependAnchor && chatContainer.contains(prependAnchor)) {
            chatContainer.insertBefore(fragment, prependAnchor);
        } else if (chatContainer.firstChild) {
            chatContainer.insertBefore(fragment, chatContainer.firstChild);
        } else {
            chatContainer.appendChild(fragment);
        }

        // 保持滚动位置（补偿新内容导致的高度变化）
        const newScrollHeight = chatContainer.scrollHeight;
        chatContainer.scrollTop += (newScrollHeight - oldScrollHeight);
        oldScrollHeight = chatContainer.scrollHeight;

        batchStartIndex = batchEndIndex;

        // 更新实际加载进度
        showRenderingCount(loadedCount + batchStartIndex, allMessages.length);

        if (batchStartIndex < nextBatch.length) {
            setTimeout(prependNextBatch, BATCH_DELAY);
        } else {
            // 所有批次渲染完成
            updateAiMessageNumbers();
            loadedCount = nextLoadedCount;
            isLoadingMoreMessages = false;
            isRenderingMessages = false;

            // 延迟隐藏计数（全部加载完或中间状态都隐藏）
            _hideCounterTimeout = setTimeout(() => hideAllHeaderHints(), 2000);
        }
    }

    prependNextBatch();
}

// 滚动事件处理（合并两个检查）
let _scrollRafId = null;
function handleScroll() {
    // rAF 节流：同一帧内多次 scroll 事件只执行一次
    if (_scrollRafId) return;
    _scrollRafId = requestAnimationFrame(() => {
        _scrollRafId = null;
        // 在 checkScrollDirection 更新 lastScrollTop 之前保存滚动方向
        const _immersiveScrollDelta = lastScrollTop - chatContainer.scrollTop;  // 正值=向上滚动
        checkScrollToBottomButton();
        checkScrollDirection();
        // 滚动时关闭所有弹出菜单
        closeAllPopupsOnScroll();
        // 检测滚动到顶部，加载更多消息
        checkScrollToTopForMore();
    });
}

// 滚动时关闭所有弹出菜单
function closeAllPopupsOnScroll() {
    // 如果正在渲染消息，不关闭任何菜单/抽屉
    if (isRenderingMessages) {
        return;
    }

    // 关闭聊天菜单
    closeChatMenuSheet();
    // 关闭 AI 服务商选择器（已改用 createBottomSheetPicker，无需手动关闭）
    // 关闭模型选择器（已改用 createBottomSheetPicker，无需手动关闭）
}

// 滚动到底部按钮点击事件
scrollToBottomBtn.addEventListener('click', () => {
    scrollToBottom(true);
});

// 跳转到顶部按钮点击事件
scrollToTopBtn.addEventListener('click', () => {
    smoothScrollTo(0);
});

// 聊天搜索按钮点击事件
searchInChatBtn.addEventListener('click', () => {
    openGlobalSearch(currentTopicId);
});

// 监听聊天容器滚动事件
chatContainer.addEventListener('scroll', handleScroll);

// 用户手动滚动时停止动画
chatContainer.addEventListener('wheel', stopScrollAnimation, { passive: true });
let _touchStopTimer = null;
// 手指碰到屏幕：立即打断自动滚动
chatContainer.addEventListener('touchstart', () => {
    stopAllScroll();
    if (isSending) {
        _cachedIsAtBottom = false;
    }
    if (isImmersiveMode()) {
        showAllMessages();
        cancelImmersiveHide();
    }
}, { passive: true });
// 手指离开屏幕：松手后 500ms 判断是否恢复自动滚动
chatContainer.addEventListener('touchend', () => {
    if (_touchStopTimer) clearTimeout(_touchStopTimer);
    _touchStopTimer = setTimeout(() => {
        _touchStopTimer = null;
        if (isSending && !stopBtn.classList.contains('purple')) {
            _cachedIsAtBottom = isUserAtBottomForBtn();
        }
    }, 500);
}, { passive: true });

// 点击 tool-call-card 显示完整信息
chatContainer.addEventListener('click', (e) => {
    // 点击 diff 卡片不触发
    if (e.target.closest('.diff-card')) return;
    const toolCard = e.target.closest('.tool-call-card');
    if (!toolCard) return;
    const msgId = toolCard.dataset.messageId;
    if (!msgId) return;
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;
    const toolName = msg.tool_name || '未知工具';
    const toolArgs = msg.tool_args || {};
    const toolResult = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    if (typeof createBottomSheetPicker === 'function') {
        let contentHtml = '';
        contentHtml += `<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">工具</div><div style="font-size:14px;font-weight:600;color:var(--primary-color);">${escapeHtml(toolName)}</div></div>`;
        contentHtml += `<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">参数</div><pre style="font-size:12px;white-space:pre-wrap;word-break:break-all;margin:0;color:var(--text-primary);">${escapeHtml(JSON.stringify(toolArgs, null, 2))}</pre></div>`;
        // 检测结果是否为 git diff 格式，渲染为 diff 卡片
        const resultHtml = renderToolResultAsDiff(toolResult);
        contentHtml += `<div><div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">结果</div>${resultHtml}</div>`;
        contentHtml += `<button id="toolDetailCopyBtn" style="margin-top:16px;width:100%;padding:12px;border:1px solid var(--border-color);background:none;color:var(--text-primary);border-radius:8px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">${ICONS.copy}<span>复制详情</span></button>`;
        createBottomSheetPicker({
            title: '工具调用详情',
            items: [],
            onSelect: () => {},
            customContent: `<div style="padding:12px 16px;">${contentHtml}</div>`
        }).show();
        setTimeout(() => {
            // 绑定 diff 卡片展开/折叠
            const diffCard = document.querySelector('.bs-panel-content .diff-card');
            if (diffCard) {
                const header = diffCard.querySelector('.diff-header');
                if (header) {
                    header.addEventListener('click', function() {
                        diffCard.classList.toggle('expanded');
                        const toggle = diffCard.querySelector('.diff-toggle');
                        if (toggle) toggle.textContent = diffCard.classList.contains('expanded') ? '▼' : '▶';
                        const body = diffCard.querySelector('.diff-body');
                        if (body) body.style.display = diffCard.classList.contains('expanded') ? 'block' : 'none';
                    });
                }
            }
            const copyBtn = document.getElementById('toolDetailCopyBtn');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    const textToCopy = '工具: ' + toolName + '\n参数: ' + JSON.stringify(toolArgs, null, 2) + '\n结果: ' + (typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult));
                    // 优先走 AndroidBridge（WebView 最可靠）
                    if (window.AndroidBridge && AndroidBridge.copyToClipboard) {
                        AndroidBridge.copyToClipboard(textToCopy);
                        showToast('已复制');
                    } else if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(textToCopy).then(() => showToast('已复制')).catch(() => {
                            const ta = document.createElement('textarea');
                            ta.value = textToCopy;
                            document.body.appendChild(ta);
                            ta.select();
                            try { document.execCommand('copy'); showToast('已复制'); } catch (_) { showToast('复制失败'); }
                            document.body.removeChild(ta);
                        });
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = textToCopy;
                        document.body.appendChild(ta);
                        ta.select();
                        try { document.execCommand('copy'); showToast('已复制'); } catch (_) { showToast('复制失败'); }
                        document.body.removeChild(ta);
                    }
                });
            }
        }, 100);
    }
});

/**
 * 检测文本是否为 git diff 格式
 */
function isGitDiff(text) {
    if (!text || typeof text !== 'string') return false;
    // git diff 以 "diff --git" 开头，或包含 "--- a/" 和 "+++ b/"
    return text.includes('diff --git') || (text.includes('--- a/') && text.includes('+++ b/'));
}

/**
 * 解析 git diff 文本为 diffData 格式
 * @param {string} diffText - git diff 原始文本
 * @returns {{lines: Array, stats: {added: number, removed: number}}} diffData
 */
function parseGitDiff(diffText) {
    const lines = [];
    let stats = { added: 0, removed: 0 };
    if (!diffText) return { lines, stats };
    
    const rawLines = diffText.split('\n');
    let currentFile = '';
    let lineNumOld = 0;
    let lineNumNew = 0;
    let inHunk = false;
    let oldLines = [];
    let newLines = [];
    
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        
        // diff --git a/xxx b/xxx
        if (line.startsWith('diff --git ')) {
            if (inHunk) {
                // 结束上一个 hunk，flush
                flushHunk();
            }
            inHunk = false;
            currentFile = line.replace('diff --git ', '').replace(/^a\//, '').split(' b/')[1] || '';
            // 添加文件头作为上下文
            lines.push({ type: 'ctx', line: '', content: line });
            continue;
        }
        
        // index / --- / +++ 行
        if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
            if (line.startsWith('--- a/')) {
                // 不额外添加
            }
            lines.push({ type: 'ctx', line: '', content: line });
            continue;
        }
        
        // @@ -a,b +c,d @@  hunk header
        if (line.startsWith('@@')) {
            if (inHunk) {
                flushHunk();
            }
            inHunk = true;
            oldLines = [];
            newLines = [];
            // 解析 @@ -oldStart,oldCount +newStart,newCount @@
            const match = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
            if (match) {
                lineNumOld = parseInt(match[1], 10);
                lineNumNew = parseInt(match[2], 10);
            }
            lines.push({ type: 'ctx', line: '', content: line });
            continue;
        }
        
        if (!inHunk) {
            // hunk 外的行作为上下文
            if (line.trim()) {
                lines.push({ type: 'ctx', line: '', content: line });
            }
            continue;
        }
        
        // diff 内容行
        if (line.startsWith('+')) {
            const content = line.substring(1);
            lines.push({ type: 'add', line: lineNumNew, content });
            newLines.push({ type: 'add', line: lineNumNew, content });
            lineNumNew++;
            stats.added++;
        } else if (line.startsWith('-')) {
            const content = line.substring(1);
            lines.push({ type: 'del', line: lineNumOld, content });
            oldLines.push({ type: 'del', line: lineNumOld, content });
            lineNumOld++;
            stats.removed++;
        } else if (line.startsWith('\\')) {
            // \ No newline at end of file
            lines.push({ type: 'ctx', line: '', content: line });
        } else {
            // 上下文行（以空格开头或空行）
            const content = line.startsWith(' ') ? line.substring(1) : line;
            lines.push({ type: 'ctx', line: lineNumOld, content });
            oldLines.push({ type: 'ctx', line: lineNumOld, content });
            newLines.push({ type: 'ctx', line: lineNumNew, content });
            lineNumOld++;
            lineNumNew++;
        }
    }
    
    if (inHunk) {
        flushHunk();
    }
    
    function flushHunk() {
        // 已通过逐行解析直接 push 到 lines，无需额外操作
    }
    
    return { lines, stats };
}

/**
 * 将工具调用结果渲染为 HTML
 * 如果是 git diff 格式则渲染为 diff 卡片，否则渲染为普通 pre
 */
function renderToolResultAsDiff(resultText) {
    if (!resultText || typeof resultText !== 'string') {
        return `<pre style="font-size:12px;white-space:pre-wrap;word-break:break-all;margin:0;color:var(--text-primary);max-height:400px;overflow-y:auto;">${escapeHtml(resultText || '')}</pre>`;
    }
    
    if (!isGitDiff(resultText)) {
        return `<pre style="font-size:12px;white-space:pre-wrap;word-break:break-all;margin:0;color:var(--text-primary);max-height:400px;overflow-y:auto;">${escapeHtml(resultText)}</pre>`;
    }
    
    // 解析 git diff
    const diffData = parseGitDiff(resultText);
    const stats = diffData.stats;
    
    // 构建 diff 卡片 HTML
    let html = '<div class="diff-card expanded" style="margin:0;">';
    html += '<div class="diff-header" style="cursor:pointer;">';
    html += '<span class="diff-filename">git diff</span>';
    html += '<span class="diff-stats"><span class="diff-add">+' + stats.added + '</span> <span class="diff-del">-' + stats.removed + '</span></span>';
    html += '<span class="diff-toggle">▼</span>';
    html += '</div>';
    html += '<div class="diff-body" style="display:block;max-height:400px;">';
    
    // 过滤上下文：保留变更行前后各3行
    const CONTEXT = 3;
    const showIndices = new Set();
    diffData.lines.forEach((line, i) => {
        if (line.type !== 'ctx' || (line.line === '' && line.content.startsWith('diff'))) {
            // 文件头行总是显示
            if (line.line === '' && (line.content.startsWith('diff') || line.content.startsWith('index') || line.content.startsWith('---') || line.content.startsWith('+++') || line.content.startsWith('@@'))) {
                showIndices.add(i);
            } else if (line.type !== 'ctx') {
                for (let j = Math.max(0, i - CONTEXT); j <= Math.min(diffData.lines.length - 1, i + CONTEXT); j++) {
                    showIndices.add(j);
                }
            }
        }
    });
    // 确保 hunk header 行也显示
    diffData.lines.forEach((line, i) => {
        if (line.line === '' && line.content.startsWith('@@')) {
            showIndices.add(i);
        }
    });
    
    let lastShown = -1;
    for (let i = 0; i < diffData.lines.length; i++) {
        const line = diffData.lines[i];
        if (!showIndices.has(i)) continue;
        if (lastShown >= 0 && i - lastShown > 1) {
            html += '<div class="confirm-diff-sep"></div>';
        }
        lastShown = i;
        
        if (line.line === '' && (line.content.startsWith('diff') || line.content.startsWith('index') || line.content.startsWith('---') || line.content.startsWith('+++') || line.content.startsWith('@@') || line.content.startsWith('\\'))) {
            // 元数据行：灰色斜体
            html += '<div class="diff-line ctx" style="opacity:0.6;font-style:italic;"><span class="diff-num"></span><span class="diff-code">' + escapeHtml(line.content) + '</span></div>';
        } else {
            const cls = line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : 'ctx';
            const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
            html += '<div class="diff-line ' + cls + '"><span class="diff-num">' + (line.line != null && line.line !== '' ? line.line : '') + '</span><span class="diff-code">' + prefix + ' ' + escapeHtml(line.content != null ? line.content : '') + '</span></div>';
        }
    }
    
    html += '</div></div>';
    
    return html;
}

// 版本号比较：返回 >0 表示 a>b，<0 表示 a<b，0 表示相等
function compareVersions(a, b) {
    const pa = a.replace(/^v/, '').split('.');
    const pb = b.replace(/^v/, '').split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = parseInt(pa[i] || '0', 10);
        const nb = parseInt(pb[i] || '0', 10);
        if (na !== nb) return na - nb;
    }
    return 0;
}

// 文件传输进度条（固定显示，不闪烁）
function showTransferProgress(fileName, percent) {
    let el = document.getElementById('transferProgressToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'transferProgressToast';
        el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.95);color:#fff;padding:10px 20px;border-radius:12px;z-index:10000;min-width:200px;max-width:80vw;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        el.innerHTML = '<div style="margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📤 <span class="tp-name"></span></div><div style="background:rgba(255,255,255,0.2);border-radius:4px;height:6px;overflow:hidden;"><div class="tp-bar" style="height:100%;background:#4CAF50;border-radius:4px;transition:width 0.2s;"></div></div><div class="tp-percent" style="text-align:center;margin-top:4px;font-size:12px;color:#aaa;"></div>';
        document.body.appendChild(el);
    }
    el.querySelector('.tp-name').textContent = fileName;
    el.querySelector('.tp-bar').style.width = percent + '%';
    el.querySelector('.tp-percent').textContent = percent + '%';
    el.style.display = 'block';
}
function hideTransferProgress() {
    const el = document.getElementById('transferProgressToast');
    if (el) el.remove();
}

// 显示 Toast 提示（统一函数）
// type: 'default' 使用 .toast-message 样式，'swipe' 使用 .swipe-toast 样式
// position: 'bottom' 底部显示，'top' 顶部显示
function showToast(message, duration = 2000, type = 'default', position = 'bottom') {
    const className = type === 'swipe' ? 'swipe-toast' : 'toast-message';
    let toast = document.querySelector('.' + className);

    if (!toast) {
        toast = document.createElement('div');
        toast.className = className;
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('show');

    // 设置位置
    if (className === 'toast-message') {
        if (position === 'top') {
            toast.classList.add('top');
        } else {
            toast.classList.remove('top');
        }
    }

    // 清除之前的定时器（如果存在）
    if (toast.hideTimer) {
        clearTimeout(toast.hideTimer);
    }

    // 自动隐藏
    toast.hideTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// 显示/隐藏设置弹窗
function showSettings() {
    console.log('[动画锁] showSettings', Date.now());
    // 更新知识库设置 UI
    if (knowledgeBaseSwitch) {
        knowledgeBaseSwitch.checked = knowledgeBaseEnabled;
    }
    if (maxKnowledgeChunksInput) {
        maxKnowledgeChunksInput.value = maxKnowledgeChunks;
    }
    if (maxKeywordChunksInput) {
        maxKeywordChunksInput.value = maxKeywordChunks;
    }

    // 更新自定义选择器显示
    updateAIProviderSelectDisplay();
    updateModelSelectDisplay();

    // 更新获取KEY按钮状态
    updateGetApiKeyBtnState();

    settingsModal.classList.add('active');
}

// 带动画打开设置页（从主界面）
function showSettingsWithFade(callback) {
    console.log('[动画锁] showSettingsWithFade', Date.now());
    // 更新设置UI
    if (knowledgeBaseSwitch) knowledgeBaseSwitch.checked = knowledgeBaseEnabled;
    if (maxKnowledgeChunksInput) maxKnowledgeChunksInput.value = maxKnowledgeChunks;
    if (maxKeywordChunksInput) maxKeywordChunksInput.value = maxKeywordChunks;
    updateAIProviderSelectDisplay();
    updateModelSelectDisplay();
    updateGetApiKeyBtnState();

    const settingsInner = settingsModal.querySelector('.modal.fullscreen-modal');
    settingsModal.classList.add('active');
    fadeOutMain();
    // 设置页从右滑入
    settingsInner.style.transition = 'none';
    settingsInner.style.transform = 'translateX(30%)';
    void settingsInner.offsetHeight;
    settingsInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    settingsInner.style.transform = 'translateX(0)';
    currentPanel = settingsInner;

    // 动画结束后执行回调
    if (callback) {
        setTimeout(() => callback(), 300);
    }
}
function hideSettings() {
    console.log('[动画锁] hideSettings', Date.now());
    const settingsInner = settingsModal.querySelector('.modal.fullscreen-modal');
    if (!settingsModal || !settingsModal.classList.contains('active')) return;

    // 先显示侧边栏（初始位置在左侧外）
    topicDrawer.classList.add('active');
    topicDrawerOverlay.classList.add('active');
    document.body.classList.add('drawer-open');

    // 设置页向右滑出+淡出
    settingsInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease';
    settingsInner.style.transform = 'translateX(10%)';
    settingsInner.style.opacity = '0';
    // 侧边栏从左滑入
    topicDrawer.style.transition = 'none';
    topicDrawer.style.transform = 'translateX(-10%)';
    void topicDrawer.offsetHeight;
    topicDrawer.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    topicDrawer.style.transform = 'translateX(0)';
    setTimeout(() => {
        settingsModal.classList.remove('active');
        settingsInner.style.transition = '';
        settingsInner.style.transform = '';
        settingsInner.style.opacity = '';
        topicDrawer.style.transition = '';
        topicDrawer.style.transform = '';
        topicDrawer.style.opacity = '';
    }, 250);
    panelStack.pop(); // 弹出 topicDrawer
    currentPanel = topicDrawer;
    // 重新应用聊天背景
    const currentAgent = agents.find(a => a.id === currentAgentId);
    if (currentAgent) applyChatBackground(currentAgent);
}

// 保存设置
// ============ 实时保存单项设置函数 ============

function saveApiKey() {
    const newApiKey = apiKeyInput.value.trim();
    apiKeys[currentAIProvider] = newApiKey;
    apiKey = newApiKey;
    localStorage.setItem('cnai_api_keys', JSON.stringify(apiKeys));
    updateGetApiKeyBtnState();
}

function saveAIProvider(provider) {
    const oldProvider = currentAIProvider;
    currentAIProvider = provider;
    localStorage.setItem('cnai_ai_provider', currentAIProvider);
    apiKey = apiKeys[currentAIProvider] || '';
    apiKeyInput.value = apiKey;
    updateGetApiKeyBtnState();
    updateModelOptions();
    updateSessionCacheVisibility();
    updateGetApiKeyBtnState();
    // 恢复该服务商的模型选择
    selectedModel = selectedModelsByProvider[currentAIProvider] || modelSelect.options[0]?.value || '';
    modelSelect.value = selectedModel;
    updateModelSelectDisplay();
    localStorage.setItem('cnai_model', selectedModel);
    updateCurrentModelName();
    // 恢复该服务商的深度思考设置
    deepThinkingEnabled = deepThinkingByProvider[currentAIProvider] || false;
    deepThinkingSwitch.checked = deepThinkingEnabled;
    updateDeepThinkingToggleBtn();
    // 恢复该服务商的自定义请求体
    customRequestBody = localStorage.getItem(`cnai_custom_request_body_${currentAIProvider}`) || '';
    customRequestBodyInput.value = customRequestBody;
    customBodyError.style.display = 'none';
}

function saveModel(model) {
    selectedModelsByProvider[currentAIProvider] = model;
    localStorage.setItem('cnai_selected_models_by_provider', JSON.stringify(selectedModelsByProvider));
    selectedModel = model;
    localStorage.setItem('cnai_model', selectedModel);
    updateCurrentModelName();
}

function saveStreamOutput() {
    streamOutputEnabled = streamOutputSwitch.checked;
    localStorage.setItem('cnai_stream_output', streamOutputEnabled);
}

function saveDeepThinking() {
    deepThinkingEnabled = deepThinkingSwitch.checked;
    deepThinkingByProvider[currentAIProvider] = deepThinkingEnabled;
    localStorage.setItem('cnai_deep_thinking_by_provider', JSON.stringify(deepThinkingByProvider));
    updateDeepThinkingToggleBtn();
}

function _recalcCacheOptimizeCount(limit) {
    if (limit >= 100) {
        cacheOptimizeCount = limit - 50;
    } else {
        cacheOptimizeCount = Math.floor(limit / 2);
    }
    localStorage.setItem('cnai_cache_optimize_count', cacheOptimizeCount);
}

function saveContextLimitNormal() {
    const old = contextLimitNormal;
    contextLimitNormal = parseInt(contextLimitNormalInput.value) || 100;
    localStorage.setItem('cnai_context_limit_normal', contextLimitNormal);
    if (contextLimitNormal !== old) {
        contextLimit = contextLimitNormal;
        _recalcCacheOptimizeCount(contextLimit);
    }
}

function saveContextLimitExpert() {
    const old = contextLimitExpert;
    contextLimitExpert = parseInt(contextLimitExpertInput.value) || 30;
    localStorage.setItem('cnai_context_limit_expert', contextLimitExpert);
    if (contextLimitExpert !== old) {
        contextLimit = contextLimitExpert;
        _recalcCacheOptimizeCount(contextLimit);
    }
}

function savePageSize() {
    let val = parseInt(pageSizeInput.value) || 1000;
    val = Math.max(20, Math.min(5000, val));
    PAGE_SIZE = val;
    pageSizeInput.value = val;
    localStorage.setItem('cnai_page_size', val);
}

function saveMaxTokens() {
    maxTokens = parseInt(maxTokensInput.value) || 4096;
    localStorage.setItem('cnai_max_tokens', maxTokens);
}

function saveTemperature() {
    temperature = parseFloat(temperatureInput.value);
    if (isNaN(temperature) || temperature < 0) temperature = 0;
    if (temperature > 2) temperature = 2;
    localStorage.setItem('cnai_temperature', temperature);
    temperatureInput.value = temperature;
}

function saveTopP() {
    topP = parseFloat(topPInput.value);
    if (isNaN(topP) || topP < 0) topP = 0;
    if (topP > 1) topP = 1;
    localStorage.setItem('cnai_top_p', topP);
    topPInput.value = topP;
}

function saveFontSize() {
    messageFontSize = parseInt(fontSizeInput.value) || 16;
    if (messageFontSize < 12) messageFontSize = 12;
    if (messageFontSize > 24) messageFontSize = 24;
    localStorage.setItem('cnai_message_font_size', messageFontSize);
    applyMessageFontSize();
}

function saveShowUsageInfo() {
    showUsageInfoEnabled = showUsageInfoSwitch.checked;
    localStorage.setItem('cnai_show_usage_info', showUsageInfoEnabled);
    applyUsageInfoVisibility();
}

function saveCustomRequestBody() {
    const customBodyValue = customRequestBodyInput.value.trim();
    if (customBodyValue) {
        try {
            JSON.parse(customBodyValue);
            customRequestBody = customBodyValue;
            localStorage.setItem(`cnai_custom_request_body_${currentAIProvider}`, customRequestBody);
            customBodyError.style.display = 'none';
        } catch (e) {
            customBodyError.style.display = 'block';
        }
    } else {
        customRequestBody = '';
        localStorage.setItem(`cnai_custom_request_body_${currentAIProvider}`, '');
        customBodyError.style.display = 'none';
    }
}

function saveCacheOptimize() {
    cacheOptimizeEnabled = cacheOptimizeSwitch.checked;
    localStorage.setItem('cnai_cache_optimize', cacheOptimizeEnabled);
    if (cacheOptimizeEnabled) {
        _recalcCacheOptimizeCount(contextLimit);
    }
}

function saveRestoreLastTopic() {
    restoreLastTopic = restoreLastTopicSwitch.checked;
    localStorage.setItem('cnai_restore_last_topic', restoreLastTopic);
}

function saveAutoGenerateTopicName() {
    autoGenerateTopicName = autoGenerateTopicNameSwitch.checked;
    localStorage.setItem('cnai_auto_generate_topic_name', autoGenerateTopicName);
}

function saveTopicNamePrompt() {
    topicNamePrompt = topicNamePromptInput ? topicNamePromptInput.value.trim() : '';
    localStorage.setItem('cnai_topic_name_prompt', topicNamePrompt);
}

function saveLockPortrait() {
    lockPortrait = lockPortraitSwitch.checked;
    localStorage.setItem('cnai_lock_portrait', lockPortrait);
    if (window.AndroidBridge && typeof AndroidBridge.setLockPortrait === 'function') {
        AndroidBridge.setLockPortrait(lockPortrait);
    }
}

// ==================== 生成期间不熄屏 ====================
var keepScreenOnEnabled = localStorage.getItem('cnai_keep_screen_on') === 'true';

function saveKeepScreenOn() {
    keepScreenOnEnabled = keepScreenOnSwitch.checked;
    localStorage.setItem('cnai_keep_screen_on', keepScreenOnEnabled);
}

// 请求保持屏幕常亮
function requestKeepScreenOn() {
    if (!keepScreenOnEnabled) return;
    try {
        if (navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
            navigator.wakeLock.request('screen').then(wl => {
                window._wakeLock = wl;
            }).catch(e => {
                console.warn('[keepScreenOn] wakeLock failed:', e);
            });
        }
    } catch (e) {
        console.warn('[keepScreenOn] request error:', e);
    }
}

// 释放屏幕常亮
function releaseKeepScreenOn() {
    if (window._wakeLock) {
        window._wakeLock.release().catch(() => {});
        window._wakeLock = null;
    }
}

function saveAutoCompressImage() {
    autoCompressImageEnabled = autoCompressImageSwitch.checked;
    localStorage.setItem('cnai_auto_compress_image', autoCompressImageEnabled);
    if (autoCompressImageEnabled) {
        showCompressConfigSheet();
    }
    updateCompressDesc();
}

function updateCompressDesc() {
    const desc = document.getElementById('autoCompressImageDesc');
    if (desc) {
        desc.textContent = `开启后，超过${compressThresholdMB}MB的图片在发送前自动压缩到${compressTargetSizeMB}MB以下，节省token`;
    }
}

// 弹出底部面板让用户配置压缩参数
function showCompressConfigSheet() {
    const content = document.createElement('div');
    content.innerHTML = `
        <div class="bs-input-wrapper" style="margin-bottom:16px;">
            <label style="font-size:14px;color:var(--text-primary);font-weight:600;display:block;margin-bottom:8px;">压缩开启阈值</label>
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="number" id="bs_compressThreshold" class="bs-input" min="0.1" max="10" step="0.1" value="${compressThresholdMB}" style="flex:none;width:90px;padding:10px 14px;font-size:15px;">
                <span style="font-size:13px;color:var(--text-secondary);">MB（图片超过此大小才压缩）</span>
            </div>
        </div>
        <div class="bs-input-wrapper" style="margin-bottom:16px;">
            <label style="font-size:14px;color:var(--text-primary);font-weight:600;display:block;margin-bottom:8px;">目标大小</label>
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="number" id="bs_compressTarget" class="bs-input" min="0.1" max="10" step="0.1" value="${compressTargetSizeMB}" style="flex:none;width:90px;padding:10px 14px;font-size:15px;">
                <span style="font-size:13px;color:var(--text-secondary);">MB（压缩后尽量不超过此大小）</span>
            </div>
        </div>
        <div class="bs-btn-row" style="padding-bottom:16px;">
            <button type="button" class="secondary-btn" id="bs_compressCancel">取消</button>
            <button type="button" class="bs-confirm-btn" id="bs_compressConfirm">确定</button>
        </div>
    `;

    const sheet = createBottomSheetPanel({
        title: '压缩参数设置',
        content: content
    });

    sheet.show();

    // 绑定按钮事件
    setTimeout(() => {
        const confirmBtn = sheet.contentEl.querySelector('#bs_compressConfirm');
        const cancelBtn = sheet.contentEl.querySelector('#bs_compressCancel');

        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const thresholdInput = sheet.contentEl.querySelector('#bs_compressThreshold');
                const targetInput = sheet.contentEl.querySelector('#bs_compressTarget');

                let thresholdVal = parseFloat(thresholdInput.value);
                if (isNaN(thresholdVal) || thresholdVal < 0.1) thresholdVal = 0.1;
                if (thresholdVal > 10) thresholdVal = 10;

                let targetVal = parseFloat(targetInput.value);
                if (isNaN(targetVal) || targetVal < 0.1) targetVal = 0.1;
                if (targetVal > 10) targetVal = 10;

                compressThresholdMB = thresholdVal;
                compressTargetSizeMB = targetVal;
                localStorage.setItem('cnai_compress_threshold_mb', thresholdVal);
                localStorage.setItem('cnai_compress_target_mb', targetVal);
                updateCompressDesc();
                sheet.hide();
                showToast('压缩参数已保存');
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                sheet.hide();
            });
        }
    }, 0);
}

function saveSessionCache() {
    if (currentAIProvider === 'doubao') {
        const oldSessionCacheEnabled = sessionCacheEnabled;
        sessionCacheEnabled = sessionCacheSwitch.checked;
        localStorage.setItem('doubao_session_cache_enabled', sessionCacheEnabled);
        if (!sessionCacheEnabled) {
            forceFirstSend = 0;
        }
        if (!oldSessionCacheEnabled && sessionCacheEnabled) {
            forceFirstSend = 1;
            console.log('Session 缓存重新开启，下次发送将为首次发送');
        }
    } else if (currentAIProvider === 'qwen') {
        const oldQwenSessionEnabled = qwenSessionEnabled;
        qwenSessionEnabled = sessionCacheSwitch.checked;
        localStorage.setItem('qwen_session_enabled', qwenSessionEnabled);
        if (!qwenSessionEnabled) {
            qwenForceFirstSend = 0;
        }
        if (!oldQwenSessionEnabled && qwenSessionEnabled) {
            qwenForceFirstSend = 1;
            console.log('千问 Session 模式重新开启，下次发送将为首次发送');
        }
    }
}

function saveSessionExpire() {
    const expireInputValue = parseInt(sessionExpireInput.value);
    sessionExpireHours = Math.max(1, Math.min(168, expireInputValue || 24));
    sessionExpireInput.value = sessionExpireHours;
    localStorage.setItem('doubao_session_expire_hours', sessionExpireHours);
}

function saveKnowledgeBase() {
    knowledgeBaseEnabled = knowledgeBaseSwitch.checked;
    localStorage.setItem('cnai_knowledge_base_enabled', knowledgeBaseEnabled);
}

function saveMaxKnowledgeChunks() {
    maxKnowledgeChunks = parseInt(maxKnowledgeChunksInput.value) || 3;
    if (maxKnowledgeChunks < 1) maxKnowledgeChunks = 1;
    if (maxKnowledgeChunks > 10) maxKnowledgeChunks = 10;
    localStorage.setItem('cnai_max_knowledge_chunks', maxKnowledgeChunks);
    maxKnowledgeChunksInput.value = maxKnowledgeChunks;
}

function saveMaxKeywordChunks() {
    maxKeywordChunks = parseInt(maxKeywordChunksInput?.value) || 1;
    if (maxKeywordChunks < 1) maxKeywordChunks = 1;
    if (maxKeywordChunks > 10) maxKeywordChunks = 10;
    localStorage.setItem('cnai_max_keyword_chunks', maxKeywordChunks);
    if (maxKeywordChunksInput) maxKeywordChunksInput.value = maxKeywordChunks;
}

function saveWebSearch() {
    webSearchEnabled = webSearchSwitch.checked;
    localStorage.setItem('cnai_web_search', webSearchEnabled);
}

// 恢复用户消息中的图片数据（用于重发/刷新时恢复图片）
function restoreImagesInMessage(msg) {
    if (msg.role === 'user' && msg.timestamp) {
        const messageKey = 'user_' + msg.timestamp;
        const images = sentImagesByMessage[messageKey];

        // 如果有图片数据，重构为多模态格式
        if (images && images.length > 0) {
            const multimodalContent = [];

            // 添加文本内容
            const textContent = typeof msg.content === 'string' ? msg.content :
                (Array.isArray(msg.content) ? msg.content.find(item => item.type === 'text' || item.type === 'input_text')?.text : '');

            // 千问 Responses API 格式 或 豆包 Responses API 格式
            if (currentAIProvider === 'qwen' || currentAIProvider === 'doubao') {
                // 先添加图片
                for (const img of images) {
                    multimodalContent.push({
                        type: 'input_image',
                        image_url: img.base64
                    });
                }
                // 再添加文本
                if (textContent) {
                    multimodalContent.push({ type: 'input_text', text: textContent });
                }
            } else {
                // 其他提供商 Chat Completions API 格式
                if (textContent) {
                    multimodalContent.push({ type: 'text', text: textContent });
                }
                for (const img of images) {
                    multimodalContent.push({
                        type: 'image_url',
                        image_url: { url: img.base64 }
                    });
                }
            }

            return { role: msg.role, content: multimodalContent };
        }
    }
    return { role: msg.role, content: msg.content };
}

// 发送前压缩请求体中的所有图片（包括历史消息中的图片）
// 自动压缩开启时，遍历 messages 数组中所有图片数据，超阈值的压缩到目标大小
async function compressImagesInRequestBody(requestBody) {
    if (!autoCompressImageEnabled) return;

    // 找到 messages 数组（OpenAI 兼容格式）或 input 数组（Responses API 格式）
    const msgArray = requestBody.messages || requestBody.input;
    if (!msgArray || !Array.isArray(msgArray)) return;

    for (const msg of msgArray) {
        if (!Array.isArray(msg.content)) continue;

        for (const part of msg.content) {
            // 提取 base64 URL
            let imageUrl = null;
            if (part.type === 'image_url' && part.image_url) {
                imageUrl = part.image_url.url;
            } else if (part.type === 'input_image') {
                imageUrl = part.image_url;
            }

            if (!imageUrl || !imageUrl.startsWith('data:')) continue;

            // 估算大小
            const base64Data = imageUrl.split(',')[1] || '';
            const estimatedBytes = Math.floor(base64Data.length * 0.75);

            if (estimatedBytes <= compressThresholdMB * 1024 * 1024) continue;

            // 需要压缩
            try {
                const blob = dataURLtoBlob(imageUrl);
                if (!blob) continue;

                const result = await compressImageUtil(blob, {
                    quality: 0.8,
                    maxSizeMB: compressTargetSizeMB
                });

                // 替换为压缩后的 base64
                if (part.type === 'image_url') {
                    part.image_url.url = result.base64;
                } else {
                    part.image_url = result.base64;
                }

                const originalKB = (estimatedBytes / 1024).toFixed(0);
                const compressedKB = (result.size / 1024).toFixed(0);
                console.log(`[自动压缩] 历史图片: ${originalKB}KB → ${compressedKB}KB`);
            } catch (err) {
                console.error('[自动压缩] 历史图片压缩失败:', err);
            }
        }
    }
}

// 合并自定义请求体参数
function mergeCustomRequestBody(requestBody) {
    if (!customRequestBody || !customRequestBody.trim()) {
        return requestBody;
    }
    try {
        const customParams = JSON.parse(customRequestBody);
        // 深度合并：自定义参数会覆盖默认参数
        return { ...requestBody, ...customParams };
    } catch (e) {
        console.warn('自定义请求体参数解析失败:', e);
        return requestBody;
    }
}

// 按轮数获取消息（从后往前找 rounds 个 user 消息，包含中间所有 tool 消息）
function getMessagesByRounds(msgs, rounds) {
    if (rounds <= 0 || msgs.length === 0) return [];
    let userCount = 0;
    let startIndex = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') {
            userCount++;
            if (userCount >= rounds) {
                startIndex = i;
                break;
            }
        }
    }
    if (userCount < rounds) return msgs.slice();
    return msgs.slice(startIndex);
}

// 构建请求体
// targetMessage: 可选，刷新/重发时的目标消息对象
// knowledgeContext: 可选，知识库检索内容（添加到最新用户消息中，不在界面展示）
function buildRequestBody(systemPrompt = null, targetMessage = null, knowledgeContext = null, truncateBeforeId = null) {
    // 检查是否有用户选定的上下文
    const selectedContext = getContextForSending();

    // 获取当前时间线上可见的消息（过滤掉被版本切换隐藏的消息）
    let visibleMessages = getVisibleTimelineMessages();

    // 重发模式：只发送到指定ID的消息（含），截断后续
    if (truncateBeforeId !== null) {
        const truncIdx = visibleMessages.findIndex(m => m.id === truncateBeforeId);
        if (truncIdx >= 0) {
            visibleMessages = visibleMessages.slice(0, truncIdx + 1);
        }
    }

    let recentMessages;
    let contextForMemory = null; // 用于"记忆内容"模式的上下文
    let shouldForceFirstSend = false; // 是否需要强制首轮发送

    if (selectedContext && selectedContext.length > 0) {
        if (contextSelectionMode === 'independent') {
            // 作为独立片段：只发送选中的上下文 + 用户最新消息
            const latestUserMessage = visibleMessages[visibleMessages.length - 1];
            if (latestUserMessage && latestUserMessage.role === 'user') {
                recentMessages = [...selectedContext, latestUserMessage];
            } else {
                recentMessages = selectedContext;
            }
            console.log('使用独立片段模式，共', recentMessages.length, '条消息');
        } else {
            // 作为记忆内容：选中的上下文放在 system 下方，然后拼接传统历史消息
            contextForMemory = selectedContext;
            // 强制首轮发送，确保记忆内容生效
            shouldForceFirstSend = true;
            // 使用传统方式获取历史消息
            let effectiveCount = cacheOptimizeCount;
            if (skipNextCountUpdate) {
                effectiveCount = Math.max(1, cacheOptimizeCount - 1);
            }
            if (cacheOptimizeEnabled) {
                recentMessages = getMessagesByRounds(visibleMessages, effectiveCount);
            } else {
                recentMessages = getMessagesByRounds(visibleMessages, contextLimit);
            }
            console.log('使用记忆内容模式，记忆', contextForMemory.length, '条，历史', recentMessages.length, '条');
        }
    } else {
        // 缓存命中优化：根据 cacheOptimizeCount 决定上传的消息数量
        let effectiveCount = cacheOptimizeCount;
        // 如果是刷新回答或重新发送，使用计数-1（保持与上次上传数量一致）
        if (skipNextCountUpdate) {
            effectiveCount = Math.max(1, cacheOptimizeCount - 1);
        }

        if (cacheOptimizeEnabled) {
            // 按轮数获取消息（一轮包含 user + assistant + tool 等所有相关消息）
            recentMessages = getMessagesByRounds(visibleMessages, effectiveCount);
        } else {
            // 未开启缓存优化，使用上下文限制
            recentMessages = getMessagesByRounds(visibleMessages, contextLimit);
        }
    }

    console.log('[上下文] cacheOptimizeCount:', cacheOptimizeCount, '| contextLimit:', contextLimit, '| 实际发送轮数:', cacheOptimizeEnabled ? (skipNextCountUpdate ? Math.max(1, cacheOptimizeCount - 1) : cacheOptimizeCount) : contextLimit, '| 专家模式:', (typeof expertModeEnabled !== 'undefined' ? expertModeEnabled : localStorage.getItem('cnai_expert_mode') === '1'));

    // 获取系统提示词
    const agent = getCurrentAgent();
    let systemContent = agent.systemPrompt || '';
    if (systemPrompt) {
        systemContent = systemContent ? `${systemContent}\n\n${systemPrompt}` : systemPrompt;
    }
    // 将智能体名称拼接到系统提示词中
    if (agent.name) {
        systemContent = systemContent
            ? `你的智能体名称是${agent.name}。\n\n${systemContent}`
            : `你的智能体名称是${agent.name}。`;
    }
    // 注入工作目录和专家模式相关提示词
    const workPath = localStorage.getItem('cnai_work_path');
    const _expertMode = typeof expertModeEnabled !== 'undefined' ? expertModeEnabled : localStorage.getItem('cnai_expert_mode') === '1';
    if (_expertMode && workPath) {
        systemContent += `\n\n当前工作目录：${workPath}`;
    }
    const pcWorkPath = localStorage.getItem('cnai_pc_work_path');
    if (_expertMode && pcWorkPath) {
        systemContent += `\n\n电脑端工作目录：${pcWorkPath}`;
    }
    if (_expertMode) {
        systemContent += '\n\n你运行在 Android 手机端（小蓝AI盒子 App）。';
        const downloadsPath = (window.AndroidBridge && window.AndroidBridge.getDownloadsPath) ? window.AndroidBridge.getDownloadsPath() : 'Downloads';
        systemContent += `\n\n## 笔记本\n笔记存储在 ${downloadsPath}/Bluox/Notes 目录中。用户可以通过笔记本功能记录信息，你也可以通过工具读写笔记。`;
        systemContent += `\n\n## Skills\nSkills 存储在 ${downloadsPath}/Bluox/Skills 目录中，每个子目录是一个 skill。Skill 有两种类型：\n1. **可执行工具**：目录下有 SKILL.md（含 YAML 头定义 name/description/parameters）和 execute.sh，会自动注册为工具供你调用。\n2. **参考文档**：目录下只有 SKILL.md（无 runtime/parameters 字段），你需要主动读取其内容作为参考。\n\n你可以用 read_file 或 list_directory 浏览 Skills 目录，了解当前可用的 skill。`;
        systemContent += '\n\n## 数学计算工具\n你可以使用 math_calculate 工具进行精确数学计算。支持：四则运算、三角函数、求导（derivative）、方程求解（solve）、定积分（integrate）、矩阵运算、行列式（det）、统计、单位换算、复数运算等。遇到数学问题时，务必使用此工具确保结果精确。';
        systemContent += '\n\n## 数据可视化工具\n你可以使用 generate_chart 工具生成数据可视化图表。传入 ECharts option 配置即可生成折线图、柱状图、饼图、散点图、雷达图、热力图等。工具会返回 chartId，你需要在回复文本中用 [chart:chartId] 嵌入图表，图表会直接展示给用户。';
        
    }

    const apiMessages = [];

    // 系统提示词放在所有消息的最上层
    if (systemContent) {
        apiMessages.push({ role: 'system', content: systemContent });
    }

    // 如果是"记忆内容"模式，在 system 下方插入选中的上下文
    if (contextForMemory && contextForMemory.length > 0) {
        apiMessages.push(...contextForMemory.map(msg => ({
            role: msg.role,
            content: msg.content
        })));
    }

    // 添加所有对话历史（恢复图片数据）
    apiMessages.push(...recentMessages.map(msg => {
        const restored = restoreImagesInMessage(msg);
        const apiMsg = { role: restored.role, content: restored.content };
        // 如果有版本，用当前版本的属性
        const currentVer = (msg.versions && msg.versions.length > 0)
            ? msg.versions[msg.currentVersionIndex || 0] : null;
        // 保留 tool_calls 和 tool_call_id（仅当前版本有才带）
        // 如果有版本系统，只用当前版本的 tool_calls，不 fallback 到消息本身
        // 因为消息本身的 tool_calls 可能属于其他版本，对应的 tool 响应消息不在当前时间线上
        const effectiveToolCalls = currentVer ? (currentVer.tool_calls || null) : msg.tool_calls;
        if (effectiveToolCalls) {
            apiMsg.tool_calls = effectiveToolCalls;
        }
        if (msg.tool_call_id) apiMsg.tool_call_id = msg.tool_call_id;
        if (msg.name) apiMsg.name = msg.name;
        // DeepSeek/Kimi 深度思考模式要求 assistant 消息带 reasoning_content
        if (msg.role === 'assistant' && ['deepseek', 'kimi'].includes(currentAIProvider)) {
            apiMsg.reasoning_content = msg.reasoning || '';
        }
        return apiMsg;
    }));

    // 知识库检索内容：添加到最新用户消息中（仅在请求体中，不在界面展示）
    if (knowledgeContext) {
        // 找到最后一条用户消息的索引
        for (let i = apiMessages.length - 1; i >= 0; i--) {
            if (apiMessages[i].role === 'user') {
                const knowledgePrompt = `以下是从知识库中检索到的相关资料，请参考这些内容回答用户问题：\n\n${knowledgeContext}\n\n---\n\n用户问题：`;
                const msg = apiMessages[i];
                // 处理不同类型的消息内容
                if (typeof msg.content === 'string') {
                    msg.content = knowledgePrompt + msg.content;
                } else if (Array.isArray(msg.content)) {
                    // 多模态消息，找到文本部分并添加知识库内容
                    const textPart = msg.content.find(part => part.type === 'text' || part.type === 'input_text');
                    if (textPart) {
                        textPart.text = knowledgePrompt + textPart.text;
                    }
                }
                console.log('知识库检索内容已添加到最新用户消息中');
                break;
            }
        }
    }

    // 根据不同 AI 企业构建不同的请求体
    // 自定义服务商处理
    if (currentAIProvider.startsWith('custom_')) {
        const provider = customProviders.find(p => p.id === currentAIProvider);
        if (provider) {
            if (provider.apiType === 'responses') {
                // Responses API 格式
                const systemMessage = apiMessages.find(msg => msg.role === 'system');
                const userMessages = apiMessages.filter(msg => msg.role !== 'system');
                return mergeCustomRequestBody({
                    model: selectedModel,
                    input: systemMessage ? [systemMessage, ...userMessages] : userMessages,
                    max_output_tokens: maxTokens,
                    temperature: temperature,
                    top_p: topP,
                    stream: streamOutputEnabled
                });
            } else {
                // OpenAI 兼容格式
                const _useTools = typeof isToolCallingActive === 'function' && isToolCallingActive();
                return mergeCustomRequestBody({
                    model: selectedModel,
                    messages: apiMessages,
                    max_tokens: maxTokens,
                    temperature: temperature,
                    top_p: topP,
                    stream: streamOutputEnabled,
                    ...(_useTools && typeof getToolDefinitions === 'function' && getToolDefinitions() ? { tools: getToolDefinitions() } : {})
                });
            }
        }
    }

    if (currentAIProvider === 'deepseek') {
        // DeepSeek 使用 thinking.type 参数控制深度思考，reasoning_effort 控制思考强度
        // 注意：开启 tools 时需关闭 thinking（DeepSeek 限制）
        const _useTools = typeof isToolCallingActive === 'function' && isToolCallingActive();
        return mergeCustomRequestBody({
            model: selectedModel,
            messages: apiMessages,
            max_tokens: maxTokens,
            temperature: temperature,
            top_p: topP,
            stream: streamOutputEnabled,
            thinking: {
                type: (deepThinkingEnabled && !_useTools) ? "enabled" : "disabled"
            },
            ...((deepThinkingEnabled && !_useTools) && {
                reasoning_effort: deepseekReasoningEffort
            }),
            ...(_useTools && typeof getToolDefinitions === 'function' && getToolDefinitions() ? { tools: getToolDefinitions() } : {})
        });
    } else if (currentAIProvider === 'mimo') {
        // MiMo 使用 thinking.type 参数控制深度思考
        // MiMo 使用 max_completion_tokens 而非 max_tokens
        // MiMo 支持 OpenAI 兼容的 Function Calling 格式
        const _useTools = typeof isToolCallingActive === 'function' && isToolCallingActive();
        const mimoRequestBody = {
            model: selectedModel,
            messages: apiMessages,
            max_completion_tokens: maxTokens,
            temperature: temperature,
            top_p: topP,
            stream: streamOutputEnabled,
            thinking: {
                type: deepThinkingEnabled ? "enabled" : "disabled"
            }
        };

        // MiMo 联网搜索：优先使用 function calling 方式的 web_search（与其他服务商统一）
        // 如果没有开启 function calling（专家模式/联网搜索），则回退到 MiMo 原生 web_search
        if (!isToolCallingActive() && webSearchEnabled) {
            mimoRequestBody.tools = [{
                type: "web_search",
                max_keyword: 3,
                limit: 10
            }];
        }

        // Function Calling 工具注入（与 DeepSeek/MiniMax 等服务商格式一致）
        if (_useTools && typeof getToolDefinitions === 'function' && getToolDefinitions()) {
            mimoRequestBody.tools = getToolDefinitions();
        }

        return mergeCustomRequestBody(mimoRequestBody);
    } else if (currentAIProvider === 'minimax') {
        // MiniMax 使用 reasoning_split 参数控制深度思考
        // MiniMax 的 temperature 范围是 0-1，需要限制
        // MiniMax 使用 max_completion_tokens 而非 max_tokens
        const minimaxTemperature = Math.min(1, Math.max(0, temperature));
        const _useTools = typeof isToolCallingActive === 'function' && isToolCallingActive();
        const isMinimaxM3 = selectedModel === 'MiniMax-M3';
        return mergeCustomRequestBody({
            model: selectedModel,
            messages: apiMessages,
            max_completion_tokens: maxTokens,
            temperature: minimaxTemperature,
            top_p: topP,
            stream: streamOutputEnabled,
            ...(streamOutputEnabled && {
                stream_options: { include_usage: true }
            }),
            ...(isMinimaxM3
                ? (deepThinkingEnabled
                    ? { reasoning_split: true }
                    : { thinking: { type: "disabled" } })
                : { reasoning_split: true }),
            ...(_useTools && typeof getToolDefinitions === 'function' && getToolDefinitions() ? { tools: getToolDefinitions() } : {})
        });
    } else if (currentAIProvider === 'doubao' || currentAIProvider === 'qwen') {
        // 豆包 或 千问 Responses API
        // Session模式：豆包开启Session缓存 或 千问（千问始终使用session逻辑，只是请求头不同）
        // 注意：独立片段模式下不使用 Session 缓存
        const isSessionMode = ((currentAIProvider === 'doubao' && sessionCacheEnabled) || currentAIProvider === 'qwen')
            && !(selectedContext && selectedContext.length > 0 && contextSelectionMode === 'independent');

        // 提取系统提示词和用户消息（Session模式和普通模式共用）
        const systemMessage = apiMessages.find(msg => msg.role === 'system');
        const userMessages = apiMessages.filter(msg => msg.role !== 'system');

        if (isSessionMode) {
            const previousResponseId = getPreviousResponseId(targetMessage);
            console.log('====== buildRequestBody ======');
            console.log('targetMessage:', targetMessage ? '存在' : '不存在');
            console.log('previousResponseId:', previousResponseId || '无');
            console.log('========================');

            // 基础请求体
            // 注意：豆包/千问不支持 instructions 参数，系统提示词需要放在 input 数组中
            const requestBody = {
                model: selectedModel,
                temperature: temperature,
                top_p: topP,
                stream: streamOutputEnabled
            };
            // 使用自定义工具时需要 store=true（Responses API 要求 store=true 才能用 previous_response_id）
            if (typeof isToolCallingActive === 'function' && isToolCallingActive()) {
                requestBody.store = true;
            }

            // 豆包特有参数
            if (currentAIProvider === 'doubao') {
                const expireAt = Math.floor(Date.now() / 1000) + sessionExpireHours * 3600;
                requestBody.caching = { type: "enabled" };
                // 思维链长度设置
                if (deepThinkingEnabled) {
                    requestBody.thinking = { type: "enabled" };
                    requestBody.reasoning = { effort: doubaoReasoningEffort };
                } else {
                    requestBody.thinking = { type: "disabled" };
                }
                requestBody.expire_at = expireAt;

                // 联网搜索：统一用 function calling 工具（不再用内置 web_search）
                const _useCustomTools = typeof isToolCallingActive === 'function' && isToolCallingActive();
                if (_useCustomTools && typeof getResponsesTools === 'function') {
                    const customTools = getResponsesTools();
                    if (customTools) requestBody.tools = customTools;
                }
            }

            // 千问特有参数
            if (currentAIProvider === 'qwen') {
                requestBody.max_output_tokens = maxTokens;
                requestBody.enable_thinking = deepThinkingEnabled;
                // 思维链长度：50(低)、100(中)、auto(高)
                if (thinkingBudget !== 'auto') {
                    requestBody.thinking_budget = parseInt(thinkingBudget);
                } else {
                    requestBody.thinking_budget = 'auto';
                }

                // 联网搜索：统一用 function calling 工具（不再用内置 web_search）
                const _useCustomTools = typeof isToolCallingActive === 'function' && isToolCallingActive();
                if (_useCustomTools && typeof getResponsesTools === 'function') {
                    const customTools = getResponsesTools();
                    if (customTools) requestBody.tools = customTools;
                }
            }

            // 获取最新的AI消息
            const lastAiMessage = [...recentMessages].reverse().find(msg => msg.role === 'assistant');

            // 获取最新AI消息当前显示版本的 responseId
            let lastAiResponseId = null;
            if (lastAiMessage) {
                if (lastAiMessage.versions && lastAiMessage.versions.length > 0) {
                    const currentIndex = lastAiMessage.currentVersionIndex || 0;
                    lastAiResponseId = lastAiMessage.versions[currentIndex]?.responseId;
                } else {
                    lastAiResponseId = lastAiMessage.responseId;
                }
            }
            const lastAiHasResponseId = !!lastAiResponseId;

            // 豆包/千问 forceFirstSend 逻辑
            // shouldForceFirstSend 用于"记忆内容"模式，强制首轮发送
            const shouldUseFirstSend = shouldForceFirstSend || (currentAIProvider === 'doubao' && forceFirstSend) || (currentAIProvider === 'qwen' && qwenForceFirstSend);

            // 辅助函数：为豆包/千问构建带系统提示词的 input 数组（仅首轮需要）
            const buildInputWithSystem = (msgs) => {
                if ((currentAIProvider === 'doubao' || currentAIProvider === 'qwen') && systemMessage?.content) {
                    // 豆包/千问：系统提示词放在 input 数组第一条
                    // 安全过滤：Responses API 不支持 tool_calls 和 role:tool 消息
                    const _safeMsgs = msgs.filter(m => !m.tool_calls && m.role !== 'tool');
                    return [systemMessage, ..._safeMsgs];
                }
                return msgs;
            };

            // forceFirstSend 为 0 且最新AI消息有 responseId 时 且不为重发/刷新操作，使用后续轮次逻辑
            if (!shouldUseFirstSend && lastAiHasResponseId && targetMessage === null) {
                // 后续轮次：input 为数组（只有当前用户消息）
                // 注意：后续轮次不需要再发送系统提示词，因为已经在缓存中
                // 从 apiMessages 中获取已处理过知识库内容的用户消息
                const lastUserMessageFromApi = [...apiMessages].reverse().find(msg => msg.role === 'user');
                requestBody.input = lastUserMessageFromApi ? [lastUserMessageFromApi] : [];
                requestBody.previous_response_id = lastAiResponseId;
                // 豆包限制：使用 previous_response_id 时不能传 tools（缓存已记住工具定义）
                // 千问支持在 previous_response_id 时传 tools，不删除
                if (currentAIProvider === 'doubao') delete requestBody.tools;
                console.log('使用后续轮次逻辑，previous_response_id:', lastAiResponseId);
            } else if (!shouldUseFirstSend) {
                // 最新AI消息没有 responseId，遍历找上一个有 responseId 的AI消息
                let lastValidResponseId = null;
                let lastValidResponseIndex = -1;

                // 从倒数第二条AI消息开始向前查找
                for (let i = recentMessages.length - 1; i >= 0; i--) {
                    const msg = recentMessages[i];
                    if (msg.role === 'assistant') {
                        // 获取当前显示版本的 responseId
                        let currentResponseId = null;
                        if (msg.versions && msg.versions.length > 0) {
                            const currentIndex = msg.currentVersionIndex || 0;
                            currentResponseId = msg.versions[currentIndex]?.responseId;
                        } else {
                            currentResponseId = msg.responseId;
                        }

                        if (currentResponseId) {
                            lastValidResponseId = currentResponseId;
                            lastValidResponseIndex = i;
                            console.log('找到上一个有responseId的AI消息，索引:', i, 'responseId:', lastValidResponseId);
                            break;
                        }
                    }
                }

                if (lastValidResponseId) {
                    // 从该AI消息之后开始收集消息
                    const messagesToSend = recentMessages.slice(lastValidResponseIndex + 1);
                    if (messagesToSend.length > 0) {
                        // 从 apiMessages 中获取已处理过知识库内容的消息
                        // 找到对应的 apiMessages 索引
                        const apiMessagesToSend = [];
                        const startIndex = lastValidResponseIndex + 1;
                        for (let i = startIndex; i < apiMessages.length; i++) {
                            if (apiMessages[i].role !== 'system') {
                                // 安全过滤：Responses API 不支持 tool_calls 和 role:tool 消息
                                if (apiMessages[i].tool_calls || apiMessages[i].role === 'tool') continue;
                                apiMessagesToSend.push(apiMessages[i]);
                            }
                        }
                        requestBody.input = apiMessagesToSend.length > 0 ? apiMessagesToSend : messagesToSend.map(msg => {
                            const restored = restoreImagesInMessage(msg);
                            return { role: restored.role, content: restored.content };
                        });
                        requestBody.previous_response_id = lastValidResponseId;
                        if (currentAIProvider === 'doubao') delete requestBody.tools;
                        console.log('从索引', lastValidResponseIndex + 1, '开始发送，共', apiMessagesToSend.length, '条消息');
                    } else {
                        // 没有后续消息，只发最新用户消息
                        const lastUserMessageFromApi = [...apiMessages].reverse().find(msg => msg.role === 'user');
                        requestBody.input = lastUserMessageFromApi ? [lastUserMessageFromApi] : [];
                        requestBody.previous_response_id = lastValidResponseId;
                        if (currentAIProvider === 'doubao') delete requestBody.tools;
                        console.log('使用后续轮次逻辑（找到历史responseId），previous_response_id:', lastValidResponseId);
                    }
                } else {
                    // 没有找到任何有效的 responseId，作为首轮发送
                    // 首轮发送需要包含系统提示词
                    requestBody.input = buildInputWithSystem(userMessages);
                    console.log('使用首轮逻辑，发送', requestBody.input.length, '条消息');
                }
            } else {
                // forceFirstSend 为 1，作为首轮发送
                // 首轮发送需要包含系统提示词
                requestBody.input = buildInputWithSystem(userMessages);
                console.log('使用首轮逻辑（forceFirstSend），发送', requestBody.input.length, '条消息');
            }

            // 流式输出时添加 stream_options（仅千问支持）
            if (streamOutputEnabled && currentAIProvider === 'qwen') {
                requestBody.stream_options = { include_usage: true };
            }
            return mergeCustomRequestBody(requestBody);
        }

        // 豆包普通模式：不使用Session缓存，直接发送完整消息
        // 注意：豆包 responses 端点不支持 instructions 参数，系统提示词需要放在 input 数组中
        // 安全过滤：Responses API 不支持 tool_calls 和 role:tool 消息，需要过滤掉
        const _filteredUserMessages = userMessages.filter(m => {
            if (m.role === 'tool') return false;
            if (m.tool_calls) return false;
            return true;
        });
        const doubaoInput = systemMessage?.content
            ? [systemMessage, ..._filteredUserMessages]
            : _filteredUserMessages;
        const requestBody = {
            model: selectedModel,
            input: doubaoInput,
            max_output_tokens: maxTokens,
            temperature: temperature,
            top_p: topP,
            stream: streamOutputEnabled
        };
        // 使用自定义工具时需要 store=true
        if (typeof isToolCallingActive === 'function' && isToolCallingActive()) {
            requestBody.store = true;
        }

        // 思维链长度设置
        if (deepThinkingEnabled) {
            requestBody.thinking = { type: "enabled" };
            requestBody.reasoning = { effort: doubaoReasoningEffort };
        } else {
            requestBody.thinking = { type: "disabled" };
        }

        // 联网搜索：自定义工具优先，否则用内置 web_search
        const _useCustomTools2 = typeof isToolCallingActive === 'function' && isToolCallingActive();
        if (_useCustomTools2 && typeof getResponsesTools === 'function') {
            const customTools = getResponsesTools();
            if (customTools) requestBody.tools = customTools;
        }

        return mergeCustomRequestBody(requestBody);
    } else if (currentAIProvider === 'glm') {
        // 智谱 GLM 使用 thinking.type 参数控制深度思考（enabled/disabled）
        // 智谱 GLM 请求体
        // GLM 的 temperature 范围是 0-1，需要限制
        const glmTemperature = Math.min(1, Math.max(0, temperature));
        const _useTools = typeof isToolCallingActive === 'function' && isToolCallingActive();
        return mergeCustomRequestBody({
            model: selectedModel,
            messages: apiMessages,
            max_tokens: maxTokens,
            temperature: glmTemperature,
            top_p: topP,
            stream: streamOutputEnabled,
            ...(currentAIProvider === 'glm' ? { tool_stream: true } : {}),
            thinking: {
                type: deepThinkingEnabled ? "enabled" : "disabled"
            },
            ...(_useTools && typeof getToolDefinitions === 'function' && getToolDefinitions() ? { tools: getToolDefinitions() } : {})
        });
    } else if (currentAIProvider === 'kimi') {
        // Kimi (月之暗面) 标准OpenAI兼容API
        // Kimi 的 temperature 范围是 [0, 1]，需要限制
        const kimiTemperature = Math.min(1, Math.max(0, temperature));
        const _useTools = typeof isToolCallingActive === 'function' && isToolCallingActive();

        const requestBody = {
            model: selectedModel,
            messages: apiMessages,
            max_tokens: maxTokens,
            temperature: kimiTemperature,
            top_p: topP,
            stream: streamOutputEnabled,
            // 流式输出时包含 usage 信息
            ...(streamOutputEnabled && {
                stream_options: { include_usage: true }
            }),
            ...(_useTools && typeof getToolDefinitions === 'function' && getToolDefinitions() ? { tools: getToolDefinitions() } : {})
        };

        // 深度思考支持：kimi-k2/k3 系列支持 thinking 参数
        if (selectedModel.startsWith('kimi-k2') || selectedModel.startsWith('kimi-k3')) {
            requestBody.thinking = {
                type: deepThinkingEnabled ? "enabled" : "disabled"
            };
        }

        return mergeCustomRequestBody(requestBody);
    }
}

// 更新缓存命中优化计数（每次正常发送 +1，重发/刷新跳过）
function updateCacheOptimizeCount() {
    if (!cacheOptimizeEnabled) return;

    const topicKey = getTopicMessagesKey();
    const userMsgCount = messages.filter(msg => msg.role === 'user').length;

    // 重发/刷新：不改变计数，只更新记录
    if (skipNextCountUpdate) {
        skipNextCountUpdate = false;
        console.log('[缓存优化] 跳过计数（重发/刷新）| 计数保持:', cacheOptimizeCount);
        return;
    }

    // 正常发送：直接 +1
    cacheOptimizeCount++;

    // 对话轮数超过上下文限制的一半时，缓存命中次数 +1
    if (userMsgCount > Math.floor(contextLimit / 2)) {
        cacheOptimizeHitCountByTopic[topicKey] = (cacheOptimizeHitCountByTopic[topicKey] || 0) + 1;
        localStorage.setItem('cnai_cache_optimize_hit_count_by_topic', JSON.stringify(cacheOptimizeHitCountByTopic));
    }

    // 达到上下文上限时重置
    if (cacheOptimizeCount >= contextLimit) {
        _recalcCacheOptimizeCount(contextLimit);
    }

    localStorage.setItem('cnai_cache_optimize_count', cacheOptimizeCount);
    console.log('[缓存优化] 计数+1:', cacheOptimizeCount);
}

// 获取 API 端点
function getAPIEndpoint() {
    // 检查是否为自定义服务商
    if (currentAIProvider.startsWith('custom_')) {
        const provider = customProviders.find(p => p.id === currentAIProvider);
        if (provider) {
            // 移除baseUrl末尾的斜杠
            let baseUrl = provider.baseUrl.replace(/\/+$/, '');
            if (provider.apiType === 'responses') {
                return baseUrl + '/responses';
            }
            return baseUrl + '/chat/completions';
        }
    }

    if (currentAIProvider === 'deepseek') {
        return 'https://api.deepseek.com/chat/completions';
    }
    if (currentAIProvider === 'mimo') {
        return 'https://api.xiaomimimo.com/v1/chat/completions';
    }
    if (currentAIProvider === 'minimax') {
        return 'https://api.minimaxi.com/v1/chat/completions';
    }
    if (currentAIProvider === 'kimi') {
        return 'https://api.moonshot.cn/v1/chat/completions';
    }
    if (currentAIProvider === 'doubao') {
        // 豆包统一使用 responses 端点
        return 'https://ark.cn-beijing.volces.com/api/v3/responses';
    }
    if (currentAIProvider === 'glm') {
        return 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    }
    // 默认千问 - 统一使用 Responses API 端点
    return 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/responses';
}

// ============ 自定义服务商管理函数 ============

// 当前编辑的自定义服务商ID（新增时为null）
let editingCustomProviderId = null;
// 临时存储编辑中的模型列表
let tempCustomProviderModels = [];

// 更新自定义服务商选项（在AI服务商下拉列表中）
function updateCustomProviderOptions() {
    // 保存当前选中的值，防止删除 option 时 select 自动重置
    const currentValue = aiProviderSelect.value;

    // 清除隐藏select中的自定义服务商选项（保留预设选项）
    const existingCustomOptions = aiProviderSelect.querySelectorAll('option[value^="custom_"]');
    existingCustomOptions.forEach(opt => opt.remove());

    // 同步添加到隐藏的select元素
    customProviders.forEach(provider => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        aiProviderSelect.appendChild(option);
    });

    // 恢复之前保存的值
    if (currentValue) {
        aiProviderSelect.value = currentValue;
    }
}

// 自定义服务商底部面板实例
let customProviderSheet = null;

// 打开自定义服务商管理弹窗
function openCustomProviderModal() {
    customProviderSheet = createBottomSheetPanel({
        title: '自定义服务商',
        content: `
            <div class="bs-grid bs-grid-cols-2" id="bsCustomProviderGrid" style="padding: 4px 12px 8px;"></div>
            <div style="padding: 0 16px 12px;">
                <button type="button" class="bs-item" id="bsAddCustomProviderBtn" style="justify-content:center;color:var(--primary-color);font-weight:500;border:1px solid var(--text-secondary);border-radius:10px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    添加新服务商
                </button>
            </div>
        `,
        onClose: () => { customProviderSheet = null; },
    });
    customProviderSheet.show();

    const bsGrid = document.getElementById('bsCustomProviderGrid');

    function renderBsCustomProviderList() {
        bsGrid.innerHTML = '';
        if (customProviders.length === 0) {
            bsGrid.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无自定义服务商，点击下方按钮添加</div>';
            return;
        }
        customProviders.forEach(provider => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'bs-item bs-item-grid';
            item.style.position = 'relative';
            const apiTypeText = provider.apiType === 'responses' ? 'Responses' : 'OpenAI';
            item.innerHTML = `
                <span class="bs-item-label">${provider.name}</span>
                <small style="font-size:10px;color:var(--text-secondary);margin-top:2px;">${apiTypeText} · ${provider.models.length} 个模型</small>
                <button class="bs-cp-delete-btn" title="删除记录" style="position:absolute;top:2px;right:2px;width:22px;height:22px;border:none;background:rgba(0,0,0,0.1);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);opacity:0.6;" data-id="${provider.id}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            `;
            // 点击整行触发编辑
            item.addEventListener('click', (e) => {
                if (e.target.closest('.bs-cp-delete-btn')) return;
                if (customProviderSheet) { customProviderSheet.hide(); customProviderSheet = null; }
                openEditCustomProviderModal(provider.id);
            });
            item.querySelector('.bs-cp-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (deleteCustomProvider(provider.id)) {
                    renderBsCustomProviderList();
                }
            });
            bsGrid.appendChild(item);
        });
    }

    document.getElementById('bsAddCustomProviderBtn').addEventListener('click', () => {
        if (customProviderSheet) { customProviderSheet.hide(); customProviderSheet = null; }
        openEditCustomProviderModal();
    });

    renderBsCustomProviderList();
}

// 关闭自定义服务商管理弹窗
function closeCustomProviderModal() {
    if (customProviderSheet) {
        customProviderSheet.hide();
        customProviderSheet = null;
    }
}

// 打开编辑自定义服务商弹窗
function openEditCustomProviderModal(providerId = null) {
    if (providerId) {
        // 编辑模式
        editingCustomProviderId = providerId;
        const provider = customProviders.find(p => p.id === providerId);
        if (!provider) return;

        customProviderEditTitle.textContent = '编辑服务商';
        customProviderName.value = provider.name;
        customProviderBaseUrl.value = provider.baseUrl;
        apiTypeSelectText.textContent = provider.apiType === 'responses' ? 'OpenAI Responses 兼容模式' : 'OpenAI 兼容模式';
        apiTypeSelectBtn.dataset.value = provider.apiType;
        tempCustomProviderModels = [...provider.models];
    } else {
        // 新增模式：立即创建空服务商
        const newProvider = {
            id: 'custom_' + Date.now(),
            name: '',
            baseUrl: '',
            apiType: 'openai',
            models: []
        };
        customProviders.push(newProvider);
        if (!apiKeys[newProvider.id]) {
            apiKeys[newProvider.id] = '';
        }
        editingCustomProviderId = newProvider.id;

        customProviderEditTitle.textContent = '添加服务商';
        customProviderName.value = '';
        customProviderBaseUrl.value = '';
        apiTypeSelectText.textContent = 'OpenAI 兼容模式';
        apiTypeSelectBtn.dataset.value = 'openai';
        tempCustomProviderModels = [];
    }

    renderCustomProviderModelsList();
    openModalWithFade(customProviderEditModal);
}

// 关闭编辑自定义服务商弹窗
function closeEditCustomProviderModal() {
    closeModalWithFade(customProviderEditModal);
    editingCustomProviderId = null;
    tempCustomProviderModels = [];
}

// 渲染编辑弹窗中的模型列表
function renderCustomProviderModelsList() {
    customProviderModelsList.innerHTML = '';

    if (tempCustomProviderModels.length === 0) {
        customProviderModelsList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无模型，请添加</div>';
        return;
    }

    tempCustomProviderModels.forEach((model, index) => {
        const item = document.createElement('div');
        item.className = 'model-item';
        item.innerHTML = `
            <span class="model-item-name">${model.name}</span>
            <button class="model-item-delete" title="删除">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        item.querySelector('.model-item-delete').addEventListener('click', () => {
            tempCustomProviderModels.splice(index, 1);
            renderCustomProviderModelsList();
            saveCustomProviderField();
        });

        customProviderModelsList.appendChild(item);
    });
}

// 添加模型到临时列表
function addCustomProviderModel() {
    const modelId = customProviderModelInput.value.trim();
    if (!modelId) {
        showToast('请输入模型ID');
        return;
    }

    if (tempCustomProviderModels.find(m => m.id === modelId)) {
        showToast('该模型已存在');
        return;
    }

    tempCustomProviderModels.push({ id: modelId, name: modelId });
    customProviderModelInput.value = '';
    renderCustomProviderModelsList();
    saveCustomProviderField();
}

// 实时保存服务商当前编辑字段
function saveCustomProviderField() {
    if (!editingCustomProviderId) return;
    const provider = customProviders.find(p => p.id === editingCustomProviderId);
    if (!provider) return;

    provider.name = customProviderName.value.trim() || '空服务商';
    provider.baseUrl = customProviderBaseUrl.value.trim();
    provider.apiType = apiTypeSelectBtn.dataset.value || 'openai';
    provider.models = [...tempCustomProviderModels];

    localStorage.setItem('cnai_custom_providers', JSON.stringify(customProviders));

    // 更新模型缓存
    cachedModels[provider.id] = provider.models;
    localStorage.setItem('cnai_cached_models', JSON.stringify(cachedModels));

    updateCustomProviderOptions();
    renderCustomProviderList();
}

// 删除自定义服务商
function deleteCustomProvider(providerId) {
    if (!confirm('确定要删除这个服务商吗？')) {
        return false;
    }

    const index = customProviders.findIndex(p => p.id === providerId);
    if (index !== -1) {
        customProviders.splice(index, 1);
        localStorage.setItem('cnai_custom_providers', JSON.stringify(customProviders));

        // 清理相关数据
        delete cachedModels[providerId];
        localStorage.setItem('cnai_cached_models', JSON.stringify(cachedModels));

        delete apiKeys[providerId];
        localStorage.setItem('cnai_api_keys', JSON.stringify(apiKeys));

        // 如果当前选中的是被删除的服务商，切换回默认
        if (currentAIProvider === providerId) {
            currentAIProvider = 'deepseek';
            aiProviderSelect.value = 'deepseek';
            localStorage.setItem('cnai_ai_provider', 'deepseek');
            updateAIProviderSelectDisplay();
            updateModelOptions();
        }

        updateCustomProviderOptions();
        closeEditCustomProviderModal();
        showToast('服务商已删除');
    }
    return true;
}

// 设置自定义服务商相关事件监听
function setupCustomProviderEvents() {
    // 添加新服务商按钮（编辑弹窗里的）

    // 关闭编辑弹窗
    closeCustomProviderEdit.addEventListener('click', closeEditCustomProviderModal);

    // 实时保存事件
    customProviderName.addEventListener('input', saveCustomProviderField);
    customProviderName.addEventListener('change', saveCustomProviderField);
    customProviderBaseUrl.addEventListener('input', saveCustomProviderField);
    customProviderBaseUrl.addEventListener('change', saveCustomProviderField);

    // API类型选择器
    apiTypeSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createBottomSheetPicker({
            items: [
                { value: 'openai', label: 'OpenAI 兼容模式' },
                { value: 'responses', label: 'OpenAI Responses 兼容模式' },
            ],
            activeValue: apiTypeSelectBtn.dataset.value || 'openai',
            onSelect: (item) => {
                apiTypeSelectText.textContent = item.label;
                apiTypeSelectBtn.dataset.value = item.value;
                saveCustomProviderField();
            },
        }).show();
    });

    // 添加模型按钮
    addCustomProviderModelBtn.addEventListener('click', addCustomProviderModel);

    // 模型输入框回车添加
    customProviderModelInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addCustomProviderModel();
        }
    });


}

// ============ 豆包 Session 缓存辅助函数 ============

// 获取当前话题的 response_id
// targetMessage: 可选，刷新/重发时传入目标消息，查找其之前的 AI 消息
function getPreviousResponseId(targetMessage = null) {
    if (targetMessage) {
        // 刷新/重发：优先使用保存的 _previousResponseId（刷新时在移除消息前保存）
        if (targetMessage._previousResponseId) {
            console.log('使用保存的上一条AI消息 responseId:', targetMessage._previousResponseId);
            return targetMessage._previousResponseId;
        }

        // 否则找到目标消息在 messages 数组中的位置，然后找它之前的 AI 消息
        const targetIndex = messages.findIndex(msg => msg === targetMessage);
        if (targetIndex > 0) {
            // 从目标消息之前的位置向前查找 AI 消息
            for (let i = targetIndex - 1; i >= 0; i--) {
                if (messages[i].role === 'assistant') {
                    // 如果找到没有responseId的AI消息，说明中间有编辑过的消息，返回null
                    if (!messages[i].responseId) {
                        console.log('发现没有responseId的AI消息，无法使用previous_response_id');
                        return null;
                    }
                    console.log('使用上一条AI消息的 response_id:', messages[i].responseId);
                    return messages[i].responseId;
                }
            }
        }
        // 没有找到上一条 AI 消息，返回 null
        return null;
    }
    // 否则从最新一条 AI 消息中获取 response_id
    const lastAiMessage = [...messages].reverse().find(msg => msg.role === 'assistant');
    if (lastAiMessage && lastAiMessage.responseId) {
        console.log('使用最新AI消息的 response_id:', lastAiMessage.responseId);
        return lastAiMessage.responseId;
    }
    return null;
}

// 处理响应（合并流式和非流式）
// isRefresh: 是否为刷新操作
// targetMessage: 目标消息对象（用于添加新版本）
// knowledgeContext: 可选，知识库检索内容（如果传入则直接使用，否则自动检索）
async function handleResponse(systemPrompt = null, isRefresh = false, targetMessage = null, knowledgeContext = undefined) {
    const apiUrl = getAPIEndpoint();

    // 知识库检索：如果启用了知识库且未传入 knowledgeContext，则自动检索
    if (knowledgeContext === undefined && knowledgeBaseEnabled) {
        // 获取用户最新的问题
        const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user');
        const userQuery = lastUserMessage?.content;
        if (userQuery && typeof userQuery === 'string') {
            try {
                // 使用混合检索（关键词 + 向量）
                await ensureKnowledgeBase();
                const relevantChunks = await hybridSearch(userQuery, maxKnowledgeChunks);
                if (relevantChunks.length > 0) {
                    knowledgeContext = relevantChunks.map((chunk, i) => {
                        const titleInfo = chunk.title ? ` [${chunk.title}]` : '';
                        return `[${i + 1}] 来源：${chunk.docName}${titleInfo}\n${chunk.text}`;
                    }).join('\n\n');
                    console.log('知识库检索结果:', relevantChunks.length, '个片段');
                }
            } catch (error) {
                console.error('知识库检索失败:', error);
            }
        }
    }

    // 构建请求体（知识库内容将添加到最新用户消息中，不在界面展示）
    // 重发模式：只发送到被重发的用户消息为止
    const truncateId = resendUserId;
    const requestBody = buildRequestBody(systemPrompt, targetMessage, knowledgeContext, truncateId);

    // 发送前压缩检查：遍历请求体中的所有图片，压缩超阈值的大图
    await compressImagesInRequestBody(requestBody);

    // 用于保存本轮响应的 response_id
    let currentResponseId = null;
    let currentUsageInfo = null;
    requestStartTime = Date.now();

    // 调试：单行打印完整请求体
    if (currentAIProvider === 'qwen' || currentAIProvider === 'doubao') {
        const _debugBody = JSON.stringify(requestBody);
        console.log('[ResponsesToolCalling] REQ_BODY=' + _debugBody);
    }

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };

    // 千问 Session 模式：添加请求头（独立片段模式下不添加）
    const currentSelectedContext = getContextForSending();
    const isIndependentMode = currentSelectedContext && currentSelectedContext.length > 0 && contextSelectionMode === 'independent';
    if (currentAIProvider === 'qwen' && qwenSessionEnabled && !isIndependentMode) {
        headers['x-dashscope-session-cache'] = 'enable';
    }

    // 输出知识库检索结果到控制台
    if (knowledgeContext) {
        console.log('====== 知识库检索内容 ======');
        console.log(knowledgeContext);
        console.log('============================');
    }

    // 输出完整请求信息到控制台
    console.log('====== 完整请求信息 ======');
    console.log('API URL:', apiUrl);
    console.log('Method: POST');
    console.log('Headers:', {
        'Authorization': `Bearer ${apiKey.substring(0, 8)}...`, // 隐藏部分 API Key
        'Content-Type': 'application/json',
        ...(currentAIProvider === 'qwen' && qwenSessionEnabled && !isIndependentMode && { 'x-dashscope-session-cache': 'enable' })
    });
    console.log('Body:', JSON.stringify(requestBody, null, 2));
    console.log('========================');

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: abortController?.signal
    });

    if (!response.ok) {
        const errorText = await response.text();
        
        // 检查是否为 PreviousResponseNotFound 或 not cached 错误
        try {
            const errorData = JSON.parse(errorText);
            const _errCode = errorData.error?.code || '';
            const _errMsgStr = errorData.error?.message || '';
            const _isContextOverflow = /context.*(length|exceed|limit)|maximum.*context|too.*(long|large)|token.*(limit|exceed|超过)|输入.*超|超过.*token|exceeds.*length/i.test(_errMsgStr + _errCode);
            if (_isContextOverflow) {
                throw new Error('上下文长度超出模型限制，请减少对话轮数或清除部分历史消息');
            }
            const isPrevResponseError = _errCode === 'InvalidParameter.PreviousResponseNotFound'
                || (_errMsgStr.includes('not cached') && /previous|response/i.test(_errMsgStr))
                || _errMsgStr.includes('Not found previous_response_id')
                || (typeof errorData.message === 'string' && errorData.message.includes('Not found previous_response_id'));
            if (isPrevResponseError) {
                console.log('检测到 PreviousResponseNotFound 错误，清除无效的 response_id 并重试');
                // 清除所有 AI 消息的 responseId（因为它们可能都已失效）
                messages.forEach(msg => {
                    if (msg.role === 'assistant') {
                        delete msg.responseId;
                        delete msg._previousResponseId;
                    }
                });
                await saveMessages(messages);
                // 设置强制首次发送标志（豆包+千问）
                forceFirstSend = 1;
                localStorage.setItem('doubao_force_first_send', '1');
                qwenForceFirstSend = 1;
                localStorage.setItem('qwen_force_first_send', '1');
                // 重新发送请求（作为首轮对话）
                console.log('重新发送请求（作为首轮对话）');
                return handleResponse(systemPrompt, isRefresh, targetMessage);
            }
        } catch (parseError) {
            // 如果不是 JSON 格式或不是 PreviousResponseNotFound 错误，继续抛出原始错误
            if (parseError instanceof SyntaxError) {
                throw new Error(`API 错误：${response.status} - ${errorText}`);
            }
            throw parseError;
        }
        throw new Error(`API 错误：${response.status} - ${errorText}`);
    }

    // 初始化内容变量
    let aiContent = '';
    let reasoningContent = null;
    let webSearchPromptShown = false; // 联网搜索提示是否已显示
    let attachmentsForDisplay = null; // OpenClaw 返回的附件（图片等）

    if (streamOutputEnabled) {
        // 流式响应处理
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // 收集所有原始响应数据
        const allChunks = [];

        // 如果不是刷新/重发操作，移除最后一条消息并创建新的
        if (!isRefresh && !targetMessage) {
            removeLastMessage();
            const now = new Date();
            const aiMessageId = generateMessageId();
            currentAiMessageDiv = appendMessage('ai', '正在思考…', true, false, now, null, null, 0, null, null, null, aiMessageId);
            // 暂存 AI 消息 ID，后续 createAssistantMessage 时使用
            currentAiMessageId = aiMessageId;
        }
        currentAiContent = '';
        _streamingCounter = 0;
        currentThinkingContent = '';
        currentAnnotations = null;
        resetStreamState();

        while (true) {
            // 检查是否已停止生成
            if (abortController && abortController.signal.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                    const data = trimmed.substring(5).trim();
                    if (data === '[DONE]') continue;
                    try {
                        const chunk = JSON.parse(data);
                        // 收集原始响应数据
                        allChunks.push(chunk);
                        // 每个 chunk 都更新 placeholder，让用户感知 AI 在干活
                        if (messageInput && !messageInput.value) {
                            updateStreamingPlaceholder(_streamingCounter + 1);
                        }
                        if (chunk.error) {
                            const _errMsg = chunk.error.message || JSON.stringify(chunk.error);
                            // 检测 previous_response_id 失效，走首轮重试
                            if (_errMsg.includes('Not found previous_response_id') || (_errMsg.includes('not cached') && /previous|response/i.test(_errMsg))) {
                                console.log('[Retry] 流式检测到 previous_response_id 失效，走首轮重试');
                                messages.forEach(msg => {
                                    if (msg.role === 'assistant') {
                                        delete msg.responseId;
                                        delete msg._previousResponseId;
                                    }
                                });
                                await saveMessages(messages);
                                forceFirstSend = 1;
                                localStorage.setItem('doubao_force_first_send', '1');
                                qwenForceFirstSend = 1;
                                localStorage.setItem('qwen_force_first_send', '1');
                                return handleResponse(systemPrompt, isRefresh, targetMessage);
                            }
                            throw new Error(_errMsg);
                        }
                        // 检测 Qwen 直接返回在 chunk 上的错误格式 {code, message}
                        if (chunk.code && chunk.message) {
                            const _qwenErr = chunk.message;
                            // 检测 previous_response_id 失效，走首轮重试
                            if (_qwenErr.includes('Not found previous_response_id') || (_qwenErr.includes('not cached') && /previous|response/i.test(_qwenErr))) {
                                console.log('[Retry] 流式检测到 previous_response_id 失效，走首轮重试');
                                messages.forEach(msg => {
                                    if (msg.role === 'assistant') {
                                        delete msg.responseId;
                                        delete msg._previousResponseId;
                                    }
                                });
                                await saveMessages(messages);
                                forceFirstSend = 1;
                                localStorage.setItem('doubao_force_first_send', '1');
                                qwenForceFirstSend = 1;
                                localStorage.setItem('qwen_force_first_send', '1');
                                return handleResponse(systemPrompt, isRefresh, targetMessage);
                            }
                            throw new Error(_qwenErr);
                        }
                        // 捕获 response_id 和 usage 信息（使用公共函数）
                        const { responseId: chunkResponseId, usageData: chunkUsageData } = processResponseMetadata(chunk, true);
                        if (chunkResponseId) {
                            currentResponseId = chunkResponseId;
                            console.log('====== 捕获 responseId ======');
                            console.log('responseId:', chunkResponseId);
                            console.log('currentResponseId 已更新:', currentResponseId);
                            console.log('========================');
                        }
                        currentUsageInfo = logCacheHitInfo(chunkUsageData);
                        // Responses API 格式：豆包 Session 缓存 或 千问
                        const isResponsesAPI = currentAIProvider === 'doubao' || currentAIProvider === 'qwen';

                        if (isResponsesAPI) {
                            // 处理响应失败（如联网搜索未开通）
                            if (chunk.type === 'response.failed' && chunk.response?.error) {
                                const error = chunk.response.error;
                                if (error.code === 'ToolNotOpen') {
                                    appendToLastMessage('⚠️ 联网搜索功能未开通\n\n请在火山引擎控制台激活：\nhttps://console.volcengine.com/common-buy/CC_content_plugin\n\n您可以在设置中关闭"联网搜索"开关继续使用。');
                                } else {
                                    appendToLastMessage(`⚠️ 请求失败：${error.message || error.code || '未知错误'}`);
                                }
                                continue;
                            }
                            // 处理联网搜索状态（只显示一次）
                            if (chunk.type === 'response.web_search_call.in_progress' && !webSearchPromptShown) {
                                appendToLastMessage('🌐');
                                webSearchPromptShown = true;
                            }
                            // Function Calling：function_call 开始
                            if (chunk.type === 'response.output_item.added' && chunk.item && chunk.item.type === 'function_call') {
                                // 记录 call_id 和 name，等待 arguments 增量
                                if (typeof collectResponsesStreamToolCalls === 'function') {
                                    collectResponsesStreamToolCalls(chunk);
                                }
                            }
                            // Function Calling：arguments 增量
                            if (chunk.type === 'response.function_call_arguments.delta') {
                                if (typeof collectResponsesStreamToolCalls === 'function') {
                                    collectResponsesStreamToolCalls(chunk);
                                }
                            }
                            // Function Calling：function_call 完成
                            if (chunk.type === 'response.output_item.done' && chunk.item && chunk.item.type === 'function_call') {
                                if (typeof collectResponsesStreamToolCalls === 'function') {
                                    collectResponsesStreamToolCalls(chunk);
                                }
                            }
                            // 千问格式：response.output_text.delta
                            if (chunk.type === 'response.output_text.delta' && chunk.delta) {
                                appendToLastMessage(chunk.delta);
                            }
                            // 千问深度思考格式：response.reasoning_summary_text.delta
                            else if (chunk.type === 'response.reasoning_summary_text.delta' && chunk.delta) {
                                updateThinking(chunk.delta);
                            }
                            // 千问深度思考格式：response.reasoning_summary_text.done（完整思考文本）
                            else if (chunk.type === 'response.reasoning_summary_text.done' && chunk.text) {
                                if (!currentThinkingContent) {
                                    updateThinking(chunk.text);
                                }
                            }
                            // 千问格式：response.output_text.done（完整文本）
                            else if (chunk.type === 'response.output_text.done' && chunk.text) {
                                if (!currentAiContent) {
                                    appendToLastMessage(chunk.text);
                                }
                            }
                            // 千问格式：output.text.delta
                            else if (chunk.output?.text?.delta) {
                                appendToLastMessage(chunk.output.text.delta);
                            }
                            // 千问格式：output.thinking.delta（思考内容）
                            else if (chunk.output?.thinking?.delta) {
                                updateThinking(chunk.output.thinking.delta);
                            }
                            // 豆包格式：response.output_text.delta
                            else if (chunk.type === 'response.output_text.delta' && chunk.delta) {
                                appendToLastMessage(chunk.delta);
                            }
                            // 处理完成事件中的完整输出（备用）
                            else if (chunk.type === 'response.completed' && chunk.response?.output) {
                                const output = chunk.response.output;
                                for (const item of output) {
                                    // 提取 annotations
                                    if (item.type === 'message' && item.content) {
                                        for (const contentItem of item.content) {
                                            // 保存 annotations
                                            if (contentItem.annotations && contentItem.annotations.length > 0) {
                                                currentAnnotations = contentItem.annotations;
                                            }
                                            // 如果流式输出没有内容，使用完整输出
                                            if (!currentAiContent && contentItem.type === 'output_text' && contentItem.text) {
                                                appendToLastMessage(contentItem.text);
                                            }
                                        }
                                    }
                                }
                            }
                        } else {
                            // 传统 chat/completions 格式
                            const delta = chunk.choices?.[0]?.delta;
                            if (delta) {
                                if (delta.reasoning_content) updateThinking(delta.reasoning_content);
                                if (delta.thinking?.content) updateThinking(delta.thinking.content);
                                if (delta.reasoning_details && delta.reasoning_details.length > 0) {
                                    for (const item of delta.reasoning_details) {
                                        if (item.text) updateThinking(item.text);
                                    }
                                }
                                if (delta.content) {
                                    appendToLastMessage(delta.content);
                                }
                                // 收集 tool_calls（function calling）
                                if (typeof collectStreamToolCalls === 'function') {
                                    collectStreamToolCalls(delta);
                                }
                            }
                        }
                    } catch (e) {
                        if (e instanceof SyntaxError) {
                            console.error('[SSE] JSON解析失败, data长度:', data.length, '前200字符:', data.substring(0, 200));
                            continue; // 跳过无法解析的 chunk
                        }
                        if (e instanceof Error && e.message) throw e;
                    }
                }
            }
        }

        // 流式结束后不 flush，让 typewriter 继续逐字渲染完剩余内容

        // 流式输出完成后自动折叠思考内容
        if (currentThinkingContent && currentAiMessageDiv) {
            const thinkingDiv = currentAiMessageDiv.querySelector('.thinking-content');
            if (thinkingDiv) {
                toggleThinkingCollapse(currentAiMessageDiv, thinkingDiv, true);
            }
        }

        aiContent = currentAiContent;
        reasoningContent = currentThinkingContent || null;

        // 输出 AI 返回的完整原始数据
        console.log('====== AI原始响应（流式） ======');
        console.log('共收到', allChunks.length, '个数据块');
        console.log('========================================');

        // 处理 OpenClaw 返回的附件（流式）- 从最后一个 chunk 中获取
        attachmentsForDisplay = null;
        if (allChunks.length > 0) {
            const lastChunk = allChunks[allChunks.length - 1];
            if (lastChunk.attachments && Array.isArray(lastChunk.attachments) && lastChunk.attachments.length > 0) {
                attachmentsForDisplay = lastChunk.attachments.filter(att =>
                    att.contentType && att.contentType.startsWith('image/') && att.data
                ).map(att => ({
                    base64: `data:${att.contentType};base64,${att.data}`,
                    name: att.filename || 'image.png'
                }));
            }
            // 提取完附件后清空数组，释放内存
            allChunks.length = 0;
        }
    } else {
        // 非流式响应处理
        const data = await response.json();

        // 输出 AI 返回的完整原始数据
        console.log('====== AI原始响应（非流式） ======');
        console.log(data);
        console.log('========================================');

        if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
        }

        // 捕获 response_id 和 usage 信息（使用公共函数）
        const { responseId: nonStreamResponseId, usageData: nonStreamUsageData } = processResponseMetadata(data, false);
        if (nonStreamResponseId) {
            currentResponseId = nonStreamResponseId;
        }
        currentUsageInfo = logCacheHitInfo(nonStreamUsageData);

        // Responses API 格式：豆包 Session 缓存 或 千问
        const isResponsesAPI = currentAIProvider === 'doubao' || currentAIProvider === 'qwen';

        // 处理响应失败（如联网搜索未开通）
        if (data.status === 'failed' && data.error) {
            if (data.error.code === 'ToolNotOpen') {
                aiContent = '⚠️ 联网搜索功能未开通\n\n请在火山引擎控制台激活：\nhttps://console.volcengine.com/common-buy/CC_content_plugin\n\n您可以在设置中关闭"联网搜索"开关继续使用。';
            } else {
                aiContent = `⚠️ 请求失败：${data.error.message || data.error.code || '未知错误'}`;
            }
            reasoningContent = null;
        } else if (isResponsesAPI && data.output) {
            // Responses API 格式（非流式：output 直接在根级别）
            const output = data.output;
            // output 是数组，遍历获取内容
            aiContent = '';
            let nonStreamAnnotations = null;
            for (const item of output) {
                if (item.type === 'message' && item.content) {
                    for (const contentItem of item.content) {
                        // 提取 annotations
                        if (contentItem.annotations && contentItem.annotations.length > 0) {
                            nonStreamAnnotations = contentItem.annotations;
                        }
                        if (contentItem.type === 'output_text' && contentItem.text) {
                            aiContent += contentItem.text;
                        }
                    }
                }
                // Function Calling：收集 function_call
                if (item.type === 'function_call') {
                    if (typeof toolCallsBuffer !== 'undefined') {
                        toolCallsBuffer.push({
                            id: item.call_id || item.id || '',
                            function: { name: item.name || '', arguments: item.arguments || '' }
                        });
                    }
                }
            }
            aiContent = aiContent || '无响应';
            reasoningContent = null;
            currentAnnotations = nonStreamAnnotations;
        } else {
            // 传统 chat/completions 格式
            const message = data.choices?.[0]?.message || {};
            reasoningContent = message.reasoning_content || null;
            // MiniMax 格式：reasoning_details 数组
            if (!reasoningContent && message.reasoning_details && message.reasoning_details.length > 0) {
                reasoningContent = message.reasoning_details.map(item => item.text || '').join('');
            }
            aiContent = message.content || '无响应';
            // 收集非流式 tool_calls
            if (typeof setNonStreamToolCalls === 'function') {
                setNonStreamToolCalls(message.tool_calls);
            }
        }

        // 处理 OpenClaw 返回的附件（非流式）
        attachmentsForDisplay = null;
        if (data.attachments && Array.isArray(data.attachments) && data.attachments.length > 0) {
            attachmentsForDisplay = data.attachments.filter(att =>
                att.contentType && att.contentType.startsWith('image/') && att.data
            ).map(att => ({
                base64: `data:${att.contentType};base64,${att.data}`,
                name: att.filename || 'image.png'
            }));
        }

        // 如果不是刷新/重发操作，移除最后一条消息并创建新的
        if (!isRefresh && !targetMessage) {
            removeLastMessage();
        }
    }

    // ========== 公共后处理逻辑 ==========

    // 流式输出结束，立即 flush 最后一次渲染（防止最后一个 chunk 丢失）
    flushStreamingRender();

    console.log('====== 公共后处理逻辑 ======');
    console.log('currentResponseId:', currentResponseId || '无');
    console.log('targetMessage:', targetMessage ? '存在' : '不存在');
    console.log('streamOutputEnabled:', streamOutputEnabled);
    console.log('========================');

    // 豆包 Session 缓存：发送完成后将 forceFirstSend 置为 0，后续发送使用非首次发送逻辑
    if (currentAIProvider === 'doubao' && sessionCacheEnabled && currentResponseId) {
        forceFirstSend = 0;
    }

    // 千问 Session 模式：发送完成后将 qwenForceFirstSend 置为 0
    if (currentAIProvider === 'qwen' && qwenSessionEnabled && currentResponseId) {
        qwenForceFirstSend = 0;
    }

    // 处理版本保存
    if (targetMessage && targetMessage.versions) {
        // 刷新/重发：添加新版本（携带 tool_calls）
        const newVersion = createVersion(aiContent, reasoningContent, currentResponseId, currentAnnotations, resendUserId, targetMessage.tool_calls);

        targetMessage.versions.push(newVersion);
        console.log('====== 保存新版本 ======');
        console.log('newVersion.responseId:', newVersion.responseId || '无');
        console.log('targetMessage.responseId:', targetMessage.responseId || '无');
        console.log('========================');
        targetMessage.currentVersionIndex = targetMessage.versions.length - 1;
        targetMessage.content = aiContent || '正在思考…';
        targetMessage.reasoning = reasoningContent;
        targetMessage.timestamp = Date.now();
        targetMessage.modelName = selectedModel;
        targetMessage.responseId = currentResponseId;  // 豆包 Session 缓存
        targetMessage.annotations = currentAnnotations; // 联网搜索引用来源
        // 消息没有被移除过，不需要 splice 回来
        resendUserId = null;

        // 更新 UI（非流式需要手动更新，流式已实时更新）
        if (!streamOutputEnabled && currentAiMessageDiv) {
            const messageContent = currentAiMessageDiv.querySelector('.message-content');
            const displayText = aiContent || '正在思考…';
            messageContent.innerHTML = formatMessage(displayText);
            messageContent.dataset.content = displayText;
            if (reasoningContent) {
                prependThinking(currentAiMessageDiv, reasoningContent);
            }
            // 更新引用来源显示
            if (currentAnnotations) {
                appendAnnotations(currentAiMessageDiv, currentAnnotations);
            }
        }
        updateVersionSwitcher(currentAiMessageDiv, targetMessage);
    } else {
        // 新消息处理：从可见链中找到最后一条 user 消息
        const userId = getLastVisibleMsgIdByRole('user');
        const newMessage = createAssistantMessage(aiContent, reasoningContent, currentResponseId, currentAnnotations, userId);

        if (streamOutputEnabled) {
            // 流式输出也需要保存附件信息
            newMessage.images = attachmentsForDisplay;
            messages.push(newMessage);
            // 流式输出完成后添加引用来源和图片
            if (currentAnnotations && currentAiMessageDiv) {
                appendAnnotations(currentAiMessageDiv, currentAnnotations);
            }
            // 如果有图片，也添加到消息元素中
            if (attachmentsForDisplay && currentAiMessageDiv) {
                const messageContent = currentAiMessageDiv.querySelector('.message-content');
                if (messageContent) {
                    const imagesHtml = attachmentsForDisplay.map(img => `
                        <div class="message-image">
                            <img src="${img.base64}" alt="${img.name}" class="message-image-img">
                        </div>
                    `).join('');
                    messageContent.insertAdjacentHTML('beforeend', imagesHtml);
                }
            }
        } else {
            // 非流式需要创建消息元素
            const displayText = aiContent || '正在思考…';
            if (reasoningContent) {
                const newAiMessage = appendMessage('ai', displayText, true, false, Date.now(), null, null, 0, attachmentsForDisplay, null, currentAnnotations, newMessage.id);
                prependThinking(newAiMessage, reasoningContent);
            } else {
                appendMessage('ai', displayText, true, false, Date.now(), null, null, 0, attachmentsForDisplay, null, currentAnnotations, newMessage.id);
            }
            messages.push(newMessage);
        }
    }
    // Hook: tool-calling.js 多轮工具调用处理
    if (typeof processToolCalls === 'function') {
        await processToolCalls(messages, currentAiMessageDiv);
    }
    // 流式输出完成，渲染所有图表（如果 typewriter 还在跑则跳过，由 typewriter 完成时渲染）
    if (currentAiMessageDiv && !_streamTypewriterTimer) {
        renderPendingCharts(currentAiMessageDiv);
    }
    // 将 token 用量信息填充到当前消息的 tooltip
    if (currentUsageInfo && currentAiMessageDiv) {
        let tooltip = currentAiMessageDiv.querySelector('.token-info-tooltip');
        let infoTrigger = currentAiMessageDiv.querySelector('.info-tooltip-trigger');
        // 如果 info 按钮不存在，动态创建
        if (!infoTrigger) {
            infoTrigger = document.createElement('span');
            infoTrigger.className = 'info-tooltip-trigger';
            infoTrigger.tabIndex = 0;
            infoTrigger.style.marginLeft = '0';
            infoTrigger.innerHTML = ICONS.info + '<span class="info-tooltip-content token-info-tooltip"></span>';
            const actionsDiv = currentAiMessageDiv.querySelector('.message-actions');
            if (actionsDiv) {
                actionsDiv.appendChild(infoTrigger);
            }
            tooltip = infoTrigger.querySelector('.token-info-tooltip');
        }
        if (tooltip) {
            tooltip.innerHTML = `输入tokens：${currentUsageInfo.inputTokens}<br>缓存命中率：${currentUsageInfo.cacheHitRate}<br>输出tokens：${currentUsageInfo.outputTokens}<br>运行时间：${((Date.now() - requestStartTime) / 1000).toFixed(1)}s<br>缓存命中优化次数：${cacheOptimizeHitCountByTopic[getTopicMessagesKey()] || 0}`;;
        }
        if (infoTrigger) infoTrigger.style.display = '';
    } else if (currentAiMessageDiv) {
        // 没有 usage 数据时隐藏 info 按钮
        const infoTrigger = currentAiMessageDiv.querySelector('.info-tooltip-trigger');
        if (infoTrigger) infoTrigger.style.display = 'none';
    }

    await saveMessages(messages);
    updateCacheOptimizeCount();

    // 将 usageInfo 保存到话题级别，供下次加载时恢复
    if (currentUsageInfo) {
        const topicUsageInfo = {
            inputTokens: currentUsageInfo.inputTokens,
            cacheHitRate: currentUsageInfo.cacheHitRate,
            outputTokens: currentUsageInfo.outputTokens,
            runTime: ((Date.now() - requestStartTime) / 1000).toFixed(1),
            cacheOptimizeHitCount: cacheOptimizeHitCountByTopic[getTopicMessagesKey()] || 0
        };
        localStorage.setItem('cnai_topic_usage_info_' + getTopicMessagesKey(), JSON.stringify(topicUsageInfo));
    }

    // 如果是刷新/重发，保存新版本即可（流式已渲染完毕，无需刷新话题）
    if (targetMessage && targetMessage.versions) {
        await saveMessages(messages);
    }

    // 更新重发按钮显示状态
    updateResendButtons();

    // 流式滚动已由 startStreamScroll 独立定时器处理
}

// ==================== 知识库检索选择功能 ====================

/**
 * 执行知识库检索并让用户选择内容
 * @param {string} userQuery - 用户查询内容
 * @param {HTMLElement} statusElement - 用于显示状态的元素（可选）
 * @returns {Promise<{context: string|null, cancelled: boolean}>}
 *          - context: 选中的知识库内容（格式化后的字符串），无选中则为 null
 *          - cancelled: 用户是否取消了操作
 */
async function performKnowledgeSearch(userQuery, statusElement = null) {
    if (!knowledgeBaseEnabled || !userQuery) {
        return { context: null, cancelled: false };
    }

    // 处理多模态消息
    if (typeof userQuery !== 'string') {
        if (Array.isArray(userQuery)) {
            const textPart = userQuery.find(part => part.type === 'text' || part.type === 'input_text');
            userQuery = textPart ? textPart.text : null;
        }
        if (!userQuery || typeof userQuery !== 'string') {
            return { context: null, cancelled: false };
        }
    }

    try {
        // 更新状态显示
        if (statusElement) {
            statusElement.textContent = '正在检索知识库...';
        }

        // 执行知识库检索
        await ensureKnowledgeBase();
        const relevantChunks = await hybridSearch(userQuery, maxKnowledgeChunks);
        console.log('知识库检索结果:', relevantChunks.length, '个片段');

        if (relevantChunks.length === 0) {
            return { context: null, cancelled: false };
        }

        // 显示选择弹窗让用户选择
        const selectedChunks = await showKnowledgeSelectModal(relevantChunks);

        if (selectedChunks === null) {
            // 用户取消了选择
            console.log('用户取消了知识库内容选择');
            return { context: null, cancelled: true };
        }

        if (selectedChunks.length === 0) {
            return { context: null, cancelled: false };
        }

        // 用户选择了内容，构建知识库上下文
        const knowledgeContext = selectedChunks.map((chunk, i) => {
            const titleInfo = chunk.title ? ` [${chunk.title}]` : '';
            return `[${i + 1}] 来源：${chunk.docName}${titleInfo}\n${chunk.text}`;
        }).join('\n\n');
        console.log('用户选择了', selectedChunks.length, '个知识库片段');

        return { context: knowledgeContext, cancelled: false };
    } catch (error) {
        console.error('知识库检索失败:', error);
        return { context: null, cancelled: false };
    }
}

// 显示知识库检索结果选择底部面板
function showKnowledgeSelectModal(chunks) {
    return new Promise((resolve) => {
        pendingKnowledgeChunks = chunks;
        selectedKnowledgeChunks = new Set();
        knowledgeSelectResolve = resolve;

        if (knowledgeSelectSheet) { knowledgeSelectSheet.hide(); knowledgeSelectSheet = null; }

        // 构建底部面板内容
        let listHtml = '';
        if (chunks.length === 0) {
            listHtml = `
                <div class="knowledge-select-empty">
                    <div class="knowledge-select-empty-icon">📭</div>
                    <div class="knowledge-select-empty-text">未找到相关知识库内容</div>
                </div>`;
        } else {
            listHtml = chunks.map((chunk, index) => {
                const titleInfo = chunk.title ? ` [${chunk.title}]` : '';
                const previewText = chunk.text.length > 150 ? chunk.text.substring(0, 150) + '...' : chunk.text;
                const resultBadge = chunk.isKeywordResult
                    ? '<span class="keyword-badge" title="关键词匹配">关键词</span>'
                    : '<span class="vector-badge" title="向量相似度匹配">向量</span>';
                return `
                    <div class="knowledge-select-item" data-index="${index}">
                        <input type="checkbox" class="knowledge-select-checkbox" data-index="${index}">
                        <div class="knowledge-select-content">
                            <div class="knowledge-select-header">
                                <span class="knowledge-select-source" title="${chunk.docName}${titleInfo}">${chunk.docName}</span>
                                ${resultBadge}
                                ${chunk.title ? `<span class="knowledge-select-title" title="${chunk.title}">${chunk.title}</span>` : ''}
                            </div>
                            <div class="knowledge-select-preview">${escapeHtml(previewText)}</div>
                            <div class="knowledge-select-actions">
                                <button class="knowledge-select-view-btn" data-index="${index}">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                    查看完整内容
                                </button>
                            </div>
                        </div>
                    </div>`;
            }).join('');
        }

        const footerHtml = chunks.length > 0 ? `
            <div class="bs-btn-row">
                <button type="button" class="secondary-btn" id="bsKnowledgeSelectAll">全选</button>
                <button type="button" class="bs-confirm-btn" id="bsKnowledgeSelectConfirm">确定发送</button>
            </div>` : '';

        knowledgeSelectSheet = createBottomSheetPanel({
            title: '知识库检索结果',
            content: `
                <div style="padding: 0 16px 8px; font-size: 13px; color: var(--text-secondary); text-align: center;">请选择要参考的知识库内容（可多选）</div>
                <div class="knowledge-select-list bs-panel-content" id="bsKnowledgeSelectList">${listHtml}</div>
                ${footerHtml}
            `,
            onClose: () => {
                if (knowledgeDetailSheet) { knowledgeDetailSheet.hide(); knowledgeDetailSheet = null; }
                knowledgeSelectSheet = null;
                if (knowledgeSelectResolve) {
                    knowledgeSelectResolve(null);
                    knowledgeSelectResolve = null;
                }
                pendingKnowledgeChunks = [];
                selectedKnowledgeChunks = new Set();
            },
        });
        knowledgeSelectSheet.show();

        // 绑定事件
        const bsList = document.getElementById('bsKnowledgeSelectList');
        if (bsList && chunks.length > 0) {
            bsList.querySelectorAll('.knowledge-select-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.knowledge-select-view-btn')) return;
                    const index = parseInt(item.dataset.index);
                    toggleKnowledgeSelectItem(index);
                });
            });
            bsList.querySelectorAll('.knowledge-select-checkbox').forEach(checkbox => {
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(checkbox.dataset.index);
                    toggleKnowledgeSelectItem(index);
                });
            });
            bsList.querySelectorAll('.knowledge-select-view-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(btn.dataset.index);
                    showKnowledgeDetail(index);
                });
            });
        }

        // 底部按钮事件
        const confirmBtn = document.getElementById('bsKnowledgeSelectConfirm');
        const allBtn = document.getElementById('bsKnowledgeSelectAll');

        if (confirmBtn) confirmBtn.addEventListener('click', () => closeKnowledgeSelectModal(false));
        if (allBtn) allBtn.addEventListener('click', () => {
            const allSelected = selectedKnowledgeChunks.size === pendingKnowledgeChunks.length;
            if (allSelected) {
                selectedKnowledgeChunks.clear();
            } else {
                pendingKnowledgeChunks.forEach((_, index) => {
                    selectedKnowledgeChunks.add(index);
                });
            }
            // 更新UI
            const list = document.getElementById('bsKnowledgeSelectList');
            if (list) {
                list.querySelectorAll('.knowledge-select-item').forEach(item => {
                    const idx = parseInt(item.dataset.index);
                    item.classList.toggle('selected', selectedKnowledgeChunks.has(idx));
                });
                list.querySelectorAll('.knowledge-select-checkbox').forEach(cb => {
                    const idx = parseInt(cb.dataset.index);
                    cb.checked = selectedKnowledgeChunks.has(idx);
                });
            }
        });
    });
}

// 切换知识库检索结果选中状态
function toggleKnowledgeSelectItem(index) {
    if (selectedKnowledgeChunks.has(index)) {
        selectedKnowledgeChunks.delete(index);
    } else {
        selectedKnowledgeChunks.add(index);
    }

    // 更新UI
    const list = document.getElementById('bsKnowledgeSelectList');
    if (list) {
        const item = list.querySelector(`.knowledge-select-item[data-index="${index}"]`);
        const checkbox = list.querySelector(`.knowledge-select-checkbox[data-index="${index}"]`);
        if (item && checkbox) {
            item.classList.toggle('selected', selectedKnowledgeChunks.has(index));
            checkbox.checked = selectedKnowledgeChunks.has(index);
        }
    }
}

// 显示知识库内容详情
function showKnowledgeDetail(index) {
    const chunk = pendingKnowledgeChunks[index];
    if (!chunk) return;

    if (knowledgeDetailSheet) { knowledgeDetailSheet.hide(); knowledgeDetailSheet = null; }

    const titleInfo = chunk.title ? ` [${chunk.title}]` : '';
    knowledgeDetailSheet = createBottomSheetPanel({
        title: `${chunk.docName}${titleInfo}`,
        content: `<div class="knowledge-detail-content" style="margin: 0 16px;">${formatMessage(chunk.text)}</div>`,
        onClose: () => {
            knowledgeDetailSheet = null;
            // 移除父级面板的拦截监听
            if (knowledgeSelectSheet) {
                knowledgeSelectSheet.overlay.removeEventListener('click', closeDetailOnly);
                knowledgeSelectSheet.panel.removeEventListener('click', closeDetailOnly);
            }
        },
    });
    knowledgeDetailSheet.show();

    // 点击父级面板时只关闭详情面板
    function closeDetailOnly(e) {
        if (knowledgeDetailSheet) {
            knowledgeDetailSheet.hide();
            knowledgeDetailSheet = null;
        }
    }
    if (knowledgeSelectSheet) {
        knowledgeSelectSheet.overlay.addEventListener('click', closeDetailOnly);
        knowledgeSelectSheet.panel.addEventListener('click', closeDetailOnly);
    }
}

// 关闭知识库检索选择弹窗
function closeKnowledgeSelectModal(cancelled = false) {
    // 先 resolve，再 hide（防止 hide 触发 onClose 提前 resolve(null) 覆盖结果）
    if (knowledgeSelectResolve) {
        if (cancelled) {
            knowledgeSelectResolve(null);
        } else {
            const selectedChunks = [...selectedKnowledgeChunks].map(index => pendingKnowledgeChunks[index]);
            knowledgeSelectResolve(selectedChunks);
        }
        knowledgeSelectResolve = null;
    }

    if (knowledgeSelectSheet) {
        knowledgeSelectSheet.hide();
        knowledgeSelectSheet = null;
    }

    pendingKnowledgeChunks = [];
    selectedKnowledgeChunks = new Set();
}


// ==================== 电脑端聊天（通过WebSocket）- 工具调用独立气泡 ====================
async function sendToPCChat(messageContent, displayContent, now) {
    if (!pcConnection.connected) {
        showToast('未连接到电脑端');
        isSending = false;
        sendBtn.disabled = false;
        stopBtn.style.display = 'none';
        return;
    }

    // 注意：用户消息和AI占位消息已在 sendMessage 中创建

    const chatId = 'chat_' + Date.now();
    currentPcChatId = chatId; // 保存到全局，供 stopGenerating 使用

    // 保存原始消息处理器并设置聊天处理器
    const originalHandleMessage = pcConnection._handleMessage;
    let _pcCurrentToolDiv = null; // 当前工具调用气泡 DOM
    let _pcCurrentToolId = null;  // 当前工具调用消息 ID

    // 辅助：保存当前文字气泡到 messages 数组
    async function _pcSaveCurrentTextBubble() {
        if (currentAiMessageDiv && currentAiContent.trim()) {
            const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
            messages.push(createAssistantMessage(currentAiContent.trim(), null, null, null, lastUserMsg ? lastUserMsg.id : null));
            await saveMessages(messages);
            currentAiMessageId = null;
            currentAiContent = '';
        }
    }

    // 辅助：创建新的 assistant 文字气泡
    function _pcCreateNewTextBubble() {
        currentAiMessageId = generateMessageId();
        currentAiContent = '';
        currentAiMessageDiv = appendMessage('assistant', '', true, false, Date.now(), selectedModel, null, 0, null, null, null, currentAiMessageId);
    }

    pcConnection._handleMessage = async function(msg) {
        if (msg.type === 'chat_chunk' && msg.id === chatId) {
            // 如果当前没有文字气泡，创建一个新的
            if (!currentAiMessageDiv) {
                _pcCreateNewTextBubble();
            }
            currentAiContent += msg.content;
            if (currentAiMessageDiv) {
                const contentEl = currentAiMessageDiv.querySelector('.message-content');
                if (contentEl) {
                    contentEl.innerHTML = formatMessage(currentAiContent);
                    contentEl.dataset.content = currentAiContent;
                }
            }
            scrollToBottom();
        } else if (msg.type === 'chat_tool' && msg.id === chatId) {
            // 工具调用开始 - 先保存当前文字气泡
            _pcSaveCurrentTextBubble();
            // 创建独立的工具调用气泡（参考 tool-calling.js 的 processToolCalls）
            let toolArgs = null;
            try { toolArgs = JSON.parse(msg.tool_args || '{}'); } catch(e) {}
            const params = getWebSearchToolParams(msg.tool_name || '', toolArgs);
            _pcCurrentToolId = generateMessageId();
            const toolCard = document.createElement('div');
            toolCard.className = 'tool-call-card';
            toolCard.dataset.messageId = _pcCurrentToolId;
            toolCard.innerHTML = `<div class="tool-call-header"><span class="tool-call-name">${escapeHtml(msg.tool_name || '')}</span><span class="tool-call-params">${escapeHtml(params)}</span></div><div class="tool-call-result">⎿ ...</div>`;
            chatContainer.appendChild(toolCard);
            _pcCurrentToolDiv = toolCard;
            // 保存 tool 消息到 messages
            const lastMsg = [...messages].reverse().find(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool');
            messages.push({
                id: _pcCurrentToolId,
                role: 'tool',
                content: '⎿ ...',
                tool_name: msg.tool_name || '',
                tool_args: toolArgs,
                timestamp: Date.now(),
                prevId: lastMsg ? lastMsg.id : getTopicRootId()
            });
            await saveMessages(messages);
            scrollToBottom();
        } else if (msg.type === 'chat_tool_result' && msg.id === chatId) {
            // 工具执行结果 - 更新工具气泡内容
            const summary = getWebSearchResultSummary(msg.tool_result || '');
            const isError = summary.startsWith('❌') || summary.startsWith('错误');
            if (_pcCurrentToolDiv) {
                const resultEl = _pcCurrentToolDiv.querySelector('.tool-call-result');
                if (resultEl) {
                    resultEl.className = `tool-call-result${isError ? ' error' : ''}`;
                    resultEl.textContent = `⎿ ${summary}`;
                }
                // 有 diffHtml 时渲染折叠 diff 卡片
                if (msg.diffHtml) {
                    const diffCard = document.createElement('div');
                    diffCard.className = 'diff-card';
                    const meta = msg.diffMeta || {};
                    const fileName = meta.path || '';
                    const addCount = meta.added || 0;
                    const delCount = meta.removed || 0;
                    diffCard.innerHTML = `
                        <div class="diff-header">
                            <span class="diff-filename">${escapeHtml(fileName)}</span>
                            <span class="diff-stats"><span class="diff-add">+${addCount}</span> <span class="diff-del">-${delCount}</span></span>
                            <span class="diff-toggle">▶</span>
                        </div>
                        <div class="diff-body">${msg.diffHtml}</div>
                    `;
                    diffCard.querySelector('.diff-header').addEventListener('click', () => {
                        diffCard.classList.toggle('expanded');
                        const toggle = diffCard.querySelector('.diff-toggle');
                        toggle.textContent = diffCard.classList.contains('expanded') ? '▼' : '▶';
                    });
                    _pcCurrentToolDiv.appendChild(diffCard);
                }
            }
            // 更新 messages 中的 tool 消息
            if (_pcCurrentToolId) {
                const toolMsg = messages.find(m => m.id === _pcCurrentToolId);
                if (toolMsg) {
                    toolMsg.content = summary;
                    toolMsg.diffHtml = msg.diffHtml || null;
                    toolMsg.diffMeta = msg.diffMeta || null;
                    await saveMessages(messages);
                }
            }
            _pcCurrentToolDiv = null;
            _pcCurrentToolId = null;
            scrollToBottom();
        } else if (msg.type === 'chat_confirm' && msg.id === chatId) {
            // 电脑端请求确认操作 - 在消息中显示确认按钮
            if (!currentAiMessageDiv) {
                _pcCreateNewTextBubble();
            }
            if (currentAiMessageDiv) {
                const contentEl = currentAiMessageDiv.querySelector('.message-content');
                if (contentEl) {
                    // 添加确认卡片
                    const diffPreviewHtml = msg.diffHtml ? `
                        <div class="confirm-diff-body">${msg.diffHtml}</div>
                    ` : '';
                    const confirmHtml = `
                        <div class="phone-confirm-card">
                            <div class="confirm-title">AI 请求执行操作</div>
                            <div class="confirm-desc">${escapeHtml(msg.desc || '')}</div>
                            ${diffPreviewHtml}
                            <div class="bs-btn-row">
                                <button class="secondary-btn phone-confirm-reject">拒绝</button>
                                <button class="bs-confirm-btn phone-confirm-allow">允许执行</button>
                            </div>
                        </div>
                    `;
                    const textContent = contentEl.dataset.content || '';
                    contentEl.innerHTML = formatMessage(textContent) + confirmHtml;
                    // 出现确认卡片：变紫色 + 提示音
                    onConfirmCardShow();

                    // 绑定按钮事件
                    const allowBtn = contentEl.querySelector('.phone-confirm-allow');
                    const rejectBtn = contentEl.querySelector('.phone-confirm-reject');

                    const sendResponse = (confirmed) => {
                        // 恢复停止按钮颜色
                        onConfirmCardClose();
                        // 移除按钮，显示状态
                        const card = contentEl.querySelector('.phone-confirm-card');
                        if (card) {
                            const statusClass = confirmed ? 'allowed' : 'rejected';
                            const statusText = confirmed ? '已允许执行' : '已拒绝';
                            card.innerHTML = `<div class="confirm-status ${statusClass}">${statusText}</div>`;
                        }
                        // 发送回复到电脑端
                        pcConnection.ws.send(JSON.stringify({
                            type: 'chat_confirm_response',
                            id: chatId,
                            confirmed: confirmed,
                            toolName: msg.tool_name,
                            args: msg.args
                        }));
                    };

                    if (allowBtn) allowBtn.addEventListener('click', () => sendResponse(true));
                    if (rejectBtn) rejectBtn.addEventListener('click', () => sendResponse(false));
                }
                scrollToBottom();
            }
        } else if (msg.type === 'chat_done' && msg.id === chatId) {
            // 完成 - 只保存最终文字气泡
            let finalText = '';
            if (msg.content) {
                finalText = msg.content;
            } else if (currentAiContent) {
                finalText = currentAiContent.trim();
            }
            if (!finalText) finalText = '（无回复）';
            if (currentAiMessageDiv) {
                const contentEl = currentAiMessageDiv.querySelector('.message-content');
                if (contentEl) {
                    contentEl.innerHTML = formatMessage(finalText);
                    contentEl.dataset.content = finalText;
                }
            }
            // 保存最终文字到 messages
            const lastMsgForPc = [...messages].reverse().find(m => m.role === 'user' || m.role === 'assistant');
            messages.push(createAssistantMessage(finalText, null, null, null, lastMsgForPc ? lastMsgForPc.id : null));
            await saveMessages(messages);
            // 确保当前话题标记为有内容（避免异步写入未完成导致检测不到）
            const pcTopic = agentTopics[currentAgentId]?.find(t => t.id === currentTopicId);
            if (pcTopic && !pcTopic.hasContent) {
                pcTopic.hasContent = true;
                saveAgentTopics();
            }
            isSending = false;
            sendBtn.disabled = false;
            stopBtn.style.display = 'none';
            currentAiMessageDiv = null;
            currentAiMessageId = null;
            currentAiContent = '';
            currentPcChatId = null;
            scrollToBottom();
            // 恢复原始消息处理器
            pcConnection._handleMessage = originalHandleMessage;
        } else if (msg.type === 'chat_error' && msg.id === chatId) {
            const errorContent = '❌ ' + (msg.error || '电脑端处理失败');
            if (currentAiMessageDiv) {
                const contentEl = currentAiMessageDiv.querySelector('.message-content');
                if (contentEl) {
                    contentEl.innerHTML = formatMessage(errorContent);
                    contentEl.dataset.content = errorContent;
                }
            }
            const lastUserMsgForPcErr = [...messages].reverse().find(m => m.role === 'user');
            messages.push(createAssistantMessage(errorContent, null, null, null, lastUserMsgForPcErr ? lastUserMsgForPcErr.id : null));
            await saveMessages(messages);
            // 确保当前话题标记为有内容（避免异步写入未完成导致检测不到）
            const pcTopic = agentTopics[currentAgentId]?.find(t => t.id === currentTopicId);
            if (pcTopic && !pcTopic.hasContent) {
                pcTopic.hasContent = true;
                saveAgentTopics();
            }
            isSending = false;
            sendBtn.disabled = false;
            stopBtn.style.display = 'none';
            messageInput.placeholder = '输入消息...';
            currentAiMessageDiv = null;
            currentAiMessageId = null;
            currentAiContent = '';
            currentPcChatId = null;
            // 恢复原始消息处理器
            pcConnection._handleMessage = originalHandleMessage;
        } else {
            // 其他消息交给原始处理器
            if (typeof originalHandleMessage === 'function') originalHandleMessage(msg);
        }
    };

    // 只发送用户消息文本，电脑端自己管理对话上下文和AI电脑管家智能体
    const userText = typeof messageContent === 'string' ? messageContent : displayContent;
    pcConnection.ws.send(JSON.stringify({
        type: 'chat_request',
        id: chatId,
        messages: [{ role: 'user', content: userText }]
    }));
}

// 发送消息
async function sendMessage() {
    onConfirmCardClose();
    unlockConfirmAudio();
    const content = messageInput.value.trim();
    const hasImages = pendingImages.length > 0;
    const hasFiles = pendingFiles.length > 0;

    // 如果没有文字也没有图片和文件，不发送
    if (!content && !hasImages && !hasFiles) return;
    if (isSending) return;
    if (!apiKey && currentAgentId !== PC_AGENT_ID) { showToast('请先设置 API Key'); showSettingsWithFade(() => { openModalWithFade(document.getElementById('aiProviderSettingsModal')); }); return; }

    // 权限申请 + 使用点统计
    if (currentAgentId !== PC_AGENT_ID) {
        // 触发权限申请（开屏广告依赖）
        if (window.AndroidBridge && window.AndroidBridge.requestAdPermissionNow) {
            window.AndroidBridge.requestAdPermissionNow();
        }
        await ensureUsagePoints();
        UsagePoints.addPoint(1);
    }

    // 检查是否需要生成话题名称（话题名称为"新话题"时才生成）
    const currentTopic = getCurrentAgentTopics().find(t => t.id === currentTopicId);
    const shouldGenerateTopicName = currentTopic && currentTopic.name === '新话题' && autoGenerateTopicName;
    // 快照话题ID和智能体ID，防止异步命名时用户已切换话题
    const topicNameTopicId = currentTopicId;
    const topicNameAgentId = currentAgentId;

    isSending = true;
    sendBtn.disabled = true;
    stopBtn.style.display = 'flex';  // 显示停止按钮
    messageInput.value = '';
    messageInput.style.height = 'auto';  // 恢复输入框高度

    // 发送消息时重置滚动状态
    if (isUserAtBottomTimer) { clearTimeout(isUserAtBottomTimer); isUserAtBottomTimer = null; }

    const now = new Date();

    // 构建消息内容
    let messageContent;
    let displayContent = content;

    // 保存图片数据用于显示（在清空 pendingImages 之前）
    let imagesForDisplay = [];
    if (hasImages) {
        imagesForDisplay = pendingImages.map(img => ({
            base64: img.base64,
            name: img.name
        }));
    }

    // 保存文件数据用于显示（在清空 pendingFiles 之前）
    let filesForDisplay = [];

    if (hasFiles) {
        filesForDisplay = pendingFiles.map(file => ({
            name: file.name,
            type: file.type,
            size: file.size,
            content: file.content,
            thumbnail: file.thumbnail,
            base64: file.base64,
            ext: file.ext
        }));
    }

    if (hasImages) {
        // 多模态消息（图片）
        messageContent = [];

        // 千问 Responses API 格式 或 豆包 Session 缓存格式
        if (currentAIProvider === 'qwen' || (currentAIProvider === 'doubao' && sessionCacheEnabled)) {
            // 先添加图片
            for (const img of pendingImages) {
                messageContent.push({
                    type: 'input_image',
                    image_url: img.base64
                });
            }
            // 再添加文本（如果有文件也合并）
            let textContent = content;
            if (hasFiles) {
                for (const file of pendingFiles) {
                    textContent += `\n\n--- 文件: ${file.name} ---\n${file.content}`;
                }
            }
            if (textContent) {
                messageContent.push({ type: 'input_text', text: textContent.trim() });
            }
        } else {
            // 其他提供商 Chat Completions API 格式
            let textContent = content;
            if (hasFiles) {
                for (const file of pendingFiles) {
                    textContent += `\n\n--- 文件: ${file.name} ---\n${file.content}`;
                }
            }
            if (textContent) {
                messageContent.push({ type: 'text', text: textContent.trim() });
            }
            // 添加图片
            for (const img of pendingImages) {
                messageContent.push({
                    type: 'image_url',
                    image_url: { url: img.base64 }
                });
            }
        }
        // 显示内容
        let displayParts = [];
        if (content) displayParts.push(content);
        if (hasFiles) displayParts.push(`[文件: ${pendingFiles.map(f => f.name).join('、')}]`);
        displayContent = displayParts.join('\n');
    } else if (hasFiles) {
        // 普通文件消息：将文件内容合并到文本中
        let fileText = content;
        for (const file of pendingFiles) {
            fileText += `\n\n--- 文件: ${file.name} ---\n${file.content}`;
        }
        messageContent = fileText.trim();
        // 显示内容：显示文件名列表
        const fileNames = pendingFiles.map(f => f.name).join('、');
        displayContent = content + (content ? '\n' : '') + `[文件: ${fileNames}]`;
    } else {
        // 纯文本消息
        messageContent = content;
    }

    // 清空待发送图片和文件
    clearPendingImages();
    clearPendingFiles();

    // 保存图片数据到全局存储（用于消息气泡显示）
    if (imagesForDisplay.length > 0) {
        const messageKey = 'user_' + now.getTime();
        sentImagesByMessage[messageKey] = imagesForDisplay;
        // 异步保存到 IndexedDB（持久化存储）
        saveImagesToDB(messageKey, imagesForDisplay);
    }

    // 保存文件数据到全局存储（用于消息气泡显示）
    if (filesForDisplay.length > 0) {
        const messageKey = 'user_' + now.getTime();
        sentFilesByMessage[messageKey] = filesForDisplay;
        // 异步保存到 IndexedDB（持久化存储）
        saveFilesToDB(messageKey, filesForDisplay);
    }

    const userMessageId = generateMessageId();
    const currentUserMessageDiv = appendMessage('user', displayContent, true, false, now, null, null, 0, imagesForDisplay, filesForDisplay, null, userMessageId);

    // 有默认开场白的智能体首次使用：保存默认开场白后再添加用户消息
    if (['wangzhaojun', 'translator', 'fullstack', 'screenwriter'].includes(currentAgentId) && messages.length === 1 && messages[0].role === 'assistant') {
        const topics = agentTopics[currentAgentId];
        const currentTopic = topics ? topics.find(t => t.id === currentTopicId) : null;
        if (currentTopic && currentTopic.isUserCreated === false) {
            await saveMessages(messages);
        }
    }

    // 获取上一条AI消息的ID，用于版本链式切换
    const prevAiId = getLastVisibleMsgIdByRole('assistant');

    messages.push({ id: userMessageId, role: 'user', content: messageContent, displayContent: displayContent, timestamp: now.getTime(), prevId: prevAiId || getTopicRootId() });

    // 发送消息后隐藏智能体标签栏（必须在 messages.push 之后调用）
    updateAgentTagsBarVisibility();

    const sendAiMsgId = generateMessageId();
    currentAiMessageDiv = appendMessage('ai', '正在思考...', true, false, now, null, null, 0, null, null, null, sendAiMsgId);
    currentAiMessageId = sendAiMsgId;
    currentAiContent = '';
    currentThinkingContent = '';
    currentAnnotations = null;
    resetStreamState();

    // 添加新 AI 消息后，立即更新重发按钮
    updateResendButtons();

    // 知识库检索：如果启用了知识库，先检索并让用户选择
    const statusElement = currentAiMessageDiv?.querySelector('.message-content');
    const userQuery = typeof messageContent === 'string' ? messageContent : content;
    const { context: knowledgeContext, cancelled } = await performKnowledgeSearch(userQuery, statusElement);

    if (cancelled) {
        // 用户取消了选择，取消整个发送操作
        console.log('用户取消了知识库内容选择，取消发送');

        // 移除刚添加的用户消息 DOM
        if (currentUserMessageDiv) {
            currentUserMessageDiv.remove();
        }

        // 移除刚添加的用户消息（从数组中）
        messages.pop();

        // 移除AI消息占位
        if (currentAiMessageDiv) {
            currentAiMessageDiv.remove();
        }

        // 恢复输入框内容
        messageInput.value = content;

        // 恢复图片预览
        if (imagesForDisplay.length > 0) {
            pendingImages = imagesForDisplay.map(img => ({
                base64: img.base64,
                name: img.name,
                id: Date.now() + Math.random().toString(36).substr(2, 9)
            }));
            renderImagePreviews();
        }

        // 恢复文件预览
        if (filesForDisplay.length > 0) {
            pendingFiles = filesForDisplay.map(file => ({
                ...file,
                id: Date.now() + Math.random().toString(36).substr(2, 9)
            }));
            renderFilePreviews();
        }

        // 更新发送按钮状态（在恢复所有内容后调用）
        updateSendBtnState();

        // 重置发送状态
        isSending = false;
        sendBtn.disabled = false;
        stopBtn.style.display = 'none';
        messageInput.placeholder = '输入消息...';

        // 更新按钮状态
        updateResendButtons();

        // 如果消息为空，显示欢迎语和智能体标签栏
        if (messages.length === 0) {
            showWelcomeMessage();
        }
        updateAgentTagsBarVisibility();

        return; // 直接返回，不继续发送
    }

    // 如果是电脑端智能体，通过WebSocket发送到电脑端
    if (currentAgentId === PC_AGENT_ID) {
        await sendToPCChat(messageContent, displayContent, now);
        return;
    }

    await startGeneration(false, null, knowledgeContext);

    // 如果话题名称为"新话题"，异步生成话题名称
    if (shouldGenerateTopicName) {
        generateTopicName(content, topicNameTopicId, topicNameAgentId);
    }
}

// 开始生成回复
// isRefresh: 是否为刷新操作（true：刷新AI回答，false：重发用户消息）
// targetMessage: 目标消息对象（用于添加新版本）
// knowledgeContext: 可选，知识库检索内容
async function startGeneration(isRefresh = false, targetMessage = null, knowledgeContext = null) {
    // 重置 atBottom 相关标志位，确保新对话能立即滚动
    if (isUserAtBottomTimer) { clearTimeout(isUserAtBottomTimer); isUserAtBottomTimer = null; }
    _cachedIsAtBottom = true;

    // 流式输出期间定时滚动
    startStreamScroll();

    // 生成期间保持屏幕常亮
    requestKeepScreenOn();

    currentAiContent = '';
    currentThinkingContent = '';
    currentAnnotations = null;
    resetStreamState();

    // 清理上一轮残留的 tool_calls 缓冲区，防止流式增量 arguments 拼接到旧数据上
    clearToolCallsBuffer();
    resetResponsesStreamState();

    // 创建 AbortController 用于停止生成
    abortController = new AbortController();

    const MAX_RETRIES = 10;
    let retryCount = 0;
    let lastError = null;
    let stopRequested = false;

    while (retryCount <= MAX_RETRIES) {
        if (stopRequested) break;
        try {
            if (retryCount > 0) {
                console.log(`====== 第 ${retryCount} 次重试 ======`);
                abortController = new AbortController();
            }
            // Hook: tool-calling.js 前置检查
            if (typeof checkToolCallingPrerequisites === 'function') {
                const errMsg = checkToolCallingPrerequisites();
                if (errMsg) {
                    appendToLastMessage(errMsg);
                    await saveMessages(messages);
                    // 释放屏幕常亮（不能直接 return，否则跳过 finally 块）
                    releaseKeepScreenOn();
                    isSending = false;
                    sendBtn.disabled = false;
                    stopBtn.style.display = 'none';
                    messageInput.placeholder = '输入消息...';
                    abortController = null;
                    stopStreamScroll();
                    return;
                }
            }
            await handleResponse(null, isRefresh, targetMessage, knowledgeContext);
            lastError = null;
            break;
        } catch (error) {
            lastError = error;
            if (error.name === 'AbortError') { stopRequested = true; break; }
            const isRetryable = error.message?.includes('Failed to fetch')
                || error.message?.includes('NetworkError')
                || error.message?.includes('网络请求失败')
                || error.message?.includes('net::')
                || error.message?.includes('ECONNRESET')
                || error.message?.includes('ETIMEDOUT')
                || error.message?.includes('socket hang up')
                || error.message?.includes('fetch failed')
                || error.message?.includes('远程主机强迫关闭')
                || /(?:HTTP |API 错误：)(429|[5]\d\d)/.test(error.message);
            if (!isRetryable || retryCount >= MAX_RETRIES) break;
            retryCount++;
            console.log(`请求失败（${error.message}），5秒后第 ${retryCount} 次重试...`);
            if (currentAiMessageDiv) {
                // 停止打字机，清空当前气泡已接收的内容，只显示重试提示
                flushStreamTypewriter();
                currentAiContent = '';
                currentThinkingContent = '';
                currentAnnotations = null;
                resetStreamState();
                _streamTypewriterTargetDiv = null;
                const messageContent = currentAiMessageDiv.querySelector('.message-content');
                if (messageContent) {
                    messageContent.innerHTML = formatMessage(`⏳ 连接中断，正在重试（${retryCount}/${MAX_RETRIES}）...`);
                    messageContent.dataset.content = '';
                    const thinkingDiv = messageContent.querySelector('.thinking-content');
                    if (thinkingDiv) thinkingDiv.remove();
                }
            }
            // 可中断的等待：用户点停止时立即结束等待
            await new Promise(resolve => {
                const timer = setTimeout(resolve, 5000);
                const checkStop = setInterval(() => {
                    if (!abortController || abortController.signal.aborted) {
                        clearTimeout(timer);
                        clearInterval(checkStop);
                        stopRequested = true;
                        resolve();
                    }
                }, 200);
            });
        }
    }

    try {
    const error = lastError;
    if (error) {
        console.error('发送消息失败:', error);

        // 出错时强制清理打字机，避免后台定时器继续运行覆盖错误提示 UI
        flushStreamTypewriter();

        // 刷新/重发场景：无论是否有内容，都保存为新版本（停止/出错提示也作为版本内容）
        if (targetMessage && targetMessage.versions) {
            // 没有实际内容时，用停止/错误提示填充
            const versionContent = currentAiContent || (error.name === 'AbortError' ? '⏹️ 已停止生成' : '❌ 错误：' + error.message);

            const partialVersion = createVersion(
                versionContent,
                currentThinkingContent || null,
                null,
                currentAnnotations,
                resendUserId
            );
            targetMessage.versions.push(partialVersion);
            targetMessage.currentVersionIndex = targetMessage.versions.length - 1;
            targetMessage.content = versionContent;
            targetMessage.reasoning = currentThinkingContent || null;
            targetMessage.timestamp = Date.now();
            targetMessage.modelName = selectedModel;
            targetMessage.annotations = currentAnnotations;
            resendUserId = null;

            // 通过 data-message-id 查找气泡 DOM
            const aiBubble = currentAiMessageId ? findMessageDivById(currentAiMessageId) : null;
            if (aiBubble) {
                const messageContent = aiBubble.querySelector('.message-content');
                if (messageContent) {
                    renderContentPreservingThinking(messageContent, versionContent);
                }
                updateVersionSwitcher(aiBubble, targetMessage);
            }

            await saveMessages(messages);
        } else {
            // 普通发送场景（非刷新/重发）的错误处理
            // 将停止/错误提示写入当前 AI 气泡，不新增气泡
            const errorContent = error.name === 'AbortError' ? '⏹️ 已停止生成' : '❌ 错误：' + error.message;
            const finalContent = currentAiContent || errorContent;

            const lastUserMsgForGen = [...messages].reverse().find(m => m.role === 'user');
            const partialMsg = createAssistantMessage(finalContent, currentThinkingContent || null, null, currentAnnotations, lastUserMsgForGen ? lastUserMsgForGen.id : null);

            // 通过 data-message-id 查找气泡 DOM
            const aiBubble = currentAiMessageId ? findMessageDivById(currentAiMessageId) : null;
            if (aiBubble) {
                const messageContent = aiBubble.querySelector('.message-content');
                if (messageContent) {
                    renderContentPreservingThinking(messageContent, finalContent);
                }
            }

            messages.push(partialMsg);
            await saveMessages(messages);
        }
    } // end if (error)
    } catch (err) {
        console.error('消息保存/错误处理异常:', err);
    } finally {
    // finally 逻辑
        // 生成结束时播放提示音（复用确认操作提示音开关和音量）
        if (confirmSoundSwitch && confirmSoundSwitch.checked) {
            try {
                if (!_confirmAudio) {
                    _confirmAudio = new Audio(NOTIFICATION_SOUND_DATA);
                }
                _confirmAudio.volume = confirmSoundVolume;
                _confirmAudio.currentTime = 0;
                _confirmAudio.play().catch(function(e){ console.warn('[gen-end-sound]', e); });
            } catch (e) {}
        }

        // 释放屏幕常亮
        releaseKeepScreenOn();
        isSending = false;
        sendBtn.disabled = false;
        stopBtn.style.display = 'none';  // 隐藏停止按钮
        messageInput.placeholder = '输入消息...';
        const _wasAborted = abortController && abortController.signal.aborted;
        abortController = null;
        // 重置重发状态
        resendUserId = null;
        skipNextCountUpdate = false;
        // 停止定时滚动并最终滚一次
        stopStreamScroll();
        // 回复完成后，沉浸模式重新计时隐藏
        if (isImmersiveMode()) {
            scheduleImmersiveHide();
        }
        // 回复生成完毕，不自动聚焦输入框，避免弹出输入法
        currentAiMessageDiv = null;
        currentAiMessageId = null;

        // 更新重发按钮显示状态
        updateResendButtons();

        // 记录常用模型
        updateFrequentModels();

        // 发送完成后清除选定的上下文
        if (selectedContextMessages.length > 0) {
            clearSelectedContext();
        }

        // 确保当前话题标记为有内容，并更新活跃时间（用于侧边栏排序）
        const currentTopic = agentTopics[currentAgentId]?.find(t => t.id === currentTopicId);
        if (currentTopic) {
            let changed = false;
            if (!currentTopic.hasContent) { currentTopic.hasContent = true; changed = true; }
            currentTopic.lastActiveTime = Date.now();
            changed = true;
            if (changed) saveAgentTopics();
        }

        // 用户主动停止时清理孤立的 tool 消息并刷新话题
        if (_wasAborted) {
            try {
                cascadeDeleteMessages([], 0);
                await switchAgentAndTopic(currentAgentId, currentTopicId);
            } catch (e2) {
                console.error('刷新话题失败:', e2);
            }
        }
    }
}

// 停止生成
function stopGenerating() {
    onConfirmCardClose();
    // 自动拒绝所有未处理的确认卡片
    document.querySelectorAll('.phone-confirm-card, .confirm-card').forEach(card => {
        if (card.querySelector('.bs-btn-row')) {
            const rejectBtn = card.querySelector('.phone-confirm-reject, .confirm-reject');
            if (rejectBtn) rejectBtn.click();
        }
    });
    if (abortController) {
        abortController.abort();
        // 立即中止所有正在进行的异步 HTTP 请求，避免无意义的网络等待
        if (typeof window.__abortAllHttpRequests === 'function') {
            window.__abortAllHttpRequests();
        }
        // 注意：不要置为 null！保留已 aborted 的 controller，
        // 让 tool-calling.js 中的 abort 检查能识别到"已停止"状态，
        // 避免 tool 回传后 AI 继续生成。
        // abortController = null;  // ← 移除这行
    }
    // 如果是电脑端智能体，通知电脑端停止
    if (currentAgentId === PC_AGENT_ID && pcConnection && pcConnection.connected) {
        try {
            pcConnection.ws.send(JSON.stringify({ type: 'chat_stop', id: currentPcChatId }));
        } catch (e) {
            console.log('发送停止消息失败:', e);
        }
    }
    isSending = false;
    sendBtn.disabled = false;
    stopBtn.style.display = 'none';
    // 重置重发状态，避免残留影响下次发送
    resendUserId = null;
    skipNextCountUpdate = false;
    // 停止时立即渲染全部内容
    flushStreamTypewriter();
    // 渲染完成后停止滚动定时器并最后滚一次
    stopStreamScroll();
}

stopBtn.addEventListener('click', stopGenerating);

// 笔记 - 点击标题栏中间区域触发
const headerCenter = document.querySelector('.header-center');

// 首次使用提示：点击进入笔记本（localStorage 标记，点击后永久取消）
const notebookHint = document.getElementById('notebookHint');
if (notebookHint && !localStorage.getItem('notebook_hint_dismissed')) {
    notebookHint.style.display = 'block';
    notebookHint.addEventListener('click', () => {
        notebookHint.style.display = 'none';
        localStorage.setItem('notebook_hint_dismissed', '1');
        const btn = document.getElementById('notebookOpenBtn');
        if (btn) btn.click();
    });
}

headerCenter.addEventListener('click', (e) => {
    // 如果点击的是提示框，跳过（提示框有自己的事件）
    if (e.target.closest('#notebookHint')) return;
    const btn = document.getElementById('notebookOpenBtn');
    if (btn) btn.click();
});

// 删除话题
if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        deleteTopic(currentTopicId);
    });
}

// 级联删除：从指定 id 出发，删除所有依赖的后续消息 + 孤儿清理
function cascadeDeleteMessages(startSearchIds, startIndex) {
    const toDelete = new Set();
    let searchSet = new Set(startSearchIds);
    
    // 级联查找
    while (searchSet.size > 0) {
        const nextIds = [];
        for (let i = startIndex; i < messages.length; i++) {
            if (toDelete.has(i)) continue;
            const msg = messages[i];
            if (msg.prevId && searchSet.has(msg.prevId)) {
                toDelete.add(i);
                if (msg.versions && msg.versions.length > 0) {
                    msg.versions.forEach(v => { if (v.id) nextIds.push(v.id); });
                }
                nextIds.push(msg.id);
            }
        }
        searchSet = new Set(nextIds);
    }
    
    // 清理断链的孤儿消息（rootId 不算断链）
    const rootId = getTopicRootId();
    let foundOrphans = true;
    while (foundOrphans) {
        foundOrphans = false;
        const remainingIds = new Set([rootId]);
        for (let i = 0; i < messages.length; i++) {
            if (!toDelete.has(i)) {
                remainingIds.add(messages[i].id);
                if (messages[i].versions) {
                    messages[i].versions.forEach(v => { if (v.id) remainingIds.add(v.id); });
                }
            }
        }
        for (let i = 0; i < messages.length; i++) {
            if (toDelete.has(i)) continue;
            const msg = messages[i];
            if (msg.prevId && !remainingIds.has(msg.prevId)) {
                toDelete.add(i);
                foundOrphans = true;
            }
        }
    }
    
    // 执行删除（从后往前 splice）
    if (toDelete.size > 0) {
        const deleteIndices = Array.from(toDelete).sort((a, b) => a - b);
        for (let i = deleteIndices.length - 1; i >= 0; i--) {
            messages.splice(deleteIndices[i], 1);
        }
    }
    return toDelete.size;
}

// 删除消息
async function deleteMessage(messageDiv, index) {

    // 优先通过 ID 查找消息
    const msgId = getMessageIdFromDiv(messageDiv);
    let messageData;
    let actualIndex;
    if (msgId) {
        actualIndex = findMessageIndexById(msgId);
        messageData = actualIndex >= 0 ? messages[actualIndex] : null;
    } else {
        // 兼容旧逻辑：通过 DOM 索引
        actualIndex = index;
        messageData = messages[index];
    }
    
    // 如果是 AI 消息且有多个版本，只删除当前版本
    if (messageData && messageData.role === 'assistant' && messageData.versions && messageData.versions.length > 1) {
        const currentIndex = messageData.currentVersionIndex || 0;

        // 删除当前版本
        const deletedVersion = messageData.versions[currentIndex];
        messageData.versions.splice(currentIndex, 1);

        // 调整当前版本索引
        if (messageData.currentVersionIndex >= messageData.versions.length) {
            messageData.currentVersionIndex = messageData.versions.length - 1;
        }

        // 更新主消息内容为新版本
        const newCurrentVersion = messageData.versions[messageData.currentVersionIndex];
        messageData.content = newCurrentVersion.content;
        messageData.reasoning = newCurrentVersion.reasoning;
        messageData.timestamp = newCurrentVersion.timestamp;
        messageData.modelName = newCurrentVersion.modelName;

        // 更新 UI
        const messageContent = messageDiv.querySelector('.message-content');

        // 移除旧的思考内容
        const existingThinking = messageContent.querySelector('.thinking-content');
        if (existingThinking) {
            existingThinking.remove();
        }
        const expandHint = messageDiv.querySelector('.thinking-expand-hint');
        if (expandHint) {
            expandHint.style.display = 'none';
        }

        // 更新内容
        messageContent.innerHTML = formatMessage(newCurrentVersion.content);
        messageContent.dataset.content = newCurrentVersion.content;

        // 添加思考内容（如果有）
        if (newCurrentVersion.reasoning) {
            prependThinking(messageDiv, newCurrentVersion.reasoning);
        }

        // 更新时间戳
        const timestampSpan = messageDiv.querySelector('.message-timestamp');
        if (timestampSpan && newCurrentVersion.timestamp) {
            timestampSpan.textContent = formatTimestamp(new Date(newCurrentVersion.timestamp));
        }

        // 更新模型名称标签
        const modelNameSpan = messageDiv.querySelector('.message-model-name');
        if (modelNameSpan && newCurrentVersion.modelName) {
            // 获取当前 AI 消息编号（从模型名称标签中提取）
            const currentLabel = modelNameSpan.textContent;
            const match = currentLabel.match(/\|\s*(\d+)/);
            const aiNumber = match ? match[1] : '1';
            modelNameSpan.textContent = `${newCurrentVersion.modelName} | ${aiNumber}`;
        }

        // 更新版本切换器
        if (messageData.versions.length > 1) {
            updateVersionSwitcher(messageDiv, messageData);
        } else {
            // 只剩一个版本，移除版本切换器
            const versionSwitcher = messageDiv.querySelector('.version-switcher');
            if (versionSwitcher) {
                versionSwitcher.remove();
            }
        }

        await saveMessages(messages);
        showToast('已删除该版本');

        // 级联删除：后续依赖被删版本的消息 + 孤儿清理
        const deletedCount = cascadeDeleteMessages([deletedVersion.id], actualIndex + 1);
        if (deletedCount > 0) {
            updateCacheOptimizeCount();
            updateAiMessageNumbers();
        }

        // 删除后重新渲染当前话题（内部会 saveMessages + 从DB重新加载）
        await switchAgentAndTopic(currentAgentId, currentTopicId);
        return;
    }

    // 统一删除：从起始消息的 id + 所有版本 id 出发，级联删除
    const searchIds = [messageData.id];
    if (messageData.versions && messageData.versions.length > 0) {
        messageData.versions.forEach(v => { if (v.id) searchIds.push(v.id); });
    }
    messages.splice(actualIndex, 1);  // 先删除起始消息
    const cascadedCount = cascadeDeleteMessages(searchIds, 0);
    const deleteCount = cascadedCount + 1;  // +1 是起始消息本身

    updateCacheOptimizeCount();

    showToast(`已删除 ${deleteCount} 条消息`);
    // 删除后重新渲染当前话题（内部会 saveMessages + 从DB重新加载）
    await switchAgentAndTopic(currentAgentId, currentTopicId);
    return;

}

// 生成话题名称（七字古诗格式）
async function generateTopicName(firstMessage, targetTopicId, targetAgentId) {
    const agent = getCurrentAgent();
    const agentDesc = agent.systemPrompt || agent.name;

    const prompt = topicNamePrompt
        ? topicNamePrompt.replace(/{agentDesc}/g, agentDesc).replace(/{firstMessage}/g, firstMessage)
        : '请概括以下对话的主题，控制在10个字以内：' + firstMessage;

    try {
        // 构建请求体，禁用深度思考模式
        const requestBody = {
            model: selectedModel,
            messages: [
                { role: 'user', content: prompt }
            ],
            max_tokens: 50,
            temperature: 0.7
        };

        // 根据不同服务商禁用深度思考
        let _effectiveProvider = currentAIProvider;
        if (currentAIProvider.startsWith('custom_')) {
            const _cp = customProviders.find(p => p.id === currentAIProvider);
            if (_cp && _cp.refProvider) _effectiveProvider = _cp.refProvider;
        }
        if (_effectiveProvider === 'qwen') {
            // 千问模型使用 enable_thinking: false
            requestBody.enable_thinking = false;
        } else if (_effectiveProvider === 'doubao' || _effectiveProvider === 'glm' || _effectiveProvider === 'mimo' || _effectiveProvider === 'deepseek') {
            // 豆包、智谱清言、MiMo、DeepSeek 使用 thinking.type: "disabled"
            requestBody.thinking = { type: "disabled" };
        } else if (_effectiveProvider === 'minimax') {
            // MiniMax-M3 关闭思考时传 thinking: {type: "disabled"}
            const _isMinimaxM3 = typeof selectedModel !== 'undefined' && selectedModel === 'MiniMax-M3';
            if (_isMinimaxM3) {
                requestBody.thinking = { type: "disabled" };
            }
            // 其他 MiniMax 模型不需要禁用深度思考，因为默认关闭
        }
        // 其他自定义服务商不需要特殊处理

        // 生成话题名称不需要 Session 缓存，始终使用 chat/completions 端点
        console.log('===== 生成话题名称请求体 =====');
        console.log('topicNamePrompt:', topicNamePrompt);
        console.log('requestBody:', JSON.stringify(requestBody, null, 2));
        console.log('============================');
        let apiEndpoint;
        // 检查是否为自定义服务商
        if (currentAIProvider.startsWith('custom_')) {
            const provider = customProviders.find(p => p.id === currentAIProvider);
            if (provider) {
                let baseUrl = provider.baseUrl.replace(/\/+$/, '');
                // 自定义服务商统一使用 chat/completions 端点生成话题名称
                apiEndpoint = baseUrl + '/chat/completions';
            }
        } else if (currentAIProvider === 'deepseek') {
            apiEndpoint = 'https://api.deepseek.com/chat/completions';
        } else if (currentAIProvider === 'mimo') {
            apiEndpoint = 'https://api.xiaomimimo.com/v1/chat/completions';
        } else if (currentAIProvider === 'minimax') {
            apiEndpoint = 'https://api.minimaxi.com/v1/chat/completions';
        } else if (currentAIProvider === 'kimi') {
            apiEndpoint = 'https://api.moonshot.cn/v1/chat/completions';
        } else if (currentAIProvider === 'doubao') {
            apiEndpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
        } else if (currentAIProvider === 'glm') {
            apiEndpoint = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
        } else {
            apiEndpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
        }

        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log('生成话题名称失败:', response.status, errorText);
            return;
        }

        const data = await response.json();

        let topicName = data.choices?.[0]?.message?.content?.trim() || '';
        console.log('[话题命名] API返回原文:', topicName);

        // 清理输出，只保留中文字符
        topicName = topicName.replace(/[^\u4e00-\u9fa5]/g, '');

        // 限制为二十个字
        if (topicName.length > 20) {
            topicName = topicName.substring(0, 20);
        }

        if (topicName.length > 0) {
            // 用快照ID查找话题，避免异步期间用户切换了话题
            const topics = agentTopics[targetAgentId];
            if (topics) {
                const topicIndex = topics.findIndex(t => t.id === targetTopicId);
                if (topicIndex !== -1) {
                    topics[topicIndex].name = topicName;
                    saveAgentTopics();
                    // 只有用户还在当前话题时才更新UI
                    if (currentTopicId === targetTopicId && currentAgentId === targetAgentId) {
                        updateTopicDisplay();
                    }
                }
            }
        }
    } catch (error) {
        console.log('生成话题名称出错:', error);
    }
}

// 重新发送用户消息（刷新回答也复用此逻辑，传入上一条用户消息即可）
async function regenerateMessage(messageDiv, index) {
    // 如果正在发送中，不允许操作
    if (isSending) {
        showToast('正在生成中，请稍候再试');
        return;
    }

    // 检查 API Key
    if (!apiKey) {
        showToast('请先设置 API Key');
        showSettings();
        return;
    }

    // 优先通过 ID 查找消息
    const msgId = getMessageIdFromDiv(messageDiv);
    let actualIndex;
    if (msgId) {
        actualIndex = findMessageIndexById(msgId);
        if (actualIndex < 0) actualIndex = index; // 兼容回退
    } else {
        actualIndex = index;
    }
    
    // 检查消息是否存在
    const userMsg = messages[actualIndex];
    if (!userMsg) {
        showToast('消息不存在');
        return;
    }

    let targetMessage = null;

    // 重发：获取用户消息后的AI消息，生成新版本（不删除任何消息）
    let existingAiMessageIndex = actualIndex + 1;
    resendUserId = messages[actualIndex] ? messages[actualIndex].id : null;

    if (existingAiMessageIndex < messages.length) {
        const originalMsg = messages[existingAiMessageIndex];
        if (originalMsg && originalMsg.role === 'assistant') {
            targetMessage = originalMsg;

            // 初始化 versions 数组
            ensureMessageVersions(targetMessage);

            // 豆包 Session 缓存：保存上一条 AI 消息的 responseId
            savePreviousResponseId(targetMessage, existingAiMessageIndex);

            // 移除旧链的 DOM 元素（tool-call-card、中间 assistant 气泡）
            const chainIds = new Set();
            chainIds.add(targetMessage.id);
            let searchIds = [targetMessage.id];
            while (searchIds.length > 0) {
                const nextIds = [];
                for (let i = existingAiMessageIndex + 1; i < messages.length; i++) {
                    const m = messages[i];
                    if (m.prevId && searchIds.includes(m.prevId) && !chainIds.has(m.id)) {
                        chainIds.add(m.id);
                        nextIds.push(m.id);
                    }
                }
                searchIds = nextIds;
            }
            for (const chainId of chainIds) {
                if (chainId === targetMessage.id) continue;
                const msgDiv = findMessageDivById(chainId);
                if (msgDiv) msgDiv.style.display = 'none';
                chatContainer.querySelectorAll(`.tool-call-card[data-message-id="${chainId}"]`).forEach(el => el.style.display = 'none');
            }

            // 不移除 AI 消息，复用旧 div 进行流式输出
            const aiMsgDiv = messageDiv.nextElementSibling;
            if (aiMsgDiv && aiMsgDiv.classList.contains('ai')) {
                // 清空旧内容，准备接收新内容
                const msgContent = aiMsgDiv.querySelector('.message-content');
                if (msgContent) {
                    msgContent.innerHTML = '正在思考…';
                    msgContent.dataset.content = '正在思考…';
                }
                // 移除旧的思考内容
                const oldThinking = aiMsgDiv.querySelector('.thinking-content');
                if (oldThinking) oldThinking.remove();
                const oldExpandHint = aiMsgDiv.querySelector('.thinking-expand-hint');
                if (oldExpandHint) oldExpandHint.style.display = 'none';
                // 移除旧的引用来源
                const oldAnnotations = aiMsgDiv.querySelector('.message-annotations');
                if (oldAnnotations) oldAnnotations.remove();
                // 移除旧的版本切换器（后面会重新添加）
                const oldSwitcher = aiMsgDiv.querySelector('.version-switcher');
                if (oldSwitcher) oldSwitcher.remove();
                // 设为流式输出目标
                currentAiMessageDiv = aiMsgDiv;
                aiMsgDiv.style.display = ''; // 确保可见
            }
        }
    }

    // 重发：后续消息全部隐藏（AI 消息除外，已在上面处理）
    let nextSibling = messageDiv.nextElementSibling;
    while (nextSibling) {
        if (nextSibling !== currentAiMessageDiv) {
            nextSibling.style.display = 'none';
        }
        nextSibling = nextSibling.nextElementSibling;
    }

    console.log('====== 重新发送 ======');

    console.log('index:', index);
    console.log('targetMessage:', targetMessage);
    console.log('messages:', messages);
    console.log('========================');

    // 跳过计数变化
    skipNextCountUpdate = true;

    // 开始生成
    isSending = true;
    sendBtn.disabled = true;
    stopBtn.style.display = 'flex';

    const now = new Date();
    if (!currentAiMessageDiv) {
        // 没有复用的旧 div，创建新的
        const resendAiMsgId = generateMessageId();
        currentAiMessageDiv = appendMessage('ai', '正在思考...', true, false, now, null, null, 0, null, null, null, resendAiMsgId);
        currentAiMessageId = resendAiMsgId;
    }
    currentAiContent = '';
    currentThinkingContent = '';
    currentAnnotations = null;
    resetStreamState();

    // 知识库检索：如果启用了知识库，先检索并让用户选择
    // 获取用户消息内容作为查询
    let userQuery = null;
    const userMessage = messages[actualIndex];
    if (userMessage && userMessage.role === 'user') {
        userQuery = userMessage.content;
    }

    const statusElement = currentAiMessageDiv?.querySelector('.message-content');
    const { context: knowledgeContext, cancelled } = await performKnowledgeSearch(userQuery, statusElement);

    if (cancelled) {
        // 用户取消了选择，取消整个操作
        console.log('用户取消了知识库内容选择，取消操作');

        // 恢复消息状态（消息没有被移除，只需重新渲染）
        renderMessagesToChat(messages);

        // 重置发送状态
        isSending = false;
        sendBtn.disabled = false;
        stopBtn.style.display = 'none';
        messageInput.placeholder = '输入消息...';
        skipNextCountUpdate = false;

        // 更新按钮状态
        updateResendButtons();

        return; // 直接返回，不继续
    }

    await startGeneration(true, targetMessage, knowledgeContext);
}

// 编辑消息
function editMessage(messageDiv, index) {
    // 优先通过 ID 查找消息
    const msgId = getMessageIdFromDiv(messageDiv);
    let actualIndex;
    if (msgId) {
        actualIndex = findMessageIndexById(msgId);
        if (actualIndex < 0) actualIndex = index; // 兼容回退
    } else {
        actualIndex = index;
    }
    
    const messageContent = messageDiv.querySelector('.message-content');
    const currentContent = messageContent.dataset.content;
    const contentWrapper = messageDiv.querySelector('.message-content-wrapper');
    const thinkingDiv = messageContent.querySelector('.thinking-content');
    const actionsDiv = messageDiv.querySelector('.message-actions');

    createBottomSheetInput({
        title: '编辑消息',
        value: currentContent,
        inputType: 'textarea',
        confirmText: '保存',
        onConfirm: async (newContent) => {
            newContent = newContent.trim();
            if (!newContent) {
                alert('消息内容不能为空');
                return;
            }
            if (newContent === currentContent) {
                return;
            }

            renderContentPreservingThinking(messageContent, newContent);

            const msg = messages[actualIndex];
            msg.content = newContent;
            msg.spareField1 = 1;
            if (msg.role === 'user' && msg.displayContent !== undefined) {
                msg.displayContent = newContent;
            }

            if (msg.versions && msg.versions.length > 0) {
                const currentIndex = msg.currentVersionIndex || 0;
                msg.versions[currentIndex].content = newContent;
            }

            if (messages[actualIndex].role === 'assistant' && ((currentAIProvider === 'doubao' && sessionCacheEnabled) || currentAIProvider === 'qwen')) {
                if (messages[actualIndex].responseId) {
                    console.log('编辑AI消息，清除当前responseId:', messages[actualIndex].responseId);
                    delete messages[actualIndex].responseId;
                }
                if (messages[actualIndex].versions) {
                    messages[actualIndex].versions.forEach(version => {
                        if (version.responseId) {
                            console.log('清除当前消息版本的responseId:', version.responseId);
                            delete version.responseId;
                        }
                    });
                }
                if (messages[actualIndex]._previousResponseId) {
                    console.log('清除当前消息的_previousResponseId:', messages[actualIndex]._previousResponseId);
                    delete messages[actualIndex]._previousResponseId;
                }
                for (let i = actualIndex + 1; i < messages.length; i++) {
                    if (messages[i].role === 'assistant') {
                        if (messages[i].responseId) {
                            console.log('清除后续AI消息responseId:', messages[i].responseId);
                            delete messages[i].responseId;
                        }
                        if (messages[i].versions) {
                            messages[i].versions.forEach(version => {
                                if (version.responseId) {
                                    console.log('清除后续消息版本的responseId:', version.responseId);
                                    delete version.responseId;
                                }
                            });
                        }
                        if (messages[i]._previousResponseId) {
                            console.log('清除后续消息的_previousResponseId:', messages[i]._previousResponseId);
                            delete messages[i]._previousResponseId;
                        }
                    }
                }
            }

            await saveMessages(messages);
            if (actionsDiv) actionsDiv.style.display = 'flex';
            updateResendButtons();
            showToast('已保存');
        },
    }).show();

    // 底部面板关闭时（取消）恢复操作按钮
    // 监听遮罩点击即可，因为取消也会关闭面板
    // 用 MutationObserver 或 setTimeout 延迟恢复
    // 简单方案：在 onConfirm 中已处理，取消时也需要恢复
    // createBottomSheetInput 没有 onCancel 回调，用 overlay click 恢复
    setTimeout(() => {
        const overlay = document.querySelector('.bs-overlay:last-of-type');
        if (overlay) {
            overlay.addEventListener('click', () => {
                if (actionsDiv) actionsDiv.style.display = 'flex';
            }, { once: true });
        }
    }, 50);
}

// 复制消息
async function copyMessage(content) {
    try {
        await navigator.clipboard.writeText(content);
        showToast('已复制到剪贴板');
    } catch (err) {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('已复制到剪贴板');
    }
}

// 为消息添加事件委托
chatContainer.addEventListener('click', (e) => {
    // 处理版本切换按钮
    const versionNavBtn = e.target.closest('.version-nav-btn');
    if (versionNavBtn) {
        e.stopPropagation();
        const messageDiv = versionNavBtn.closest('.message');
        const direction = versionNavBtn.classList.contains('version-prev-btn') ? 'prev' : 'next';
        if (messageDiv) {
            switchMessageVersion(messageDiv, direction);
        }
        return;
    }

    // 处理思考框折叠/展开按钮
    const collapseBtn = e.target.closest('.thinking-collapse-btn');
    if (collapseBtn) {
        e.stopPropagation();
        const messageDiv = collapseBtn.closest('.message');
        const thinkingDiv = collapseBtn.closest('.thinking-content');
        if (messageDiv && thinkingDiv) {
            const isCollapsed = thinkingDiv.classList.contains('collapsed');
            toggleThinkingCollapse(messageDiv, thinkingDiv, !isCollapsed);
        }
        return;
    }

    const actionBtn = e.target.closest('.message-action-btn');
    if (actionBtn) {
        const messageDiv = actionBtn.closest('.message');
        const messageContent = messageDiv.querySelector('.message-content');
        const content = messageContent.dataset.content;

        // 优先通过 ID 查找消息索引
        const msgId = getMessageIdFromDiv(messageDiv);
        let index = -1;
        if (msgId) {
            index = findMessageIndexById(msgId);
        }

        // 回退：用 timestamp + role 查找
        if (index === -1) {
            const timestamp = messageDiv.dataset.timestamp;
            const isUserMessage = messageDiv.classList.contains('user');
            const msgRole = isUserMessage ? 'user' : 'assistant';
            if (timestamp) {
                index = messages.findIndex(m =>
                    m.timestamp == timestamp && m.role === msgRole
                );
            }
        }

        // 最终回退到 DOM 索引
        if (index === -1) {
            index = Array.from(chatContainer.querySelectorAll('.message')).indexOf(messageDiv);
        }

        if (actionBtn.classList.contains('copy-btn')) {
            copyMessage(content);
        } else if (actionBtn.classList.contains('edit-btn')) {
            editMessage(messageDiv, index);
        } else if (actionBtn.classList.contains('delete-btn')) {
            if (confirm('删除这条消息将同时删除后续所有关联消息，确定要删除吗？')) {
                deleteMessage(messageDiv, index);
            }
        } else if (actionBtn.classList.contains('resend-btn')) {
            regenerateMessage(messageDiv, index);
        }
    }
});

// 事件监听
sendBtn.addEventListener('click', () => {
    sendMessage();
});
messageInput.addEventListener('keydown', (e) => {
    // 仅桌面端支持回车发送，手机端回车为换行
    if (e.key === 'Enter' && !e.shiftKey && !isMobileMode) {
        e.preventDefault();
        if (messageInput.value.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0) {
            sendMessage();
        }
    }
});

// 中文输入法优化：处理合成事件
let isComposing = false;

messageInput.addEventListener('compositionstart', () => {
    isComposing = true;
});

messageInput.addEventListener('compositionend', () => {
    isComposing = false;
    // 合成结束后，更新发送按钮状态
    updateSendBtnState();
});

// textarea 输入框高度自适应
messageInput.addEventListener('input', function () {
    if (isComposing) return;

    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';

    // 更新发送按钮状态（发送/添加话题）
    updateSendBtnState();
});

// 修复部分安卓机型长按全选删除后输入框无法点击的问题
// 全局监听所有 input/textarea 的选区状态，通知 Java 侧拦截 IME 删除
document.addEventListener('select', function (e) {
    var el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        var hasSel = el.selectionStart !== el.selectionEnd;
        if (window.InputFix) {
            InputFix.setSelectionState(hasSel);
        }
    }
}, true);
document.addEventListener('blur', function (e) {
    var el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        if (window.InputFix) {
            InputFix.setSelectionState(false);
        }
    }
}, true);

// 更新发送按钮状态（发送按钮已改为长显，此函数保留为空避免大量调用点报错）
function updateSendBtnState() {
}

// 弹窗内输入框聚焦时滚动到可视区域
function setupModalInputListeners() {
    const modalInputs = document.querySelectorAll('#settingsModal input, #settingsModal textarea, .sub-settings-modal input, .sub-settings-modal textarea, #agentEditModal input, #agentEditModal textarea');
    modalInputs.forEach(input => {
        // 移除旧的事件监听器（如果存在）
        input.removeEventListener('focus', input.focusListener);

        input.focusListener = function () {
            setTimeout(() => {
                const modalBody = this.closest('.modal-body');
                if (modalBody) {
                    this.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 300);
        };
        input.addEventListener('focus', input.focusListener);
    });
}

// 在显示设置和编辑弹窗时调用
const originalShowSettings = showSettings;
showSettings = function () {
    originalShowSettings();
    setTimeout(setupModalInputListeners, 100);
};

settingsBtn.addEventListener('click', () => {
    console.log('[动画锁] settingsBtn(from drawer)', Date.now());
    // 链式动画：侧边栏从右往左淡出，设置从右往左淡入
    const settingsInner = settingsModal.querySelector('.modal.fullscreen-modal');

    // 更新设置UI
    if (knowledgeBaseSwitch) knowledgeBaseSwitch.checked = knowledgeBaseEnabled;
    if (maxKnowledgeChunksInput) maxKnowledgeChunksInput.value = maxKnowledgeChunks;
    if (maxKeywordChunksInput) maxKeywordChunksInput.value = maxKeywordChunks;
    updateAIProviderSelectDisplay();
    updateModelSelectDisplay();
    updateGetApiKeyBtnState();

    settingsModal.classList.add('active');

    // 侧边栏向左滑出
    topicDrawer.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    topicDrawer.style.transform = 'translateX(-10%)';
    // 设置页从右滑入
    settingsInner.style.transition = 'none';
    settingsInner.style.transform = 'translateX(30%)';
    void settingsInner.offsetHeight;
    settingsInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    settingsInner.style.transform = 'translateX(0)';
    setTimeout(() => {
        topicDrawer.classList.remove('active');
        topicDrawerOverlay.classList.remove('active');
        topicDrawer.style.transition = '';
        topicDrawer.style.transform = '';
        topicDrawer.style.opacity = '';
        document.body.classList.remove('drawer-open');
        settingsInner.style.transition = '';
        settingsInner.style.transform = '';
        settingsInner.style.opacity = '';
    }, 250);
    panelStack.push(topicDrawer);
    currentPanel = settingsInner;
});

// ============ 设置项实时保存事件监听 ============

// API Key
apiKeyInput.addEventListener('change', saveApiKey);
apiKeyInput.addEventListener('blur', saveApiKey);

// 流式输出
streamOutputSwitch.addEventListener('change', saveStreamOutput);

// 深度思考
deepThinkingSwitch.addEventListener('change', saveDeepThinking);

// 上下文轮数（普通/专家）
contextLimitNormalInput.addEventListener('change', saveContextLimitNormal);
contextLimitExpertInput.addEventListener('change', saveContextLimitExpert);

// 消息分页大小
pageSizeInput.addEventListener('change', savePageSize);

// 最大 Token 数
maxTokensInput.addEventListener('change', saveMaxTokens);

// 温度
temperatureInput.addEventListener('change', saveTemperature);

// Top P
topPInput.addEventListener('change', saveTopP);

// 字体大小
fontSizeInput.addEventListener('change', saveFontSize);

// 通用：将输入框绑定到底部弹出输入面板
function bindBottomSheetInput(inputEl, { title, placeholder, inputType, maxLength, confirmText, defaultValue } = {}) {
    if (!inputEl) return;
    const isTextarea = inputEl.tagName === 'TEXTAREA';
    const label = inputEl.closest('.form-group')?.querySelector('label');
    const titleText = title || (label ? label.textContent.trim() : '');
    const ph = placeholder || inputEl.placeholder || '';
    const type = inputType || (isTextarea ? 'textarea' : inputEl.type === 'password' ? 'password' : inputEl.type === 'number' ? 'number' : 'text');
    const ml = maxLength || (inputEl.maxLength > 0 ? inputEl.maxLength : undefined);
    const minVal = inputEl.min !== '' ? inputEl.min : undefined;
    const maxVal = inputEl.max !== '' ? inputEl.max : undefined;
    const stepVal = inputEl.step !== '' ? inputEl.step : undefined;

    // 设为只读，阻止原生键盘
    inputEl.readOnly = true;
    inputEl.style.cursor = 'pointer';
    inputEl.addEventListener('click', () => {
        createBottomSheetInput({
            title: titleText,
            placeholder: ph,
            value: inputEl.value,
            inputType: type,
            maxLength: ml,
            min: minVal,
            max: maxVal,
            step: stepVal,
            defaultValue: defaultValue,
            confirmText: confirmText || '确定',
            onConfirm: (val) => {
                inputEl.value = val;
                inputEl.dispatchEvent(new Event('change'));
            },
        }).show();
    });
}

// 设置界面输入框绑定底部弹出面板
bindBottomSheetInput(fontSizeInput, { defaultValue: '16' });
bindBottomSheetInput(contextLimitNormalInput, { defaultValue: '100' });
bindBottomSheetInput(contextLimitExpertInput, { defaultValue: '30' });
bindBottomSheetInput(pageSizeInput, { defaultValue: '1000' });
bindBottomSheetInput(maxTokensInput, { defaultValue: '4096' });
bindBottomSheetInput(temperatureInput, { defaultValue: '1.14' });
bindBottomSheetInput(topPInput, { defaultValue: '0.5' });
bindBottomSheetInput(sessionExpireInput, { defaultValue: '1' });
bindBottomSheetInput(apiKeyInput);
bindBottomSheetInput(customRequestBodyInput);
bindBottomSheetInput(agentNameInput);
bindBottomSheetInput(agentSystemInput);
bindBottomSheetInput(document.getElementById('customProviderName'));
bindBottomSheetInput(document.getElementById('customProviderBaseUrl'));
bindBottomSheetInput(document.getElementById('customProviderModelInput'));
bindBottomSheetInput(maxKnowledgeChunksInput, { defaultValue: '3' });
bindBottomSheetInput(maxKeywordChunksInput, { defaultValue: '1' });
bindBottomSheetInput(document.getElementById('pcServerIP'));
bindBottomSheetInput(document.getElementById('pcPairCodeInput'));
bindBottomSheetInput(document.getElementById('cloudUsernameInput'));
bindBottomSheetInput(document.getElementById('cloudPasswordInput'));
bindBottomSheetInput(topicNamePromptInput);
bindBottomSheetInput(document.getElementById('mcpEditName'));
bindBottomSheetInput(document.getElementById('mcpEditUrl'));
bindBottomSheetInput(document.getElementById('mcpEditHeaders'));

// Token 用量信息
showUsageInfoSwitch.addEventListener('change', saveShowUsageInfo);

// 自定义请求体
customRequestBodyInput.addEventListener('change', saveCustomRequestBody);
customRequestBodyInput.addEventListener('blur', saveCustomRequestBody);

// 缓存命中优化
cacheOptimizeSwitch.addEventListener('change', saveCacheOptimize);

// 恢复上次话题
restoreLastTopicSwitch.addEventListener('change', saveRestoreLastTopic);
autoGenerateTopicNameSwitch.addEventListener('change', saveAutoGenerateTopicName);
if (topicNamePromptInput) topicNamePromptInput.addEventListener('change', saveTopicNamePrompt);
const resetTopicNamePromptBtn = document.getElementById('resetTopicNamePromptBtn');
if (resetTopicNamePromptBtn) {
    resetTopicNamePromptBtn.addEventListener('click', () => {
        if (!topicNamePromptInput) return;
        // 重置为 HTML 中的初始值
        topicNamePromptInput.value = topicNamePromptInput.defaultValue;
        topicNamePrompt = topicNamePromptInput.value;
        localStorage.removeItem('cnai_topic_name_prompt');
    });
}

// 专家模式
const expertModeSwitch = document.getElementById('expertModeSwitch');
const workPathGroup = document.getElementById('workPathGroup');
const workPathDisplay = document.getElementById('workPathDisplay');
const pcWorkPathGroup = document.getElementById('pcWorkPathGroup');
const pcWorkPathDisplay = document.getElementById('pcWorkPathDisplay');
const termuxBridgeGroup = document.getElementById('termuxBridgeGroup');
const termuxBridgeSwitch = document.getElementById('termuxBridgeSwitch');

function saveExpertMode() {
    localStorage.setItem('cnai_expert_mode', expertModeSwitch.checked ? '1' : '0');
    // 根据专家模式开关切换实际上下文轮数
    contextLimit = expertModeSwitch.checked ? contextLimitExpert : contextLimitNormal;
    // 重置缓存优化计数，匹配新的上下文轮数
    _recalcCacheOptimizeCount(contextLimit);
    // 同步 tool-calling 模块的专家模式状态
    if (typeof expertModeEnabled !== 'undefined') {
        expertModeEnabled = expertModeSwitch.checked;
    }
    if (expertModeSwitch.checked) {
        workPathGroup.style.display = '';
        pcWorkPathGroup.style.display = '';
        termuxBridgeGroup.style.display = '';
        workPathGroup.style.maxHeight = '0';
        workPathGroup.style.opacity = '0';
        workPathGroup.style.overflow = 'hidden';
        pcWorkPathGroup.style.maxHeight = '0';
        pcWorkPathGroup.style.opacity = '0';
        pcWorkPathGroup.style.overflow = 'hidden';
        termuxBridgeGroup.style.maxHeight = '0';
        termuxBridgeGroup.style.opacity = '0';
        termuxBridgeGroup.style.overflow = 'hidden';
        void workPathGroup.offsetHeight;
        workPathGroup.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';
        workPathGroup.style.maxHeight = '200px';
        workPathGroup.style.opacity = '1';
        pcWorkPathGroup.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';
        pcWorkPathGroup.style.maxHeight = '200px';
        pcWorkPathGroup.style.opacity = '1';
        termuxBridgeGroup.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';
        termuxBridgeGroup.style.maxHeight = '200px';
        termuxBridgeGroup.style.opacity = '1';
    } else {
        workPathGroup.style.transition = 'max-height 0.2s ease, opacity 0.2s ease';
        workPathGroup.style.maxHeight = '0';
        workPathGroup.style.opacity = '0';
        pcWorkPathGroup.style.transition = 'max-height 0.2s ease, opacity 0.2s ease';
        pcWorkPathGroup.style.maxHeight = '0';
        pcWorkPathGroup.style.opacity = '0';
        termuxBridgeGroup.style.transition = 'max-height 0.2s ease, opacity 0.2s ease';
        termuxBridgeGroup.style.maxHeight = '0';
        termuxBridgeGroup.style.opacity = '0';
        setTimeout(() => {
            if (!expertModeSwitch.checked) {
                workPathGroup.style.display = 'none';
                pcWorkPathGroup.style.display = 'none';
                termuxBridgeGroup.style.display = 'none';
            }
        }, 200);
    }
}

function loadExpertMode() {
    const val = localStorage.getItem('cnai_expert_mode');
    expertModeSwitch.checked = val === '1';
    workPathGroup.style.display = expertModeSwitch.checked ? '' : 'none';
    pcWorkPathGroup.style.display = expertModeSwitch.checked ? '' : 'none';
    termuxBridgeGroup.style.display = expertModeSwitch.checked ? '' : 'none';
    // 加载 Termux 桥接开关状态
    const termuxVal = localStorage.getItem('cnai_termux_bridge');
    termuxBridgeSwitch.checked = termuxVal === '1';
    // 显示使用点数
    updateUsagePointsDisplay();
}

function updateUsagePointsDisplay() {
    const group = document.getElementById('usagePointsGroup');
    const valEl = document.getElementById('usagePointsValue');
    if (!group || !valEl) return;
    const points = typeof UsagePoints !== 'undefined' ? UsagePoints.getPoints() : (parseInt(localStorage.getItem('cnai_usage_points')) || 0);
    const threshold = typeof UsagePoints !== 'undefined' ? UsagePoints.getThreshold() : 999;
    valEl.textContent = points + ' / ' + threshold;
    group.style.display = '';
}

function saveWorkPath() {
    localStorage.setItem('cnai_work_path', workPathDisplay.textContent === '未设置' ? '' : workPathDisplay.textContent);
}

function loadWorkPath() {
    const saved = localStorage.getItem('cnai_work_path');
    if (saved) {
        workPathDisplay.textContent = saved;
    } else if (window.AndroidBridge && typeof AndroidBridge.getDownloadsPath === 'function') {
        try {
            const path = AndroidBridge.getDownloadsPath();
            workPathDisplay.textContent = path ? path + '/Bluox' : '未设置';
        } catch(e) {
            workPathDisplay.textContent = '未设置';
        }
    } else {
        workPathDisplay.textContent = '未设置';
    }
}

if (expertModeSwitch) expertModeSwitch.addEventListener('change', function() {
    saveExpertMode();
});
if (termuxBridgeSwitch) termuxBridgeSwitch.addEventListener('change', function() {
    localStorage.setItem('cnai_termux_bridge', termuxBridgeSwitch.checked ? '1' : '0');
});
if (workPathDisplay) {
    workPathDisplay.addEventListener('click', () => {
        const currentVal = workPathDisplay.textContent === '未设置' ? '' : workPathDisplay.textContent;
        let defaultVal = currentVal;
        if (!defaultVal && window.AndroidBridge && typeof AndroidBridge.getDownloadsPath === 'function') {
            try {
                const path = AndroidBridge.getDownloadsPath();
                if (path) defaultVal = path + '/Bluox';
            } catch(e) {}
        }
        createBottomSheetInput({
            title: '工作目录',
            placeholder: '请输入工作目录路径',
            value: defaultVal,
            onConfirm: (val) => {
                if (val && val.trim()) {
                    workPathDisplay.textContent = val.trim();
                    saveWorkPath();
                }
            },
        }).show();
    });
}
// loadExpertMode 延后调用（在覆盖后）
loadWorkPath();

// 电脑端工作目录
function savePcWorkPath() {
    localStorage.setItem('cnai_pc_work_path', pcWorkPathDisplay.textContent === '未设置' ? '' : pcWorkPathDisplay.textContent);
}

function loadPcWorkPath() {
    const saved = localStorage.getItem('cnai_pc_work_path');
    pcWorkPathDisplay.textContent = saved || '未设置';
}

if (pcWorkPathDisplay) {
    pcWorkPathDisplay.addEventListener('click', () => {
        const currentVal = pcWorkPathDisplay.textContent === '未设置' ? '' : pcWorkPathDisplay.textContent;
        createBottomSheetInput({
            title: '电脑端工作目录',
            placeholder: '例如：C:\\Program Files\\workspace',
            value: currentVal,
            onConfirm: (val) => {
                if (val && val.trim()) {
                    pcWorkPathDisplay.textContent = val.trim();
                } else {
                    pcWorkPathDisplay.textContent = '未设置';
                }
                savePcWorkPath();
            },
        }).show();
    });
}
loadPcWorkPath();

// 覆盖完成后，调用新的 loadExpertMode
loadExpertMode();

// 锁定竖屏
lockPortraitSwitch.addEventListener('change', saveLockPortrait);

// 发送图片自动压缩
autoCompressImageSwitch.addEventListener('change', () => {
    if (autoCompressImageSwitch.checked) {
        // 打开时弹出底部面板
        saveAutoCompressImage();
    } else {
        // 关闭时仅保存状态
        autoCompressImageEnabled = false;
        localStorage.setItem('cnai_auto_compress_image', false);
        updateCompressDesc();
    }
});

// 确认操作提示音
function showConfirmSoundSheet() {
    const content = document.createElement('div');
    content.innerHTML = `
        <div class="bs-input-wrapper" style="margin-bottom:16px;">
            <label style="font-size:14px;color:var(--text-primary);font-weight:600;display:block;margin-bottom:8px;">音量大小</label>
            <div style="display:flex;align-items:center;gap:12px;">
                <input type="range" id="bs_confirmVolume" min="0" max="1" step="0.1" value="${confirmSoundVolume}" style="flex:1;">
                <span id="bs_confirmVolumeLabel" style="font-size:13px;color:var(--text-secondary);width:40px;text-align:right;">${Math.round(confirmSoundVolume * 100)}%</span>
            </div>
        </div>
        <div class="bs-btn-row" style="padding-bottom:16px;">
            <button type="button" class="secondary-btn" id="bs_confirmSoundCancel">取消</button>
            <button type="button" class="bs-confirm-btn" id="bs_confirmSoundConfirm">确定</button>
        </div>
    `;

    const sheet = createBottomSheetPanel({
        title: '提示音设置',
        content: content
    });

    sheet.show();

    setTimeout(() => {
        const volumeSlider = sheet.contentEl.querySelector('#bs_confirmVolume');
        const volumeLabel = sheet.contentEl.querySelector('#bs_confirmVolumeLabel');
        const confirmBtn = sheet.contentEl.querySelector('#bs_confirmSoundConfirm');
        const cancelBtn = sheet.contentEl.querySelector('#bs_confirmSoundCancel');

        // 滑动时实时显示百分比并试听
        if (volumeSlider) {
            volumeSlider.addEventListener('input', () => {
                const val = parseFloat(volumeSlider.value);
                volumeLabel.textContent = Math.round(val * 100) + '%';
                try {
                    const audio = new Audio(NOTIFICATION_SOUND_DATA);
                    audio.volume = val;
                    audio.play().catch(function(){});
                } catch (e) {}
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = parseFloat(volumeSlider.value);
                confirmSoundVolume = val;
                localStorage.setItem('cnai_confirm_sound_volume', val);
                sheet.hide();
                showToast('提示音设置已保存');
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                sheet.hide();
            });
        }
    }, 100);
}

// 生成期间不熄屏
keepScreenOnSwitch.addEventListener('change', saveKeepScreenOn);

// 页面重新可见时，如果在生成中，重新获取 wakeLock
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isSending && keepScreenOnEnabled) {
        requestKeepScreenOn();
    }
});

confirmSoundSwitch.addEventListener('change', () => {
    localStorage.setItem('cnai_confirm_sound', confirmSoundSwitch.checked);
    if (confirmSoundSwitch.checked) {
        showConfirmSoundSheet();
    }
});

// 沉浸模式默认开启
immersiveModeDefaultSwitch.addEventListener('change', () => {
    immersiveModeDefault = immersiveModeDefaultSwitch.checked;
    localStorage.setItem('cnai_immersive_mode_default', immersiveModeDefault);
    applyImmersiveMode();
});

// Session 缓存
sessionCacheSwitch.addEventListener('change', saveSessionCache);

// Session 缓存有效期
sessionExpireInput.addEventListener('change', saveSessionExpire);

// 知识库
knowledgeBaseSwitch.addEventListener('change', saveKnowledgeBase);

// 向量检索片段
maxKnowledgeChunksInput.addEventListener('change', saveMaxKnowledgeChunks);

// 关键词检索片段
maxKeywordChunksInput.addEventListener('change', saveMaxKeywordChunks);

// 联网搜索
webSearchSwitch.addEventListener('change', saveWebSearch);

// 主题颜色下拉选择
themeColorSelectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = Object.keys(themes).map(key => ({
        value: key,
        label: themeNames[key],
        icon: '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + themes[key].primary + ';margin-right:8px;flex-shrink:0;border:1px solid #000;"></span>'
    }));
    createBottomSheetPicker({
        items,
        activeValue: currentTheme,
        onSelect: (item) => {
            localStorage.setItem('cnai_theme', item.value);
            switchTheme(item.value);
        },
    }).show();
});

if (advancedSettingsToggle) {
    advancedSettingsToggle.addEventListener('click', () => {
        advancedSettingsToggle.classList.toggle('expanded');
        advancedSettingsContent.classList.toggle('expanded');
    });
}

// 自定义请求体参数 - 实时验证 JSON 格式
customRequestBodyInput.addEventListener('input', () => {
    const value = customRequestBodyInput.value.trim();
    if (value) {
        try {
            JSON.parse(value);
            customBodyError.style.display = 'none';
        } catch (e) {
            customBodyError.style.display = 'block';
        }
    } else {
        customBodyError.style.display = 'none';
    }
});

// 深度思考开关变化时，仅更新内存中的值，保存时才写入 localStorage
deepThinkingSwitch.addEventListener('change', () => {
    deepThinkingEnabled = deepThinkingSwitch.checked;
    // 设置弹窗打开时不更新按钮，保存后才更新
    if (!settingsModal.classList.contains('active')) {
        updateDeepThinkingToggleBtn();
    }
});

// 输入区域深度思考按钮点击事件
deepThinkingToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentAIProvider === 'qwen' || currentAIProvider === 'doubao' || currentAIProvider === 'deepseek') {
        e.stopPropagation();
        showThinkingBudgetPicker();
    } else {
        const wasEnabled = deepThinkingEnabled;
        deepThinkingEnabled = !deepThinkingEnabled;
        deepThinkingSwitch.checked = deepThinkingEnabled;
        deepThinkingByProvider[currentAIProvider] = deepThinkingEnabled;
        localStorage.setItem('cnai_deep_thinking_by_provider', JSON.stringify(deepThinkingByProvider));
        updateDeepThinkingToggleBtn(true, wasEnabled);
    }
});

function showThinkingBudgetPicker() {
    let options = [];
    let currentValue = '';
    if (currentAIProvider === 'qwen') {
        options = [{ value: 'auto', label: '高' }, { value: '51', label: '中 (51)' }, { value: '1', label: '低 (1)' }];
        currentValue = thinkingBudget;
    } else if (currentAIProvider === 'doubao') {
        options = [{ value: 'high', label: '深度分析' }, { value: 'medium', label: '均衡模式' }, { value: 'low', label: '轻量思考' }];
        currentValue = doubaoReasoningEffort;
    } else if (currentAIProvider === 'deepseek') {
        options = [{ value: 'max', label: 'Max' }, { value: 'high', label: 'High' }];
        currentValue = deepseekReasoningEffort;
    }
    const activeVal = deepThinkingEnabled ? currentValue : null;
    options.push('divider');
    options.push({ value: '__close__', label: '关闭深度思考', className: 'bs-item-danger' });
    createBottomSheetPicker({
        items: options,
        activeValue: activeVal,
        onSelect: (item) => {
            if (item.value === '__close__') {
                const wasEnabled = deepThinkingEnabled;
                deepThinkingEnabled = false;
                deepThinkingSwitch.checked = false;
                deepThinkingByProvider[currentAIProvider] = false;
                localStorage.setItem('cnai_deep_thinking_by_provider', JSON.stringify(deepThinkingByProvider));
                updateDeepThinkingToggleBtn(true, wasEnabled);
                return;
            }
            if (currentAIProvider === 'qwen') {
                thinkingBudget = item.value;
                localStorage.setItem('cnai_thinking_budget', thinkingBudget);
            } else if (currentAIProvider === 'doubao') {
                doubaoReasoningEffort = item.value;
                localStorage.setItem('cnai_doubao_reasoning_effort', doubaoReasoningEffort);
            } else if (currentAIProvider === 'deepseek') {
                deepseekReasoningEffort = item.value;
                localStorage.setItem('cnai_deepseek_reasoning_effort', deepseekReasoningEffort);
            }
            const wasEnabled = deepThinkingEnabled;
            deepThinkingEnabled = true;
            deepThinkingSwitch.checked = true;
            deepThinkingByProvider[currentAIProvider] = true;
            localStorage.setItem('cnai_deep_thinking_by_provider', JSON.stringify(deepThinkingByProvider));
            updateDeepThinkingToggleBtn(true, wasEnabled);
        },
    }).show();
}




// 更新输入区域深度思考按钮状态
function updateDeepThinkingToggleBtn(fromToggleChange = false, wasEnabled = false) {
    const isCustomProvider = currentAIProvider.startsWith('custom_');
    const isMinimax = currentAIProvider === 'minimax';
    const isMinimaxM3 = isMinimax && (typeof selectedModel !== 'undefined' && selectedModel === 'MiniMax-M3');

    // 自定义服务商检查 refProvider
    let _refProvider = null;
    if (isCustomProvider) {
        const _cp = customProviders.find(p => p.id === currentAIProvider);
        _refProvider = _cp && _cp.refProvider ? _cp.refProvider : null;
    }
    const deepDisabled = (isCustomProvider && !_refProvider) || (isMinimax && !isMinimaxM3) || _refProvider === 'minimax';

    // 无refProvider的自定义服务商或 MiniMax 时禁用深度思考按钮
    if (deepDisabled) {
        deepThinkingToggleBtn.classList.add('disabled');
        deepThinkingToggleBtn.classList.remove('active');
    } else {
        deepThinkingToggleBtn.classList.remove('disabled');
        if (deepThinkingEnabled) {
            deepThinkingToggleBtn.classList.add('active');
        } else {
            deepThinkingToggleBtn.classList.remove('active');
        }
    }

    // 思维链长度菜单已改用 createBottomSheetPicker，无需手动控制显示

    // 更新两个按钮的展开状态
    updateToggleBtnsExpanded(fromToggleChange, wasEnabled);
    updateChatMenuBtnIcon();
}

// 更新输入区域网络搜索按钮状态
function updateWebSearchToggleBtn(fromToggleChange = false, wasEnabled = false) {
    // 判断当前服务商是否支持网络搜索（豆包、千问、MiMo、DeepSeek 支持）
    const supportedProviders = WEB_SEARCH_PROVIDERS;
    // 自定义服务商检查 refProvider
    let _effectiveProvider = currentAIProvider;
    if (currentAIProvider.startsWith('custom_')) {
        const _cp = customProviders.find(p => p.id === currentAIProvider);
        if (_cp && _cp.refProvider) _effectiveProvider = _cp.refProvider;
    }
    const isSupported = supportedProviders.includes(_effectiveProvider);

    if (isSupported) {
        webSearchToggleBtn.classList.remove('disabled');
    } else {
        webSearchToggleBtn.classList.add('disabled');
        // 切换到不支持的服务商时，关闭网络搜索
        if (webSearchEnabled) {
            webSearchEnabled = false;
            webSearchSwitch.checked = false;
            localStorage.setItem('cnai_web_search', false);
        }
    }

    if (webSearchEnabled) {
        webSearchToggleBtn.classList.add('active');
    } else {
        webSearchToggleBtn.classList.remove('active');
    }

    // 更新两个按钮的展开状态
    updateToggleBtnsExpanded(fromToggleChange, wasEnabled);
    updateChatMenuBtnIcon();
}

// 任意一个开关开启时，两个按钮都展开（禁用状态除外，输入框有内容时收回）
// 展开后2秒自动收回，用户点击关闭时立即收回
function updateToggleBtnsExpanded(fromToggleChange = false, wasEnabled = false) {
    const deepThinkingDisabled = deepThinkingToggleBtn.classList.contains('disabled');
    const webSearchDisabled = webSearchToggleBtn.classList.contains('disabled');
    const hasInputContent = messageInput.value.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0;

    // 判断是否需要隐藏整个按钮区域（两个都未启用）
    const bothHidden = (deepThinkingDisabled || !deepThinkingEnabled) && (webSearchDisabled || !webSearchEnabled);
    const toggleColumn = document.querySelector('.toggle-buttons-row');
    if (toggleColumn) {
        if (bothHidden) {
            toggleColumn.classList.add('all-hidden');
        } else {
            toggleColumn.classList.remove('all-hidden');
        }
    }

    // 只有在启用状态、且输入框无内容时才展开
    const shouldExpand = !hasInputContent && ((!deepThinkingDisabled && deepThinkingEnabled) || (!webSearchDisabled && webSearchEnabled));

    // 清除之前的定时器
    if (toggleBtnExpandTimer) {
        clearTimeout(toggleBtnExpandTimer);
        toggleBtnExpandTimer = null;
    }

    // 从打开变成关闭时：直接收回
    if (fromToggleChange && wasEnabled && !shouldExpand) {
        if (isToggleBtnExpanded) {
            deepThinkingToggleBtn.classList.remove('toggle-btn-expanded');
            webSearchToggleBtn.classList.remove('toggle-btn-expanded');
            isToggleBtnExpanded = false;
        }
        return;
    }

    // 展开动画
    if (shouldExpand && !isToggleBtnExpanded) {
        isToggleBtnExpanded = true;
        deepThinkingToggleBtn.classList.add('toggle-btn-expanded');
        webSearchToggleBtn.classList.add('toggle-btn-expanded');

        // 2秒后自动收回
        toggleBtnExpandTimer = setTimeout(() => {
            deepThinkingToggleBtn.classList.remove('toggle-btn-expanded');
            webSearchToggleBtn.classList.remove('toggle-btn-expanded');
            isToggleBtnExpanded = false;
            toggleBtnExpandTimer = null;
        }, 2000);
    }

    // 已展开且需要保持展开状态时：重新设置定时器
    if (shouldExpand && isToggleBtnExpanded) {
        toggleBtnExpandTimer = setTimeout(() => {
            deepThinkingToggleBtn.classList.remove('toggle-btn-expanded');
            webSearchToggleBtn.classList.remove('toggle-btn-expanded');
            isToggleBtnExpanded = false;
            toggleBtnExpandTimer = null;
        }, 2000);
    }

    // 不需要展开且当前展开时：收回
    if (!shouldExpand && isToggleBtnExpanded) {
        deepThinkingToggleBtn.classList.remove('toggle-btn-expanded');
        webSearchToggleBtn.classList.remove('toggle-btn-expanded');
        isToggleBtnExpanded = false;
    }
}

// 更新"更多操作"菜单中深度思考/网络搜索的勾选状态和置灰
// 更多操作菜单 - 深度思考开关


// 更新更多操作按钮图标（根据深度思考和网络搜索状态）
function updateChatMenuBtnIcon() {
    const thinkingOn = deepThinkingEnabled && !deepThinkingToggleBtn.classList.contains('disabled');
    const webSearchOn = webSearchEnabled && !webSearchToggleBtn.classList.contains('disabled');
    chatMenuBtn.classList.toggle('thinking-on', thinkingOn);
    chatMenuBtn.classList.toggle('websearch-on', webSearchOn);
}

// 联网搜索开关变化时，更新内存中的值并保存
webSearchSwitch.addEventListener('change', () => {
    const wasEnabled = webSearchEnabled;
    webSearchEnabled = webSearchSwitch.checked;
    // 设置弹窗打开时不更新按钮，保存后才更新
    if (!settingsModal.classList.contains('active')) {
        updateWebSearchToggleBtn(true, wasEnabled);
    }
    localStorage.setItem('cnai_web_search', webSearchEnabled);
});

// 网络搜索按钮点击事件
webSearchToggleBtn.addEventListener('click', (e) => {
    e.preventDefault(); // 阻止默认行为，防止输入框失去焦点
    const wasEnabled = webSearchEnabled;
    webSearchEnabled = !webSearchEnabled;
    webSearchSwitch.checked = webSearchEnabled;
    updateWebSearchToggleBtn(true, wasEnabled);
    localStorage.setItem('cnai_web_search', webSearchEnabled);

    //messageInput.focus();
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) hideSettings();
});

// 智能体事件监听
// 首次使用提示：智能体切换按钮虚线圆框（localStorage 标记，点击后永久取消）
if (!localStorage.getItem('agent_hint_dismissed')) {
    agentSelectBtn.classList.add('agent-hint-active');
}
agentSelectBtn.addEventListener('click', () => {
    agentSelectBtn.classList.remove('agent-hint-active');
    localStorage.setItem('agent_hint_dismissed', '1');
    renderAgentList();
    openModalWithFade(agentSelectModal);
});
closeAgentSelect.addEventListener('click', function (e) {
    e.preventDefault();
    closeAgentSelectModal();
});
closeAgentEdit.addEventListener('click', function (e) {
    e.preventDefault();
    closeAgentEditModal();
});
closeSettings.addEventListener('click', function (e) {
    e.preventDefault();
    hideSettings();
});

// ============ 设置分类子弹窗逻辑 ============
// 点击分类按钮打开子弹窗
document.querySelectorAll('[data-sub-modal]').forEach(btn => {
    btn.addEventListener('click', function() {
        console.log('[动画锁] sub-modal-open', Date.now());
        const subModalId = this.getAttribute('data-sub-modal');
        const subModal = document.getElementById(subModalId);
        if (!subModal) return;
        const subInner = subModal.querySelector('.modal.fullscreen-modal');
        const mainInner = settingsModal.querySelector('.modal.fullscreen-modal');

        subModal.classList.add('active');
        // 打开高级设置时刷新使用点数
        if (subModalId === 'advancedSettingsModal') {
            if (typeof updateUsagePointsDisplay === 'function') updateUsagePointsDisplay();
        }
        // 主设置页淡出（保持住，不重置）
        mainInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        mainInner.style.transform = 'translateX(-10%)';
        // 子弹窗从右滑入
        subInner.style.transition = 'none';
        subInner.style.transform = 'translateX(30%)';
        void subInner.offsetHeight;
        subInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        subInner.style.transform = 'translateX(0)';
        panelStack.push(settingsModal);
        currentPanel = subInner;
    });
});

// 点击返回按钮关闭子弹窗
document.querySelectorAll('.sub-settings-back').forEach(btn => {
    btn.addEventListener('click', function() {
        console.log('[动画锁] sub-modal-back', Date.now());
        const subModal = this.closest('.sub-settings-modal');
        if (!subModal) return;
        const subInner = subModal.querySelector('.modal.fullscreen-modal');
        const mainInner = settingsModal.querySelector('.modal.fullscreen-modal');

        // 子弹窗向右滑出
        subInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease';
        subInner.style.transform = 'translateX(10%)';
        subInner.style.opacity = '0';
        // 主设置页淡入回来
        mainInner.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        mainInner.style.transform = 'translateX(0)';
        // 如果关闭的是专家模式或连接电脑页面
        if (subModal.id === 'expertModeSettingsModal' || subModal.id === 'pcConnectionSettingsModal') {
            // 信息流广告已移除
        }
        setTimeout(() => {
            subModal.classList.remove('active');
            subInner.style.transition = '';
            subInner.style.transform = '';
            subInner.style.opacity = '';
            mainInner.style.transition = '';
            mainInner.style.transform = '';
            mainInner.style.opacity = '';
        }, 250);
        panelStack.pop();
        currentPanel = mainInner;
    });
});

// 子弹窗点击背景关闭
document.querySelectorAll('.sub-settings-modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            const backBtn = modal.querySelector('.sub-settings-back');
            if (backBtn) backBtn.click();
        }
    });
});

// ==================== 图片压缩工具功能 ====================
let compressOriginalFile = null;
let compressResultBase64 = null;

function formatCompressSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function showCompressStats(originalSize, compressedSize) {
    compressStats.style.display = 'block';
    const savings = originalSize - compressedSize;
    const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    document.getElementById('statCompressOriginal').textContent = formatCompressSize(originalSize);
    document.getElementById('statCompressResult').textContent = formatCompressSize(compressedSize);
    document.getElementById('statCompressSavings').textContent = formatCompressSize(savings);
    document.getElementById('statCompressRatio').textContent = ratio + '%';
}

async function compressImageUtil(file, options = {}, srcDataUrl = null) {
    const {
        maxWidth = 1600,
        maxHeight = 1600,
        quality = 0.75,
        maxSizeMB = 2
    } = options;
    return new Promise((resolve, reject) => {
        const processImage = (src) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.floor(width * ratio);
                    height = Math.floor(height * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                let currentQuality = quality;
                let usedQuality = quality;
                let attempt = 0;
                const maxAttempts = 5;
                const compress = () => {
                    canvas.toBlob((blob) => {
                        const sizeMB = blob.size / (1024 * 1024);
                        if (sizeMB <= maxSizeMB || attempt >= maxAttempts) {
                            usedQuality = currentQuality;
                            const reader2 = new FileReader();
                            reader2.onload = () => {
                                resolve({
                                    base64: reader2.result,
                                    width: width,
                                    height: height,
                                    size: blob.size,
                                    originalSize: file.size,
                                    usedQuality: usedQuality
                                });
                            };
                            reader2.readAsDataURL(blob);
                        } else {
                            currentQuality = Math.max(0.3, currentQuality - 0.15);
                            attempt++;
                            compress();
                        }
                    }, 'image/jpeg', currentQuality);
                };
                compress();
            };
            img.onerror = reject;
            img.src = src;
        };

        // 优先使用显式传入的 srcDataUrl，其次用真正的 File/Blob，最后用全局 compressOriginalDataUrl（压缩工具传的是假 File）
        if (srcDataUrl) {
            processImage(srcDataUrl);
        } else if (file instanceof Blob) {
            // 真正的 File/Blob 对象（自动压缩、Web上传等）
            const reader = new FileReader();
            reader.onload = (e) => {
                processImage(e.target.result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        } else if (compressOriginalDataUrl) {
            // 压缩工具：依赖全局变量
            processImage(compressOriginalDataUrl);
        } else {
            reject(new Error('No image data'));
        }
    });
}

// 打开图片压缩工具

// 关闭图片压缩工具
closeImageCompress.addEventListener('click', (e) => {
    e.preventDefault();
    imageCompressModal.classList.remove('active');
});

imageCompressModal.addEventListener('click', (e) => {
    if (e.target === imageCompressModal) {
        imageCompressModal.classList.remove('active');
    }
});

// 压缩质量滑块更新
compressQuality.addEventListener('input', () => {
    compressQualityValue.textContent = compressQuality.value;
});

// 点击选择图片按钮
const selectImageBtn = document.getElementById('selectImageBtn');
selectImageBtn.addEventListener('click', () => {
    // 检查是否在 Android WebView 中，使用原生图片选择器
    if (window.AndroidBridge && typeof AndroidBridge.openCompressImageChooser === 'function') {
        AndroidBridge.openCompressImageChooser();
    } else {
        // Web 环境使用原生 file input
        compressFileInput.click();
    }
});

// 处理安卓端选择的压缩图片
window.handleAndroidCompressImageSelected = function (dataUrl) {
    if (!dataUrl) return;

    // 构造一个假的 File 对象用于处理
    const fakeFile = {
        name: 'image_' + Date.now() + '.jpg',
        size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
    };

    compressOriginalFile = fakeFile;
    startCompressBtn.disabled = false;

    // 显示原图
    compressOriginalImage.src = dataUrl;
    compressOriginalImage.style.display = 'block';
    compressOriginalSize.textContent = formatCompressSize(fakeFile.size);

    // 获取原图尺寸
    const img = new Image();
    img.onload = () => {
        compressOriginalDimensions.textContent = `${img.width} × ${img.height}`;
        // 把原图宽高设为默认值
        document.getElementById('compressMaxWidth').value = img.width;
        document.getElementById('compressMaxHeight').value = img.height;
    };
    img.src = dataUrl;

    // 保存 dataUrl 用于后续压缩
    compressOriginalDataUrl = dataUrl;
};

// 保存原始 dataUrl（安卓端用）
let compressOriginalDataUrl = null;

// 选择图片文件（Web 环境用）
compressFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressOriginalFile = file;
    startCompressBtn.disabled = false;
    // 显示原图
    const reader = new FileReader();
    reader.onload = (event) => {
        compressOriginalImage.src = event.target.result;
        compressOriginalImage.style.display = 'block';
        compressOriginalSize.textContent = formatCompressSize(file.size);
        // 获取原图尺寸
        const img = new Image();
        img.onload = () => {
            compressOriginalDimensions.textContent = `${img.width} × ${img.height}`;
            // 把原图宽高设为默认值
            document.getElementById('compressMaxWidth').value = img.width;
            document.getElementById('compressMaxHeight').value = img.height;
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// 开始压缩
startCompressBtn.addEventListener('click', async () => {
    if (!compressOriginalFile) return;
    startCompressBtn.disabled = true;
    startCompressBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 6px; animation: spin 1s linear infinite;">
            <line x1="12" y1="2" x2="12" y2="6"></line>
            <line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
            <line x1="2" y1="12" x2="6" y2="12"></line>
            <line x1="18" y1="12" x2="22" y2="12"></line>
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
        </svg>
        压缩中...
    `;
    try {
        const options = {
            maxWidth: parseInt(document.getElementById('compressMaxWidth').value),
            maxHeight: parseInt(document.getElementById('compressMaxHeight').value),
            quality: parseFloat(compressQuality.value),
            maxSizeMB: parseFloat(document.getElementById('compressMaxSizeMB').value)
        };
        const result = await compressImageUtil(compressOriginalFile, options);
        // 显示压缩后图片
        compressResultImage.src = result.base64;
        compressResultImage.style.display = 'block';
        compressResultBase64 = result.base64;
        // 更新信息
        compressResultSize.textContent = formatCompressSize(result.size);
        compressResultDimensions.textContent = `${result.width} × ${result.height}`;
        compressUsedQuality.textContent = result.usedQuality ? result.usedQuality.toFixed(2) : options.quality.toFixed(2);
        // 显示统计
        showCompressStats(result.originalSize, result.size);
        downloadCompressedBtn.disabled = false;
        await ensureUsagePoints();
        UsagePoints.addPoint(5);
    } catch (error) {
        alert('压缩失败: ' + error.message);
        console.error(error);
    }
    startCompressBtn.disabled = false;
    startCompressBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 6px;">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        开始压缩
    `;
});

// 下载压缩图
downloadCompressedBtn.addEventListener('click', () => {
    if (!compressResultBase64) return;

    // 构造文件名
    const originalName = compressOriginalFile.name || 'image';
    const ext = originalName.lastIndexOf('.');
    const name = ext > 0 ? originalName.substring(0, ext) + '_compressed.jpg' : originalName + '_compressed.jpg';

    // 检查是否在 Android WebView 中，使用原生保存
    if (window.AndroidBridge && typeof AndroidBridge.saveImageToFile === 'function') {
        AndroidBridge.saveImageToFile(name, compressResultBase64);
    } else {
        // Web 环境使用原生下载
        const link = document.createElement('a');
        link.href = compressResultBase64;
        link.download = name;
        link.click();
    }
});
addAgentBtn.addEventListener('click', openCreateAgent);
// 智能体编辑实时保存
agentNameInput.addEventListener('input', saveAgentField);
agentNameInput.addEventListener('change', saveAgentField);
agentSystemInput.addEventListener('input', saveAgentField);
agentSystemInput.addEventListener('change', saveAgentField);


// 预设值下拉框事件
presetDropdownBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const items = Object.entries(agentPresets).map(([key, preset]) => ({
        value: key,
        label: preset.name,
    }));
    createBottomSheetPicker({
        items,
        onSelect: (item) => applyPreset(item.value),
    }).show();
});

agentSelectModal.addEventListener('click', (e) => {
    if (e.target === agentSelectModal) closeAgentSelectModal();
});
agentEditModal.addEventListener('click', (e) => {
    if (e.target === agentEditModal) closeAgentEditModal();
});

// 图标选择
iconOptions.addEventListener('click', (e) => {
    // 支持 emoji 图标选项
    const iconOption = e.target.closest('.icon-option');
    if (iconOption) {
        const icon = iconOption.dataset.icon;
        setIconPreview(icon);
        saveAgentField();
    }
    // 支持图片图标选项
    const imgOption = e.target.closest('.icon-img-option');
    if (imgOption) {
        const img = imgOption.querySelector('img');
        if (img) {
            setIconPreview(img.dataset.icon || img.src);
            saveAgentField();
        }
    }
});

// 背景主题选择
if (bgThemeSelectBtn) {
    bgThemeSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const items = Object.keys(bgThemeNames).map(key => ({
            value: key,
            label: bgThemeNames[key],
            icon: '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + bgThemeColors[key] + ';margin-right:8px;flex-shrink:0;border:1px solid #ccc;"></span>'
        }));
        createBottomSheetPicker({
            items,
            activeValue: currentBgTheme,
            onSelect: (item) => {
                localStorage.setItem('cnai_bg_theme', item.value);
                switchBgTheme(item.value);
            },
        }).show();
    });
}

// API Key 显示/隐藏切换
toggleApiKeyBtn.addEventListener('click', () => {
    isApiKeyVisible = !isApiKeyVisible;
    apiKeyInput.type = isApiKeyVisible ? 'text' : 'password';
    const eyeIcon = toggleApiKeyBtn.querySelector('.eye-icon');
    const eyeOffIcon = toggleApiKeyBtn.querySelector('.eye-off-icon');
    if (eyeIcon && eyeOffIcon) {
        eyeIcon.style.display = isApiKeyVisible ? 'none' : 'block';
        eyeOffIcon.style.display = isApiKeyVisible ? 'block' : 'none';
    }
});

// 获取 API Key 按钮点击事件
const apiKeyUrls = {
    qwen: { name: '千问', url: 'https://bailian.console.aliyun.com' },
    deepseek: { name: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys' },
    doubao: { name: '豆包', url: 'https://console.volcengine.com/ark/apiKey' },
    glm: { name: 'GLM', url: 'https://open.bigmodel.cn/usercenter/apikeys' },
    kimi: { name: 'Kimi', url: 'https://platform.moonshot.cn/' },
    minimax: { name: 'MiniMax', url: 'https://www.minimaxi.com/user-center/basic-information' },
    mimo: { name: 'MiMo', url: 'https://platform.xiaomimimo.com/console' }
};

let getApiKeySheet = null;

function openGetApiKeySheet() {
    if (getApiKeySheet) { getApiKeySheet.hide(); getApiKeySheet = null; }

    // 构建服务商网格卡片
    let gridHtml = '';
    const entries = Object.entries(apiKeyUrls);
    entries.forEach(([key, info]) => {
        const iconPath = getProviderIconPath(key);
        let iconHtml = '';
        if (iconPath) {
            iconHtml = `<span class="bs-item-icon"><img src="${iconPath}" alt="${info.name}" style="width: 22px; height: 22px;"></span>`;
        }
        gridHtml += `
            <a class="bs-item bs-item-grid" href="${info.url}" target="_blank" style="text-decoration: none; color: inherit;">
                ${iconHtml}
                <span class="bs-item-label">${info.name}</span>
            </a>`;
    });

    getApiKeySheet = createBottomSheetPanel({
        title: '获取 API Key',
        content: `
            <div style="padding: 4px 16px 8px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; text-align: center;">
                请选择服务商创建 API Key。千问与豆包为新用户提供丰厚的免费Token额度。
            </div>
            <div class="bs-grid bs-grid-cols-2" style="padding-top: 0;">${gridHtml}</div>
        `,
        onClose: () => { getApiKeySheet = null; },
    });
    getApiKeySheet.show();
}

// 更新获取KEY按钮状态
function updateGetApiKeyBtnState() {
    getApiKeyBtn.textContent = '获取 KEY';
    getApiKeyBtn.dataset.mode = 'getUrl';
    getApiKeyBtn.disabled = false;
}

// 监听 API Key 输入框变化
apiKeyInput.addEventListener('input', updateGetApiKeyBtnState);

// 测试 API 连接
async function testApiConnection() {
    const key = apiKeyInput.value.trim();
    if (!key) {
        showToast('请先输入 API Key', 2000, 'default', 'top');
        return;
    }

    const models = cachedModels[currentAIProvider] || [];
    let testModel;

    if (models.length > 0) {
        // 有模型，使用当前选中的模型或第一个模型
        testModel = selectedModel || models[0].id;
    } else {
        // 没有模型，提示用户选择
        alert('请选择模型');
        return;
    }

    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = '测试中...';

    try {
        const provider = currentAIProvider;
        let apiUrl, headers, body;

        // 根据服务商构建测试请求
        if (provider === 'deepseek') {
            apiUrl = 'https://api.deepseek.com/chat/completions';
            headers = {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            };
            body = JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10,
                stream: false
            });
        } else if (provider === 'qwen') {
            apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
            headers = {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            };
            body = JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10,
                stream: false
            });
        } else if (provider === 'doubao') {
            apiUrl = `https://ark.cn-beijing.volces.com/api/v3/chat/completions`;
            headers = {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            };
            body = JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10,
                stream: false
            });
        } else if (provider === 'glm') {
            apiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
            headers = {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            };
            body = JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10,
                stream: false
            });
        } else if (provider === 'minimax') {
            apiUrl = 'https://api.minimaxi.com/v1/chat/completions';
            headers = {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            };
            body = JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10,
                stream: false
            });
        } else if (provider === 'kimi') {
            apiUrl = 'https://api.moonshot.cn/v1/chat/completions';
            headers = {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            };
            body = JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10,
                stream: false
            });
        } else if (provider === 'mimo') {
            apiUrl = 'https://api.xiaomimimo.com/v1/chat/completions';
            headers = {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            };
            body = JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10,
                stream: false
            });
        } else {
            // 自定义服务商
            const customProvider = customProviders.find(p => p.id === provider);
            if (!customProvider || !customProvider.baseUrl) {
                showToast('未找到服务商配置', 2000, 'default', 'top');
                testConnectionBtn.disabled = false;
                testConnectionBtn.textContent = '测试连接';
                return;
            }
            let baseUrl = customProvider.baseUrl.replace(/\/+$/, '');
            if (customProvider.apiType === 'responses') {
                apiUrl = baseUrl + '/responses';
            } else {
                apiUrl = baseUrl + '/chat/completions';
            }
            headers = {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            };
            body = JSON.stringify({
                model: testModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 10,
                stream: false
            });
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: body
        });

        if (response.ok) {
            showToast('连接成功！API Key 有效', 2000, 'default', 'top');
        } else {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error?.message || `错误: ${response.status}`;
            // 检查错误信息是否包含 "balance"
            if (errorMsg.toLowerCase().includes('balance')) {
                showToast('余额不足或无可用资源包,请前往对应AI服务商官网充值', 10000, 'default', 'top');
            } else {
                showToast(`连接失败: ${errorMsg}`, 3000, 'default', 'top');
            }
        }
    } catch (error) {
        const errorMsg = error.message || '';
        // 检查错误信息是否包含 "balance"
        if (errorMsg.toLowerCase().includes('balance')) {
            showToast('余额不足或无可用资源包,请前往对应AI服务商官网充值', 10000, 'default', 'top');
        } else {
            showToast(`连接失败: ${errorMsg}`, 3000, 'default', 'top');
        }
    } finally {
        testConnectionBtn.disabled = false;
        testConnectionBtn.textContent = '测试连接';
    }
}

getApiKeyBtn.addEventListener('click', () => {
    openGetApiKeySheet();
});

// 关闭获取API KEY弹窗
function closeGetApiKeyModal() {
    getApiKeyModal.classList.remove('active');
}

closeGetApiKey.addEventListener('click', closeGetApiKeyModal);
closeGetApiKeyBtn.addEventListener('click', closeGetApiKeyModal);

// 点击遮罩层关闭弹窗
getApiKeyModal.addEventListener('click', (e) => {
    if (e.target === getApiKeyModal) {
        closeGetApiKeyModal();
    }
});

// 处理服务商链接点击，优先使用Android原生接口
document.querySelectorAll('.provider-link-item').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = link.getAttribute('href');
        if (url) {
            // 优先使用 Android 原生接口打开外部浏览器
            if (window.AndroidBridge && window.AndroidBridge.openExternalBrowser) {
                window.AndroidBridge.openExternalBrowser(url);
            } else {
                window.open(url, '_blank');
            }
        }
    });
});

// 聊天菜单功能
let chatMenuSheet = null;

function showChatMenuSheet() {
    if (chatMenuSheet) { chatMenuSheet.hide(); chatMenuSheet = null; }

    // 构建菜单项
    const items = [];

    // 常用模型
    if (frequentModels.length > 0) {
        const validModels = frequentModels.filter(model => {
            // 自定义服务商的模型直接放行
            if (model.provider.startsWith('custom_')) return true;
            const providerModels = cachedModels[model.provider] || [];
            return providerModels.some(m => m.id === model.modelId);
        });
        if (validModels.length > 0) {
            validModels.slice(0, 3).forEach(model => {
                let providerName = '';
                switch (model.provider) {
                    case 'qwen': providerName = '千问'; break;
                    case 'deepseek': providerName = 'DeepSeek'; break;
                    case 'doubao': providerName = '豆包'; break;
                    case 'glm': providerName = '智谱'; break;
                    case 'mimo': providerName = 'MiMo'; break;
                    default:
                        if (model.provider.startsWith('custom_')) {
                            const cp = customProviders.find(p => p.id === model.provider);
                            providerName = cp ? cp.name : model.provider;
                        } else {
                            providerName = model.provider;
                        }
                }
                const providerIcon = getProviderIconPath(model.provider);
                let providerHtml = '';
                if (providerIcon) {
                    providerHtml = `<img src="${providerIcon}" alt="${providerName}" class="provider-icon" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 2px;">`;
                } else {
                    providerHtml = `<span style="font-size: 12px; color: var(--text-secondary); margin-left: 4px;">${providerName}</span>`;
                }
                const isActive = model.provider === currentAIProvider && model.modelId === selectedModel;
                items.push({ value: `model::${model.provider}::${model.modelId}`, label: `${model.modelName} ${providerHtml}`, isActive });
            });
            // 更多模型
            items.push({ value: '__history_models__', label: '更多模型…' });
            items.push('divider');
        }
    }

    // 上传图片
    items.push({ value: '__upload_image__', label: '上传图片', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>' });
    // 上传文件
    items.push({ value: '__upload_file__', label: '上传文件', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>' });
    // 导出当前话题
    items.push({ value: '__export_chat__', label: '导出当前话题', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' });
    // 导入聊天记录
    items.push({ value: '__import_chat__', label: '导入聊天记录', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>' });
    // 无损压缩图片
    items.push({ value: '__image_compress__', label: '无损压缩图片', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline><path d="M12 18v-6M9 15l3 3 3-3"></path></svg>' });
    // 参考知识库
    items.push({ value: '__knowledge_ref__', label: '参考知识库', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>' });

    // 深度思考
    const isCustomProvider = currentAIProvider.startsWith('custom_');
    const isMinimax = currentAIProvider === 'minimax';
    let _refProvider = null;
    if (isCustomProvider) {
        const _cp = customProviders.find(p => p.id === currentAIProvider);
        _refProvider = _cp && _cp.refProvider ? _cp.refProvider : null;
    }
    const isMinimaxM3 = isMinimax && typeof selectedModel !== 'undefined' && selectedModel === 'MiniMax-M3';
    const deepDisabled = (isCustomProvider && !_refProvider) || (isMinimax && !isMinimaxM3) || _refProvider === 'minimax';
    if (!deepDisabled) {
        items.push({ value: '__deep_thinking__', label: '深度思考', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-7 7c0 2 1 3 2 4.5V16a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2.5c1-1.5 2-2.5 2-4.5a7 7 0 0 0-7-7z" /></svg>', isActive: deepThinkingEnabled });
    }

    // 网络搜索
    const _effectiveProvider = _refProvider || currentAIProvider;
    const webDisabled = !WEB_SEARCH_PROVIDERS.includes(_effectiveProvider);
    if (!webDisabled) {
        items.push({ value: '__web_search__', label: '网络搜索', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>', isActive: webSearchEnabled });
    }

    // 传输文件到电脑（仅已连接时显示）
    if (pcConnection.connected && pcConnection.authenticated) {
        items.push({ value: '__transfer_file__', label: '传输文件到电脑', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>' });
    }

    // 新增话题
    items.push({ value: '__new_topic__', label: '新增话题', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' });

    // 沉浸聊天模式
    items.push({ value: '__immersive_mode__', label: '沉浸模式', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>', isActive: isImmersiveMode() });

    chatMenuSheet = createBottomSheetPicker({
        items,
        activeValue: null,
        gridColumns: 2,
        onSelect: (item) => {
            const val = item.value;
            if (val && val.startsWith('model::')) {
                const [_, provider, modelId] = val.split('::');
                switchToFrequentModel(provider, modelId);
            } else if (val === '__history_models__') {
                openHistoryModelsModal();
            } else if (val === '__upload_image__') {
                triggerUploadImage();
            } else if (val === '__upload_file__') {
                triggerUploadFile();
            } else if (val === '__export_chat__') {
                triggerExportChat();
            } else if (val === '__import_chat__') {
                triggerImportChat();
            } else if (val === '__image_compress__') {
                imageCompressModal.classList.add('active');
                compressOriginalFile = null;
            } else if (val === '__knowledge_ref__') {
                showKnowledgeRefPicker();
            } else if (val === '__deep_thinking__') {
                if (currentAIProvider === 'qwen' || currentAIProvider === 'doubao' || currentAIProvider === 'deepseek') {
                    showThinkingBudgetPicker();
                } else {
                    const wasEnabled = deepThinkingEnabled;
                    deepThinkingEnabled = !deepThinkingEnabled;
                    deepThinkingSwitch.checked = deepThinkingEnabled;
                    deepThinkingByProvider[currentAIProvider] = deepThinkingEnabled;
                    localStorage.setItem('cnai_deep_thinking_by_provider', JSON.stringify(deepThinkingByProvider));
                    updateDeepThinkingToggleBtn(true, wasEnabled);
                }
            } else if (val === '__web_search__') {
                const wasEnabled = webSearchEnabled;
                webSearchEnabled = !webSearchEnabled;
                webSearchSwitch.checked = webSearchEnabled;
                updateWebSearchToggleBtn(true, wasEnabled);
                localStorage.setItem('cnai_web_search', webSearchEnabled);
            } else if (val === '__transfer_file__') {
                if (!pcConnection.connected || !pcConnection.authenticated) {
                    showToast('请先在设置中连接并配对电脑');
                } else if (window.AndroidBridge && typeof AndroidBridge.openPCFileChooser === 'function') {
                    AndroidBridge.openPCFileChooser();
                } else {
                    const pcFileInput = document.getElementById('pcFileInput');
                    pcFileInput?.click();
                }
            } else if (val === '__new_topic__') {
                createNewTopic();
            } else if (val === '__immersive_mode__') {
                toggleImmersiveMode();
            }
        },
    });
    chatMenuSheet.show();
}

function closeChatMenuSheet() {
    if (chatMenuSheet) { chatMenuSheet.hide(); chatMenuSheet = null; }
}

// 切换沉浸聊天模式
function toggleImmersiveMode() {
    const isImmersive = isImmersiveMode();
    if (isImmersive) {
        immersiveModeByTopic[currentTopicId] = false;
    } else {
        immersiveModeByTopic[currentTopicId] = true;
    }
    localStorage.setItem('cnai_immersive_mode_by_topic', JSON.stringify(immersiveModeByTopic));
    applyImmersiveMode();
    showToast(isImmersiveMode() ? '沉浸模式已开启' : '沉浸模式已关闭');
}

// 判断当前话题是否处于沉浸模式
function isImmersiveMode() {
    const explicitlyOff = immersiveModeByTopic[currentTopicId] === false;
    const explicitlyOn = immersiveModeByTopic[currentTopicId] === true;
    return explicitlyOn || (!explicitlyOff && immersiveModeDefault);
}

// 沉浸模式：自动隐藏旧消息的定时器
let immersiveHideTimer = null;

// 应用/移除沉浸模式样式
function applyImmersiveMode() {
    const isImmersive = isImmersiveMode();
    console.log('[沉浸模式] applyImmersiveMode, isImmersive:', isImmersive);
    document.body.classList.toggle('immersive-mode', isImmersive);
    if (isImmersive) {
        // 开启沉浸模式，延迟判断是否在底部再决定是否隐藏
        scheduleImmersiveHide();
    } else {
        cancelImmersiveHide();
        showAllMessages();
    }
}

// 3秒后隐藏除最新消息外的所有消息
function scheduleImmersiveHide() {
    cancelImmersiveHide();
    immersiveHideTimer = setTimeout(() => {
        console.log('[沉浸模式] 定时器触发');
        if (!isImmersiveMode()) {
            console.log('[沉浸模式] 已退出沉浸模式，取消');
            return;
        }
        // 延迟后再次判断是否在底部，布局已稳定
        const atBottom = isUserAtBottomForBtn();
        console.log('[沉浸模式] isUserAtBottomForBtn:', atBottom,
            'scrollHeight:', chatContainer.scrollHeight,
            'scrollTop:', chatContainer.scrollTop,
            'clientHeight:', chatContainer.clientHeight);
        if (!atBottom) {
            console.log('[沉浸模式] 不在底部，取消隐藏');
            return;
        }
        const allItems = chatContainer.querySelectorAll('.message, .tool-call-card');
        // 只取可见的消息（排除 display:none 的多版本旧版本）
        const visibleItems = Array.from(allItems).filter(el => el.style.display !== 'none');
        console.log('[沉浸模式] visibleItems:', visibleItems.length);
        if (visibleItems.length <= 1) {
            console.log('[沉浸模式] 可见消息不足，取消');
            return;
        }
        // 只隐藏最近的几条（倒数第2到倒数第6），避免大量DOM操作导致卡顿
        const IMMERSIVE_HIDE_COUNT = 5;
        const hideStart = Math.max(0, visibleItems.length - 1 - IMMERSIVE_HIDE_COUNT);
        for (let i = hideStart; i < visibleItems.length - 1; i++) {
            visibleItems[i].classList.add('immersive-hidden');
        }
        console.log('[沉浸模式] 已隐藏', visibleItems.length - 1 - hideStart, '条消息');
    }, 2130);
}

// 取消隐藏定时器
function cancelImmersiveHide() {
    if (immersiveHideTimer) {
        clearTimeout(immersiveHideTimer);
        immersiveHideTimer = null;
    }
}

// 显示所有消息（滚动时调用）
function showAllMessages() {
    chatContainer.querySelectorAll('.immersive-hidden').forEach(el => {
        el.classList.remove('immersive-hidden');
    });
}

chatMenuBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.activeElement.blur();
    showChatMenuSheet();
});

// 阻止 mousedown 事件，防止按钮获取焦点导致输入框失焦
chatMenuBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
});

// 获取服务商图标路径
function getProviderIconPath(providerId) {
    const iconMap = {
        'deepseek': 'icons/db3_processed/AIprovidersvg/deepseek.svg',
        'qwen': 'icons/db3_processed/AIprovidersvg/qwen.svg',
        'doubao': 'icons/db3_processed/AIprovidersvg/volcengine.svg',
        'glm': 'icons/db3_processed/AIprovidersvg/zhipu.svg',
        'minimax': 'icons/db3_processed/AIprovidersvg/minimax.svg',
        'kimi': 'icons/db3_processed/AIprovidersvg/kimi.svg',
        'mimo': 'icons/db3_processed/AIprovidersvg/mimo.svg'
    };
    return iconMap[providerId] || null;
}

// 渲染常用模型列表
// 历史模型底部面板实例
let historyModelsSheet = null;

function openHistoryModelsModal() {
    closeChatMenuSheet();
    historyModelsSheet = createBottomSheetPanel({
        title: '所使用过的模型',
        content: `
            <div class="bs-search-box">
                <input type="text" id="bsHistorySearchInput" placeholder="搜索模型" maxlength="50">
            </div>
            <div class="bs-grid bs-grid-cols-2" id="bsHistoryModelsGrid" style="padding-top: 4px;"></div>
        `,
        onClose: () => { historyModelsSheet = null; },
    });
    historyModelsSheet.show();

    const bsSearchInput = document.getElementById('bsHistorySearchInput');
    const bsGrid = document.getElementById('bsHistoryModelsGrid');

    function renderBsHistoryModels(searchKeyword = '') {
        bsGrid.innerHTML = '';
        const filteredModels = searchKeyword
            ? frequentModels.filter(model =>
                model.modelName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
                model.modelId.toLowerCase().includes(searchKeyword.toLowerCase())
            )
            : frequentModels;
        if (filteredModels.length === 0) {
            bsGrid.innerHTML = searchKeyword
                ? '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">未找到匹配的模型</div>'
                : '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无使用记录</div>';
            return;
        }
        filteredModels.forEach(model => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'bs-item bs-item-grid';
            if (model.provider === currentAIProvider && model.modelId === selectedModel) {
                item.classList.add('active');
            }
            let providerName = '';
            switch (model.provider) {
                case 'qwen': providerName = '千问'; break;
                case 'deepseek': providerName = 'DeepSeek'; break;
                case 'doubao': providerName = '豆包'; break;
                case 'glm': providerName = '智谱'; break;
                case 'mimo': providerName = 'MiMo'; break;
                default:
                    if (model.provider.startsWith('custom_')) {
                        const customProvider = customProviders.find(p => p.id === model.provider);
                        providerName = customProvider ? customProvider.name : model.provider;
                    } else {
                        providerName = model.provider;
                    }
            }
            const providerIcon = getProviderIconPath(model.provider);
            let iconHtml = '';
            if (providerIcon) {
                iconHtml = `<span class="bs-item-icon"><img src="${providerIcon}" alt="${providerName}" style="width: 20px; height: 20px;"></span>`;
            }
            item.innerHTML = `
                ${iconHtml}
                <span class="bs-item-label">${model.modelName}</span>
                <small style="font-size:10px;color:var(--text-secondary);">${providerName}</small>
                <button class="model-item-delete" title="删除记录" style="position:absolute;top:2px;right:2px;width:22px;height:22px;border:none;background:rgba(0,0,0,0.1);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);opacity:0.6;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            `;
            item.style.position = 'relative';
            // 删除按钮
            item.querySelector('.model-item-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = frequentModels.findIndex(m => m.provider === model.provider && m.modelId === model.modelId);
                if (idx !== -1) {
                    frequentModels.splice(idx, 1);
                    localStorage.setItem('cnai_frequent_models', JSON.stringify(frequentModels));
                }
                renderBsHistoryModels(bsSearchInput.value.trim());
            });
            item.addEventListener('click', () => {
                switchToFrequentModel(model.provider, model.modelId);
                if (historyModelsSheet) { historyModelsSheet.hide(); historyModelsSheet = null; }
            });
            bsGrid.appendChild(item);
        });
    }

    bsSearchInput.addEventListener('input', (e) => renderBsHistoryModels(e.target.value.trim()));
    renderBsHistoryModels();
}

function closeHistoryModelsModal() {
    if (historyModelsSheet) {
        historyModelsSheet.hide();
        historyModelsSheet = null;
    }
}

function renderHistoryModelsList(searchKeyword = '') {
    historyModelsList.innerHTML = '';

    // 过滤模型
    const filteredModels = searchKeyword
        ? frequentModels.filter(model =>
            model.modelName.toLowerCase().includes(searchKeyword.toLowerCase()) ||
            model.modelId.toLowerCase().includes(searchKeyword.toLowerCase())
        )
        : frequentModels;

    if (filteredModels.length === 0) {
        historyModelsList.innerHTML = searchKeyword
            ? '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">未找到匹配的模型</div>'
            : '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无使用记录</div>';
        return;
    }

    filteredModels.forEach(model => {
        const item = document.createElement('div');
        item.className = 'model-item';
        if (model.provider === currentAIProvider && model.modelId === selectedModel) {
            item.classList.add('active');
        }

        // 获取服务商显示名称
        let providerName = '';
        switch (model.provider) {
            case 'qwen': providerName = '千问'; break;
            case 'deepseek': providerName = 'DeepSeek'; break;
            case 'doubao': providerName = '豆包'; break;
            case 'glm': providerName = '智谱'; break;
            case 'mimo': providerName = 'MiMo'; break;
            default:
                if (model.provider.startsWith('custom_')) {
                    const customProvider = customProviders.find(p => p.id === model.provider);
                    providerName = customProvider ? customProvider.name : model.provider;
                } else {
                    providerName = model.provider;
                }
        }

        const providerIcon = getProviderIconPath(model.provider);
        let providerHtml = '';
        if (providerIcon) {
            providerHtml = `<img src="${providerIcon}" alt="${providerName}" class="provider-icon" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 2px;">${providerName}`;
        } else {
            providerHtml = providerName;
        }

        item.innerHTML = `
            <span class="model-item-name">${model.modelName}</span>
            <span class="model-item-provider-tag">${providerHtml}</span>
        `;

        item.addEventListener('click', () => {
            switchToFrequentModel(model.provider, model.modelId);
            closeHistoryModelsModal();
        });

        historyModelsList.appendChild(item);
    });
}

// ==================== 备份/恢复数据功能 ====================

const backupRestoreBtn = document.getElementById('backupRestoreBtn');

// 备份恢复底部面板实例
let backupRestoreSheet = null;

// 打开备份/恢复弹窗
function openBackupRestoreModal() {
    backupRestoreSheet = createBottomSheetPanel({
        title: '备份/恢复数据',
        content: `
            <div class="bs-card" id="bsBackupBtn">
                <div class="bs-card-icon bs-card-icon-primary">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </div>
                <div class="bs-card-info">
                    <span>备份数据</span>
                    <small>将所有设置和聊天记录导出</small>
                </div>
                <span class="bs-card-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"></polyline></svg></span>
            </div>
            <div class="bs-card" id="bsRestoreBtn">
                <div class="bs-card-icon bs-card-icon-secondary">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                </div>
                <div class="bs-card-info">
                    <span>恢复数据</span>
                    <small>从 JSON 文件恢复设置和聊天记录</small>
                </div>
                <span class="bs-card-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"></polyline></svg></span>
                <input type="file" id="bsRestoreFileInput" accept=".json" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">
            </div>
            <div class="bs-warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>恢复数据将覆盖当前所有设置和聊天记录，请谨慎操作</span>
            </div>
        `,
        onClose: () => { backupRestoreSheet = null; },
    });
    backupRestoreSheet.show();

    // 绑定事件
    document.getElementById('bsBackupBtn').addEventListener('click', () => {
        backupData();
    });
    const bsRestoreBtn = document.getElementById('bsRestoreBtn');
    const bsFileInput = document.getElementById('bsRestoreFileInput');
    bsRestoreBtn.addEventListener('click', () => {
        if (window.AndroidBridge && typeof AndroidBridge.openRestoreFileChooser === 'function') {
            AndroidBridge.openRestoreFileChooser();
        } else if (window.AndroidBridge && typeof AndroidBridge.openFileChooser === 'function') {
            AndroidBridge.openFileChooser();
        } else {
            bsFileInput.click();
        }
    });
    bsFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            restoreData(file);
            bsFileInput.value = '';
        }
    });
}

// 关闭备份/恢复弹窗
function closeBackupRestoreModal() {
    if (backupRestoreSheet) {
        backupRestoreSheet.hide();
        backupRestoreSheet = null;
    }
}

// 通用：导出 IndexedDB 某个 store 的所有数据
async function exportIndexedDBStore(dbName, dbVersion, storeName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.close();
                resolve([]);
                return;
            }
            try {
                const tx = db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const results = [];
                const cursorReq = store.openCursor();
                cursorReq.onsuccess = () => {
                    const cursor = cursorReq.result;
                    if (cursor) {
                        results.push({ key: cursor.key, value: cursor.value });
                        cursor.continue();
                    } else {
                        db.close();
                        resolve(results);
                    }
                };
                cursorReq.onerror = () => {
                    db.close();
                    reject(cursorReq.error);
                };
            } catch (e) {
                db.close();
                reject(e);
            }
        };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
    });
}

// 通用：导入数据到 IndexedDB 某个 store
async function importIndexedDBStore(dbName, dbVersion, storeName, data) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);
        await new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, dbVersion);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.close();
                    reject('Store not found: ' + storeName);
                    return;
                }
                try {
                    const tx = db.transaction([storeName], 'readwrite');
                    const store = tx.objectStore(storeName);
                    for (const item of batch) {
                        if (item.key !== undefined) {
                            store.put(item.value, item.key);
                        } else {
                            store.put(item);
                        }
                    }
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        reject(tx.error);
                    };
                } catch (e) {
                    db.close();
                    reject(e);
                }
            };
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    const hasIdField = data && data.length > 0 && data[0] && typeof data[0].id !== 'undefined' && data[0].key === undefined;
                    if (hasIdField) {
                        db.createObjectStore(storeName, { keyPath: 'id' });
                    } else {
                        db.createObjectStore(storeName);
                    }
                }
            };
        });
        if ((i / BATCH_SIZE) % 5 === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }
}

// 备份数据
async function backupData() {
    const password = await promptPassword('请输入加密密码：');
    if (!password) {
        showToast('已取消备份');
        return;
    }
    if (password.length < 4) {
        showToast('密码至少需要4个字符');
        return;
    }

    const backupDataObj = {
        version: '2.0',
        timestamp: new Date().toISOString(),
        data: {},
        messages: [] // IndexedDB 中的消息数据
    };

    // 收集所有 cnai_ 开头的 localStorage 数据（排除消息数据，消息已迁移到 IndexedDB）
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cnai_') && !key.startsWith('cnai_messages_')) {
            try {
                backupDataObj.data[key] = JSON.parse(localStorage.getItem(key));
            } catch (e) {
                // 如果不是 JSON 格式，直接保存字符串
                backupDataObj.data[key] = localStorage.getItem(key);
            }
        }
    }

    // 收集 IndexedDB 中的消息数据
    try {
        const allMessages = await getAllMessagesFromDB();
        backupDataObj.messages = allMessages;
        console.log('备份: IndexedDB 消息数据已收集', allMessages.length, '条记录');
    } catch (e) {
        console.error('备份: 获取 IndexedDB 消息失败', e);
    }

    // 收集所有其他 IndexedDB 数据库
    backupDataObj.indexedDBData = {};
    const otherDBs = [
        { name: IMAGE_DB_NAME, version: IMAGE_DB_VERSION, store: IMAGE_STORE_NAME, key: 'images' },
        { name: FILE_DB_NAME, version: FILE_DB_VERSION, store: FILE_STORE_NAME, key: 'files' },
        { name: KNOWLEDGE_DB_NAME, version: KNOWLEDGE_DB_VERSION, store: KNOWLEDGE_STORE_NAME, key: 'knowledge' },
        { name: 'BluoxNotebook', version: 1, store: 'notes', key: 'notebook' }
    ];
    for (const dbInfo of otherDBs) {
        try {
            const data = await exportIndexedDBStore(dbInfo.name, dbInfo.version, dbInfo.store);
            if (data && data.length > 0) {
                backupDataObj.indexedDBData[dbInfo.key] = data;
                console.log('备份:', dbInfo.name, '已收集', data.length, '条记录');
            }
        } catch (e) {
            console.error('备份: 获取', dbInfo.name, '失败', e);
        }
    }

    // 收集 Android SharedPreferences 数据（仅在 Android 端）
    if (window.AndroidBridge && typeof AndroidBridge.getAllSharedPrefs === 'function') {
        try {
            const sharedPrefsJson = AndroidBridge.getAllSharedPrefs();
            backupDataObj.androidSharedPrefs = JSON.parse(sharedPrefsJson);
            console.log('备份: SharedPreferences 数据已收集', backupDataObj.androidSharedPrefs);
        } catch (e) {
            console.error('备份: 获取 SharedPreferences 失败', e);
        }
    }

    // 生成文件名：小蓝AI盒子_备份_日期_时间.json
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `小蓝AI盒子_备份_${dateStr}_${timeStr}.json`;

    try {
        const jsonContent = JSON.stringify(backupDataObj);
        const encrypted = await aesEncrypt(jsonContent, password);

        // 检查是否在 Android WebView 中，使用原生保存（会显示保存路径）
        if (window.AndroidBridge && typeof AndroidBridge.saveToFile === 'function') {
            AndroidBridge.saveToFile(fileName, encrypted);
        } else {
            // Web 环境使用下载方式
            const blob = new Blob([encrypted], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast('数据备份成功（已加密）');
        }
    } catch (error) {
        console.error('备份加密失败:', error);
        showToast('备份失败：加密出错');
    }

    closeBackupRestoreModal();
}

// 恢复数据（支持加密备份和旧版明文备份）
async function _restoreFromData(rawText) {
    let backupData;

    if (rawText.startsWith('AES:')) {
        // 加密备份，需要密码解密
        const password = await promptPassword('该备份已加密，请输入密码：');
        if (!password) {
            showToast('已取消恢复');
            return;
        }
        try {
            const decrypted = await aesDecrypt(rawText, password);
            backupData = JSON.parse(decrypted);
        } catch (e) {
            showToast('密码错误或文件已损坏');
            return;
        }
    } else {
        // 旧版明文备份，直接解析
        try {
            backupData = JSON.parse(rawText);
        } catch (e) {
            showToast('无效的备份文件格式');
            return;
        }
    }

    // 验证备份文件格式
    if (!backupData.version || !backupData.data) {
        showToast('无效的备份文件格式');
        return;
    }

    // 确认是否覆盖（等待用户确认）
    await new Promise(resolve => setTimeout(resolve, 500)); // 稍微延迟一下
    if (!confirm('恢复数据将覆盖当前所有设置和聊天记录，确定要继续吗？')) {
        return;
    }

    // 清除现有的 cnai_ 数据
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cnai_')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // 清除 IndexedDB 中的现有消息
    try {
        if (messageDB) {
            const tx = messageDB.transaction([MESSAGE_STORE_NAME], 'readwrite');
            const store = tx.objectStore(MESSAGE_STORE_NAME);
            store.clear();
            _messageExistsCache.clear();
            _messageRoundCache = {};
            console.log('恢复: 已清除 IndexedDB 中的旧消息');
        }
    } catch (e) {
        console.error('恢复: 清除 IndexedDB 旧消息失败', e);
    }

    // 恢复 localStorage 数据
    for (const key in backupData.data) {
        if (backupData.data.hasOwnProperty(key)) {
            const value = backupData.data[key];
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
    }

    // 恢复消息数据到 IndexedDB
    // 兼容旧版备份（v1.0 消息在 data 中）和新版备份（v2.0 消息在 messages 中）
    let messagesToRestore = [];
    if (backupData.messages && Array.isArray(backupData.messages) && backupData.messages.length > 0) {
        // 新版备份 v2.0：消息在 messages 字段
        messagesToRestore = backupData.messages;
    } else {
        // 旧版备份 v1.0：消息在 data 中的 cnai_messages_* 字段
        for (const key in backupData.data) {
            if (key.startsWith('cnai_messages_')) {
                const value = backupData.data[key];
                const msgs = typeof value === 'string' ? JSON.parse(value) : value;
                if (Array.isArray(msgs)) {
                    messagesToRestore.push({ key, messages: msgs });
                }
            }
        }
    }

    // 恢复消息数据到 IndexedDB（分批写入，避免 ANR）
    if (messagesToRestore.length > 0 && messageDB) {
        try {
            const BATCH_SIZE = 500;
            for (let i = 0; i < messagesToRestore.length; i += BATCH_SIZE) {
                const batch = messagesToRestore.slice(i, i + BATCH_SIZE);
                await new Promise((resolve, reject) => {
                    const tx = messageDB.transaction([MESSAGE_STORE_NAME], 'readwrite');
                    const store = tx.objectStore(MESSAGE_STORE_NAME);
                    for (const item of batch) {
                        store.put(item);
                        _messageExistsCache.add(item.key);
                        _messageRoundCache[item.key] = item.messages.filter(m => m.role === 'user').length;
                    }
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
                if ((i / BATCH_SIZE) % 5 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }
            console.log('恢复: IndexedDB 消息已恢复', messagesToRestore.length, '条记录');
        } catch (e) {
            console.error('恢复: 写入 IndexedDB 消息失败', e);
        }
    }

    // 恢复 Android SharedPreferences 数据（仅在 Android 端）
    if (window.AndroidBridge && typeof AndroidBridge.restoreSharedPrefs === 'function' && backupData.androidSharedPrefs) {
        try {
            AndroidBridge.restoreSharedPrefs(JSON.stringify(backupData.androidSharedPrefs));
            console.log('恢复: SharedPreferences 数据已恢复', backupData.androidSharedPrefs);
        } catch (e) {
            console.error('恢复: 恢复 SharedPreferences 失败', e);
        }
    }

    // 恢复其他 IndexedDB 数据（图片、文件、知识库、笔记）
    if (backupData.indexedDBData) {
        const dbMappings = {
            images: { name: IMAGE_DB_NAME, version: IMAGE_DB_VERSION, store: IMAGE_STORE_NAME },
            files: { name: FILE_DB_NAME, version: FILE_DB_VERSION, store: FILE_STORE_NAME },
            knowledge: { name: KNOWLEDGE_DB_NAME, version: KNOWLEDGE_DB_VERSION, store: KNOWLEDGE_STORE_NAME },
            notebook: { name: 'BluoxNotebook', version: 1, store: 'notes' }
        };
        for (const [key, data] of Object.entries(backupData.indexedDBData)) {
            const mapping = dbMappings[key];
            if (mapping && Array.isArray(data) && data.length > 0) {
                try {
                    await importIndexedDBStore(mapping.name, mapping.version, mapping.store, data);
                    console.log('恢复:', key, '已恢复', data.length, '条记录');
                } catch (e) {
                    console.error('恢复:', key, '失败', e);
                }
                // 每个数据库恢复完后让出主线程
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }

    showToast('数据恢复成功，正在重新加载...');
    setTimeout(() => location.reload(), 1000);
}

// Web 端恢复数据
function restoreData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        _restoreFromData(e.target.result).catch(error => {
            console.error('恢复数据失败:', error);
            showToast('恢复数据失败，请检查文件格式');
        });
    };
    reader.onerror = function () {
        showToast('读取文件失败');
    };
    reader.readAsText(file);
}

// 通过 AndroidBridge.readUriContent 分段读取 URI 内容（fetch fallback）
async function _readUriViaBridge(uri) {
    const CHUNK_SIZE = 1024 * 1024; // 每段 1MB，减少往返次数
    let offset = 0;
    let parts = [];
    let totalSize = -1;
    while (true) {
        const resultJson = AndroidBridge.readUriContent(uri, offset, CHUNK_SIZE);
        const result = JSON.parse(resultJson);
        if (result.error) {
            throw new Error(result.error);
        }
        parts.push(result.text);
        if (totalSize < 0 && result.totalSize > 0) {
            totalSize = result.totalSize;
        }
        if (result.endOfFile) break;
        offset += CHUNK_SIZE;
        // 每 10 段让出一次主线程，减少不必要的调度开销
        if (parts.length % 10 === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }
    return parts.join('');
}

// 处理安卓端选择的恢复数据文件（通过 URI，支持大文件）
// 由 Java 端传入 content:// URI，JS 端自行 fetch 读取
// 如果 fetch 失败（content:// 协议在某些 WebView 版本不支持），降级为 AndroidBridge 分段读取
window.handleAndroidRestoreFile = async function (uri) {
    if (!uri) {
        showToast('读取文件失败');
        return;
    }
    try {
        showToast('正在读取备份文件...');
        let rawText;
        // 先尝试 fetch（更快），失败则降级为 bridge 分段读取
        if (window.AndroidBridge && typeof AndroidBridge.readUriContent === 'function') {
            try {
                const response = await fetch(uri);
                if (!response.ok) throw new Error('HTTP ' + response.status);
                rawText = await response.text();
            } catch (fetchError) {
                console.warn('fetch 读取失败，降级为 bridge 分段读取:', fetchError.message);
                rawText = await _readUriViaBridge(uri);
            }
        } else {
            const response = await fetch(uri);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            rawText = await response.text();
        }
        _restoreFromData(rawText).catch(error => {
            console.error('恢复数据失败:', error);
            showToast('恢复数据失败，请检查文件格式');
        });
    } catch (e) {
        console.error('读取备份文件失败:', e);
        showToast('读取文件失败: ' + e.message);
    }
};

// 兼容旧版：保留 handleAndroidRestoreData 作为 fallback
window.handleAndroidRestoreData = async function (rawText) {
    if (!rawText) {
        showToast('读取文件失败');
        return;
    }
    _restoreFromData(rawText).catch(error => {
        console.error('恢复数据失败:', error);
        showToast('恢复数据失败，请检查文件格式');
    });
};

// 事件绑定
// 备份恢复子弹窗内按钮事件绑定
const bsBackupBtn = document.getElementById('bsBackupBtn');
const bsRestoreBtn = document.getElementById('bsRestoreBtn');
const bsFileInput = document.getElementById('bsRestoreFileInput');

if (bsBackupBtn) {
    bsBackupBtn.addEventListener('click', () => {
        backupData();
    });
}
if (bsRestoreBtn) {
    bsRestoreBtn.addEventListener('click', () => {
        if (window.AndroidBridge && typeof AndroidBridge.openRestoreFileChooser === 'function') {
            AndroidBridge.openRestoreFileChooser();
        } else if (window.AndroidBridge && typeof AndroidBridge.openFileChooser === 'function') {
            AndroidBridge.openFileChooser();
        } else {
            bsFileInput && bsFileInput.click();
        }
    });
}
if (bsFileInput) {
    bsFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) restoreData(file);
    });
}

// 点击其他地方关闭菜单
document.addEventListener('click', () => {
    // 如果正在渲染消息，不关闭菜单
    if (isRenderingMessages) {
        return;
    }

    closeChatMenuSheet();
});

// ==================== 知识库参考子菜单功能 ====================

// 渲染知识库文档列表到子菜单
// 显示知识库参考选择器
async function showKnowledgeRefPicker() {
    const documents = await getAllKnowledgeDocuments();
    const items = [];

    if (documents.length === 0) {
        items.push({ value: '__empty__', label: '暂无知识库文档' });
    } else {
        items.push({ value: null, label: '全部文档（默认）' });
        documents.forEach(doc => {
            items.push({ value: doc.id, label: doc.name });
        });
    }

    items.push('divider');
    const toggleLabel = knowledgeBaseEnabled ? '关闭知识库检索' : '开启知识库检索';
    items.push({ value: '__toggle__', label: toggleLabel, className: knowledgeBaseEnabled ? '' : 'bs-item-danger' });

    createBottomSheetPicker({
        items,
        activeValue: selectedKnowledgeDocId,
        onSelect: (item) => {
            if (item.value === '__toggle__') {
                toggleKnowledgeBaseStatus();
                return;
            }
            if (item.value === '__empty__') return;
            selectKnowledgeDoc(item.value, item.label);
        },
    }).show();
}

// 选择知识库文档
function selectKnowledgeDoc(docId, docName = null) {
    selectedKnowledgeDocId = docId;

    if (docId === null) {
        localStorage.removeItem('cnai_selected_knowledge_doc_id');
    } else {
        localStorage.setItem('cnai_selected_knowledge_doc_id', docId);
    }

    // 自动开启知识库检索
    if (!knowledgeBaseEnabled) {
        knowledgeBaseEnabled = true;
        localStorage.setItem('cnai_knowledge_base_enabled', 'true');
    }

    updateKnowledgeBaseToggleUI();

    // 显示提示
    if (docId === null) {
        showToast('将使用全部知识库文档');
    } else {
        showToast(`已选择: ${docName}`);
    }
}

// 更新知识库检索切换按钮状态
function updateKnowledgeBaseToggleUI() {
    if (!toggleKnowledgeBase || !toggleKnowledgeBaseLabel) return;

    if (knowledgeBaseEnabled) {
        toggleKnowledgeBase.classList.remove('disabled');
        toggleKnowledgeBase.classList.add('enabled');
        toggleKnowledgeBaseLabel.textContent = '知识库检索已开启';
    } else {
        toggleKnowledgeBase.classList.remove('enabled');
        toggleKnowledgeBase.classList.add('disabled');
        toggleKnowledgeBaseLabel.textContent = '知识库检索已关闭';
    }
}

// 切换知识库检索开关
function toggleKnowledgeBaseStatus() {
    knowledgeBaseEnabled = !knowledgeBaseEnabled;
    localStorage.setItem('cnai_knowledge_base_enabled', knowledgeBaseEnabled);
    updateKnowledgeBaseToggleUI();
    showToast(knowledgeBaseEnabled ? '知识库检索已开启' : '知识库检索已关闭');
}

// 知识库检索切换按钮点击事件
if (toggleKnowledgeBase) {
    toggleKnowledgeBase.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleKnowledgeBaseStatus();
    });
}



// 导出当前话题
// 触发上传图片
function triggerUploadImage() {
    if (window.AndroidBridge && typeof AndroidBridge.openImageChooser === 'function') {
        AndroidBridge.openImageChooser();
    } else {
        document.getElementById('imageUploadInput')?.click();
    }
}

// 触发上传文件
function triggerUploadFile() {
    if (window.AndroidBridge && typeof AndroidBridge.openUploadFileChooser === 'function') {
        AndroidBridge.openUploadFileChooser();
    } else {
        document.getElementById('fileUploadInput')?.click();
    }
}

// 触发导出当前话题（更多操作菜单）
// 侧边栏导入目标话题记录：{ agentId, topicId }，导入完成后清空
let _pendingImportTarget = null;

// 导出指定话题（侧边栏菜单和更多操作共用）
async function exportTopic(agentId, topicId, topicName) {
    if (!confirm('确定导出该话题？导出文件不加密，请妥善保管。')) return;
    const messagesKey = 'cnai_messages_' + agentId + '_topic_' + topicId;
    let topicMessages = await getMessagesFromDB(messagesKey);
    if (!topicMessages || topicMessages.length === 0) {
        showToast('该话题没有消息，无法导出');
        return;
    }
    const agent = agents.find(a => a.id === agentId) || { id: agentId, name: agentId, icon: '🤖' };
    const exportData = {
        version: 1,
        exportTime: new Date().toISOString(),
        agent: { id: agentId, name: agent.name, icon: agent.icon },
        topic: { id: topicId, name: topicName },
        messages: topicMessages.map(msg => {
            const newMsg = msg.role === 'assistant'
                ? Object.assign({}, msg, { aiDisclaimer: '内容由AI生成' })
                : Object.assign({}, msg);
            if (newMsg.id) newMsg.id = newMsg.id + '_ex';
            if (newMsg.prevId) newMsg.prevId = newMsg.prevId + '_ex';
            if (newMsg.versions) {
                newMsg.versions = newMsg.versions.map(v => {
                    const nv = Object.assign({}, v);
                    if (nv.id) nv.id = nv.id + '_ex';
                    if (nv.prevId) nv.prevId = nv.prevId + '_ex';
                    return nv;
                });
            }
            return newMsg;
        })
    };
    const jsonContent = JSON.stringify(exportData, null, 2);
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const fileName = agent.name + '-' + topicName + '-' + dateStr + '.json';
    if (window.AndroidBridge && typeof AndroidBridge.saveToFile === 'function') {
        AndroidBridge.saveToFile(fileName, jsonContent);
    } else {
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('话题已导出');
    }
}

// 触发导出当前话题（更多操作菜单）
function triggerExportChat() {
    const topics = getCurrentAgentTopics();
    const topic = topics.find(t => t.id === currentTopicId) || topics[0];
    // 弹出格式选择
    const formatSheet = createBottomSheetPicker({
        items: [
            { value: 'json', label: '导出为 JSON', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>' },
            { value: 'md', label: '导出为 Markdown', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M9 13l-2 2 2 2M15 13l2 2-2 2"></path></svg>' },
            { value: 'html', label: '导出为 HTML', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M10 13a5 5 0 0 0 0 7M14 13a5 5 0 0 1 0 7"></path></svg>' }
        ],
        activeValue: null,
        onSelect: (item) => {
            if (item.value === 'md') {
                exportTopicAsMarkdown(currentAgentId, currentTopicId, topic.name);
            } else if (item.value === 'html') {
                exportTopicAsHTML(currentAgentId, currentTopicId, topic.name);
            } else {
                exportTopic(currentAgentId, currentTopicId, topic.name);
            }
        },
    });
    formatSheet.show();
}

// 导出指定话题为 Markdown
async function exportTopicAsMarkdown(agentId, topicId, topicName) {
    const messagesKey = 'cnai_messages_' + agentId + '_topic_' + topicId;
    let topicMessages = await getMessagesFromDB(messagesKey);
    if (!topicMessages || topicMessages.length === 0) {
        showToast('该话题没有消息，无法导出');
        return;
    }
    const agent = agents.find(a => a.id === agentId) || { id: agentId, name: agentId, icon: '🤖' };
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    // 构建 Markdown 内容
    let md = '';
    md += `# ${topicName}\n\n`;
    md += `> 智能体: ${agent.name}  |  导出时间: ${dateStr}\n\n`;
    md += `---\n\n`;

    for (const msg of topicMessages) {
        if (msg.role === 'system') continue;
        if (msg.role === 'tool') continue;
        // 跳过仅含 tool_calls 无文本内容的 assistant 消息
        if (msg.role === 'assistant' && msg.tool_calls && (!msg.content || msg.content === null)) continue;
        if (msg.role === 'user') {
            md += `## ☆ 用户\n\n${msg.content || ''}\n\n`;
        } else if (msg.role === 'assistant') {
            md += `## ★ ${agent.name}\n\n${msg.content || ''}\n\n`;
        }
        // 如果有图片附件
        if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
                md += `> [图片] ${img.name || 'image'}\n`;
            }
            md += '\n';
        }
        md += `---\n\n`;
    }

    md += `\n> AI 生成内容仅供参考\n`;

    const fileName = agent.name + '-' + topicName + '-' + dateStr + '.md';
    if (window.AndroidBridge && typeof AndroidBridge.saveToFile === 'function') {
        AndroidBridge.saveToFile(fileName, md);
    } else {
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('话题已导出为 Markdown');
    }
}

// 导出指定话题为 HTML
async function exportTopicAsHTML(agentId, topicId, topicName) {
    const messagesKey = 'cnai_messages_' + agentId + '_topic_' + topicId;
    let topicMessages = await getMessagesFromDB(messagesKey);
    if (!topicMessages || topicMessages.length === 0) {
        showToast('该话题没有消息，无法导出');
        return;
    }
    const agent = agents.find(a => a.id === agentId) || { id: agentId, name: agentId, icon: '🤖' };
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    // HTML 转义
    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 构建消息体
    let msgHTML = '';
    for (const msg of topicMessages) {
        if (msg.role === 'system') continue;
        if (msg.role === 'tool') continue;
        // 跳过仅含 tool_calls 无文本内容的 assistant 消息
        if (msg.role === 'assistant' && msg.tool_calls && (!msg.content || msg.content === null)) continue;
        const isUser = msg.role === 'user';
        const roleLabel = isUser ? '☆ 用户' : '★ ' + agent.name;
        const bubbleClass = isUser ? 'user' : 'assistant';
        // 用 marked 渲染 Markdown
        let renderedContent;
        try {
            renderedContent = marked.parse(msg.content || '', { breaks: true, gfm: true });
        } catch (e) {
            renderedContent = esc(msg.content);
        }
        msgHTML += `<div class="msg ${bubbleClass}">\n`;
        msgHTML += `  <div class="role">${esc(roleLabel)}</div>\n`;
        msgHTML += `  <div class="content">${renderedContent}</div>\n`;
        // 图片附件
        if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
                if (img.dataUrl) {
                    msgHTML += `  <img class="image" src="${esc(img.dataUrl)}" alt="${esc(img.name || 'image')}" />\n`;
                } else {
                    msgHTML += `  <div class="image-placeholder">[图片] ${esc(img.name || 'image')}</div>\n`;
                }
            }
        }
        msgHTML += `</div>\n`;
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(topicName)} - ${esc(agent.name)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: #f0f2f5;
    color: #1a1a1a;
    padding: 16px;
  }
  .header {
    max-width: 800px;
    margin: 0 auto 20px;
    text-align: center;
  }
  .header h1 { font-size: 22px; margin-bottom: 6px; }
  .header .meta { font-size: 13px; color: #888; }
  .chat {
    max-width: 800px;
    margin: 0 auto;
  }
  .msg {
    margin-bottom: 16px;
    padding: 14px 18px;
    border-radius: 12px;
    line-height: 1.7;
    word-break: break-word;
  }
  .msg.user {
    background: #e7f0ff;
    border-left: 4px solid #2196f3;
  }
  .msg.assistant {
    background: #fff;
    border-left: 4px solid #4caf50;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .role {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #666;
  }
  .msg.user .role { color: #1976d2; }
  .msg.assistant .role { color: #388e3c; }
  .content { font-size: 15px; }
  .content p { margin: 0 0 8px; }
  .content p:last-child { margin-bottom: 0; }
  .content h1, .content h2, .content h3, .content h4 { margin: 12px 0 6px; font-weight: 600; }
  .content h1 { font-size: 1.4em; }
  .content h2 { font-size: 1.25em; }
  .content h3 { font-size: 1.1em; }
  .content ul, .content ol { margin: 6px 0; padding-left: 24px; }
  .content li { margin: 2px 0; }
  .content blockquote {
    border-left: 3px solid #d0d0d0;
    margin: 8px 0;
    padding: 4px 12px;
    color: #666;
    background: rgba(0,0,0,0.03);
    border-radius: 0 6px 6px 0;
  }
  .content pre {
    background: #1e1e2e;
    color: #cdd6f4;
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 8px 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .content pre code {
    background: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .content code {
    background: rgba(0,0,0,0.06);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.9em;
  }
  .content table {
    border-collapse: collapse;
    margin: 8px 0;
    width: 100%;
    font-size: 14px;
  }
  .content th, .content td {
    border: 1px solid #ddd;
    padding: 6px 12px;
    text-align: left;
  }
  .content th {
    background: #f5f5f5;
    font-weight: 600;
  }
  .content tr:nth-child(even) { background: #fafafa; }
  .content a { color: #1976d2; text-decoration: none; }
  .content a:hover { text-decoration: underline; }
  .content img { max-width: 100%; border-radius: 8px; margin: 8px 0; }
  .content hr { border: none; border-top: 1px solid #e0e0e0; margin: 12px 0; }
  .content strong { font-weight: 600; }
  .image {
    max-width: 300px;
    border-radius: 8px;
    margin-top: 8px;
    display: block;
  }
  .image-placeholder {
    color: #aaa;
    font-size: 13px;
    margin-top: 6px;
    font-style: italic;
  }
  .disclaimer {
    max-width: 800px;
    margin: 16px auto 0;
    text-align: center;
    font-size: 12px;
    color: #aaa;
  }
  @media (max-width: 600px) {
    body { padding: 8px; }
    .msg { padding: 10px 14px; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>${esc(topicName)}</h1>
    <div class="meta">${esc(agent.name)}  |  ${dateStr}</div>
  </div>
  <div class="chat">
${msgHTML}  </div>
  <div class="disclaimer">AI 生成内容仅供参考</div>
</body>
</html>`;

    const fileName = agent.name + '-' + topicName + '-' + dateStr + '.html';
    if (window.AndroidBridge && typeof AndroidBridge.saveToFile === 'function') {
        AndroidBridge.saveToFile(fileName, html);
    } else {
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('话题已导出为 HTML');
    }
}

// 触发导入聊天记录
function triggerImportChat() {
    if (window.AndroidBridge && typeof AndroidBridge.openFileChooser === 'function') {
        AndroidBridge.openFileChooser();
    } else {
        document.getElementById('importChatInput')?.click();
    }
}


// dataURL 转 Blob 辅助函数
function dataURLtoBlob(dataUrl) {
    try {
        const arr = dataUrl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    } catch (e) {
        console.error('dataURLtoBlob 失败:', e);
        return null;
    }
}


// 处理安卓端选择的图片
window.handleAndroidImageSelected = function (dataUrl) {
    if (!dataUrl) return;

    // 如果是选择聊天背景图片
    if (window._chatBgSelecting) {
        window._chatBgSelecting = false;
        editingChatBg = dataUrl;
        updateChatBgPreview();
        saveAgentField();
        return;
    }

    // 添加到待发送图片列表
    const imageName = 'image_' + Date.now() + '.jpg';

    // 自动压缩检查（估算 base64 大小）
    const estimatedSizeBytes = Math.floor(dataUrl.length * 0.75); // base64 字符串大小约等于原始字节数的 4/3

    if (autoCompressImageEnabled && estimatedSizeBytes > compressThresholdMB * 1024 * 1024) {
        // 需要压缩
        const tempBlob = dataURLtoBlob(dataUrl);
        if (tempBlob) {
            compressImageUtil(tempBlob, {
                quality: 0.8,
                maxSizeMB: compressTargetSizeMB
            }).then(result => {
                pendingImages.push({
                    id: Date.now() + Math.random(),
                    base64: result.base64,
                    name: imageName,
                    compressed: true
                });
                renderImagePreviews();
                const originalKB = (estimatedSizeBytes / 1024).toFixed(0);
                const compressedKB = (result.size / 1024).toFixed(0);
                showToast(`图片已压缩: ${originalKB}KB → ${compressedKB}KB`);
            }).catch(err => {
                console.error('自动压缩失败，使用原图:', err);
                pendingImages.push({
                    id: Date.now() + Math.random(),
                    base64: dataUrl,
                    name: imageName
                });
                renderImagePreviews();
            });
        } else {
            pendingImages.push({
                id: Date.now() + Math.random(),
                base64: dataUrl,
                name: imageName
            });
            renderImagePreviews();
        }
    } else {
        pendingImages.push({
            id: Date.now() + Math.random(),
            base64: dataUrl,
            name: imageName
        });
        renderImagePreviews();
    }
};

// 上传文件 - 安卓端使用原生文件选择器

// 处理安卓端选择的文件
window.handleAndroidFileSelected = async function (fileData) {
    if (!fileData || !fileData.base64) return;

    try {
        // 解码 base64 获取文件内容
        const binaryString = atob(fileData.base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const ext = fileData.name.split('.').pop().toLowerCase();
        let content = '';

        if (ext === 'pdf') {
            // 优先原生解析
            if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function' && fileData.path) {
                try {
                    const jsonStr = window.AndroidBridge.extractFileText(fileData.path);
                    const data = JSON.parse(jsonStr);
                    if (data.text) { content = data.text; }
                    else { content = await extractTextFromPDF(arrayBuffer); }
                } catch (e) { content = await extractTextFromPDF(arrayBuffer); }
            } else {
                content = await extractTextFromPDF(arrayBuffer);
            }
        } else if (ext === 'docx' || ext === 'doc') {
            if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function' && fileData.path) {
                try {
                    const jsonStr = window.AndroidBridge.extractFileText(fileData.path);
                    const data = JSON.parse(jsonStr);
                    if (data.text) { content = data.text; }
                    else { content = await extractTextFromWord(arrayBuffer); }
                } catch (e) { content = await extractTextFromWord(arrayBuffer); }
            } else {
                content = await extractTextFromWord(arrayBuffer);
            }
        } else if (ext === 'pptx' || ext === 'ppt' || ext === 'xlsx' || ext === 'xls') {
            if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function' && fileData.path) {
                const jsonStr = window.AndroidBridge.extractFileText(fileData.path);
                const data = JSON.parse(jsonStr);
                if (data.error) throw new Error(data.error);
                content = data.text;
            } else {
                throw new Error('当前环境不支持 ' + ext.toUpperCase() + ' 文件解析');
            }
        } else {
            // 纯文本文件直接解码
            const decoder = new TextDecoder('utf-8');
            content = decoder.decode(arrayBuffer);
        }

        // 检查提取的内容长度
        if (content.length > 100000) {
            alert(`文件 "${fileData.name}" 内容过长（${content.length} 字符），已截取前 100000 字符`);
            content = content.substring(0, 100000);
        }

        pendingFiles.push({
            id: Date.now() + Math.random(),
            name: fileData.name,
            type: fileData.mimeType || 'text/plain',
            size: arrayBuffer.byteLength,
            content: content
        });

        renderFilePreviews();
    } catch (error) {
        console.error('文件处理失败:', error);
        alert(`文件 "${fileData.name}" 处理失败: ${error.message}`);
    }
};

// 处理安卓端选择的知识库文件（由 Java 端通知后，JS 主动拉取数据）
window.handleAndroidKnowledgeFilesReady = async function () {
    let filesData = null;
    try {
        const raw = AndroidBridge.getPendingKnowledgeFiles();
        if (!raw) {
            console.warn('知识库文件数据为空');
            return;
        }
        filesData = JSON.parse(raw);
    } catch (e) {
        console.error('拉取知识库文件数据失败:', e);
        return;
    }
    await handleAndroidKnowledgeFilesSelected(filesData);
};

// 处理安卓端选择的知识库文件
window.handleAndroidKnowledgeFilesSelected = async function (filesData) {
    if (!filesData || !Array.isArray(filesData) || filesData.length === 0) return;

    showToast('正在处理文档，请稍候...');

    let successCount = 0;
    let errorCount = 0;

    for (const fileData of filesData) {
        if (!fileData || !fileData.base64) continue;

        try {
            // 解码 base64 获取文件内容
            const binaryString = atob(fileData.base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const arrayBuffer = bytes.buffer;

            const ext = fileData.name.split('.').pop().toLowerCase();
            let content = '';

            if (ext === 'pdf') {
                if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function' && fileData.path) {
                    try {
                        const jsonStr = window.AndroidBridge.extractFileText(fileData.path);
                        const data = JSON.parse(jsonStr);
                        if (data.text) { content = data.text; }
                        else { content = await extractTextFromPDF(arrayBuffer); }
                    } catch (e) { content = await extractTextFromPDF(arrayBuffer); }
                } else {
                    content = await extractTextFromPDF(arrayBuffer);
                }
            } else if (ext === 'docx' || ext === 'doc') {
                if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function' && fileData.path) {
                    try {
                        const jsonStr = window.AndroidBridge.extractFileText(fileData.path);
                        const data = JSON.parse(jsonStr);
                        if (data.text) { content = data.text; }
                        else { content = await extractTextFromWord(arrayBuffer); }
                    } catch (e) { content = await extractTextFromWord(arrayBuffer); }
                } else {
                    content = await extractTextFromWord(arrayBuffer);
                }
            } else if (ext === 'pptx' || ext === 'ppt' || ext === 'xlsx' || ext === 'xls') {
                if (window.AndroidBridge && typeof window.AndroidBridge.extractFileText === 'function' && fileData.path) {
                    const jsonStr = window.AndroidBridge.extractFileText(fileData.path);
                    const data = JSON.parse(jsonStr);
                    if (data.error) throw new Error(data.error);
                    content = data.text;
                } else {
                    throw new Error('当前环境不支持 ' + ext.toUpperCase() + ' 文件解析');
                }
            } else {
                // 纯文本文件直接解码
                const decoder = new TextDecoder('utf-8');
                content = decoder.decode(arrayBuffer);
            }

            if (!content || content.trim().length === 0) {
                errorCount++;
                continue;
            }

            await ensureKnowledgeBase();
            const chunks = chunkText(content);
            if (chunks.length === 0) {
                errorCount++;
                continue;
            }

            const doc = {
                id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                name: fileData.name,
                content: content,
                chunks: chunks,
                size: arrayBuffer.byteLength,
                createdAt: Date.now(),
                hasEmbeddings: false
            };

            await saveDocumentToKnowledgeBase(doc);
            successCount++;
        } catch (error) {
            console.error('处理文件失败:', fileData.name, error);
            errorCount++;
        }
    }

    // 刷新知识库列表
    await renderKnowledgeBaseList();

    if (successCount > 0) {
        showToast(`成功上传 ${successCount} 个文档${errorCount > 0 ? `，${errorCount} 个失败` : ''}`);
    } else {
        showToast('文档上传失败');
    }
};

// 处理安卓端导入聊天记录文件（通过 URI，支持大文件）
window.importChatFile = async function (uri) {
    if (!uri) {
        showToast('读取文件失败');
        return;
    }
    try {
        showToast('正在读取聊天记录...');
        let rawText;
        // 先尝试 fetch（更快），失败则降级为 bridge 分段读取
        if (window.AndroidBridge && typeof AndroidBridge.readUriContent === 'function') {
            try {
                const response = await fetch(uri);
                if (!response.ok) throw new Error('HTTP ' + response.status);
                rawText = await response.text();
            } catch (fetchError) {
                console.warn('fetch 读取失败，降级为 bridge 分段读取:', fetchError.message);
                rawText = await _readUriViaBridge(uri);
            }
        } else {
            const response = await fetch(uri);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            rawText = await response.text();
        }
        importChatData(rawText);
    } catch (e) {
        console.error('读取聊天记录失败:', e);
        showToast('读取文件失败: ' + e.message);
    }
};

// 导入聊天数据
async function importChatData(data) {
    try {
        // 支持传入字符串或对象
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        // 验证数据格式
        if (!data.messages || !Array.isArray(data.messages)) {
            throw new Error('无效的聊天记录格式');
        }

        const newMessages = data.messages;
        newMessages.forEach(msg => { msg.spareField1 = 1; });

        // 判断是否指定了目标话题（侧边栏菜单导入）
        if (_pendingImportTarget) {
            const { agentId, topicId } = _pendingImportTarget;
            _pendingImportTarget = null;
            const targetKey = 'cnai_messages_' + agentId + '_topic_' + topicId;
            let existingMsgs = await getMessagesFromDB(targetKey);
            if (existingMsgs && existingMsgs.length > 0) {
                const lastMsg = existingMsgs[existingMsgs.length - 1];
                newMessages[0].prevId = lastMsg.id;
                existingMsgs = [...existingMsgs, ...newMessages];
            } else {
                newMessages[0].prevId = topicId + '_root';
                existingMsgs = [...newMessages];
            }
            await new Promise(function(resolve) { saveMessagesToDB(targetKey, existingMsgs); setTimeout(resolve, 200); });
            // 更新话题状态
            const topics = agentTopics[agentId];
            if (topics) {
                const topic = topics.find(t => t.id === topicId);
                if (topic) {
                    topic.hasContent = true;
                    saveAgentTopics();
                }
            }
            initTopicsContentStatus();
            renderAllAgentTopics();
            // 如果导入的是当前话题，重新加载
            if (agentId === currentAgentId && topicId === currentTopicId) {
                switchAgentAndTopic(agentId, topicId);
            }
            showToast(`已导入 ${newMessages.length} 条消息到指定话题`);
            return;
        }

        // 追加消息到当前话题
        if (messages.length > 0 && newMessages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            newMessages[0].prevId = lastMsg.id;
        } else if (newMessages.length > 0) {
            newMessages[0].prevId = getTopicRootId();
        }
        messages = [...messages, ...newMessages];
        await saveMessages(messages);

        // 直接重新加载当前话题（替代手动渲染和按钮更新）
        switchAgentAndTopic(currentAgentId, currentTopicId);

        // 更新当前话题的内容状态
        initTopicsContentStatus();

        // 确保当前话题标记为有内容，并更新活跃时间
        const currentTopics = agentTopics[currentAgentId];
        if (currentTopics) {
            const currentTopic = currentTopics.find(t => t.id === currentTopicId);
            if (currentTopic) {
                let changed = false;
                if (!currentTopic.hasContent) { currentTopic.hasContent = true; changed = true; }
                currentTopic.lastActiveTime = Date.now();
                changed = true;
                if (changed) saveAgentTopics();
            }
        }

        // 更新智能体标签栏显示状态
        if (messages.length === 0) {
            showWelcomeMessage();
        }
        updateAgentTagsBarVisibility();

        showToast(`已导入 ${newMessages.length} 条消息，共 ${messages.length} 条`);
    } catch (error) {
        console.error('导入失败:', error);
        showToast('导入失败：' + error.message);
    }
}

importChatInput.addEventListener('change', (e) => {
    closeChatMenuSheet();
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            let content = event.target.result;
            // 兼容双重转义的JSON：如果内容以引号开头，尝试先解析一次字符串
            if (content.trim().startsWith('"')) {
                try {
                    content = JSON.parse(content);
                } catch (e) {
                    // 忽略，用原始内容
                }
            }
            const data = JSON.parse(content);
            importChatData(data);
        } catch (error) {
            console.error('导入失败:', error);
            showToast('导入失败：' + error.message);
        }
    };
    reader.readAsText(file);

    // 清空 input，允许重复导入同一文件
    e.target.value = '';
});

// ========== 智能体删除选项功能 ==========

// 执行删除智能体
async function executeDeleteAgent(agentId) {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    if (agent.isBuiltIn) {
        showToast('无法删除内置智能体');
        return;
    }

    if (!confirm(`确定要删除智能体"${agent.name}"吗？\n删除后该智能体的所有话题和聊天记录都将被删除。`)) return;

    // 删除智能体
    agents = agents.filter(a => a.id !== agentId);
    localStorage.setItem('cnai_agents', JSON.stringify(agents));

    // 删除该智能体的所有话题数据
    if (agentTopics[agentId]) {
        // 删除所有话题的消息记录
        agentTopics[agentId].forEach(topic => {
            const topicMessagesKey = `cnai_messages_${agentId}_topic_${topic.id}`;
            deleteMessagesFromDB(topicMessagesKey);
        });
        // 删除默认话题的消息
        deleteMessagesFromDB(`cnai_messages_${agentId}`);
        // 删除话题列表
        delete agentTopics[agentId];
        saveAgentTopics();
    }

    // 删除当前话题选择记录
    delete currentTopicByAgent[agentId];
    localStorage.setItem('cnai_current_topic_by_agent', JSON.stringify(currentTopicByAgent));

    // 如果删除的是当前智能体，切换到默认智能体
    if (currentAgentId === agentId) {
        currentAgentId = 'default';
        localStorage.setItem('cnai_current_agent', currentAgentId);
        currentTopicId = currentTopicByAgent[currentAgentId] || 'topic_1';
        updateAgentDisplay();
        updateTopicDisplay();

        // 加载默认智能体的消息或显示欢迎语
        messages = await getMessages();
        disposeAllCharts();
        chatContainer.innerHTML = '';
        if (messages.length > 0) {
            renderMessagesToChat(messages);
        } else {
            showWelcomeMessage();
        }
    }

    closeAgentSelectModal();
    renderAgentList();
    showToast('智能体已删除');
}

// ============================================
// 键盘高度变化回调 - 由原生 Android 调用
// 移动容器和弹窗，标题栏保持固定
// ============================================

// ============================================
// adjustPan 模式下固定标题栏 - 使用原生状态栏高度
// ============================================
function initHeaderFix() {
    const header = document.querySelector('.header');
    const container = document.querySelector('.container');
    if (!header) return;

    // 存储状态栏高度
    let statusBarHeight = 0;
    let headerTop = 0; // 标题栏应该固定的位置（状态栏下方）

    // 从原生 Android 获取状态栏高度
    function getStatusBarHeightFromNative() {
        // 如果 StatusBar 插件已设置 overlaysWebView(false)，则不需要额外偏移
        // 因为 WebView 内容已经从状态栏下方开始
        if (window.StatusBar) {
            return 0;
        }
        if (window.AndroidBridge && typeof AndroidBridge.getStatusBarHeight === 'function') {
            try {
                return AndroidBridge.getStatusBarHeight();
            } catch (e) {
                console.log('获取状态栏高度失败:', e);
            }
        }
        return 0;
    }



    // 固定标题栏位置
    function fixHeaderPosition() {
        // 更新容器上边距
        if (container) {
            // 横屏模式下不需要设置 marginTop，container 覆盖整个屏幕
            if (isLandscapeMode) {
                container.style.marginTop = '0px';
                // 横屏下去掉标题栏子元素的 paddingTop
                if (header) {
                    const children = header.children;
                    for (let i = 0; i < children.length; i++) {
                        children[i].style.paddingTop = '0px';
                    }
                }
                console.log("容器margintop:", container.style.marginTop);
            } else {
                // 设置标题栏子元素 padding-top 为状态栏高度
                if (header) {
                    const children = header.children;
                    for (let i = 0; i < children.length; i++) {
                        children[i].style.paddingTop = headerTop + 'px';
                    }
                }
                const headerHeight = header.offsetHeight || 72;
                container.style.marginTop = headerHeight + 'px';

            }

        }
    }

    // 监听键盘变化，重新获取状态栏位置并固定标题栏
    function handleKeyboardChange() {
        // 重新从原生获取状态栏高度
        const newStatusBarHeight = getStatusBarHeightFromNative();
        headerTop = newStatusBarHeight;
    }

    // 初始化
    function init() {
        // 获取初始状态栏高度
        statusBarHeight = getStatusBarHeightFromNative();
        headerTop = statusBarHeight;
        fixHeaderPosition();

        // 使用 visualViewport 监听键盘
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function () {
                // 延迟获取，等待原生视图稳定
                setTimeout(handleKeyboardChange, 50);
            });
        }

        // 监听窗口大小变化
        window.addEventListener('resize', function () {
            setTimeout(handleKeyboardChange, 100);
        });

        // 监听输入框焦点
        document.addEventListener('focus', function (e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                setTimeout(handleKeyboardChange, 150);
            }
        }, true);

        document.addEventListener('blur', function (e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                setTimeout(handleKeyboardChange, 200);
            }
        }, true);
    }

    // 延迟初始化，确保原生接口就绪
    setTimeout(init, 100);
}

// 等待 Cordova 设备就绪
document.addEventListener('deviceready', function () {
    // 初始化状态栏
    initAppWithStatusBar();
    // 初始化标题栏固定
    initHeaderFix();
    // 初始化应用
    init();
}, false);

// 处理 Android 返回键
let backPressTime = 0;
let backPressToast = null;

function handleBackButton() {
    // 1. 首先检查是否有打开的底部面板
    const activeBsOverlays = document.querySelectorAll('.bs-overlay.active');
    if (activeBsOverlays.length > 0) {
        // 关闭最上层的底部面板（最后一个）
        const topOverlay = activeBsOverlays[activeBsOverlays.length - 1];
        topOverlay.click();
        return;
    }

    // 2. 检查是否有打开的编辑框
    const editOverlay = document.getElementById('editOverlay');
    const editContainer = document.querySelector('.message-edit-container');

    if (editOverlay && editOverlay.classList.contains('active')) {
        // 关闭编辑框
        editOverlay.classList.remove('active');
        if (editContainer) {
            editContainer.remove();
        }
        return;
    }

    // 3. 检查是否处于上下文选择模式或已选定上下文状态
    if (isContextSelectionMode || selectedContextMessages.length > 0) {
        exitContextSelectionMode();
        clearSelectedContext();
        return;
    }

    // 4. 检查是否有打开的弹窗（优先于侧边栏）
    const activeModals = document.querySelectorAll('.modal-overlay.active');

    if (activeModals.length > 0) {
        const topModal = activeModals[activeModals.length - 1];
        closeSpecificModal(topModal);
        return;
    }

    // 5. 检查是否有打开的下拉框和上拉菜单
    const dropdownsAndPopups = [
        { el: topicDrawer, close: () => closeTopicDrawer(), activeClass: 'active' },
        { el: null, close: () => closeChatMenuSheet(), activeClass: 'active' },
        { el: document.getElementById('searchModal'), close: () => closeSearchModal(), activeClass: 'visible' }
    ];

    for (const item of dropdownsAndPopups) {
        if (item.el && item.el.classList.contains(item.activeClass)) {
            item.close();
            return;
        }
    }

    // 6. 没有任何弹窗或菜单打开，处理双击退出
    const currentTime = Date.now();
    if (currentTime - backPressTime < 2000) {
        // 2秒内再次按返回键，退出应用
        if (backPressToast && backPressToast.parentNode) {
            backPressToast.parentNode.removeChild(backPressToast);
        }
        if (window.AndroidBridge && window.AndroidBridge.exitApp) {
            window.AndroidBridge.exitApp();
        } else if (navigator.app && navigator.app.exitApp) {
            navigator.app.exitApp();
        }
    } else {
        // 第一次按返回键，显示提示
        backPressTime = currentTime;
        showBackPressToast();
    }
}

// 显示"再按一次退出"提示
function showBackPressToast() {
    if (backPressToast && backPressToast.parentNode) {
        backPressToast.parentNode.removeChild(backPressToast);
    }

    backPressToast = document.createElement('div');
    backPressToast.className = 'back-press-toast';
    backPressToast.textContent = '再按一次退出应用';
    Object.assign(backPressToast.style, {
        position: 'fixed',
        bottom: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: '#fff',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '16px',
        zIndex: '99999',
        transition: 'opacity 0.3s',
        opacity: '1'
    });

    document.body.appendChild(backPressToast);

    // 2秒后自动隐藏
    setTimeout(() => {
        if (backPressToast) {
            backPressToast.style.opacity = '0';
            setTimeout(() => {
                if (backPressToast && backPressToast.parentNode) {
                    backPressToast.parentNode.removeChild(backPressToast);
                }
            }, 300);
        }
    }, 2000);
}

// 关闭指定的弹窗（带淡出动画）
function closeSpecificModal(modal) {
    if (!modal || !modal.classList.contains('active')) return;

    const modalId = modal.id;
    let callback = null;

    // 特定弹窗的额外清理逻辑
    switch (modalId) {
        case 'settingsModal':
            // 设置弹窗用返回键关闭时，调用 hideSettings() 来恢复设置
            hideSettings();
            return; // 直接返回，不执行后续的 closeModalWithFade
        case 'aiProviderSettingsModal':
        case 'chatSettingsModal':
        case 'topicNameSettingsModal':
        case 'knowledgeBaseSettingsModal':
        case 'generalSettingsModal':
        case 'themeSettingsModal':
        case 'advancedSettingsModal':
        case 'pcConnectionSettingsModal':
        case 'backupRestoreSettingsModal':
        case 'expertModeSettingsModal':
        case 'mcpSettingsModal':
            // 子设置弹窗用返回键关闭时，模拟点击返回按钮
            const backBtn = modal.querySelector('.sub-settings-back');
            if (backBtn) backBtn.click();
            return;
        case 'manageModelsModal':
            callback = () => { newModelInput.value = ''; };
            break;
        case 'batchDeleteTopicsModal':
            callback = () => {
                selectedTopicIdsForBatchDelete.clear();
                deletingAgentId = null;
            };
            break;
        case 'notebookEditModal':
            if (typeof window.closeNotebookEditModal === 'function') {
                window.closeNotebookEditModal();
            }
            return;
        case 'mcpEditModal':
            if (typeof window.closeMcpEditModal === 'function') {
                window.closeMcpEditModal();
            }
            return;
    }

    closeModalWithFade(modal, callback);
}

// 如果不在 Cordova 环境中，直接初始化
if (!window.cordova) {
    document.addEventListener('DOMContentLoaded', function () {
        initHeaderFix();
    });
    init();
}


/**
 * 键盘高度变化回调 - 由 Android 原生代码调用
 * @param {number} height - 键盘高度（CSS 像素），0 表示键盘收起
 */
// 记录键盘是否激活
let isKeyboardActive = false;
let _keyboardClosing = false;

window.onKeyboardHeightChange = function (height) {
    console.log('[Keyboard] 收到键盘高度:', height, 'CSS像素');

    const container = document.querySelector('.container');
    // 获取所有显示的弹窗（包括嵌套弹窗）
    const activeModals = document.querySelectorAll('.modal-overlay.active');
    // 获取所有显示的底部面板
    const activeBsPanels = document.querySelectorAll('.bs-panel.active');

    if (!container) {
        console.warn('[Keyboard] 未找到 .container 元素');
        return;
    }

    // 容器上移，使输入区域紧贴键盘顶部
    if (height > 0) {
        isKeyboardActive = true;
        // 检查当前聚焦的输入框是否会移出屏幕
        const focusedInput = document.activeElement;
        let shouldMove = true;
        if (focusedInput && (focusedInput.tagName === 'INPUT' || focusedInput.tagName === 'TEXTAREA')) {
            const inputRect = focusedInput.getBoundingClientRect();
            // 如果输入框顶部位置小于键盘高度，说明移动后输入框会移出屏幕顶部
            if (inputRect.top < height) {
                shouldMove = false;
                console.log('[Keyboard] 输入框会移出屏幕，不移动');
            }
        }

        if (shouldMove) {
            container.style.transform = `translateY(-${height}px)`;
            container.style.transition = 'transform 0.18s ease-out';

            activeModals.forEach(activeModal => {
                // 只移动 modal-body，header 不动
                const modalBody = activeModal.querySelector('.modal-body');
                if (modalBody) {
                    const modalShift = Math.max(0, height - 60);
                    modalBody.style.transform = `translateY(-${modalShift}px)`;
                    modalBody.style.transition = 'transform 0.18s ease-out';
                }
            });

            // 底部面板紧跟键盘上移
            activeBsPanels.forEach(panel => {
                panel.style.transform = `translateY(-${height}px)`;
                panel.style.transition = 'transform 0.18s ease-out';
            });
        }
    } else {
        isKeyboardActive = false;
        // 恢复位置
        container.style.transform = 'translateY(0)';
        container.style.transition = 'transform 0.18s ease-out';

        activeModals.forEach(activeModal => {
            const modalBody = activeModal.querySelector('.modal-body');
            if (modalBody) {
                modalBody.style.transform = 'translateY(0)';
                modalBody.style.transition = 'transform 0.18s ease-out';
            }
        });

        activeBsPanels.forEach(panel => {
            panel.style.transform = '';
            panel.style.transition = '';
        });
    }

    console.log('[Keyboard] 容器 transform:', container.style.transform);
};

// 点击状态定时器 ID
let clickFlagTimerId = null;

// 全局点击事件监听 - 使用捕获阶段，在事件冒泡之前触发
// 第三个参数 true 表示在捕获阶段触发，可以捕获所有点击事件，即使有 stopPropagation
document.addEventListener('click', function (event) {
    // 在下一次点击时，先将上次被禁用的元素恢复 hover 效果
    if (lastHoverDisabledElement) {
        lastHoverDisabledElement.classList.remove('hover-disabled');
        lastHoverDisabledElement = null;
    }

    // 点击时将状态标志置为 1
    clickFlag = 1;

    // 判断点击的是否为按钮或标签元素
    const target = event.target;
    const tagName = target.tagName.toLowerCase();
    const isButtonOrLabel = tagName === 'button' || tagName === 'label' || target.closest('button') || target.closest('label');

    if (isButtonOrLabel) {
        // 将点击的元素（按钮或 label）存入变量
        clickedElement = target.closest('button') || target.closest('label') || target;
    } else {
        clickedElement = null;
    }
    let btn_id = '';

    if (clickedElement && clickedElement.id) {
        btn_id = clickedElement.id;

        // 如果状态标志为 1，且不是深度思考、网络搜索、获取模型、获取key、管理模型的按钮时，触发定时器
        if (clickFlag === 1 &&
            //!["deepThinkingToggleBtn", "webSearchToggleBtn", "fetchModelsBtn",
            //"getApiKeyBtn", "addCustomModelBtn","globalSearchBtn","knowledgeUploadBtn","selectImageBtn","startCompressBtn"]
            ["nextAgentBtn", "prevAgentBtn", "scrollToBottomBtn", "scrollToTopBtn"].includes(btn_id)) {
            // 清除之前的定时器（如果有）
            if (clickFlagTimerId !== null) {
                clearTimeout(clickFlagTimerId);
            }

            // 100ms 后将状态标志置为 0，并禁用点击元素的 hover 效果
            clickFlagTimerId = setTimeout(function () {
                clickFlag = 0;
                // 禁用点击元素的 hover 效果
                if (clickedElement) {
                    clickedElement.classList.add('hover-disabled');
                    console.log("点击标签", clickedElement);
                    // 保存引用，用于下次点击时恢复
                    lastHoverDisabledElement = clickedElement;
                    clickedElement = null;
                }
            }, 100);
        }
    }
}, true);  // true 表示在捕获阶段触发
// ==================== 全局搜索功能 ====================

// 打开全局搜索弹窗
function openGlobalSearch(topicFilter) {
    _globalSearchTopicFilter = topicFilter || null;

    if (globalSearchSheet) { globalSearchSheet.show(); return; }

    const isTopicSearch = !!topicFilter;
    const title = isTopicSearch ? '搜索聊天记录' : '搜索所有对话';
    const placeholder = isTopicSearch ? '输入关键词搜索聊天记录...' : '输入关键词搜索...';
    const emptyText = isTopicSearch ? '输入关键词搜索当前话题的内容' : '输入关键词搜索所有对话内容';

    globalSearchSheet = createBottomSheetPanel({
        title: title,
        content: `
            <div class="global-search-input-wrapper">
                <input type="text" id="globalSearchInput" placeholder="${placeholder}" autocomplete="off">
                <svg id="globalSearchIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="cursor:pointer">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            </div>
            <div class="global-search-results" id="globalSearchResults">
                <div class="global-search-empty">${emptyText}</div>
            </div>
        `,
        onClose: () => {
            globalSearchSheet = null;
            _globalSearchTopicFilter = null;
        },
    });

    globalSearchSheet.show();

    // 绑定事件
    const input = document.getElementById('globalSearchInput');
    const searchIcon = document.getElementById('globalSearchIcon');

    if (input) {
        input.value = '';
        input.focus();
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performGlobalSearch();
        });
    }

    if (searchIcon) {
        searchIcon.addEventListener('click', performGlobalSearch);
    }
}

// 关闭全局搜索弹窗
function closeGlobalSearchModal() {
    if (globalSearchSheet) {
        globalSearchSheet.hide();
        globalSearchSheet = null;
    }
}

// 执行全局搜索
async function performGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const resultsEl = document.getElementById('globalSearchResults');
    if (!input || !resultsEl) return;

    const keyword = input.value.trim();
    if (!keyword) {
        resultsEl.innerHTML = '<div class="global-search-empty">请输入搜索关键词</div>';
        return;
    }

    const results = [];
    const lowerKeyword = keyword.toLowerCase();

    // 从 IndexedDB 批量读取所有消息，构建 key→messages 映射
    const idbMessagesMap = {};
    try {
        const allRecords = await getAllMessagesFromDB();
        allRecords.forEach(record => {
            if (record && record.key) {
                if (!idbMessagesMap[record.key]) idbMessagesMap[record.key] = [];
                if (Array.isArray(record.messages)) {
                    idbMessagesMap[record.key] = record.messages;
                }
            }
        });
    } catch (e) {
        console.error('读取 IndexedDB 消息失败:', e);
    }

    // 第一轮：搜索话题名称（优先显示）
    agents.forEach(agent => {
        const agentId = agent.id;
        const topics = agentTopics[agentId] || [];
        topics.forEach(topic => {
            const topicId = topic.id;
            if (_globalSearchTopicFilter && topicId !== _globalSearchTopicFilter) return;
            if (topic.name && topic.name.toLowerCase().includes(lowerKeyword)) {
                if (!results.some(r => r.agentId === agentId && r.topicId === topicId && r.role === 'topic_name')) {
                    results.push({
                        agentId,
                        agentName: agent.name,
                        agentIcon: agent.icon,
                        topicId,
                        topicName: topic.name,
                        messageIndex: -1,
                        messageId: null,
                        content: '话题: ' + topic.name,
                        role: 'topic_name',
                        timestamp: null
                    });
                }
            }
        });
    });

    // 第二轮：搜索消息内容
    agents.forEach(agent => {
        const agentId = agent.id;
        const topics = agentTopics[agentId] || [];

        // 遍历该智能体的所有话题
        topics.forEach(topic => {
            const topicId = topic.id;

            // 话题过滤：如果指定了话题ID，只搜该话题
            if (_globalSearchTopicFilter && topicId !== _globalSearchTopicFilter) return;

            const storageKeys = [
                'cnai_messages_' + agentId,
                'cnai_messages_' + agentId + '_topic_' + topicId
            ];

            storageKeys.forEach(storageKey => {
                // 优先从 IndexedDB 映射查找，fallback 到 localStorage
                let messages = idbMessagesMap[storageKey];
                if (!messages) {
                    const saved = localStorage.getItem(storageKey);
                    if (!saved) return;
                    try {
                        messages = JSON.parse(saved);
                    } catch (e) { return; }
                }

                if (!Array.isArray(messages)) return;

                // 遍历消息，搜索匹配的内容
                messages.forEach((msg, index) => {
                    let content = msg.content || '';
                    if (Array.isArray(content)) {
                        content = content.map(item => {
                            if (typeof item === 'string') return item;
                            if (item && item.type === 'text' && item.text) return item.text;
                            return '';
                        }).join(' ');
                    }
                    if (typeof content !== 'string') {
                        content = String(content);
                    }
                    if (content.toLowerCase().includes(lowerKeyword) && !results.some(r => r.agentId === agentId && r.topicId === topicId && r.content === content)) {
                        results.push({
                            agentId,
                            agentName: agent.name,
                            agentIcon: agent.icon,
                            topicId,
                            topicName: topic.name,
                            messageIndex: index,
                            messageId: msg.id || null,
                            content: content,
                            role: msg.role,
                            timestamp: msg.timestamp || null
                        });
                    }
                });
            });
        });
    });

    // 显示搜索结果
    renderSearchResults(results, keyword);
}

// 创建单条搜索结果元素
function createSearchResultItem(result, keyword) {
    const item = document.createElement('div');
    item.className = 'global-search-result-item';

    const content = result.content;
    const lowerContent = content.toLowerCase();
    const keywordIndex = lowerContent.indexOf(keyword.toLowerCase());

    let displayContent = content;
    if (keywordIndex !== -1) {
        const contextLength = 100;
        const start = Math.max(0, keywordIndex - contextLength);
        const end = Math.min(content.length, keywordIndex + keyword.length + contextLength);
        displayContent = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
    }

    const highlightedContent = displayContent.replace(
        new RegExp('(' + escapeRegExp(keyword) + ')', 'gi'),
        '<span class="highlight">$1</span>'
    );

    const whiteIconClass = isWhiteIcon(result.agentIcon) ? ' white-icon' : '';
    const iconHtml = result.agentIcon && (result.agentIcon.includes('/') || result.agentIcon.endsWith('.png') || result.agentIcon.endsWith('.jpg') || result.agentIcon.endsWith('.svg'))
        ? '<img class="topic-drawer-agent-icon' + whiteIconClass + '" src="' + result.agentIcon + '" alt="' + result.agentName + '" style="width:16px;height:16px;margin-right:4px;">'
        : '';

    const timeStr = result.timestamp ? formatTimestamp(new Date(result.timestamp)) : '';

    item.innerHTML =
        '<div class="global-search-result-header">' +
        '<span class="global-search-result-agent">' + iconHtml + result.agentName + '</span>' +
        '<span class="global-search-result-topic">' + result.topicName + '</span>' +
        (timeStr ? '<span class="global-search-result-topic">' + timeStr + '</span>' : '') +
        '</div>' +
        '<div class="global-search-result-content">' + highlightedContent + '</div>';

    item.addEventListener('click', () => {
        jumpToMessage(result);
    });

    return item;
}

// 渲染搜索结果
function renderSearchResults(results, keyword) {
    const resultsEl = document.getElementById('globalSearchResults');
    if (!resultsEl) return;

    if (results.length === 0) {
        resultsEl.innerHTML = '<div class="global-search-empty">未找到匹配的对话内容</div>';
        return;
    }

    resultsEl.innerHTML = '';

    // 分组：话题名称全部显示，消息内容限制50条
    const topicResults = results.filter(r => r.role === 'topic_name');
    const msgResults = results.filter(r => r.role !== 'topic_name')
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 50);

    // 渲染话题名称结果
    topicResults.forEach(result => {
        resultsEl.appendChild(createSearchResultItem(result, keyword));
    });

    // 两组之间加分隔线
    if (topicResults.length > 0 && msgResults.length > 0) {
        const divider = document.createElement('div');
        divider.style.cssText = 'padding:0 16px;border-bottom:1px solid var(--border-color);margin:4px 0;height:0;';
        resultsEl.appendChild(divider);
    }

    // 渲染消息内容结果
    msgResults.forEach(result => {
        resultsEl.appendChild(createSearchResultItem(result, keyword));
    });

    if (msgResults.length < results.filter(r => r.role !== 'topic_name').length) {
        const moreInfo = document.createElement('div');
        moreInfo.className = 'global-search-empty';
        const totalMsg = results.filter(r => r.role !== 'topic_name').length;
        moreInfo.textContent = '仅显示前50条消息结果，共找到 ' + totalMsg + ' 条';
        resultsEl.appendChild(moreInfo);
    }
}

// 跳转到指定消息
function jumpToMessage(result) {
    // 关闭搜索弹窗
    closeGlobalSearchModal();
    // 关闭话题抽屉（搜索从侧边栏打开）
    closeTopicDrawer();

    // 检查是否需要切换智能体或话题
    const needSwitch = currentAgentId !== result.agentId || currentTopicId !== result.topicId;

    if (needSwitch) {
        // 使用 switchAgentAndTopic 函数切换，会显示加载动画
        // skipScrollToBottom: 跳过自动滚动到底部，后续会定位到目标消息
        // scrollToMessageByResult 放在 onComplete 中，确保消息渲染完成后再定位
        switchAgentAndTopic(result.agentId, result.topicId, null, () => {
            scrollToMessageByResult(result);
        }, { skipScrollToBottom: true });
    } else {
        // 不需要切换，直接滚动到消息
        scrollToMessageByResult(result);
    }
}

// 滚动到指定消息并高亮（全局搜索用）
function scrollToMessageByResult(result) {
    setTimeout(() => {
        // 优先通过 ID 定位 DOM 元素
        let targetEl = null;
        if (result.messageId) {
            targetEl = findMessageDivById(result.messageId);
        }
        
        // 回退到索引定位
        if (!targetEl) {
            const messageElements = chatContainer.querySelectorAll('.message');
            let targetIndex = result.messageIndex;
            let domIndex = 0;
            for (let i = 0; i < targetIndex; i++) {
                if (messages[i] && messages[i].role === 'user') {
                    domIndex++;
                } else if (messages[i] && messages[i].role === 'assistant') {
                    domIndex++;
                }
            }
            targetEl = messageElements[domIndex];
        }

        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.style.transition = 'background-color 0.3s';
            targetEl.style.backgroundColor = 'rgba(201, 162, 39, 0.2)';
            setTimeout(() => {
                targetEl.style.backgroundColor = '';
            }, 2000);
        }
    }, 100);
}

// 初始化全局搜索事件监听（已迁移到 openGlobalSearch 中）
function initGlobalSearch() {
    // 事件绑定已在 openGlobalSearch 中完成
}

// 在页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    initGlobalSearch();
    initKnowledgeBase();
    initContextSelection(); // 初始化上下文选择功能

    // 确保容器布局正确，清除可能残留的 transform（防止底部空白）
    setTimeout(() => {
        const container = document.querySelector('.container');
        if (container) {
            container.style.transform = 'none';
            container.style.transition = 'none';
            console.log('页面加载完成，已重置容器 transform');
        }
    }, 300);
});

// ==================== 知识库管理功能 ====================

// 打开知识库管理弹窗
// 内置使用手册文档ID（固定ID，避免重复注入）
const BUILTIN_MANUAL_DOC_ID = 'doc_builtin_manual';

// 注入内置使用手册到知识库（仅首次）
async function ensureBuiltinManual() {
    if (localStorage.getItem('builtin_manual_loaded')) return;
    console.log('[知识库] 非首次打开，不注入内置使用手册');
    try {
        await loadScript('builtin-manual.js');
        const content = window.BUILTIN_MANUAL_CONTENT;
        if (!content) return;

        console.log('[知识库] 首次打开，注入内置使用手册');
        const db = await initKnowledgeDB();
        const doc = {
            id: BUILTIN_MANUAL_DOC_ID,
            name: '小蓝AI盒子使用手册.md',
            content: content,
            chunks: chunkText(content),
            size: content.length,
            createdAt: Date.now(),
            hasEmbeddings: false
        };
        await saveDocumentToKnowledgeBase(doc);
        localStorage.setItem('builtin_manual_loaded', '1');
    } catch (e) {
        console.warn('[知识库] 注入使用手册失败:', e);
    }
}

async function openKnowledgeBaseModal() {
    if (!knowledgeBaseModal) return;
    await ensureKnowledgeBase();
    await ensureBuiltinManual();
    openModalWithFade(knowledgeBaseModal);
    await renderKnowledgeBaseList();
}

// 关闭知识库管理弹窗
function closeKnowledgeBaseModal() {
    closeModalWithFade(knowledgeBaseModal);
}

// 渲染知识库文档列表
async function renderKnowledgeBaseList() {
    if (!knowledgeAgentList) return;

    const documents = await getAllKnowledgeDocuments();

    // 清除旧的 item 和空状态
    knowledgeAgentList.querySelectorAll('.knowledge-base-item, .knowledge-base-empty').forEach(el => el.remove());

    if (documents.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'knowledge-base-empty';
        emptyDiv.textContent = '暂无文档，请上传文档到知识库';
        knowledgeAgentList.appendChild(emptyDiv);
        return;
    }

    const html = documents.map(doc => {
        const iconClass = getDocumentIconClass(doc.name);
        const formattedSize = formatFileSize(doc.size);
        const formattedDate = new Date(doc.createdAt).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        // 向量状态指示
        const hasEmbeddings = doc.hasEmbeddings || (doc.chunks && doc.chunks.some(c => c.embedding));
        const vectorBadge = hasEmbeddings
            ? '<span class="vector-badge has-vector" title="已生成向量，支持语义检索">向量</span>'
            : '<span class="vector-badge no-vector" title="未生成向量，仅关键词检索">无向量</span>';

        return `
            <div class="knowledge-base-item" data-id="${doc.id}">
                <div class="knowledge-base-item-icon ${iconClass}">
                    ${getDocumentIcon(doc.name)}
                </div>
                <div class="knowledge-base-item-info">
                    <div class="knowledge-base-item-name" title="${doc.name}">${doc.name}</div>
                    <div class="knowledge-base-item-meta">${formattedSize} · ${formattedDate} ${vectorBadge}</div>
                </div>
                <div class="knowledge-base-item-actions">
                    <button class="knowledge-more-btn" data-id="${doc.id}" title="更多操作">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2"></circle>
                            <circle cx="12" cy="12" r="2"></circle>
                            <circle cx="12" cy="19" r="2"></circle>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // 创建临时容器解析 HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    while (tempDiv.firstChild) {
        knowledgeAgentList.appendChild(tempDiv.firstChild);
    }

    // 绑定三点菜单事件
    knowledgeAgentList.querySelectorAll('.knowledge-more-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const docId = btn.dataset.id;
            const doc = documents.find(d => d.id === docId);
            if (!doc) return;

            createBottomSheetPicker({
                items: [
                    { value: 'preview', label: '预览' },
                    { value: 'vector', label: '生成向量' },
                    'divider',
                    { value: 'delete', label: '删除', className: 'bs-item-danger' },
                ],
                onSelect: async (item) => {
                    if (item.value === 'preview') {
                        showFileViewer(doc.name, doc.content);
                    } else if (item.value === 'vector') {
                        await handleRegenerateEmbeddings([docId]);
                    } else if (item.value === 'delete') {
                        if (!confirm(`确定要删除「${doc.name}」吗？此操作不可恢复。`)) return;
                        await deleteDocumentFromKnowledgeBase(docId);
                        await renderKnowledgeBaseList();
                        showToast('已删除文档');
                    }
                },
            }).show();
        });
    });

}

// 获取文档图标类名
function getDocumentIconClass(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        'pdf': 'pdf',
        'doc': 'docx',
        'docx': 'docx',
        'txt': 'txt',
        'md': 'md',
        'json': 'json',
        'csv': 'csv'
    };
    return iconMap[ext] || 'txt';
}

// 获取文档图标 SVG
function getDocumentIcon(fileName) {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
    </svg>`;
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 处理文件上传
async function handleKnowledgeUpload(files) {
    if (!files || files.length === 0) return;

    let successCount = 0;
    let errorCount = 0;
    const uploadedDocIds = []; // 记录成功上传的文档ID

    // 显示处理中的提示
    showToast('正在处理文档，请稍候...');

    for (const file of files) {
        try {
            const content = await readFileContent(file);
            if (!content || content.trim().length === 0) {
                errorCount++;
                continue;
            }

            await ensureKnowledgeBase();
            const chunks = chunkText(content);
            if (chunks.length === 0) {
                errorCount++;
                continue;
            }

            const doc = {
                id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                name: file.name,
                content: content,
                chunks: chunks,
                size: file.size,
                createdAt: Date.now(),
                hasEmbeddings: false
            };

            await saveDocumentToKnowledgeBase(doc);
            uploadedDocIds.push(doc.id); // 记录上传成功的文档ID
            successCount++;
        } catch (error) {
            console.error('处理文件失败:', file.name, error);
            errorCount++;
        }
    }

    await renderKnowledgeBaseList();

    if (successCount > 0) {
        showToast(`成功上传 ${successCount} 个文档`);
    }
    if (errorCount > 0) {
        showToast(`${errorCount} 个文档上传失败`);
    }

    // 上传成功后，延迟执行向量化（避免阻塞 UI）
    if (uploadedDocIds.length > 0) {
        // 延迟 500ms 后执行向量化，让 UI 有时间更新
        setTimeout(async () => {
            try {
                await handleRegenerateEmbeddings(uploadedDocIds);
            } catch (error) {
                console.warn('自动向量化失败:', error.message);
            }
        }, 500);
    }
}

// 读取文件内容
async function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const ext = file.name.split('.').pop().toLowerCase();

        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                let content = '';

                if (ext === 'pdf') {
                    content = await extractTextFromPDF(arrayBuffer);
                } else if (ext === 'docx' || ext === 'doc') {
                    content = await extractTextFromWord(arrayBuffer);
                } else {
                    // 文本文件直接读取
                    content = new TextDecoder().decode(arrayBuffer);
                }

                resolve(content);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

// 删除选中的文档
async function handleClearKnowledgeBase() {
    // 获取被复选框选中的文档
    const checkboxes = knowledgeAgentList.querySelectorAll('.knowledge-doc-checkbox:checked');
    const docIds = Array.from(checkboxes).map(cb => cb.dataset.id);

    if (docIds.length === 0) {
        showToast('请先勾选要删除的文档');
        return;
    }

    if (!confirm(`确定要删除选中的 ${docIds.length} 个文档吗？此操作不可恢复。`)) return;

    // 删除选中的文档
    for (const docId of docIds) {
        await deleteDocumentFromKnowledgeBase(docId);
    }
    await renderKnowledgeBaseList();
    showToast(`已删除 ${docIds.length} 个文档`);
}

// 为选中的文档生成向量（支持传入指定文档ID数组）
async function handleRegenerateEmbeddings(selectedDocIds = null) {
    // 如果没有传入文档ID，则从复选框获取选中的文档
    let docIds = selectedDocIds;
    if (!docIds) {
        const checkboxes = knowledgeAgentList.querySelectorAll('.knowledge-doc-checkbox:checked');
        docIds = Array.from(checkboxes).map(cb => cb.dataset.id);
    }

    if (docIds.length === 0) {
        showToast('请先勾选要生成向量的文档');
        return;
    }

    // 获取所有文档，筛选出选中的文档
    const allDocuments = await getAllKnowledgeDocuments();
    const documents = allDocuments.filter(doc => docIds.includes(doc.id));

    if (documents.length === 0) {
        showToast('未找到选中的文档');
        return;
    }

    // 检查向量检索是否可用
    showToast('正在加载向量模型...');

    await ensureKnowledgeBase();
    const modelAvailable = await checkVectorSearchAvailable();
    if (!modelAvailable) {
        const reason = getVectorSearchUnavailableReason();
        showToast(reason || '向量模型不可用');
        return;
    }

    // 禁用按钮，防止重复点击
    if (regenerateEmbeddingsBtn) {
        regenerateEmbeddingsBtn.disabled = true;
    }

    // 创建进度提示
    const progressOverlay = document.createElement('div');
    progressOverlay.className = 'vector-progress-overlay';
    progressOverlay.innerHTML = `
        <div class="vector-progress-modal">
            <div class="vector-progress-title">正在生成向量</div>
            <div class="vector-progress-info">文档: <span id="vectorProgressDoc">0</span>/${documents.length}</div>
            <div class="vector-progress-bar-container">
                <div class="vector-progress-bar" id="vectorProgressBar"></div>
            </div>
            <div class="vector-progress-detail" id="vectorProgressDetail">准备中...</div>
        </div>
    `;
    document.body.appendChild(progressOverlay);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];

        // 更新进度
        document.getElementById('vectorProgressDoc').textContent = i + 1;
        document.getElementById('vectorProgressDetail').textContent = `正在处理: ${doc.name}`;

        try {
            if (!doc.chunks || doc.chunks.length === 0) {
                // 如果没有分块，重新分块
                const chunks = chunkText(doc.content);
                if (chunks.length === 0) {
                    errorCount++;
                    continue;
                }
                doc.chunks = chunks;
            }

            // 生成向量
            await ensureKnowledgeBase();
            doc.chunks = await generateChunkEmbeddings(doc.chunks, (current, total) => {
                const percent = Math.round((current / total) * 100);
                document.getElementById('vectorProgressBar').style.width = `${percent}%`;
                document.getElementById('vectorProgressDetail').textContent = `${doc.name}: ${current}/${total} 块`;
            });

            doc.hasEmbeddings = doc.chunks.some(c => c.embedding);

            // 保存更新后的文档
            await saveDocumentToKnowledgeBase(doc);
            successCount++;
        } catch (error) {
            console.warn('生成向量失败:', doc.name, error.message || error);
            errorCount++;
        }
    }

    // 移除进度提示
    document.body.removeChild(progressOverlay);

    // 恢复按钮
    if (regenerateEmbeddingsBtn) {
        regenerateEmbeddingsBtn.disabled = false;
    }

    await renderKnowledgeBaseList();

    if (successCount > 0) {
        showToast(`成功为 ${successCount} 个文档生成向量`);
    }
    if (errorCount > 0) {
        showToast(`${errorCount} 个文档生成向量失败`);
    }
}

// 初始化知识库事件监听
function initKnowledgeBase() {
    // 管理按钮
    if (manageKnowledgeBaseBtn) {
        manageKnowledgeBaseBtn.addEventListener('click', openKnowledgeBaseModal);
    }

    // 关闭按钮
    if (closeKnowledgeBase) {
        closeKnowledgeBase.addEventListener('click', closeKnowledgeBaseModal);
    }
    if (closeKnowledgeBaseBtn) {
        closeKnowledgeBaseBtn.addEventListener('click', closeKnowledgeBaseModal);
    }

    // 点击遮罩层关闭
    if (knowledgeBaseModal) {
        knowledgeBaseModal.addEventListener('click', (e) => {
            if (e.target === knowledgeBaseModal) {
                closeKnowledgeBaseModal();
            }
        });
    }

    // 文件上传
    if (knowledgeUploadInput) {
        knowledgeUploadInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                await handleKnowledgeUpload(files);
            }
            e.target.value = ''; // 清空，允许重复上传同一文件
        });
    }

    // 知识库上传按钮
    if (knowledgeUploadBtn) {
        knowledgeUploadBtn.addEventListener('click', (e) => {
            // 检查是否在 Android WebView 中，使用原生文件选择器
            if (window.AndroidBridge && typeof AndroidBridge.openKnowledgeFileChooser === 'function') {
                AndroidBridge.openKnowledgeFileChooser();
            } else {
                // Web 环境手动触发 file input
                knowledgeUploadInput.click();
            }
        });
    }

    // 清空按钮（已移除，保留引用兼容）

    // 向量检索开关
    if (vectorSearchSwitch) {
        // 初始化开关状态
        vectorSearchSwitch.checked = vectorSearchEnabled;

        vectorSearchSwitch.addEventListener('change', async (e) => {
            const newValue = e.target.checked;

            if (newValue) {
                // 开启向量检索时，检查是否有带向量的文档
                const documents = await getAllKnowledgeDocuments();
                const hasAnyEmbeddings = documents.some(doc =>
                    doc.hasEmbeddings || (doc.chunks && doc.chunks.some(c => c.embedding))
                );

                if (!hasAnyEmbeddings) {
                    showToast('已启用向量检索，请勾选文档后点击"生成向量"按钮');
                } else {
                    showToast('已启用向量检索');
                }
            } else {
                showToast('已关闭向量检索，使用关键词检索');
            }

            vectorSearchEnabled = newValue;
            localStorage.setItem('cnai_vector_search_enabled', vectorSearchEnabled);
        });
    }

    // 全选复选框（已移除）
    // 生成向量按钮（已移至三点菜单）
}

// ==================== 首次用户引导页逻辑 ====================
let currentStep = 1;
let userAnswers = {
    step1: null,
    step2: null,
    step3: null
};

const ONBOARDING_COMPLETED_KEY = 'cnai_onboarding_completed';
const ONBOARDING_ANSWERS_KEY = 'cnai_onboarding_answers';

// 初始化引导页
function initOnboarding() {
    // 检查是否已完成引导
    const hasCompleted = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
    if (hasCompleted === 'true') {
        // 已完成引导，直接初始化广告SDK
        initializeAdSdk();
        return;
    }

    // 不需要隐藏状态栏
    // if (window.AndroidBridge && window.AndroidBridge.hideStatusBar) {
    //     window.AndroidBridge.hideStatusBar();
    // }

    // 显示引导页（直接覆盖在应用内容上）
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) {
        setTimeout(() => {
            overlay.classList.add('active');
        }, 500); // 延迟显示，等开屏动画完成
        setTimeout(() => {
            //引导页加载完成后移除动画
            window.onSplashAdCheckComplete(false);
        }, 1000);
    }

    // 初始化事件监听
    initOnboardingEvents();
}

// 初始化引导页事件
function initOnboardingEvents() {
    // 答案按钮
    document.querySelectorAll('.answer-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handleAnswerSelect(btn);
        });
    });

    // 协议链接点击事件
    document.querySelectorAll('.agreement-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = link.dataset.url;
            const title = link.dataset.title;
            if (window.AndroidBridge && window.AndroidBridge.openAgreementActivity) {
                window.AndroidBridge.openAgreementActivity(url, title);
            } else {
                window.open(url, '_blank');
            }
        });
    });

    // 协议复选框变化时，如果步骤1已选答案且勾选了，自动进入步骤2
    const agreementCheckbox = document.getElementById('agreementCheckbox');
    if (agreementCheckbox) {
        agreementCheckbox.addEventListener('change', () => {
            if (agreementCheckbox.checked && currentStep === 1 && userAnswers.step1) {
                goToStep(2);
            }
        });
    }

    // 上一步/下一步按钮
    const prevBtn = document.getElementById('prevStep');
    const nextBtn = document.getElementById('nextStep');
    const finishBtn = document.getElementById('onboardingFinish');

    if (prevBtn) {
        prevBtn.addEventListener('click', goToPrevStep);
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', goToNextStep);
    }
    if (finishBtn) {
        finishBtn.addEventListener('click', finishOnboarding);
    }

    // 进度点点击
    document.querySelectorAll('.progress-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            const step = parseInt(dot.dataset.step);
            // 只能跳转到已完成或当前步骤
            if (step <= currentStep && userAnswers[`step${step}`]) {
                goToStep(step);
            }
        });
    });

    // 左右滑动切换步骤
    let touchStartX = 0;
    let touchStartY = 0;
    const onboardingContainer = document.querySelector('.onboarding-container');
    if (onboardingContainer) {
        onboardingContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        onboardingContainer.addEventListener('touchend', (e) => {
            const deltaX = e.changedTouches[0].clientX - touchStartX;
            const deltaY = e.changedTouches[0].clientY - touchStartY;

            // 水平滑动超过50px且大于垂直滑动（避免误触滚动）
            if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
                if (deltaX < 0) {
                    // 左滑 → 下一步
                    if (currentStep === 3) {
                        if (userAnswers.step3) finishOnboarding();
                    } else if (currentStep === 1) {
                        const checkbox = document.getElementById('agreementCheckbox');
                        if (userAnswers.step1 && checkbox && checkbox.checked) {
                            goToStep(2);
                        } else if (userAnswers.step1) {
                            showToast('请先阅读并同意《用户服务协议》和《隐私政策》');
                        }
                    } else if (userAnswers[`step${currentStep}`]) {
                        goToStep(currentStep + 1);
                    }
                } else {
                    // 右滑 → 上一步
                    if (currentStep > 1) {
                        goToStep(currentStep - 1);
                    }
                }
            }
        }, { passive: true });
    }
}

// 处理答案选择
function handleAnswerSelect(btn) {
    const stepEl = btn.closest('.onboarding-step');
    const step = parseInt(stepEl.dataset.step);

    // 如果重复点击已选中的按钮
    if (btn.classList.contains('selected')) {
        if (step === 1) {
            showToast('请先阅读并同意《用户服务协议》和《隐私政策》');
        }
        return;
    }

    // 清除同步骤其他按钮的选中状态
    stepEl.querySelectorAll('.answer-btn').forEach(b => b.classList.remove('selected'));
    // 选中当前按钮
    btn.classList.add('selected');
    // 保存答案
    userAnswers[`step${step}`] = btn.dataset.value;
    // 更新导航按钮
    updateNavButtons();

    // 自动推进到下一步
    if (step === 1) {
        // 步骤1：需要同时勾选协议才能自动推进
        const checkbox = document.getElementById('agreementCheckbox');
        if (checkbox && checkbox.checked) {
            goToStep(2);
        }
    } else if (step === 2) {
        // 步骤2：直接进入步骤3
        goToStep(3);
    }
    // 步骤3不自动完成，用户需手动点击「开始使用」
}

// 更新导航按钮状态
function updateNavButtons() {
    const prevBtn = document.getElementById('prevStep');
    const nextBtn = document.getElementById('nextStep');

    if (prevBtn) {
        prevBtn.style.visibility = currentStep > 1 ? 'visible' : 'hidden';
    }
    if (nextBtn) {
        const hasAnswer = userAnswers[`step${currentStep}`] !== null;
        const isLastStep = currentStep >= 3;
        nextBtn.style.visibility = (hasAnswer && !isLastStep) ? 'visible' : 'hidden';
    }
}

// 跳转到指定步骤
function goToStep(step) {
    if (step < 1 || step > 3) return;
    currentStep = step;

    // 更新步骤显示
    document.querySelectorAll('.onboarding-step').forEach(s => {
        s.classList.remove('active');
        if (parseInt(s.dataset.step) === step) {
            s.classList.add('active');
        }
    });

    // 更新进度点
    document.querySelectorAll('.progress-dot').forEach(dot => {
        const dotStep = parseInt(dot.dataset.step);
        dot.classList.remove('active', 'completed');
        if (dotStep < step) {
            dot.classList.add('completed');
        } else if (dotStep === step) {
            dot.classList.add('active');
        }
    });

    // 更新进度条
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
        const progress = ((step - 1) / 2) * 100;
        progressFill.style.width = `${progress}%`;
    }

    // 更新导航按钮
    updateNavButtons();
}

// 上一步
function goToPrevStep() {
    if (currentStep > 1) {
        goToStep(currentStep - 1);
    }
}

// 下一步
function goToNextStep() {
    // 第一步需要先勾选协议
    if (currentStep === 1) {
        const checkbox = document.getElementById('agreementCheckbox');
        if (!checkbox || !checkbox.checked) {
            showToast('请先阅读并同意《用户服务协议》和《隐私政策》');
            return;
        }
    }

    if (currentStep < 3 && userAnswers[`step${currentStep}`]) {
        goToStep(currentStep + 1);
    }
}

// 完成引导
function finishOnboarding() {
    // 保存最后一步答案
    if (!userAnswers.step3) {
        showToast('请选择一个选项');
        return;
    }

    // 计算分数
    let score = 0;
    // 问题1：使用过 +2分
    if (userAnswers.step1 === 'yes') {
        score += 2;
    }
    // 问题2：非常了解+5分，了解一些+2分
    if (userAnswers.step2 === 'yes') {
        score += 5;
    } else if (userAnswers.step2 === 'some') {
        score += 2;
    }
    // 问题3：已有API KEY +5分
    if (userAnswers.step3 === 'yes') {
        score += 5;
    }

    // 保存完成状态、用户答案和分数
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    localStorage.setItem(ONBOARDING_ANSWERS_KEY, JSON.stringify(userAnswers));
    localStorage.setItem('cnai_onboarding_score', score);

    // 通知原生端用户已同意隐私政策
    if (window.AndroidBridge && window.AndroidBridge.setPrivacyAgreed) {
        window.AndroidBridge.setPrivacyAgreed();
    }

    // 隐藏引导页
    const onboardingOverlay = document.getElementById('onboardingOverlay');
    if (onboardingOverlay) {
        onboardingOverlay.classList.remove('active');
        setTimeout(() => {
            onboardingOverlay.style.display = 'none';
            // 显示欢迎页面
            showWelcomePage(score);
        }, 500);
    }
}

// 抖音二维码弹窗
function showDouyinQR() {
    const overlay = document.getElementById('douyinQrOverlay');
    if (overlay) overlay.classList.add('active');
}

function hideDouyinQR() {
    const overlay = document.getElementById('douyinQrOverlay');
    if (overlay) overlay.classList.remove('active');
}

function showQqQR() {
    const overlay = document.getElementById('qqQrOverlay');
    if (overlay) overlay.classList.add('active');
}

function hideQqQR() {
    const overlay = document.getElementById('qqQrOverlay');
    if (overlay) overlay.classList.remove('active');
}

// 显示欢迎页面
function showWelcomePage(score) {
    const welcomeOverlay = document.getElementById('welcomeOverlay');
    const xiaohongshuSection = document.getElementById('xiaohongshuSection');
    const tutorialSection = document.getElementById('tutorialSection');
    const simpleWelcome = document.getElementById('simpleWelcome');
    const welcomeStartBtn = document.getElementById('welcomeStartBtn');

    if (!welcomeOverlay) return;

    // 先隐藏所有区域
    if (xiaohongshuSection) xiaohongshuSection.style.display = 'none';
    if (tutorialSection) tutorialSection.style.display = 'none';
    if (simpleWelcome) simpleWelcome.style.display = 'none';

    // 根据分数显示对应内容
    if (score >= 9) {
        // >=9分：简单欢迎
        if (simpleWelcome) simpleWelcome.style.display = 'block';
    } else if (score >= 4) {
        // >=4分：只显示基础教程
        if (tutorialSection) tutorialSection.style.display = 'block';
    } else {
        // <4分：显示小红书和基础教程
        if (xiaohongshuSection) xiaohongshuSection.style.display = 'block';
        if (tutorialSection) tutorialSection.style.display = 'block';
    }

    // 开始使用按钮事件
    if (welcomeStartBtn) {
        welcomeStartBtn.onclick = () => {
            welcomeOverlay.classList.remove('active');
            setTimeout(() => {
                welcomeOverlay.style.display = 'none';
                // 刷新侧边栏话题列表
                renderAllAgentTopics();
                // 状态栏永远不隐藏，不需要恢复
                // 初始化广告SDK
                initializeAdSdk();
            }, 500);
        };
    }

    // 显示欢迎页面
    welcomeOverlay.classList.add('active');
}


// 页面加载完成后初始化引导页
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，等其他模块初始化完成
    setTimeout(() => {
        initOnboarding();
    }, 100);
});

setTimeout(() => {
    if (!isMobileMode) {
        window.onSplashAdCheckComplete(false);
    }
}, 1500);


// ==================== 连接电脑 + 文件传输模块 ====================
const pcConnection = {
    ws: null,
    connected: false,
    authenticated: false,
    serverIP: '',
    deviceToken: null,
    reconnectTimer: null,
    reconnectDelay: 1000,
    maxReconnectDelay: 30000,

    async connect(ip) {
        this.serverIP = ip;
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket('ws://' + ip + ':9876');
                this.ws.binaryType = 'arraybuffer';

                // 5秒连接超时
                const timeout = setTimeout(() => {
                    if (!this.connected) {
                        this.ws.onopen = null;
                        this.ws.onerror = null;
                        this.ws.onclose = null;
                        try { this.ws.close(); } catch {}
                        this.ws = null;
                        reject(new Error('连接超时'));
                    }
                }, 5000);

                this.ws.onopen = () => {
                    clearTimeout(timeout);
                    this.connected = true;
                    this.reconnectDelay = 1000;
                    resolve(true);
                };
                this.ws.onerror = (e) => {
                    clearTimeout(timeout);
                    reject(e);
                };
                this.ws.onmessage = (e) => {
                    if (typeof e.data === 'string') {
                        this._handleMessage(JSON.parse(e.data));
                    } else if (e.data instanceof ArrayBuffer) {
                        this._handleBinaryChunk(e.data);
                    }
                };
                this.ws.onclose = () => {
                    clearTimeout(timeout);
                    this.connected = false;
                    this.authenticated = false;
                    this._scheduleReconnect();
                };
            } catch (e) {
                reject(e);
            }
        });
    },

    // ==================== 公网连接（IPv6直连） ====================
    cloudServerUrl: 'https://www.xiaolanbox.com',
    cloudToken: null,
    cloudUsername: null,

    async cloudLogin(username, password) {
        try {
            const resp = await fetch(this.cloudServerUrl + '/api/relay/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await resp.json();
            if (data.success && data.token) {
                this.cloudToken = data.token;
                this.cloudUsername = data.username;
                // 保存到本地
                if (window.AndroidBridge && typeof AndroidBridge.setCloudAuth === 'function') {
                    AndroidBridge.setCloudAuth(JSON.stringify({ username: data.username, token: data.token }));
                }
                return { success: true, username: data.username };
            }
            return data;
        } catch (e) {
            return { error: '连接云服务器失败: ' + e.message };
        }
    },

    async cloudRegister(username, password) {
        try {
            const resp = await fetch(this.cloudServerUrl + '/api/relay/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await resp.json();
            if (data.success && data.token) {
                this.cloudToken = data.token;
                this.cloudUsername = data.username;
                if (window.AndroidBridge && typeof AndroidBridge.setCloudAuth === 'function') {
                    AndroidBridge.setCloudAuth(JSON.stringify({ username: data.username, token: data.token }));
                }
                return { success: true, username: data.username };
            }
            return data;
        } catch (e) {
            return { error: '连接云服务器失败: ' + e.message };
        }
    },

    cloudLogout() {
        this.cloudToken = null;
        this.cloudUsername = null;
        if (window.AndroidBridge && typeof AndroidBridge.setCloudAuth === 'function') {
            AndroidBridge.setCloudAuth('');
        }
    },

    async cloudResolvePC() {
        if (!this.cloudToken) return { online: false, message: '未登录' };
        try {
            const resp = await fetch(this.cloudServerUrl + '/api/relay/pc/resolve', {
                headers: { 'Authorization': 'Bearer ' + this.cloudToken },
            });
            return await resp.json();
        } catch (e) {
            return { online: false, message: '查询失败: ' + e.message };
        }
    },

    async connectViaCloud() {
        // 1. 查询PC的IPv6地址
        const info = await this.cloudResolvePC();
        if (!info.online) {
            return { success: false, error: info.message || '电脑未开机或未登录' };
        }

        // 2. 逐个尝试IPv6地址
        const ipv6List = Array.isArray(info.ipv6) ? info.ipv6 : [info.ipv6];
        const port = info.port || 9876;
        let lastError = '';

        for (const ipv6 of ipv6List) {
            this.serverIP = ipv6;
            const wsUrl = 'ws://[' + ipv6 + ']:' + port;
            try {
                await this.connectDirect(wsUrl);
                return { success: true };
            } catch (e) {
                lastError = e.message;
            }
        }
        return { success: false, error: '所有IPv6地址均连接失败: ' + lastError };
    },

    async connectDirect(wsUrl) {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(wsUrl);
                this.ws.binaryType = 'arraybuffer';

                const timeout = setTimeout(() => {
                    if (!this.connected) {
                        this.ws.onopen = null;
                        this.ws.onerror = null;
                        this.ws.onclose = null;
                        try { this.ws.close(); } catch {}
                        this.ws = null;
                        reject(new Error('连接超时'));
                    }
                }, 10000); // 公网连接给10秒超时

                this.ws.onopen = () => {
                    clearTimeout(timeout);
                    this.connected = true;
                    this.reconnectDelay = 1000;
                    resolve(true);
                };
                this.ws.onerror = (e) => {
                    clearTimeout(timeout);
                    reject(e);
                };
                this.ws.onmessage = (e) => {
                    if (typeof e.data === 'string') {
                        this._handleMessage(JSON.parse(e.data));
                    } else if (e.data instanceof ArrayBuffer) {
                        this._handleBinaryChunk(e.data);
                    }
                };
                this.ws.onclose = () => {
                    clearTimeout(timeout);
                    this.connected = false;
                    this.authenticated = false;
                    this._scheduleReconnect();
                };
            } catch (e) {
                reject(e);
            }
        });
    },

    // 恢复云信令登录
    restoreCloudAuth() {
        if (window.AndroidBridge && typeof AndroidBridge.getCloudAuth === 'function') {
            try {
                const json = AndroidBridge.getCloudAuth();
                if (json) {
                    const data = JSON.parse(json);
                    if (data.token) {
                        this.cloudToken = data.token;
                        this.cloudUsername = data.username;
                    }
                }
            } catch (e) {}
        }
    },

    async pair(pairCode) {
        return new Promise((resolve) => {
            let settled = false;
            const done = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                this.ws.removeEventListener('message', handler);
                resolve(result);
            };

            // 15秒超时
            const timeout = setTimeout(() => {
                done({ success: false, error: '配对请求超时，请检查电脑端是否正常运行' });
            }, 15000);

            const handler = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'paired') {
                        this.authenticated = true;
                        this.deviceToken = msg.token;
                        localStorage.setItem('pc_device_token', msg.token);
                        localStorage.setItem('pc_server_ip', this.serverIP);
                        try { AndroidBridge.setPCConnectionInfo(this.serverIP, msg.token); } catch(e) {}
                        showToast('已连接到电脑');
                        done({ success: true, token: msg.token });
                    } else if (msg.type === 'pair_failed') {
                        done({ success: false, error: msg.error });
                    } else if (msg.type === 'error') {
                        // PC端处理异常，如保存配对设备失败
                        done({ success: false, error: msg.message || '电脑端处理失败' });
                    }
                } catch (_) { /* JSON 解析失败忽略 */ }
            };
            this.ws.addEventListener('message', handler);

            // 发送前检查连接状态
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                done({ success: false, error: 'WebSocket连接已断开，请重新连接' });
                return;
            }
            try {
                this.ws.send(JSON.stringify({ type: 'pair', pairCode }));
            } catch (e) {
                done({ success: false, error: '发送配对请求失败: ' + e.message });
            }
        });
    },

    async autoReconnect() {
        const savedIP = localStorage.getItem('pc_server_ip');
        const savedToken = localStorage.getItem('pc_device_token');
        if (!savedIP || !savedToken) return false;
        try {
            await this.connect(savedIP);
            return new Promise((resolve) => {
                const handler = (e) => {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'authenticated') {
                        this.authenticated = true;
                        this.deviceToken = savedToken;
                        // 通知Java层连接信息（用于文件传输）
                        try { AndroidBridge.setPCConnectionInfo(savedIP, savedToken); } catch(e) {}
                        this.ws.removeEventListener('message', handler);
                        showToast('已连接到电脑');
                        resolve(true);
                    } else if (msg.type === 'auth_failed') {
                        this.ws.removeEventListener('message', handler);
                        resolve(false);
                    }
                };
                this.ws.addEventListener('message', handler);
                this.ws.send(JSON.stringify({ type: 'auth', token: savedToken }));
            });
        } catch (e) {
            return false;
        }
    },

    send(msg) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        this.ws.send(JSON.stringify(msg));
        return true;
    },

    // 文件发送（分片）
    async sendFile(file) {
        if (!this.connected || !this.authenticated) {
            showToast('请先连接并配对电脑');
            return;
        }

        const id = 'file_' + Date.now();
        const CHUNK_SIZE = 512 * 1024; // 512KB

        // 显示进度
        const progressEl = document.getElementById('pcTransferProgress');
        const fileNameEl = document.getElementById('pcTransferFileName');
        const percentEl = document.getElementById('pcTransferPercent');
        const barEl = document.getElementById('pcTransferBar');
        if (progressEl) {
            progressEl.style.display = 'block';
            fileNameEl.textContent = file.name;
            percentEl.textContent = '0%';
            barEl.style.width = '0%';
        }
        showTransferProgress(file.name, 0);

        // 通知服务器开始接收
        this.send({ type: 'file_send_start', id, fileName: file.name, fileSize: file.size });

        // 等待服务器准备好
        await new Promise((resolve) => {
            const handler = (e) => {
                const msg = JSON.parse(e.data);
                if (msg.type === 'file_send_ready' && msg.id === id) {
                    this.ws.removeEventListener('message', handler);
                    resolve();
                }
            };
            this.ws.addEventListener('message', handler);
        });

        // 分片读取并发送
        let offset = 0;
        while (offset < file.size) {
            const chunk = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await chunk.arrayBuffer();
            const base64 = arrayBufferToBase64(buffer);

            this.send({ type: 'file_chunk', id, data: base64 });
            offset += buffer.byteLength;

            const progress = Math.round((offset / file.size) * 100);
            if (percentEl) percentEl.textContent = progress + '%';
            if (barEl) barEl.style.width = progress + '%';
            showTransferProgress(file.name, progress);

            // 等待服务端 progress 确认后再发下一个 chunk，避免堆积
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.ws.removeEventListener('message', progressHandler);
                    reject(new Error('传输超时'));
                }, 30000);
                const progressHandler = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg.type === 'file_send_progress' && msg.id === id) {
                            clearTimeout(timeout);
                            this.ws.removeEventListener('message', progressHandler);
                            resolve();
                        } else if (msg.type === 'error' && msg.message) {
                            clearTimeout(timeout);
                            this.ws.removeEventListener('message', progressHandler);
                            reject(new Error(msg.message));
                        }
                    } catch (err) {}
                };
                this.ws.addEventListener('message', progressHandler);
            }).catch(err => {
                showToast('传输中断: ' + err.message);
                progressEl.style.display = 'none';
                throw err;
            });
        }

        // 通知发送完成
        this.send({ type: 'file_send_end', id });

        // 等待服务器确认
        await new Promise((resolve) => {
            const handler = (e) => {
                const msg = JSON.parse(e.data);
                if (msg.type === 'file_send_complete' && msg.id === id) {
                    this.ws.removeEventListener('message', handler);
                    resolve(msg);
                }
            };
            this.ws.addEventListener('message', handler);
        });

        if (percentEl) percentEl.textContent = '✓ 完成';
        if (barEl) barEl.style.width = '100%';
        hideTransferProgress();
        showToast('文件已发送到电脑: ' + file.name);

        setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 3000);
    },

    _handleMessage(msg) {
        // 处理从电脑端推送的文件下载
        if (msg.type === 'file_download_start') {
            this._handleIncomingFile(msg);
        } else if (msg.type === 'file_download_chunk') {
            this._handleIncomingChunk(msg);
        } else if (msg.type === 'file_download_complete') {
            this._handleIncomingComplete(msg);
        }
    },

    // 接收文件相关
    _incomingFile: null,

    _handleIncomingFile(msg) {
        this._incomingFile = {
            id: msg.id,
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            byteChunks: [],
            received: 0,
        };
        // Android端：先删除旧文件，确保追加写入从空文件开始
        if (window.AndroidBridge && typeof AndroidBridge.appendReceivedChunk === 'function') {
            AndroidBridge.deleteFileIfExists(msg.fileName);
        }
        // 显示固定进度条
        if (typeof showTransferProgress === 'function') {
            showTransferProgress(msg.fileName, 0);
        }
        // 兼容设置面板进度条
        const el = document.getElementById('pcReceiveProgress');
        if (el) {
            el.style.display = 'block';
            document.getElementById('pcReceiveFileName').textContent = '接收: ' + msg.fileName;
            document.getElementById('pcReceivePercent').textContent = '0%';
            document.getElementById('pcReceiveBar').style.width = '0%';
        }
    },

    _handleIncomingChunk(msg) {
        if (!this._incomingFile || this._incomingFile.id !== msg.id) return;
        // 二进制模式：数据通过 _handleBinaryChunk 接收，这里只更新进度
        if (typeof showTransferProgress === 'function') {
            showTransferProgress(this._incomingFile.fileName, msg.progress);
        }
        const percentEl = document.getElementById('pcReceivePercent');
        const barEl = document.getElementById('pcReceiveBar');
        if (percentEl) percentEl.textContent = msg.progress + '%';
        if (barEl) barEl.style.width = msg.progress + '%';
    },

    _handleBinaryChunk(data) {
        if (!this._incomingFile) return;
        const chunk = new Uint8Array(data);
        this._incomingFile.received += chunk.length;

        // 增量写入：每个 chunk 立即通过 AndroidBridge 追加写入文件
        if (window.AndroidBridge && typeof AndroidBridge.appendReceivedChunk === 'function') {
            let binary = '';
            const cs = 8192;
            for (let i = 0; i < chunk.length; i += cs) {
                binary += String.fromCharCode.apply(null, chunk.subarray(i, Math.min(i + cs, chunk.length)));
            }
            AndroidBridge.appendReceivedChunk(this._incomingFile.fileName, btoa(binary));
        } else {
            // Web 端：累积到内存
            if (!this._incomingFile.byteChunks) this._incomingFile.byteChunks = [];
            this._incomingFile.byteChunks.push(chunk);
        }
    },

    _handleIncomingComplete(msg) {
        if (!this._incomingFile || this._incomingFile.id !== msg.id) return;

        const isAndroid = window.AndroidBridge && typeof AndroidBridge.appendReceivedChunk === 'function';
        const fileName = msg.fileName;
        const fileSize = this._incomingFile.fileSize || msg.fileSize || 0;

        if (!isAndroid && this._incomingFile.byteChunks) {
            // Web 端：合并所有二进制 chunk 并下载
            const totalLen = this._incomingFile.byteChunks.reduce((s, c) => s + c.length, 0);
            const bytes = new Uint8Array(totalLen);
            let pos = 0;
            for (const chunk of this._incomingFile.byteChunks) {
                bytes.set(chunk, pos);
                pos += chunk.length;
            }
            const blob = new Blob([bytes]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
        }

        // 隐藏固定进度条
        if (typeof hideTransferProgress === 'function') {
            hideTransferProgress();
        }
        // 兼容设置面板
        const percentEl = document.getElementById('pcReceivePercent');
        if (percentEl) percentEl.textContent = '✓ 已接收';
        showToast('已接收文件: ' + fileName);

        setTimeout(() => {
            const el = document.getElementById('pcReceiveProgress');
            if (el) el.style.display = 'none';
        }, 3000);

        // 在聊天界面显示收到的文件
        showReceivedFileInChat(fileName, fileSize);

        this._incomingFile = null;
    },

    _scheduleReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(async () => {
            const success = await this.autoReconnect();
            if (success) {
                // 恢复 UI
                const statusEl = document.getElementById('pcConnectionStatus');
                const pairRow = document.getElementById('pcPairCodeRow');
                const fileArea = document.getElementById('pcFileTransferArea');
                const statusText = document.getElementById('pcStatusText');
                if (statusEl) statusEl.style.display = 'block';
                if (pairRow) pairRow.style.display = 'none';
                if (fileArea) fileArea.style.display = 'block';
                if (statusText) { statusText.textContent = '已连接'; statusText.style.color = '#4CAF50'; }
            } else {
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
                this._scheduleReconnect();
            }
        }, this.reconnectDelay);
    },

    disconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        // 清除保存的凭据，防止自动重连
        localStorage.removeItem('pc_device_token');
        localStorage.removeItem('pc_server_ip');
        this.deviceToken = null;
        if (this.ws) {
            // 先移除 onclose 防止触发 _scheduleReconnect
            this.ws.onclose = null;
            this.ws.close();
        }
        this.ws = null;
        this.connected = false;
        this.authenticated = false;
    }
};

// ArrayBuffer 转 Base64
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

// 在聊天中显示从电脑端收到的文件
// 文件接收消息写入 Promise 链（串行化，避免并发写入丢失）
let _fileMsgChain = Promise.resolve();

function showReceivedFileInChat(fileName, fileSize) {
    const formattedSize = fileSize > 0 ? formatFileSize(fileSize) : '';
    const now = Date.now();
    const displayContent = '📁 收到来自电脑的文件：' + fileName + (formattedSize ? '（' + formattedSize + '）' : '');

    // 文件对象
    const fileObj = {
        name: fileName,
        size: fileSize,
        isReceived: true
    };

    // 将文件消息预先写入 PC 智能体的消息存储中
    const pcTopicId = (agentTopics[PC_AGENT_ID] && agentTopics[PC_AGENT_ID].length > 0) ? agentTopics[PC_AGENT_ID][0].id : 'pc_chat_1';
    const pcMsgKey = `cnai_messages_${PC_AGENT_ID}_topic_${pcTopicId}`;
    
    // 串行写入，避免并发竞态
    _fileMsgChain = _fileMsgChain.then(async () => {
        const existingMsgs = await getMessagesFromDB(pcMsgKey) || [];
        existingMsgs.push({
            role: 'system',
            content: displayContent,
            displayContent: displayContent,
            timestamp: now,
            receivedFile: fileName,
            receivedFileObj: fileObj
        });
        await saveMessagesToDB(pcMsgKey, existingMsgs);

        // 切换到电脑端智能体（切换时会从DB加载最新消息，包含刚写入的）
        if (currentAgentId !== PC_AGENT_ID) {
            selectAgentAndTopic(PC_AGENT_ID, pcTopicId);
        } else if (currentTopicId === pcTopicId) {
            // 已在电脑端话题，直接追加到界面
            const filesForDisplay = [fileObj];
            const systemMsgId = generateMessageId();
            appendMessage('system', displayContent, true, false, now, null, null, 0, null, filesForDisplay, null, systemMsgId);
            messages.push({
                id: systemMsgId,
                role: 'system',
                content: displayContent,
                displayContent: displayContent,
                timestamp: now,
                receivedFile: fileName,
                receivedFileObj: fileObj
            });

        }
    });
}

// 连接电脑交互
const pcServerIPInput = document.getElementById('pcServerIP');
const pcConnectBtnEl = document.getElementById('pcConnectBtn');
const pcPairCodeRow = document.getElementById('pcPairCodeRow');
const pcPairCodeInput = document.getElementById('pcPairCodeInput');
const pcPairBtn = document.getElementById('pcPairBtn');
const pcConnectionStatus = document.getElementById('pcConnectionStatus');
const pcStatusText = document.getElementById('pcStatusText');
const pcDisconnectBtn = document.getElementById('pcDisconnectBtn');
const pcFileTransferArea = document.getElementById('pcFileTransferArea');
const pcSendFileBtn = document.getElementById('pcSendFileBtn');
const pcFileInput = document.getElementById('pcFileInput');

// 恢复保存的IP
const savedPCIP = localStorage.getItem('pc_server_ip');
if (savedPCIP && pcServerIPInput) pcServerIPInput.value = savedPCIP;

// ==================== 连接方式 Tab 切换 ====================
const connTabPublic = document.getElementById('connTabPublic');
const connTabLocal = document.getElementById('connTabLocal');
const connPanelPublic = document.getElementById('connPanelPublic');
const connPanelLocal = document.getElementById('connPanelLocal');

function switchConnTab(tab) {
    if (tab === 'public') {
        connTabPublic.style.background = 'var(--highlight-bg, var(--primary-color))';
        connTabPublic.style.color = 'var(--highlight-text, #fff)';
        connTabPublic.style.color = '#fff';
        connTabLocal.style.background = 'var(--bg-secondary)';
        connTabLocal.style.color = 'var(--text-secondary)';
        connPanelPublic.style.display = '';
        connPanelLocal.style.display = 'none';
    } else {
        connTabLocal.style.background = 'var(--highlight-bg, var(--primary-color))';
        connTabLocal.style.color = 'var(--highlight-text, #fff)';
        connTabLocal.style.color = '#fff';
        connTabPublic.style.background = 'var(--bg-secondary)';
        connTabPublic.style.color = 'var(--text-secondary)';
        connPanelLocal.style.display = '';
        connPanelPublic.style.display = 'none';
    }
}
connTabPublic?.addEventListener('click', () => switchConnTab('public'));
connTabLocal?.addEventListener('click', () => switchConnTab('local'));

// ==================== 公网连接 UI ====================
const cloudLoginForm = document.getElementById('cloudLoginForm');
const cloudLoggedIn = document.getElementById('cloudLoggedIn');
const cloudUsernameInput = document.getElementById('cloudUsernameInput');
const cloudPasswordInput = document.getElementById('cloudPasswordInput');
// 恢复上次输入的账号密码
const savedCloudUser = localStorage.getItem('cloud_username');
if (savedCloudUser) cloudUsernameInput.value = savedCloudUser;
const cloudLoginBtn = document.getElementById('cloudLoginBtn');
const cloudRegisterBtn = document.getElementById('cloudRegisterBtn');
const cloudLogoutBtn = document.getElementById('cloudLogoutBtn');
const cloudConnectBtn = document.getElementById('cloudConnectBtn');
const cloudUsernameDisplay = document.getElementById('cloudUsernameDisplay');
const cloudStatusBadge = document.getElementById('cloudStatusBadge');

function updateCloudUI() {
    if (pcConnection.cloudToken) {
        cloudLoginForm.style.display = 'none';
        cloudLoggedIn.style.display = 'block';
        cloudUsernameDisplay.textContent = pcConnection.cloudUsername;
        cloudStatusBadge.textContent = '已登录';
        cloudStatusBadge.style.background = 'rgba(76,175,80,0.1)';
        cloudStatusBadge.style.color = '#4CAF50';
    } else {
        cloudLoginForm.style.display = 'block';
        cloudLoggedIn.style.display = 'none';
        cloudStatusBadge.textContent = '未登录';
        cloudStatusBadge.style.background = 'var(--bg-secondary)';
        cloudStatusBadge.style.color = 'var(--text-secondary)';
    }
}

// 初始化云信令（恢复登录状态）
try {
    pcConnection.restoreCloudAuth();
} catch(e) { console.warn('[cnaichat_cloud] restoreCloudAuth error:', e); }
updateCloudUI();

console.log('[cnaichat_cloud] cloudLoginBtn:', cloudLoginBtn, 'cloudRegisterBtn:', cloudRegisterBtn, 'cloudLoginForm:', cloudLoginForm);

cloudLoginBtn?.addEventListener('click', async () => {
    console.log('[cnaichat_cloud] 登录按钮点击');
    const username = cloudUsernameInput.value.trim();
    const password = cloudPasswordInput.value;
    console.log('[cnaichat_cloud] username:', username, 'password length:', password.length);
    if (!username || !password) { showToast('请输入用户名和密码'); return; }
    if (username.length < 3 || username.length > 16) { showToast('用户名长度需在3-16位之间'); return; }
    if (password.length < 6 || password.length > 16) { showToast('密码长度需在6-16位之间'); return; }
    if (!/^[A-Za-z0-9!@#_]+$/.test(username)) { showToast('用户名只能包含字母、数字和!@#_'); return; }
    if (!/^[A-Za-z0-9!@#_]+$/.test(password)) { showToast('密码只能包含字母、数字和!@#_'); return; }
    cloudLoginBtn.disabled = true;
    try {
        const result = await pcConnection.cloudLogin(username, password);
        console.log('[cnaichat_cloud] 登录结果:', JSON.stringify(result));
        cloudLoginBtn.textContent = '登录';
        cloudLoginBtn.disabled = false;
        if (result.success) {
            localStorage.setItem('cloud_username', username);
            showToast('登录成功');
            updateCloudUI();
        } else {
            showToast(result.error || '登录失败');
        }
    } catch (e) {
        console.error('[cnaichat_cloud] 登录异常:', e);
        cloudLoginBtn.textContent = '登录';
        cloudLoginBtn.disabled = false;
    }
});

cloudRegisterBtn?.addEventListener('click', async () => {
    console.log('[cnaichat_cloud] 注册按钮点击');
    const username = cloudUsernameInput.value.trim();
    const password = cloudPasswordInput.value;
    console.log('[cnaichat_cloud] username:', username, 'password length:', password.length);
    if (!username || !password) { showToast('请输入用户名和密码'); return; }
    if (username.length < 3 || username.length > 16) { showToast('用户名长度需在3-16位之间'); return; }
    if (password.length < 6 || password.length > 16) { showToast('密码长度需在6-16位之间'); return; }
    if (!/^[A-Za-z0-9!@#_]+$/.test(username)) { showToast('用户名只能包含字母、数字和!@#_'); return; }
    if (!/^[A-Za-z0-9!@#_]+$/.test(password)) { showToast('密码只能包含字母、数字和!@#_'); return; }
    cloudRegisterBtn.disabled = true;
    try {
        const result = await pcConnection.cloudRegister(username, password);
        console.log('[cnaichat_cloud] 注册结果:', JSON.stringify(result));
        cloudRegisterBtn.textContent = '注册';
        cloudRegisterBtn.disabled = false;
        if (result.success) {
            localStorage.setItem('cloud_username', username);
            showToast('注册成功');
            updateCloudUI();
        } else {
            showToast(result.error || '注册失败');
        }
    } catch (e) {
        console.error('[cnaichat_cloud] 注册异常:', e);
        cloudRegisterBtn.textContent = '注册';
        cloudRegisterBtn.disabled = false;
    }
});

cloudLogoutBtn?.addEventListener('click', () => {
    pcConnection.cloudLogout();
    updateCloudUI();
    showToast('已退出登录');
});

cloudConnectBtn?.addEventListener('click', async () => {
    if (!pcConnection.cloudToken) { showToast('请先登录'); return; }
    cloudConnectBtn.textContent = '连接中...';
    cloudConnectBtn.disabled = true;
    try {
        const result = await pcConnection.connectViaCloud();
        if (result.success) {
            cloudConnectBtn.textContent = '🔗 公网连接电脑';
            cloudConnectBtn.disabled = false;
            pcPairCodeRow.style.display = 'block';
            pcConnectionStatus.style.display = 'block';
            pcStatusText.textContent = '已连接(公网)';
            pcStatusText.style.color = '#4CAF50';
            pcConnectBtnEl.textContent = '已连接';
            pcConnectBtnEl.disabled = false;
            showToast('公网连接成功，请输入配对码');
        } else {
            cloudConnectBtn.textContent = '🔗 公网连接电脑';
            cloudConnectBtn.disabled = false;
            showToast(result.error || '连接失败');
        }
    } catch (e) {
        cloudConnectBtn.textContent = '🔗 公网连接电脑';
        cloudConnectBtn.disabled = false;
        showToast('公网连接失败: ' + e.message);
    }
});

// 记录当前已连接的IP，用于检测IP变化
let currentConnectedIP = '';

// IP输入框变化监听：内容变化时按钮变"连接"
pcServerIPInput?.addEventListener('input', () => {
    const ip = pcServerIPInput.value.trim();
    if (ip !== currentConnectedIP) {
        pcConnectBtnEl.textContent = '连接';
        pcConnectBtnEl.disabled = false;
    }
});

// 自动重连
if (savedPCIP && localStorage.getItem('pc_device_token')) {
    pcConnection.autoReconnect().then(success => {
        if (success) {
            currentConnectedIP = savedPCIP;
            if (pcConnectionStatus) pcConnectionStatus.style.display = 'block';
            if (pcFileTransferArea) pcFileTransferArea.style.display = 'block';
            if (pcStatusText) { pcStatusText.textContent = '已连接'; pcStatusText.style.color = '#4CAF50'; }
            if (pcConnectBtnEl) { pcConnectBtnEl.textContent = '连接'; pcConnectBtnEl.disabled = false; }
            ensurePCAgent();
        }
    });
}

pcConnectBtnEl?.addEventListener('click', async () => {
    const ip = pcServerIPInput.value.trim();
    if (!ip) { showToast('请输入电脑IP地址'); return; }

    // 如果已连接到同一个IP，不重复连接
    if (pcConnection.connected && ip === currentConnectedIP) {
        showToast('已连接到该IP');
        return;
    }

    // 如果已连接到其他IP，先断开
    if (pcConnection.connected) {
        pcConnection.disconnect();
        pcConnectionStatus.style.display = 'none';
        pcPairCodeRow.style.display = 'none';
        pcFileTransferArea.style.display = 'none';
        pcStatusText.textContent = '';
    }

    pcConnectBtnEl.textContent = '连接中...';
    pcConnectBtnEl.disabled = true;
    try {
        await pcConnection.connect(ip);
        currentConnectedIP = ip;
        pcPairCodeRow.style.display = 'block';
        pcConnectionStatus.style.display = 'block';
        pcStatusText.textContent = '已连接';
        pcStatusText.style.color = '#4CAF50';
        pcConnectBtnEl.textContent = '已连接';
        pcConnectBtnEl.disabled = false;
        showToast('已连接到电脑，请输入配对码');
    } catch (e) {
        showToast('连接失败，请检查IP地址');
        pcConnectBtnEl.textContent = '连接';
        pcConnectBtnEl.disabled = false;
    }
});

pcPairBtn?.addEventListener('click', async () => {
    const code = pcPairCodeInput.value.trim().toUpperCase();
    if (!code) { showToast('请输入配对码'); return; }
    const result = await pcConnection.pair(code);
    if (result.success) {
        pcPairCodeRow.style.display = 'none';
        pcConnectionStatus.style.display = 'block';
        pcFileTransferArea.style.display = 'block';
        pcStatusText.textContent = '已连接';
        pcStatusText.style.color = '#4CAF50';
        pcConnectBtnEl.textContent = '已连接';
        pcConnectBtnEl.disabled = false;
        showToast('配对成功！');
        ensurePCAgent();
    } else {
        showToast(result.error || '配对失败');
    }
});

pcDisconnectBtn?.addEventListener('click', () => {
    pcConnection.disconnect();
    currentConnectedIP = '';
    removePCAgent();
    pcConnectionStatus.style.display = 'none';
    pcPairCodeRow.style.display = 'none';
    pcFileTransferArea.style.display = 'none';
    pcStatusText.textContent = '';
    pcConnectBtnEl.textContent = '连接';
    pcConnectBtnEl.disabled = false;
    showToast('已断开连接');
});

// 发送文件 - 优先使用 Android 原生文件选择器
pcSendFileBtn?.addEventListener('click', () => {
    if (window.AndroidBridge && typeof AndroidBridge.openPCFileChooser === 'function') {
        // Android 环境：使用专用的电脑文件传输选择器（支持所有文件类型）
        AndroidBridge.openPCFileChooser();
    } else {
        // Web 环境：使用 file input
        pcFileInput?.click();
    }
});

// Android 原生文件选择器回调（电脑文件传输专用）
window.handlePCFileSelected = async function(fileData) {
    // Android端：Java层直接通过WebSocket发送文件，不经过WebView
    // 这个函数在Android端不再需要，文件发送由Java层直接处理
    // Web环境（浏览器）下仍然使用这个函数
    if (!fileData || !fileData.base64) return;
    try {
        const binaryString = atob(fileData.base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: fileData.mimeType || 'application/octet-stream' });
        const file = new File([blob], fileData.name, { type: fileData.mimeType || 'application/octet-stream' });
        await pcConnection.sendFile(file);
    } catch (error) {
        console.error('发送文件失败:', error);
        showToast('发送文件失败: ' + error.message);
    }
};

// Web 环境 file input 回调
pcFileInput?.addEventListener('change', async () => {
    const files = pcFileInput.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        await pcConnection.sendFile(file);
    }
    pcFileInput.value = ''; // 清空，允许重复选择
});

// ==================== 选中文本高亮匹配（CSS Highlight API） ====================

(function () {
    if (typeof CSS === 'undefined' || !CSS.highlights) return; // 不支持则静默退出

    // 动态注入样式（不改 CSS 文件）
    // 根据主题注入不同颜色
    function injectStyle() {
        let existing = document.getElementById('text-highlight-style');
        if (existing) existing.remove();
        const style = document.createElement('style');
        style.id = 'text-highlight-style';
        const isDark = document.body.classList.contains('dark-theme');
        const bg = isDark ? 'rgba(255, 193, 7, 0.35)' : 'rgba(255, 213, 79, 0.45)';
        style.textContent = '::highlight(text-highlight) { background-color: ' + bg + '; color: inherit; }';
        document.head.appendChild(style);
    }
    injectStyle();

    // 监听主题变化，重新注入样式
    const themeObserver = new MutationObserver(function () {
        injectStyle();
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    let _timer = null;

    document.addEventListener('selectionchange', function () {
        clearTimeout(_timer);
        _timer = setTimeout(handle, 300);
    });

    document.addEventListener('mousedown', function (e) {
        if (!CSS.highlights.has('text-highlight')) return;
        if (e.target.closest('.message-content, .tool-call-card, .diff-card, .bs-panel')) return;
        clearHighlight();
    });

    function handle() {
        const sel = window.getSelection();
        const text = sel.toString().trim();

        if (text.length < 2 || text.length > 30) {
            clearHighlight();
            return;
        }

        // 选区必须在可高亮区域内
        if (sel.rangeCount === 0) return;
        let node = sel.getRangeAt(0).commonAncestorContainer;
        if (node.nodeType === 3) node = node.parentNode;
        if (!node || !node.closest || !node.closest('.message-content, .tool-call-card, .diff-card, .bs-panel')) return;

        clearHighlight();

        // 遍历所有消息内容，收集匹配的 Range
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        const ranges = [];
        const skipTags = new Set(['SCRIPT', 'STYLE']);
        const skipClasses = ['katex', 'katex-display', 'echarts-container', 'math-tex', 'MathJax'];

        document.querySelectorAll('.message-content, .diff-card, .tool-call-card, .bs-panel').forEach(function (el) {
            collectAndMatch(el);
        });

        function collectAndMatch(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode: function (node) {
                    // 跳过空文本
                    if (node.nodeValue.trim().length === 0) return NodeFilter.FILTER_REJECT;
                    // 跳过 SCRIPT/STYLE
                    let parent = node.parentNode;
                    while (parent && parent !== root) {
                        if (skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
                        if (parent.classList) {
                            for (let i = 0; i < skipClasses.length; i++) {
                                if (parent.classList.contains(skipClasses[i])) return NodeFilter.FILTER_REJECT;
                            }
                        }
                        parent = parent.parentNode;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            while (walker.nextNode()) {
                const textNode = walker.currentNode;
                const content = textNode.nodeValue;
                let match;
                regex.lastIndex = 0;
                while ((match = regex.exec(content)) !== null) {
                    const range = document.createRange();
                    range.setStart(textNode, match.index);
                    range.setEnd(textNode, match.index + match[0].length);
                    ranges.push(range);
                    if (match.index === regex.lastIndex) regex.lastIndex++;
                }
            }
        }

        if (ranges.length > 0) {
            const highlight = new Highlight(...ranges);
            CSS.highlights.set('text-highlight', highlight);
        }
    }

    function clearHighlight() {
        CSS.highlights.delete('text-highlight');
    }
})();