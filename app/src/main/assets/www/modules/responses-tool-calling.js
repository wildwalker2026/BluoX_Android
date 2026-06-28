/**
 * Responses API Function Calling 适配层
 * 
 * 为千问(Qwen)和豆包(Doubao)的 Responses API 提供 Function Calling 格式适配。
 * Responses API 与 Chat Completions API 的差异：
 * 
 * 1. 工具定义：扁平化 {type, name, description, parameters} vs 嵌套 {type, function: {name, ...}}
 * 2. 响应解析：output[].type==="function_call" → {name, arguments, call_id} vs message.tool_calls[].function
 * 3. 结果回填：{type:"function_call_output", call_id, output} + previous_response_id vs {role:"tool", tool_call_id, content}
 * 4. API 端点：/responses vs /chat/completions
 */

// ==================== Provider 判断 ====================

/**
 * 判断当前服务商是否使用 Responses API 进行 Function Calling
 */
function isResponsesProvider() {
    return currentAIProvider === 'qwen' || currentAIProvider === 'doubao';
}

// ==================== 1. 工具定义适配 ====================

/**
 * 将 Chat Completions 格式的工具定义转换为 Responses API 扁平格式
 * Chat:     { type: "function", function: { name, description, parameters } }
 * Responses: { type: "function", name, description, parameters }
 * 
 * @param {Array} chatTools - getToolDefinitions() 返回的标准工具数组
 * @returns {Array} Responses API 格式的工具数组
 */
function convertToolsToResponsesFormat(chatTools) {
    if (!chatTools || chatTools.length === 0) return null;
    return chatTools.map(tool => {
        if (tool.type === 'function' && tool.function) {
            return {
                type: 'function',
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters
            };
        }
        return tool;
    });
}

/**
 * 获取 Responses API 格式的工具定义
 */
function getResponsesTools() {
    if (typeof getToolDefinitions !== 'function') return null;
    const chatTools = getToolDefinitions();
    const tools = convertToolsToResponsesFormat(chatTools);
    // 千问/豆包会把名为 web_search 的 function 当作内置搜索，改名避开
    if (tools) {
        for (const t of tools) {
            if (t.name === 'web_search') t.name = 'internet_search';
        }
    }
    return tools;
}

// ==================== 2. 响应解析适配 ====================

/**
 * 从 Responses API 的流式 chunk 中提取 tool_calls，转换为统一格式
 * Responses 流式格式：chunk.output[].type === "function_call" 或 chunk.type === "response.output_item.added"
 * 
 * @param {object} chunk - SSE data 解析后的 JSON
 * @returns {Array|null} 统一格式的 tool_calls: [{id, function:{name, arguments}}]
 */
function extractResponsesStreamToolCalls(chunk) {
    const results = [];
    
    // Responses API 流式事件格式
    // 方式1：chunk.type === "response.output_item.done" 且 output_item.type === "function_call"
    if (chunk.type === 'response.output_item.done' && chunk.item) {
        const item = chunk.item;
        if (item.type === 'function_call') {
            results.push({
                id: item.call_id || item.id || '',
                function: {
                    name: item.name || '',
                    arguments: item.arguments || ''
                }
            });
        }
    }
    
    // 方式2：chunk.output 数组（非流式或聚合流式）
    if (chunk.output && Array.isArray(chunk.output)) {
        for (const item of chunk.output) {
            if (item.type === 'function_call') {
                results.push({
                    id: item.call_id || item.id || '',
                    function: {
                        name: item.name || '',
                        arguments: item.arguments || ''
                    }
                });
            }
        }
    }
    
    // 方式3：流式增量 arguments（response.function_call_arguments.delta）
    if (chunk.type === 'response.function_call_arguments.delta') {
        // 增量参数，需要在外部累积，这里返回特殊标记
        if (chunk.delta || chunk.arguments) {
            return { _incremental: true, delta: chunk.delta || chunk.arguments || '' };
        }
    }
    
    // 方式4：response.output_item.added 事件，包含 function_call 的 name 和 call_id
    if (chunk.type === 'response.output_item.added' && chunk.item && chunk.item.type === 'function_call') {
        return {
            _itemAdded: true,
            id: chunk.item.call_id || chunk.item.id || '',
            name: chunk.item.name || ''
        };
    }
    
    return results.length > 0 ? results : null;
}

