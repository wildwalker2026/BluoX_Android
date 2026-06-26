// ==================== 知识库文本处理函数 ====================

// 分块配置
const CHUNK_CONFIG = {
    maxChunkSize: 900,      // 最大块大小
    overlapSize: 100,       // 重叠窗口大小（避免关键信息被切断）
    minChunkSize: 50        // 最小块大小
};

// 尝试解析JSON对话记录，提取有意义的对话内容
function tryParseJsonConversation(text) {
    // 快速检测是否可能是JSON
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
    }

    try {
        const data = JSON.parse(trimmed);

        // 检测是否为对话记录格式（CNAIChat导出格式）
        if (data.messages && Array.isArray(data.messages)) {
            const chunks = [];
            const agentName = data.agent?.name || data.topic?.name || '对话';

            // 提取对话消息
            for (let i = 0; i < data.messages.length; i++) {
                const msg = data.messages[i];
                if (!msg.content || typeof msg.content !== 'string') continue;

                // 跳过太短的消息
                if (msg.content.trim().length < CHUNK_CONFIG.minChunkSize) continue;

                // 构建对话文本，包含角色信息
                const roleLabel = msg.role === 'user' ? '用户' :
                                  msg.role === 'assistant' ? '助手' : msg.role;
                const chunkText = `【${roleLabel}】\n${msg.content.trim()}`;

                chunks.push({
                    text: chunkText,
                    keywords: extractKeywords(msg.content),
                    title: `${agentName} - 消息${i + 1}`,
                    level: 1,
                    role: msg.role,
                    messageIndex: i
                });
            }

            return chunks.length > 0 ? chunks : null;
        }

        // 检测是否为消息数组格式
        if (Array.isArray(data) && data.length > 0 && data[0].role && data[0].content) {
            const chunks = [];

            for (let i = 0; i < data.length; i++) {
                const msg = data[i];
                if (!msg.content || typeof msg.content !== 'string') continue;
                if (msg.content.trim().length < CHUNK_CONFIG.minChunkSize) continue;

                const roleLabel = msg.role === 'user' ? '用户' :
                                  msg.role === 'assistant' ? '助手' : msg.role;
                const chunkText = `【${roleLabel}】\n${msg.content.trim()}`;

                chunks.push({
                    text: chunkText,
                    keywords: extractKeywords(msg.content),
                    title: `消息${i + 1}`,
                    level: 1,
                    role: msg.role,
                    messageIndex: i
                });
            }

            return chunks.length > 0 ? chunks : null;
        }

        return null;
    } catch (e) {
        // 解析失败，不是有效的JSON
        return null;
    }
}

// 改进的文本分块函数（支持重叠窗口和标题分割）
function chunkText(text, maxChunkSize = CHUNK_CONFIG.maxChunkSize) {
    const chunks = [];

    // 检测是否为JSON格式的对话记录
    const jsonChunks = tryParseJsonConversation(text);
    if (jsonChunks && jsonChunks.length > 0) {
        console.log('检测到JSON对话记录，按消息分块，共', jsonChunks.length, '条');
        return jsonChunks;
    }

    // 先尝试按标题/章节分割（Markdown风格的标题）
    const sections = splitBySections(text);

    for (const section of sections) {
        const { title, content, level } = section;

        // 如果内容较短，直接作为一个块
        if (content.length <= maxChunkSize) {
            if (content.trim().length >= CHUNK_CONFIG.minChunkSize) {
                chunks.push({
                    text: title ? `${title}\n${content}` : content,
                    keywords: extractKeywords(content),
                    title: title || null,
                    level: level
                });
            }
            continue;
        }

        // 内容较长，按段落分割并添加重叠
        const paragraphChunks = splitWithOverlap(content, maxChunkSize, title, level);
        chunks.push(...paragraphChunks);
    }

    return chunks;
}

