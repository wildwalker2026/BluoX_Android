/**
 * tool-calling.js — 通用工具调用模块
 * 
 * 支持 DeepSeek 等服务商的 Function Calling / Tool Calling
 * 当前实现：DeepSeek + 百度/必应搜索（通过 AndroidBridge 原生 HTTP，无需 API Key）
 * 
 * 使用方式：在 app.js 之后加载，调用 initToolCalling() 初始化
 */

// 给工具调用中间气泡的 info tooltip 填充运行时间
function fillMidBubbleTooltip(bubble) {
    if (!bubble) return;
    const tooltip = bubble.querySelector('.token-info-tooltip');
    if (tooltip && typeof requestStartTime !== 'undefined') {
        tooltip.innerHTML = `运行时间：${((Date.now() - requestStartTime) / 1000).toFixed(1)}s`;
    }
}

// ==================== 配置和状态 ====================

// 专家模式开关（独立于网络搜索）
let expertModeEnabled = localStorage.getItem('cnai_expert_mode') === '1';

// 图表存储：chartId → { option, height }
const pendingCharts = new Map();

// tool_calls 缓冲区（流式和非流式共用）
let toolCallsBuffer = [];

// 最大多轮调用次数
const MAX_TOOL_ROUNDS = 1000;

// 支持联网搜索的服务商（使用 function calling 方式）
const FUNCTION_CALLING_PROVIDERS = ['deepseek', 'glm', 'kimi', 'minimax', 'qwen', 'doubao', 'mimo'];

// ==================== 工具定义 ====================

/**
 * 获取 web_search 工具的 API 定义
 * @returns {Array|null} tools 数组，如果不需要则返回 null
 */
// 通用 device 参数，所有文件/系统工具共用
const DEVICE_PARAM = {
    device: {
        type: "string",
        description: "执行设备：传 \"pc\" 则在已连接的电脑端执行，不传则在手机本地执行。当用户明确要求操作电脑上的文件或系统时传 \"pc\"",
        enum: ["pc"]
    }
};

