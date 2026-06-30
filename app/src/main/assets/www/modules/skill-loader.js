/**
 * skill-loader.js — Skill 系统加载器（agentskills.io 标准兼容）
 *
 * 遵循 agentskills.io 标准的渐进披露（Progressive Disclosure）：
 *   Level 0: 扫描时只加载 name + description + license/compatibility/metadata（~100 tokens/skill）
 *   Level 1: 激活时按需加载完整 SKILL.md body（通过 loadSkillBody）
 *   Level 2: 需要时才加载 scripts/references/assets 下的文件（通过 loadSkillResource）
 *
 * 目录结构（agentskills.io 标准）：
 *   /sdcard/Download/Bluox/Skills/
 *     └── skill-name/
 *         ├── SKILL.md          # 必选：YAML frontmatter + Markdown body
 *         ├── scripts/          # 可选：可执行脚本
 *         ├── references/       # 可选：参考文档
 *         └── assets/           # 可选：模板、资源
 *
 * SKILL.md 格式（agentskills.io 标准）：
 *   ---
 *   name: skill-name            # 必选 1-64字符 a-z0-9-
 *   description: ...            # 必选 1-1024字符
 *   license: Apache-2.0         # 可选
 *   compatibility: ...          # 可选 1-500字符
 *   metadata:                   # 可选 key-value
 *     version: "1.0"
 *   allowed-tools: ...          # 可选（实验性）
 *   ---
 *   # Markdown body...
 */

// ==================== 状态 ====================

/** 已扫描的 skill 列表（Level 0：仅元数据，不含 body） */
let scannedSkills = [];

/**
 * 获取 Skills 目录路径（从 AndroidBridge 动态读取，由数据目录前缀决定）
 * 如果桥接不可用则回退到默认路径
 */
function getSkillsDirPath() {
    if (window.AndroidBridge && typeof window.AndroidBridge.getSkillsDirPath === 'function') {
        var path = window.AndroidBridge.getSkillsDirPath();
        if (path) return path;
    }
    return '/storage/emulated/0/Download/Bluox/Skills'; // 回退默认
}

/** 禁用的 skill 名称集合（持久化） */
let disabledSkills = new Set();

/** 从 localStorage 加载禁用状态 */
function loadDisabledSkills() {
    try {
        const stored = localStorage.getItem('skill_loader_disabled');
        if (stored) {
            disabledSkills = new Set(JSON.parse(stored));
        }
    } catch (e) {}
}

/** 保存禁用状态到 localStorage */
function saveDisabledSkills() {
    try {
        localStorage.setItem('skill_loader_disabled', JSON.stringify([...disabledSkills]));
    } catch (e) {}
}

/** 切换 skill 启用/禁用 */
function toggleSkillEnabled(skillName) {
    if (disabledSkills.has(skillName)) {
        disabledSkills.delete(skillName);
    } else {
        disabledSkills.add(skillName);
    }
    saveDisabledSkills();
}

/** 检查 skill 是否启用 */
function isSkillEnabled(skillName) {
    return !disabledSkills.has(skillName);
}

// 初始化时加载
loadDisabledSkills();

// ==================== YAML 头解析 ====================

/**
 * 用纯正则 + 缩进解析 SKILL.md 的 YAML 头
 * 支持：嵌套对象、>折叠块、数组、多行值
 * @param {string} content - SKILL.md 完整内容
 * @returns {{ header: object|null, body: string }}
 */
