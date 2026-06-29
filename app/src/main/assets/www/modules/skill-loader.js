/**
 * skill-loader.js — Skill 系统加载器
 *
 * 把 Skills 目录下的每个子目录当作一个"可执行的笔记"（skill），
 * 自动扫描 SKILL.md 中的 YAML 头，注册为 AI 可调用的工具。
 *
 * 目录结构：
 *   /sdcard/Download/Bluox/Skills/
 *     ├── video-opener/
 *     │   ├── SKILL.md          # 工具定义（YAML头）+ 给AI看的说明
 *     │   └── execute.sh        # 执行脚本
 *     └── dark-saas-video/
 *         ├── SKILL.md
 *         └── execute.sh
 *
 * SKILL.md 格式：
 *   ---
 *   name: create_video_opener
 *   description: 生成视频开场动画的时间线计划
 *   runtime: builtin        # builtin（内置终端）| termux（Termux环境）
 *   parameters:
 *     type: object
 *     properties:
 *       title:
 *         type: string
 *         description: 开场主词
 *     required: [title]
 *   ---
 *   # 给 AI 看的详细说明...
 */

// ==================== 状态 ====================

/** 已扫描的 skill 列表 */
let scannedSkills = [];

/** Skills 目录路径 */
const SKILLS_DIR = '/storage/emulated/0/Download/Bluox/Skills';

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
                // 找父级最近的一个数组，没有则创建
                if (!Array.isArray(parentObj._lastArray)) {
                    // 需要找到当前 key 对应的数组
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

    const header = buildTree(yamlText.split('\n'));
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
            // 简单逗号分割
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

// ==================== 扫描与注册 ====================

/**
 * 扫描 Skills 目录，加载所有 SKILL.md
 * @returns {Promise<Array>} skill 列表
 */
async function scanSkills() {
    // 通过 AndroidBridge 获取 skill 目录列表
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
        console.log('[SkillLoader] 第一个元素类型:', typeof skillEntries[0]);
        if (typeof skillEntries[0] === 'object') {
            console.log('[SkillLoader] 第一个元素字段:', Object.keys(skillEntries[0]));
        }
    } catch (e) {
        console.error('[SkillLoader] 解析 skill 目录列表失败:', e);
        return [];
    }

    if (!Array.isArray(skillEntries) || skillEntries.length === 0) {
        console.log('[SkillLoader] 未找到任何 skill');
        return [];
    }

    // 兼容旧格式：如果是字符串数组，转成对象数组
    // 同时主动检测 execute.sh 和 runtime.conf 是否存在
    if (typeof skillEntries[0] === 'string') {
        skillEntries = skillEntries.map(function(name) {
            var hasRuntimeConf = false;
            var hasExecuteSh = false;
            if (window.AndroidBridge && typeof window.AndroidBridge.readSkillDirFile === 'function') {
                hasRuntimeConf = window.AndroidBridge.readSkillDirFile(name, 'runtime.conf') !== '';
                hasExecuteSh = window.AndroidBridge.readSkillDirFile(name, 'execute.sh') !== '';
            } else {
                // readSkillDirFile 不可用（旧版 APK），通过 SKILL.md 内容推断
                var md = window.AndroidBridge && window.AndroidBridge.readSkillFile(name);
                if (md) {
                    // 有 runtime.conf 关键词或 execute.sh 引用，视为可执行
                    hasRuntimeConf = md.indexOf('runtime.conf') !== -1 || md.indexOf('Runtime:') !== -1;
                    hasExecuteSh = md.indexOf('execute.sh') !== -1;
                }
            }
            return { name: name, hasExecuteSh: hasExecuteSh, hasRuntimeConf: hasRuntimeConf };
        });
    }

    const skills = [];
    for (const entry of skillEntries) {
        const dirName = entry.name;
        try {
            // 读取 SKILL.md
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

            // 判定是否为可执行工具：有 execute.sh 或 runtime.conf 或 YAML 头中有 runtime 字段
            const hasExecutor = !!header.runtime || entry.hasExecuteSh || entry.hasRuntimeConf;
            console.log('[SkillLoader] skill:', dirName, 'hasExecutor:', hasExecutor, 'hasRuntimeConf:', entry.hasRuntimeConf, 'hasExecuteSh:', entry.hasExecuteSh, 'header.runtime:', header.runtime);

            // 检测 skill 模式：
            // - 'parameters' 模式：SKILL.md 有 parameters 字段，AI 传结构化参数
            // - 'cli' 模式：有 runtime.conf 但无 parameters，AI 传 command 字符串
            const hasParameters = !!header.parameters;
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
                name: header.name,
                description: header.description || '',
                runtime: header.runtime || 'builtin',
                parameters: header.parameters || null,
                hasExecutor: hasExecutor,
                enabled: enabled,
                skillMode: skillMode,
                cliCommand: cliCommand,
                body: body,
                dir: SKILLS_DIR + '/' + dirName,
                dirName: dirName
            };

            skills.push(skill);
            const tag = skill.hasExecutor ? '(可执行, mode: ' + skill.skillMode + ')' : '(参考文档)';
        } catch (e) {
            console.error('[SkillLoader] 加载 skill 失败:', name, e);
        }
    }

    scannedSkills = skills;
    return skills;
}