// 按标题/章节分割文本
function splitBySections(text) {
    const sections = [];

    // 匹配 Markdown 标题和常见文档标题格式
    // 支持: # 标题, ## 标题, 一、标题, 1. 标题, 第一章, 第一条 等
    // 法律文档层级：编(1) > 章(2) > 节(3) > 条(4)
    const titlePatterns = [
        /^(#{1,6})\s+(.+)$/gm,                           // Markdown 标题
        /^(第[一二三四五六七八九十百千万零〇]+编)/gm,        // 编级标题：第一编、第二编（最高层级）
        /^(第[一二三四五六七八九十百千万零〇]+章)/gm,        // 章级标题：第一章
        /^(第[一二三四五六七八九十百千万零〇]+节)/gm,        // 节级标题：第一节
        /^(第[一二三四五六七八九十百千万零〇百]+条)/gm,      // 条款：第一条、第一百条（法律条文核心单元）
        /^([一二三四五六七八九十]+[、.．]\s*.+)$/gm,         // 中文序号
        /^(\d+[、.．]\s*.+)$/gm,                           // 数字序号标题
        /^([（(]\d+[)）]\s*.+)$/gm                         // 括号序号
    ];

    // 尝试按标题分割
    let hasTitles = false;
    const lines = text.split('\n');
    let currentSection = { title: null, content: '', level: 0 };
    let currentContent = [];

    for (const line of lines) {
        let isTitle = false;
        let titleText = null;
        let titleLevel = 0;

        // 检查是否为标题
        for (let i = 0; i < titlePatterns.length; i++) {
            const pattern = titlePatterns[i];
            pattern.lastIndex = 0; // 重置正则状态
            const match = pattern.exec(line);
            if (match && line.trim().length < 100) { // 标题通常较短
                isTitle = true;
                titleText = line.trim();

                // 根据匹配模式设置层级
                if (match[1] && match[1].startsWith('#')) {
                    titleLevel = match[1].length; // Markdown 标题级别
                } else if (/^第.+编/.test(line)) {
                    titleLevel = 1; // 编级（最高级）
                } else if (/^第.+章/.test(line)) {
                    titleLevel = 2; // 章级
                } else if (/^第.+节/.test(line)) {
                    titleLevel = 3; // 节级
                } else if (/^第.+条/.test(line)) {
                    titleLevel = 4; // 条款级（法律条文核心单元）
                } else {
                    titleLevel = 1;
                }
                hasTitles = true;
                break;
            }
        }

        if (isTitle) {
            // 保存当前段落
            if (currentContent.length > 0) {
                currentSection.content = currentContent.join('\n').trim();
                if (currentSection.content) {
                    sections.push({ ...currentSection });
                }
            }
            // 开始新段落
            currentSection = { title: titleText, content: '', level: titleLevel };
            currentContent = [];
        } else {
            currentContent.push(line);
        }
    }

    // 保存最后一个段落
    if (currentContent.length > 0) {
        currentSection.content = currentContent.join('\n').trim();
        if (currentSection.content) {
            sections.push({ ...currentSection });
        }
    }

    // 如果没有识别到标题，返回整个文本作为一个段落
    if (!hasTitles || sections.length === 0) {
        sections.push({ title: null, content: text.trim(), level: 0 });
    }

    return sections;
}

// 带重叠窗口的内容分割
function splitWithOverlap(content, maxChunkSize, title = null, level = 0) {
    const chunks = [];
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = '';
    let chunkIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i].trim();
        if (!paragraph) continue;

        // 如果单个段落超过最大长度，按句子分割
        if (paragraph.length > maxChunkSize) {
            // 先保存当前积累的内容
            if (currentChunk.length >= CHUNK_CONFIG.minChunkSize) {
                chunks.push(createChunk(currentChunk, title, level, chunkIndex++));
                // 添加重叠内容
                currentChunk = getOverlapText(currentChunk, CHUNK_CONFIG.overlapSize);
            }

            // 分割长段落
            const sentenceChunks = splitLongParagraph(paragraph, maxChunkSize);
            for (let j = 0; j < sentenceChunks.length; j++) {
                const sentenceChunk = sentenceChunks[j];
                if (j === 0 && currentChunk.length + sentenceChunk.length <= maxChunkSize) {
                    currentChunk += (currentChunk ? '\n' : '') + sentenceChunk;
                } else {
                    if (currentChunk.length >= CHUNK_CONFIG.minChunkSize) {
                        chunks.push(createChunk(currentChunk, title, level, chunkIndex++));
                        currentChunk = getOverlapText(currentChunk, CHUNK_CONFIG.overlapSize);
                    }
                    currentChunk = sentenceChunk;
                }
            }
        } else {
            // 检查是否需要创建新块
            if (currentChunk.length + paragraph.length + 1 > maxChunkSize) {
                if (currentChunk.length >= CHUNK_CONFIG.minChunkSize) {
                    chunks.push(createChunk(currentChunk, title, level, chunkIndex++));
                    // 添加重叠内容
                    currentChunk = getOverlapText(currentChunk, CHUNK_CONFIG.overlapSize);
                }
            }
            currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        }
    }

    // 保存最后一个块
    if (currentChunk.length >= CHUNK_CONFIG.minChunkSize) {
        chunks.push(createChunk(currentChunk, title, level, chunkIndex));
    }

    return chunks;
}

// 分割长段落（按句子）
function splitLongParagraph(paragraph, maxChunkSize) {
    const chunks = [];
    // 支持中英文句子分割
    const sentences = paragraph.split(/(?<=[。！？.!?])\s*/g);
    let currentChunk = '';

    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length <= maxChunkSize) {
            currentChunk += sentence;
        } else {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            // 如果单个句子超长，强制分割
            if (sentence.length > maxChunkSize) {
                const forcedChunks = splitBySize(sentence, maxChunkSize);
                chunks.push(...forcedChunks);
                currentChunk = '';
            } else {
                currentChunk = sentence;
            }
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

// 强制按大小分割
function splitBySize(text, maxSize) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxSize) {
        chunks.push(text.substring(i, i + maxSize));
    }
    return chunks;
}

// 获取重叠文本（从末尾提取）
function getOverlapText(text, overlapSize) {
    if (text.length <= overlapSize) return '';
    // 尝试从句子边界开始
    const lastSentenceEnd = text.lastIndexOf('。', text.length - overlapSize);
    if (lastSentenceEnd > text.length / 2) {
        return text.substring(lastSentenceEnd + 1).trim();
    }
    return text.substring(text.length - overlapSize).trim();
}

// 创建块对象
function createChunk(text, title, level, index) {
    return {
        text: text.trim(),
        keywords: extractKeywords(text),
        title: title,
        level: level,
        index: index
    };
}

// 改进的关键词提取配置
const KEYWORD_CONFIG = {
    maxKeywords: 30,          // 最大关键词数量
    minWordLength: 2,         // 最小词长度
    maxWordLength: 6          // 最大词长度（提取时）
};

