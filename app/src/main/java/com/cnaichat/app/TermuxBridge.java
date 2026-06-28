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
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
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

    // HTTP 命令服务器
    private static final String SERVER_URL = "http://127.0.0.1:8765";
    private static final String SERVER_SCRIPT = "/sdcard/Download/Bluox/termux_server.py";
    private static volatile Boolean serverAvailable = null;
    private static volatile long lastPingTime = 0;
    private static final long PING_CACHE_MS = 5000; // 5 秒内不重复 ping
    private volatile boolean initializing = false; // 服务器初始化中

    // 已取消的异步命令 callbackId 集合
    private static final ConcurrentHashMap<String, Boolean> cancelledCallbacks = new ConcurrentHashMap<>();

    // 活跃的异步命令 callbackId 集合
    private static final ConcurrentHashMap<String, Boolean> activeCallbacks = new ConcurrentHashMap<>();

    // 活跃命令的 WebView 和 Activity 引用，供取消时立即回调 JS
    private static final ConcurrentHashMap<String, Object[]> callbackContexts = new ConcurrentHashMap<>();

    // 活跃命令的回调锁和已回调标记，防止 cancel 和 execute 线程重复回调
    private static final ConcurrentHashMap<String, Object> callbackLocks = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, boolean[]> callbackCalledFlags = new ConcurrentHashMap<>();

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
        final Object callbackLock = new Object();
        final boolean[] callbackCalled = {false};
        cancelledCallbacks.remove(callbackId);
        activeCallbacks.put(callbackId, true);
        callbackContexts.put(callbackId, new Object[]{webView, activity});
        callbackLocks.put(callbackId, callbackLock);
        callbackCalledFlags.put(callbackId, callbackCalled);

        // 超时保护：额外预留 15 秒给服务器启动 + ping 开销
        final int effectiveTimeout = timeoutSecs + 15;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            synchronized (callbackLock) {
                if (callbackCalled[0]) return;
                callbackCalled[0] = true;
            }
            activeCallbacks.remove(callbackId);
            callbackContexts.remove(callbackId);
            callbackLocks.remove(callbackId);
            callbackCalledFlags.remove(callbackId);
            cancelledCallbacks.remove(callbackId);
            Log.w(TAG, "异步命令超时: " + callbackId + " (" + effectiveTimeout + "s)");
            callbackJs(webView, activity, callbackId,
                    "{\"error\":\"命令执行超时（" + timeoutSecs + "秒）\"}");
        }, effectiveTimeout * 1000L);

        new Thread(() -> {
            // 如果服务器正在初始化，直接返回提示
            if (initializing) {
                activeCallbacks.remove(callbackId);
                callbackContexts.remove(callbackId);
                cancelledCallbacks.remove(callbackId);
                synchronized (callbackLock) {
                    if (callbackCalled[0]) return;
                    callbackCalled[0] = true;
                }
                callbackLocks.remove(callbackId);
                callbackCalledFlags.remove(callbackId);
                callbackJs(webView, activity, callbackId,
                        "{\"error\":\"⏳ 服务器初始化中，请稍后重试\"}");
                return;
            }
            // 生成唯一的进度文件名，传给 Python 和轮询器
            String progressFile = PROGRESS_DIR + "/" + PROGRESS_PREFIX + callbackId + ".txt";
            // 发送命令前清理自己的进度文件（如果有残留）
            cleanupProgressFile(progressFile);
            String result;
            // 优先走 HTTP 通道（不受后台冻结影响）
            if (isServerAvailable()) {
                startHttpProgressPoller(callbackId, webView, activity, timeoutSecs, progressFile);
                result = executeViaHttp(command, workDir, timeoutSecs, progressFile, callbackId);
                stopHttpProgressPoller(callbackId);
                cleanupProgressFile(progressFile);
                if (result == null) {
                    // HTTP 失败，回退文件轮询
                    new Handler(Looper.getMainLooper()).post(() -> {
                        android.widget.Toast.makeText(context, "连接错误，使用直连方案", android.widget.Toast.LENGTH_SHORT).show();
                    });
                    result = executeViaFile(command, workDir, timeoutSecs, callbackId, webView, activity);
                }
            } else {
                // 服务器不可用，尝试启动
                tryStartServer();
                if (isServerAvailable()) {
                    startHttpProgressPoller(callbackId, webView, activity, timeoutSecs, progressFile);
                    result = executeViaHttp(command, workDir, timeoutSecs, progressFile, callbackId);
                    stopHttpProgressPoller(callbackId);
                    cleanupProgressFile(progressFile);
                    if (result == null) {
                        new Handler(Looper.getMainLooper()).post(() -> {
                            android.widget.Toast.makeText(context, "连接错误，使用直连方案", android.widget.Toast.LENGTH_SHORT).show();
                        });
                        result = executeViaFile(command, workDir, timeoutSecs, callbackId, webView, activity);
                    }
                } else {
                    // 服务器启动失败，降级到文件轮询通道
                    new Handler(Looper.getMainLooper()).post(() -> {
                        android.widget.Toast.makeText(context, "检查termux是否在后台开启", android.widget.Toast.LENGTH_LONG).show();
                    });
                    result = executeViaFile(command, workDir, timeoutSecs, callbackId, webView, activity);
                }
            }
            activeCallbacks.remove(callbackId);
            callbackContexts.remove(callbackId);
            cancelledCallbacks.remove(callbackId);
            synchronized (callbackLock) {
                if (callbackCalled[0]) return;
                callbackCalled[0] = true;
            }
            callbackLocks.remove(callbackId);
            callbackCalledFlags.remove(callbackId);
            callbackJs(webView, activity, callbackId, result);
        }, "TermuxAsync-" + callbackId).start();
    }

    public void cancelAsyncCommand(String callbackId) {
        if (callbackId != null) {
            cancelledCallbacks.put(callbackId, true);
            cancelCommandViaHttp(callbackId);
            // 立即回调 JS，不等 HTTP 响应
            Object[] ctx = callbackContexts.remove(callbackId);
            Object lock = callbackLocks.remove(callbackId);
            boolean[] called = callbackCalledFlags.remove(callbackId);
            if (ctx != null && lock != null && called != null) {
                synchronized (lock) {
                    if (called[0]) return;
                    called[0] = true;
                }
                activeCallbacks.remove(callbackId);
                // 注意：不 remove cancelledCallbacks，留给 execute 线程检测后自行清理
                WebView wv = (WebView) ctx[0];
                Activity act = (Activity) ctx[1];
                callbackJs(wv, act, callbackId, "{\"cancelled\":true}");
            }
        }
    }

    /**
     * 通过 HTTP 通知 Python 服务器杀掉指定命令的子进程
     */
    private void cancelCommandViaHttp(String cmdId) {
        // 服务器不可用时跳过，避免无意义的网络请求
        if (serverAvailable == null || !serverAvailable) return;
        new Thread(() -> {
            try {
                JSONObject req = new JSONObject();
                req.put("cmd_id", cmdId);
                byte[] body = req.toString().getBytes("UTF-8");

                HttpURLConnection conn = (HttpURLConnection) new URL(SERVER_URL + "/cancel").openConnection();
                conn.setRequestProperty("Connection", "close");
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setConnectTimeout(2000);
                conn.setReadTimeout(2000);
                conn.setDoOutput(true);
                OutputStream os = conn.getOutputStream();
                os.write(body);
                os.flush();
                os.close();
                conn.getResponseCode();
                conn.disconnect();
                Log.d(TAG, "HTTP cancel 已发送: " + cmdId);
            } catch (Exception e) {
                Log.w(TAG, "HTTP cancel 失败: " + e.getMessage());
            }
        }).start();
    }

    public void cancelAllAsyncCommands() {
        Log.i(TAG, "取消所有 Termux 异步命令: " + activeCallbacks.size() + " 个");
        for (String cbId : activeCallbacks.keySet()) {
            cancelledCallbacks.put(cbId, true);
            cancelCommandViaHttp(cbId);
            // 立即回调 JS
            Object[] ctx = callbackContexts.remove(cbId);
            Object lock = callbackLocks.remove(cbId);
            boolean[] called = callbackCalledFlags.remove(cbId);
            if (ctx != null && lock != null && called != null) {
                synchronized (lock) {
                    if (called[0]) continue;
                    called[0] = true;
                }
                activeCallbacks.remove(cbId);
                // 注意：不 remove cancelledCallbacks，留给 execute 线程检测后自行清理
                WebView wv = (WebView) ctx[0];
                Activity act = (Activity) ctx[1];
                callbackJs(wv, act, cbId, "{\"cancelled\":true}");
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HTTP 进度轮询：HTTP 阻塞期间扫描 tee 进度文件推送到前端
    // ═══════════════════════════════════════════════════════════

    private static final String PROGRESS_DIR = "/sdcard/Download/Bluox/Notes";
    private static final String PROGRESS_PREFIX = ".termux_http_out_";
    private final ConcurrentHashMap<String, Boolean> httpProgressRunning = new ConcurrentHashMap<>();

    /**
     * 启动 HTTP 进度轮询线程
     */
    private void startHttpProgressPoller(String callbackId, WebView webView, Activity activity, int timeoutSecs, String progressFile) {
        httpProgressRunning.put(callbackId, true);
        new Thread(() -> {
            Log.d(TAG, "HTTP 进度轮询启动: " + callbackId + " file=" + progressFile);
            String lastContent = "";
            long startTime = System.currentTimeMillis();
            long deadline = startTime + (timeoutSecs + 10) * 1000L;

            while (httpProgressRunning.get(callbackId) != null
                    && httpProgressRunning.get(callbackId)
                    && System.currentTimeMillis() < deadline) {
                // 检查取消
                if (cancelledCallbacks.containsKey(callbackId)) {
                    Log.d(TAG, "HTTP 进度轮询被取消: " + callbackId);
                    break;
                }

                // 读指定进度文件
                String content = readProgressFile(progressFile);
                if (content != null && !content.equals(lastContent)) {
                    lastContent = content;
                    final String progress = content;
                    activity.runOnUiThread(() -> {
                        String js = "window._onTermuxProgress && window._onTermuxProgress(\""
                                + callbackId + "\", \"" + escapeJson(progress) + "\");";
                        webView.evaluateJavascript(js, null);
                    });
                }

                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    break;
                }
            }
            httpProgressRunning.remove(callbackId);
            Log.d(TAG, "HTTP 进度轮询结束: " + callbackId);
        }, "HttpProgress-" + callbackId).start();
    }

    /**
     * 停止 HTTP 进度轮询线程
     */
    private void stopHttpProgressPoller(String callbackId) {
        httpProgressRunning.put(callbackId, false);
    }

    /**
     * 读取指定进度文件
     */
    private String readProgressFile(String filePath) {
        if (filePath == null) return null;
        try {
            return readOutputFile(filePath, false);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 清理指定进度文件
     */
    private void cleanupProgressFile(String progressFile) {
        if (progressFile == null) return;
        try {
            new File(progressFile).delete();
        } catch (Exception e) {
            Log.w(TAG, "清理进度文件失败: " + e.getMessage());
        }
    }

    /**
     * 清理所有进度文件（仅页面刷新时用）
     */
    private void cleanupProgressFiles() {
        try {
            File dir = new File(PROGRESS_DIR);
            if (!dir.exists()) return;
            File[] files = dir.listFiles((d, name) ->
                    name.startsWith(PROGRESS_PREFIX) && name.endsWith(".txt"));
            if (files == null) return;
            for (File f : files) {
                f.delete();
            }
            Log.d(TAG, "已清理进度文件: " + files.length + " 个");
        } catch (Exception e) {
            Log.w(TAG, "清理进度文件失败: " + e.getMessage());
        }
    }

    /**
     * 页面重新加载时检查服务器状态：
     * - ping 通 → 服务器活着，不杀，直接复用
     * - ping 不通 → 杀旧进程，等端口释放后重启
     */
    public void killServerOnPageReload() {
        new Thread(() -> {
            try {
                // 1. 先 ping 检查服务器是否存活
                boolean alive = pingServer();
                if (alive) {
                    // 服务器活着，直接复用
                    serverAvailable = true;
                    lastPingTime = System.currentTimeMillis();
                    Log.d(TAG, "onPageFinished: 服务器存活，跳过重启");
                    android.widget.Toast.makeText(context, "termux就绪", android.widget.Toast.LENGTH_SHORT).show();
                    return;
                }

                // 2. ping 不通，需要重启
                initializing = true;
                serverAvailable = null;
                android.widget.Toast.makeText(context, "termux初始化中", android.widget.Toast.LENGTH_SHORT).show();

                // 杀旧进程
                String killScript = "/sdcard/.termux_kill_server.sh";
                java.io.FileWriter fw = new java.io.FileWriter(killScript);
                fw.write("pkill -f termux_server.py 2>/dev/null\n");
                fw.close();
                String amCmd = "am startservice --user 0" +
                        " -n com.termux/com.termux.app.RunCommandService" +
                        " -a com.termux.RUN_COMMAND" +
                        " --es com.termux.RUN_COMMAND_PATH /data/data/com.termux/files/usr/bin/bash" +
                        " --esa com.termux.RUN_COMMAND_ARGUMENTS " + killScript +
                        " --es com.termux.RUN_COMMAND_WORKDIR /data/data/com.termux/files/home" +
                        " --ez com.termux.RUN_COMMAND_BACKGROUND true";
                ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-c",
                        amCmd + " > /dev/null 2>&1");
                pb.start().waitFor();
                Log.d(TAG, "onPageFinished kill 已执行");
                // 等5秒让端口释放
                Thread.sleep(5000);
                // 启动新服务器
                tryStartServer();
                initializing = false;
                Log.d(TAG, "onPageFinished 服务器已自动重启");
            } catch (Exception e) {
                initializing = false;
                Log.w(TAG, "onPageFinished 重启失败: " + e.getMessage());
            }
        }).start();
    }

    // ═══════════════════════════════════════════════════════════
    //  HTTP 通道：通过常驻 Python 服务器执行命令（不受后台冻结影响）
    // ═══════════════════════════════════════════════════════════

    /**
     * 检查 HTTP 服务器是否可用（5 秒缓存）
     */
    public boolean isServerAvailable() {
        // 5 秒内的检测结果直接复用
        if (serverAvailable != null && serverAvailable
                && System.currentTimeMillis() - lastPingTime < PING_CACHE_MS) {
            return true;
        }
        serverAvailable = pingServer();
        lastPingTime = System.currentTimeMillis();
        return serverAvailable;
    }

    /**
     * Ping 服务器
     */
    private boolean pingServer() {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(SERVER_URL + "/ping").openConnection();
            conn.setRequestProperty("Connection", "close");
            conn.setConnectTimeout(2000);
            conn.setReadTimeout(2000);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            conn.disconnect();
            return code == 200;
        } catch (Exception e) {
            Log.e(TAG, "pingServer 失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            return false;
        }
    }

    /**
     * 尝试启动 HTTP 服务器
     */
    public void tryStartServer() {
        // 先杀掉旧的服务器进程（通过 pid 文件）
        killOldServer();

        // 从 assets 释放服务器脚本（每次都覆盖，确保最新版本）
        File scriptFile = new File(SERVER_SCRIPT);
        scriptFile.getParentFile().mkdirs();
        try {
            java.io.InputStream is = context.getAssets().open("termux_server.py");
            java.io.FileOutputStream fos = new java.io.FileOutputStream(scriptFile);
            byte[] buf = new byte[4096];
            int len;
            while ((len = is.read(buf)) > 0) fos.write(buf, 0, len);
            fos.close();
            is.close();
            Log.i(TAG, "服务器脚本已从 assets 释放到: " + SERVER_SCRIPT);
        } catch (Exception e) {
            Log.e(TAG, "释放服务器脚本失败: " + e.getMessage());
            return;
        }
        Log.i(TAG, "尝试启动 HTTP 命令服务器...");

        // 写启动脚本文件（避免 --esa 空格截断）
        String launcherFile = "/sdcard/.termux_start_server.sh";
        try {
            FileWriter fw = new FileWriter(launcherFile);
            fw.write("nohup " + TERMUX_PREFIX + "/bin/python3 \"" + SERVER_SCRIPT + "\" > /dev/null 2>&1 &\n");
            fw.close();
        } catch (Exception e) {
            Log.e(TAG, "写入启动脚本失败: " + e.getMessage());
            return;
        }

        String amCmd = "am startservice --user 0" +
                " -n " + TERMUX_PACKAGE + "/" + TERMUX_RUN_COMMAND_SERVICE +
                " -a " + ACTION_RUN_COMMAND +
                " --es " + EXTRA_COMMAND_PATH + " " + TERMUX_PREFIX + "/bin/bash" +
                " --esa " + EXTRA_ARGUMENTS + " " + launcherFile +
                " --es " + EXTRA_WORKDIR + " " + TERMUX_HOME +
                " --ez " + EXTRA_BACKGROUND + " true";
        try {
            ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-c",
                    amCmd + " > /dev/null 2>&1 &");
            pb.start();
        } catch (Exception e) {
            Log.e(TAG, "启动服务器失败: " + e.getMessage());
            return;
        }
        // 等待启动（最多 8 秒）
        for (int i = 0; i < 16; i++) {
            try { Thread.sleep(500); } catch (InterruptedException e) { break; }
            if (pingServer()) {
                serverAvailable = true;
                Log.i(TAG, "HTTP 命令服务器已启动");
                // 在主线程显示 Toast
                return;
            }
        }
        Log.w(TAG, "HTTP 命令服务器启动超时");
        serverAvailable = false;
    }

    /**
     * 杀掉旧的服务器进程（通过 Termux 执行 pkill）
     */
    private void killOldServer() {
        // 写 kill 脚本
        String killScript = "/sdcard/.termux_kill_server.sh";
        try {
            FileWriter fw = new FileWriter(killScript);
            fw.write("pkill -f termux_server.py 2>/dev/null\n");
            fw.close();
        } catch (Exception e) {
            Log.w(TAG, "写入 kill 脚本失败: " + e.getMessage());
        }

        // 通过 am startservice 在 Termux 中执行 kill
        String amCmd = "am startservice --user 0" +
                " -n " + TERMUX_PACKAGE + "/" + TERMUX_RUN_COMMAND_SERVICE +
                " -a " + ACTION_RUN_COMMAND +
                " --es " + EXTRA_COMMAND_PATH + " " + TERMUX_PREFIX + "/bin/bash" +
                " --esa " + EXTRA_ARGUMENTS + " " + killScript +
                " --es " + EXTRA_WORKDIR + " " + TERMUX_HOME +
                " --ez " + EXTRA_BACKGROUND + " true";
        try {
            ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-c",
                    amCmd + " > /dev/null 2>&1 &");
            pb.start();
        } catch (Exception e) {
            Log.w(TAG, "发送 kill 命令失败: " + e.getMessage());
        }
        // 等待 kill 执行
        try { Thread.sleep(1000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        serverAvailable = null;
    }

    /**
     * 通过 HTTP 通道执行命令
     * @return JSON 结果字符串，null 表示失败（应回退到文件轮询）
     */
    private String executeViaHttp(String command, String workDir, int timeoutSec, String progressFile, String cmdId) {
        HttpURLConnection conn = null;
        try {
            JSONObject req = new JSONObject();
            req.put("command", command);
            req.put("timeout", timeoutSec);
            if (workDir != null) req.put("workdir", workDir);
            if (progressFile != null) req.put("output_file", progressFile);
            if (cmdId != null) req.put("cmd_id", cmdId);
            byte[] body = req.toString().getBytes("UTF-8");

            conn = (HttpURLConnection) new URL(SERVER_URL + "/exec").openConnection();
            conn.setRequestProperty("Connection", "close");
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(timeoutSec * 1000 + 5000);
            conn.setDoOutput(true);

            OutputStream os = conn.getOutputStream();
            os.write(body);
            os.flush();
            os.close();

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.e(TAG, "HTTP 执行失败: " + code);
                serverAvailable = false;
                return null;
            }

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                if (sb.length() > 0) sb.append("\n");
                sb.append(line);
            }
            reader.close();

            JSONObject resp = new JSONObject(sb.toString());
            int exitCode = resp.optInt("exitCode", -1);
            String output = resp.optString("output", "");
            String error = resp.optString("error", "");

            if (!error.isEmpty()) {
                return "{\"error\":\"" + escapeJson(error) + "\"}";
            }

            Log.d(TAG, "HTTP 通道执行完成: exitCode=" + exitCode);
            return buildResultJson(exitCode, output, "");

        } catch (Exception e) {
            Log.e(TAG, "HTTP 通道异常: " + e.getMessage());
            serverAvailable = false;
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  核心执行：am startservice + 文件轮询（fallback）
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
                                  String callbackId, WebView webView, Activity activity) {
        long ts = System.currentTimeMillis();
        String outputFile = "/sdcard/.termux_out_" + ts + ".txt";
        String scriptFile = "/sdcard/.termux_cmd_" + ts + ".sh";
        String actualWorkDir = workDir != null ? workDir : TERMUX_HOME;

        // 包装命令：输出重定向到文件 + 追加退出码 + 追加日志到笔记目录（按日）
        String logDir = "/sdcard/Download/Bluox/Notes";
        java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyyMMdd");
        String dateStr = sdf.format(new java.util.Date(ts));
        String logFile = logDir + "/termux_log_" + dateStr + ".txt";
        String wrappedCommand = "{ " + command + " ; } > " + outputFile + " 2>&1 ; echo EXITCODE:$? >> " + outputFile
                + " ; mkdir -p " + logDir + " ; cat " + outputFile + " >> " + logFile;

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

        // 轮询等待输出文件，每 300ms 推送进度到前端
        long deadline = System.currentTimeMillis() + timeoutSec * 1000L;
        File outFile = new File(outputFile);
        long lastProgressTime = 0;
        String lastProgressContent = "";

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

            // 推送进度（每 300ms，内容有变化时）
            long now = System.currentTimeMillis();
            if (now - lastProgressTime >= 300 && !currentContent.equals(lastProgressContent)) {
                lastProgressTime = now;
                lastProgressContent = currentContent;
                final String progress = currentContent;
                activity.runOnUiThread(() -> {
                    String js = "window._onTermuxProgress && window._onTermuxProgress(\""
                            + callbackId + "\", \"" + escapeJson(progress) + "\");";
                    webView.evaluateJavascript(js, null);
                });
            }

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