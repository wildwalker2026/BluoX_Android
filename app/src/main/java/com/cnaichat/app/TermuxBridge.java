package com.cnaichat.app;

import android.app.Activity;
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
import java.util.concurrent.ConcurrentHashMap;

/**
 * Termux 桥接器
 *
 * 通过 am startservice 向 Termux RunCommandService 发送命令，
 * 通过文件轮询获取执行结果。
 *
 * 官方文档: https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent
 *
 * 说明：官方支持两种发送方式：
 * 1. am startservice（shell）— 无法原生获取结果，用文件轮询补足
 * 2. Java Intent — 可原生获取结果（EXTRA_RESULT_DIRECTORY / EXTRA_PENDING_INTENT），
 *    但在部分 ROM（如 ColorOS）上 startForegroundService 被静默拦截，不可用
 *
 * 前提条件（用户需手动完成）：
 * - Termux 已安装
 * - ~/.termux/termux.properties 设置了 allow-external-apps=true
 * - 系统设置中授予了本应用的 RUN_COMMAND 权限
 */
public class TermuxBridge {
    private static final String TAG = "TermuxBridge";

    private static final int REQUEST_CODE_RUN_COMMAND = 10086;

    // Termux 常量（与官方 TermuxConstants 一致）
    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService";
    private static final String ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND";

    // Intent Extra Keys
    private static final String EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH";
    private static final String EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS";
    private static final String EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR";
    private static final String EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND";

    // Termux 路径常量
    private static final String TERMUX_PREFIX = "/data/data/com.termux/files/usr";
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";

    // 已取消的异步命令 callbackId 集合
    private static final ConcurrentHashMap<String, Boolean> cancelledCallbacks = new ConcurrentHashMap<>();

    // 活跃的异步命令 callbackId 集合
    private static final ConcurrentHashMap<String, Boolean> activeCallbacks = new ConcurrentHashMap<>();

    private final Context context;

    public TermuxBridge(Context context) {
        this.context = context;
    }

    // ═══════════════════════════════════════════════════════════
    //  状态检查 & 权限
    // ═══════════════════════════════════════════════════════════

    public boolean isTermuxInstalled() {
        try {
            context.getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    public boolean hasRunCommandPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return context.checkSelfPermission("com.termux.permission.RUN_COMMAND")
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    public boolean requestRunCommandPermission(Activity activity) {
        if (hasRunCommandPermission()) return true;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                activity.requestPermissions(
                        new String[]{"com.termux.permission.RUN_COMMAND"},
                        REQUEST_CODE_RUN_COMMAND);
                Log.i(TAG, "已发起 RUN_COMMAND 权限请求");
                return true;
            }
        } catch (Exception e) {
            Log.e(TAG, "请求权限失败: " + e.getMessage());
        }
        return false;
    }