// 扩展的中文停用词列表
const STOP_WORDS = new Set([
    // 常用虚词
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
    '自己', '这', '那', '他', '她', '它', '们', '这个', '那个', '什么', '怎么',
    '可以', '可能', '应该', '需要', '能', '想', '让', '被', '把', '给', '从', '为',
    // 常用动词/形容词
    '做', '用', '对', '来', '又', '但', '如', '与', '以', '及', '或', '而', '则',
    '因', '所', '之', '其', '者', '等', '时', '地', '得', '过', '起', '来', '去',
    // 代词
    '我们', '你们', '他们', '她们', '咱们', '大家', '哪', '哪位', '哪里', '那儿',
    '这里', '那里', '怎样', '如何', '多少', '几个', '某种', '某些', '某个',
    // 常见无意义词
    '分析', '一下', '帮我', '请', '帮', '里', '中', '知识库', '里面的',
    '时候', '然后', '如果', '因为', '所以', '虽然', '但是', '而且', '或者',
    '这样', '那样', '怎样', '这么', '那么', '怎么', '多么', '非常', '特别',
    '已经', '正在', '将要', '曾经', '一直', '还是', '或者', '并且', '不仅',
    '只是', '只有', '就是', '不是', '还是', '也是', '都是', '还是', '或是'
]);

// 同义词词典（用于扩展检索）
const SYNONYMS = {
    '手机': ['电话', '移动电话', '智能机', 'iPhone', '安卓'],
    '电脑': ['计算机', 'PC', '笔记本', '台式机'],
    '程序': ['代码', '软件', '应用', 'APP'],
    '公司': ['企业', '机构', '组织'],
    '问题': ['疑问', '难题', '困惑'],
    '方法': ['方式', '办法', '途径', '手段'],
    '数据': ['资料', '信息', '内容'],
    '系统': ['平台', '框架', '架构'],
    '用户': ['客户', '使用者', '会员'],
    '设置': ['配置', '设定', '选项'],
    '文件': ['档案', '文档', '资料'],
    '网络': ['互联网', '网路', '局域网'],
    '服务器': ['主机', '服务端', '后端'],
    '数据库': ['DB', '存储', '数据存储'],
    '接口': ['API', '界面', '端口']
};

// 提取关键词（改进版：支持更智能的中文分词）
function extractKeywords(text) {
    if (!text || typeof text !== 'string') return [];

    // 移除标点符号，保留中英文和数字
    const cleanText = text.replace(/[，。！？、；：""''（）【】《》\s,.!?;:'"()\[\]<>\/\\@#$%^&*+=|~`]/g, ' ');

    const keywords = [];
    const keywordScores = new Map(); // 用于记录关键词权重

    // 1. 提取中文词汇（使用N-gram + 词典匹配）
    const chineseText = cleanText.match(/[\u4e00-\u9fa5]+/g) || [];
    const chineseKeywords = extractChineseKeywords(chineseText.join(' '));
    for (const kw of chineseKeywords) {
        keywordScores.set(kw, (keywordScores.get(kw) || 0) + 1);
    }

    // 2. 提取英文单词和缩写
    const englishWords = cleanText.match(/[a-zA-Z]{2,}/gi) || [];
    for (const word of englishWords) {
        const lowerWord = word.toLowerCase();
        if (!isCommonEnglishStopWord(lowerWord)) {
            keywordScores.set(lowerWord, (keywordScores.get(lowerWord) || 0) + 1);
        }
    }

    // 3. 提取专业术语（大写缩写、驼峰命名等）
    const technicalTerms = extractTechnicalTerms(text);
    for (const term of technicalTerms) {
        keywordScores.set(term, (keywordScores.get(term) || 0) + 2); // 专业术语权重更高
    }

    // 4. 提取数字和版本号
    const numbers = cleanText.match(/\d+(?:\.\d+)*/g) || [];
    for (const num of numbers) {
        keywordScores.set(num, (keywordScores.get(num) || 0) + 1);
    }

    // 5. 按权重排序并限制数量
    const sortedKeywords = [...keywordScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, KEYWORD_CONFIG.maxKeywords)
        .map(([kw]) => kw);

    return sortedKeywords;
}

// 提取中文关键词（使用N-gram方法）
function extractChineseKeywords(text) {
    const keywords = [];

    // 使用滑动窗口提取2-6字的词组
    for (let len = KEYWORD_CONFIG.maxWordLength; len >= KEYWORD_CONFIG.minWordLength; len--) {
        for (let i = 0; i <= text.length - len; i++) {
            const word = text.substring(i, i + len);
            if (!STOP_WORDS.has(word) && isValidChineseWord(word)) {
                keywords.push(word);
            }
        }
    }

    // 提取单字（仅当文本很短时）
    if (keywords.length === 0 && text.length <= 20) {
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (!STOP_WORDS.has(char) && /[\u4e00-\u9fa5]/.test(char)) {
                keywords.push(char);
            }
        }
    }

    return [...new Set(keywords)];
}

// 检查是否为有效的中文词
function isValidChineseWord(word) {
    // 检查是否全为汉字
    if (!/^[\u4e00-\u9fa5]+$/.test(word)) return false;

    // 过滤掉常见的无意义组合
    const invalidPatterns = [
        /^(这个|那个|什么|怎么|怎样|如何|如果|因为|所以|虽然|但是)$/,
        /^(可以|可能|应该|需要|能够|想要|觉得|认为|知道|看到)$/,
        /^(已经|正在|将要|曾经|一直|还是|或者|并且|不仅|只是)$/
    ];

    for (const pattern of invalidPatterns) {
        if (pattern.test(word)) return false;
    }

    return true;
}

// 常见英文停用词
const ENGLISH_STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
    'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
    'where', 'when', 'why', 'how', 'all', 'each', 'every', 'any', 'some', 'no',
    'i', 'me', 'my', 'myself', 'we', 'us', 'our', 'ours', 'ourselves',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves'
]);

