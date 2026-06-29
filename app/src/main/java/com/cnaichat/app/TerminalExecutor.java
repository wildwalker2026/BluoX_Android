package com.cnaichat.app;

import android.content.Context;
import android.os.Environment;
import android.util.Log;

import java.io.*;
import java.util.concurrent.*;

/**
 * 内置终端执行器
 * 使用 Android 系统 Shell (/system/bin/sh) 执行命令，无需 root。
 *
 * 工作原理：
 * - HOME 目录：app/files/terminal/home（可读写）
 * - TMP 目录：app/files/terminal/tmp
 * - 通过 MANAGE_EXTERNAL_STORAGE 权限访问 /sdcard
 * - BusyBox: 首次使用时从 assets 解压，扩展 300+ 命令（wget/vi/nc 等）
 */
public class TerminalExecutor {
    private static final String TAG = "TerminalExecutor";
    private static final int DEFAULT_TIMEOUT = 30;        // 默认超时（秒）
    private static final int MAX_OUTPUT_CHARS = 50000;    // 输出最大字符数

    private final Context context;
    private final File homeDir;
    private final File tmpDir;
    private final File binDir;   // BusyBox 及符号链接目录

    // BusyBox 状态
    private volatile boolean busyboxReady = false;

    // 当前正在运行的进程（用于取消）
    private volatile Process currentProcess = null;
    private volatile boolean cancelled = false;

    public TerminalExecutor(Context context) {
        this.context = context;
        this.homeDir = new File(context.getFilesDir(), "terminal/home");
        this.tmpDir = new File(context.getFilesDir(), "terminal/tmp");
        this.binDir = new File(context.getFilesDir(), "terminal/bin");
        if (!homeDir.exists()) homeDir.mkdirs();
        if (!tmpDir.exists()) tmpDir.mkdirs();
        if (!binDir.exists()) binDir.mkdirs();
        // 异步初始化 BusyBox（不阻塞构造函数）
        new Thread(this::initBusybox).start();
    }

