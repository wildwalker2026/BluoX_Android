/**
 * buildbody.js — 发送逻辑（逐步重构中）
 * 依赖 app.js 中的全局变量和函数：messages, currentTopicId, generateMessageId(),
 * getLastVisibleMsgIdByRole(), saveMessages()
 */

/**
 * 将用户消息推入 messages 数组并持久化保存（串行等待）
 * @param {string|Array} content  - 消息内容（纯文本或多模态数组）
 * @param {string} displayContent - 用于界面展示的内容
 * @returns {Promise<object|null>} 创建的用户消息对象，失败返回 null
 */
async function pushUserMessage(content, displayContent) {
    const userMessageId = generateMessageId();
    const prevAiId = getLastVisibleMsgIdByRole('assistant');
    const now = Date.now();

    const userMessage = {
        id: userMessageId,
        role: 'user',
        content: content,
        displayContent: displayContent,
        timestamp: now,
        prevId: prevAiId
    };

    // 校验必填字段
    const missing = [];
    if (!userMessage.id) missing.push('id');
    if (!userMessage.role) missing.push('role');
    if (userMessage.content === undefined || userMessage.content === null || userMessage.content === '') missing.push('content');
    if (userMessage.displayContent === undefined || userMessage.displayContent === null) missing.push('displayContent');
    if (!userMessage.timestamp) missing.push('timestamp');
    // prevId：首条消息可为 null，其他不可
    if (messages.length > 0 && !userMessage.prevId) missing.push('prevId');

    if (missing.length > 0) {
        const errMsg = '❌ 消息字段缺失：' + missing.join(', ');
        console.error(errMsg);
        if (currentAiMessageDiv) {
            const messageContent = currentAiMessageDiv.querySelector('.message-content');
            if (messageContent) {
                messageContent.innerHTML = formatMessage(errMsg);
            }
        }
        return null;
    }

    messages.push(userMessage);
    try {
        await saveMessages(messages);
    } catch (e) {
        // 持久化失败：回滚内存 + 在当前 AI 气泡里报错
        messages.pop();
        console.error('用户消息保存失败:', e);
        const errMsg = '❌ 消息保存失败：' + (e.message || '存储空间不足');
        if (currentAiMessageDiv) {
            const messageContent = currentAiMessageDiv.querySelector('.message-content');
            if (messageContent) {
                messageContent.innerHTML = formatMessage(errMsg);
            }
        }
        return null;
    }

    return userMessage;
}

/**
 * 第二步：查找上下文
 * 检查缓存命中优化状态，返回标志位和实际轮数
 * @returns {{ useCacheOptimize: boolean, effectiveRounds: number }}
 */
function resolveContextConfig() {
    const useCacheOptimize = cacheOptimizeEnabled;

    let effectiveRounds;
    if (useCacheOptimize) {
        // 缓存命中优化模式：用 cacheOptimizeCount
        effectiveRounds = cacheOptimizeCount;
        // 如果是刷新回答或重新发送，用 count-1（保持与上次上传数量一致）
        if (skipNextCountUpdate) {
            effectiveRounds = Math.max(1, cacheOptimizeCount - 1);
        }
    } else {
        // 未开启缓存优化，用上下文限制
        effectiveRounds = contextLimit;
    }

    console.log('[上下文] cacheOptimizeEnabled:', useCacheOptimize,
        '| cacheOptimizeCount:', cacheOptimizeCount,
        '| skipNextCountUpdate:', skipNextCountUpdate,
        '| contextLimit:', contextLimit,
        '| effectiveRounds:', effectiveRounds);

    return { useCacheOptimize, effectiveRounds };
}
