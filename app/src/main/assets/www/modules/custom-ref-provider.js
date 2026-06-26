/**
 * 自定义服务商 - AI服务商配置参考 功能
 * 通过 monkey-patching 注入 refProvider 逻辑，不修改 app.js
 */

// ==================== 常量定义 ====================

// AI服务商配置参考的选项
const refProviderOptions = [
    { value: '', label: '无（手动配置）' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'qwen', label: '千问' },
    { value: 'doubao', label: '豆包' },
    { value: 'glm', label: 'GLM' },
    { value: 'minimax', label: 'MiniMax' },
    { value: 'kimi', label: 'Kimi' },
    { value: 'mimo', label: 'MiMo' }
];

// 参考服务商对应的API类型
const refProviderApiTypes = {
    'deepseek': 'openai',
    'mimo': 'openai',
    'minimax': 'openai',
    'kimi': 'openai',
    'glm': 'openai',
    'doubao': 'responses',
    'qwen': 'responses'
};

// ==================== DOM 注入 ====================

// 在 API类型 和 API基础地址 之间插入"AI服务商配置参考"下拉框
function injectRefProviderUI() {
    const apiTypeGroup = apiTypeSelectBtn.closest('.form-group');
    if (!apiTypeGroup) return;

    const refGroup = document.createElement('div');
    refGroup.className = 'form-group';
    refGroup.innerHTML = `
        <label>AI服务商配置参考</label>
        <div class="custom-select-wrapper">
            <div class="custom-select-container">
                <button type="button" class="custom-select-btn" id="refProviderSelectBtn">
                    <span class="custom-select-text" id="refProviderSelectText">无（手动配置）</span>
                    <svg class="custom-select-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
            </div>
        </div>
        <small style="color: var(--text-secondary); font-size: 12px; display: block; margin-top: 4px;">
            选择后，请求体、请求头等将自动匹配该服务商的格式（API基础地址仍使用自定义地址）
        </small>
    `;

    apiTypeGroup.insertAdjacentElement('afterend', refGroup);
}

// ==================== 辅助函数 ====================

// 根据参考服务商更新API类型下拉的禁用状态
function updateApiTypeDisabledState(refValue) {
    if (refValue && refProviderApiTypes[refValue]) {
        // 有参考服务商，禁用API类型下拉并自动设置
        apiTypeSelectBtn.disabled = true;
        apiTypeSelectBtn.style.opacity = '0.5';
        apiTypeSelectBtn.style.pointerEvents = 'none';
        const apiType = refProviderApiTypes[refValue];
        apiTypeSelectBtn.dataset.value = apiType;
        apiTypeSelectText.textContent = apiType === 'responses' ? 'OpenAI Responses 兼容模式' : 'OpenAI 兼容模式';
    } else {
        // 无参考服务商，启用API类型下拉
        apiTypeSelectBtn.disabled = false;
        apiTypeSelectBtn.style.opacity = '';
        apiTypeSelectBtn.style.pointerEvents = '';
    }
}

// ==================== Monkey-patch 核心函数 ====================

// 保存原始函数引用
const _originalGetAPIEndpoint = getAPIEndpoint;
const _originalBuildRequestBody = buildRequestBody;
const _originalHandleResponse = handleResponse;
const _originalOpenEditCustomProviderModal = openEditCustomProviderModal;
const _originalSaveCustomProviderField = saveCustomProviderField;

// --- getAPIEndpoint ---
// 自定义服务商有refProvider时，根据refProvider决定端点路径，但仍使用自定义baseUrl
getAPIEndpoint = function () {
    if (currentAIProvider.startsWith('custom_')) {
        const provider = customProviders.find(p => p.id === currentAIProvider);
        if (provider) {
            let baseUrl = provider.baseUrl.replace(/\/+$/, '');
            // 如果有参考服务商，根据参考服务商决定端点路径
            if (provider.refProvider && refProviderApiTypes[provider.refProvider]) {
                const apiType = refProviderApiTypes[provider.refProvider];
                return baseUrl + (apiType === 'responses' ? '/responses' : '/chat/completions');
            }
            if (provider.apiType === 'responses') {
                return baseUrl + '/responses';
            }
            return baseUrl + '/chat/completions';
        }
    }
    return _originalGetAPIEndpoint();
};

// --- buildRequestBody ---
// 自定义服务商有refProvider时，临时将currentAIProvider改为refProvider，
// 让原始函数走refProvider的请求体构建分支
buildRequestBody = function (...args) {
    const savedProvider = currentAIProvider;
    if (currentAIProvider.startsWith('custom_')) {
        const provider = customProviders.find(p => p.id === currentAIProvider);
        if (provider && provider.refProvider) {
            currentAIProvider = provider.refProvider;
        }
    }
    const result = _originalBuildRequestBody(...args);
    currentAIProvider = savedProvider;
    return result;
};