function parseSkillMd(content) {
    if (!content) return { header: null, body: '' };

    // 匹配 --- 包裹的 YAML 头
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { header: null, body: content };

    const yamlText = match[1];
    const body = (match[2] || '').trim();

    // 基于缩进的 YAML 解析器
    function buildTree(lines) {
        const root = {};
        const stack = [{ indent: -1, obj: root, key: null }];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            // 空行或注释
            if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

            // 计算缩进
            const indent = line.length - line.trimStart().length;

            // 弹出缩进更大的栈顶
            while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
                stack.pop();
            }

            const parentObj = stack[stack.length - 1].obj;

            // 列表项: - item
            if (trimmed.startsWith('- ')) {
                const itemVal = parseYamlValue(trimmed.substring(2).trim());
                if (!Array.isArray(parentObj._lastArray)) {
                    const parentKey = stack[stack.length - 1].key;
                    if (parentKey && parentObj[parentKey] === undefined) {
                        parentObj[parentKey] = [];
                    }
                    parentObj._lastArray = parentObj[parentKey];
                }
                if (Array.isArray(parentObj._lastArray)) {
                    parentObj._lastArray.push(itemVal);
                }
                i++;
                continue;
            }

            // 键值对
            const colonIdx = line.indexOf(':', line.indexOf(line.trimStart()));
            if (colonIdx === -1) { i++; continue; }

            const key = line.substring(line.indexOf(line.trimStart()), colonIdx).trim();
            let val = line.substring(colonIdx + 1).trim();

            if (!key) { i++; continue; }

            // 重置 _lastArray（新 key 开始）
            delete parentObj._lastArray;

            // 检查多行值开始（| 或 >）
            if (val === '|' || val === '>') {
                const fold = (val === '>');
                const lines_arr = [];
                let j = i + 1;
                while (j < lines.length) {
                    const nextLine = lines[j];
                    const nextTrimmed = nextLine.trimEnd();
                    const nextIndent = nextLine.length - nextLine.trimStart().length;
                    if (nextIndent <= indent || !nextTrimmed) break;
                    lines_arr.push(nextTrimmed.replace(/^[ \t]+/, ''));
                    j++;
                }
                const joined = fold ? lines_arr.join(' ') : lines_arr.join('\n');
                parentObj[key] = joined;
                i = j;
                continue;
            }

            // 值为空 → 子对象
            if (val === '') {
                const child = {};
                parentObj[key] = child;
                stack.push({ indent: indent, obj: child, key: key });
                i++;
                continue;
            }

            // 内联 JSON 对象/数组
            if (val === '{' || val === '[') {
                let depth = 1;
                let jsonStr = val;
                let j = i + 1;
                while (j < lines.length && depth > 0) {
                    const l = lines[j];
                    jsonStr += '\n' + l;
                    for (const ch of l) {
                        if (ch === '{' || ch === '[') depth++;
                        if (ch === '}' || ch === ']') depth--;
                    }
                    j++;
                }
                try {
                    parentObj[key] = JSON.parse(jsonStr);
                    i = j;
                    continue;
                } catch (e) {
                    // 解析失败，当字符串处理
                }
            }

            parentObj[key] = parseYamlValue(val);
            i++;
        }

        // 清理辅助属性
        delete root._lastArray;
        return root;
    }

    const rawHeader = buildTree(yamlText.split('\n'));

    // 标准化提取 agentskills.io 标准字段
    const header = {
        name: rawHeader.name || null,
        description: rawHeader.description || null,
        license: rawHeader.license || null,
        compatibility: rawHeader.compatibility || null,
        metadata: rawHeader.metadata || null,
        allowedTools: rawHeader['allowed-tools'] || rawHeader.allowed_tools || null,
        // 非标准字段（向后兼容）
        version: rawHeader.version || null,
        _raw: rawHeader
    };

    return { header, body };
}

/**
 * 解析 YAML 标量值
 */
function parseYamlValue(val) {
    if (val === 'null' || val === '~') return null;
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === '') return '';

    // 数字
    const num = Number(val);
    if (!isNaN(num) && val.trim() !== '') return num;

    // 数组 [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
        try {
            return JSON.parse(val);
        } catch (e) {
            return val.slice(1, -1).split(',').map(s => parseYamlValue(s.trim())).filter(s => s !== '');
        }
    }

    // 对象 {...}
    if (val.startsWith('{') && val.endsWith('}')) {
        try {
            return JSON.parse(val);
        } catch (e) {
            return val;
        }
    }

    // 字符串（去掉引号）
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        return val.slice(1, -1);
    }

    return val;
}

