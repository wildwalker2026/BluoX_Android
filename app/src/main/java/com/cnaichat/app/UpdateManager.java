package com.cnaichat.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 热更新管理器
 * 负责检查版本、下载更新包、解压安装
 */
public class UpdateManager {

    private static final String TAG = "UpdateManager";

    // 版本检查接口地址
    private static final String VERSION_CHECK_URL = "https://www.xiaolanbox.com/api/version.json";

    // 本地存储的 Web 资源目录名
    private static final String WWW_DIR = "www";

    // SharedPreferences 键名
    private static final String PREFS_NAME = "cnai_update_prefs";
    private static final String KEY_CURRENT_VERSION = "current_web_version";
    private static final String KEY_LAST_CHECK_TIME = "last_check_time";
    private static final String KEY_CHECK_UPDATE_ON_START = "check_update_on_start"; // 缓存的服务器配置

    private final Activity activity;
    private final SharedPreferences prefs;
    private final Handler mainHandler;
    private final String assetsVersion; // APK 打包时的版本

    // 回调接口
    public interface UpdateCallback {
        void onUpdateReady(String version);
        void onUpdateApplied();
        void onError(String message);
    }

    public UpdateManager(Activity activity, String assetsVersion) {
        this.activity = activity;
        this.assetsVersion = assetsVersion;
        this.prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    /**
     * 获取当前使用的 Web 版本
     */
    public String getCurrentVersion() {
        // 如果有下载的更新版本，返回该版本
        String downloadedVersion = prefs.getString(KEY_CURRENT_VERSION, null);
        if (downloadedVersion != null && isUpdateInstalled()) {
            return downloadedVersion;
        }
        // 否则返回 APK 打包时的版本
        return assetsVersion;
    }

    /**
     * 检查是否有已下载但未应用的更新
     */
    public boolean hasPendingUpdate() {
        File pendingFile = new File(activity.getCacheDir(), "pending_version.txt");
        return pendingFile.exists();
    }

    /**
     * 获取待应用的更新版本号
     */
    public String getPendingVersion() {
        try {
            File pendingFile = new File(activity.getCacheDir(), "pending_version.txt");
            if (pendingFile.exists()) {
                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(pendingFile));
                String version = reader.readLine();
                reader.close();
                return version;
            }
        } catch (Exception e) {
            Log.e(TAG, "读取待更新版本失败", e);
        }
        return null;
    }

    /**
     * 检查更新（异步）
     * @param forceCheck 是否强制检查（忽略时间间隔限制）
     * @param callback 回调
     */
    /**
     * 定时检查更新（每小时最多一次）
     */
    public void checkUpdatePeriodically(UpdateCallback callback) {
        long lastCheckTime = prefs.getLong(KEY_LAST_CHECK_TIME, 0);
        long currentTime = System.currentTimeMillis();
        if ((currentTime - lastCheckTime) < 3600000) {
            Log.d(TAG, "距离上次检查未满1小时，跳过检查");
            return;
        }
        doCheckUpdate(callback);
    }

    /**
     * 手动检查更新（立即执行，忽略时间间隔）
     */
    public void checkUpdateNow(UpdateCallback callback) {
        doCheckUpdate(callback);
    }