/**
 * 从 Responses API 的非流式响应中提取 tool_calls，转换为统一格式
 * 
 * @param {object} data - 完整的 JSON 响应
 * @returns {{content: string, reasoning: string|null, toolCalls: Array, responseId: string|null}}
 */
function parseResponsesNonStream(data) {
    let content = '';
    let reasoning = '';
    let toolCalls = [];
    let responseId = data.id || null;
    
    if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
            if (item.type === 'message' && item.content) {
                // 提取文本内容
                if (Array.isArray(item.content)) {
                    for (const c of item.content) {
                        if (c.type === 'output_text' && c.text) {
                            content += c.text;
                        }
                        // 推理内容
                        if (c.type === 'reasoning' && c.content) {
                            reasoning += c.content;
                        }
                    }
                } else if (typeof item.content === 'string') {
                    content += item.content;
                }
            }
            if (item.type === 'function_call') {
                const _name = item.name || '';
                toolCalls.push({
                    id: item.call_id || item.id || '',
                    function: {
                        // 入口转换：internet_search 转回 web_search
                        name: _name === 'internet_search' ? 'web_search' : _name,
                        arguments: item.arguments || ''
                    }
                });
            }
            // 推理内容（豆包格式：reasoning 类型的 output item）
            if (item.type === 'reasoning' && item.summary) {
                if (Array.isArray(item.summary)) {
                    reasoning += item.summary.map(s => s.text || '').join('');
                }
            }
        }
    }
    
    return { content, reasoning: reasoning || null, toolCalls, responseId };
}

// ==================== 3. 后续请求体构建 ====================

/**
 * 构建 Responses API 格式的后续请求体（工具结果回填）
 * 
 * @param {Array} messages - 完整消息数组（用于提取 tool 结果）
 * @param {string|null} previousResponseId - 上一轮的 response id
 * @param {Array} toolResults - 本轮工具执行结果 [{callId, output}]
 * @returns {object} Responses API 请求体
 */
function buildResponsesFollowupBody(messages, previousResponseId, toolResults) {
    const isQwen = currentAIProvider === 'qwen';
    const isDoubao = currentAIProvider === 'doubao';
    const input = [];

    if (isQwen) {
        // ===== 千问：不用 previous_response_id，每次发完整上下文 =====
        // 千问需要把 function_call 和 function_call_output 成对放入 input
        // 从 messages 中重建完整对话上下文
        for (const msg of messages) {
            if (msg.role === 'system') continue;
            if (msg.role === 'user') {
                // Responses API 要求 user 消息带 type:"message"
                const userContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                input.push({ type: 'message', role: 'user', content: userContent });
            } else if (msg.role === 'assistant') {
                // 千问 Responses API：只提取 tool_calls 转为 function_call 格式
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    for (const tc of msg.tool_calls) {
                        if (tc.function && tc.function.name) {
                            // 出口转换：web_search 改名为 internet_search
                            const _name = tc.function.name === 'web_search' ? 'internet_search' : tc.function.name;
                            input.push({
                                type: 'function_call',
                                name: _name,
                                arguments: typeof tc.function.arguments === 'string'
                                    ? tc.function.arguments
                                    : JSON.stringify(tc.function.arguments || {}),
                                call_id: tc.id
                            });
                        }
                    }
                }
            } else if (msg.role === 'tool') {
                const outputContent = typeof msg.content === 'string'
                    ? msg.content
                    : JSON.stringify(msg.content);
                input.push({
                    type: 'function_call_output',
                    call_id: msg.tool_call_id,
                    output: outputContent
                });
            }
        }
        console.log('[ResponsesToolCalling] 千问 input:', JSON.stringify(input, null, 2));
    } else {
        // ===== 豆包：用 previous_response_id，只发增量 =====
        if (toolResults && toolResults.length > 0) {
            for (const result of toolResults) {
                const outputContent = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
                input.push({
                    type: 'function_call_output',
                    call_id: result.callId,
                    output: outputContent
                });
            }
        }
    }

    const body = {
        model: selectedModel,
        input: input,
        stream: streamOutputEnabled
    };

    if (isDoubao) {
        // 豆包：用 previous_response_id + store
        body.store = true;
        if (previousResponseId) {
            body.previous_response_id = previousResponseId;
            // 豆包限制：有 previous_response_id 时不能传 tools
        } else {
            const tools = getResponsesTools();
            if (tools) body.tools = tools;
        }
        if (deepThinkingEnabled) {
            body.thinking = { type: 'enabled' };
            body.reasoning = { effort: doubaoReasoningEffort };
        } else {
            body.thinking = { type: 'disabled' };
        }
    }

    if (isQwen) {
        // 千问：每次都传 tools，不用 previous_response_id
        const tools = getResponsesTools();
        if (tools) body.tools = tools;
        body.enable_thinking = deepThinkingEnabled;
        if (thinkingBudget !== 'auto') {
            body.thinking_budget = parseInt(thinkingBudget);
        } else {
            body.thinking_budget = 'auto';
        }
        if (streamOutputEnabled) {
            body.stream_options = { include_usage: true };
        }
    }

    return body;
}

