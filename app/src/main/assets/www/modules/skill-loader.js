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
    let skillNames;
    try {
        skillNames = JSON.parse(dirListJson);
    } catch (e) {
        console.error('[SkillLoader] 解析 skill 目录列表失败:', e);
        return [];
    }

    if (!Array.isArray(skillNames) || skillNames.length === 0) {
        console.log('[SkillLoader] 未找到任何 skill');
        return [];
    }

    const skills = [];
    for (const name of skillNames) {
        try {
            // 读取 SKILL.md
            const content = window.AndroidBridge.readSkillFile(name);
            if (!content) {
                console.warn('[SkillLoader] 读取 SKILL.md 失败:', name);
                continue;
            }

            const { header, body } = parseSkillMd(content);
            if (!header || !header.name) {
                console.warn('[SkillLoader] SKILL.md 缺少 name 字段:', name);
                continue;
            }

            // 检查是否有 execute.sh（决定是否注册为可调用工具）
            const hasExecutor = window.AndroidBridge.readSkillFile(name + '/execute.sh') !== '';
            // 或者通过另一种方式检测：尝试读取 execute.sh
            // 简单方案：检查 SKILL.md 中是否包含 runtime 字段
            const hasRuntime = !!header.runtime;

            const skill = {
                name: header.name,
                description: header.description || '',
                runtime: header.runtime || 'builtin',
                parameters: header.parameters || null,
                hasExecutor: hasRuntime,  // 有 runtime 字段说明有执行脚本
                body: body,
                dir: SKILLS_DIR + '/' + name,
                dirName: name
            };

            skills.push(skill);
            const tag = skill.hasExecutor ? '(可执行, runtime: ' + skill.runtime + ')' : '(参考文档)';
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
    return scannedSkills
        .filter(skill => skill.hasExecutor && skill.parameters)
        .map(skill => ({
            type: 'function',
            function: {
                name: skill.name,
                description: skill.description,
                parameters: skill.parameters
            }
        }));
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

    console.log('[SkillLoader] 执行 skill:', toolName, 'args:', JSON.stringify(args));

    // 构建执行命令
    const argsJson = JSON.stringify(args || {});
    const scriptPath = skill.dir + '/execute.sh';
    const command = `sh "${scriptPath}" '${argsJson.replace(/'/g, "'\\''")}'`;

    if (skill.runtime === 'termux') {
        // 走 Termux 通道
        if (!window.AndroidBridge || typeof window.AndroidBridge.runTermuxCommand !== 'function') {
            return '⚠️ 此 skill 需要 Termux 环境，但当前版本不支持。';
        }
        return await executeViaTermux(command, skill.dir);
    } else {
        // 走内置终端（默认）
        if (!window.AndroidBridge || typeof window.AndroidBridge.executeLocalCommandAsync !== 'function') {
            return '⚠️ 当前环境不支持执行命令。';
        }
        return await executeViaBuiltin(command);
    }
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
    const callbackId = 'skill_tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

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

        window._termuxCallbacks[callbackId] = (result) => {
            if (resolved) return;
            resolved = true;
            resolve(formatSkillResult(result));
        };

        window.AndroidBridge.runTermuxCommand(command, workdir, 60);

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

console.log('[SkillLoader] 模块已加载');