function getToolDefinitions() {
    if (!isFunctionCallingProvider()) return null;
    const anyEnabled = expertModeEnabled || webSearchEnabled;
    const mcpActive = hasMcpToolsAvailable();
    if (!anyEnabled && !mcpActive) return null;

    const tools = [];

    // 网络搜索类工具（webSearchEnabled 控制）
    if (webSearchEnabled) {
        tools.push({
            type: "function",
            function: {
                name: "web_search",
                description: "搜索互联网获取最新信息、事实等内容。当用户的问题需要实时信息或你不确定的知识时使用此工具。支持多个关键词同时搜索。\n【前置步骤】使用本工具前，必须先调用 get_current_info 获取当前日期时间，确保搜索关键词中包含准确的日期。\n【重要】每个关键词元素必须是完整的一个词或语句！",
                parameters: {
                    type: "object",
                    properties: {
                        queries: {
                            type: "array",
                            items: {
                                type: "string"
                            },
                            description: "搜索关键词数组，每个元素是一个独立的搜索关键词。"
                        },
                        engine: {
                            type: "string",
                            "enum": ["360", "bing"],
                            description: "搜索引擎选择。360=360搜索（默认，推荐），bing=必应搜索。不传时默认使用360搜索。"
                        },
                        time_range: {
                            type: "string",
                            "enum": ["day", "week", "month", "year"],
                            description: "时间范围过滤，限制搜索结果的发布日期。day=过去24小时，week=过去一周，month=过去一个月，year=过去一年。不传则不过滤。"
                        }
                    },
                    required: ["queries"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "fetch_url",
                description: "访问指定的网页链接并提取页面正文内容。当用户要求查看某个链接的内容、总结某篇文章、或需要从特定网页获取详细信息时使用此工具。查询天气时不要用web_search，直接用fetch_url访问中国天气网：https://www.nmc.cn/publish/forecast/AGD/城市全拼.html。返回结果时要具体到最细节，包括风向、风力等等。\n【新闻/热点提示】如果用户问今日新闻、热点、热搜等实时资讯类问题，直接用本工具抓取 https://tophub.today/c/news 获取各大平台实时热榜（知乎、微博、百度、今日头条等），效果远好于搜索引擎。\n【使用帮助提示】如果用户问关于小蓝AI盒子的使用方法、功能介绍等问题，直接用本工具访问使用文档：https://www.xiaolanbox.com/howtouse/",
                parameters: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "要访问的网页链接"
                        }
                    },
                    required: ["url"]
                }
            }
        });
    }

    // get_current_info：两个开关任一开启都注册
    tools.push({
        type: "function",
        function: {
            name: "get_current_info",
            description: "获取用户当前的日期、时间、星期和大致地理位置。当用户询问时间、日期、天气、本地信息等需要知道用户所在位置和时间的问题时使用此工具。",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    });

    // 文件操作类工具（expertModeEnabled 控制）
    if (expertModeEnabled) {
        tools.push(
        /* {
            type: "function",
            function: {
                name: "list_directory",
                description: "列出指定目录下的文件和子目录",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "要列出的目录绝对路径（如 /storage/emulated/0/Download/Bluox）"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["path"]
                }
            }
        }, */ {
            type: "function",
            function: {
                name: "read_file",
                description: "读取文件内容，支持文档和PDF/Word/PPT/Excel。支持 offset/limit 按行范围读取（1-based，含两端），不填则读取整个文件。自动识别图片文件（png/jpg/jpeg/gif/bmp/webp/svg）并转为 base64 返回，支持视觉模型识别图片内容。path必填",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "要读取的文件绝对路径（如 /storage/emulated/0/Download/Bluox/test.txt），必填"
                        },
                        encoding: {
                            type: "string",
                            description: "文件编码，默认 utf-8"
                        },
                        offset: {
                            type: "number",
                            description: "起始行号（1-based），不填则从第1行开始"
                        },
                        limit: {
                            type: "number",
                            description: "读取行数，不填则读到文件末尾"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["path"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "write_file",
                description: "将内容写入文件（覆盖整个文件，自动创建父目录），新增文件时用，修改文件用edit_file。支持文件总数在300行以内的文件，或者空文件。⚠️path是必填参数，必须指定完整的文件路径，不能省略！",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "要写入的文件绝对路径（如 /storage/emulated/0/Download/Bluox/test.txt）"
                        },
                        content: {
                            type: "string",
                            description: "要写入的文件内容"
                        },
                        plan_log: {
                            type: "string",
                            description: "修改简述：会自动追加到日志"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["path", "content", "plan_log"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "edit_file",
                description: "精确编辑文件中的指定内容（搜索替换），不改动其他部分。适合修改少量代码，比 write_file 更安全高效。支持文件总数在300行以内的文件。⚠️path是必填参数，必须指定完整的文件路径，不能省略！",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "要编辑的文件绝对路径（如 /storage/emulated/0/Download/Bluox/test.txt）"
                        },
                        edits: {
                            type: "array",
                            description: "编辑操作列表，按顺序执行",
                            items: {
                                type: "object",
                                properties: {
                                    old_text: {
                                        type: "string",
                                        description: "要被替换的原始文本（必须精确匹配，包括缩进和空格）"
                                    },
                                    new_text: {
                                        type: "string",
                                        description: "替换后的新文本"
                                    },
                                    start_line: {
                                        type: "number",
                                        description: "可选：限定搜索起始行号（1-based），缩小匹配范围，降低复现难度"
                                    },
                                    end_line: {
                                        type: "number",
                                        description: "可选：限定搜索结束行号（1-based），缩小匹配范围，降低复现难度"
                                    }
                                },
                                required: ["old_text", "new_text"]
                            }
                        },
                        plan_log: {
                            type: "string",
                            description: "修改简述：会自动追加到日志"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["path", "edits", "plan_log"]
                }
            }
        }, /* {
            type: "function",
            function: {
                name: "create_directory",
                description: "创建目录（自动创建父目录）",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "要创建的目录路径"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["path"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "move_file",
                description: "移动或重命名文件",
                parameters: {
                    type: "object",
                    properties: {
                        src: {
                            type: "string",
                            description: "源文件路径"
                        },
                        dst: {
                            type: "string",
                            description: "目标文件路径"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["src", "dst"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "copy_file",
                description: "复制文件",
                parameters: {
                    type: "object",
                    properties: {
                        src: {
                            type: "string",
                            description: "源文件路径"
                        },
                        dst: {
                            type: "string",
                            description: "目标文件路径"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["src", "dst"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "get_file_info",
                description: "获取文件的详细信息（大小、时间戳、权限等）",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "文件路径"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["path"]
                }
            }
        }, */ {
            type: "function",
            function: {
                name: "search_files",
                description: "在指定目录下搜索匹配通配符模式的文件",
                parameters: {
                    type: "object",
                    properties: {
                        directory: {
                            type: "string",
                            description: "搜索的根目录"
                        },
                        pattern: {
                            type: "string",
                            description: "通配符匹配模式（支持 * 和 ?）"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["directory", "pattern"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "search_content",
                description: "在指定目录下的文本文件中搜索包含特定关键词或正则表达式的行，返回匹配的文件名、行号和内容",
                parameters: {
                    type: "object",
                    properties: {
                        directory: {
                            type: "string",
                            description: "搜索的根目录"
                        },
                        pattern: {
                            type: "string",
                            description: "搜索关键词或正则表达式"
                        },
                        include: {
                            type: "string",
                            description: "文件名过滤（如 \"*.js,*.py\"），不填则搜索所有文本文件"
                        },
                        max_results: {
                            type: "number",
                            description: "最大返回匹配数，默认50",
                            default: 50
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["directory", "pattern"]
                }
            }
        }, /* {
            type: "function",
            function: {
                name: "get_system_info",
                description: "获取系统信息（CPU、内存、操作系统、磁盘等）",
                parameters: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            description: "信息类型",
                            enum: ["cpu", "memory", "os", "disk", "all"]
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["type"]
                }
            }
        }, */ {
            type: "function",
            function: {
                name: "execute_command",
                description: "执行系统命令（shell命令）。手机本地使用 Android 系统 Shell，连接电脑后在电脑端执行。",
                parameters: {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                            description: "要执行的命令"
                        },
                        timeout: {
                            type: "number",
                            description: "超时时间（毫秒），默认30000"
                        },
                        ...DEVICE_PARAM
                    },
                    required: ["command"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "send_file_to_phone",
                description: "将电脑上的文件发送到手机端。文件会保存到手机的 Downloads/小蓝AI盒子 目录。",
                parameters: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "电脑上文件的完整路径"
                        }
                    },
                    required: ["path"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "math_calculate",
                description: "使用数学引擎进行精确计算。支持四则运算、三角函数、求导(derivative)、方程求解(solve)、定积分(integrate)、矩阵运算、统计、单位换算、复数等。当需要精确的数学计算结果时使用此工具，不要自己估算。",
                parameters: {
                    type: "object",
                    properties: {
                        expression: {
                            type: "string",
                            description: "数学表达式，如 sqrt(3^2 + 4^2)、derivative('x^3 + 2*x', 'x')、solve('x^2 - 5*x + 6 = 0', 'x')、integrate('x^2', 'x')（不定积分）、integrate('x^2', 'x', 0, 1)（定积分）、det([1,2;3,4])、2 inch to cm"
                        }
                    },
                    required: ["expression"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "generate_chart",
                description: "生成数据可视化图表。传入 ECharts option 配置 JSON，系统会渲染图表并展示给用户。支持折线图、柱状图、饼图、散点图、雷达图、热力图等所有 ECharts 支持的图表类型。",
                parameters: {
                    type: "object",
                    properties: {
                        option: {
                            type: "object",
                            description: "ECharts 图表配置（option 对象），必须包含 series 字段。示例：{title:{text:'销售数据'},xAxis:{type:'category',data:['A','B','C']},yAxis:{type:'value'},series:[{type:'bar',data:[10,20,30]}]}"
                        },
                        height: {
                            type: "number",
                            description: "图表高度（像素），默认300"
                        }
                    },
                    required: ["option"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "run_termux_command",
                description: "在 Termux 终端环境中执行命令（Linux 环境）。与 execute_command 不同，本工具在 Termux 的完整 Linux 环境中运行，支持 apt/pip/node/python/git 等所有 Termux 包。适用于编译项目、安装软件包、运行脚本等需要完整 Linux 环境的场景。使用前需确保设备已安装 Termux 并完成配置。",
                parameters: {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                            description: "要执行的命令"
                        },
                        workdir: {
                            type: "string",
                            description: "工作目录（Termux 内路径，如 /data/data/com.termux/files/home 或 /sdcard/Download），不传则使用 Termux Home"
                        },
                        timeout: {
                            type: "number",
                            description: "超时时间（秒），默认60"
                        },
                        background: {
                            type: "boolean",
                            description: "是否后台执行（后台执行才能获取 stdout/stderr），默认 true"
                        }
                    },
                    required: ["command"]
                }
            }
        });

        // Git 操作工具
        tools.push({
            type: "function",
            function: {
                name: "git",
                description: "执行 Git 操作。支持 clone（克隆仓库）、init（初始化）、status（查看状态）、add（暂存）、commit（提交）、push（推送）、pull（拉取）、log（日志）、diff（差异）、branch（分支管理）、checkout（切换分支）、addremote（添加远程）、remote（列出远程）、reset（重置工作区/暂存区）、clean（删除未跟踪文件）。用户会提供 token 用于私有仓库认证。",
                parameters: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: ["clone", "init", "status", "add", "commit", "push", "pull", "log", "diff", "branch", "checkout", "addremote", "remote", "reset", "clean"],
                            description: "Git 操作类型"
                        },
                        url: {
                            type: "string",
                            description: "远程仓库 URL（clone / addremote 时需要）"
                        },
                        path: {
                            type: "string",
                            description: "本地仓库路径（clone 时为目标路径，其他操作时为仓库路径）"
                        },
                        message: {
                            type: "string",
                            description: "提交信息（commit 时需要）"
                        },
                        token: {
                            type: "string",
                            description: "访问令牌（私有仓库认证用，用户会提供）"
                        },
                        username: {
                            type: "string",
                            description: "认证用户名，默认 'token'（GitHub 用 token 认证时填 token）"
                        },
                        branch: {
                            type: "string",
                            description: "分支名（clone / branch / checkout 时使用）"
                        },
                        pattern: {
                            type: "string",
                            description: "要添加的文件模式，默认 '.'（全部），如 'src/*.java'"
                        },
                        max: {
                            type: "number",
                            description: "log 时返回的最大提交数，默认 20"
                        },
                        remoteName: {
                            type: "string",
                            description: "远程仓库名（addremote 时使用），默认 'origin'"
                        },
                        list: {
                            type: "boolean",
                            description: "branch 操作时，true 表示列出所有分支"
                        },
                        force: {
                            type: "boolean",
                            description: "checkout 时是否强制（丢弃本地修改）"
                        },
                        mode: {
                            type: "string",
                            description: "reset 的模式：hard（重置工作区和暂存区，默认）、soft（只移动 HEAD）、mixed（移动 HEAD 并重置暂存区）",
                            enum: ["hard", "soft", "mixed"]
                        },
                        ref: {
                            type: "string",
                            description: "reset 的目标引用，默认 'HEAD'"
                        },
                        cleanDirectories: {
                            type: "boolean",
                            description: "clean 时是否删除未跟踪的目录，默认 true"
                        }
                    },
                    required: ["action", "path"]
                }
            }
        });
    }

    // 合并 MCP Server 提供的工具
    if (mcpActive && typeof getMcpToolDefinitions === 'function') {
        const mcpTools = getMcpToolDefinitions();
        if (mcpTools && mcpTools.length > 0) {
            tools.push(...mcpTools);
            console.log('[ToolCalling] 已合并 ' + mcpTools.length + ' 个 MCP 工具');
        }
    }

    return tools.length > 0 ? tools : null;
}

/**
 * 判断当前服务商是否使用 function calling 方式的联网搜索
 * @returns {boolean}
 */
function isFunctionCallingProvider() {
    if (FUNCTION_CALLING_PROVIDERS.includes(currentAIProvider)) return true;
    // 自定义服务商检查 refProvider
    if (currentAIProvider && currentAIProvider.startsWith('custom_')) {
        const cp = typeof customProviders !== 'undefined' && customProviders.find(p => p.id === currentAIProvider);
        if (cp && cp.refProvider && FUNCTION_CALLING_PROVIDERS.includes(cp.refProvider)) return true;
    }
    return false;
}

/**
 * 判断当前是否有 MCP 工具可用（独立于服务商是否支持 function calling）
 */
function hasMcpToolsAvailable() {
    return typeof hasMcpTools === 'function' && hasMcpTools();
}

/**
 * 判断当前是否启用了 function calling 联网搜索
 * @returns {boolean}
 */
function isToolCallingActive() {
    // MCP 工具可用时，即使没开专家模式/联网搜索也激活
    if (hasMcpToolsAvailable() && isFunctionCallingProvider()) return true;
    return (expertModeEnabled || webSearchEnabled) && isFunctionCallingProvider();
}

// ==================== 本地搜索（通过 AndroidBridge） ====================

/**
 * 通过 AndroidBridge 原生 HTTP 获取网页内容
 * @param {string} url - 请求的 URL
 * @returns {string} HTML 内容或错误 JSON
 */
function nativeHttpGet(url) {
    // 百度/必应/360用 XMLHttpRequest 同步请求（WebView环境，不会被反爬）
    if (url.includes('baidu.com') || url.includes('bing.com') || url.includes('so.com')) {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, false); // false = 同步
            xhr.setRequestHeader('User-Agent', navigator.userAgent);
            xhr.send();
            if (xhr.status === 200) {
                return xhr.responseText;
            }
            console.log('[ToolCalling] 百度XHR失败:', xhr.status);
        } catch (e) {
            console.log('[ToolCalling] 百度XHR异常:', e.message);
        }
        // 失败则回退到原生请求
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.httpGet === 'function') {
        return window.AndroidBridge.httpGet(url);
    }
    return null;
}

/**
 * 从百度搜索 HTML 中解析搜索结果
 * @param {string} html - 百度搜索结果页 HTML
 * @returns {Array<{title, snippet, url}>}
 */
function parseBaiduResults(html) {
    const results = [];
    try {
        // 百度新版 PC 结构：h3 标题 + 兄弟容器中的摘要和来源
        const h3Regex = /<h3[^>]*>([\s\S]*?)<\/h3>/g;
        let match;
        
        while ((match = h3Regex.exec(html)) !== null && results.length < 8) {
            const h3Content = match[1];
            // 提取链接和标题
            const linkMatch = h3Content.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
            if (!linkMatch) continue;
            
            const url = linkMatch[1];
            const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
            if (!title) continue;
            
            // 扩大搜索范围到 h3 后面 3000 字符（新版百度内容在兄弟容器中）
            const afterH3 = html.substring(match.index + match[0].length, match.index + match[0].length + 3000);
            let snippet = '';
            
            // 新版百度：摘要在 <!--s-text-->...<!--/s-text--> 中
            const sTextMatch = afterH3.match(/<!--s-text-->([\s\S]*?)<!--\/s-text-->/);
            if (sTextMatch && sTextMatch[1]) {
                snippet = sTextMatch[1].replace(/<[^>]*>/g, '').trim();
            }
            // 旧版百度：摘要可能在 c-abstract 等标签中
            if (!snippet) {
                const snippetPatterns = [
                    /class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/,
                    /class="[^"]*content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/
                ];
                for (const pat of snippetPatterns) {
                    const sm = afterH3.match(pat);
                    if (sm && sm[1]) {
                        snippet = sm[1].replace(/<[^>]*>/g, '').trim();
                        if (snippet) break;
                    }
                }
            }
            
            // 提取来源名称（新版百度在 source_ 标签中）
            let sourceName = '';
            const sourceMatch = afterH3.match(/class="source_[^"']*"[^>]*>([\s\S]*?)<\/a>/);
            if (sourceMatch && sourceMatch[1]) {
                sourceName = sourceMatch[1].replace(/<[^>]*>/g, '').trim();
            }
            
            // 提取真实来源 URL
            let realUrl = url;
            // 先从 h3 前面的容器中查找 mu 属性
            const containerBefore = html.substring(Math.max(0, match.index - 500), match.index);
            const muMatch = containerBefore.match(/mu="([^"]+)"/);
            if (muMatch && muMatch[1] && !muMatch[1].includes('baidu.com')) {
                realUrl = muMatch[1];
            } else {
                // 尝试从 h3 后面提取 cite 或 showurl（旧版百度）
                const showUrlPatterns = [
                    /<cite[^>]*>([\s\S]*?)<\/cite>/,
                    /class="[^"]*c-showurl[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/
                ];
                for (const pat of showUrlPatterns) {
                    const um = afterH3.match(pat);
                    if (um && um[1]) {
                        const cleanUrl = um[1].replace(/<[^>]*>/g, '').trim();
                        if (cleanUrl && !cleanUrl.includes('baidu.com')) {
                            realUrl = cleanUrl.startsWith('http') ? cleanUrl : 'https://' + cleanUrl;
                            break;
                        }
                    }
                }
            }
            // 如果还是百度跳转链接，用来源名称替代
            if ((realUrl.includes('baidu.com/link') || realUrl.includes('baidu.com/baidu.php')) && sourceName) {
                realUrl = sourceName;
            }
            
            results.push({ title, snippet, url: realUrl, sourceName });
        }
        
        // 方式2：如果 h3 没提取到，用更宽松的方式匹配所有含链接的标题
        if (results.length === 0) {
            const looseRegex = /<a[^>]*href="(https?:\/\/[^"baidu][^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
            while ((match = looseRegex.exec(html)) !== null && results.length < 8) {
                const url = match[1];
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                if (title && title.length > 4 && !title.includes('百度')) {
                    results.push({ title, snippet: '', url });
                }
            }
        }
        
        console.log('[ToolCalling] 百度解析结果:', results.length, '条');
    } catch (e) {
        console.error('[ToolCalling] 解析百度结果失败:', e);
    }
    return results;
}

/**
 * 从必应搜索 HTML 中解析搜索结果
 * @param {string} html - 必应搜索结果页 HTML
 * @returns {Array<{title, snippet, url}>}
 */
/**
 * 从360搜索 HTML 中解析搜索结果
 */
function parse360Results(html) {
    const results = [];
    try {
        // 移动版360搜索结果在 <div class="g-card res-list og">（og=organic自然结果）
        const divRegex = /<div[^>]*class="[^"]*res-list[^"]*og[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*res-list|<div[^>]*class="[^"]*res-list[^"]*og[^"]*"[^>]*>([\s\S]*?)<script/g;
        // 用更简单的方式：直接找 res-title
        const titleRegex = /<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/g;
        let match;
        
        while ((match = titleRegex.exec(html)) !== null && results.length < 8) {
            const titleRaw = match[1].replace(/<[^>]*>/g, '').trim();
            // 跳过广告/推荐类标题
            if (!titleRaw || titleRaw.includes('猜您关注') || titleRaw.includes('在线极速问医生')) continue;
            
            // 在标题前后找链接和摘要
            const aroundStart = Math.max(0, match.index - 500);
            const aroundEnd = Math.min(html.length, match.index + 1000);
            const block = html.substring(aroundStart, aroundEnd);
            
            // 提取链接：优先 data-pcurl，其次 href
            let url = '';
            const pcurlMatch = block.match(/data-pcurl="([^"]*)"/);
            if (pcurlMatch) {
                url = pcurlMatch[1];
            } else {
                const hrefMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>\s*<h3/);
                if (hrefMatch) url = hrefMatch[1];
            }
            
            // 提取摘要
            let snippet = '';
            const summaryMatch = block.match(/<p[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/p>/);
            if (summaryMatch && summaryMatch[1]) {
                snippet = summaryMatch[1].replace(/<[^>]*>/g, '').trim();
            }
            
            if (titleRaw && url) {
                results.push({ title: titleRaw, snippet, url });
            }
        }
    } catch (e) {
        console.error('[ToolCalling] 解析360结果失败:', e);
    }
    return results;
}

function parseBingResults(html) {
    const results = [];
    try {
        // 必应搜索结果在 <li class="b_algo">
        const liRegex = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
        let match;
        
        while ((match = liRegex.exec(html)) !== null && results.length < 8) {
            const block = match[1];
            
            // 提取标题和链接
            const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
            if (!titleMatch) continue;
            
            const url = titleMatch[1];
            const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
            
            // 提取摘要：优先从 b_caption 区域提取完整内容
            let snippet = '';
            // 方式1：b_caption 区域（包含摘要和来源信息）
            const captionMatch = block.match(/class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
            if (captionMatch && captionMatch[1]) {
                // 从 caption 中提取所有 <p> 和 <span> 的文本
                const texts = [];
                const pRegex = /<(?:p|span)[^>]*>([\s\S]*?)<\/(?:p|span)>/g;
                let pm;
                while ((pm = pRegex.exec(captionMatch[1])) !== null) {
                    const t = pm[1].replace(/<[^>]*>/g, '').trim();
                    if (t && t.length > 2) texts.push(t);
                }
                snippet = texts.join(' ');
            }
            // 方式2：直接提取所有 <p> 标签
            if (!snippet) {
                const pTexts = [];
                const pRegex2 = /<p[^>]*>([\s\S]*?)<\/p>/g;
                let pm2;
                while ((pm2 = pRegex2.exec(block)) !== null) {
                    const t = pm2[1].replace(/<[^>]*>/g, '').trim();
                    if (t && t.length > 2) pTexts.push(t);
                }
                snippet = pTexts.join(' ');
            }
            // 方式3：提取 b_line 区域（新闻类结果的摘要）
            if (!snippet) {
                const lineMatch = block.match(/class="[^"]*b_line[^"]*"[^>]*>([\s\S]*?)<\/div>/);
                if (lineMatch && lineMatch[1]) {
                    snippet = lineMatch[1].replace(/<[^>]*>/g, '').trim();
                }
            }
            
            if (title && url) {
                results.push({ title, snippet, url });
            }
        }
    } catch (e) {
        console.error('[ToolCalling] 解析必应结果失败:', e);
    }
    return results;
}

/**
 * 执行网页搜索（必应优先，失败回退百度）
 * @param {string[]} queries - 搜索关键词数组
 * @param {string} timeRange - 时间范围过滤: day/week/month/year
 * @returns {Promise<string>} 格式化的搜索结果文本
 */
async function executeWebSearch(queries, timeRange, engine) {
    try {
        // 必应时间过滤参数
        const bingTimeFilters = { day: 'ex1:ez5', week: 'ex1:ez2', month: 'ex1:ez3', year: 'ex1:ez1' };
        const bingTimeParam = bingTimeFilters[timeRange] ? `&filters=${bingTimeFilters[timeRange]}` : '';
        // 百度时间过滤参数
        const baiduTimeParams = { day: '&gpc=stf=1', week: '&gpc=stf=7', month: '&gpc=stf=30', year: '&gpc=stf=365' };
        const baiduTimeParam = baiduTimeParams[timeRange] || '';

        const allResults = [];
        let searchEngine = '';
        const seenUrls = new Set();

        const selectedEngine = engine || 'bing';

        for (let qi = 0; qi < queries.length; qi++) {
            const query = queries[qi];
            // 多个关键词之间间隔5秒，降低被反爬标记的风险
            if (qi > 0) {
                console.log('[ToolCalling] 等待5秒后搜索下一个关键词...');
                await new Promise(r => setTimeout(r, 5000));
            }
            // 去掉空格拼接后取前14个字（中文算1字，英文算0.5字）
            const noSpace = query.replace(/\s+/g, '');
            let charCount = 0;
            let encodedQuery = '';
            for (const ch of noSpace) {
                charCount += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.5;
                if (charCount > 14) break;
                encodedQuery += ch;
            }
            let results = [];

            if (selectedEngine === '360') {
                // 360优先
                console.log('[ToolCalling] 360搜索:', query, timeRange ? `(${timeRange})` : '');
                const soHtml = nativeHttpGet(`https://www.so.com/s?q=${encodedQuery}`);
                
                if (soHtml && !soHtml.startsWith('{"error"')) {
                    results = parse360Results(soHtml);
                    if (results.length > 0 && !searchEngine) searchEngine = '360';
                }

                // 360失败，回退必应
                if (results.length === 0) {
                    console.log('[ToolCalling] 360无结果，尝试必应搜索');
                    const bingHtml = nativeHttpGet(`https://cn.bing.com/search?q=${encodedQuery}${bingTimeParam}`);
                    
                    if (bingHtml && !bingHtml.startsWith('{"error"')) {
                        results = parseBingResults(bingHtml);
                        if (results.length > 0 && !searchEngine) searchEngine = '必应';
                    }
                }
            } else {
                // 必应优先（默认）
                console.log('[ToolCalling] 必应搜索:', query, timeRange ? `(${timeRange})` : '');
                const bingHtml = nativeHttpGet(`https://cn.bing.com/search?q=${encodedQuery}${bingTimeParam}`);
                
                if (bingHtml && !bingHtml.startsWith('{"error"')) {
                    results = parseBingResults(bingHtml);
                    if (results.length > 0 && !searchEngine) searchEngine = '必应';
                }

                // 必应失败或无结果，回退360
                if (results.length === 0) {
                    console.log('[ToolCalling] 必应无结果，尝试360搜索');
                    const soHtml = nativeHttpGet(`https://www.so.com/s?q=${encodedQuery}`);
                    
                    if (soHtml && !soHtml.startsWith('{"error"')) {
                        results = parse360Results(soHtml);
                        if (results.length > 0 && !searchEngine) searchEngine = '360';
                    }
                }
            }

            // 每个关键词最多5条，去重
            let count = 0;
            for (const r of results) {
                if (count >= 10) break;
                // 用 URL 去重（百度跳转链接用原始链接去重）
                const dedupeKey = r.url || r.title;
                if (seenUrls.has(dedupeKey)) continue;
                seenUrls.add(dedupeKey);
                r._query = query;
                allResults.push(r);
                count++;
            }
        }

        // 全部失败
        if (allResults.length === 0) {
            if (!window.AndroidBridge || typeof window.AndroidBridge.httpGet !== 'function') {
                return '搜索失败：当前环境不支持原生 HTTP 请求（AndroidBridge.httpGet 不可用）。此功能需要在 Android App 中使用。';
            }
            return '未找到相关搜索结果。';
        }

        // 格式化搜索结果
        const keywordsStr = queries.join('、');
        let formatted = `搜索关键词：${keywordsStr}（通过${searchEngine || '混合'}搜索）\n找到 ${allResults.length} 条结果\n\n`;
        allResults.forEach((item, i) => {
            formatted += `[${i + 1}] ${item.title}\n`;
            if (item.snippet) {
                formatted += `  ${item.snippet}\n`;
            }
            // 显示来源
            const isBaiduRedirect = item.url && (item.url.includes('baidu.com/link') || item.url.includes('baidu.com/baidu.php'));
            if (item.sourceName) {
                formatted += `  来源：${item.sourceName}\n`;
            } else if (!isBaiduRedirect) {
                formatted += `  来源：${item.url}\n`;
            }
            if (isBaiduRedirect) {
                formatted += `  [链接]${item.url}\n`;
            }
            formatted += '\n';
        });

        return formatted;
    } catch (error) {
        console.error('[ToolCalling] 搜索执行失败:', error);
        return `搜索执行失败：${error.message}`;
    }
}

// ==================== 时间和位置 ====================

// 缓存 IP 定位结果
let _cachedLocation = null;
let _cachedLocationTime = 0;
const LOCATION_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

/**
 * 获取当前时间字符串
 */
function getCurrentTimeStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekDay = weekDays[now.getDay()];
    return `${y}年${m}月${d}日 星期${weekDay} ${h}:${min}`;
}

/**
 * 通过 IP 获取大致位置
 */
async function getIPLocation() {
    if (_cachedLocation && Date.now() - _cachedLocationTime < LOCATION_CACHE_TTL) {
        return _cachedLocation;
    }
    try {
        // ip-api.com 免费 JSON API，无需 Key，返回省市信息
        const json = nativeHttpGet('http://ip-api.com/json/?lang=zh-CN');
        if (json && !json.startsWith('{"error"')) {
            const data = JSON.parse(json);
            if (data.status === 'success') {
                const parts = [];
                if (data.country && data.country !== '中国') parts.push(data.country);
                if (data.regionName) parts.push(data.regionName);
                if (data.city) parts.push(data.city);
                if (parts.length > 0) {
                    _cachedLocation = parts.join('');
                    _cachedLocationTime = Date.now();
                    console.log('[ToolCalling] IP定位:', _cachedLocation);
                    return _cachedLocation;
                }
            }
        }
    } catch (e) {
        console.log('[ToolCalling] IP定位失败:', e);
    }
    return '';
}

/**
 * 执行 get_current_info 工具
 */
async function executeGetCurrentInfo() {
    const time = getCurrentTimeStr();
    const location = await getIPLocation();
    let result = `当前时间：${time}`;
    if (location) result += `\n当前位置：${location}`;
    return result;
}

// ==================== 网页内容提取 ====================

/**
 * 从 HTML 中提取正文内容（去除标签、脚本、样式等）
 * @param {string} html - 原始 HTML
 * @returns {string} 提取的正文文本
 */
function extractTextFromHtml(html) {
    try {
        // 移除 script、style、nav、footer、header 等无关标签
        let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
        text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
        text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
        text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');
        text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
        // 提取 <article> 或 <main> 内容（优先）
        const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
        const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        if (articleMatch) text = articleMatch[1];
        else if (mainMatch) text = mainMatch[1];
        // 移除所有 HTML 标签
        text = text.replace(/<[^>]+>/g, ' ');
        // 解码 HTML 实体
        text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        // 清理多余空白
        text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n');
        return text.trim();
    } catch (e) {
        return html.replace(/<[^>]+>/g, ' ').trim();
    }
}

/**
 * 执行 edit_file 工具
 * @param {string} path - 文件路径
 * @param {Array} edits - 编辑操作列表
 * @returns {string} 结果
 */
function executeEditFile(path, edits, planLog, confirmed) {
    try {
        if (!path) return '错误：缺少必填参数 path（文件路径）';
        path = resolvePath(path);
        if (!window.AndroidBridge) {
            return '错误：当前环境不支持文件操作';
        }

        const HINT_DEVICE = '\n【提示】如果你正在操作电脑上的文件，请在调用参数中添加 "device": "pc"，通过电脑端执行。';
        // 注意：如果报错 Bad escaped character in JSON / 无法读取文件，通常是没传 device:"pc" 参数（操作电脑文件时）

        // ========== 1. 读取文件（JS 层处理，不走 Java editFile） ==========
        let oldContent = '';
        try {
            const readResult = window.AndroidBridge.readFile(path, 'utf-8', 0, 0);
            const readData = JSON.parse(readResult);
            if (readData.error) return `${HINT_DEVICE}\n错误：无法读取文件 - ${readData.error}`;
            oldContent = (readData.lines || []).join('\n');
        } catch (e) {
            return `${HINT_DEVICE}\n错误：无法读取文件 - ${e.message}`;
        }

        // 统一换行符为 \n
        const normalizedContent = oldContent.replace(/\r\n/g, '\n');

        // ========== 2. 辅助函数 ==========
        function getLineStarts(text) {
            const starts = [];
            for (let i = 0; i < text.length; i++) {
                if (i === 0 || text[i - 1] === '\n') starts.push(i);
            }
            return starts;
        }

        function locateEdit(content, edit) {
            let { old_text, start_line, end_line } = edit;
            if (typeof old_text !== 'string' || !old_text) return { error: 'old_text 必须是非空字符串' };
            old_text = old_text.replace(/\r\n/g, '\n');
            let searchStart = 0, searchEnd = content.length;
            if (typeof start_line === 'number' && start_line >= 1) {
                const lineStarts = getLineStarts(content);
                if (start_line - 1 < lineStarts.length) searchStart = lineStarts[start_line - 1];
                if (typeof end_line === 'number' && end_line >= start_line) {
                    searchEnd = end_line < lineStarts.length ? lineStarts[end_line] : content.length;
                }
            }
            let idx = content.indexOf(old_text, searchStart);
            if (idx === -1 || idx >= searchEnd) {
                // 容错：忽略前导空白再尝试
                const trimmedOld = old_text.replace(/^[ \t]+/gm, '');
                if (trimmedOld !== old_text && trimmedOld.length > 0) {
                    const altIdx = content.indexOf(trimmedOld, searchStart);
                    if (altIdx !== -1 && altIdx < searchEnd) {
                        const altSecond = content.indexOf(trimmedOld, altIdx + 1);
                        if (altSecond !== -1 && altSecond < searchEnd) {
                            return { error: '容错匹配找到多处（忽略缩进后），请用 start_line/end_line 缩小搜索范围' };
                        }
                        const lineStart = content.lastIndexOf('\n', altIdx) + 1;
                        old_text = content.slice(lineStart, altIdx + trimmedOld.length);
                        idx = lineStart;
                    }
                }
                if (idx === -1 || idx >= searchEnd) {
                    const rangeInfo = typeof start_line === 'number'
                        ? `（搜索范围：第 ${start_line}-${end_line || '末尾'} 行）` : '';
                    let contextPreview = '';
                    try {
                        const ctx = content.slice(Math.max(0, searchStart - 200), Math.min(content.length, searchEnd + 200));
                        const lines = ctx.split('\n').slice(0, 30);
                        contextPreview = '\n实际文件内容（搜索区域）：\n' + lines.map((l, i) => `${i + 1}: ${l.slice(0, 120)}`).join('\n');
                    } catch (_) {}
                    return { error: `未找到匹配文本: "${old_text.slice(0, 80)}"${rangeInfo}${contextPreview}` };
                }
            }
            const secondIdx = content.indexOf(old_text, idx + 1);
            if (secondIdx !== -1 && secondIdx < searchEnd) {
                return { error: `找到多处匹配，请用 start_line/end_line 缩小范围: "${old_text.slice(0, 80)}"` };
            }
            return { idx, oldLen: old_text.length, new_text: (edit.new_text || '').replace(/\r\n/g, '\n') };
        }

        // ========== 3. 预检查所有 edits ==========
        const locatedEdits = [];
        for (let i = 0; i < edits.length; i++) {
            const result = locateEdit(normalizedContent, edits[i]);
            if (result.error) return `错误：第 ${i + 1} 个 edit - ${result.error}`;
            locatedEdits.push(result);
        }

        // ========== 4. 模拟替换 + diff ==========
        const sortedEdits = [...locatedEdits].sort((a, b) => b.idx - a.idx);
        let simulatedContent = normalizedContent;
        for (const { idx, oldLen, new_text } of sortedEdits) {
            simulatedContent = simulatedContent.slice(0, idx) + new_text + simulatedContent.slice(idx + oldLen);
        }
        const diff = computeDiff(oldContent, simulatedContent);

        // ========== 5. 未确认 → 返回预览 ==========
        if (!confirmed) {
            const summary = edits.map(e => {
                const o = (e.old_text || '').slice(0, 50).replace(/\n/g, ' ');
                const n = (e.new_text || '').slice(0, 50).replace(/\n/g, ' ');
                return `"${o}" → "${n}"`;
            }).join('; ');
            return JSON.stringify({
                needsConfirm: true,
                action: '编辑文件',
                target: path,
                contentPreview: summary,
                added: diff.stats ? diff.stats.added : 0,
                removed: diff.stats ? diff.stats.removed : 0,
                diffData: diff
            });
        }

        // ========== 6. 已确认 → 写回文件 ==========
        let finalContent = simulatedContent;
        if (oldContent.includes('\r\n')) {
            finalContent = finalContent.replace(/\n/g, '\r\n');
        }
        const writeResult = window.AndroidBridge.writeFile(path, finalContent);
        const writeData = JSON.parse(writeResult);
        if (writeData.error) return `错误：写入文件失败 - ${writeData.error}`;
        writePlanLog(planLog || `编辑文件：${path}`);
        return `文件已编辑：${path}（应用 ${locatedEdits.length} 处修改，+${diff.stats ? diff.stats.added : '?'} -${diff.stats ? diff.stats.removed : '?'} 行）`;
    } catch (e) {
        return `编辑文件失败：${e.message}`;
    }
}

/**
 * 执行 get_system_info 工具
 */
function executeGetSystemInfo(type) {
    try {
        if (!window.AndroidBridge || typeof window.AndroidBridge.getSystemInfo !== 'function') {
            return '错误：当前环境不支持（AndroidBridge.getSystemInfo 不可用）';
        }
        const jsonStr = window.AndroidBridge.getSystemInfo(type);
        const data = JSON.parse(jsonStr);
        if (data.error) return `错误：${data.error}`;
        let result = '';
        if (data.os) result += `系统：Android ${data.os.version} (SDK ${data.os.sdk})\n设备：${data.os.manufacturer} ${data.os.model}\n`;
        if (data.cpu) result += `CPU核心：${data.cpu.cores}\n`;
        if (data.memory) result += `内存：${data.memory.availableGB}GB 可用 / ${data.memory.totalGB}GB 总计\n`;
        if (data.disk) result += `存储：${data.disk.availableGB}GB 可用 / ${data.disk.totalGB}GB 总计\n`;
        return result.trim();
    } catch (e) {
        return `获取系统信息失败：${e.message}`;
    }
}

/**
 * 执行 search_content 工具
 */
function executeSearchContent(directory, pattern, include, maxResults) {
    try {
        if (!directory || !pattern) return '错误：缺少必填参数 directory 或 pattern';
        if (!window.AndroidBridge || typeof window.AndroidBridge.searchContent !== 'function') {
            return '错误：当前环境不支持文件操作（AndroidBridge.searchContent 不可用）';
        }
        const jsonStr = window.AndroidBridge.searchContent(directory, pattern, include, maxResults);
        const data = JSON.parse(jsonStr);
        if (data.error) {
            return `错误：${data.error}`;
        }
        if (data.results.length === 0) {
            return `在 ${directory} 中未找到匹配 "${pattern}" 的内容`;
        }
        let result = `搜索目录：${directory}，关键词：${pattern}\n\n`;
        data.results.forEach(r => {
            result += `${r.file}:${r.line}: ${r.content}\n`;
        });
        result += `\n共 ${data.results.length} 个匹配`;
        return result;
    } catch (e) {
        return `搜索内容失败：${e.message}`;
    }
}

/**
 * 执行 search_files 工具
 * @param {string} directory - 搜索根目录
 * @param {string} pattern - 通配符模式
 * @returns {string} 结果
 */
function executeSearchFiles(directory, pattern) {
    try {
        if (!directory || !pattern) return '错误：缺少必填参数 directory 或 pattern';
        if (!window.AndroidBridge || typeof window.AndroidBridge.searchFiles !== 'function') {
            return '错误：当前环境不支持文件操作（AndroidBridge.searchFiles 不可用）';
        }
        const jsonStr = window.AndroidBridge.searchFiles(directory, pattern);
        const data = JSON.parse(jsonStr);
        if (data.error) {
            return `错误：${data.error}`;
        }
        if (data.results.length === 0) {
            return `在 ${directory} 中未找到匹配 "${pattern}" 的文件`;
        }
        let result = `搜索目录：${data.directory}，模式：${pattern}\n\n`;
        data.results.forEach(entry => {
            const icon = entry.type === 'directory' ? '📁' : '📄';
            const sizeStr = entry.size ? ` (${formatFileSize(entry.size)})` : '';
            result += `${icon} ${entry.path}${sizeStr}\n`;
        });
        result += `\n共 ${data.results.length} 个结果`;
        return result;
    } catch (e) {
        return `搜索文件失败：${e.message}`;
    }
}

/**
 * 执行 get_file_info 工具
 * @param {string} path - 文件路径
 * @returns {string} 结果
 */
function executeGetFileInfo(path) {
    try {
        if (!path) return '错误：缺少必填参数 path（文件路径）';
        if (!window.AndroidBridge || typeof window.AndroidBridge.getFileInfo !== 'function') {
            return '错误：当前环境不支持文件操作（AndroidBridge.getFileInfo 不可用）';
        }
        const jsonStr = window.AndroidBridge.getFileInfo(path);
        const data = JSON.parse(jsonStr);
        if (data.error) {
            return `错误：${data.error}`;
        }
        const modDate = new Date(data.modified);
        let result = `路径：${data.path}\n`;
        result += `类型：${data.type === 'directory' ? '目录' : '文件'}\n`;
        if (data.type === 'file') result += `大小：${formatFileSize(data.size)}\n`;
        result += `修改时间：${modDate.toLocaleString()}\n`;
        result += `可读：${data.readable ? '是' : '否'}\n`;
        result += `可写：${data.writable ? '是' : '否'}`;
        return result;
    } catch (e) {
        return `获取文件信息失败：${e.message}`;
    }
}

/**
 * 执行 move_file / copy_file 工具
 * @param {string} src - 源路径
 * @param {string} dst - 目标路径
 * @param {boolean} isCopy - true=复制，false=移动
 * @returns {string} 结果
 */
function executeMoveOrCopyFile(src, dst, isCopy) {
    try {
        if (!src || !dst) return '错误：缺少必填参数 src 或 dst（文件路径）';
        if (!window.AndroidBridge || typeof window.AndroidBridge.moveOrCopyFile !== 'function') {
            return '错误：当前环境不支持文件操作（AndroidBridge.moveOrCopyFile 不可用）';
        }
        const jsonStr = window.AndroidBridge.moveOrCopyFile(src, dst, isCopy);
        const data = JSON.parse(jsonStr);
        if (data.error) {
            return `错误：${data.error}`;
        }
        return `文件已${isCopy ? '复制' : '移动'}：${data.src} → ${data.dst}`;
    } catch (e) {
        return `${isCopy ? '复制' : '移动'}文件失败：${e.message}`;
    }
}

/**
 * 执行 create_directory 工具
 * @param {string} path - 目录路径
 * @returns {string} 结果
 */
function executeCreateDirectory(path) {
    try {
        if (!path) return '错误：缺少必填参数 path（目录路径）';
        if (!window.AndroidBridge || typeof window.AndroidBridge.createDirectory !== 'function') {
            return '错误：当前环境不支持文件操作（AndroidBridge.createDirectory 不可用）';
        }
        const jsonStr = window.AndroidBridge.createDirectory(path);
        const data = JSON.parse(jsonStr);
        if (data.error) {
            return `错误：${data.error}`;
        }
        return `目录已创建：${data.path}`;
    } catch (e) {
        return `创建目录失败：${e.message}`;
    }
}

/**
 * 执行 write_file 工具
 * @param {string} path - 文件路径
 * @param {string} content - 文件内容
 * @returns {string} 结果
 */
function resolvePath(path) {
    if (!path) return path;
    // 已经是绝对路径，直接返回
    if (path.startsWith('/')) return path;
    // 相对路径，拼接工作目录
    const workPath = localStorage.getItem('cnai_work_path');
    if (workPath) {
        return workPath + '/' + path;
    }
    return path;
}

/**
 * 简单行级 diff：对比旧内容和新内容，返回变更行
 */
function computeDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const lines = [];
    let added = 0, removed = 0;
    let oi = 0, ni = 0;
    while (oi < oldLines.length || ni < newLines.length) {
        if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
            lines.push({ type: 'ctx', line: ni + 1, content: oldLines[oi] });
            oi++; ni++;
        } else {
            let foundInNew = -1;
            for (let k = ni + 1; k < newLines.length; k++) {
                if (oldLines[oi] === newLines[k]) { foundInNew = k; break; }
            }
            let foundInOld = -1;
            for (let k = oi + 1; k < oldLines.length; k++) {
                if (newLines[ni] === oldLines[k]) { foundInOld = k; break; }
            }
            if (foundInNew >= 0 && (foundInOld < 0 || foundInNew - ni <= foundInOld - oi)) {
                while (ni < foundInNew) {
                    lines.push({ type: 'add', line: ni + 1, content: newLines[ni] });
                    added++; ni++;
                }
            } else if (foundInOld >= 0) {
                while (oi < foundInOld) {
                    lines.push({ type: 'del', line: oi + 1, content: oldLines[oi] });
                    removed++; oi++;
                }
            } else if (oi < oldLines.length && ni < newLines.length) {
                lines.push({ type: 'del', line: oi + 1, content: oldLines[oi] });
                removed++;
                lines.push({ type: 'add', line: ni + 1, content: newLines[ni] });
                added++;
                oi++; ni++;
            } else if (oi < oldLines.length) {
                lines.push({ type: 'del', line: oi + 1, content: oldLines[oi] });
                removed++; oi++;
            } else {
                lines.push({ type: 'add', line: ni + 1, content: newLines[ni] });
                added++; ni++;
            }
        }
    }
    return { lines, stats: { added, removed } };
}