// ==================== 字段验证（agentskills.io 标准） ====================

/**
 * 验证 SKILL.md 的 frontmatter 是否符合 agentskills.io 标准
 * @param {object} header - 解析后的 YAML 头
 * @param {string} dirName - 目录名
 * @returns {string[]} 警告列表（空数组表示完全合规）
 */
function validateSkill(header, dirName) {
    const warnings = [];

    // name 必填
    if (!header.name) {
        warnings.push('缺少必填字段 name');
    } else {
        // name 格式：1-64 字符，仅 a-z 0-9 连字符，不能以连字符开头/结尾，不能有连续连字符
        if (typeof header.name !== 'string') {
            warnings.push('name 必须是字符串');
        } else {
            if (header.name.length < 1 || header.name.length > 64) {
                warnings.push('name 长度应为 1-64 字符（当前 ' + header.name.length + '）');
            }
            if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(header.name)) {
                warnings.push('name 格式不符合 agentskills.io 标准：仅允许小写字母(a-z)、数字(0-9)和连字符(-)，不能以连字符开头/结尾，不能有连续连字符。当前值: "' + header.name + '"');
            }
            if (header.name !== dirName) {
                warnings.push('name "' + header.name + '" 与目录名 "' + dirName + '" 不一致（agentskills.io 要求一致）');
            }
        }
    }

    // description 必填，1-1024 字符
    if (!header.description) {
        warnings.push('缺少必填字段 description');
    } else if (typeof header.description === 'string') {
        if (header.description.length < 1) {
            warnings.push('description 不能为空');
        } else if (header.description.length > 1024) {
            warnings.push('description 超过 1024 字符限制（当前 ' + header.description.length + '）');
        }
    }

    // compatibility 可选，1-500 字符
    if (header.compatibility && typeof header.compatibility === 'string') {
        if (header.compatibility.length > 500) {
            warnings.push('compatibility 超过 500 字符限制（当前 ' + header.compatibility.length + '）');
        }
    }

    return warnings;
}

// ==================== 扫描与注册（Level 0：渐进披露） ====================

/**
 * 扫描 Skills 目录，加载所有 skill 的元数据（Level 0）
 * 遵循 agentskills.io：只提取 YAML 头中的 name/description/license/compatibility/metadata
 * 不加载 body（body 在 Level 1 按需加载）
 *
 * @returns {Promise<Array>} skill 元数据列表（不含 body）
 */
