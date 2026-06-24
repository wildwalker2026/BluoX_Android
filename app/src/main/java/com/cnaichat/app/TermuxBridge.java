package com.cnaichat.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Termux 桥接器 —— 封装与 Termux 的所有交互
 *
 * 功能：
 * 1. 检查 Termux 是否安装
 * 2. 在 Termux 中执行命令（前台/后台）
 * 3. 异步执行命令并通过 WebView 回调返回结果
 * 4. 管理多个并发命令的回调
 *
 * 前提条件（用户需手动完成）：
 * - Termux 已安装
 * - Termux 中 ~/.termux/termux.properties 设置了 allow-external-apps=true
 * - 在系统设置中授予了本应用的 RUN_COMMAND 权限
 */
public class TermuxBridge {
    private static final String TAG = "TermuxBridge";

    // 权限请求码
    private static final int REQUEST_CODE_RUN_COMMAND = 10086;

    // Termux 常量
    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService";
    private static final String ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND";

    // Intent Extra Keys
    private static final String EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH";
    private static final String EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS";
    private static final String EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR";
    private static final String EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND";
    private static final String EXTRA_SESSION_ACTION = "com.termux.RUN_COMMAND_SESSION_ACTION";
    private static final String EXTRA_STDIN = "com.termux.RUN_COMMAND_STDIN";
    private static final String EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT";
    private static final String EXTRA_COMMAND_LABEL = "com.termux.RUN_COMMAND_COMMAND_LABEL";
    private static final String EXTRA_COMMAND_DESCRIPTION = "com.termux.RUN_COMMAND_COMMAND_DESCRIPTION";

    // Termux 路径常量
    private static final String TERMUX_PREFIX = "/data/data/com.termux/files/usr";
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";

    // ─── 回调管理 ───
    private static final Map<String, ResultCallback> callbacks = new ConcurrentHashMap<>();
    // 已取消的异步命令 callbackId 集合
    private static final ConcurrentHashMap<String, Boolean> cancelledCallbacks = new ConcurrentHashMap<>();

    private final Context context;
    private final AtomicInteger requestCodeCounter = new AtomicInteger(1000);

    public interface ResultCallback {
        void onResult(int exitCode, String stdout, String stderr);
    }

    public TermuxBridge(Context context) {
        this.context = context;
    }

    // ═══════════════════════════════════════════════════════════
    //  公开 API
    // ═══════════════════════════════════════════════════════════

    /**
     * 检查 Termux 是否已安装
     */
    public boolean isTermuxInstalled() {
        try {
            PackageManager pm = context.getPackageManager();
            pm.getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /**
     * 检查是否已获得 RUN_COMMAND 权限
     */
    public boolean hasRunCommandPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return context.checkSelfPermission("com.termux.permission.RUN_COMMAND")
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    /**
     * 尝试请求 RUN_COMMAND 权限（在 Activity 的 onRequestPermissionsResult 回调中处理结果）
     * @param activity Activity 实例
     * @return true = 已有权限或已发起请求
     */
    public boolean requestRunCommandPermission(Activity activity) {
        if (hasRunCommandPermission()) {
            return true;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                activity.requestPermissions(
                        new String[]{"com.termux.permission.RUN_COMMAND"},
                        REQUEST_CODE_RUN_COMMAND
                );
                Log.i(TAG, "已发起 RUN_COMMAND 权限请求");
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "请求权限失败: " + e.getMessage());
        }
        return false;
    }

    /**
     * 同步等待权限授予（用循环轮询，因为 requestPermissions 是异步的）
     * 在子线程中调用，轮询检查权限状态，最多等待 timeoutMs 毫秒。
     * 同时在 UI 线程自动发起 requestPermissions 弹窗。
     *
     * @param activity   Activity
     * @param timeoutMs  最大等待时间（毫秒）
     * @return true = 权限已获得
     */
    public boolean ensureRunCommandPermissionSync(Activity activity, long timeoutMs) {
        if (hasRunCommandPermission()) {
            return true;
        }

        // 在 UI 线程发起权限请求（弹窗）
        new Handler(Looper.getMainLooper()).post(() -> {
            requestRunCommandPermission(activity);
        });

        // 子线程轮询等待权限授予
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
            if (hasRunCommandPermission()) {
                Log.i(TAG, "RUN_COMMAND 权限已获得");
                return true;
            }
        }

        Log.w(TAG, "等待 RUN_COMMAND 权限超时");
        return hasRunCommandPermission();
    }