/**
 * 生成 diff 预览 HTML
 * 本地和 PC 端 computeDiff 返回相同格式（全量 lines + stats）
 * 这里统一做 ±3 行上下文过滤
 */
function buildDiffHtml(diffData) {
    if (!diffData || !diffData.lines || diffData.lines.length === 0) {
        return '<div class="confirm-preview">无变更</div>';
    }
    let html = '<div class="confirm-diff-body">';
    // 如果数据含 sep 分隔符，说明已过滤过上下文（PC 端），直接渲染
    const hasSep = diffData.lines.some(l => l.type === 'sep');
    if (hasSep) {
        for (const line of diffData.lines) {
            if (line.type === 'sep') {
                html += '<div class="confirm-diff-sep"></div>';
                continue;
            }
            const cls = line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : 'ctx';
            const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
            html += '<div class="confirm-diff-line ' + cls + '"><span class="confirm-diff-num">' + (line.line != null ? line.line : '') + '</span><span class="confirm-diff-code">' + prefix + ' ' + escapeHtml(line.content != null ? line.content : '') + '</span></div>';
        }
    } else {
        // 本地数据：需过滤上下文
        const CONTEXT = 3;
        const showIndices = new Set();
        diffData.lines.forEach((line, i) => {
            if (line.type !== 'ctx') {
                for (let j = Math.max(0, i - CONTEXT); j <= Math.min(diffData.lines.length - 1, i + CONTEXT); j++) {
                    showIndices.add(j);
                }
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
            const cls = line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : 'ctx';
            const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
            html += '<div class="confirm-diff-line ' + cls + '"><span class="confirm-diff-num">' + line.line + '</span><span class="confirm-diff-code">' + prefix + ' ' + escapeHtml(line.content) + '</span></div>';
        }
    }
    html += '</div>';
    return html;
}

/**
 * 展示确认卡片，返回 Promise<string>
 */
function showConfirmCard(tc, toolArgs, confirmInfo, chatContainer, onConfirm) {
    return new Promise((resolve) => {
        const card = document.createElement('div');
        card.className = 'confirm-card';
        const desc = `${confirmInfo.action}: ${confirmInfo.target}`;
        const diffHtml = buildDiffHtml(confirmInfo.diffData);
        const stats = confirmInfo.diffData?.stats || { added: 0, removed: 0 };
        card.innerHTML = `
            <div class="confirm-title">⚠️ AI 请求执行操作</div>
            <div class="confirm-desc">${escapeHtml(desc)}</div>
            ${diffHtml}
            <div class="confirm-actions">
                <button class="confirm-btn confirm-allow">✅ 允许执行</button>
                <button class="confirm-btn confirm-reject">❌ 拒绝</button>
            </div>
        `;
        chatContainer.appendChild(card);
        onConfirmCardShow();


        card.querySelector('.confirm-allow').addEventListener('click', async () => {
            onConfirmCardClose();
            const actionsDiv = card.querySelector('.confirm-actions');
            actionsDiv.innerHTML = '<span class="confirm-status">执行中...</span>';

            // 如果有外部确认回调（如PC端工具），由回调处理
            if (typeof onConfirm === 'function') {
                // 原地替换为折叠 diff 卡片
                const fileName = confirmInfo.target.split(/[\/\\]/).pop();
                card.className = 'diff-card expanded';
                card.innerHTML = `
                    <div class="diff-header">
                        <span class="diff-filename">${escapeHtml(fileName)}</span>
                        <span class="diff-stats"><span class="diff-add">+${stats.added}</span> <span class="diff-del">-${stats.removed}</span></span>
                        <span class="diff-toggle">▼</span>
                    </div>
                    <div class="diff-body">${diffHtml}</div>
                `;
                card.querySelector('.diff-header').addEventListener('click', () => {
                    card.classList.toggle('expanded');
                    const toggle = card.querySelector('.diff-toggle');
                    toggle.textContent = card.classList.contains('expanded') ? '▼' : '▶';
                });
                // 外部回调负责执行，结果用来 resolve
                let finalResult = await onConfirm({ diffHtml, stats, target: confirmInfo.target });
                // 把 diffHtml/diffMeta 挂到 result 上，供保存到 messages（与本地工具分支一致）
                try {
                    const parsed = typeof finalResult === 'string' ? JSON.parse(finalResult) : finalResult;
                    if (parsed && typeof parsed === 'object') {
                        parsed._diffHtml = diffHtml;
                        parsed._diffMeta = { path: confirmInfo.target, added: stats.added, removed: stats.removed };
                        finalResult = JSON.stringify(parsed);
                    }
                } catch (e) {
                    // result 不是 JSON（如 "文件已编辑：xxx"），包装成 JSON
                    finalResult = JSON.stringify({ success: true, message: finalResult, _diffHtml: diffHtml, _diffMeta: { path: confirmInfo.target, added: stats.added, removed: stats.removed } });
                }
                resolve(finalResult);
                return;
            }

            // 本地工具：确认后重新执行
            const confirmedArgs = { ...toolArgs, _confirmed: true };
            const confirmedTc = { ...tc, function: { ...tc.function, arguments: JSON.stringify(confirmedArgs) } };
            let result = await executeToolCall(confirmedTc);
            // 原地替换为折叠 diff 卡片（和PC端一样）
            const fileName = confirmInfo.target.split('/').pop();
            card.className = 'diff-card expanded';
            card.innerHTML = `
                <div class="diff-header">
                    <span class="diff-filename">${escapeHtml(fileName)}</span>
                    <span class="diff-stats"><span class="diff-add">+${stats.added}</span> <span class="diff-del">-${stats.removed}</span></span>
                    <span class="diff-toggle">▼</span>
                </div>
                <div class="diff-body">${diffHtml}</div>
            `;
            card.querySelector('.diff-header').addEventListener('click', () => {
                card.classList.toggle('expanded');
                const toggle = card.querySelector('.diff-toggle');
                toggle.textContent = card.classList.contains('expanded') ? '▼' : '▶';
            });
            // 把 diffHtml/diffMeta 挂到 result 上，供保存到 messages
            try {
                const parsed = typeof result === 'string' ? JSON.parse(result) : result;
                if (parsed && typeof parsed === 'object') {
                    parsed._diffHtml = diffHtml;
                    parsed._diffMeta = { path: confirmInfo.target, added: stats.added, removed: stats.removed };
                    result = JSON.stringify(parsed);
                }
            } catch (e) {
                // result 不是 JSON（如 "文件已写入：xxx"），包装成 JSON
                result = JSON.stringify({ success: true, message: result, _diffHtml: diffHtml, _diffMeta: { path: confirmInfo.target, added: stats.added, removed: stats.removed } });
            }
            resolve(result);
        });

        card.querySelector('.confirm-reject').addEventListener('click', () => {
            onConfirmCardClose();
            card.querySelector('.confirm-actions').innerHTML = '<span class="confirm-status rejected">已拒绝</span>';
            card.classList.add('confirm-done');
            resolve(JSON.stringify({ error: `用户拒绝执行: ${desc}`, rejected: true }));
        });
    });
}

/**
 * 简单确认卡片（无 diff），返回 Promise<string>
 */
function showSimpleConfirm(action, target, chatContainer, onConfirm) {
    return new Promise((resolve) => {
        const card = document.createElement('div');
        card.className = 'confirm-card';
        const desc = `${action}: ${target}`;
        card.innerHTML = `
            <div class="confirm-title">⚠️ AI 请求在电脑端执行操作</div>
            <div class="confirm-desc">${escapeHtml(desc)}</div>
            <div class="confirm-actions">
                <button class="confirm-btn confirm-allow">✅ 允许执行</button>
                <button class="confirm-btn confirm-reject">❌ 拒绝</button>
            </div>
        `;
        chatContainer.appendChild(card);
        onConfirmCardShow();


        card.querySelector('.confirm-allow').addEventListener('click', async () => {
            onConfirmCardClose();
            card.querySelector('.confirm-actions').innerHTML = '<span class="confirm-status">执行中...</span>';
            const result = await onConfirm();
            card.querySelector('.confirm-status').textContent = '✅ 已执行';
            resolve(result);
        });

        card.querySelector('.confirm-reject').addEventListener('click', () => {
            onConfirmCardClose();
            card.querySelector('.confirm-actions').innerHTML = '<span class="confirm-status rejected">已拒绝</span>';
            card.classList.add('confirm-done');
            resolve(JSON.stringify({ error: `用户拒绝执行: ${desc}`, rejected: true }));
        });
    });
}

/**
 * 写入 plan_log 到日志文件
 * @param {string} logText - 日志内容
 */
function writePlanLog(logText) {
    if (!logText || !logText.trim()) return;
    try {
        if (!window.AndroidBridge || typeof window.AndroidBridge.appendToFile !== 'function') return;
        const downloadPath = window.AndroidBridge.getDownloadsPath ? window.AndroidBridge.getDownloadsPath() : '/storage/emulated/0/Download';
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const logPath = `${downloadPath}/Bluox/Notes/日志_${dateStr}.md`;
        const dateDisplay = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        // 检查文件是否存在，不存在则先写标题行
        const infoStr = window.AndroidBridge.getFileInfo(logPath);
        const info = JSON.parse(infoStr);
        if (info.error) {
            window.AndroidBridge.appendToFile(logPath, `日志_${dateStr}`);
        }
        const entry = `[${dateDisplay} ${timeStr}] ${logText}`;
        window.AndroidBridge.appendToFile(logPath, entry);
    } catch (e) {
        console.error('[ToolCalling] 写入日志失败:', e);
    }
}

function executeWriteFile(path, content, planLog, confirmed) {
    try {
        if (!path) return '错误：缺少必填参数 path（文件路径）';
        path = resolvePath(path);
        if (!window.AndroidBridge || typeof window.AndroidBridge.writeFile !== 'function') {
            return '错误：当前环境不支持文件操作（AndroidBridge.writeFile 不可用）\n【提示】如果你正在操作电脑上的文件，请在调用参数中添加 "device": "pc"，通过电脑端执行。';
        }
        // 未确认时：生成 diff 预览，返回 needsConfirm
        if (!confirmed) {
            let oldContent = '';
            try {
                const readResult = window.AndroidBridge.readFile(path, 'utf-8', 0, 0);
                const readData = JSON.parse(readResult);
                if (!readData.error) oldContent = (readData.lines || []).join('\n');
            } catch (e) { /* 文件不存在 */ }
            const diff = computeDiff(oldContent, content);
            return JSON.stringify({
                needsConfirm: true,
                action: '写入文件',
                target: path,
                isNew: !oldContent,
                diffData: diff
            });
        }
        // 已确认：执行写入
        const jsonStr = window.AndroidBridge.writeFile(path, content);
        const data = JSON.parse(jsonStr);
        if (data.error) {
            return `错误：${data.error}`;
        }
        writePlanLog(planLog || `写入文件：${path}`);
        return `文件已写入：${data.path}（${formatFileSize(data.size)}）`;
    } catch (e) {
        return `写入文件失败：${e.message}`;
    }
}

/**
 * read_file 读取内容字符上限（超出时截断并提示 AI 分批读取）
 */
const READ_FILE_MAX_CHARS = 50000;

/**
 * 执行 read_file 工具
 * @param {string} path - 文件路径
 * @param {string} encoding - 编码
 * @param {number} offset - 起始行号
 * @param {number} limit - 读取行数
 * @returns {string} 文件内容
 */
function executeReadFile(path, encoding, offset, limit) {
    try {
        if (!path) return '错误：缺少必填参数 path（文件路径）';
        path = resolvePath(path);
        if (!window.AndroidBridge) {
            return '错误：当前环境不支持文件操作（AndroidBridge 不可用）';
        }

        // 图片文件：转为 base64 返回，供视觉模型识别
        const ext = path.split('.').pop().toLowerCase();
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];
        if (imageExts.includes(ext) && typeof window.AndroidBridge.readFileBase64 === 'function') {
            const base64 = window.AndroidBridge.readFileBase64(path);
            if (base64) {
                const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
                const dataUrl = `data:${mimeMap[ext]};base64,${base64}`;
                return JSON.stringify({ image: dataUrl, path: path });
            }
            return '错误：图片读取失败';
        } else if (imageExts.includes(ext)) {
            // 没有 readFileBase64 方法，尝试用普通读取
            return '错误：当前环境不支持读取图片文件（AndroidBridge.readFileBase64 不可用）';
        }

        // 检测是否为需要原生解析的文件类型
        const nativeExts = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'];

        if (nativeExts.includes(ext) && typeof window.AndroidBridge.extractFileText === 'function') {
            // 使用原生解析器（PDF/Word/PPT/Excel）
            const jsonStr = window.AndroidBridge.extractFileText(path);
            const data = JSON.parse(jsonStr);
            if (data.error) {
                return `错误：${data.error}`;
            }
            // 原生解析结果：应用字符上限
            let text = data.text || '';
            if (text.length > READ_FILE_MAX_CHARS) {
                text = text.slice(0, READ_FILE_MAX_CHARS);
                const totalLines = text.split('\n').length;
                text += `\n\n⚠️ 文件内容过长，已截取前 ${READ_FILE_MAX_CHARS} 字符（约 ${totalLines} 行）。如需读取后续内容，请将文件内容分批读取。`;
            }
            return text;
        }

        // 普通文本文件：使用原有逻辑
        if (typeof window.AndroidBridge.readFile !== 'function') {
            return '错误：当前环境不支持文件操作（AndroidBridge.readFile 不可用）';
        }
        const jsonStr = window.AndroidBridge.readFile(path, encoding, offset, limit);
        const data = JSON.parse(jsonStr);
        if (data.error) {
            return `错误：${data.error}`;
        }
        // 格式化输出
        let result = `文件：${data.path}\n`;
        result += `行 ${data.startLine}-${data.endLine} / 共 ${data.totalLines} 行\n\n`;

        // 逐行追加，累计字符数到达上限后截断
        let charCount = result.length;
        let truncated = false;
        for (let i = 0; i < data.lines.length; i++) {
            const lineNum = data.startLine + i;
            const lineText = `${lineNum}: ${data.lines[i]}\n`;
            if (charCount + lineText.length > READ_FILE_MAX_CHARS) {
                truncated = true;
                const nextLine = data.startLine + i;
                result += `\n⚠️ 内容已达 ${READ_FILE_MAX_CHARS} 字符上限，已截断。该文件共 ${data.totalLines} 行，请使用 offset=${nextLine} 继续读取后续内容。\n`;
                break;
            }
            result += lineText;
            charCount += lineText.length;
        }
        return result;
    } catch (e) {
        return `读取文件失败：${e.message}`;
    }
}

/**
 * 执行 list_directory 工具
 * @param {string} path - 目录路径
 * @returns {string} 格式化的目录列表
 */
function executeListDirectory(path) {
    try {
        path = resolvePath(path);
        if (!window.AndroidBridge || typeof window.AndroidBridge.listDirectory !== 'function') {
            return '错误：当前环境不支持文件操作（AndroidBridge.listDirectory 不可用）';
        }
        const jsonStr = window.AndroidBridge.listDirectory(path);
        const data = JSON.parse(jsonStr);
        if (data.error) {
            return `错误：${data.error}`;
        }
        // 格式化输出
        let result = `目录：${data.path}\n`;
        if (data.entries.length === 0) {
            result += '（空目录）';
            return result;
        }
        data.entries.forEach(entry => {
            const icon = entry.type === 'directory' ? '📁' : '📄';
            const sizeStr = entry.size ? ` (${formatFileSize(entry.size)})` : '';
            result += `${icon} ${entry.name}${sizeStr}\n`;
        });
        result += `\n共 ${data.entries.length} 项`;
        return result;
    } catch (e) {
        return `列出目录失败：${e.message}`;
    }
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// 格式化 Git 仓库大小（复用 formatFileSize）
function formatGitSize(bytes) {
    return formatFileSize(bytes);
}

/**
 * 执行 fetch_url 工具
 * @param {string} url - 要访问的链接
 * @returns {Promise<string>} 页面正文内容
 */
async function executeFetchUrl(url) {
    try {
        console.log('[ToolCalling] 抓取网页:', url);
        const html = nativeHttpGet(url);
        if (!html || html.startsWith('{"error"')) {
            return `无法访问该链接：${html || '请求失败'}`;
        }
        // tophub.today 专用解析：提取结构化热榜数据
        if (url.includes('tophub.today')) {
            const tophubResult = parseTophub(html);
            if (tophubResult) return tophubResult;
        }
        const text = extractTextFromHtml(html);
        if (!text || text.length < 50) {
            return '该页面内容为空或无法提取正文。';
        }
        // 截断过长内容（最多 8000 字符，避免 token 消耗过大）
        const maxLen = 8000;
        if (text.length > maxLen) {
            return text.slice(0, maxLen) + '\n\n...（内容过长，已截断）';
        }
        return text;
    } catch (e) {
        return `抓取网页失败：${e.message}`;
    }
}

/**
 * 解析 tophub.today 热榜页面，提取结构化数据
 * @param {string} html - 页面HTML
 * @returns {string|null} 格式化的热榜文本，解析失败返回null
 */
function parseTophub(html) {
    try {
        const sections = [];
        
        // 移动版结构：node-card > node-name(榜单名) + hot-list > a.hot-item > hot-title + hot-extra
        // 桌面版结构：cc-cd > cc-cd-lb(榜单名) + a > span.t(标题) + span.e(热度)
        
        // 检测是移动版还是桌面版
        const isMobile = html.indexOf('node-card') >= 0;
        
        if (isMobile) {
            // === 移动版解析 ===
            // 按 node-card 分割
            const cardRegex = /<div class="node-card">([\s\S]*?)(?=<div class="node-card">|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>|$)/g;
            let cardMatch;
            while ((cardMatch = cardRegex.exec(html)) !== null) {
                const block = cardMatch[1];
                
                // 提取榜单名称
                const nameMatch = block.match(/<a[^>]*class="node-name"[^>]*>([\s\S]*?)<\/a>/);
                const sourceName = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                if (!sourceName) continue;
                
                // 提取热点条目
                const items = [];
                const itemRe = /<a[^>]*href="([^"]+)"[^>]*class="hot-item"[^>]*>[\s\S]*?<span class="hot-title">([\s\S]*?)<\/span>[\s\S]*?(?:<span class="hot-extra">([\s\S]*?)<\/span>)?/g;
                let itemMatch;
                while ((itemMatch = itemRe.exec(block)) !== null && items.length < 10) {
                    const link = itemMatch[1];
                    const title = itemMatch[2].replace(/<[^>]+>/g, '').trim();
                    const heat = itemMatch[3] ? itemMatch[3].replace(/<[^>]+>/g, '').trim() : '';
                    if (title && title.length > 2) {
                        items.push({ title, link, heat });
                    }
                }
                
                if (items.length > 0) {
                    sections.push({ source: sourceName, items });
                }
            }
        } else {
            // === 桌面版解析 ===
            const sourceRegex = /<div class="cc-cd-lb"[^>]*>[\s\S]*?<img[^>]*>[\s\S]*?<\/a>/g;
            let srcMatch;
            const sourcePositions = [];
            while ((srcMatch = sourceRegex.exec(html)) !== null) {
                const nameText = srcMatch[0].replace(/<[^>]+>/g, '').trim();
                sourcePositions.push({ name: nameText, start: srcMatch.index, end: srcMatch.index + srcMatch[0].length });
            }
            
            for (let i = 0; i < sourcePositions.length; i++) {
                const source = sourcePositions[i];
                const blockStart = source.end;
                const blockEnd = i + 1 < sourcePositions.length ? sourcePositions[i + 1].start : html.length;
                const block = html.substring(blockStart, blockEnd);
                
                const subTypeMatch = block.match(/<span class="cc-cd-sb-st">([\s\S]*?)<\/span>/);
                const subType = subTypeMatch ? subTypeMatch[1].trim() : '';
                
                const items = [];
                let itemMatch;
                const itemRe = /<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span class="t">([\s\S]*?)<\/span>[\s\S]*?(?:<span class="e">([\s\S]*?)<\/span>)?/g;
                while ((itemMatch = itemRe.exec(block)) !== null && items.length < 10) {
                    const link = itemMatch[1];
                    const title = itemMatch[2].replace(/<[^>]+>/g, '').trim();
                    const heat = itemMatch[3] ? itemMatch[3].replace(/<[^>]+>/g, '').trim() : '';
                    if (title && title.length > 2) {
                        items.push({ title, link, heat });
                    }
                }
                
                if (items.length > 0) {
                    const header = subType ? `${source.name} ‧ ${subType}` : source.name;
                    sections.push({ source: header, items });
                }
            }
        }
        
        if (sections.length === 0) return null;
        
        // 格式化输出
        let result = `📊 实时热榜聚合（共 ${sections.length} 个榜单）\n\n`;
        for (const sec of sections) {
            result += `【${sec.source}】\n`;
            sec.items.forEach((item, i) => {
                result += `${i + 1}. ${item.title}`;
                if (item.heat) result += `（${item.heat}）`;
                result += `\n  🔗 ${item.link}\n`;
            });
            result += '\n';
        }
        
        // 截断过长内容
        const maxLen = 8000;
        if (result.length > maxLen) {
            result = result.slice(0, maxLen) + '\n\n...（内容过长，已截断）';
        }
        
        console.log('[ToolCalling] tophub解析成功:', sections.length, '个榜单,', sections.reduce((s, c) => s + c.items.length, 0), '条热点');
        return result;
    } catch (e) {
        console.error('[ToolCalling] tophub解析失败:', e);
        return null;
    }
}