/**
 * 获取所有 skill 的工具定义（供 getToolDefinitions 调用）
 * 只返回有 executor 的 skill（即有 execute.sh 或指定了 runtime）
 * @returns {Array} tools 数组
 */
function getSkillToolDefinitions() {
    console.log('[SkillLoader] getSkillToolDefinitions 被调用, scannedSkills:', scannedSkills.length, '个');
    console.log('[SkillLoader] scannedSkills:', JSON.stringify(scannedSkills.map(function(s) { return { name: s.name, hasExecutor: s.hasExecutor, skillMode: s.skillMode, enabled: s.enabled }; })));
    var result = scannedSkills
        .filter(skill => skill.hasExecutor && skill.enabled !== false && (skill.skillMode === 'parameters' || skill.skillMode === 'cli'))
        .map(skill => {
            console.log('[SkillLoader] 注册工具:', skill.name, 'mode:', skill.skillMode);
            if (skill.skillMode === 'parameters') {
                // 模式 A：结构化参数，AI 传 JSON 对象
                return {
                    type: 'function',
                    function: {
                        name: skill.name,
                        description: skill.description,
                        parameters: skill.parameters
                    }
                };
            } else {
                // 模式 B：CLI 模式，AI 传 command 字符串
                return {
                    type: 'function',
                    function: {
                        name: skill.name,
                        description: skill.description + '\n\n用法：直接传入要执行的命令行参数。\n例如：search "量子计算" --max_results 5',
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
    console.log('[SkillLoader] getSkillToolDefinitions 返回:', result.length, '个工具');
    return result;
}

/**
 * 执行指定的 skill
 * @param {string} toolName - 工具名（即 skill 的 name）
 * @param {object} args - 参数对象
 * @returns {Promise<string|null>} 执行结果，null 表示不是 skill 工具
 */
async function executeSkill(toolName, args) {
    const skill = scannedSkills.find(s => s.name === toolName);
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
        command = `${skill.cliCommand} ${cmdArgs}`;
    } else {
        // parameters 模式：传 JSON 给 execute.sh
        const argsJson = JSON.stringify(args || {});
        const scriptPath = skill.dir + '/execute.sh';
        command = `sh "${scriptPath}" '${argsJson.replace(/'/g, "'\\''")}'`;
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

    return new Promise((resolve) => {
        let resolved = false;

        window._onLocalCommandResult = (id, result) => {
            if (id !== callbackId || resolved) return;
            resolved = true;
            delete window._onLocalCommandResult;
            resolve(formatSkillResult(result));
        };

        window.AndroidBridge.executeLocalCommandAsync(command, 60, callbackId);

        // 超时保护
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            delete window._onLocalCommandResult;
            resolve('⏱️ Skill 执行超时（60秒）');
        }, 65000);
    });
}

/**
 * 通过 Termux 执行命令
 */
async function executeViaTermux(command, workdir) {
    // 确保回调注册表存在
    if (!window._termuxCallbacks) {
        window._termuxCallbacks = {};
        window._onTermuxResult = function(cbId, data) {
            const cb = window._termuxCallbacks[cbId];
            if (cb) {
                delete window._termuxCallbacks[cbId];
                cb(typeof data === 'string' ? data : JSON.stringify(data));
            }
        };
    }

    return new Promise((resolve) => {
        let resolved = false;

        // 使用 Native 返回的 callbackId，确保回调能匹配
        const callbackId = window.AndroidBridge.runTermuxCommand(command, workdir || '', 60);
        if (!callbackId) {
            resolve('⚠️ Termux 命令发送失败');
            return;
        }

        window._termuxCallbacks[callbackId] = (result) => {
            if (resolved) return;
            resolved = true;
            resolve(formatSkillResult(result));
        };

        // 超时保护
        setTimeout(() => {
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
        // 不是 JSON，直接返回原始文本
        return typeof raw === 'string' ? raw : JSON.stringify(raw);
    }
}

/**
 * 重新加载所有 skill（供 AI 调用）
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
    console.log('[SkillLoader] 初始化 Skill 系统...');
    try {
        await scanSkills();
        console.log('[SkillLoader] 加载完成，共 ' + scannedSkills.length + ' 个 skill');
    } catch (e) {
        console.error('[SkillLoader] 初始化失败:', e);
    }
}

// 模块加载时自动初始化
console.log('[SkillLoader] 模块已加载，开始自动初始化...');
initSkillLoader();