    /**
     * 打开 Termux 的应用详情页（方便用户手动授权）
     */
    public void openTermuxAppSettings() {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", TERMUX_PACKAGE, null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "打开设置失败: " + e.getMessage());
        }
    }

    /**
     * 获取 Termux 安装信息
     * @return JSON 字符串
     */
    public String getStatusJson() {
        try {
            JSONObject json = new JSONObject();
            json.put("installed", isTermuxInstalled());

            if (isTermuxInstalled()) {
                PackageManager pm = context.getPackageManager();
                String version = pm.getPackageInfo(TERMUX_PACKAGE, 0).versionName;
                json.put("version", version != null ? version : "unknown");

                // 检查权限
                json.put("hasPermission", hasRunCommandPermission());

                // 检查 allow-external-apps 配置
                java.io.File propFile = new java.io.File(TERMUX_HOME + "/.termux/termux.properties");
                if (propFile.exists()) {
                    try {
                        java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(propFile));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) sb.append(line).append("\n");
                        reader.close();
                        json.put("allowExternalApps", sb.toString().contains("allow-external-apps=true"));
                    } catch (Exception e) {
                        json.put("allowExternalApps", "unknown");
                    }
                } else {
                    json.put("allowExternalApps", false);
                    json.put("hint", "请在 Termux 中执行: mkdir -p ~/.termux && echo 'allow-external-apps=true' > ~/.termux/termux.properties");
                }
            }

            return json.toString();
        } catch (Exception e) {
            return "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  同步执行（阻塞等待结果）
    // ═══════════════════════════════════════════════════════════

    /**
     * 在 Termux 中执行命令（同步，阻塞等待结果）
     *
     * @param command     要执行的 shell 命令
     * @param workDir     工作目录（null 则用 Termux Home）
     * @param timeoutSec  超时时间（秒）
     * @return JSON: {exitCode, stdout, stderr} 或 {error}
     */
    public String executeSync(String command, String workDir, int timeoutSec) {
        if (!isTermuxInstalled()) {
            return "{\"error\":\"Termux 未安装\"}";
        }
        if (!hasRunCommandPermission()) {
            Activity act = (Activity) context;
            boolean granted = ensureRunCommandPermissionSync(act, 30000);
            if (!granted) {
                return "{\"error\":\"RUN_COMMAND 权限被拒绝。\"}";
            }
        }
        return executeViaFile(command, workDir, timeoutSec);
    }

    /**
     * 在 Termux 中执行命令（简化版，使用 Termux Home 作为工作目录）
     */
    public String executeSync(String command) {
        return executeSync(command, null, 30);
    }

    // ═══════════════════════════════════════════════════════════
    //  异步执行（通过 WebView 回调）
    // ═══════════════════════════════════════════════════════════

    /**
     * 在 Termux 中异步执行命令，结果通过 WebView JS 回调返回
     *
     * 改进点（v3）：
     * - 统一使用 am startservice + 文件轮询方案（与 executeSync 一致，已验证可行）
     * - 命令在子线程执行，不阻塞主线程
     * - 超时自动回调并清理临时文件
     *
     * @param command     要执行的 shell 命令
     * @param workDir     工作目录（null 用 Termux Home）
     * @param callbackId  JS 回调 ID
     * @param webView     WebView 实例
     * @param activity    Activity（用于 UI 线程）
     * @param background  是否后台执行（保留参数兼容，内部统一走文件方案）
     */
    public void executeAsync(String command, String workDir, String callbackId,
                             WebView webView, Activity activity, boolean background) {
        executeAsync(command, workDir, callbackId, webView, activity, background, 120);
    }

    /**
     * 带超时的异步执行
     * @param timeoutSecs 超时时间（秒）
     */
    public void executeAsync(String command, String workDir, String callbackId,
                             WebView webView, Activity activity, boolean background,
                             int timeoutSecs) {
        if (!isTermuxInstalled()) {
            callbackJs(webView, activity, callbackId,
                    "{\"error\":\"Termux 未安装\"}");
            return;
        }
        // 自动请求权限
        if (!hasRunCommandPermission()) {
            new Thread(() -> {
                boolean granted = ensureRunCommandPermissionSync(activity, 30000);
                if (!granted) {
                    callbackJs(webView, activity, callbackId,
                            "{\"error\":\"RUN_COMMAND 权限被拒绝。请到：设置 → 应用 → 小蓝AI盒子 → 权限中手动开启。\"}");
                    return;
                }
                executeAsyncInternal(command, workDir, callbackId, webView, activity, timeoutSecs);
            }).start();
            return;
        }
        executeAsyncInternal(command, workDir, callbackId, webView, activity, timeoutSecs);
    }

    /**
     * 异步执行内部实现 —— am startservice + 文件轮询（子线程）
     * 改进：轮询过程中定期推送实时输出到前端
     */
    private void executeAsyncInternal(String command, String workDir, String callbackId,
                             WebView webView, Activity activity, int timeoutSecs) {

        final boolean[] callbackCalled = {false};

        // 确保此 callbackId 不在已取消列表中
        cancelledCallbacks.remove(callbackId);

        // 超时保护
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!callbackCalled[0]) {
                callbackCalled[0] = true;
                Log.w(TAG, "异步命令超时: " + callbackId + " (" + timeoutSecs + "s)");
                callbackJs(webView, activity, callbackId,
                        "{\"error\":\"命令执行超时（" + timeoutSecs + "秒）\"}");
            }
        }, timeoutSecs * 1000L);

        // 在子线程中执行，轮询过程中推送实时输出
        new Thread(() -> {
            String result = executeViaFile(command, workDir, timeoutSecs,
                    (partialOutput) -> {
                        // 实时推送到前端
                        if (!callbackCalled[0]) {
                            callbackProgressJs(webView, activity, callbackId, partialOutput);
                        }
                    }, callbackId);
            if (!callbackCalled[0]) {
                callbackCalled[0] = true;
                callbackJs(webView, activity, callbackId, result);
            }
        }, "TermuxAsync-" + callbackId).start();
    }

    /**
     * 取消正在执行的异步命令（由 JS 层调用）
     * @param callbackId 要取消的命令的 callbackId
     */
    public void cancelAsyncCommand(String callbackId) {
        if (callbackId != null) {
            cancelledCallbacks.put(callbackId, true);
            Log.i(TAG, "取消 Termux 异步命令: " + callbackId);
        }
    }

    /**
     * 取消所有正在执行的异步命令
     */
    public void cancelAllAsyncCommands() {
        Log.i(TAG, "取消所有 Termux 异步命令, 共 " + callbacks.size() + " 个");
        for (String id : callbacks.keySet()) {
            cancelledCallbacks.put(id, true);
        }
    }

    /**
     * 进度回调接口
     */
    public interface ProgressCallback {
        void onProgress(String partialOutput);
    }

    /**
     * 在 Termux 前台执行命令（打开 Termux 界面，用户可见）
     */
    public String executeForeground(String command, String workDir) {
        if (!isTermuxInstalled()) {
            return "{\"error\":\"Termux 未安装\"}";
        }
        if (!hasRunCommandPermission()) {
            Activity act = (Activity) context;
            boolean granted = ensureRunCommandPermissionSync(act, 30000);
            if (!granted) {
                return "{\"error\":\"RUN_COMMAND 权限被拒绝。请到：设置 → 应用 → 小蓝AI盒子 → 权限中手动开启。\"}";
            }
        }

        boolean sent = sendCommand(command, workDir, null, false, null);
        return sent
                ? "{\"success\":true,\"message\":\"命令已发送到 Termux 前台\"}"
                : "{\"error\":\"发送命令失败\"}";
    }

    // ═══════════════════════════════════════════════════════════
    //  内部实现
    // ═══════════════════════════════════════════════════════════

    /**
     * 核心执行方法 —— am startservice + 文件轮询（无进度回调）
     */
    private String executeViaFile(String command, String workDir, int timeoutSec) {
        return executeViaFile(command, workDir, timeoutSec, null);
    }

    /**
     * 核心执行方法 —— am startservice + 文件轮询（带进度回调）
     *
     * 统一执行路径：executeSync 和 executeAsync 都调用此方法。
     *
     * 步骤：
     * 1. 将命令写入临时脚本文件（避免特殊字符问题）
     * 2. 通过 am startservice 发送到 Termux RunCommandService
     * 3. 轮询输出文件直到写入完成（有 progressCallback 时定期推送）
     * 4. 解析 stdout 和 exitCode
     * 5. 清理临时文件
     *
     * @param command          shell 命令
     * @param workDir          工作目录（null 用 Termux Home）
     * @param timeoutSec       超时秒数
     * @param progressCallback 进度回调（null 表示不需要进度）
     * @return JSON 结果字符串
     */
    private String executeViaFile(String command, String workDir, int timeoutSec,
                                  ProgressCallback progressCallback) {
        return executeViaFile(command, workDir, timeoutSec, progressCallback, null);
    }

    /**
     * 核心执行方法 —— am startservice + 文件轮询（带进度回调 + 取消支持）
     *
     * @param command          shell 命令
     * @param workDir          工作目录（null 用 Termux Home）
     * @param timeoutSec       超时秒数
     * @param progressCallback 进度回调（null 表示不需要进度）
     * @param callbackId       异步回调ID（用于取消检测，null 表示同步调用）
     * @return JSON 结果字符串
     */
    private String executeViaFile(String command, String workDir, int timeoutSec,
                                  ProgressCallback progressCallback, String callbackId) {
        long ts = System.currentTimeMillis();
        String outputFile = "/sdcard/.termux_out_" + ts + ".txt";
        String scriptFile = "/sdcard/.termux_cmd_" + ts + ".sh";
        String actualWorkDir = workDir != null ? workDir : TERMUX_HOME;

        // 包装命令：输出重定向到文件 + 追加退出码
        String wrappedCommand = "{ " + command + " ; } > " + outputFile + " 2>&1 ; echo EXITCODE:$? >> " + outputFile;

        Log.d(TAG, "executeViaFile: " + command.substring(0, Math.min(command.length(), 60))
                + " -> " + outputFile);

        // 删除旧文件
        new File(outputFile).delete();

        // 写脚本文件
        try {
            FileWriter fw = new FileWriter(scriptFile);
            fw.write(wrappedCommand);
            fw.close();
        } catch (Exception e) {
            return buildErrorJson("写入脚本失败: " + e.getMessage());
        }

        // 用 am startservice 发送
        String amCmd = "am startservice --user 0" +
                " -n " + TERMUX_PACKAGE + "/" + TERMUX_RUN_COMMAND_SERVICE +
                " -a " + ACTION_RUN_COMMAND +
                " --es " + EXTRA_COMMAND_PATH + " " + TERMUX_PREFIX + "/bin/bash" +
                " --esa " + EXTRA_ARGUMENTS + " " + scriptFile +
                " --es " + EXTRA_WORKDIR + " " + actualWorkDir +
                " --ez " + EXTRA_BACKGROUND + " true";

        Log.d(TAG, "am cmd: " + amCmd);

        try {
            ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-c", amCmd);
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            java.io.InputStream is = proc.getInputStream();
            byte[] buf = new byte[1024];
            int len = is.read(buf);
            String amOutput = len > 0 ? new String(buf, 0, len) : "";
            proc.waitFor(5, java.util.concurrent.TimeUnit.SECONDS);
            Log.d(TAG, "am output: " + amOutput.trim());
        } catch (Exception e) {
            Log.e(TAG, "am startservice 失败: " + e.getMessage());
            new File(scriptFile).delete();
            return buildErrorJson("发送命令失败: " + e.getMessage());
        }

        // 轮询等待输出文件 —— 通过 EXITCODE: 标记检测完成（不依赖文件大小稳定性）
        long deadline = System.currentTimeMillis() + timeoutSec * 1000L;
        File outFile = new File(outputFile);
        long lastProgressTime = 0;
        boolean done = false;

        while (System.currentTimeMillis() < deadline) {
            // 检查是否被用户取消
            if (callbackId != null && cancelledCallbacks.containsKey(callbackId)) {
                cancelledCallbacks.remove(callbackId);
                new File(scriptFile).delete();
                outFile.delete();
                Log.i(TAG, "命令被用户取消: " + callbackId);
                return "{\"cancelled\":true}";
            }

            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                new File(scriptFile).delete();
                outFile.delete();
                return buildErrorJson("命令执行被中断");
            }

            if (!outFile.exists() || outFile.length() == 0) {
                continue;
            }

            // 读取当前内容，检查是否包含 EXITCODE: 标记（不删除文件）
            String currentContent = readOutputFile(outputFile, false);
            if (currentContent == null) {
                continue;
            }

            // 检测 EXITCODE: 标记 —— 命令执行完成的可靠信号
            if (currentContent.contains("EXITCODE:")) {
                done = true;
                break;
            }

            // 推送实时进度（每 500ms 推送一次）
            if (progressCallback != null) {
                long now = System.currentTimeMillis();
                if (now - lastProgressTime > 500) {
                    lastProgressTime = now;
                    String partial = currentContent.trim();
                    if (!partial.isEmpty()) {
                        final String p = partial;
                        progressCallback.onProgress(p);
                    }
                }
            }
        }

        // 读取结果
        String output = readOutputFile(outputFile);
        outFile.delete();
        new File(scriptFile).delete();

        if (output == null) {
            return buildErrorJson("命令执行超时（" + timeoutSec + "秒）");
        }

        // 解析退出码
        int exitCode = -1;
        String stdout = output;
        int ecIdx = output.lastIndexOf("EXITCODE:");
        if (ecIdx >= 0) {
            String ecStr = output.substring(ecIdx + 9).trim();
            try {
                exitCode = Integer.parseInt(ecStr);
            } catch (NumberFormatException e) {
                // ignore
            }
            stdout = output.substring(0, ecIdx).trim();
        }

        Log.d(TAG, "executeViaFile 完成: exitCode=" + exitCode + ", stdout.len=" + stdout.length());
        return buildResultJson(exitCode, stdout, "");
    }

    /**
     * 前台执行命令（打开 Termux 界面）
     * 仍使用 Intent 方式（需要弹出 Termux 界面）
     */
    private boolean sendCommand(String command, String workDir, String callbackId,
                                boolean background, String stdin) {
        try {
            Intent intent = new Intent(ACTION_RUN_COMMAND);
            intent.setClassName(TERMUX_PACKAGE, TERMUX_RUN_COMMAND_SERVICE);
            intent.setAction(ACTION_RUN_COMMAND);

            Log.d(TAG, "Intent Action=" + intent.getAction() + ", Component=" + intent.getComponent());

            intent.putExtra(EXTRA_COMMAND_PATH, TERMUX_PREFIX + "/bin/bash");
            intent.putExtra(EXTRA_ARGUMENTS, new String[]{"-c", command});
            intent.putExtra(EXTRA_WORKDIR, workDir != null ? workDir : TERMUX_HOME);
            intent.putExtra(EXTRA_BACKGROUND, background);

            if (!background) {
                intent.putExtra(EXTRA_SESSION_ACTION, "0");
            }

            intent.putExtra(EXTRA_COMMAND_LABEL,
                    command.length() > 50 ? command.substring(0, 50) : command);
            intent.putExtra(EXTRA_COMMAND_DESCRIPTION, "CNAI App 执行的命令");

            if (stdin != null && !stdin.isEmpty()) {
                intent.putExtra(EXTRA_STDIN, stdin);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }

            Log.i(TAG, "命令已发送到 Termux (Intent): " + command.substring(0, Math.min(command.length(), 80)));
            return true;

        } catch (Exception e) {
            Log.e(TAG, "发送命令失败: " + e.getMessage(), e);
            return false;
        }
    }

    /**
     * 从临时文件读取命令输出并删除文件
     */
    private static String readOutputFile(String filePath) {
        return readOutputFile(filePath, true);
    }

    /**
     * 从临时文件读取命令输出
     * @param filePath 文件路径
     * @param deleteAfter 是否读取后删除文件
     */
    private static String readOutputFile(String filePath, boolean deleteAfter) {
        if (filePath == null || filePath.isEmpty()) return null;
        try {
            File f = new File(filePath);
            if (!f.exists() || !f.canRead()) return null;
            BufferedReader reader = new BufferedReader(new FileReader(f));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                if (sb.length() > 0) sb.append("\n");
                sb.append(line);
            }
            reader.close();
            if (deleteAfter) f.delete();
            return sb.toString();
        } catch (Exception e) {
            Log.w(TAG, "读取输出文件失败: " + e.getMessage());
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  回调管理
    // ═══════════════════════════════════════════════════════════

    private void registerCallback(String id, ResultCallback callback) {
        callbacks.put(id, callback);
    }

    private void unregisterCallback(String id) {
        callbacks.remove(id);
    }

    /**
     * 由 TermuxResultReceiver 调用，通知命令执行结果
     */
    static void notifyResult(String callbackId, int exitCode, String stdout, String stderr) {
        Log.d(TAG, "notifyResult: callbackId=" + callbackId + ", exitCode=" + exitCode);

        // 如果没有指定 callbackId，尝试用唯一的一个（同步等待场景）
        if (callbackId == null) {
            if (callbacks.size() == 1) {
                callbackId = callbacks.keySet().iterator().next();
            } else if (callbacks.isEmpty()) {
                Log.w(TAG, "没有注册的回调");
                return;
            } else {
                for (Map.Entry<String, ResultCallback> entry : callbacks.entrySet()) {
                    entry.getValue().onResult(exitCode, stdout, stderr);
                    callbacks.remove(entry.getKey());
                }
                return;
            }
        }

        ResultCallback callback = callbacks.remove(callbackId);
        if (callback != null) {
            callback.onResult(exitCode, stdout, stderr);
        } else {
            // 回调已超时被移除，尝试通知所有
            for (Map.Entry<String, ResultCallback> entry : callbacks.entrySet()) {
                entry.getValue().onResult(exitCode, stdout, stderr);
                callbacks.remove(entry.getKey());
                break;
            }
        }
    }

    // ═══════════════════════════ Termux Properties 配置辅助 ═══════════════════════════

    /**
     * 自动设置 Termux 的 allow-external-apps 配置
     * 通过 Termux 自身的 shell 执行来完成（需要用户先配置一次）
     *
     * 注意：这个方法只能"尝试"，因为首次调用本身就需要 allow-external-apps=true
     * 所以实际上应该引导用户在 Termux 中手动设置
     */
    public String setupTermuxProperties() {
        return "请在 Termux 中执行以下命令来启用外部应用调用：\n\n" +
                "mkdir -p ~/.termux\n" +
                "echo 'allow-external-apps=true' >> ~/.termux/termux.properties\n" +
                "termux-reload-settings\n\n" +
                "然后到系统设置中给本应用授予 RUN_COMMAND 权限：\n" +
                "设置 → 应用 → 小蓝AI盒子 → 权限 → 附加权限 → 允许在 Termux 中运行命令";
    }

    // ═══════════════════════════ 工具方法 ═══════════════════════════

    private void callbackJs(WebView webView, Activity activity, String callbackId, String json) {
        if (webView == null || activity == null) return;
        activity.runOnUiThread(() -> {
            String js = "window._onTermuxResult && window._onTermuxResult('"
                    + callbackId + "', " + json + ");";
            webView.evaluateJavascript(js, null);
        });
    }

    /**
     * 推送实时进度到前端
     * 调用 window._onTermuxProgress(callbackId, partialOutput)
     */
    private void callbackProgressJs(WebView webView, Activity activity, String callbackId, String partialOutput) {
        if (webView == null || activity == null) return;
        activity.runOnUiThread(() -> {
            // 用双引号 JSON 格式，避免输出内容中的单引号打断 JS
            String safeOutput = escapeJson(partialOutput != null ? partialOutput : "");
            String js = "window._onTermuxProgress && window._onTermuxProgress('"
                    + callbackId + "', \"" + safeOutput + "\");";
            webView.evaluateJavascript(js, null);
        });
    }

    private String buildResultJson(int exitCode, String stdout, String stderr) {
        return "{\"exitCode\":" + exitCode +
                ",\"stdout\":\"" + escapeJson(stdout != null ? stdout : "") + "\"" +
                ",\"stderr\":\"" + escapeJson(stderr != null ? stderr : "") + "\"}";
    }

    private String buildErrorJson(String message) {
        return "{\"error\":\"" + escapeJson(message) + "\"}";
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}