/**
 * 执行 math_calculate 工具
 * @param {string} expression - 数学表达式
 * @returns {string} 计算结果
 */
function executeMathCalculate(expression) {
    try {
        if (typeof math === 'undefined') {
            return '错误：math.js 库未加载，无法进行数学计算';
        }

        // ========== 拦截 solve：方程求解（牛顿法） ==========
        // 格式: solve('x^2 - 5*x + 6', 'x') 或 solve('x^2 - 5*x + 6 = 0', 'x')
        const solveMatch = expression.match(/^solve\s*\(\s*['"](.+?)['"]\s*,\s*['"](\w+)['"]\s*\)$/i);
        if (solveMatch) {
            return solveEquation(solveMatch[1], solveMatch[2]);
        }

        // ========== 拦截 integrate：定积分（辛普森法则）==========
        // 格式: integrate('x^2', 'x', 0, 1)  带上下限 → 定积分
        // 格式: integrate('x^2', 'x')         不带上下限 → 不定积分（符号积分）
        const integrateMatch4 = expression.match(/^integrate\s*\(\s*['"](.+?)['"]\s*,\s*['"](\w+)['"]\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i);
        if (integrateMatch4) {
            // 传原始字符串，由 integrateFunction 内部用 math.evaluate 解析（支持 pi/2、sqrt(2) 等）
            return integrateFunction(integrateMatch4[1], integrateMatch4[2], integrateMatch4[3].trim(), integrateMatch4[4].trim());
        }
        const integrateMatch2 = expression.match(/^integrate\s*\(\s*['"](.+?)['"]\s*,\s*['"](\w+)['"]\s*\)$/i);
        if (integrateMatch2) {
            return symbolicIntegrate(integrateMatch2[1], integrateMatch2[2]);
        }

        // ========== 其他表达式交给 math.js ==========
        const result = math.evaluate(expression);
        // 格式化结果
        if (typeof result === 'object' && result !== null) {
            // math.js 返回的对象（如矩阵、复数等）
            if (result.format) {
                return `计算结果：${result.format({precision: 10})}`;
            }
            return `计算结果：${result.toString()}`;
        }
        return `计算结果：${result}`;
    } catch (e) {
        return `计算失败：${e.message}。请检查表达式语法是否正确。支持示例：sqrt(3^2+4^2), derivative('x^3','x'), solve('x^2-5*x+6','x'), integrate('x^2','x',0,1), det([1,2;3,4]), 2 inch to cm`;
    }
}

/**
 * 方程求解（牛顿法 + 多起点扫描）
 * @param {string} exprStr - 表达式字符串，如 'x^2 - 5*x + 6' 或 'x^2 - 5*x + 6 = 0'
 * @param {string} variable - 变量名，如 'x'
 * @returns {string} 求解结果
 */
function solveEquation(exprStr, variable) {
    // 处理等号：将 'f(x) = g(x)' 转为 'f(x) - (g(x))'
    let expr = exprStr;
    if (expr.includes('=')) {
        const parts = expr.split('=');
        expr = `(${parts[0].trim()}) - (${parts[1].trim()})`;
    }

    // 编译表达式
    const compiled = math.compile(expr);
    const scope = {};

    // 求 f(x)
    function f(x) {
        scope[variable] = x;
        return compiled.evaluate(scope);
    }

    // 数值求导 f'(x)
    function fPrime(x) {
        const h = 1e-8;
        return (f(x + h) - f(x - h)) / (2 * h);
    }

    // 牛顿法迭代
    function newton(x0, maxIter = 100) {
        let x = x0;
        for (let i = 0; i < maxIter; i++) {
            const fx = f(x);
            if (Math.abs(fx) < 1e-12) return x;
            const fpx = fPrime(x);
            if (Math.abs(fpx) < 1e-15) return null; // 导数为0，无法继续
            x = x - fx / fpx;
        }
        return Math.abs(f(x)) < 1e-6 ? x : null;
    }

    // 多起点扫描，找所有不同的根
    const roots = [];
    const testPoints = [];
    for (let x = -100; x <= 100; x += 0.5) {
        testPoints.push(x);
    }

    for (const x0 of testPoints) {
        const root = newton(x0);
        if (root === null || !isFinite(root)) continue;
        // 四舍五入避免浮点误差
        const rounded = Math.round(root * 1e8) / 1e8;
        // 检查是否已有相近的根
        if (!roots.some(r => Math.abs(r - rounded) < 1e-6)) {
            roots.push(rounded);
        }
    }

    // 排序
    roots.sort((a, b) => a - b);

    if (roots.length === 0) {
        return '方程在 [-100, 100] 范围内未找到实数解。可能无实数解或解超出搜索范围。';
    }

    // 格式化输出
    const rootStrs = roots.map(r => {
        // 尝试识别常见整数/分数
        if (Number.isInteger(r)) return `${r}`;
        const frac = math.fraction(r);
        if (frac.d !== 1 && frac.d <= 1000) {
            return `${r}（即 ${frac.n}/${frac.d}）`;
        }
        return `${r}`;
    });

    return `方程求解结果：${variable} = ${rootStrs.join(', ')}（共 ${roots.length} 个实数解）`;
}

/**
 * 定积分计算（辛普森法则）
 * @param {string} exprStr - 被积函数表达式，如 'x^2'
 * @param {string} variable - 积分变量
 * @param {number} a - 下限
 * @param {number} b - 上限
 * @returns {string} 积分结果
 */
function integrateFunction(exprStr, variable, a, b) {
    // 用 math.js 解析上下限，支持 pi、e、sqrt(2) 等表达式
    try { a = math.evaluate(String(a).trim()); } catch (e) {}
    try {
        const bStr = String(b).trim();
        // 处理 infinity/Infinity/∞/无穷
        if (/^(infinity|∞|无穷)$/i.test(bStr)) {
            b = Infinity;
        } else {
            b = math.evaluate(bStr);
        }
    } catch (e) {}
    // 处理无穷积分（截断到有限范围）
    if (a === -Infinity || b === Infinity) {
        // 无穷积分：截断到 [-10000, 10000]，细分步长
        if (a === -Infinity) a = -10000;
        if (b === Infinity) b = 10000;
        // 用更多细分点保证精度
        return integrateFunctionCore(exprStr, variable, a, b, 50000);
    }
    return integrateFunctionCore(exprStr, variable, a, b);
}

/**
 * 定积分核心计算（辛普森法则）
 */
function integrateFunctionCore(exprStr, variable, a, b, maxN) {
    maxN = maxN || 10000;
    const compiled = math.compile(exprStr);
    const scope = {};

    function f(x) {
        scope[variable] = x;
        const val = compiled.evaluate(scope);
        return typeof val === 'object' && val.re !== undefined ? val.re : val;
    }

    // 辛普森法则（自适应细分）
    function simpson(a, b, n) {
        if (n % 2 !== 0) n++;
        const h = (b - a) / n;
        let sum = f(a) + f(b);
        for (let i = 1; i < n; i++) {
            const coeff = (i % 2 === 0) ? 2 : 4;
            sum += coeff * f(a + i * h);
        }
        return (h / 3) * sum;
    }

    // 逐步加倍细分，直到收敛
    let prev = simpson(a, b, 100);
    let result;
    for (let n = 200; n <= maxN; n *= 2) {
        result = simpson(a, b, n);
        if (Math.abs(result - prev) < 1e-10 * Math.max(1, Math.abs(result))) {
            break;
        }
        prev = result;
    }

    // 格式化
    const exact = Math.round(result * 1e10) / 1e10;
    return `定积分结果：∫[${a}, ${b}] (${exprStr}) d${variable} = ${exact}`;
}

/**
 * 不定积分（符号积分）
 * 基于 math.js 的 derivative 反推，支持常见函数
 * @param {string} exprStr - 被积函数表达式
 * @param {string} variable - 积分变量
 * @returns {string} 积分结果
 */
function symbolicIntegrate(exprStr, variable) {
    // 预处理：将 x² 等 Unicode 上标转为 ^
    let expr = exprStr
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, s => {
            const map = {'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
            return '^' + [...s].map(c => map[c]).join('');
        });

    // 常见积分规则表
    const rules = [
        // 幂函数: x^n → x^(n+1)/(n+1)
        { test: new RegExp(`^\\s*${variable}\\s*\\^\\s*(.+?)\\s*$`), fn: (m) => {
            const n = math.evaluate(m[1]);
            if (n === -1) return `ln|${variable}| + C`;
            const np1 = n + 1;
            return `${variable}^${np1}/${np1} + C`;
        }},
        // 纯变量: x → x²/2
        { test: new RegExp(`^\\s*${variable}\\s*$`), fn: () => `${variable}^2/2 + C` },
        // 常数: a → a*x
        { test: /^\s*(\d+(?:\.\d+)?)\s*$/, fn: (m) => `${m[1]}*${variable} + C` },
        // sin(x) → -cos(x)
        { test: new RegExp(`^\\s*sin\\s*\\(\\s*${variable}\\s*\\)\\s*$`), fn: () => `-cos(${variable}) + C` },
        // cos(x) → sin(x)
        { test: new RegExp(`^\\s*cos\\s*\\(\\s*${variable}\\s*\\)\\s*$`), fn: () => `sin(${variable}) + C` },
        // tan(x) → -ln|cos(x)|
        { test: new RegExp(`^\\s*tan\\s*\\(\\s*${variable}\\s*\\)\\s*$`), fn: () => `-ln|cos(${variable})| + C` },
        // exp(x)/e^x → e^x
        { test: new RegExp(`^\\s*(?:exp\\s*\\(\\s*${variable}\\s*\\)|e\\s*\\^\\s*${variable})\\s*$`), fn: () => `e^${variable} + C` },
        // 1/x → ln|x|
        { test: new RegExp(`^\\s*1\\s*/\\s*${variable}\\s*$`), fn: () => `ln|${variable}| + C` },
        // ln(x) → x*ln(x) - x
        { test: new RegExp(`^\\s*ln\\s*\\(\\s*${variable}\\s*\\)\\s*$`), fn: () => `${variable}*ln(${variable}) - ${variable} + C` },
        // sqrt(x) → (2/3)*x^(3/2)
        { test: new RegExp(`^\\s*sqrt\\s*\\(\\s*${variable}\\s*\\)\\s*$`), fn: () => `(2/3)*${variable}^(3/2) + C` },
        // sec²(x) → tan(x)
        { test: new RegExp(`^\\s*sec\\s*\\^\\s*2\\s*\\(\\s*${variable}\\s*\\)\\s*$`), fn: () => `tan(${variable}) + C` },
    ];

    // 尝试匹配规则
    for (const rule of rules) {
        const m = expr.match(rule.test);
        if (m) {
            const result = rule.fn(m);
            return `不定积分结果：∫ (${exprStr}) d${variable} = ${result}`;
        }
    }

    // 规则未匹配：尝试数值验证法
    // 对表达式求导，看导数是否等于原函数（反推积分）
    try {
        // 尝试 a*x^n 形式
        const powerMatch = expr.match(new RegExp(`^\\s*([\\d.]+)\\s*\\*\\s*${variable}\\s*\\^\\s*([\\d.]+)\\s*$`));
        if (powerMatch) {
            const a = parseFloat(powerMatch[1]);
            const n = parseFloat(powerMatch[2]);
            const np1 = n + 1;
            return `不定积分结果：∫ (${exprStr}) d${variable} = ${a}*${variable}^${np1}/${np1} + C`;
        }

        // 尝试 a*f(x) 形式（常数倍）
        const constMultMatch = expr.match(new RegExp(`^\\s*([\\d.]+)\\s*\\*\\s*(.+)$`));
        if (constMultMatch) {
            const a = constMultMatch[1];
            const inner = constMultMatch[2].trim();
            const innerResult = symbolicIntegrate(inner, variable);
            if (!innerResult.includes('无法')) {
                const innerExpr = innerResult.replace(/不定积分结果：∫ \(.+\) d\w+ = /, '').replace(' + C', '');
                return `不定积分结果：∫ (${exprStr}) d${variable} = ${a}*(${innerExpr}) + C`;
            }
        }
    } catch (e) {
        // 忽略
    }

    return `不定积分失败：无法计算 ∫ (${exprStr}) d${variable} 的符号积分。建议使用定积分格式 integrate('${exprStr}', '${variable}', 下限, 上限) 获取数值结果。`;
}

/**
 * 执行 generate_chart 工具
 * @param {object} option - ECharts 配置
 * @param {number} height - 图表高度
 * @returns {string} chartId
 */
function executeGenerateChart(option, height) {
    try {
        if (typeof echarts === 'undefined') {
            return '错误：ECharts 库未加载，无法生成图表';
        }
        if (!option || !option.series) {
            return '错误：图表配置必须包含 series 字段';
        }
        const chartId = 'chart_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const chartData = { option: option, height: height || 300 };
        // 存入内存（用于当前会话快速渲染）
        pendingCharts.set(chartId, chartData);
        // 存入 IndexedDB（用于刷新后恢复）
        if (typeof saveChartToDB === 'function') {
            saveChartToDB(chartId, option, height || 300);
        }
        return `图表已生成，chartId: ${chartId}。请在回复中使用 [chart:${chartId}] 嵌入该图表。`;
    } catch (e) {
        console.error('[CNAI_Chart] executeGenerateChart 失败:', e);
        return `生成图表失败：${e.message}`;
    }
}

/**
 * 执行单个 tool_call
 * @param {object} tc - tool_call 对象 { id, function: { name, arguments } }
 * @returns {Promise<string>} 工具执行结果
 */
async function executeToolCall(tc) {
    if (!tc || !tc.function?.name) return '无效的工具调用';

    // ==================== 本地命令安全白名单 ====================
    // 安全命令前缀：只读/查询类命令，直接执行无需确认
    const SAFE_COMMAND_PREFIXES = [
        // 文件查看
        'ls', 'cat', 'head', 'tail', 'wc', 'nl', 'tac', 'od', 'xxd', 'stat',
        'file', 'readlink', 'realpath', 'basename', 'dirname', 'pwd',
        // 文本处理（纯处理，不写文件）
        'grep', 'egrep', 'fgrep', 'sed', 'awk', 'sort', 'uniq', 'cut', 'tr',
        'paste', 'comm', 'cmp', 'diff', 'expand', 'fmt', 'tee',
        // 查找
        'find', 'which', 'xargs',
        // 系统信息
        'ps', 'top', 'df', 'du', 'free', 'uname', 'hostname', 'whoami', 'id',
        'date', 'cal', 'uptime', 'env', 'printenv', 'getprop', 'getenforce',
        'dumpsys', 'logcat',
        // 网络（只读）
        'ping', 'netstat', 'ss', 'ifconfig', 'ip',
        // 哈希/编码
        'md5sum', 'sha1sum', 'sha256sum', 'base64',
        // 其他安全命令
        'echo', 'printf', 'seq', 'test', 'expr', 'true', 'false',
        'sleep', 'timeout', 'time', 'clear', 'toybox',
        // 压缩查看（不解压）
        'zcat'
    ];
    // 危险关键字：包含这些关键字的命令一律需要确认（即使在白名单前缀中）
    const DANGEROUS_KEYWORDS = [
        'rm ', 'rmdir', 'mv ', 'cp ', 'mkdir', 'chmod', 'chown', 'chgrp',
        'kill', 'killall', 'nohup',
        'mkfs', 'dd ', 'mount', 'umount', 'ln ',
        'am force', 'am stop', 'pm uninstall', 'pm clear', 'pm disable',
        'settings put', 'setprop', 'setenforce',
        'reboot', 'shutdown',
        'tar ', 'gzip ', 'gunzip ', 'bzip2 ', 'zip ', 'unzip ',
        'truncate ',
        // 白名单命令的危险参数
        'sed -i', 'find -delete', 'find -exec', 'find -ok'
    ];

    // 绝对禁止：任何情况下都不允许执行
    // 注意：用正则精确匹配根目录，避免误伤子目录（如 rm -rf /sdcard/Download/xxx 是合法的）
    const FORBIDDEN_PATTERNS = [
        /rm\s+-rf?\s+\/\s*$/,          // rm -rf / （删除根目录）
        /rm\s+-rf?\s+\/system\s*$/,    // rm -rf /system
        /rm\s+-rf?\s+\/data\s*$/,      // rm -rf /data
        /rm\s+-rf?\s+\/sdcard\s*$/,    // rm -rf /sdcard
        /rm\s+-rf?\s+\/storage\s*$/,   // rm -rf /storage
        /rm\s+-rf?\s+\/dev\s*$/,       // rm -rf /dev
        /rm\s+-rf?\s+\/proc\s*$/,      // rm -rf /proc
        /rm\s+-rf?\s+\/\*/,            // rm -rf /*
        /mkfs/,                         // 格式化
        /dd\s+if=\/dev\/zero/,         // dd if=/dev/zero
        /dd\s+if=\/dev\/null/,         // dd if=/dev/null
        /shutdown/,                     // 关机
        /reboot\s+-p/,                  // reboot -p
        /flash_image/                   // 刷写镜像
    ];

    /**
     * 命令安全检查：返回三级状态
     * @returns 'safe' 直接执行 | 'confirm' 需用户确认 | 'forbidden' 绝对禁止
     */
    function checkCommandSafety(command) {
        if (!command || typeof command !== 'string') return 'confirm';
        const cmd = command.trim();
        if (!cmd) return 'confirm';

        // 绝对禁止检查（最高优先级）
        const lower = cmd.toLowerCase();
        for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(cmd) || pattern.test(lower)) return 'forbidden';
        }

        // 管道/重定向处理
        if (/[;|&]/.test(cmd) || />>?/.test(cmd)) {
            // 包含写入重定向 → 需确认
            if (/>>?/.test(cmd)) return 'confirm';
            // 多命令组合：逐条检查
            const subCommands = cmd.split(/[;|&]{1,2}/).map(s => s.trim()).filter(Boolean);
            for (const sub of subCommands) {
                if (checkCommandSafety(sub) === 'forbidden') return 'forbidden';
                if (checkCommandSafety(sub) === 'confirm') return 'confirm';
            }
            return 'safe';
        }

        // 提取命令名（去掉路径前缀）
        const cmdName = cmd.split(/\s+/)[0].split('/').pop();

        // 检查危险关键字
        for (const danger of DANGEROUS_KEYWORDS) {
            if (cmd.includes(danger)) return 'confirm';
        }

        // 检查白名单
        if (SAFE_COMMAND_PREFIXES.includes(cmdName)) return 'safe';

        // 未知命令 → 需确认
        return 'confirm';
    }

    /**
     * 格式化本地命令执行结果
     */
    function formatLocalCommandResult(raw) {
        try {
            const result = JSON.parse(raw);
            if (result.cancelled) {
                let msg = '⏹️ 用户已停止命令执行';
                if (result.partial) msg += '\n部分输出:\n' + result.partial;
                return msg;
            }
            if (result.error) {
                let msg = '命令执行失败: ' + result.error;
                if (result.partial) msg += '\n部分输出:\n' + result.partial;
                return msg;
            }
            let output = result.output || '(无输出)';
            if (result.exitCode !== 0) {
                output += '\n（退出码: ' + result.exitCode + '）';
            }
            return output;
        } catch (e) {
            return '命令结果解析失败: ' + e.message;
        }
    }

    /**
     * 格式化 Termux 命令执行结果
     */
    function formatTermuxResult(raw) {
        try {
            const result = JSON.parse(raw);
            if (result.error) {
                return '❌ Termux 命令执行失败: ' + result.error;
            }
            let output = result.stdout || '(无输出)';
            if (result.stderr && result.stderr.trim()) {
                output += '\n[stderr]\n' + result.stderr.trim();
            }
            if (result.exitCode !== 0) {
                output += '\n（退出码: ' + result.exitCode + '）';
            }
            return output;
        } catch (e) {
            // 非JSON格式，直接返回原始内容
            return raw;
        }
    }

    /**
     * 异步执行本地命令（不阻塞 JS 引擎，支持取消）
     * Java 层在子线程执行命令，完成后通过 evaluateJavascript 回调。
     * JS 层用 setInterval 每 200ms 检查 abortController，如已停止则通知 Java 取消。
     * @param {string} command - 要执行的命令
     * @param {number} timeoutSec - 超时秒数
     * @returns {Promise<string>} JSON 格式的执行结果
     */
    async function executeLocalCommandAsync(command, timeoutSec) {
        const callbackId = 'cmd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        return new Promise((resolve) => {
            let resolved = false;
            let abortChecker = null;

            // 设置回调
            window._onLocalCommandResult = (id, result) => {
                if (id !== callbackId || resolved) return;
                resolved = true;
                if (abortChecker) clearInterval(abortChecker);
                delete window._onLocalCommandResult;
                resolve(typeof result === 'string' ? result : JSON.stringify(result));
            };

            // 启动命令（立即返回，不阻塞 JS）
            window.AndroidBridge.executeLocalCommandAsync(command, timeoutSec, callbackId);

            // 每 200ms 检查 abort（和 callPCTool 机制一致）
            abortChecker = setInterval(() => {
                if (!abortController || abortController.signal.aborted) {
                    if (resolved) return;
                    resolved = true;
                    clearInterval(abortChecker);
                    delete window._onLocalCommandResult;
                    // 通知 Java 层取消命令
                    window.AndroidBridge.cancelLocalCommand();
                    resolve(JSON.stringify({ cancelled: true }));
                }
            }, 200);
        });
    }

    // 解析参数（容错：处理模型生成多个JSON拼接的情况）
    let args;
    try {
        let argsStr = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
        try {
            args = JSON.parse(argsStr);
        } catch (e) {
            // 尝试只解析第一个完整 JSON 对象
            let depth = 0, endIdx = -1;
            for (let i = 0; i < argsStr.length; i++) {
                if (argsStr[i] === '{') depth++;
                else if (argsStr[i] === '}') {
                    depth--;
                    if (depth === 0) { endIdx = i; break; }
                }
            }
            if (endIdx > 0) {
                args = JSON.parse(argsStr.substring(0, endIdx + 1));
                console.warn('[ToolCalling] arguments 包含多余内容，已截取第一个JSON对象');
            } else {
                throw e;
            }
        }
    } catch (e) {
        console.error('[ToolCalling] arguments JSON解析失败:', tc.function.arguments?.substring(0, 200));
        return `工具参数解析失败: ${e.message}`;
    }

    // 检查是否为 MCP 工具（优先于本地工具和 PC 转发）
    if (typeof isMcpTool === 'function' && isMcpTool(tc.function.name)) {
        return await executeMcpTool(tc.function.name, args || {});
    }

    // 检查是否需要转发到PC端执行
    if (args?.device === 'pc') {
        return await executeToolOnPC(tc.function.name, args);
    }

    // 以下为本地执行
    if (tc.function.name === 'web_search') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            const queries = args?.queries || [];
            const timeRange = args?.time_range || '';
            const engine = args?.engine || '';
            if (queries.length === 0) {
                return '搜索参数为空';
            }
            console.log('[ToolCalling] 执行搜索:', queries, '时间范围:', timeRange, '引擎:', engine);
            return await executeWebSearch(queries, timeRange, engine);
        } catch (e) {
            return `搜索参数解析失败: ${e.message}`;
        }
    }

    if (tc.function.name === 'get_current_info') {
        console.log('[ToolCalling] 获取当前时间和位置');
        return await executeGetCurrentInfo();
    }

    if (tc.function.name === 'fetch_url') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            const url = args?.url || '';
            return await executeFetchUrl(url);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    }

    /* // [已注释] list_directory
    if (tc.function.name === 'list_directory') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            const path = args?.path || '';
            return executeListDirectory(path);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    } */

    if (tc.function.name === 'read_file') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            const path = args?.path || '';
            const encoding = args?.encoding || 'utf-8';
            const offset = args?.offset || 0;
            const limit = args?.limit || 0;
            return executeReadFile(path, encoding, offset, limit);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    }

    if (tc.function.name === 'write_file') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            const path = args?.path || '';
            const content = args?.content || '';
            const planLog = args?.plan_log || '';
            const confirmed = args?._confirmed || false;
            return executeWriteFile(path, content, planLog, confirmed);
        } catch (e) {
            const hint = e.message.includes('Unterminated') ? 'content参数过长导致JSON被截断。请将内容拆分为多次写入，每次不超过300行，或先write_file创建空文件再用edit_file分批追加。' : '';
            return `参数解析失败: ${e.message}。${hint}`;
        }
    }

    /* // [已注释] create_directory
    if (tc.function.name === 'create_directory') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            const path = args?.path || '';
            return executeCreateDirectory(path);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    } */

    /* // [已注释] move_file
    if (tc.function.name === 'move_file') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return executeMoveOrCopyFile(args?.src || '', args?.dst || '', false);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    } */

    /* // [已注释] copy_file
    if (tc.function.name === 'copy_file') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return executeMoveOrCopyFile(args?.src || '', args?.dst || '', true);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    } */

    /* // [已注释] get_file_info
    if (tc.function.name === 'get_file_info') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return executeGetFileInfo(args?.path || '');
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    } */

    if (tc.function.name === 'search_files') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return executeSearchFiles(args?.directory || '', args?.pattern || '');
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    }

    if (tc.function.name === 'search_content') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return executeSearchContent(args?.directory || '', args?.pattern || '', args?.include || '', args?.max_results || 0);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    }

    /* // [已注释] get_system_info
    if (tc.function.name === 'get_system_info') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return executeGetSystemInfo(args?.type || 'all');
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    } */

    if (tc.function.name === 'edit_file') {
        try {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            const path = args?.path || '';
            const edits = args?.edits || [];
            const planLog = args?.plan_log || '';
            const confirmed = args?._confirmed || false;
            return executeEditFile(path, edits, planLog, confirmed);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    }

    // execute_command：本地优先，PC为可选
    if (tc.function.name === 'execute_command') {
        try {
            const cmdArgs = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            // 优先级 1：用户明确指定 device=pc
            if (cmdArgs.device === 'pc') {
                return await executeToolOnPC('execute_command', cmdArgs);
            }
            // 优先级 2：内置终端执行（默认，异步不阻塞）
            if (window.AndroidBridge && typeof window.AndroidBridge.executeLocalCommandAsync === 'function') {
                const timeoutMs = cmdArgs.timeout || 30000;
                const timeoutSec = Math.max(1, Math.round(timeoutMs / 1000));
                // 三级安全检查
                const safety = checkCommandSafety(cmdArgs.command);
                if (safety === 'forbidden') {
                    return '🚫 该命令被安全策略禁止执行。';
                }
                if (safety === 'confirm') {
                    const chatContainerEl = document.getElementById('chatContainer');
                    if (!chatContainerEl) {
                        // 没有聊天容器，直接异步执行
                        const raw = await executeLocalCommandAsync(cmdArgs.command, timeoutSec);
                        return formatLocalCommandResult(raw);
                    }
                    return await showSimpleConfirm(
                        '执行命令',
                        cmdArgs.command,
                        chatContainerEl,
                        async () => {
                            const raw = await executeLocalCommandAsync(cmdArgs.command, timeoutSec);
                            return formatLocalCommandResult(raw);
                        }
                    );
                }
                // safe：白名单命令直接异步执行
                const raw = await executeLocalCommandAsync(cmdArgs.command, timeoutSec);
                return formatLocalCommandResult(raw);
            }
            // 优先级 3：本地不支持异步，回退到同步（旧版本兼容）
            if (window.AndroidBridge && typeof window.AndroidBridge.executeLocalCommand === 'function') {
                const timeoutMs = cmdArgs.timeout || 30000;
                const timeoutSec = Math.max(1, Math.round(timeoutMs / 1000));
                const safety = checkCommandSafety(cmdArgs.command);
                if (safety === 'forbidden') return '🚫 该命令被安全策略禁止执行。';
                const raw = window.AndroidBridge.executeLocalCommand(cmdArgs.command, timeoutSec);
                return formatLocalCommandResult(raw);
            }
            // 优先级 4：本地不可用，尝试 PC
            if (typeof pcConnection !== 'undefined' && pcConnection.connected && pcConnection.authenticated) {
                return await executeToolOnPC('execute_command', cmdArgs);
            }
            return '⚠️ 当前环境不支持执行命令。请连接电脑或更新到最新版本。';
        } catch (e) {
            return `命令参数解析失败: ${e.message}`;
        }
    }

    // run_termux_command：在 Termux 环境中执行命令
    if (tc.function.name === 'run_termux_command') {
        try {
            const termuxArgs = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            const command = termuxArgs.command;
            const workdir = termuxArgs.workdir || null;
            const timeoutSec = Math.max(1, termuxArgs.timeout || 60);
            const background = termuxArgs.background !== false; // 默认 true

            // 检查 AndroidBridge 是否可用
            if (!window.AndroidBridge || typeof window.AndroidBridge.runTermuxCommand !== 'function') {
                return '⚠️ 当前版本不支持 Termux 调用，请更新到最新版本。';
            }

            // 安全检查（复用 execute_command 的安全策略）
            const safety = checkCommandSafety(command);
            if (safety === 'forbidden') {
                return '🚫 该命令被安全策略禁止执行。';
            }

            // 执行函数（异步回调 + 实时进度）
            const doExecute = async () => {
                // 初始化全局回调注册表（只创建一次，永不覆盖）
                if (!window._termuxCallbacks) {
                    window._termuxCallbacks = {};
                    window._onTermuxResult = function(cbId, data) {
                        var cb = window._termuxCallbacks[cbId];
                        if (cb) {
                            delete window._termuxCallbacks[cbId];
                            cb(typeof data === 'string' ? data : JSON.stringify(data));
                        }
                    };
                    // 实时进度回调注册表
                    window._termuxProgressCallbacks = {};
                    window._onTermuxProgress = function(cbId, partial) {
                        var cb = window._termuxProgressCallbacks[cbId];
                        if (cb) cb(partial);
                    };
                }

                const callbackId = window.AndroidBridge.runTermuxCommand(command, workdir, timeoutSec);

                // 创建终端风格的进度元素，挂到当前 tool-call-card
                const toolCards = document.querySelectorAll('.tool-call-card');
                const currentCard = toolCards[toolCards.length - 1];
                let progressEl = null;
                if (currentCard) {
                    progressEl = currentCard.querySelector('.tool-call-result');
                }

                // 注册实时进度回调
                window._termuxProgressCallbacks[callbackId] = function(partial) {
                    if (progressEl) {
                        // 截取最后 8 行显示（避免过长）
                        var lines = partial.split('\n');
                        var display = lines.length > 8
                            ? '...\n' + lines.slice(-8).join('\n')
                            : partial;
                        progressEl.innerHTML = '⎿ <span style="color:#10b981">▶</span> <pre style="margin:0;font-size:11px;white-space:pre-wrap;font-family:monospace;">' + escapeHtml(display) + '</pre>';
                        progressEl.scrollTop = progressEl.scrollHeight;
                    }
                };

                const result = await new Promise((resolve) => {
                    window._termuxCallbacks[callbackId] = resolve;
                });

                // 清理进度回调
                delete window._termuxProgressCallbacks[callbackId];
                return formatTermuxResult(result);
            };

            // confirm 命令需要用户确认
            if (safety === 'confirm') {
                const chatContainerEl = document.getElementById('chatContainer');
                if (!chatContainerEl) {
                    return await doExecute();
                }
                return await showSimpleConfirm(
                    '在 Termux 中执行',
                    command,
                    chatContainerEl,
                    doExecute
                );
            }

            // safe：直接执行
            return await doExecute();
        } catch (e) {
            return `Termux 命令参数解析失败: ${e.message}`;
        }
    }

    // git：Git 操作（JGit）— 所有操作都需用户确认
    if (tc.function.name === 'git') {
        try {
            const gitArgs = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;

            // 格式化 git 操作描述
            function formatGitDesc(a) {
                var act = a.action || 'git';
                var parts = [act];
                if (act === 'clone') parts.push(a.url || '');
                else if (act === 'commit') parts.push(a.message || '');
                else if (act === 'checkout' || act === 'branch') parts.push(a.branch || '');
                else if (act === 'add') parts.push(a.pattern || '.');
                else if (act === 'addremote') parts.push(a.url || '');
                if (a.path) parts.push('-> ' + a.path);
                return parts.join(' ');
            }

            // 格式化 git 结果（从 JSON 转为可读文本）
            function formatGitResult(raw) {
                var result = JSON.parse(raw);
                if (result.cancelled) return '⏹️ 用户已停止 Git 操作';
                if (result.error) return 'Git 操作失败: ' + result.error;
                switch (result.action) {
                    case 'clone':
                        return '克隆成功\n仓库路径: ' + result.path + '\n当前分支: ' + result.branch + (result.size ? '\n仓库大小: ' + formatGitSize(result.size) : '');
                    case 'init':
                        return 'Git 仓库已初始化\n路径: ' + result.path;
                    case 'status': {
                        var s = '分支: ' + (result.branch || 'unknown') + '\n';
                        s += '状态: ' + (result.clean ? '干净（无变更）' : '有变更') + '\n';
                        if (result.aheadCount > 0) s += '领先远程 ' + result.aheadCount + ' 个提交\n';
                        if (result.behindCount > 0) s += '落后远程 ' + result.behindCount + ' 个提交\n';
                        if (result.untracked && result.untracked.length) s += '\n未跟踪: ' + result.untracked.join(', ');
                        if (result.modified && result.modified.length) s += '\n已修改: ' + result.modified.join(', ');
                        if (result.added && result.added.length) s += '\n已暂存: ' + result.added.join(', ');
                        if (result.removed && result.removed.length) s += '\n已删除: ' + result.removed.join(', ');
                        if (result.missing && result.missing.length) s += '\n缺失: ' + result.missing.join(', ');
                        if (result.conflicting && result.conflicting.length) s += '\n冲突: ' + result.conflicting.join(', ');
                        return s;
                    }
                    case 'add':
                        return '已暂存文件: ' + result.pattern;
                    case 'commit':
                        return '提交成功\nHash: ' + result.hash + '\n信息: ' + result.message;
                    case 'push': {
                        var pr = (result.results || []).map(function(r) { return '  ' + r.ref + ': ' + r.status + (r.message ? ' (' + r.message + ')' : ''); });
                        return '推送完成\n' + (pr.join('\n') || '（无更新）');
                    }
                    case 'pull':
                        return '拉取完成' + (result.mergeStatus ? '\n合并状态: ' + result.mergeStatus : '') + (result.rebaseStatus ? '\nRebase状态: ' + result.rebaseStatus : '');
                    case 'log': {
                        var commits = (result.commits || []).map(function(c, i) {
                            return (i + 1) + '. ' + c.hash + ' ' + c.author + '\n   ' + c.message + '\n   ' + new Date(c.date).toLocaleString('zh-CN');
                        });
                        return '提交历史（' + commits.length + ' 条）：\n\n' + commits.join('\n\n');
                    }
                    case 'diff': {
                        var entries = (result.entries || []).map(function(d) {
                            var line = d.type + ': ' + (d.oldPath === '/dev/null' ? '(新增)' : d.oldPath) + ' -> ' + (d.newPath === '/dev/null' ? '(删除)' : d.newPath);
                            if (d.content) line += '\n' + d.content;
                            return line;
                        });
                        return '文件差异:\n' + (entries.join('\n\n') || '（无差异）');
                    }
                    case 'branch': {
                        if (result.branches) {
                            var branches = result.branches.map(function(b) { return (b.current ? '* ' : '  ') + b.name; });
                            return '分支列表:\n' + branches.join('\n');
                        }
                        return '分支已创建: ' + result.branch;
                    }
                    case 'checkout':
                        return '已切换到分支: ' + result.branch;
                    case 'addremote':
                        return '远程仓库已添加: ' + result.remoteName + ' -> ' + result.url;
                    case 'remote': {
                        var remotes = (result.remotes || []).map(function(r) { return r.name + ': ' + (r.uris || []).join(', '); });
                        return '远程仓库:\n' + (remotes.join('\n') || '（无）');
                    }
                    case 'reset':
                        return '已重置: ' + result.mode + ' -> ' + result.ref;
                    case 'clean': {
                        var files = result.cleanedFiles || [];
                        return '已清理 ' + result.count + ' 个未跟踪文件:\n' + files.join('\n');
                    }
                    default:
                        return JSON.stringify(result, null, 2);
                }
            }

            // 异步执行 git（不阻塞 JS 引擎，支持取消）
            async function doGitAsync() {
                const callbackId = 'git_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                return new Promise((resolve) => {
                    let resolved = false;
                    let abortChecker = null;

                    window._onGitResult = (id, result) => {
                        if (id !== callbackId || resolved) return;
                        resolved = true;
                        if (abortChecker) clearInterval(abortChecker);
                        delete window._onGitResult;
                        resolve(formatGitResult(typeof result === 'string' ? result : JSON.stringify(result)));
                    };

                    window.AndroidBridge.gitOperationAsync(JSON.stringify(gitArgs), callbackId);

                    abortChecker = setInterval(() => {
                        if (!abortController || abortController.signal.aborted) {
                            if (resolved) return;
                            resolved = true;
                            clearInterval(abortChecker);
                            delete window._onGitResult;
                            window.AndroidBridge.cancelGitOperation();
                            resolve('⏹️ 用户已停止 Git 操作');
                        }
                    }, 200);
                });
            }

            // 同步回退（旧版本兼容）
            function doGitSync() {
                var raw = window.AndroidBridge.gitOperation(JSON.stringify(gitArgs));
                return formatGitResult(raw);
            }

            // 本地执行（需确认）
            if (window.AndroidBridge && typeof window.AndroidBridge.gitOperationAsync === 'function') {
                var desc = formatGitDesc(gitArgs);
                var container = document.getElementById('chatContainer');
                if (!container) {
                    return await doGitAsync();
                }
                return await showSimpleConfirm('Git', desc, container, async function() {
                    return await doGitAsync();
                });
            }
            // 同步回退（旧版本）
            if (window.AndroidBridge && typeof window.AndroidBridge.gitOperation === 'function') {
                var desc = formatGitDesc(gitArgs);
                var container = document.getElementById('chatContainer');
                if (!container) {
                    return doGitSync();
                }
                return await showSimpleConfirm('Git', desc, container, async function() {
                    return doGitSync();
                });
            }
            // PC 端回退
            if (typeof pcConnection !== 'undefined' && pcConnection.connected && pcConnection.authenticated) {
                return await executeToolOnPC('git', gitArgs);
            }
            return '当前环境不支持 Git 操作。';
        } catch (e) {
            return 'Git 操作失败: ' + e.message;
        }
    }

    // send_file_to_phone：转发到PC端执行
    if (tc.function.name === 'send_file_to_phone') {
        try {
            const fileArgs = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return await executeToolOnPC('send_file_to_phone', fileArgs);
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    }

    if (tc.function.name === 'math_calculate') {
        try {
            const mathArgs = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return executeMathCalculate(mathArgs?.expression || '');
        } catch (e) {
            return `参数解析失败: ${e.message}`;
        }
    }

    if (tc.function.name === 'generate_chart') {
        try {
            const chartArgs = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            console.log('[CNAI_Chart] 路由到达 generate_chart, args:', JSON.stringify(chartArgs).substring(0, 300));
            const result = executeGenerateChart(chartArgs?.option, chartArgs?.height);
            console.log('[CNAI_Chart] executeGenerateChart 返回:', result, 'pendingCharts大小:', typeof pendingCharts !== 'undefined' ? pendingCharts.size : 'undefined');
            return result;
        } catch (e) {
            console.error('[CNAI_Chart] generate_chart 路由异常:', e);
            return `参数解析失败: ${e.message}`;
        }
    }

    return `未知工具: ${tc.function.name}`;
}