function isCommonEnglishStopWord(word) {
    return ENGLISH_STOP_WORDS.has(word.toLowerCase());
}

// 提取专业术语（大写缩写、驼峰命名等）
function extractTechnicalTerms(text) {
    const terms = [];

    // 全大写缩写（如 API, HTTP, JSON）
    const abbreviations = text.match(/\b[A-Z]{2,}\b/g) || [];
    terms.push(...abbreviations);

    // 驼峰命名（如 getUserInfo, XMLHttpRequest）
    const camelCase = text.match(/\b[a-z]+[A-Z][a-zA-Z]*\b/g) || [];
    terms.push(...camelCase);

    // 带连字符的术语（如 user-info, content-type）
    const hyphenated = text.match(/\b[a-zA-Z]+-[a-zA-Z-]+\b/gi) || [];
    terms.push(...hyphenated.map(t => t.toLowerCase()));

    // 带点的版本号或域名（如 v1.0.0, example.com）
    const dotted = text.match(/\b[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)+\b/g) || [];
    terms.push(...dotted);

    return [...new Set(terms)];
}

// 获取关键词的同义词扩展
function getSynonyms(keyword) {
    const result = [keyword];

    // 检查直接匹配
    if (SYNONYMS[keyword]) {
        result.push(...SYNONYMS[keyword]);
    }

    // 检查是否为某个同义词列表中的词
    for (const [main, syns] of Object.entries(SYNONYMS)) {
        if (syns.includes(keyword) && !result.includes(main)) {
            result.push(main);
        }
    }

    return result;
}