    public boolean ensureRunCommandPermissionSync(Activity activity, long timeoutMs) {
        if (hasRunCommandPermission()) return true;

        new Handler(Looper.getMainLooper()).post(() -> requestRunCommandPermission(activity));

        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
            if (hasRunCommandPermission()) return true;
        }
        return hasRunCommandPermission();
    }

    public void openTermuxAppSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", TERMUX_PACKAGE, null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "打开设置失败: " + e.getMessage());
        }
    }

    public String getStatusJson() {
        try {
            JSONObject json = new JSONObject();
            json.put("installed", isTermuxInstalled());

            if (isTermuxInstalled()) {
                String version = context.getPackageManager()
                        .getPackageInfo(TERMUX_PACKAGE, 0).versionName;
                json.put("version", version != null ? version : "unknown");
                json.put("hasPermission", hasRunCommandPermission());

                File propFile = new File(TERMUX_HOME + "/.termux/termux.properties");
                if (propFile.exists()) {
                    try {
                        BufferedReader reader = new BufferedReader(new FileReader(propFile));
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

    public String setupTermuxProperties() {
        return "请在 Termux 中执行以下命令来启用外部应用调用：\n\n" +
                "mkdir -p ~/.termux\n" +
                "echo 'allow-external-apps=true' >> ~/.termux/termux.properties\n" +
                "termux-reload-settings\n\n" +
                "然后到系统设置中给本应用授予 RUN_COMMAND 权限：\n" +
                "设置 → 应用 → 小蓝AI盒子 → 权限 → 附加权限 → 允许在 Termux 中运行命令";
    }

    // ═══════════════════════════════════════════════════════════
    //  异步执行
    // ═══════════════════════════════════════════════════════════

    /**
     * 在 Termux 中异步执行命令，结果通过 WebView JS 回调返回
     *
     * @param command     要执行的 shell 命令
     * @param workDir     工作目录（null 用 Termux Home）
     * @param callbackId  JS 回调 ID
     * @param webView     WebView 实例
     * @param activity    Activity
     * @param timeoutSecs 超时时间（秒）
     */
    public void executeAsync(String command, String workDir, String callbackId,
                             WebView webView, Activity activity, int timeoutSecs) {
        if (!isTermuxInstalled()) {
            callbackJs(webView, activity, callbackId, "{\"error\":\"Termux 未安装\"}");
            return;
        }
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

    private void executeAsyncInternal(String command, String workDir, String callbackId,
                                      WebView webView, Activity activity, int timeoutSecs) {
        final boolean[] callbackCalled = {false};
        // callbackCalled 在主线程（超时）和工作线程（执行完成）之间共享
        // 使用 synchronized 块保证线程安全，避免竞态导致双重回调
        final Object callbackLock = new Object();
        cancelledCallbacks.remove(callbackId);
        activeCallbacks.put(callbackId, true);

        // 超时保护
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            synchronized (callbackLock) {
                if (callbackCalled[0]) return;
                callbackCalled[0] = true;
            }
            activeCallbacks.remove(callbackId);
            Log.w(TAG, "异步命令超时: " + callbackId + " (" + timeoutSecs + "s)");
            callbackJs(webView, activity, callbackId,
                    "{\"error\":\"命令执行超时（" + timeoutSecs + "秒）\"}");
        }, timeoutSecs * 1000L);

        new Thread(() -> {
            String result = executeViaFile(command, workDir, timeoutSecs, callbackId);
            activeCallbacks.remove(callbackId);
            synchronized (callbackLock) {
                if (callbackCalled[0]) return;
                callbackCalled[0] = true;
            }
            callbackJs(webView, activity, callbackId, result);
        }, "TermuxAsync-" + callbackId).start();
    }

    public void cancelAsyncCommand(String callbackId) {
        if (callbackId != null) {
            cancelledCallbacks.put(callbackId, true);
        }
    }

    public void cancelAllAsyncCommands() {
        Log.i(TAG, "取消所有 Termux 异步命令: " + activeCallbacks.size() + " 个");
        for (String cbId : activeCallbacks.keySet()) {
            cancelledCallbacks.put(cbId, true);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  核心执行：am startservice + 文件轮询
    // ═══════════════════════════════════════════════════════════

    /**
     * 通过 am startservice 发送命令到 Termux，轮询读取输出文件获取结果
     *
     * 官方说明：am startservice 无法原生返回结果，因此用输出重定向 + 文件轮询补足。
     *
     * @param command    shell 命令
     * @param workDir    工作目录（null 用 Termux Home）
     * @param timeoutSec 超时秒数
     * @param callbackId 异步回调ID（用于取消检测，null 表示不可取消）
     * @return JSON 结果字符串
     */
    private String executeViaFile(String command, String workDir, int timeoutSec,
                                  String callbackId) {
        long ts = System.currentTimeMillis();
        String outputFile = "/sdcard/.termux_out_" + ts + ".txt";
        String scriptFile = "/sdcard/.termux_cmd_" + ts + ".sh";
        String actualWorkDir = workDir != null ? workDir : TERMUX_HOME;

        // 包装命令：输出重定向到文件 + tee 打印并保存日志到笔记目录
        String logDir = "/sdcard/Download/Bluox/Notes";
        String logFile = logDir + "/termux_log_" + ts + ".txt";
        String wrappedCommand = "mkdir -p " + logDir + " ; { " + command + " ; } 2>&1 | tee " + outputFile + " " + logFile + " ; echo EXITCODE:${PIPESTATUS[0]} >> " + outputFile;

        Log.d(TAG, "executeViaFile: " + command.substring(0, Math.min(command.length(), 60))
                + " -> " + outputFile);

        new File(outputFile).delete();

        // 写脚本文件（避免 --esa 逗号分隔问题）
        try {
            FileWriter fw = new FileWriter(scriptFile);
            fw.write(wrappedCommand);
            fw.close();
        } catch (Exception e) {
            return buildErrorJson("写入脚本失败: " + e.getMessage());
        }

        // 用 am startservice 发送（官方 Basic Example 格式）
        String amCmd = "am startservice --user 0" +
                " -n " + TERMUX_PACKAGE + "/" + TERMUX_RUN_COMMAND_SERVICE +
                " -a " + ACTION_RUN_COMMAND +
                " --es " + EXTRA_COMMAND_PATH + " " + TERMUX_PREFIX + "/bin/bash" +
                " --esa " + EXTRA_ARGUMENTS + " " + scriptFile +
                " --es " + EXTRA_WORKDIR + " " + actualWorkDir +
                " --ez " + EXTRA_BACKGROUND + " true";

        Log.d(TAG, "am cmd: " + amCmd);

        // 用 am startservice 发送（shell & 后台执行，立即返回）
        try {
            ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-c",
                    amCmd + " > /dev/null 2>&1 &");
            pb.start();
            Log.d(TAG, "am startservice 已发送");
        } catch (Exception e) {
            Log.e(TAG, "am startservice 失败: " + e.getMessage());
            new File(scriptFile).delete();
            return buildErrorJson("发送命令失败: " + e.getMessage());
        }

        // 短暂等待确保 am 有时间发送 Intent
        try { Thread.sleep(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }

        // 轮询等待输出文件
        long deadline = System.currentTimeMillis() + timeoutSec * 1000L;
        File outFile = new File(outputFile);

        while (System.currentTimeMillis() < deadline) {
            if (callbackId != null && cancelledCallbacks.containsKey(callbackId)) {
                cancelledCallbacks.remove(callbackId);
                outFile.delete();
                new File(scriptFile).delete();
                Log.i(TAG, "命令被用户取消: " + callbackId);
                return "{\"cancelled\":true}";
            }

            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                outFile.delete();
                new File(scriptFile).delete();
                return buildErrorJson("命令执行被中断");
            }

            if (!outFile.exists() || outFile.length() == 0) continue;

            String currentContent = readOutputFile(outputFile, false);
            if (currentContent == null) continue;

            if (currentContent.contains("EXITCODE:")) break;
        }

        // 读取结果
        String output = readOutputFile(outputFile, true);
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

    // ═══════════════════════════════════════════════════════════
    //  工具方法
    // ═══════════════════════════════════════════════════════════

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

    private void callbackJs(WebView webView, Activity activity, String callbackId, String json) {
        if (webView == null || activity == null) return;
        activity.runOnUiThread(() -> {
            String js = "window._onTermuxResult && window._onTermuxResult('"
                    + callbackId + "', " + json + ");";
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