// --- handleResponse ---
// 自定义服务商有refProvider时：
// 1. 先计算自定义endpoint（此时currentAIProvider还是custom_）
// 2. 临时覆盖getAPIEndpoint返回自定义endpoint
// 3. 临时将currentAIProvider改为refProvider，让响应解析、headers、session逻辑走refProvider分支
handleResponse = async function (...args) {
    const savedProvider = currentAIProvider;
    let savedGetAPIEndpoint = null;

    if (currentAIProvider.startsWith('custom_')) {
        const provider = customProviders.find(p => p.id === currentAIProvider);
        if (provider && provider.refProvider) {
            // 先计算自定义endpoint（此时getAPIEndpoint已被patch，currentAIProvider还是custom_）
            const customEndpoint = getAPIEndpoint();

            // 临时覆盖getAPIEndpoint，让它固定返回自定义endpoint
            savedGetAPIEndpoint = getAPIEndpoint;
            getAPIEndpoint = function () { return customEndpoint; };

            // 临时将currentAIProvider改为refProvider
            currentAIProvider = provider.refProvider;
        }
    }

    try {
        return await _originalHandleResponse(...args);
    } finally {
        currentAIProvider = savedProvider;
        if (savedGetAPIEndpoint) {
            getAPIEndpoint = savedGetAPIEndpoint;
        }
    }
};

// --- openEditCustomProviderModal ---
// 编辑弹窗打开时，加载/重置refProvider下拉状态
openEditCustomProviderModal = function (providerId = null) {
    const refSelectBtn = document.getElementById('refProviderSelectBtn');
    const refSelectText = document.getElementById('refProviderSelectText');
    if (!refSelectBtn || !refSelectText) {
        // UI还没注入，直接调用原始函数
        _originalOpenEditCustomProviderModal(providerId);
        return;
    }

    // 先调用原始函数（设置name、baseUrl、apiType、models等）
    _originalOpenEditCustomProviderModal(providerId);

    // 然后设置refProvider下拉
    if (providerId) {
        const provider = customProviders.find(p => p.id === providerId);
        if (provider) {
            const refValue = provider.refProvider || '';
            refSelectBtn.dataset.value = refValue;
            const refOption = refProviderOptions.find(o => o.value === refValue);
            refSelectText.textContent = refOption ? refOption.label : '无（手动配置）';
            updateApiTypeDisabledState(refValue);
        }
    } else {
        refSelectBtn.dataset.value = '';
        refSelectText.textContent = '无（手动配置）';
        updateApiTypeDisabledState('');
    }
};

// --- saveCustomProviderField ---
// 保存时同步保存refProvider字段
saveCustomProviderField = function () {
    // 先调用原始保存逻辑
    _originalSaveCustomProviderField();

    // 追加保存refProvider
    if (!editingCustomProviderId) return;
    const provider = customProviders.find(p => p.id === editingCustomProviderId);
    if (!provider) return;

    const refSelectBtn = document.getElementById('refProviderSelectBtn');
    if (refSelectBtn) {
        provider.refProvider = refSelectBtn.dataset.value || '';
        localStorage.setItem('cnai_custom_providers', JSON.stringify(customProviders));
    }
};

// --- setupCustomProviderEvents ---
// 注意：setupCustomProviderEvents 在 app.js 初始化时只调用一次，此时已经执行完毕。
// 所以不需要 patch 它，而是在下方初始化代码中直接绑定 refProvider 下拉事件。
// 原始事件绑定的 saveCustomProviderField 已经被 patch，会自动保存 refProvider。

// ==================== 列表显示增强 ====================

// Monkey-patch openCustomProviderModal，在原始渲染后修改列表显示
const _originalOpenCustomProviderModal = openCustomProviderModal;

openCustomProviderModal = function () {
    _originalOpenCustomProviderModal();

    // 原始函数已经渲染了列表，现在修改显示内容以包含refProvider信息
    const bsList = document.getElementById('bsCustomProviderList');
    if (!bsList) return;

    const items = bsList.querySelectorAll('.bs-item');
    customProviders.forEach((provider, index) => {
        if (index >= items.length) return;
        const smallEl = items[index].querySelector('small');
        if (smallEl && provider.refProvider) {
            const refOption = refProviderOptions.find(o => o.value === provider.refProvider);
            if (refOption) {
                smallEl.textContent = `参考: ${refOption.label} · ${provider.models.length} 个模型`;
            }
        }
    });
};

// ==================== 深度思考 & 联网搜索 开关适配 ====================

// 获取自定义服务商的参考服务商ID（无则返回null）
function getCustomRefProvider(providerId) {
    if (!providerId || !providerId.startsWith('custom_')) return null;
    const provider = customProviders.find(p => p.id === providerId);
    return (provider && provider.refProvider) ? provider.refProvider : null;
}

// --- updateAIProviderSelectDisplay ---
// 当自定义服务商有refProvider时，不禁用深度思考开关
const _originalUpdateAIProviderSelectDisplay = updateAIProviderSelectDisplay;