    /**
     * 执行 Shell 命令
     *
     * @param command   要执行的命令
     * @param timeoutSec 超时时间（秒），<=0 用默认值
     * @return JSON: {exitCode, output, workDir} 或 {error}
     */
    public String execute(String command, int timeoutSec) {
        if (timeoutSec <= 0) timeoutSec = DEFAULT_TIMEOUT;
        cancelled = false;  // 重置取消标志
        currentProcess = null;

        try {
            // ── 安全检查 ──
            String blockReason = checkDangerousCommand(command);
            if (blockReason != null) {
                return "{\"error\":\"命令被安全检查拦截: " + escapeJson(blockReason) + "\"}";
            }

            // ── 启动进程 ──
            ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-c", command);
            pb.directory(homeDir);
            setupEnvironment(pb);
            pb.redirectErrorStream(true);

            Process process = pb.start();
            currentProcess = process;  // 保存引用，供 cancel() 使用

            // ── 读取输出（带超时 + 取消检查） ──
            StringBuilder output = new StringBuilder();
            InputStream is = process.getInputStream();

            ExecutorService pool = Executors.newSingleThreadExecutor();
            Future<Integer> future = pool.submit(() -> {
                byte[] buffer = new byte[4096];
                int len;
                int totalChars = 0;
                while ((len = is.read(buffer)) != -1) {
                    // 检查是否被取消
                    if (cancelled) {
                        process.destroyForcibly();
                        break;
                    }
                    String chunk = new String(buffer, 0, len);
                    if (totalChars + chunk.length() > MAX_OUTPUT_CHARS) {
                        int remaining = MAX_OUTPUT_CHARS - totalChars;
                        if (remaining > 0) output.append(chunk, 0, remaining);
                        output.append("\n\n...（输出已截断，超过 ").append(MAX_OUTPUT_CHARS).append(" 字符）");
                        break;
                    }
                    output.append(chunk);
                    totalChars += chunk.length();
                    // 同步检查中断
                    if (Thread.currentThread().isInterrupted()) break;
                }
                return process.waitFor();
            });

            int exitCode;
            try {
                exitCode = future.get(timeoutSec, TimeUnit.SECONDS);
            } catch (TimeoutException e) {
                process.destroyForcibly();
                pool.shutdownNow();
                // 返回已有的输出
                String partial = output.toString().trim();
                return "{\"error\":\"命令执行超时（" + timeoutSec + "秒），已终止\"" +
                        (partial.isEmpty() ? "" : ",\"partial\":\"" + escapeJson(partial) + "\"") + "}";
            } catch (Exception e) {
                process.destroyForcibly();
                pool.shutdownNow();
                return "{\"error\":\"命令执行异常: " + escapeJson(e.getMessage()) + "\"}";
            } finally {
                pool.shutdownNow();
                currentProcess = null;
            }

            is.close();
            String result = output.toString().trim();

            // 被用户取消
            if (cancelled) {
                return "{\"cancelled\":true" +
                        (result.isEmpty() ? "" : ",\"partial\":\"" + escapeJson(result) + "\"") + "}";
            }

            // 命令失败时检测是否需要 Termux 环境
            if (exitCode != 0 && !result.isEmpty()) {
                String lowerResult = result.toLowerCase();
                if (lowerResult.contains("inaccessible") || lowerResult.contains("not found") || lowerResult.contains("no such file")) {
                    result = result + "\n\n该命令无效！改用 run_termux_command 工具！";
                }
            }

            return "{\"exitCode\":" + exitCode +
                    ",\"output\":\"" + escapeJson(result) + "\"" +
                    ",\"workDir\":\"" + escapeJson(homeDir.getAbsolutePath()) + "\"}";

        } catch (Exception e) {
            Log.e(TAG, "execute 失败: " + e.getMessage());
            return "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    /**
     * 异步执行命令，结果通过 WebView 回调返回
     * @param command   要执行的命令
     * @param timeoutSec 超时时间（秒）
     * @param callbackId 回调 ID，用于匹配 window._onLocalCommandResult(id, result)
     * @param webView   WebView 实例
     * @param activity  Activity（用于 runOnUiThread）
     */
    public void executeAsync(String command, int timeoutSec, String callbackId,
                             android.webkit.WebView webView, android.app.Activity activity) {
        new Thread(() -> {
            final String result = execute(command, timeoutSec);
            activity.runOnUiThread(() -> {
                String js = "window._onLocalCommandResult && window._onLocalCommandResult('"
                        + callbackId + "', " + result + ");";
                webView.evaluateJavascript(js, null);
            });
        }).start();
    }

    /**
     * 取消当前正在执行的命令
     */
    public void cancel() {
        cancelled = true;
        Process p = currentProcess;
        if (p != null && p.isAlive()) {
            p.destroyForcibly();
        }
    }

    // ==================== BusyBox 集成 ====================

    /**
     * 从 APK 的 native libs 目录加载 BusyBox 并安装符号链接
     * Android 10+ 禁止在 app 数据目录执行二进制（W^X 策略），
     * 但允许执行 /data/app/.../lib/ 目录下的文件（打包为 .so）。
     */
    private void initBusybox() {
        if (busyboxReady) return;

        // BusyBox 在 APK 中以 libbusybox.so 打包，安装后位于 nativeLibraryDir
        String nativeLibDir = context.getApplicationInfo().nativeLibraryDir;
        File busybox = new File(nativeLibDir, "libbusybox.so");

        Log.i(TAG, "查找 BusyBox: " + busybox.getAbsolutePath());

        if (!busybox.exists()) {
            Log.w(TAG, "libbusybox.so 不存在于 nativeLibraryDir，跳过 BusyBox");
            return;
        }

        // 验证二进制可执行
        if (!verifyBusybox(busybox)) {
            Log.w(TAG, "BusyBox 验证失败");
            return;
        }
        Log.i(TAG, "BusyBox 验证通过");

        // 安装符号链接到 binDir
        // 符号链接指向 nativeLibDir/libbusybox.so，该目录是只读可执行的
        ensureSymlinks(busybox);

        busyboxReady = true;
        Log.i(TAG, "BusyBox 安装完成: " + binDir.getAbsolutePath());
    }

    /**
     * 确保文件有 755 可执行权限
     */
    private void ensureExecutable(File file) {
        file.setExecutable(true, false);
        try {
            new ProcessBuilder("/system/bin/sh", "-c", "chmod 755 " + file.getAbsolutePath())
                    .start().waitFor();
        } catch (Exception ignored) {}
    }

    /**
     * 安装符号链接
     * BusyBox 通过 argv[0] 判断 applet，所以需要先创建一个名为 busybox 的符号链接，
     * 然后用该链接执行 --install -s 安装所有 applet 的符号链接。
     */
    private void ensureSymlinks(File busybox) {
        String busyboxPath = busybox.getAbsolutePath();

        // 检查已有的 busybox 符号链接是否指向正确路径
        // APK 重装后 /data/app 路径会变，旧符号链接会失效
        File busyboxLink = new File(binDir, "busybox");
        boolean needsRebuild = true;

        if (busyboxLink.exists()) {
            try {
                String target = readAllString(
                        new ProcessBuilder("/system/bin/sh", "-c",
                                "readlink \"" + busyboxLink.getAbsolutePath() + "\""
                        ).redirectErrorStream(true).start().getInputStream());
                if (target.trim().equals(busyboxPath)) {
                    needsRebuild = false;
                } else {
                    Log.i(TAG, "BusyBox 路径已变化，重建符号链接: " + target.trim() + " -> " + busyboxPath);
                }
            } catch (Exception ignored) {}
        }

        if (!needsRebuild) {
            // 验证其他符号链接也能工作
            File testLink = new File(binDir, "wget");
            if (testLink.exists()) return;  // 一切正常
            needsRebuild = true;
        }

        if (needsRebuild) {
            // 清理整个 binDir 重建
            File[] files = binDir.listFiles();
            if (files != null) {
                for (File f : files) f.delete();
            }
        }

        try {
            // 第一步：创建 busybox → libbusybox.so 的符号链接
            // 这样 argv[0] 就是 "busybox"，BusyBox 才能正确识别 applet
            // 先清理可能存在的旧链接
            if (busyboxLink.exists()) busyboxLink.delete();

            // 用 ln -s 创建符号链接
            Process p1 = new ProcessBuilder("/system/bin/sh", "-c",
                    "ln -s \"" + busyboxPath + "\" \"" + busyboxLink.getAbsolutePath() + "\""
            ).redirectErrorStream(true).start();
            String err1 = readAllString(p1.getInputStream());
            int code1 = p1.waitFor();
            if (code1 != 0) {
                Log.w(TAG, "创建 busybox 符号链接失败: " + err1);
                return;
            }

            // 第二步：用 busybox 链接执行 --install -s
            Process p2 = new ProcessBuilder("/system/bin/sh", "-c",
                    busyboxLink.getAbsolutePath() + " --install -s " + binDir.getAbsolutePath()
            ).redirectErrorStream(true).start();
            String err2 = readAllString(p2.getInputStream());
            int code2 = p2.waitFor();
            if (code2 != 0) {
                Log.w(TAG, "BusyBox --install 退出码: " + code2 + ", output: " + err2);
            }
        } catch (Exception e) {
            Log.w(TAG, "安装符号链接失败: " + e.getMessage());
        }
    }

    /**
     * 验证 BusyBox 二进制可用
     * 注意：libbusybox.so 的 argv[0] 是 "libbusybox.so"，BusyBox 不认识，
     * 所以用 exec -a busybox 伪造 argv[0] 来验证。
     */
    private boolean verifyBusybox(File busybox) {
        try {
            Process p = new ProcessBuilder("/system/bin/sh", "-c",
                    "exec -a busybox \"" + busybox.getAbsolutePath() + "\" --help"
            ).redirectErrorStream(true).start();
            String out = readAllString(p.getInputStream());
            p.waitFor();
            return out.contains("BusyBox") || out.contains("multi-call");
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 检查 BusyBox 是否就绪
     */
    public boolean isBusyboxReady() {
        return busyboxReady;
    }

    /**
     * 同步安装 BusyBox（供 AndroidBridge 直接调用）
     * @return JSON 结果
     */
    public String installBusyboxSync() {
        if (busyboxReady) {
            return "{\"success\":true,\"alreadyInstalled\":true}";
        }
        initBusybox();
        if (busyboxReady) {
            return "{\"success\":true}";
        }
        return "{\"success\":false,\"error\":\"BusyBox 安装失败，请查看日志\"}";
    }

    /**
     * 强制重新安装 BusyBox（重装符号链接）
     */
    public void reinstallBusybox() {
        busyboxReady = false;
        // 清理旧的符号链接
        File[] files = binDir.listFiles();
        if (files != null) {
            for (File f : files) f.delete();
        }
        new Thread(this::initBusybox).start();
    }

    /**
     * 读取 InputStream 全部内容为字符串
     */
    private String readAllString(InputStream is) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int len;
        while ((len = is.read(buf)) > 0) baos.write(buf, 0, len);
        return baos.toString();
    }

    /**
     * 设置环境变量
     */
    private void setupEnvironment(ProcessBuilder pb) {
        java.util.Map<String, String> env = pb.environment();
        env.put("HOME", homeDir.getAbsolutePath());
        env.put("TMPDIR", tmpDir.getAbsolutePath());
        env.put("TERM", "xterm-256color");
        env.put("LANG", "zh_CN.UTF-8");
        env.put("LC_ALL", "zh_CN.UTF-8");

        // PATH：BusyBox 目录优先，然后系统命令
        String basePath = binDir.getAbsolutePath() + ":/system/bin:/system/xbin:/vendor/bin";
        env.put("PATH", basePath);

        // 外部存储路径（方便操作文件）
        String extStorage = Environment.getExternalStorageDirectory().getAbsolutePath();
        env.put("EXTERNAL_STORAGE", extStorage);
        env.put("SDCARD", extStorage);
        env.put("DOWNLOADS", Environment
                .getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                .getAbsolutePath());
    }

    /**
     * 危险命令拦截（系统级最后防线）
     * JS 层已有三级检查（forbidden/confirm/safe），这里保留系统级硬拦截作为兜底，
     * 防止绕过 JS 层直接调用 AndroidBridge 的情况。
     *
     * @return 拦截原因，null 表示放行
     */
    private String checkDangerousCommand(String cmd) {
        if (cmd == null || cmd.trim().isEmpty()) return "空命令";
        String lower = cmd.toLowerCase().trim();

        String[] dangerous = {
            "rm -rf /system",
            "rm -rf /data",
            "rm -rf /*",
            "rm -rf /sdcard",
            "mkfs",
            "dd if=/dev/zero",
            "dd if=/dev/null",
            "shutdown",
            "reboot -p",
            "flash_image",
            "/system/bin/rm -rf /",
            "format system"
        };
        for (String d : dangerous) {
            if (lower.contains(d)) return "禁止执行: " + d;
        }
        return null;
    }

    /**
     * 获取 HOME 目录路径（供 JS 查询）
     */
    public String getHomePath() {
        return homeDir.getAbsolutePath();
    }

    /**
     * 获取可用命令列表（首次使用时探测一次，结果缓存到文件）
     */
    public String listAvailableCommands() {
        // 缓存文件
        File cacheFile = new File(tmpDir, ".commands_cache");
        if (cacheFile.exists()) {
            try {
                BufferedReader br = new BufferedReader(new FileReader(cacheFile));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line).append("\n");
                br.close();
                if (sb.length() > 10) return sb.toString().trim();
            } catch (Exception ignored) {}
        }

        // 探测常见命令
        String[] candidates = {
            "ls", "cd", "cat", "cp", "mv", "rm", "mkdir", "rmdir", "touch",
            "find", "grep", "egrep", "fgrep", "sed", "awk", "sort", "uniq", "wc",
            "head", "tail", "cut", "tr", "tee", "diff", "cmp", "comm",
            "chmod", "chown", "chgrp", "ln", "readlink", "realpath", "stat",
            "echo", "printf", "date", "cal", "uptime", "clear",
            "df", "du", "free", "top", "ps", "kill", "killall",
            "uname", "hostname", "whoami", "id", "env", "printenv", "set",
            "tar", "gzip", "gunzip", "zcat", "bzip2", "xz",
            "zip", "unzip",
            "curl", "wget", "ping", "netstat", "ss", "ifconfig", "ip",
            "md5sum", "sha1sum", "sha256sum", "base64", "xxd", "od",
            "sleep", "timeout", "time", "watch", "xargs", "seq",
            "test", "expr", "true", "false", "yes", "nohup",
            "which", "whereis", "type", "command",
            "basename", "dirname", "pwd", "tty",
            "paste", "expand", "unexpand", "fold", "fmt", "pr", "column",
            "nl", "tac", "rev", "shuf", "split", "csplit", "truncate",
            "install", "strip", "objdump", "objcopy", "readelf", "nm", "strings",
            "getprop", "setprop", "getenforce", "setenforce",
            "monkey", "am", "pm", "settings", "wm", "dumpsys", "logcat",
            "toybox", "busybox",
            "gzip", "bzip2", "lz4", "lzop",
            "nslookup", "dig", "host", "traceroute", "ftpget", "ftpput",
            "telnet", "nc", "ssh", "scp", "rsync",
            "vi", "nano", "less", "more",
            "git", "python", "python3", "node", "pip", "npm"
        };

        StringBuilder sb = new StringBuilder();
        for (String cmd : candidates) {
            String path = which(cmd);
            if (path != null) {
                sb.append(cmd).append("\t").append(path).append("\n");
            }
        }

        // 写入缓存
        try {
            FileWriter fw = new FileWriter(cacheFile);
            fw.write(sb.toString());
            fw.close();
        } catch (Exception ignored) {}

        return sb.toString().trim();
    }

    /**
     * 查找命令的完整路径
     */
    private String which(String cmd) {
        String[] dirs = {"/system/bin", "/system/xbin", "/vendor/bin"};
        for (String dir : dirs) {
            File f = new File(dir, cmd);
            if (f.exists() && f.canExecute()) {
                return f.getAbsolutePath();
            }
        }
        return null;
    }

    /**
     * 清理命令缓存（用户可调用以强制重新探测）
     */
    public void clearCache() {
        File cacheFile = new File(tmpDir, ".commands_cache");
        if (cacheFile.exists()) cacheFile.delete();
    }

    /**
     * JSON 字符串转义
     */
    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}