// ==================== PC端工具转发 ====================

/**
 * 将工具调用转发到PC端执行
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数（已去掉 device 字段）
 * @returns {string} 执行结果
 */
async function executeToolOnPC(toolName, args) {
    // 检查PC连接状态
    if (typeof pcConnection === 'undefined' || !pcConnection.connected || !pcConnection.authenticated) {
        return '错误：未连接到电脑，请先在设置中连接并配对电脑。';
    }

    // 去掉 device 参数，避免传到PC端
    const cleanArgs = { ...args };
    delete cleanArgs.device;

    // 第一步：发 tool_call（不带 _confirmed），PC端会返回 needsConfirm + diff
    const firstResult = await callPCTool(toolName, cleanArgs);

    // 检查是否需要确认
    let parsed;
    try {
        parsed = typeof firstResult === 'string' ? JSON.parse(firstResult) : firstResult;
    } catch (_) {
        return firstResult; // 不是 JSON，直接返回
    }

    if (!parsed || !parsed.needsConfirm) {
        // 不需要确认（如读文件），直接返回
        return firstResult;
    }

    // 需要确认
    const chatContainer = document.getElementById('chatContainer');
    if (!chatContainer) {
        // 没有聊天容器，自动确认
        return await callPCTool(toolName, { ...cleanArgs, _confirmed: true });
    }

    const hasDiff = parsed.diff && parsed.diff.length > 0;

    if (hasDiff) {
        // 有 diff 数据：展示 diff 确认卡片
        const confirmInfo = {
            needsConfirm: true,
            action: parsed.action || toolName,
            target: parsed.target || '',
            contentPreview: parsed.contentPreview || '',
            diffData: {
                lines: parsed.diff,
                stats: { added: parsed.added || 0, removed: parsed.removed || 0 }
            }
        };

        const confirmResult = await showConfirmCard(
            { function: { name: toolName, arguments: JSON.stringify(cleanArgs) } },
            cleanArgs,
            confirmInfo,
            chatContainer,
            async () => {
                return await callPCTool(toolName, { ...cleanArgs, _confirmed: true });
            }
        );
        return confirmResult;
    } else {
        // 没有 diff 数据（如 execute_command）：简单确认
        return await showSimpleConfirm(
            parsed.action || toolName,
            parsed.target || parsed.command || '',
            chatContainer,
            async () => {
                return await callPCTool(toolName, { ...cleanArgs, _confirmed: true });
            }
        );
    }
}