updateAIProviderSelectDisplay = function () {
    _originalUpdateAIProviderSelectDisplay();

    // 后处理：如果当前是自定义服务商且有refProvider，恢复深度思考开关
    const value = aiProviderSelect.value;
    const refProvider = getCustomRefProvider(value);
    if (refProvider) {
        const isMinimax = refProvider === 'minimax';
        deepThinkingSwitch.disabled = isMinimax;
        const deepThinkingLabel = deepThinkingSwitch.closest('.form-group');
        if (deepThinkingLabel) {
            if (isMinimax) {
                deepThinkingLabel.style.opacity = '0.5';
                deepThinkingLabel.style.pointerEvents = 'none';
            } else {
                deepThinkingLabel.style.opacity = '';
                deepThinkingLabel.style.pointerEvents = '';
            }
        }
    }
};

// --- updateModelOptions ---
// 只需要让深度思考和联网搜索开关跟随refProvider，模型列表保持自定义服务商自己的
const _originalUpdateModelOptions = updateModelOptions;

updateModelOptions = function () {
    // 先正常调用原始函数（模型列表用自定义服务商自己的）
    _originalUpdateModelOptions();

    // 后处理：如果有refProvider，单独修正深度思考和联网搜索开关状态
    const refProvider = getCustomRefProvider(currentAIProvider);
    console.log('[custom-ref-provider] updateModelOptions后处理, currentAIProvider:', currentAIProvider, 'refProvider:', refProvider);
    if (refProvider) {
        // 深度思考：从refProvider的设置中恢复
        deepThinkingEnabled = deepThinkingByProvider[refProvider] !== false;
        deepThinkingSwitch.checked = deepThinkingEnabled;
        updateDeepThinkingToggleBtn();

        // 联网搜索：根据refProvider决定是否显示
        const webSearchSupported = WEB_SEARCH_PROVIDERS.includes(refProvider);
        if (webSearchFormGroup) {
            webSearchFormGroup.style.display = webSearchSupported ? 'block' : 'none';
        }
        if (webSearchSwitch) {
            webSearchSwitch.checked = webSearchEnabled;
            updateWebSearchToggleBtn();
        }
    }
};

// --- updateDeepThinkingToggleBtn ---
// 自定义服务商有refProvider时，根据refProvider决定深度思考按钮状态
const _originalUpdateDeepThinkingToggleBtn = updateDeepThinkingToggleBtn;

updateDeepThinkingToggleBtn = function (fromToggleChange = false, wasEnabled = false) {
    const refProvider = getCustomRefProvider(currentAIProvider);
    if (refProvider) {
        // 有refProvider，根据refProvider决定是否禁用
        const isMinimax = refProvider === 'minimax';
        if (isMinimax) {
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
        updateToggleBtnsExpanded(fromToggleChange, wasEnabled);
        updateChatMenuBtnIcon();
    } else {
        _originalUpdateDeepThinkingToggleBtn(fromToggleChange, wasEnabled);
    }
};

// --- updateWebSearchToggleBtn ---
// 自定义服务商有refProvider时，根据refProvider决定联网搜索按钮状态
const _originalUpdateWebSearchToggleBtn = updateWebSearchToggleBtn;

updateWebSearchToggleBtn = function (fromToggleChange = false, wasEnabled = false) {
    const refProvider = getCustomRefProvider(currentAIProvider);
    if (refProvider) {
        // 有refProvider，根据refProvider决定是否支持联网搜索
        const supportedProviders = WEB_SEARCH_PROVIDERS;
        const isSupported = supportedProviders.includes(refProvider);
        if (isSupported) {
            webSearchToggleBtn.classList.remove('disabled');
        } else {
            webSearchToggleBtn.classList.add('disabled');
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
        updateToggleBtnsExpanded(fromToggleChange, wasEnabled);
        updateChatMenuBtnIcon();
    } else {
        _originalUpdateWebSearchToggleBtn(fromToggleChange, wasEnabled);
    }
};

// ==================== 修复 app.js 缺失函数 ====================

// app.js 中 saveCustomProviderField 调用了 renderCustomProviderList 但未定义
if (typeof renderCustomProviderList !== 'function') {
    window.renderCustomProviderList = function () {};
}

// ==================== 初始化 ====================

// 注入UI
injectRefProviderUI();

// 重新绑定事件（因为setupCustomProviderEvents已经被patch了，需要重新调用）
// 但原始事件已经绑定过了，直接调用patched版本会重复绑定原始事件
// 所以只绑定新增的refProvider事件
const _refSelectBtn = document.getElementById('refProviderSelectBtn');
if (_refSelectBtn) {
    _refSelectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createBottomSheetPicker({
            items: refProviderOptions.map(o => ({ value: o.value, label: o.label })),
            activeValue: _refSelectBtn.dataset.value || '',
            onSelect: (item) => {
                const _refSelectText = document.getElementById('refProviderSelectText');
                if (_refSelectText) _refSelectText.textContent = item.label;
                _refSelectBtn.dataset.value = item.value;
                updateApiTypeDisabledState(item.value);
                saveCustomProviderField();
            },
        }).show();
    });
}

console.log('[custom-ref-provider.js] AI服务商配置参考功能已加载');