// ==================== 4. API 端点 ====================

/**
 * 获取 Responses API 的 Function Calling 端点
 */
function getResponsesEndpoint() {
    // 千问和豆包的 Responses API 端点都是 /responses
    // getAPIEndpoint() 在 app.js 中根据 provider 返回基础 URL
    // 这里需要确保走 /responses 而非 /chat/completions
    if (typeof getAPIEndpoint === 'function') {
        const base = getAPIEndpoint();
        // 如果已经是 /responses 端点，直接返回
        if (base.includes('/responses')) return base;
        // 替换 /chat/completions 为 /responses
        return base.replace('/chat/completions', '/responses');
    }
    return null;
}

// ==================== 流式响应解析（后续轮次） ====================

/**
 * 解析 Responses API 流式后续响应
 * 与 handleFollowupResponse 配合使用，处理 Responses 格式的 SSE
 * 
 * @param {Response} response - fetch Response 对象
 * @param {number} round - 当前轮次
 * @returns {Promise<{content: string, reasoning: string|null, toolCalls: Array, responseId: string|null}>}
 */
async function handleResponsesFollowupResponse(response, round) {
    let content = '';
    let reasoning = '';
    let toolCalls = [];
    let responseId = null;
    let bubbleCreated = false;
    
    // 用于累积流式 function_call 的参数
    let currentCallId = '';
    let currentCallName = '';
    let currentCallArgs = '';
    
    if (streamOutputEnabled) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        
        while (true) {
            // 用户点击了停止生成，中止流式读取
            if (!abortController || abortController.signal.aborted) break;
            let readResult;
            try {
                readResult = await Promise.race([
                    reader.read(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('流式读取超时')), 300000))
                ]);
            } catch (readErr) {
                console.error('[ResponsesToolCalling] 流式读取异常:', readErr);
                break;
            }
            const { done, value } = readResult;
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const data = trimmed.substring(5).trim();
                if (data === '[DONE]') continue;
                try {
                    const chunk = JSON.parse(data);
                    if (chunk.error) throw new Error(chunk.error.message);
                    
                    // 提取 responseId（千问在 chunk.response.id，豆包在 chunk.id）
                    const _respId = chunk.response?.id || chunk.id;
                    if (_respId) responseId = _respId;
                    
                    // 更新 streaming 计数器
                    if (typeof updateStreamingPlaceholder === 'function') {
                        updateStreamingPlaceholder((_streamingCounter || 0) + 1);
                    }
                    
                    // 文本增量
                    if (chunk.type === 'response.output_text.delta' && chunk.delta) {
                        if (!bubbleCreated) {
                            currentAiContent = '';
                            currentThinkingContent = '';
                            currentAiMessageDiv = appendMessage('ai', '正在思考…', true, false, Date.now());
                            bubbleCreated = true;
                        }
                        content += chunk.delta;
                        appendToLastMessage(chunk.delta);

                    }
                    
                    // 推理增量
                    if (chunk.type === 'response.reasoning.delta' || 
                        (chunk.type === 'response.reasoning_summary_text.delta' && chunk.delta)) {
                        if (!bubbleCreated) {
                            currentAiContent = '';
                            currentThinkingContent = '';
                            currentAiMessageDiv = appendMessage('ai', '正在思考…', true, false, Date.now());
                            bubbleCreated = true;
                        }
                        reasoning += chunk.delta;
                        updateThinking(chunk.delta);
                    }
                    
                    // function_call 开始
                    if (chunk.type === 'response.output_item.added' && chunk.item && chunk.item.type === 'function_call') {
                        currentCallId = chunk.item.call_id || chunk.item.id || '';
                        currentCallName = chunk.item.name || '';
                        currentCallArgs = '';
                    }
                    
                    // function_call 参数增量
                    if (chunk.type === 'response.function_call_arguments.delta') {
                        currentCallArgs += (chunk.delta || '');
                    }
                    
                    // function_call 完成
                    if (chunk.type === 'response.output_item.done' && chunk.item && chunk.item.type === 'function_call') {
                        const item = chunk.item;
                        const _name = item.name || currentCallName;
                        toolCalls.push({
                            id: item.call_id || item.id || currentCallId,
                            function: {
                                // 入口转换：internet_search 转回 web_search
                                name: _name === 'internet_search' ? 'web_search' : _name,
                                arguments: item.arguments || currentCallArgs
                            }
                        });
                        currentCallId = '';
                        currentCallName = '';
                        currentCallArgs = '';
                    }
                    
                } catch (e) {
                    if (e instanceof Error && e.message) throw e;
                }
            }
        }
        
        // 流式完成后折叠思考内容
        if (reasoning && currentAiMessageDiv) {
            const thinkingDiv = currentAiMessageDiv.querySelector('.thinking-content');
            if (thinkingDiv) {
                toggleThinkingCollapse(currentAiMessageDiv, thinkingDiv, true);
            }
        }
        // 中间气泡内容输出完成，填充运行时间
        if (currentAiMessageDiv) {
            fillMidBubbleTooltip(currentAiMessageDiv);
        }
    } else {
        // 非流式
        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Responses API 响应解析失败: ${e.message}`);
        }
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        
        const parsed = parseResponsesNonStream(data);
        content = parsed.content;
        reasoning = parsed.reasoning || '';
        toolCalls = parsed.toolCalls;
        responseId = parsed.responseId;
        
        // 创建消息气泡
        const displayText = content || '正在思考…';
        if (reasoning) {
            const newBubble = appendMessage('ai', displayText, true, false, Date.now());
            prependThinking(newBubble, reasoning);
        } else {
            appendMessage('ai', displayText, true, false, Date.now());
        }
    }
    
    const validToolCalls = toolCalls.filter(tc => tc && tc.function?.name);
    console.log(`[ResponsesToolCalling] follow-up 第${round + 1}轮: 文本${content.length}字, tool_calls ${validToolCalls.length}个, responseId: ${responseId}`);
    return { content, reasoning: reasoning || null, toolCalls: validToolCalls, responseId };
}

// ==================== 首轮流式收集（供 app.js 调用） ====================

/**
 * 流式累积状态（首轮）
 */
let _streamCallId = '';
let _streamCallName = '';
let _streamCallArgs = '';

/**
 * 收集 Responses API 首轮流式 function_call，累积到 toolCallsBuffer
 * 在 app.js 的流式解析中调用
 * 
 * @param {object} chunk - SSE data 解析后的 JSON
 */
function collectResponsesStreamToolCalls(chunk) {
    // function_call 开始：记录 call_id 和 name
    if (chunk.type === 'response.output_item.added' && chunk.item && chunk.item.type === 'function_call') {
        _streamCallId = chunk.item.call_id || chunk.item.id || '';
        _streamCallName = chunk.item.name || '';
        _streamCallArgs = '';
    }
    
    // arguments 增量
    if (chunk.type === 'response.function_call_arguments.delta') {
        _streamCallArgs += (chunk.delta || '');
    }
    
    // function_call 完成：写入 toolCallsBuffer
    if (chunk.type === 'response.output_item.done' && chunk.item && chunk.item.type === 'function_call') {
        const item = chunk.item;
        const callId = item.call_id || item.id || _streamCallId;
        const name = item.name || _streamCallName;
        const args = item.arguments || _streamCallArgs;
        
        if (name) {
            // 入口转换：internet_search 转回 web_search
            const finalName = name === 'internet_search' ? 'web_search' : name;
            toolCallsBuffer.push({
                id: callId,
                function: { name: finalName, arguments: args }
            });
            console.log('[ResponsesToolCalling] 首轮收集 function_call:', name, 'call_id:', callId);
        }
        
        // 重置累积状态
        _streamCallId = '';
        _streamCallName = '';
        _streamCallArgs = '';
    }
}

/**
 * 重置流式累积状态
 */
function resetResponsesStreamState() {
    _streamCallId = '';
    _streamCallName = '';
    _streamCallArgs = '';
}