/**
 * 发送单个 tool_call 到PC端并等待结果
 */
function callPCTool(toolName, args) {
    return new Promise((resolve) => {
        const id = 'pc_tool_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const wsTimeout = Math.max((args?.timeout || 30000) + 10000, 60000);
        let cleanedUp = false;

        function cleanup() {
            if (cleanedUp) return;
            cleanedUp = true;
            clearTimeout(timeout);
            clearInterval(abortChecker);
            pcConnection.ws.removeEventListener('message', handler);
        }

        const timeout = setTimeout(() => {
            cleanup();
            resolve(`错误：PC端工具调用超时（${Math.round(wsTimeout/1000)}秒）`);
        }, wsTimeout);

        const handler = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'tool_result' && msg.id === id) {
                    cleanup();
                    if (msg.is_error) {
                        resolve('PC端执行失败: ' + (msg.data || msg.error || '未知错误'));
                    } else {
                        resolve(typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data));
                    }
                }
            } catch (_) {}
        };

        // 用户点击停止生成时，立即中止等待
        const abortChecker = setInterval(() => {
            if (!abortController || abortController.signal.aborted) {
                cleanup();
                resolve('⏹️ 用户已停止生成');
            }
        }, 200);

        pcConnection.ws.addEventListener('message', handler);
        pcConnection.ws.send(JSON.stringify({
            type: 'tool_call',
            id: id,
            tool: toolName,
            args: args
        }));
    });
}