    /**
     * 启动时检查更新配置并决定是否立即检查
     * 会先查询服务器的 checkUpdateOnStart 字段，根据配置决定行为
     * @param callback 回调
     */
    public void checkUpdateOnStartup(UpdateCallback callback) {
        new Thread(() -> {
            try {
                URL url = new URL(VERSION_CHECK_URL + "?t=" + System.currentTimeMillis());
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setRequestProperty("Accept", "application/json");

                int responseCode = conn.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    throw new Exception("HTTP错误: " + responseCode);
                }

                InputStream is = conn.getInputStream();
                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is, "UTF-8"));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();
                conn.disconnect();

                // 解析配置
                JSONObject json = new JSONObject(response.toString());
                boolean checkUpdateOnStart = json.optBoolean("checkUpdateOnStart", false);

                // 缓存配置
                prefs.edit().putBoolean(KEY_CHECK_UPDATE_ON_START, checkUpdateOnStart).apply();
                Log.d(TAG, "服务器配置 checkUpdateOnStart: " + checkUpdateOnStart);

                mainHandler.post(() -> {
                    if (checkUpdateOnStart) {
                        // 服务器配置为 true，每小时检查一次更新
                        Log.d(TAG, "根据服务器配置，每小时检查一次更新");
                        checkUpdatePeriodically(callback);
                    } else {
                        // 服务器配置为 false，启动时不检查更新
                        Log.d(TAG, "根据服务器配置，启动时不检查更新");
                    }
                });

            } catch (Exception e) {
                Log.e(TAG, "获取更新配置失败，使用默认逻辑", e);
                // 网络失败时，使用缓存的配置或默认逻辑
                boolean cachedConfig = prefs.getBoolean(KEY_CHECK_UPDATE_ON_START, false);
                mainHandler.post(() -> {
                    if (cachedConfig) {
                        checkUpdatePeriodically(callback);
                    } else {
                        Log.d(TAG, "缓存配置为 false，启动时不检查更新");
                    }
                });
            }
        }).start();
    }

    /**
     * 实际执行更新检查
     */
    private void doCheckUpdate(UpdateCallback callback) {
        new Thread(() -> {
            try {
                URL url = new URL(VERSION_CHECK_URL + "?t=" + System.currentTimeMillis());
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setRequestProperty("Accept", "application/json");

                int responseCode = conn.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    throw new Exception("HTTP错误: " + responseCode);
                }

                InputStream is = conn.getInputStream();
                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is, "UTF-8"));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();
                conn.disconnect();

                // 更新最后检查时间
                prefs.edit().putLong(KEY_LAST_CHECK_TIME, System.currentTimeMillis()).apply();

                // 解析版本信息
                JSONObject json = new JSONObject(response.toString());
                String latestVersion = json.getString("version");
                String downloadUrl = json.getString("url");
                boolean force = json.optBoolean("force", false);
                // 根据 force 值选择消息
                String message = force
                    ? json.optString("message", "有新公告，请前往官网查看")
                    : json.optString("messageBackup", "有新公告，请前往官网查看");

                String currentVersion = getCurrentVersion();
                Log.d(TAG, "当前版本: " + currentVersion + ", 最新版本: " + latestVersion);

                if (compareVersions(latestVersion, currentVersion) > 0) {
                    mainHandler.post(() -> showUpdateDialog(latestVersion, downloadUrl, message, force, callback));
                } else {
                    Log.d(TAG, "已是最新版本");
                }

            } catch (Exception e) {
                Log.e(TAG, "检查更新失败", e);
                mainHandler.post(() -> {
                    if (callback != null) {
                        callback.onError("检查更新失败: " + e.getMessage());
                    }
                });
            }
        }).start();
    }

    /**
     * 显示更新对话框
     */
    private void showUpdateDialog(String version, String downloadUrl, String message, boolean force, UpdateCallback callback) {
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
            .setTitle("公告")
            .setMessage(message);

        if (force) {
            builder.setCancelable(false);
               // .setPositiveButton("立即更新", (dialog, which) -> downloadUpdate(version, downloadUrl, callback));
        } else {
            //builder.setPositiveButton("立即更新", (dialog, which) -> downloadUpdate(version, downloadUrl, callback))
                builder.setNegativeButton("稍后提醒", null);
        }

        builder.show();
    }

    /**
     * 下载更新包
     */
    private void downloadUpdate(String version, String downloadUrl, UpdateCallback callback) {
        ProgressDialog progressDialog = new ProgressDialog(activity);
        progressDialog.setMessage("正在下载更新...");
        progressDialog.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progressDialog.setMax(100);
        progressDialog.setProgressNumberFormat(null);
        progressDialog.setCancelable(false);
        progressDialog.show();

        new Thread(() -> {
            File zipFile = null;
            try {
                // 下载 ZIP 文件
                zipFile = new File(activity.getCacheDir(), "update_" + version + ".zip");
                downloadFile(downloadUrl, zipFile, progressDialog);

                // 解压到临时目录
                File tempDir = new File(activity.getCacheDir(), "www_temp");
                if (tempDir.exists()) {
                    deleteDirectory(tempDir);
                }
                tempDir.mkdirs();

                unzip(zipFile, tempDir, progressDialog);

                // 验证解压结果
                File indexFile = new File(tempDir, "index.html");
                if (!indexFile.exists()) {
                    throw new Exception("更新包无效：缺少 index.html");
                }

                // 增量更新：直接合并到正式目录，保留 ZIP 中没有的文件
                File wwwDir = new File(activity.getFilesDir(), WWW_DIR);

                // 首次更新：先从 assets 复制基础文件
                if (!wwwDir.exists() || !new File(wwwDir, "index.html").exists()) {
                    mainHandler.post(() -> progressDialog.setMessage("准备更新..."));
                    copyAssetsToFiles(wwwDir);
                }

                mergeDirectory(tempDir, wwwDir);

                // 删除临时目录和 ZIP 文件
                deleteDirectory(tempDir);
                if (zipFile.exists()) {
                    zipFile.delete();
                }

                // 更新版本号
                prefs.edit().putString(KEY_CURRENT_VERSION, version).apply();

                // 删除待更新标记
                File pendingFile = new File(activity.getCacheDir(), "pending_version.txt");
                if (pendingFile.exists()) {
                    pendingFile.delete();
                }

                mainHandler.post(() -> {
                    progressDialog.dismiss();
                    showRestartDialog(version, callback);
                });

            } catch (Exception e) {
                Log.e(TAG, "下载更新失败", e);
                // 清理临时文件
                if (zipFile != null && zipFile.exists()) {
                    zipFile.delete();
                }

                mainHandler.post(() -> {
                    progressDialog.dismiss();
                    new AlertDialog.Builder(activity)
                        .setTitle("更新失败")
                        .setMessage(e.getMessage())
                        .setPositiveButton("确定", null)
                        .show();
                    if (callback != null) {
                        callback.onError(e.getMessage());
                    }
                });
            }
        }).start();
    }

    /**
     * 显示重启对话框
     */
    private void showRestartDialog(String version, UpdateCallback callback) {
        new AlertDialog.Builder(activity)
            .setTitle("更新完成")
            .setMessage("版本 " + version + " 已准备好，是否立即重启应用？")
            .setPositiveButton("立即重启", (dialog, which) -> {
                if (callback != null) {
                    callback.onUpdateApplied();
                }
            })
            .setNegativeButton("稍后重启", null)
            .show();

        if (callback != null) {
            callback.onUpdateReady(version);
        }
    }

    /**
     * 增量合并目录：将 srcDir 的内容合并到 destDir
     * 同名文件会被覆盖，新文件会被添加，旧文件会被保留
     */
    private void mergeDirectory(File srcDir, File destDir) throws Exception {
        if (!destDir.exists()) {
            destDir.mkdirs();
        }

        File[] files = srcDir.listFiles();
        if (files != null) {
            for (File file : files) {
                File destFile = new File(destDir, file.getName());
                if (file.isDirectory()) {
                    // 递归合并子目录
                    mergeDirectory(file, destFile);
                } else {
                    // 覆盖同名文件
                    copyFile(file, destFile);
                }
            }
        }
    }

    /**
     * 下载文件
     */
    private void downloadFile(String urlStr, File destFile, ProgressDialog progressDialog) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(60000);

        int fileLength = conn.getContentLength();
        InputStream input = new BufferedInputStream(conn.getInputStream());
        FileOutputStream output = new FileOutputStream(destFile);

        byte[] buffer = new byte[8192];
        int total = 0;
        int count;

        while ((count = input.read(buffer)) != -1) {
            total += count;
            output.write(buffer, 0, count);

            if (fileLength > 0) {
                int progress = (int) (total * 100 / fileLength);
                mainHandler.post(() -> progressDialog.setProgress(progress));
            }
        }

        output.flush();
        output.close();
        input.close();
        conn.disconnect();
    }

    /**
     * 解压 ZIP 文件
     */
    private void unzip(File zipFile, File destDir, ProgressDialog progressDialog) throws Exception {
        mainHandler.post(() -> progressDialog.setMessage("正在解压..."));

        ZipInputStream zis = new ZipInputStream(new FileInputStream(zipFile));
        ZipEntry entry;
        byte[] buffer = new byte[8192];
        int totalEntries = 0;
        int processedEntries = 0;

        // 先计算总条目数
        ZipInputStream countZis = new ZipInputStream(new FileInputStream(zipFile));
        while (countZis.getNextEntry() != null) {
            totalEntries++;
        }
        countZis.close();

        while ((entry = zis.getNextEntry()) != null) {
            File file = new File(destDir, entry.getName());
            if (entry.isDirectory()) {
                file.mkdirs();
            } else {
                file.getParentFile().mkdirs();
                FileOutputStream fos = new FileOutputStream(file);
                int len;
                while ((len = zis.read(buffer)) > 0) {
                    fos.write(buffer, 0, len);
                }
                fos.close();
            }
            zis.closeEntry();
            processedEntries++;

            if (totalEntries > 0) {
                int progress = (int) (processedEntries * 100 / totalEntries);
                mainHandler.post(() -> progressDialog.setProgress(progress));
            }
        }
        zis.close();
    }

    /**
     * 移动目录
     */
    private void moveDirectory(File srcDir, File destDir) throws Exception {
        if (!destDir.exists()) {
            destDir.mkdirs();
        }

        File[] files = srcDir.listFiles();
        if (files != null) {
            for (File file : files) {
                File destFile = new File(destDir, file.getName());
                if (file.isDirectory()) {
                    moveDirectory(file, destFile);
                } else {
                    copyFile(file, destFile);
                }
            }
        }
    }

    /**
     * 复制文件
     */
    private void copyFile(File src, File dest) throws Exception {
        FileInputStream fis = new FileInputStream(src);
        FileOutputStream fos = new FileOutputStream(dest);
        byte[] buffer = new byte[8192];
        int len;
        while ((len = fis.read(buffer)) > 0) {
            fos.write(buffer, 0, len);
        }
        fos.close();
        fis.close();
    }

    /**
     * 删除目录
     */
    private void deleteDirectory(File dir) {
        if (dir.isDirectory()) {
            File[] children = dir.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteDirectory(child);
                }
            }
        }
        dir.delete();
    }

    /**
     * 从 assets 目录复制文件到 files 目录
     * 跳过大文件（models 目录、transformers.bundle.js）以节省空间
     */
    private void copyAssetsToFiles(File destDir) throws Exception {
        if (!destDir.exists()) {
            destDir.mkdirs();
        }

        android.content.res.AssetManager assetManager = activity.getAssets();
        copyAssetsDirectory(assetManager, "www", destDir);
    }

    // 需要跳过的大文件/目录
    private static final String[] SKIP_FILES = {
        "models",           // 152M，嵌入模型
        "transformers.bundle.js"  // 1.4M，很少更新
    };

    /**
     * 检查是否应该跳过该文件
     */
    private boolean shouldSkipFile(String fileName) {
        for (String skip : SKIP_FILES) {
            if (fileName.equals(skip)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 递归复制 assets 目录，跳过大文件
     */
    private void copyAssetsDirectory(android.content.res.AssetManager assetManager, String srcPath, File destDir) throws Exception {
        String[] children = assetManager.list(srcPath);
        if (children == null || children.length == 0) {
            // 是文件，复制
            copyAssetFile(assetManager, srcPath, destDir);
            return;
        }

        // 是目录，递归复制
        if (!destDir.exists()) {
            destDir.mkdirs();
        }

        for (String child : children) {
            // 跳过大文件
            if (shouldSkipFile(child)) {
                Log.d(TAG, "跳过大文件: " + child);
                continue;
            }

            String childSrcPath = srcPath + "/" + child;
            File childDestDir = new File(destDir, child);

            // 检查是文件还是目录
            String[] subChildren = assetManager.list(childSrcPath);
            if (subChildren == null || subChildren.length == 0) {
                // 可能是文件，也可能是一个空目录
                // 尝试作为文件复制
                try {
                    copyAssetFile(assetManager, childSrcPath, destDir);
                } catch (Exception e) {
                    // 如果失败，可能是空目录
                    childDestDir.mkdirs();
                }
            } else {
                // 是目录，递归
                copyAssetsDirectory(assetManager, childSrcPath, childDestDir);
            }
        }
    }

    /**
     * 复制单个 asset 文件
     */
    private void copyAssetFile(android.content.res.AssetManager assetManager, String srcPath, File destDir) throws Exception {
        InputStream is = assetManager.open(srcPath);
        File destFile = new File(destDir, new File(srcPath).getName());
        FileOutputStream fos = new FileOutputStream(destFile);
        byte[] buffer = new byte[8192];
        int len;
        while ((len = is.read(buffer)) > 0) {
            fos.write(buffer, 0, len);
        }
        fos.close();
        is.close();
    }

    /**
     * 检查更新是否已安装
     */
    public boolean isUpdateInstalled() {
        File wwwDir = new File(activity.getFilesDir(), WWW_DIR);
        return wwwDir.exists() && new File(wwwDir, "index.html").exists();
    }

    /**
     * 获取 Web 资源路径
     * @return 用于 WebView 加载的路径
     */
    public String getWebResourcePath() {
        File wwwDir = new File(activity.getFilesDir(), WWW_DIR);
        if (wwwDir.exists() && new File(wwwDir, "index.html").exists()) {
            return "file://" + wwwDir.getAbsolutePath() + "/index.html";
        }
        return null; // 返回 null 表示使用 assets
    }

    /**
     * 版本号比较
     * @return >0 表示 v1 > v2, <0 表示 v1 < v2, =0 表示相等
     */
    private int compareVersions(String v1, String v2) {
        String[] parts1 = v1.split("\\.");
        String[] parts2 = v2.split("\\.");

        int length = Math.max(parts1.length, parts2.length);
        for (int i = 0; i < length; i++) {
            int num1 = i < parts1.length ? Integer.parseInt(parts1[i]) : 0;
            int num2 = i < parts2.length ? Integer.parseInt(parts2[i]) : 0;
            if (num1 != num2) {
                return num1 - num2;
            }
        }
        return 0;
    }

    /**
     * 格式化文件大小
     */
    private String formatSize(long bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        } else if (bytes < 1024 * 1024) {
            return String.format("%.1f KB", bytes / 1024.0);
        } else if (bytes < 1024 * 1024 * 1024) {
            return String.format("%.1f MB", bytes / (1024.0 * 1024));
        } else {
            return String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024));
        }
    }
}