async function scanSkills() {
    if (!window.AndroidBridge || typeof window.AndroidBridge.scanSkillsDir !== 'function') {
        console.warn('[SkillLoader] AndroidBridge.scanSkillsDir 不可用');
        return [];
    }

    const dirListJson = window.AndroidBridge.scanSkillsDir();
    console.log('[SkillLoader] scanSkillsDir 原始返回:', dirListJson);
    let skillEntries;
    try {
        skillEntries = JSON.parse(dirListJson);
        console.log('[SkillLoader] 解析后:', JSON.stringify(skillEntries));
    } catch (e) {
        console.error('[SkillLoader] 解析 skill 目录列表失败:', e);
        return [];
    }

    if (!Array.isArray(skillEntries) || skillEntries.length === 0) {
        console.log('[SkillLoader] 未找到任何 skill');
        return [];
    }

    // 兼容旧格式：如果是字符串数组，转成对象数组
    if (typeof skillEntries[0] === 'string') {
        skillEntries = skillEntries.map(function(name) {
            var hasRuntimeConf = false;
            var hasExecuteSh = false;
            var hasScripts = false;
            var hasReferences = false;
            var hasAssets = false;
            if (window.AndroidBridge && typeof window.AndroidBridge.readSkillDirFile === 'function') {
                hasRuntimeConf = window.AndroidBridge.readSkillDirFile(name, 'runtime.conf') !== '';
                hasExecuteSh = window.AndroidBridge.readSkillDirFile(name, 'execute.sh') !== '';
            }
            return { name: name, hasExecuteSh: hasExecuteSh, hasRuntimeConf: hasRuntimeConf,
                     hasScripts: hasScripts, hasReferences: hasReferences, hasAssets: hasAssets };
        });
    }

    const skills = [];
    for (const entry of skillEntries) {
        const dirName = entry.name;
        try {
            // Level 0: 读取 SKILL.md，只提取 YAML 头（不保存 body）
            const content = window.AndroidBridge.readSkillFile(dirName);
            if (!content) {
                console.warn('[SkillLoader] 读取 SKILL.md 失败:', dirName);
                continue;
            }

            const { header, body } = parseSkillMd(content);
            if (!header || !header.name) {
                console.warn('[SkillLoader] SKILL.md 缺少 name 字段:', dirName);
                continue;
            }

            // 验证是否符合 agentskills.io 标准
            const warnings = validateSkill(header, dirName);
            if (warnings.length > 0) {
                console.warn('[SkillLoader] ⚠️ ' + dirName + ' 不符合 agentskills.io 标准:');
                warnings.forEach(function(w) { console.warn('  - ' + w); });
            }

            // 判定是否为可执行工具
            const hasExecutor = !!header._raw.runtime || entry.hasExecuteSh || entry.hasRuntimeConf;

            // 检测 skill 模式：
            // - 'parameters' 模式：SKILL.md 有 parameters 字段，AI 传结构化参数
            // - 'cli' 模式：有 runtime.conf 但无 parameters，AI 传 command 字符串
            // - 'reference' 模式：仅有 SKILL.md，AI 用 read_file 读取
            const hasParameters = !!header._raw.parameters;
            const skillMode = hasParameters ? 'parameters' : (entry.hasRuntimeConf ? 'cli' : 'reference');

            // cli 模式：读取 runtime.conf 获取命令前缀
            let cliCommand = null;
            if (skillMode === 'cli') {
                const runtimeConf = window.AndroidBridge.readSkillDirFile(dirName, 'runtime.conf');
                if (runtimeConf) {
                    const match = runtimeConf.match(/^Command:\s*(.+)$/m);
                    if (match) {
                        cliCommand = match[1].trim();
                    }
                }
                if (!cliCommand) {
                    console.warn('[SkillLoader] runtime.conf 读取失败或缺少 Command 字段:', dirName);
                }
            }

            const enabled = isSkillEnabled(header.name);

            const skill = {
                // ===== agentskills.io 标准字段（Level 0 metadata）=====
                name: header.name,
                description: header.description || '',
                license: header.license || null,
                compatibility: header.compatibility || null,
                metadata: header.metadata || null,
                allowedTools: header.allowedTools || null,

                // ===== 自定义扩展（兼容旧版）=====
                version: header.version || (header.metadata && header.metadata.version) || null,
                runtime: header._raw.runtime || 'builtin',
                parameters: header._raw.parameters || null,

                // ===== 目录结构（agentskills.io 可选目录）=====
                hasScripts: !!entry.hasScripts,
                hasReferences: !!entry.hasReferences,
                hasAssets: !!entry.hasAssets,

                // ===== 执行状态 =====
                hasExecutor: hasExecutor,
                enabled: enabled,
                skillMode: skillMode,
                cliCommand: cliCommand,

                // ===== 路径 =====
                dir: getSkillsDirPath() + '/' + dirName,
                dirName: dirName

                // 注意：不存储 body（渐进披露：Level 1 按需加载）
            };

            skills.push(skill);
            const tag = skill.hasExecutor ? '(可执行, mode: ' + skill.skillMode + ')' : '(参考文档)';
            console.log('[SkillLoader] ✓ ' + dirName + ' ' + tag +
                (warnings.length > 0 ? ' [' + warnings.length + ' warnings]' : ' [合规]'));
        } catch (e) {
            console.error('[SkillLoader] 加载 skill 失败:', dirName, e);
        }
    }

    scannedSkills = skills;
    console.log('[SkillLoader] 扫描完成：共 ' + skills.length + ' 个 skill（' +
        skills.filter(function(s) { return s.hasExecutor; }).length + ' 可执行, ' +
        skills.filter(function(s) { return !s.hasExecutor; }).length + ' 参考文档）');
    return skills;
}