// 搜索知识库（改进版：TF-IDF评分 + 同义词扩展 + 多片段返回）
async function searchKnowledgeBase(query, maxResults = 3) {
    if (!query || typeof query !== 'string') return [];

    let documents = await getAllKnowledgeDocuments();
    console.log('知识库检索 - 文档数量:', documents.length, '文档列表:', documents.map(d => d.name));

    // 如果指定了特定文档，只搜索该文档
    if (selectedKnowledgeDocId !== null) {
        documents = documents.filter(doc => doc.id === selectedKnowledgeDocId);
        console.log('知识库检索 - 指定文档:', selectedKnowledgeDocId, '过滤后文档数量:', documents.length);
    }

    if (documents.length === 0) return [];

    // 提取查询关键词
    const queryKeywords = extractKeywords(query);
    console.log('知识库检索 - 提取关键词:', queryKeywords);

    // 扩展查询关键词（包含同义词）
    const expandedKeywords = new Set();
    for (const keyword of queryKeywords) {
        expandedKeywords.add(keyword.toLowerCase());
        const synonyms = getSynonyms(keyword);
        for (const syn of synonyms) {
            expandedKeywords.add(syn.toLowerCase());
        }
    }
    console.log('知识库检索 - 扩展关键词:', [...expandedKeywords]);

    // 预处理用户查询（移除标点）
    const cleanQuery = query
        .replace(/[，。！？、；：""''（）【】《》\s,.!?;:'"()\[\]<>]/g, '')
        .toLowerCase();

    // 计算文档频率（用于 TF-IDF）
    const documentFrequency = new Map();
    let totalChunks = 0;

    for (const doc of documents) {
        if (!doc.chunks) continue;
        for (const chunk of doc.chunks) {
            totalChunks++;
            const chunkKeywords = new Set(chunk.keywords || []);
            for (const kw of chunkKeywords) {
                documentFrequency.set(kw, (documentFrequency.get(kw) || 0) + 1);
            }
        }
    }

    // 收集所有候选片段
    const allCandidates = [];

    // 在每个文档的每个块中搜索
    for (const doc of documents) {
        if (!doc.chunks) {
            console.log('文档无chunks:', doc.name);
            continue;
        }

        for (const chunk of doc.chunks) {
            const scoreResult = calculateChunkScore(
                chunk,
                queryKeywords,
                expandedKeywords,
                cleanQuery,
                documentFrequency,
                totalChunks
            );

            if (scoreResult.score > 0) {
                allCandidates.push({
                    text: chunk.text,
                    docName: doc.name,
                    score: scoreResult.score,
                    matchDetails: scoreResult.details,
                    title: chunk.title || null
                });
            }
        }
    }

    // 按得分排序
    allCandidates.sort((a, b) => b.score - a.score);

    // 输出前5名评分详情
    console.log('=== 评分前5名 ===');
    allCandidates.slice(0, 5).forEach((item, index) => {
        console.log(`第${index + 1}名 总分:${item.score.toFixed(2)} 整句:${item.matchDetails.fullMatch} 短语:${item.matchDetails.phraseMatch} 关键词:${item.matchDetails.exactMatch} 次数:${item.matchDetails.keywordMatch} 同义词:${item.matchDetails.synonymMatch}`);
    });

    // 去重：同一文档只保留最佳匹配（可配置）
    const seenDocs = new Set();
    const finalResults = [];

    for (const candidate of allCandidates) {
        // 如果文档未出现过，或者结果数未达上限
        if (!seenDocs.has(candidate.docName) || finalResults.length < maxResults) {
            // 检查是否与已选片段重叠过多
            let isDuplicate = false;
            for (const existing of finalResults) {
                if (existing.docName === candidate.docName &&
                    calculateTextOverlap(existing.text, candidate.text) > 0.7) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) {
                finalResults.push(candidate);
                seenDocs.add(candidate.docName);
            }
        }
        if (finalResults.length >= maxResults) break;
    }

    console.log('最终检索结果:', finalResults.length, '个片段');
    return finalResults;
}

// 计算块的匹配得分（TF-IDF + 多种匹配策略）
function calculateChunkScore(chunk, queryKeywords, expandedKeywords, cleanQuery, documentFrequency, totalChunks) {
    let score = 0;
    const details = {
        exactMatch: 0,
        keywordMatch: 0,
        synonymMatch: 0,
        phraseMatch: 0,
        tfidfScore: 0,
        fullMatch: 0
    };

    const lowerText = chunk.text.toLowerCase();
    const chunkKeywords = chunk.keywords || [];

    // 0. 整句完全匹配（优先级最高）
    if (cleanQuery.length >= 3 && lowerText.includes(cleanQuery)) {
        details.fullMatch = cleanQuery.length * 12;  // 整句完全匹配，每个字8分
    }

    // 1. 短语匹配（用户输入的连续片段）
    for (let len = Math.min(cleanQuery.length, 15); len >= 3; len--) {
        for (let i = 0; i <= cleanQuery.length - len; i++) {
            const subStr = cleanQuery.substring(i, i + len);
            if (lowerText.includes(subStr)) {
                // 长短语权重更高，使用递减权重避免重复计分
                details.phraseMatch += len * 2;
            }
        }
    }

    // 2. 关键词匹配（使用 TF-IDF）
    for (const keyword of queryKeywords) {
        const lowerKeyword = keyword.toLowerCase();

        // 完全匹配
        if (lowerText.includes(lowerKeyword)) {
            details.exactMatch += 20;

            // 计算出现次数
            const matches = (lowerText.match(new RegExp(escapeRegex(lowerKeyword), 'g')) || []).length;

            // TF-IDF 计算
            const tf = matches / (chunk.text.length / 100); // 词频（归一化）
            const df = documentFrequency.get(lowerKeyword) || 1;
            const idf = Math.log(totalChunks / df);
            const tfidf = tf * idf * 10;

            details.tfidfScore += tfidf;
            details.keywordMatch += matches * 5;
        }

        // 同义词匹配
        const synonyms = getSynonyms(keyword);
        for (const syn of synonyms) {
            if (syn.toLowerCase() !== lowerKeyword && lowerText.includes(syn.toLowerCase())) {
                details.synonymMatch += 10;
            }
        }

        // 块关键词匹配
        for (const chunkKw of chunkKeywords) {
            const lowerChunkKw = chunkKw.toLowerCase();
            if (lowerChunkKw === lowerKeyword) {
                score += 15;
            } else if (lowerChunkKw.includes(lowerKeyword) || lowerKeyword.includes(lowerChunkKw)) {
                score += 8;
            }
        }
    }

    // 3. 标题匹配（如果块有标题且匹配查询）
    if (chunk.title) {
        const lowerTitle = chunk.title.toLowerCase();
        for (const keyword of queryKeywords) {
            if (lowerTitle.includes(keyword.toLowerCase())) {
                score += 25; // 标题匹配权重高
            }
        }
    }

    // 4. 位置权重（匹配出现在开头更重要）
    const firstMatchIndex = Math.min(
        ...queryKeywords.map(kw => {
            const idx = lowerText.indexOf(kw.toLowerCase());
            return idx >= 0 ? idx : Infinity;
        })
    );
    if (firstMatchIndex < 100) {
        score += (100 - firstMatchIndex) / 10;
    }

    // 汇总得分
    score += details.fullMatch;
    score += details.phraseMatch;
    score += details.keywordMatch;
    score += details.synonymMatch;
    //score += details.tfidfScore;
    score += details.exactMatch;

    return { score, details };
}

// 计算两个文本的重叠度
function calculateTextOverlap(text1, text2) {
    if (!text1 || !text2) return 0;

    const words1 = new Set(text1.split(/\s+/));
    const words2 = new Set(text2.split(/\s+/));

    let intersection = 0;
    for (const word of words1) {
        if (words2.has(word)) intersection++;
    }

    return intersection / Math.min(words1.size, words2.size);
}

// 转义正则特殊字符
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== 向量检索功能 ====================

// 加载嵌入模型
async function loadEmbeddingModel() {
    if (embeddingModel) return embeddingModel;
    if (vectorSearchAvailable === false) return null; // 已确认不可用，直接返回
    if (embeddingModelLoading) {
        // 等待加载完成
        while (embeddingModelLoading) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return embeddingModel;
    }

    embeddingModelLoading = true;
    console.log('开始加载嵌入模型...');

    // 显示加载进度弹窗
    let progressOverlay = document.getElementById('modelLoadingOverlay');
    if (!progressOverlay) {
        progressOverlay = document.createElement('div');
        progressOverlay.id = 'modelLoadingOverlay';
        progressOverlay.className = 'model-loading-overlay';
        progressOverlay.innerHTML = `
            <div class="model-loading-modal">
                <div class="model-loading-title">正在加载嵌入模型</div>
                <div class="model-loading-info">首次加载约需下载 23MB 模型文件</div>
                <div class="model-loading-bar-container">
                    <div class="model-loading-bar" id="modelLoadingBar"></div>
                </div>
                <div class="model-loading-percent" id="modelLoadingPercent">0%</div>
            </div>
        `;
        document.body.appendChild(progressOverlay);
    } else {
        progressOverlay.style.display = 'flex';
        document.getElementById('modelLoadingBar').style.width = '0%';
        document.getElementById('modelLoadingPercent').textContent = '0%';
    }

    try {
        // 懒加载 Transformers.js
        await ensureTransformers();

        // 检查本地 Transformers.js 是否已加载
        if (!window.Transformers || !window.Transformers.pipeline) {
            throw new Error('Transformers.js 未加载');
        }

        const { pipeline, env } = window.Transformers;

        // 配置环境 - 使用 hf-mirror.com 镜像
        env.allowLocalModels = true;  // 允许使用本地模型
        env.remoteHost = 'https://hf-mirror.com';
        console.log('使用镜像:', env.remoteHost);

        // 使用 feature-extraction pipeline
        embeddingModel = await pipeline('feature-extraction', VECTOR_CONFIG.model, {
            quantized: true,
            progress_callback: (progress) => {
                if (progress.status === 'progress') {
                    const percent = Math.round(progress.progress || 0);
                    //console.log(`模型加载进度: ${percent}%`);
                    // 更新弹窗进度
                    const bar = document.getElementById('modelLoadingBar');
                    const percentEl = document.getElementById('modelLoadingPercent');
                    if (bar) bar.style.width = `${percent}%`;
                    if (percentEl) percentEl.textContent = `${percent}%`;
                } else if (progress.status === 'done' || progress.status === 'ready') {
                    // 模型加载完成
                    const bar = document.getElementById('modelLoadingBar');
                    const percentEl = document.getElementById('modelLoadingPercent');
                    if (bar) bar.style.width = '100%';
                    if (percentEl) percentEl.textContent = '100%';
                    console.log('模型下载/加载完成');
                }
            }
        });

        vectorSearchAvailable = true;
        console.log('嵌入模型加载完成');

        // 关闭加载弹窗
        const overlay = document.getElementById('modelLoadingOverlay');
        if (overlay) {
            overlay.remove();
        }

        return embeddingModel;
    } catch (error) {
        // 使用 warn 而不是 error，避免控制台红色报错
        console.warn('向量检索不可用:', error.message || error);
        console.log('将使用关键词检索');
        vectorSearchAvailable = false;
        embeddingModel = null;

        // 关闭弹窗
        if (progressOverlay) {
            progressOverlay.style.display = 'none';
        }
        return null;
    } finally {
        embeddingModelLoading = false;
    }
}

// 生成文本嵌入向量
async function generateEmbedding(text) {
    if (vectorSearchAvailable === false) return null;

    // 优先使用原生方法（Android），但如果失败则回退到 WebAssembly
    if (window.AndroidBridge && window.AndroidBridge.isNativeEmbeddingReady && window.AndroidBridge.isNativeEmbeddingReady()) {
        console.log('[向量化] 尝试使用原生方法...');
        const nativeResult = await generateEmbeddingNative(text);
        if (nativeResult) {
            console.log('[向量化] 使用原生方法成功，向量前5个值:', nativeResult.slice(0, 5));
            return nativeResult;
        }
        console.log('原生嵌入失败，回退到 WebAssembly 方法');
    }

    // 使用 WebAssembly 方法
    console.log('[向量化] 使用 WebAssembly 方法...');
    if (!embeddingModel) {
        const model = await loadEmbeddingModel();
        if (!model) return null;
    }

    try {
        const output = await embeddingModel(text, { pooling: 'mean', normalize: true });
        // 转换为普通数组
        const result = Array.from(output.data);
        console.log('[向量化] WebAssembly 方法成功，向量前5个值:', result.slice(0, 5));
        return result;
    } catch (error) {
        console.warn('生成嵌入向量失败:', error.message || error);
        return null;
    }
}

// 使用原生方法生成嵌入向量
let nativeTokenizer = null;
let nativeTokenizerLoading = false;

async function loadNativeTokenizer() {
    if (nativeTokenizer) return nativeTokenizer;
    if (nativeTokenizerLoading) {
        // 等待加载完成
        while (nativeTokenizerLoading) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return nativeTokenizer;
    }

    nativeTokenizerLoading = true;
    try {
        // 懒加载 Transformers.js
        await ensureTransformers();

        // 使用已打包的 Transformers.js
        if (!window.Transformers || !window.Transformers.AutoTokenizer) {
            throw new Error('Transformers.js not loaded');
        }

        const { AutoTokenizer, env } = window.Transformers;

        // 检测是否在安卓环境
        const isAndroid = window.cordova && window.cordova.platformId === 'android';

        if (isAndroid) {
            // 安卓环境：使用本地 tokenizer 文件
            env.allowLocalModels = true;
            env.localModelPath = 'models/';
            console.log('安卓环境：使用本地 tokenizer');

            nativeTokenizer = await AutoTokenizer.from_pretrained('Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
                local_files_only: true
            });
        } else {
            // Web 环境：使用镜像
            env.allowLocalModels = false;
            env.remoteHost = 'https://hf-mirror.com';
            console.log('Web 环境：使用镜像下载 tokenizer');

            nativeTokenizer = await AutoTokenizer.from_pretrained('Xenova/paraphrase-multilingual-MiniLM-L12-v2');
        }

        return nativeTokenizer;
    } catch (error) {
        console.warn('加载 tokenizer 失败:', error.message || error);
        return null;
    } finally {
        nativeTokenizerLoading = false;
    }
}

async function generateEmbeddingNative(text) {
    try {
        // 加载 tokenizer
        const tokenizer = await loadNativeTokenizer();
        if (!tokenizer) {
            console.warn('Tokenizer 不可用，回退到 WebAssembly');
            return null;
        }

        // 分词 (确保转换为 Number 避免 BigInt 序列化问题)
        const inputs = tokenizer(text, { padding: true, truncation: true, max_length: 128 });
        const inputIds = Array.from(inputs.input_ids.data, x => Number(x));
        const attentionMask = Array.from(inputs.attention_mask.data, x => Number(x));

        // 调用原生方法
        const resultJson = window.AndroidBridge.generateEmbeddingNative(
            JSON.stringify(inputIds),
            JSON.stringify(attentionMask)
        );

        const result = JSON.parse(resultJson);
        if (result.error) {
            console.warn('原生嵌入生成失败:', result.error);
            return null;
        }

        return result; // 返回嵌入向量数组
    } catch (error) {
        console.warn('原生嵌入生成失败:', error.message || error);
        return null;
    }
}

// 检查向量检索是否可用（不阻塞，快速返回）
function checkVectorSearchAvailable() {
    if (vectorSearchAvailable === true) {
        return Promise.resolve(true);
    }
    if (vectorSearchAvailable === false) {
        return Promise.resolve(false);
    }

    // 优先检查原生嵌入是否可用（Android）
    if (window.AndroidBridge && window.AndroidBridge.isNativeEmbeddingReady && window.AndroidBridge.isNativeEmbeddingReady()) {
        console.log('检测到原生嵌入可用，跳过 WebAssembly 模型加载');
        vectorSearchAvailable = true;
        return Promise.resolve(true);
    }

    // 检查基本浏览器兼容性
    // WebAssembly 是 ONNX Runtime 运行的必要条件
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
        console.log('浏览器不支持 WebAssembly，向量检索不可用');
        vectorSearchAvailable = false;
        return Promise.resolve(false);
    }

    // 尝试加载模型
    return loadEmbeddingModel().then(model => model !== null).catch(() => false);
}