// ==================== 流式 tool_calls 收集 ====================

/**
 * 处理流式 delta 中的 tool_calls 数据（增量拼接）
 * @param {object} delta - SSE chunk 中的 delta 对象
 */
function collectStreamToolCalls(delta) {
    if (!delta?.tool_calls) return;

    for (const tc of delta.tool_calls) {
        const idx = tc.index ?? toolCallsBuffer.length;
        let existing = toolCallsBuffer[idx];
        if (existing) {
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name = tc.function.name;
            if (tc.function?.arguments) {
                existing.function.arguments = (existing.function.arguments || '') + tc.function.arguments;
            }
        } else {
            while (toolCallsBuffer.length <= idx) toolCallsBuffer.push(null);
            toolCallsBuffer[idx] = {
                id: tc.id || '',
                function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' }
            };
        }
    }
}

/**
 * 设置非流式的 tool_calls
 * @param {Array} toolCalls - 非流式响应中的 tool_calls 数组
 */
function setNonStreamToolCalls(toolCalls) {
    if (toolCalls && toolCalls.length > 0) {
        toolCallsBuffer = toolCalls;
    }
}

/**
 * 获取当前收集到的有效 tool_calls
 * @returns {Array}
 */
function getValidToolCalls() {
    return toolCallsBuffer.filter(tc => tc && tc.function?.name);
}

/**
 * 清空 tool_calls 缓冲区
 */
function clearToolCallsBuffer() {
    toolCallsBuffer = [];
}

// ==================== 后续响应处理 ====================

/**
 * 处理 tool_calls 后续的流式/非流式响应
 * @param {Response} response - fetch Response 对象
 * @param {number} round - 当前轮次
 * @returns {Promise<{content: string, reasoning: string|null, toolCalls: Array}>}
 */
async function handleFollowupResponse(response, round) {
    let content = '';
    let reasoning = '';
    let tcBuffer = [];
    let contentBuffer = '';  // MiniMax think 标签解析缓冲
    let inThinkTag = false;  // 是否在 <think 标签内

    if (streamOutputEnabled) {
        // 流式处理
        console.log('[ToolCalling] handleFollowupResponse 开始流式读取, round:', round);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let bubbleCreated = false;

        while (true) {
            // 用户点击了停止生成，中止流式读取
            if (!abortController || abortController.signal.aborted) break;
            let readResult;
            try {
                // 给每次 read 加超时（5分钟）
                readResult = await Promise.race([
                    reader.read(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('流式读取超时')), 300000))
                ]);
            } catch (readErr) {
                console.error('[ToolCalling] 流式读取异常:', readErr);
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
                    // 每个 chunk 都更新 streaming 计数器（DeepSeek thinking 模式下 chunk 可能只有 reasoning_content 没有 content）
                    if (typeof updateStreamingPlaceholder === 'function') {
                        updateStreamingPlaceholder((_streamingCounter || 0) + 1);
                    }
                    const delta = chunk.choices?.[0]?.delta;
                    if (delta) {
                        // 思考内容（标准格式：reasoning_content / thinking.content / reasoning_details）
                        const reasoningDelta = delta.reasoning_content || delta.thinking?.content ||
                            (delta.reasoning_details && delta.reasoning_details.length > 0
                                ? delta.reasoning_details.map(item => item.text || '').join('')
                                : '');
                        if (reasoningDelta) {
                            if (!bubbleCreated) {
                                currentAiContent = '';
                                currentThinkingContent = '';
                                currentAiMessageDiv = appendMessage('ai', '', true, false, Date.now());
                                bubbleCreated = true;
                            }
                            reasoning += reasoningDelta;
                            updateThinking(reasoningDelta);
                        }
                        // 正文内容
                        if (delta.content) {
                            if (!bubbleCreated) {
                                currentAiContent = '';
                                currentThinkingContent = '';
                                currentAiMessageDiv = appendMessage('ai', '', true, false, Date.now());
                                bubbleCreated = true;
                            }
                            // MiniMax 用 <think>...</think> 标签包裹思考内容，需要解析
                            if (currentAIProvider === 'minimax') {
                                contentBuffer += delta.content;
                                // 尝试解析已缓冲的内容
                                while (contentBuffer.length > 0) {
                                    if (!inThinkTag) {
                                        // 不在 think 标签内，找 <think
                                        const thinkStart = contentBuffer.indexOf('<think');
                                        if (thinkStart >= 0) {
                                            // <think 之前的内容作为正文输出
                                            const beforeThink = contentBuffer.substring(0, thinkStart);
                                            if (beforeThink) {
                                                content += beforeThink;
                                                appendToLastMessage(beforeThink);

                                            }
                                            contentBuffer = contentBuffer.substring(thinkStart);
                                            inThinkTag = true;
                                        } else {
                                            // 没有 <think，检查缓冲区是否可能包含不完整的标签
                                            const possiblePartial = contentBuffer.lastIndexOf('<');
                                            if (possiblePartial >= 0 && possiblePartial > contentBuffer.length - 7) {
                                                // 可能是不完整的 <think 标签，保留
                                                const safeContent = contentBuffer.substring(0, possiblePartial);
                                                if (safeContent) {
                                                    content += safeContent;
                                                    appendToLastMessage(safeContent);

                                                }
                                                contentBuffer = contentBuffer.substring(possiblePartial);
                                            } else {
                                                // 全部作为正文输出
                                                content += contentBuffer;
                                                appendToLastMessage(contentBuffer);

                                                contentBuffer = '';
                                            }
                                            break;
                                        }
                                    } else {
                                        // 在 think 标签内，找 </think>
                                        const thinkEnd = contentBuffer.indexOf('</think');
                                        if (thinkEnd >= 0) {
                                            // 跳过 <think 后面的 > 字符
                                            const thinkContent = contentBuffer.substring(0, thinkEnd);
                                            if (thinkContent) {
                                                reasoning += thinkContent;
                                                updateThinking(thinkContent);
                                            }
                                            // 跳过 </think> 标签
                                            const afterEnd = contentBuffer.indexOf('>', thinkEnd);
                                            contentBuffer = afterEnd >= 0 ? contentBuffer.substring(afterEnd + 1) : '';
                                            inThinkTag = false;
                                        } else {
                                            // 还没结束，全部作为思考内容
                                            reasoning += contentBuffer;
                                            updateThinking(contentBuffer);
                                            contentBuffer = '';
                                            break;
                                        }
                                    }
                                }
                            } else {
                                content += delta.content;
                                appendToLastMessage(delta.content);

                            }
                        }
                        // 收集 tool_calls
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index ?? tcBuffer.length;
                                let existing = tcBuffer[idx];
                                if (existing) {
                                    if (tc.id) existing.id = tc.id;
                                    if (tc.function?.name) existing.function.name = tc.function.name;
                                    if (tc.function?.arguments) {
                                        existing.function.arguments = (existing.function.arguments || '') + tc.function.arguments;
                                    }
                                } else {
                                    while (tcBuffer.length <= idx) tcBuffer.push(null);
                                    tcBuffer[idx] = {
                                        id: tc.id || '',
                                        function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' }
                                    };
                                }
                            }
                        }
                    }
                } catch (e) {
                    if (e instanceof Error && e.message) throw e;
                }
            }
        }

        // 流式输出完成后自动折叠思考内容
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
        // 非流式处理
        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('[ToolCalling] 非流式响应解析失败:', responseText.substring(0, 500));
            throw new Error(`API 响应解析失败: ${e.message}`);
        }
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        const message = data.choices?.[0]?.message || {};
        content = message.content || '';
        reasoning = message.reasoning_content || '';
        // MiniMax 格式：reasoning_details 数组
        if (!reasoning && message.reasoning_details && message.reasoning_details.length > 0) {
            reasoning = message.reasoning_details.map(item => item.text || '').join('');
        }
        if (message.tool_calls && message.tool_calls.length > 0) {
            tcBuffer = message.tool_calls;
        }

        // 创建消息气泡
        if (reasoning) {
            const newBubble = appendMessage('ai', content, true, false, Date.now());
            prependThinking(newBubble, reasoning);
        } else {
            appendMessage('ai', content, true, false, Date.now());
        }
    }

    const validToolCalls = tcBuffer.filter(tc => tc && tc.function?.name);
    console.log(`[ToolCalling] follow-up 第${round + 1}轮: 文本${content.length}字, tool_calls ${validToolCalls.length}个`);
    return { content, reasoning: reasoning || null, toolCalls: validToolCalls };
}

// ==================== 多轮 tool_calls 主循环 ====================

/**
 * 处理多轮 tool_calls 调用
 * 在 app.js 的 handleResponse 公共后处理中调用
 * 
 * @param {Array} messages - 消息数组（会被修改）
 * @param {HTMLElement} aiMessageDiv - 当前 AI 消息的 DOM 元素
 * @returns {Promise<boolean>} 是否执行了 tool_calls 处理
 */