// ==================== 渐进披露：按需加载 ====================

/**
 * Level 1: 加载指定 skill 的完整 SKILL.md body
 * 遵循 agentskills.io：仅在 skill 被激活时加载（< 5000 tokens 推荐）
 *
 * @param {string} skillName - skill 名称（即目录名）
 * @returns {string|null} SKILL.md body 内容（不含 YAML 头），失败返回 null
 */
function loadSkillBody(skillName) {
    if (!window.AndroidBridge || typeof window.AndroidBridge.readSkillFile !== 'function') {
        console.warn('[SkillLoader] readSkillFile 不可用');
        return null;
    }
    const content = window.AndroidBridge.readSkillFile(skillName);
    if (!content) return null;
    const { body } = parseSkillMd(content);
    return body || '';
}

/**
 * Level 2: 加载 skill 目录下指定资源文件
 * 遵循 agentskills.io：scripts/references/assets 下的文件按需加载
 *
 * @param {string} skillName - skill 名称
 * @param {string} relativePath - 相对路径（如 "references/REFERENCE.md" 或 "scripts/extract.py"）
 * @returns {string|null} 文件内容，失败返回 null
 */
function loadSkillResource(skillName, relativePath) {
    if (!window.AndroidBridge || typeof window.AndroidBridge.readSkillDirFile !== 'function') {
        console.warn('[SkillLoader] readSkillDirFile 不可用');
        return null;
    }
    // 安全检查：防止路径穿越
    const safePath = relativePath.replace(/\.\./g, '').replace(/[\/\\]+/g, '/').replace(/^\/+/, '');
    if (!safePath) return null;
    const content = window.AndroidBridge.readSkillDirFile(skillName, safePath);
    return content || null;
}

// ==================== 工具定义（Level 0 → AI function calling） ====================

/**
 * 获取所有 skill 的工具定义（供 getToolDefinitions 调用）
 * 只返回有 executor 的 skill
 * 遵循 agentskills.io：description 中附带 license/compatibility/metadata
 *
 * @returns {Array} OpenAI function calling 格式的工具数组
 */
function getSkillToolDefinitions() {
    console.log('[SkillLoader] getSkillToolDefinitions 被调用, scannedSkills:', scannedSkills.length, '个');
    console.log('[SkillLoader] scannedSkills:', JSON.stringify(scannedSkills.map(function(s) {
        return { name: s.name, hasExecutor: s.hasExecutor, skillMode: s.skillMode, enabled: s.enabled };
    })));

    return scannedSkills
        .filter(function(skill) {
            return skill.hasExecutor && skill.enabled !== false &&
                   (skill.skillMode === 'parameters' || skill.skillMode === 'cli');
        })
        .map(function(skill) {
            console.log('[SkillLoader] 注册工具:', skill.name, 'mode:', skill.skillMode);

            // 构建增强的 description（含 agentskills.io 元数据）
            var enhancedDesc = skill.description;
            if (skill.compatibility) {
                enhancedDesc += '\n\n兼容性：' + skill.compatibility;
            }
            if (skill.license) {
                enhancedDesc += '\n许可证：' + skill.license;
            }
            if (skill.metadata && typeof skill.metadata === 'object' && Object.keys(skill.metadata).length > 0) {
                enhancedDesc += '\n元数据：' + JSON.stringify(skill.metadata);
            }

            if (skill.skillMode === 'parameters') {
                // 模式 A：结构化参数，AI 传 JSON 对象
                return {
                    type: 'function',
                    function: {
                        name: skill.name,
                        description: enhancedDesc,
                        parameters: skill.parameters
                    }
                };
            } else {
                // 模式 B：CLI 模式，AI 传 command 字符串
                return {
                    type: 'function',
                    function: {
                        name: skill.name,
                        description: enhancedDesc + '\n\n用法：直接传入要执行的命令行参数（不包含脚本路径，只传子命令和选项）。',
                        parameters: {
                            type: 'object',
                            properties: {
                                command: {
                                    type: 'string',
                                    description: '要执行的命令行参数（不包含脚本路径，只传子命令和选项）'
                                }
                            },
                            required: ['command']
                        }
                    }
                };
            }
        });
}