// 获取向量检索不可用的原因提示
function getVectorSearchUnavailableReason() {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
        return '浏览器不支持 WebAssembly';
    }
    if (vectorSearchAvailable === false) {
        return '向量模型加载失败，可能浏览器不兼容或网络问题';
    }
    return null;
}

// 计算余弦相似度
function cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
        dotProduct += vec1[i] * vec2[i];
        norm1 += vec1[i] * vec1[i];
        norm2 += vec2[i] * vec2[i];
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// 为文档块生成向量（带进度回调）
async function generateChunkEmbeddings(chunks, onProgress = null) {
    const chunksWithEmbeddings = [];
    const totalChunks = chunks.length;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await generateEmbedding(chunk.text);
        chunksWithEmbeddings.push({
            ...chunk,
            embedding: embedding
        });

        // 进度回调
        if (onProgress) {
            onProgress(i + 1, totalChunks);
        }

        // 添加小延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    return chunksWithEmbeddings;
}

// 向量检索
async function vectorSearch(query, maxResults = 3) {
    const queryEmbedding = await generateEmbedding(query);

    if (!queryEmbedding) {
        return { results: null, allChunks: [], embedding: null, matchDetails: [] };
    }

    let documents = await getAllKnowledgeDocuments();
    if (documents.length === 0) return { results: [], allChunks: [], embedding: queryEmbedding, matchDetails: [] };

    // 如果指定了特定文档，只搜索该文档
    if (selectedKnowledgeDocId !== null) {
        documents = documents.filter(doc => doc.id === selectedKnowledgeDocId);
    }

    // 先统计未向量化的块数量
    let totalChunksWithoutEmbedding = 0;
    for (const doc of documents) {
        if (!doc.chunks) continue;
        for (const chunk of doc.chunks) {
            if (!chunk.embedding) {
                totalChunksWithoutEmbedding++;
            }
        }
    }

    // 如果有未向量化的块，询问用户是否自动向量化
    let autoGenerateEmbeddings = true;
    if (totalChunksWithoutEmbedding > 0) {
        autoGenerateEmbeddings = confirm(
            `检测到 ${totalChunksWithoutEmbedding} 个知识库片段未向量化，是否现在向量化？\n\n` +
            `选择「确定」将自动生成向量（首次较慢，只需执行一次）\n` +
            `选择「取消」将仅使用关键词检索`
        );
    }

    const results = [];
    const allChunks = []; // 存储所有片段（不管相似度是否达标）
    const matchDetails = []; // 收集匹配详情用于调试输出
    let chunksWithEmbedding = 0;
    let chunksWithoutEmbedding = 0;

    for (const doc of documents) {
        if (!doc.chunks) continue;

        for (const chunk of doc.chunks) {
            if (!chunk.embedding) {
                chunksWithoutEmbedding++;
                // 如果块没有向量，尝试生成（首次使用时）
                if (autoGenerateEmbeddings) {
                    chunk.embedding = await generateEmbedding(chunk.text);
                } else {
                    // 用户选择不自动向量化，跳过此块
                    continue;
                }
            } else {
                chunksWithEmbedding++;
            }

            if (chunk.embedding) {
                const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);

                const chunkResult = {
                    text: chunk.text,
                    docName: doc.name,
                    score: similarity * 100, // 转换为百分制
                    similarity: similarity,
                    title: chunk.title || null
                };

                // 存储所有片段
                allChunks.push(chunkResult);

                // 收集匹配详情（包含向量前5个值用于对比）
                matchDetails.push({
                    docName: doc.name,
                    text: chunk.text.substring(0, 50) + '...',
                    similarity: (similarity * 100).toFixed(2) + '%',
                    aboveThreshold: similarity >= VECTOR_CONFIG.similarityThreshold,
                    chunkVectorFirst5: chunk.embedding.slice(0, 5) // 片段向量前5个值
                });

                // 只有达到阈值的才加入results
                if (similarity >= VECTOR_CONFIG.similarityThreshold) {
                    results.push(chunkResult);
                }
            }
        }
    }

    // 按相似度排序
    results.sort((a, b) => b.similarity - a.similarity);
    allChunks.sort((a, b) => b.similarity - a.similarity);

    return {
        results: results.slice(0, maxResults),
        allChunks: allChunks, // 返回所有片段
        embedding: queryEmbedding,
        matchDetails,
        chunksWithEmbedding,
        chunksWithoutEmbedding
    };
}