async function processToolCalls(messages, aiMessageDiv) {
    const validCalls = getValidToolCalls();
    if (validCalls.length === 0) return false;
    if (!isFunctionCallingProvider() || !(expertModeEnabled || webSearchEnabled || hasMcpToolsAvailable())) return false;

    console.log('[ToolCalling] 收到 tool_calls:', validCalls.length, '个');

    // 获取当前 assistant 消息的版本 id（用于 prevId 链路追踪）
    const currentAsstMsgId = aiMessageDiv?.dataset?.messageId || messages[messages.length - 1]?.id || null;
    const asstIdx = findMessageIndexById(currentAsstMsgId);
    const asstMsg = asstIdx >= 0 ? messages[asstIdx] : null;
    const currentAsstId = asstMsg ? getCurrentVersionId(asstMsg) : currentAsstMsgId;
    // 追踪链上最后一条消息的 id
    let chainLastId = currentAsstId;

    // 将 tool_calls 注入到当前 assistant 消息中（API 要求）
    if (asstMsg && asstMsg.role === 'assistant') {
        asstMsg.tool_calls = validCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments || {})
            }
        }));
        // tool_calls 场景下 content 应为 null
        if (!asstMsg.content) asstMsg.content = null;
        // 同步到当前版本（regenerate 时 tool_calls 应存在版本上）
        if (asstMsg.versions && asstMsg.versions.length > 0) {
            const curVer = asstMsg.versions[asstMsg.currentVersionIndex || 0];
            if (curVer) {
                curVer.tool_calls = asstMsg.tool_calls;
                if (!curVer.content) curVer.content = null;
            }
        }
    }

    // 显示工具执行状态提示
    const hasNonSearchTool = validCalls.some(tc => !['web_search', 'fetch_url'].includes(tc.function?.name));
    showToolStatus(aiMessageDiv, hasNonSearchTool ? '正在执行工具...' : '正在搜索...');

    // 执行每个 tool_call，逐个插入卡片（和PC端一样 appendChild 到末尾）
    let abortToolCalling = false;
    for (const tc of validCalls) {
        // 用户点击了停止生成，中止工具调用
        if (!abortController || abortController.signal.aborted) {
            abortToolCalling = true;
            break;
        }
        const tcName = tc.function?.name || '工具';
        // 解析参数
        let toolArgs = null;
        try {
            toolArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
        } catch (e) {}

        // 1. 先创建 tool-call-card（pending 状态），和PC端一样
        const toolName = tc.function?.name || '';
        const params = getWebSearchToolParams(toolName, toolArgs);
        const toolCard = document.createElement('div');
        toolCard.className = 'tool-call-card';
        toolCard.innerHTML = `<div class="tool-call-header"><span class="tool-call-name">${toolName}</span><span class="tool-call-params">${escapeHtml(params)}</span></div><div class="tool-call-result">⎿ ...</div>`;
        chatContainer.appendChild(toolCard);


        // 搜索进度百分比
        const progressResultEl = toolCard.querySelector('.tool-call-result');
        let progressTimer = null;
        if (toolName === 'web_search' && toolArgs?.queries) {
            progressTimer = startSearchProgress(progressResultEl, toolArgs.queries.length);
        }

        // 2. 执行工具
        if (!abortController || abortController.signal.aborted) {
            abortToolCalling = true;
            break;
        }
        let toolResult = await executeToolCall(tc);
        stopSearchProgress(progressTimer);

        // 3. 检测 needsConfirm — 展示确认卡片（仅本地工具，PC端工具已在 executeToolOnPC 内处理）
        let confirmInfo = null;
        const isPCTool = toolArgs && toolArgs.device === 'pc';
        if (!isPCTool) {
            try {
                const parsed = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
                if (parsed && parsed.needsConfirm) {
                    confirmInfo = parsed;
                }
            } catch (e) { /* 不是 JSON */ }
        }

        if (confirmInfo) {
            toolResult = await showConfirmCard(tc, toolArgs, confirmInfo, chatContainer);
        }

        // 4. 提取 diffHtml/diffMeta，生成简洁 resultStr
        let _diffHtml = null, _diffMeta = null;
        let cleanResult = toolResult;
        try {
            const parsed = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
            if (parsed && parsed._diffHtml) {
                _diffHtml = parsed._diffHtml;
                _diffMeta = parsed._diffMeta || null;
                const a = _diffMeta.added || 0;
                const r = _diffMeta.removed || 0;
                cleanResult = `用户已允许修改：${_diffMeta.path || ''} (+${a} -${r})`;
            }
        } catch (e) {}

        // 5. 更新 tool-call-card 的结果
        let displaySummary = cleanResult;
        let apiToolContent = cleanResult;
        // 检测图片结果，转为多模态 content
        try {
            const parsed = typeof cleanResult === 'string' ? JSON.parse(cleanResult) : cleanResult;
            if (parsed && parsed.image) {
                const imgDesc = `[read_file] 已读取图片文件: ${parsed.path}`;
                displaySummary = imgDesc;
                if (currentAIProvider === 'qwen' || currentAIProvider === 'doubao') {
                    apiToolContent = [
                        { type: 'input_text', text: imgDesc },
                        { type: 'input_image', image_url: parsed.image }
                    ];
                } else {
                    apiToolContent = [
                        { type: 'text', text: imgDesc },
                        { type: 'image_url', image_url: { url: parsed.image } }
                    ];
                }
            }
        } catch (e) {}

        const summary = getWebSearchResultSummary(displaySummary);
        const isError = summary.startsWith('❌');
        const resultEl = toolCard.querySelector('.tool-call-result');
        if (resultEl) {
            resultEl.className = `tool-call-result${isError ? ' error' : ''}`;
            resultEl.textContent = `⎿ ${summary}`;
        }
        const toolMsgId = generateMessageId();
        toolCard.dataset.messageId = toolMsgId;
        messages.push({
            id: toolMsgId,
            role: 'tool',
            tool_call_id: tc.id,
            content: apiToolContent,
            tool_name: tc.function?.name || '',
            tool_args: toolArgs,
            diffHtml: _diffHtml,
            diffMeta: _diffMeta,
            prevId: chainLastId
        });
        chainLastId = toolMsgId;
        // 用户拒绝：中断后续 tool calling
        try {
            const parsed = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
            if (parsed && parsed.rejected) {
                abortToolCalling = true;
                break;
            }
        } catch (e) {}
    }
    // 移除第一轮搜索状态提示
    removeToolStatus(aiMessageDiv);

    // 用户拒绝：中断后续请求
    if (abortToolCalling) {
        console.log('[ToolCalling] 用户拒绝，中断后续请求');
        return false;
    }

    // 构建后续请求
    const _isResponses = typeof isResponsesProvider === 'function' && isResponsesProvider();
    let followupBody, followupEndpoint;
    // Responses API 模式：收集本轮 tool 结果，用 function_call_output 回填
    let responsesToolResults = [];
    let responsesPrevId = null;

    if (_isResponses) {
        // Responses API：后续请求不需要完整 messages，用 previous_response_id 关联
        // 先收集本轮所有 tool 结果
        for (const tc of validCalls) {
            // 找到对应的 tool 消息
            const toolMsg = messages.find(m => m.role === 'tool' && m.tool_call_id === tc.id);
            const output = toolMsg ? (typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)) : '';
            responsesToolResults.push({ callId: tc.id, output });
        }
        // 获取上一轮 AI 消息的 responseId
        if (asstMsg) {
            responsesPrevId = (asstMsg.versions && asstMsg.versions.length > 0)
                ? (asstMsg.versions[asstMsg.currentVersionIndex || 0]?.responseId)
                : asstMsg.responseId;
        }
        followupBody = buildResponsesFollowupBody(messages, responsesPrevId, responsesToolResults);
        followupEndpoint = getResponsesEndpoint();
        console.log('[ToolCalling] Responses API 模式, previous_response_id:', responsesPrevId, 'tool结果:', responsesToolResults.length);
    } else {
        // Chat Completions 模式（原有逻辑）
        followupBody = buildRequestBodyFromMessages(messages);
        const tools = getToolDefinitions();
        if (tools) followupBody.tools = tools;
        followupEndpoint = getAPIEndpoint();
    }

    try {
        const followupHeaders = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        };

        // 多轮循环
        let loopBody = followupBody;
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            // 用户点击了停止生成，中止多轮循环
            if (!abortController || abortController.signal.aborted) {
                console.log('[ToolCalling] 用户已停止生成，退出多轮循环');
                break;
            }
            console.log(`[ToolCalling] 第 ${round + 1} 轮后续请求`);

            // 超时提醒（30秒无响应打日志，不中断请求）
            const fetchTimeout = setTimeout(() => {
                console.warn('[ToolCalling] 第 ' + (round + 1) + ' 轮请求已等待超过30秒');
            }, 300000);
            let followupResponse = null;
            const MAX_FOLLOWUP_RETRIES = 5;
            let followupRetryCount = 0;

            while (followupRetryCount <= MAX_FOLLOWUP_RETRIES) {
                if (!abortController || abortController.signal.aborted) break;
                try {
                    followupResponse = await fetch(followupEndpoint, {
                        method: 'POST',
                        headers: followupHeaders,
                        body: JSON.stringify(loopBody),
                        signal: abortController?.signal
                    });
                } catch (fetchErr) {
                    if (fetchErr.name === 'AbortError') {
                        console.warn('[ToolCalling] 第 ' + (round + 1) + ' 轮请求被中止');
                        appendToLastMessage('\n⚠️ 请求已中止');
                        followupResponse = null;
                        break;
                    }
                    if (followupRetryCount >= MAX_FOLLOWUP_RETRIES) {
                        console.error('[ToolCalling] 第 ' + (round + 1) + ' 轮 fetch 异常:', fetchErr.message || fetchErr);
                        appendToLastMessage('\n⚠️ 网络请求失败: ' + (fetchErr.message || fetchErr));
                        followupResponse = null;
                        break;
                    }
                    followupRetryCount++;
                    appendToLastMessage(`\n⏳ 网络错误，正在重试（${followupRetryCount}/${MAX_FOLLOWUP_RETRIES}）...`);
                    await new Promise(resolve => {
                        const timer = setTimeout(resolve, 5000);
                        const checkStop = setInterval(() => {
                            if (!abortController || abortController.signal.aborted) {
                                clearTimeout(timer);
                                clearInterval(checkStop);
                                resolve();
                            }
                        }, 200);
                    });
                    continue;
                }

                if (!followupResponse.ok) {
                    const errText = await followupResponse.text();
                    const _isRetryable = /(?:429|[5]\d\d)/.test(String(followupResponse.status));
                    if (!_isRetryable || followupRetryCount >= MAX_FOLLOWUP_RETRIES) {
                        console.error('[ToolCalling] 后续请求失败:', followupResponse.status, errText);
                        appendToLastMessage('\n⚠️ 搜索结果回传失败: ' + followupResponse.status);
                        followupResponse = null;
                        break;
                    }
                    followupRetryCount++;
                    console.log(`[ToolCalling] 回传失败（${followupResponse.status}），5秒后第 ${followupRetryCount} 次重试...`);
                    appendToLastMessage(`\n⏳ 回传失败（${followupResponse.status}），正在重试（${followupRetryCount}/${MAX_FOLLOWUP_RETRIES}）...`);
                    await new Promise(resolve => {
                        const timer = setTimeout(resolve, 5000);
                        const checkStop = setInterval(() => {
                            if (!abortController || abortController.signal.aborted) {
                                clearTimeout(timer);
                                clearInterval(checkStop);
                                resolve();
                            }
                        }, 200);
                    });
                    continue;
                }
                // 请求成功
                break;
            }
            clearTimeout(fetchTimeout);

            if (!followupResponse) break;

            const result = _isResponses
                ? await handleResponsesFollowupResponse(followupResponse, round)
                : await handleFollowupResponse(followupResponse, round);

            // 用户点击了停止生成，不再处理后续 tool_calls
            if (!abortController || abortController.signal.aborted) {
                console.log('[ToolCalling] 用户已停止生成，不再处理后续 tool_calls');
                break;
            }

            if (result.toolCalls && result.toolCalls.length > 0) {
                // 有新的 tool_calls，执行后继续循环
                const midAsstId = generateMessageId();
                messages.push({
                    id: midAsstId,
                    role: 'assistant',
                    content: result.content || null,
                    reasoning: result.reasoning || null,
                    modelName: selectedModel,
                    prevId: chainLastId,
                    tool_calls: result.toolCalls.filter(tc => tc && tc.function?.name).map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.function.name,
                            arguments: typeof tc.function.arguments === 'string'
                                ? tc.function.arguments
                                : JSON.stringify(tc.function.arguments || {})
                        }
                    }))
                });
                chainLastId = midAsstId;

                // 给刚创建的 followup assistant 气泡补上 data-message-id
                const lastAiBubble = chatContainer.querySelector('.message.ai:last-of-type');
                if (lastAiBubble && !lastAiBubble.dataset.messageId) {
                    lastAiBubble.dataset.messageId = midAsstId;
                }

                // 显示搜索状态
                showToolStatus(aiMessageDiv, '正在搜索...');

                // 执行搜索，逐个插入卡片（和PC端一样 appendChild 到末尾）
                let loopAbort = false;
                for (const tc of result.toolCalls) {
                    // 用户点击了停止生成，中止工具执行
                    if (!abortController || abortController.signal.aborted) {
                        loopAbort = true;
                        break;
                    }
                    const loopTcName = tc.function?.name || '工具';
                    let loopToolArgs = null;
                    try {
                        loopToolArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
                    } catch (e) {}

                    // 1. 先创建 tool-call-card（pending 状态）
                    const loopToolName = tc.function?.name || '';
                    const loopParams = getWebSearchToolParams(loopToolName, loopToolArgs);
                    const toolCard = document.createElement('div');
                    toolCard.className = 'tool-call-card';
                    toolCard.innerHTML = `<div class="tool-call-header"><span class="tool-call-name">${loopToolName}</span><span class="tool-call-params">${escapeHtml(loopParams)}</span></div><div class="tool-call-result">⎿ ...</div>`;
                    chatContainer.appendChild(toolCard);


                    // 搜索进度百分比
                    const loopResultEl = toolCard.querySelector('.tool-call-result');
                    let loopProgressTimer = null;
                    if (loopToolName === 'web_search' && loopToolArgs?.queries) {
                        loopProgressTimer = startSearchProgress(loopResultEl, loopToolArgs.queries.length);
                    }

                    // 2. 执行工具
                    let toolResult = await executeToolCall(tc);
                    stopSearchProgress(loopProgressTimer);

                    // 3. 检测 needsConfirm（仅本地工具）
                    let confirmInfo = null;
                    const isPCTool = loopToolArgs && loopToolArgs.device === 'pc';
                    if (!isPCTool) {
                        try {
                            const parsed = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
                            if (parsed && parsed.needsConfirm) {
                                confirmInfo = parsed;
                            }
                        } catch (e) { /* 不是 JSON */ }
                    }

                    if (confirmInfo) {
                        toolResult = await showConfirmCard(tc, loopToolArgs, confirmInfo, chatContainer);
                    }

                    // 4. 提取 diffHtml/diffMeta，生成简洁 resultStr
                    let _loopDiffHtml = null, _loopDiffMeta = null;
                    let loopCleanResult = toolResult;
                    try {
                        const parsed = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
                        if (parsed && parsed._diffHtml) {
                            _loopDiffHtml = parsed._diffHtml;
                            _loopDiffMeta = parsed._diffMeta || null;
                            const a = _loopDiffMeta.added || 0;
                            const r = _loopDiffMeta.removed || 0;
                            loopCleanResult = `用户已允许修改：${_loopDiffMeta.path || ''} (+${a} -${r})`;
                        }
                    } catch (e) {}

                    // 5. 更新 tool-call-card 的结果
                    let loopDisplaySummary = loopCleanResult;
                    let loopApiToolContent = loopCleanResult;
                    try {
                        const parsed = typeof loopCleanResult === 'string' ? JSON.parse(loopCleanResult) : loopCleanResult;
                        if (parsed && parsed.image) {
                            const imgDesc = `[read_file] 已读取图片文件: ${parsed.path}`;
                            loopDisplaySummary = imgDesc;
                            if (currentAIProvider === 'qwen' || currentAIProvider === 'doubao') {
                                loopApiToolContent = [
                                    { type: 'input_text', text: imgDesc },
                                    { type: 'input_image', image_url: parsed.image }
                                ];
                            } else {
                                loopApiToolContent = [
                                    { type: 'text', text: imgDesc },
                                    { type: 'image_url', image_url: { url: parsed.image } }
                                ];
                            }
                        }
                    } catch (e) {}

                    const loopSummary = getWebSearchResultSummary(loopDisplaySummary);
                    const isError = loopSummary.startsWith('❌');
                    const resultEl = toolCard.querySelector('.tool-call-result');
                    if (resultEl) {
                        resultEl.className = `tool-call-result${isError ? ' error' : ''}`;
                        resultEl.textContent = `⎿ ${loopSummary}`;
                    }
                    const loopToolMsgId = generateMessageId();
                    toolCard.dataset.messageId = loopToolMsgId;
                    messages.push({
                        id: loopToolMsgId,
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: loopApiToolContent,
                        tool_name: tc.function?.name || '',
                        tool_args: loopToolArgs,
                        diffHtml: _loopDiffHtml,
                        diffMeta: _loopDiffMeta,
                        prevId: chainLastId
                    });
                    chainLastId = loopToolMsgId;

                    // 用户拒绝：中断
                    try {
                        const parsed = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;
                        if (parsed && parsed.rejected) {
                            loopAbort = true;
                            break;
                        }
                    } catch (e) {}
                }
                // 移除搜索状态
                removeToolStatus(aiMessageDiv);

                // 用户拒绝：中断多轮循环
                if (loopAbort) {
                    console.log('[ToolCalling] 用户拒绝，中断多轮循环');
                    clearToolCallsBuffer();
                    return false;
                }

                // 构建下一轮请求
                if (_isResponses) {
                    // Responses API：收集本轮 tool 结果，用 responseId 关联
                    const loopToolResults = [];
                    for (const tc of result.toolCalls) {
                        const toolMsg = messages.find(m => m.role === 'tool' && m.tool_call_id === tc.id);
                        const output = toolMsg ? (typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)) : '';
                        loopToolResults.push({ callId: tc.id, output });
                    }
                    loopBody = buildResponsesFollowupBody(messages, result.responseId, loopToolResults);
                } else {
                    // Chat Completions（原有逻辑）
                    loopBody = buildRequestBodyFromMessages(messages);
                    const loopTools = getToolDefinitions();
                    if (loopTools) loopBody.tools = loopTools;
                }
            } else {
                // 纯文本回复，结束循环
                if (result.content || result.reasoning) {
                    const newMsg = createAssistantMessage(result.content, result.reasoning || null, result.responseId || null, null, chainLastId);
                    messages.push(newMsg);
                    chainLastId = newMsg.id;
                    // 给刚创建的 followup assistant 气泡补上 data-message-id
                    const lastAiBubble = chatContainer.querySelector('.message.ai:last-of-type');
                    if (lastAiBubble && !lastAiBubble.dataset.messageId) {
                        lastAiBubble.dataset.messageId = newMsg.id;
                    }
                }
                break;
            }
        }

        // 达到最大轮数后，如果最后一轮还有 tool_calls，强制发一次不带 tools 的请求
        // 让 DeepSeek 基于已有搜索结果生成最终回答
        const lastRoundResult = await handleLastRoundForceReply(followupHeaders, messages, chainLastId);
        if (lastRoundResult) {
            const forceMsg = createAssistantMessage(lastRoundResult.content, lastRoundResult.reasoning || null, null, null, chainLastId);
            messages.push(forceMsg);
            chainLastId = forceMsg.id;
            // 给强制回复的 assistant 气泡补上 data-message-id
            const lastAiBubble = chatContainer.querySelector('.message.ai:last-of-type');
            if (lastAiBubble && !lastAiBubble.dataset.messageId) {
                lastAiBubble.dataset.messageId = forceMsg.id;
            }
        }

        console.log('[ToolCalling] 多轮工具调用完成');
    } catch (e) {
        console.error('[ToolCalling] 后续请求失败:', e);
        appendToLastMessage('\n⚠️ 搜索结果回传失败: ' + e.message);
    }

    clearToolCallsBuffer();
    return true;
}

// ==================== 达到最大轮数后强制回复 ====================

/**
 * 达到最大轮数后，强制发一次不带 tools 的请求，让 AI 基于已有搜索结果生成最终回答
 * @param {object} headers - 请求头
 * @param {Array} messages - 消息数组
 * @returns {Promise<{content: string, reasoning: string|null}|null>}
 */
async function handleLastRoundForceReply(headers, messages, chainLastId) {
    try {
        // 检查最后一条消息是否是 tool 消息（说明循环结束时还有未回复的 tool 结果）
        // 检查链上最后一条消息是否是 tool 消息（通过 chainLastId 追踪）
        const lastChainIdx = findMessageIndexById(chainLastId);
        const lastChainMsg = lastChainIdx >= 0 ? messages[lastChainIdx] : null;
        if (!lastChainMsg || lastChainMsg.role !== 'tool') return null;

        console.log('[ToolCalling] 达到最大轮数，强制生成最终回答');
        
        const _isResponses = typeof isResponsesProvider === 'function' && isResponsesProvider();
        let forceBody, forceEndpoint;
        
        if (_isResponses) {
            // Responses API：不带 tools，用 previous_response_id 关联
            forceBody = buildResponsesFollowupBody(messages, null, []);
            delete forceBody.tools;
            forceEndpoint = getResponsesEndpoint();
        } else {
            // Chat Completions（原有逻辑）
            forceBody = buildRequestBody(null, null, null, null);
            delete forceBody.tools;
            forceEndpoint = getAPIEndpoint();
        }

        const forceResponse = await fetch(forceEndpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(forceBody),
            signal: abortController?.signal
        });

        if (!forceResponse.ok) return null;

        const result = _isResponses
            ? await handleResponsesFollowupResponse(forceResponse, MAX_TOOL_ROUNDS)
            : await handleFollowupResponse(forceResponse, MAX_TOOL_ROUNDS);
        if (result.content || result.reasoning) {
            return result;
        }
    } catch (e) {
        console.error('[ToolCalling] 强制回复失败:', e);
    }
    return null;
}

// ==================== UI 辅助 ====================

/**
 * 直接用 messages 数组构建请求体，避免 buildRequestBody 的截断逻辑破坏 tool 消息完整性
 */
function buildRequestBodyFromMessages(msgs) {
    const agent = getCurrentAgent();
    let systemContent = agent.systemPrompt || '';
    if (agent.name) {
        systemContent = systemContent
            ? `你的智能体名称是${agent.name}。\n\n${systemContent}`
            : `你的智能体名称是${agent.name}。`;
    }
    const apiMessages = [];
    if (systemContent) {
        apiMessages.push({ role: 'system', content: systemContent });
    }
    // 只取当前时间线上的可见消息（根据 prevId 链过滤）
    const visibleMsgs = getVisibleTimelineMessages();
    const visibleIds = new Set(visibleMsgs.map(m => m.id));
    for (const msg of visibleMsgs) {
        // 如果有版本，用当前版本的属性
        const currentVer = (msg.versions && msg.versions.length > 0)
            ? msg.versions[msg.currentVersionIndex || 0] : null;
        const effectiveContent = currentVer ? (currentVer.content ?? null) : msg.content;
        const apiMsg = { role: msg.role, content: effectiveContent };
        // 如果有版本，用当前版本的 tool_calls；没有版本则用消息本身的
        const effectiveToolCalls = (msg.versions && msg.versions.length > 0)
            ? (currentVer?.tool_calls || null)
            : msg.tool_calls;
        if (effectiveToolCalls) {
            apiMsg.tool_calls = effectiveToolCalls;
        }
        if (msg.tool_call_id) apiMsg.tool_call_id = msg.tool_call_id;
        if (msg.name) apiMsg.name = msg.name;
        // DeepSeek/Kimi 深度思考模式要求 assistant 消息带 reasoning_content
        if (msg.role === 'assistant' && ['deepseek', 'kimi'].includes(currentAIProvider)) {
            apiMsg.reasoning_content = msg.reasoning || '';
        }
        apiMessages.push(apiMsg);
    }
    const body = {
        model: selectedModel,
        messages: apiMessages,
        stream: streamOutputEnabled
    };
    // GLM 流式工具调用需要 tool_stream
    if (currentAIProvider === 'glm') {
        body.tool_stream = true;
    }
    return body;
}

/**
 * 显示工具执行状态
 */
function showToolStatus(aiMessageDiv, text) {
    if (!aiMessageDiv) return;
    const mc = aiMessageDiv.querySelector('.message-content');
    if (!mc) return;
    const statusEl = document.createElement('div');
    statusEl.className = 'tool-status';
    statusEl.style.cssText = 'color:var(--deep-thinking-on, #10b981);font-size:12px;margin-top:4px;';
    statusEl.textContent = text;
    mc.appendChild(statusEl);
}

/**
 * 启动搜索进度，在工具卡片结果区显示百分比
 * @param {HTMLElement} resultEl - tool-call-result 元素
 * @param {number} keywordCount - 关键词数量
 * @returns {number} timer ID，用于停止
 */
function startSearchProgress(resultEl, keywordCount) {
    if (!resultEl || !keywordCount) return null;
    const totalTime = keywordCount * 5000;
    const startTime = Date.now();
    const timer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(99, Math.round((elapsed / totalTime) * 100));
        resultEl.textContent = `⎿ ... ${pct}%`;
        if (pct >= 99) clearInterval(timer);
    }, 300);
    return timer;
}

/**
 * 停止搜索进度
 */
function stopSearchProgress(timer) {
    if (timer) clearInterval(timer);
}

/**
 * 移除工具执行状态
 */
function removeToolStatus(aiMessageDiv) {
    const statusEl = aiMessageDiv?.querySelector('.tool-status');
    if (statusEl) statusEl.remove();
}

/**
 * 检查并发送前的验证
 * @returns {string|null} 错误消息，null 表示通过
 */
function checkToolCallingPrerequisites() {
    if (!isFunctionCallingProvider()) return null;
    if (!webSearchEnabled) return null;
    // 检查 AndroidBridge 是否可用
    if (!window.AndroidBridge || typeof window.AndroidBridge.httpGet !== 'function') {
        return '⚠️ 联网搜索需要在 Android App 环境中使用。';
    }
    return null;
}

// ==================== 初始化 ====================

/**
 * 初始化工具调用模块
 * 在 DOMContentLoaded 或 app.js 初始化完成后调用
 */
function initToolCalling() {
    console.log('[ToolCalling] 初始化工具调用模块（百度+必应本地搜索）');

    // 同步专家模式状态
    expertModeEnabled = localStorage.getItem('cnai_expert_mode') === '1';

    // 初始化 MCP 客户端（由 app.js init() 统一调用）

    // 联网搜索开关变化时的提示
    const webSearchSwitch = document.getElementById('webSearchSwitch');
    if (webSearchSwitch) {
        webSearchSwitch.addEventListener('change', () => {
            if (webSearchSwitch.checked && isFunctionCallingProvider() && deepThinkingEnabled) {
                showToast('联网搜索时会自动关闭深度思考');
            }
        });
    }

    // 更新 UI 显示
    updateToolCallingUI();
}

console.log('[ToolCalling] 模块已加载（百度+必应本地搜索，无需 API Key）');