/**
 * 构建所有 skill 的统一索引（供 system prompt 使用）
 * 遵循 agentskills.io Level 0：可执行 + 参考文档同列，仅 name + 简短描述
 *
 * @returns {string} 索引文本
 */
function buildAllSkillsIndex() {
    var all = scannedSkills.filter(function(s) { return s.enabled !== false; });
    if (all.length === 0) return '';

    var execs = all.filter(function(s) { return s.hasExecutor; });
    var refs = all.filter(function(s) { return !s.hasExecutor; });

    var lines = ['## Skills 索引（Level 0）', '',
        '可执行 skill 已注册为工具可直接调用，参考文档需用 read_file 读取 SKILL.md：', ''];

    if (execs.length > 0) {
        lines.push('### 🔧 可执行工具');
        lines.push('');
        execs.forEach(function(s) {
            var desc = s.description || '';
            if (desc.length > 120) desc = desc.substring(0, 120) + '...';
            lines.push('- **' + s.name + '** (' + s.skillMode + '): ' + desc);
        });
        lines.push('');
    }

    if (refs.length > 0) {
        lines.push('### 📖 参考文档');
        lines.push('');
        refs.forEach(function(s) {
            var desc = s.description || '';
            if (desc.length > 120) desc = desc.substring(0, 120) + '...';
            lines.push('- **' + s.name + '**: ' + desc);
            lines.push('  路径: ' + s.dir + '/SKILL.md');
            if (s.hasReferences) lines.push('  (含 references/)');
            if (s.hasAssets) lines.push('  (含 assets/)');
        });
    }

    return lines.join('\n');
}

// ==================== 执行 ====================

/**
 * 执行指定的 skill
 * @param {string} toolName - 工具名（即 skill 的 name）
 * @param {object} args - 参数对象
 * @returns {Promise<string|null>} 执行结果，null 表示不是 skill 工具
 */
async function executeSkill(toolName, args) {
    const skill = scannedSkills.find(function(s) { return s.name === toolName; });
    if (!skill) return null;
    if (!skill.hasExecutor) return null;  // 参考文档类 skill，不可执行

    console.log('[SkillLoader] 执行 skill:', toolName, 'mode:', skill.skillMode, 'args:', JSON.stringify(args));

    let command;
    if (skill.skillMode === 'cli') {
        // CLI 模式：从 runtime.conf 读取命令前缀，拼接 AI 传的 command 参数
        if (!skill.cliCommand) {
            return '⚠️ Skill 缺少 CLI 命令配置（runtime.conf 中未找到 Command 字段）';
        }
        const cmdArgs = (args && args.command) || '';
        command = skill.cliCommand + ' ' + cmdArgs;
    } else {
        // parameters 模式：传 JSON 给 execute.sh
        const argsJson = JSON.stringify(args || {});
        const scriptPath = skill.dir + '/execute.sh';
        command = 'sh "' + scriptPath + '" \'' + argsJson.replace(/'/g, "'\\''") + '\'';
    }

    // 所有 skill 执行默认走 Termux 通道（Android 系统没有 python/node 等运行时）
    if (window.AndroidBridge && typeof window.AndroidBridge.runTermuxCommand === 'function') {
        return await executeViaTermux(command, skill.dir);
    }
    // fallback：走内置终端
    if (!window.AndroidBridge || typeof window.AndroidBridge.executeLocalCommandAsync !== 'function') {
        return '⚠️ 当前环境不支持执行命令。';
    }
    return await executeViaBuiltin(command);
}

/**
 * 通过内置终端执行命令
 */
async function executeViaBuiltin(command) {
    const callbackId = 'skill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    return new Promise(function(resolve) {
        let resolved = false;

        window._onLocalCommandResult = function(id, result) {
            if (id !== callbackId || resolved) return;
            resolved = true;
            delete window._onLocalCommandResult;
            resolve(formatSkillResult(result));
        };

        window.AndroidBridge.executeLocalCommandAsync(command, 60, callbackId);

        // 超时保护
        setTimeout(function() {
            if (resolved) return;
            resolved = true;
            delete window._onLocalCommandResult;
            resolve('⏱️ Skill 执行超时（60秒）');
        }, 65000);
    });
}