// 混合检索（关键词 + 向量）
async function hybridSearch(query, maxResults = 3) {
    console.log('====== 知识库检索开始 ======');
    console.log('用户问题:', query);
    console.log('向量检索状态: 已启用');
    console.log('关键词检索片段数:', maxKeywordChunks);
    console.log('向量检索片段数:', maxKnowledgeChunks);

    // 使用用户自定义的检索数量
    const keywordCount = maxKeywordChunks || 1;
    const vectorCount = maxKnowledgeChunks || 3;

    // 关键词检索和向量检索并行执行
    const [keywordResults, vectorSearchResult] = await Promise.all([
        searchKnowledgeBase(query, keywordCount), // 关键词检索使用自定义数量
        vectorSearch(query, vectorCount * 2)
    ]);

    // 输出向量检索详情
    if (vectorSearchResult && vectorSearchResult.embedding) {
        console.log('--- 用户消息向量化结果 ---');
        console.log('向量维度:', vectorSearchResult.embedding.length);
        console.log('向量前5个值:', vectorSearchResult.embedding.slice(0, 5));
        console.log('片段统计: 有向量=' + vectorSearchResult.chunksWithEmbedding + ', 无向量=' + vectorSearchResult.chunksWithoutEmbedding);

        if (vectorSearchResult.matchDetails.length > 0) {
            console.log('--- 向量相似度匹配 ---');
            console.log('相似度阈值:', (VECTOR_CONFIG.similarityThreshold * 100).toFixed(0) + '%');
            console.log('总片段数:', vectorSearchResult.matchDetails.length);

            // 找到相似度最高的片段（matchDetails没有排序，需要找最大值）
            const topMatch = vectorSearchResult.matchDetails.reduce((max, item) => {
                const sim = parseFloat(item.similarity);
                const maxSim = parseFloat(max.similarity);
                return sim > maxSim ? item : max;
            }, vectorSearchResult.matchDetails[0]);

            console.log('--- 最相似片段对比 ---');
            console.log('片段文本:', topMatch.text);
            console.log('相似度:', topMatch.similarity);
            console.log('用户向量前5:', vectorSearchResult.embedding.slice(0, 5));
            console.log('片段向量前5:', topMatch.chunkVectorFirst5);

            // 计算向量差异
            const userVec = vectorSearchResult.embedding.slice(0, 5);
            const chunkVec = topMatch.chunkVectorFirst5;
            const diff = userVec.map((v, i) => (v - chunkVec[i]).toFixed(4));
            console.log('前5个值差异:', diff);

            console.log('命中片段数:', vectorSearchResult.results ? vectorSearchResult.results.length : 0);
        }
    }

    const vectorResults = vectorSearchResult?.results;
    const allChunks = vectorSearchResult?.allChunks;

    // 如果向量检索失败或没有片段，检查关键词检索结果
    if (!allChunks || allChunks.length === 0) {
        // 向量检索无结果，但有关键词检索结果时，返回关键词结果
        if (keywordResults.length > 0) {
            console.log('--- 最终结果 ---');
            console.log('检索方式: 关键词检索（用户取消了向量化）');
            console.log('关键词检索结果:', keywordResults.length, '个');
            console.log('============================');
            return keywordResults.map(r => ({ ...r, isKeywordResult: true }));
        }
        console.log('--- 最终结果 ---');
        console.log('命中片段数: 0（知识库无内容）');
        console.log('============================');
        return [];
    }

    // 如果没有命中片段（相似度都低于阈值），使用相似度最高的片段
    let finalVectorResults;
    if (!vectorResults || vectorResults.length === 0) {
        console.log('--- 相似度低于阈值，使用最相似的片段 ---');
        finalVectorResults = allChunks.slice(0, vectorCount);
        console.log('最高相似度:', (finalVectorResults[0].similarity * 100).toFixed(2) + '%');
    } else {
        finalVectorResults = vectorResults;
    }

    // 使用向量检索结果
    const finalResults = finalVectorResults.sort((a, b) => b.similarity - a.similarity);

    // 去重（使用文本内容去重，允许同一文档显示多个不同片段）
    const seenTexts = new Set();
    const dedupedResults = [];

    // 先添加关键词检索结果（顶格显示，标记为关键词结果）
    if (keywordResults.length > 0) {
        for (const keywordResult of keywordResults) {
            const textKey = keywordResult.text.substring(0, 100); // 用前100字符作为去重key
            if (!seenTexts.has(textKey)) {
                dedupedResults.push({
                    ...keywordResult,
                    isKeywordResult: true // 标记为关键词检索结果
                });
                seenTexts.add(textKey);
            }
        }
    }

    // 再添加向量检索结果
    for (const result of finalResults) {
        const textKey = result.text.substring(0, 100);

        // 跳过重复内容
        if (seenTexts.has(textKey)) continue;

        dedupedResults.push({
            ...result,
            isKeywordResult: false // 标记为向量检索结果
        });
        seenTexts.add(textKey);

        // 最大结果数 = 关键词检索数 + 向量检索数
        if (dedupedResults.length >= keywordCount + vectorCount) break;
    }

    console.log('--- 最终结果 ---');
    console.log('关键词检索结果:', keywordResults.length, '个');
    console.log('向量检索结果:', finalVectorResults.length, '个');
    console.log('合并后片段数:', dedupedResults.length);
    console.log('============================');

    return dedupedResults;
}