// ==================== Termux 回调基础设施（模块加载时初始化，所有模块共享）====================
if (!window._termuxCallbacks) {
    window._termuxCallbacks = {};
}
if (!window._onTermuxResult) {
    window._onTermuxResult = function(cbId, data) {
        var cb = window._termuxCallbacks[cbId];
        if (cb) {
            delete window._termuxCallbacks[cbId];
            cb(typeof data === 'string' ? data : JSON.stringify(data));
        }
    };
}

/**
 * 通过 Termux 执行命令
 */
async function executeViaTermux(command, workdir) {
    return new Promise(function(resolve) {
        let resolved = false;

        const callbackId = window.AndroidBridge.runTermuxCommand(command, workdir || '', 60);
        if (!callbackId) {
            resolve('⚠️ Termux 命令发送失败');
            return;
        }

        window._termuxCallbacks[callbackId] = function(result) {
            if (resolved) return;
            resolved = true;
            resolve(formatSkillResult(result));
        };

        // 超时保护
        setTimeout(function() {
            if (resolved) return;
            resolved = true;
            delete window._termuxCallbacks[callbackId];
            resolve('⏱️ Skill 执行超时（60秒）');
        }, 65000);
    });
}

/**
 * 格式化 skill 执行结果
 */
function formatSkillResult(raw) {
    if (!raw) return '⚠️ Skill 返回空结果';

    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed.error) return '⚠️ ' + parsed.error;
        if (parsed.cancelled) return '⏹️ Skill 执行已取消';
        if (parsed.exitCode !== undefined) {
            const output = parsed.stdout || parsed.output || '';
            if (parsed.exitCode !== 0) {
                return '⚠️ Skill 执行失败 (exit: ' + parsed.exitCode + ')\n' + output;
            }
            return output || '✅ Skill 执行完成';
        }
        return parsed.output || parsed.stdout || raw;
    } catch (e) {
        return typeof raw === 'string' ? raw : JSON.stringify(raw);
    }
}

// ==================== 重新加载 ====================

/**
 * 重新加载所有 skill（供 AI 调用或数据目录变更后刷新）
 */
async function reloadSkills() {
    console.log('[SkillLoader] 重新加载所有 skill...');
    await scanSkills();
    return '已重新加载 ' + scannedSkills.length + ' 个 skill';
}

// ==================== 初始化 ====================

/**
 * 初始化 Skill 加载器
 * 在 app.js 初始化完成后调用
 */
async function initSkillLoader() {
    console.log('[SkillLoader] 初始化 Skill 系统（agentskills.io 兼容模式）...');
    try {
        await scanSkills();
        const execCount = scannedSkills.filter(function(s) { return s.hasExecutor; }).length;
        const refCount = scannedSkills.filter(function(s) { return !s.hasExecutor; }).length;
        console.log('[SkillLoader] 加载完成：' + scannedSkills.length + ' 个 skill（' +
            execCount + ' 可执行, ' + refCount + ' 参考文档）');
    } catch (e) {
        console.error('[SkillLoader] 初始化失败:', e);
    }
}

// 模块加载时自动初始化
console.log('[SkillLoader] 模块已加载（agentskills.io 兼容），开始自动初始化...');
initSkillLoader();

// 暴露函数供外部调用
window.reloadSkills = reloadSkills;
window.loadSkillBody = loadSkillBody;
window.loadSkillResource = loadSkillResource;
window.buildAllSkillsIndex = buildAllSkillsIndex;