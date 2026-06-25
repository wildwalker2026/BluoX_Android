package com.cnaichat.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.text.TextUtils;
import android.util.Log;
import android.view.ActionMode;
import android.view.KeyEvent;
import android.view.Menu;
import android.view.MenuItem;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputConnectionWrapper;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.WindowInsetsController;
import android.view.WindowMetrics;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;

// GDT 广告 SDK 导入（已停用）
// import com.qq.e.ads.interstitial2.UnifiedInterstitialAD;
// import com.qq.e.ads.interstitial2.UnifiedInterstitialADListener;
import com.bytedance.sdk.openadsdk.TTFeedAd;
import com.bytedance.sdk.openadsdk.mediation.ad.MediationAdSlot;
import com.bytedance.sdk.openadsdk.mediation.ad.MediationExpressRenderListener;
// import com.qq.e.comm.constants.AdPatternType;
// import com.qq.e.comm.listeners.ADRewardListener;
// import com.qq.e.comm.util.AdError;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Button;
import android.view.LayoutInflater;
import android.view.ViewGroup;
import android.graphics.drawable.Drawable;
import java.util.ArrayList;

// ========== 穿山甲 SDK 导入（开屏广告）==========
import com.bytedance.sdk.openadsdk.AdSlot;
import com.bytedance.sdk.openadsdk.CSJAdError;
import com.bytedance.sdk.openadsdk.CSJSplashAd;
import com.bytedance.sdk.openadsdk.TTAdNative;
import com.bytedance.sdk.openadsdk.TTAdSdk;

/**
 * CNAIChat WebView Activity
 */
public class MainActivity extends Activity {

    private WebView webView;
    // 全局共享 OkHttpClient，复用连接池和线程池
    private static final OkHttpClient sharedHttpClient = new OkHttpClient.Builder()
        .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build();
    // 跟踪正在进行的异步 HTTP 请求，支持取消
    private final Map<String, Call> pendingHttpCalls = new ConcurrentHashMap<>();
    // 标记已被取消的回调 ID，避免 cancel 后的 onFailure 回调产生冗余 evaluateJavascript
    private final java.util.Set<String> cancelledCallbacks = ConcurrentHashMap.newKeySet();
    private volatile String pendingKnowledgeFilesData = null;
    private volatile boolean messageInputHasSelection = false; // textarea 选区状态
    private String currentThemeColor = "#0f0f0f"; // 默认主题色（暗色背景）
    private static final int FILE_CHOOSER_REQUEST_CODE = 1001;
    private static final int IMAGE_CHOOSER_REQUEST_CODE = 1002;
    private static final int STORAGE_PERMISSION_REQUEST_CODE = 1003;
    private static final int UPLOAD_FILE_REQUEST_CODE = 1004;
    private static final int KNOWLEDGE_FILE_REQUEST_CODE = 1005;
    private static final int COMPRESS_IMAGE_REQUEST_CODE = 1006;
    private static final int PC_FILE_TRANSFER_REQUEST_CODE = 1007;
    private String pendingExportData = null;
    private String pendingExportFileName = null;
    private boolean pendingImportAction = false;
    private boolean isRestoreDataMode = false; // 区分导入聊天记录和恢复数据

    // 电脑端WebSocket连接信息（由JS通过AndroidBridge设置）
    private String pcServerIP = null;
    private String pcDeviceToken = null;

    // 用户主动旋转到横屏标记（0=未旋转，1=已旋转）
    private int userRotatedToLandscape = 0;

    // 键盘高度监听相关
    private int lastKeyboardHeight = 0;
    private int[] initialHeight = {0};  // 屏幕方向变化时需要重置
    //private ViewTreeObserver.OnGlobalLayoutListener keyboardLayoutListener = null;
    // boolean isKeyboardListenerAdded = false;

    // Embedding generator for native vector processing
    private EmbeddingGenerator embeddingGenerator;

    // 热更新管理器
    private UpdateManager updateManager;

    // 内置终端执行器
    private TerminalExecutor terminalExecutor;

    // Termux 桥接器
    private TermuxBridge termuxBridge;

    // APK 打包时的 Web 版本号（与 config.xml 保持一致）
    private static final String ASSETS_WEB_VERSION = "1.3.8";

    // 广告 SDK 相关
    private static final String CSJ_SPLASH_AD_CODE_ID = "103980017"; // 穿山甲开屏广告代码位ID
    private boolean isAdSdkInitialized = false;
    private static final String PREFS_NAME = "CNAIChatPrefs";
    private static final String KEY_PERMISSION_EXPLANATION_SHOWN = "permission_explanation_shown";
    private List<String> pendingPermissionRequest = null;
    private boolean shouldDeferAdPermission = true;  // 延迟到用户发送消息时再申请权限
    private boolean mFromRequestAdPermission = false;  // 标记是否来自requestAdPermissionNow，跳过开屏广告
    
    // 开屏广告相关（穿山甲 CSJ）
    private FrameLayout mSplashContainer;
    private CSJSplashAd mCsjSplashAd;
    private boolean isSplashAdLoaded = false;
    private long splashAdLoadTime = 0;
    private boolean isSplashAdLoading = false;
    private boolean isResumingFromBackground = false;  // 是否从后台恢复
    private boolean isActivityInForeground = true;     // Activity是否在前台
    private boolean isAdSdkPendingInit = false;        // 广告SDK是否因在后台而待初始化

    // ====== 激励广告（已停用）======
    /*
    private TTRewardVideoAd mTTRewardVideoAd;
    private boolean isRewardedAdLoaded = false;
    private boolean isRewardedAdLoading = false;
    private boolean hasNotifiedAdResult = false;
    private boolean hasShownRewardedAd = false;
    private boolean shouldShowAdAfterLoad = false;
    */

    // 插屏广告相关（GDT 已停用）
    // private UnifiedInterstitialAD mInterstitialAd;
    private boolean isInterstitialAdLoaded = false;
    private boolean isInterstitialAdLoading = false;
    private boolean hasShownInterstitialAd = false;
    private boolean shouldShowInterstitialAfterLoad = false;

    // 信息流模板广告相关（CSJ）
    private TTFeedAd mCsjFeedAd;
    private View mFeedAdView;
    private View mFeedAdCountdownView;
    private View mFeedAdLabelView; // "广告"标签
    private android.os.Handler mFeedAdCountdownHandler;
    private Runnable mFeedAdCountdownRunnable;
    private int mFeedAdBaseY = 0; // 广告初始Y位置（物理像素）
    private boolean isFeedAdLoading = false;
    private static final String CSJ_FEED_AD_CODE_ID = "104103890"; // 穿山甲信息流广告代码位ID

    // 广告配置（服务器控制）
    private static class AdConfig {
        boolean ad_enabled = false;
        boolean splash_ad_enabled = false;
        boolean banner_ad_enabled = false;
        boolean interstitial_ad_enabled = false;
        // 激励广告已停用
        // boolean rewarded_ad_enabled = true;
        // String rewarded_ad_code_id = "103994532";
        // GDT 插屏广告代码位ID（已停用）
        // String interstitial_ad_code_id = "9229610788880620";
        long splash_ad_interval_ms = 3600000; // 默认1小时
        String adps = ""; // 免广告密码（彩蛋用）
    }
    private AdConfig mAdConfig = new AdConfig();
    private static final String AD_CONFIG_URL = "https://www.xiaolanbox.com/api/ad_config_1.3.0.json";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        isResumingFromBackground = false; // 冷启动，不是从后台恢复
        userRotatedToLandscape = 0; // 重置横屏旋转标记

        // 创建根布局
        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // 导航栏永远透明
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }

        // 创建开屏广告容器
        mSplashContainer = new FrameLayout(this);
        mSplashContainer.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        mSplashContainer.setBackgroundColor(Color.parseColor("#000000"));
        mSplashContainer.setVisibility(View.GONE); // 默认隐藏，由广告加载逻辑决定是否显示

        // 创建主 WebView（重写 onCreateInputConnection 拦截选区删除）
        webView = new WebView(this) {
            @Override
            public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
                InputConnection ic = super.onCreateInputConnection(outAttrs);
                if (ic == null) return null;
                return new InputConnectionWrapper(ic, false) {
                    @Override
                    public boolean commitText(CharSequence text, int newCursorPosition) {
                        // 全选删除时 IME 发送 commitText("", 1)，拦截用 JS 手动删除
                        if (text != null && text.length() == 0 && messageInputHasSelection) {
                            messageInputHasSelection = false;
                            runOnUiThread(() -> {
                                webView.evaluateJavascript(
                                    "(function(){" +
                                    "var i=document.activeElement;" +
                                    "if(i&&(i.tagName==='INPUT'||i.tagName==='TEXTAREA')&&i.selectionStart!==i.selectionEnd){" +
                                    "i.value=i.value.substring(0,i.selectionStart)+i.value.substring(i.selectionEnd);" +
                                    "i.setSelectionRange(i.selectionStart,i.selectionStart);" +
                                    "i.dispatchEvent(new Event('input'));" +
                                    "}})()", null);
                            });
                            return true;
                        }
                        return super.commitText(text, newCursorPosition);
                    }
                };
            }
        };
        // 注册 JS 接口，跟踪 textarea 选区状态
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setSelectionState(boolean hasSelection) {
                messageInputHasSelection = hasSelection;
            }
        }, "InputFix");
        webView.setBackgroundColor(Color.parseColor("#000000"));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // 添加视图到根布局（先添加 WebView，再添加开屏广告容器）
        rootLayout.addView(webView);
        rootLayout.addView(mSplashContainer);

        // 设置根布局为内容视图
        setContentView(rootLayout);

        // 注意：广告 SDK 不在此处立即初始化，等待用户同意隐私协议后由 Web 端触发初始化
        // 穿山甲 SDK 在 Application.onCreate 中已根据上次配置决定是否初始化
        // 注册穿山甲 SDK 就绪回调，就绪后直接加载开屏广告
        CNAIChatApplication.setCsjAdSdkCallback(() -> {
            runOnUiThread(() -> {
                Log.d("AdSdk", "穿山甲 SDK 就绪回调，开始加载开屏广告");
                loadAndShowSplashAd();
            });
        });

        // 内容永远延伸到状态栏和导航栏后面，但不隐藏系统栏
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        // 配置 WebView
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // 允许从 file:// URL 进行跨域网络请求（解决 CORS 问题）
        webSettings.setAllowUniversalAccessFromFileURLs(true);
        webSettings.setAllowFileAccessFromFileURLs(true);

        // 适配移动屏幕
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);

        // 初始化 Embedding Generator
        embeddingGenerator = new EmbeddingGenerator();
        embeddingGenerator.initializeAsync(this, new EmbeddingGenerator.InitCallback() {
            @Override
            public void onSuccess() {
                Log.d("MainActivity", "EmbeddingGenerator initialized successfully");
                runOnUiThread(() -> {
                    webView.evaluateJavascript(
                        "if (typeof window.onNativeEmbeddingReady === 'function') { window.onNativeEmbeddingReady(); }",
                        null
                    );
                });
            }
            @Override
            public void onError(String message) {
                Log.e("MainActivity", "EmbeddingGenerator init failed: " + message);
            }
        });

        // 初始化热更新管理器
        updateManager = new UpdateManager(this, ASSETS_WEB_VERSION);

        // 设置 JavaScript 接口
        setupJavascriptInterface();

        // 设置 WebViewClient 在应用内打开链接
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // 页面加载完成后通知 JS 当前是移动端环境
                webView.evaluateJavascript(
                    "if (typeof window.setMobileMode === 'function') { window.setMobileMode(); }",
                    null
                );
                Log.d("AdSdk", "onPageFinished");
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // 内部链接（file:// 开头）在当前 WebView 打开
                if (url.startsWith("file://")) {
                    return false;
                }
                // 外部链接用 AgreementActivity 打开
                openUrlWithAgreementActivity(url, "网页");
                return true;
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                // 拦截资源请求，实现 files -> assets 回退逻辑
                try {
                    if (url.startsWith("file://")) {
                        String filePath = url.substring(7); // 去掉 "file://"

                        // 如果是 files/www 目录的请求
                        if (filePath.contains("/files/www/")) {
                            File file = new File(filePath);
                            if (file.exists()) {
                                // 文件存在于 files 目录，正常加载
                                return null; // 返回 null 让 WebView 默认处理
                            }

                            // 文件不存在，尝试从 assets 加载
                            String assetPath = extractAssetPath(filePath);
                            if (assetPath != null) {
                                InputStream is = getAssets().open(assetPath);
                                String mimeType = getMimeType(assetPath);
                                return new android.webkit.WebResourceResponse(mimeType, "UTF-8", is);
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.e("MainActivity", "shouldInterceptRequest error: " + e.getMessage());
                }
                return null; // 返回 null 让 WebView 默认处理
            }

            private String extractAssetPath(String filePath) {
                // 从路径中提取 assets 路径
                // 例如: /data/data/com.cnaichat.app/files/www/models/xxx.onnx -> www/models/xxx.onnx
                int wwwIndex = filePath.indexOf("/www/");
                if (wwwIndex >= 0) {
                    return filePath.substring(wwwIndex + 1); // 去掉前面的 "/"
                }
                return null;
            }

            private String getMimeType(String path) {
                if (path.endsWith(".js")) return "application/javascript";
                if (path.endsWith(".css")) return "text/css";
                if (path.endsWith(".html")) return "text/html";
                if (path.endsWith(".json")) return "application/json";
                if (path.endsWith(".png")) return "image/png";
                if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
                if (path.endsWith(".svg")) return "image/svg+xml";
                if (path.endsWith(".onnx")) return "application/octet-stream";
                if (path.endsWith(".wasm")) return "application/wasm";
                return "application/octet-stream";
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onConsoleMessage(String message, int lineNumber, String sourceID) {
                android.util.Log.d("WebView", message + " (" + sourceID + ":" + lineNumber + ")");
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                // 处理 _blank 打开的新窗口
                WebView.HitTestResult result = view.getHitTestResult();
                String url = result.getExtra();
                if (url == null) {
                    url = view.getUrl();
                }
                openUrlWithAgreementActivity(url, "网页");
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                // 自定义 alert 对话框，不显示 "The page at xxx says..."
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> {
                            result.confirm();
                        })
                        .setCancelable(false)
                        .show();
                return true; // 表示已处理，不使用默认对话框
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                // 自定义 confirm 对话框
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> {
                            result.confirm();
                        })
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> {
                            result.cancel();
                        })
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
                // 自定义 beforeunload 对话框
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> {
                            result.confirm();
                        })
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> {
                            result.cancel();
                        })
                        .setCancelable(false)
                        .show();
                return true;
            }
        });

        // 设置键盘监听，实现输入框紧贴键盘
        setupKeyboardListener();

        // 根据当前屏幕方向设置状态栏显示状态
        updateStatusBarVisibility();

        // 加载 Web 应用（优先使用已下载的更新版本）
        loadWebApp();

        // 启动时检查更新（根据服务器配置决定是否立即检查）
        checkForUpdatesOnStartup();
    }

    /**
     * 用 AgreementActivity 打开 URL
     */
    private void openUrlWithAgreementActivity(String url, String title) {
        // 协议相关和自有域名的链接用 http，其他链接强制用 https
        String finalUrl = url;
        boolean isOwnSite = url.contains("xiaolanbox.com");
        if (!isOwnSite && !title.contains("协议") && url.startsWith("http://")) {
            finalUrl = "https://" + url.substring(7);
            Log.d("MainActivity", "强制改用 https: " + finalUrl);
        }
        
        Intent intent = new Intent(MainActivity.this, AgreementActivity.class);
        intent.putExtra(AgreementActivity.EXTRA_URL, finalUrl);
        intent.putExtra(AgreementActivity.EXTRA_TITLE, title);
        startActivity(intent);
    }

    /**
     * 加载 Web 应用
     * 优先加载已下载的更新版本，否则使用 APK 内置资源
     */
    private void loadWebApp() {
        String webPath = updateManager.getWebResourcePath();
        if (webPath != null) {
            Log.d("MainActivity", "加载更新版本: " + webPath + ", 版本: " + updateManager.getCurrentVersion());
            webView.loadUrl(webPath);
        } else {
            Log.d("MainActivity", "加载内置资源, 版本: " + ASSETS_WEB_VERSION);
            webView.loadUrl("file:///android_asset/www/index.html");
        }
    }

    /**
     * 启动时检查更新（根据服务器配置决定行为）
     * 先查询服务器的 checkUpdateOnStart 字段：
     * - 如果为 true，立即检查更新
     * - 如果为 false，按每小时一次的逻辑
     */
    private void checkForUpdatesOnStartup() {
        updateManager.checkUpdateOnStartup(new UpdateManager.UpdateCallback() {
            @Override
            public void onUpdateReady(String version) {
                Log.d("MainActivity", "更新已准备好: " + version);
            }

            @Override
            public void onUpdateApplied() {
                // 用户选择立即重启，重新加载页面
                Log.d("MainActivity", "应用更新，重新加载页面");
                webView.loadUrl("about:blank");
                loadWebApp();
            }

            @Override
            public void onError(String message) {
                Log.e("MainActivity", "更新检查错误: " + message);
            }
        });
    }

    /**
     * 检查更新（手动触发，强制检查）
     */
    private void checkForUpdates() {
        updateManager.checkUpdateNow(new UpdateManager.UpdateCallback() {
            @Override
            public void onUpdateReady(String version) {
                Log.d("MainActivity", "更新已准备好: " + version);
            }

            @Override
            public void onUpdateApplied() {
                // 用户选择立即重启，重新加载页面
                Log.d("MainActivity", "应用更新，重新加载页面");
                webView.loadUrl("about:blank");
                loadWebApp();
            }

            @Override
            public void onError(String message) {
                Log.e("MainActivity", "更新检查错误: " + message);
            }
        });
    }
    int a = 0;
    // 设置键盘监听，实现输入框紧贴键盘
    private void setupKeyboardListener() {
        final View decorView = getWindow().getDecorView();
        final View rootView = decorView.getRootView();



        // 打印屏幕信息（调试用）
        DisplayMetrics dm = getResources().getDisplayMetrics();
        Log.d("ScreenInfo", "========== 屏幕信息 ==========");
        Log.d("ScreenInfo", "屏幕高度(px): " + dm.heightPixels);
        Log.d("ScreenInfo", "屏幕宽度(px): " + dm.widthPixels);
        Log.d("ScreenInfo", "屏幕密度: " + dm.density);
        Log.d("ScreenInfo", "屏幕密度DPI: " + dm.densityDpi);

        decorView.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            Rect visibleFrame = new Rect();
            decorView.getWindowVisibleDisplayFrame(visibleFrame);

            int currentHeight = visibleFrame.height();
            Log.d("KeyboardAnimation", "visibleFrame.height的值"+visibleFrame.height());

            a +=1;
            Log.d("KeyboardAnimation","运行次数"+a);

            // 记录初始高度（键盘未弹出时）- 延迟确保布局完成
            if (initialHeight[0] == 0) {
                // 等待 rootView 高度稳定后再记录
                if (rootView.getHeight() > 0) {
                    initialHeight[0] = currentHeight;
                    Log.d("ScreenInfo", "可见区域高度: " + currentHeight);
                    Log.d("ScreenInfo", "可见区域top: " + visibleFrame.top);
                    Log.d("ScreenInfo", "可见区域bottom: " + visibleFrame.bottom);
                    Log.d("ScreenInfo", "rootView高度: " + rootView.getHeight());
                    Log.d("ScreenInfo", "状态栏高度(估算): " + visibleFrame.top);
                }
                return; // 首次布局不处理键盘
            }

            //如果处于某种情况导致 visibleFrame.height()小了一点，那么就让初始值变为visibleFrame.height()值
            if(initialHeight[0] - currentHeight> -50 && initialHeight[0] - currentHeight< 50){
                initialHeight[0] = currentHeight;
            }

            // 计算键盘高度 = 初始高度 - 当前可见高度
            int keyboardHeight = initialHeight[0] - currentHeight;


            Log.d("KeyboardAnimation", "initialHeight=" + initialHeight[0] + ", currentHeight=" + currentHeight + ", keyboardHeight=" + keyboardHeight + ", diff=" + (initialHeight[0] - currentHeight));

            // 过滤掉小的变化（降低阈值以更灵敏响应）
            if (Math.abs(keyboardHeight - lastKeyboardHeight) < 30) {
                return;
            }

            // 确保 keyboardHeight 不为负数
            if (keyboardHeight < 0) {
                keyboardHeight = 0;
            }

            // 转换为 CSS 像素并传给 WebView（由 JS 处理容器上移）
            float density = getResources().getDisplayMetrics().density;
            int keyboardHeightCss = (int) (keyboardHeight / density);
            Log.d("键盘高度","键盘高度"+keyboardHeight);
            notifyWebViewKeyboardHeight(keyboardHeightCss);
            lastKeyboardHeight = keyboardHeight;

            // 同步移动广告View（平滑动画）
            if (mFeedAdView != null && mFeedAdBaseY != 0) {
                int fromY = ((FrameLayout.LayoutParams) mFeedAdView.getLayoutParams()).topMargin;
                    int adHeight = (keyboardHeight > 0 && mFeedAdView.getHeight() > 0) ? mFeedAdView.getHeight() : 0;
                    int toY = Math.max(0, mFeedAdBaseY - keyboardHeight - adHeight);
                if (fromY != toY) {
                    android.animation.ValueAnimator anim = android.animation.ValueAnimator.ofInt(fromY, toY);
                    anim.setDuration(180);
                    anim.setInterpolator(new android.view.animation.DecelerateInterpolator());
                    anim.addUpdateListener(a -> {
                        if (mFeedAdView != null) {
                            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) mFeedAdView.getLayoutParams();
                            lp.topMargin = (int) a.getAnimatedValue();
                            mFeedAdView.setLayoutParams(lp);
                        }
                    });
                    anim.start();
                }
            }
        });
    }

    // 通知 WebView 键盘高度（CSS 像素）
    private void notifyWebViewKeyboardHeight(final int keyboardHeightCss) {
        runOnUiThread(() -> {
            String jsCode = String.format(
                "if (typeof window.onKeyboardHeightChange === 'function') { window.onKeyboardHeightChange(%d); }",
                keyboardHeightCss
            );
            webView.evaluateJavascript(jsCode, null);
            Log.d("KeyboardAnimation", "通知WebView键盘高度: " + keyboardHeightCss + " CSS像素");
        });
    }

    // 打开文件选择器
    // 构建按修改时间倒序排序的 QueryArgs（API 26+）
    private android.os.Bundle getSortByDateDescArgs() {
        android.os.Bundle queryArgs = new android.os.Bundle();
        queryArgs.putStringArray("android:query-arg-sort-columns", new String[]{"last_modified"});
        queryArgs.putInt("android:query-arg-sort-direction", 1); // DESCENDING = 1
        return queryArgs;
    }

    private void openFileChooserInternal() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.putExtra("android.provider.action.EXTRA_QUERY_ARGS", getSortByDateDescArgs());
            intent.putExtra("android.provider.extra.INITIAL_URI", android.provider.DocumentsContract.buildDocumentUri("com.android.providers.downloads.documents", "downloads"));
        }
        try {
            startActivityForResult(Intent.createChooser(intent, "选择聊天记录文件"), FILE_CHOOSER_REQUEST_CODE);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
        }
    }

    // 打开图片选择器（直接打开相册）
    private void openImageChooserInternal() {
        Intent intent = new Intent(Intent.ACTION_PICK, android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        intent.setType("image/*");
        try {
            startActivityForResult(Intent.createChooser(intent, "选择图片"), IMAGE_CHOOSER_REQUEST_CODE);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "无法打开图片选择器", Toast.LENGTH_SHORT).show();
        }
    }

    // 打开压缩图片选择器（直接打开相册）
    private void openCompressImageChooserInternal() {
        Intent intent = new Intent(Intent.ACTION_PICK, android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        intent.setType("image/*");
        try {
            startActivityForResult(Intent.createChooser(intent, "选择要压缩的图片"), COMPRESS_IMAGE_REQUEST_CODE);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "无法打开图片选择器", Toast.LENGTH_SHORT).show();
        }
    }

    // 打开上传文件选择器（定位到文档分类）
    private void openUploadFileChooserInternal() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        // 支持多种文件类型
        intent.setType("*/*");
        String[] mimeTypes = {
            "text/plain", "text/markdown", "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword", "application/json", "text/csv",
            "application/xml", "text/html", "text/css",
            "application/javascript", "text/x-python", "text/x-java-source",
            "text/x-c", "text/x-c++", "text/x-go",
            "application/x-yaml", "text/yaml"
        };
        intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.putExtra("android.provider.action.EXTRA_QUERY_ARGS", getSortByDateDescArgs());
            intent.putExtra("android.provider.extra.INITIAL_URI", android.provider.DocumentsContract.buildDocumentUri("com.android.providers.downloads.documents", "downloads"));
        }
        try {
            startActivityForResult(Intent.createChooser(intent, "选择文件"), UPLOAD_FILE_REQUEST_CODE);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
        }
    }

    // 打开电脑文件传输选择器（支持所有文件类型）
    private void openPCFileChooserInternal() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true); // 允许多选
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.putExtra("android.provider.action.EXTRA_QUERY_ARGS", getSortByDateDescArgs());
        }
        try {
            startActivityForResult(Intent.createChooser(intent, "选择文件发送到电脑"), PC_FILE_TRANSFER_REQUEST_CODE);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
        }
    }

    // 打开知识库文件选择器（定位到文档分类）
    private void openKnowledgeFileChooserInternal() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        // 支持知识库文档类型
        intent.setType("*/*");
        String[] mimeTypes = {
            "text/plain", "text/markdown", "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword", "application/json", "text/csv"
        };
        intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true); // 允许多选
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.putExtra("android.provider.action.EXTRA_QUERY_ARGS", getSortByDateDescArgs());
            intent.putExtra("android.provider.extra.INITIAL_URI", android.provider.DocumentsContract.buildDocumentUri("com.android.providers.downloads.documents", "downloads"));
        }
        try {
            startActivityForResult(Intent.createChooser(intent, "选择知识库文档"), KNOWLEDGE_FILE_REQUEST_CODE);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
        }
    }

    // 保存文件到 Downloads 目录
    private void saveToFileInternal(String fileName, String jsonContent) {
        try {
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File file = new File(downloadsDir, fileName);

            // 如果文件已存在，添加序号
            int count = 1;
            String baseName = fileName.replace(".json", "");
            while (file.exists()) {
                file = new File(downloadsDir, baseName + "_" + count + ".json");
                count++;
            }

            FileOutputStream fos = new FileOutputStream(file);
            fos.write(jsonContent.getBytes("UTF-8"));
            fos.close();

            final String filePath = file.getAbsolutePath();
            
            // 通知媒体扫描器，让文件出现在"最近"列表中
            android.media.MediaScannerConnection.scanFile(
                MainActivity.this,
                new String[]{filePath},
                null,
                null
            );

            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "已保存到: " + filePath, Toast.LENGTH_LONG).show();
            });
        } catch (Exception e) {
            e.printStackTrace();
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "保存失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            });
        }
    }

    // 保存图片到 Pictures 目录
    private void saveImageToFileInternal(String fileName, String base64Data) {
        try {
            // 去掉 data URL 前缀（如 "data:image/jpeg;base64,"）
            String base64 = base64Data;
            if (base64.contains(",")) {
                base64 = base64.substring(base64.indexOf(",") + 1);
            }

            // 解码 base64
            byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);

            File picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
            File file = new File(picturesDir, fileName);

            // 如果文件已存在，添加序号
            int count = 1;
            String baseName = fileName;
            String extension = "";
            int dotIndex = fileName.lastIndexOf(".");
            if (dotIndex > 0) {
                baseName = fileName.substring(0, dotIndex);
                extension = fileName.substring(dotIndex);
            }
            while (file.exists()) {
                file = new File(picturesDir, baseName + "_" + count + extension);
                count++;
            }

            FileOutputStream fos = new FileOutputStream(file);
            fos.write(bytes);
            fos.close();

            final String filePath = file.getAbsolutePath();
            
            // 通知媒体扫描器扫描文件，让相册/最近项目能看到
            try {
                Intent mediaScanIntent = new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE);
                mediaScanIntent.setData(Uri.fromFile(file));
                sendBroadcast(mediaScanIntent);
            } catch (Exception e) {
                e.printStackTrace();
            }

            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "已保存到: " + filePath, Toast.LENGTH_LONG).show();
            });
        } catch (Exception e) {
            e.printStackTrace();
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "保存失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            });
        }
    }

    // 标记是否是保存图片的请求
    private boolean isSaveImageRequest = false;

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == STORAGE_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // 权限授予成功
                if (pendingImportAction) {
                    openFileChooserInternal();
                } else if (pendingExportData != null && pendingExportFileName != null) {
                    if (isSaveImageRequest) {
                        saveImageToFileInternal(pendingExportFileName, pendingExportData);
                    } else {
                        saveToFileInternal(pendingExportFileName, pendingExportData);
                    }
                }
            } else {
                // 权限被拒绝
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "需要存储权限才能使用此功能", Toast.LENGTH_SHORT).show();
                });
            }
            // 重置待处理状态
            pendingImportAction = false;
            pendingExportData = null;
            pendingExportFileName = null;
            isSaveImageRequest = false;
        }

        if (requestCode == AD_PERMISSION_REQUEST_CODE) {
            // 通知 Web 端隐藏权限说明
            runOnUiThread(() -> {
                webView.evaluateJavascript(
                    "if (typeof window.onPermissionRequestComplete === 'function') { window.onPermissionRequestComplete(); }",
                    null
                );
            });
            
            // 清空待处理权限
            pendingPermissionRequest = null;
            
            // Android 11+ 需要额外申请所有文件访问权限（用于笔记功能）
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                if (!Environment.isExternalStorageManager()) {
                    try {
                        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    } catch (Exception e) {
                        Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                        startActivity(intent);
                    }
                }
            }
            
            // 无论权限是否全部授予，都继续初始化 SDK
            Log.d("AdSdk", "权限申请完成，继续初始化广告 SDK");
            initAdSdkInternal();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // 调用 JS 的返回键处理逻辑（关闭弹窗或退出应用）
            webView.evaluateJavascript(
                "if (typeof handleBackButton === 'function') { handleBackButton(); }",
                null
            );
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) {
                try {
                    InputStream inputStream = getContentResolver().openInputStream(uri);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, "UTF-8"));
                    StringBuilder stringBuilder = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        stringBuilder.append(line);
                    }
                    reader.close();
                    inputStream.close();

                    final String jsonContent = stringBuilder.toString();
                    final boolean restoreMode = isRestoreDataMode;
                    isRestoreDataMode = false; // 重置标志
                    runOnUiThread(() -> {
                        // 将内容转义为安全的 JS 字符串，支持加密备份和明文备份
                        String escapedContent = jsonContent
                            .replace("\\", "\\\\")
                            .replace("\"", "\\\"")
                            .replace("\n", "\\n")
                            .replace("\r", "\\r")
                            .replace("\t", "\\t");
                        // 根据模式调用不同的 JavaScript 函数
                        if (restoreMode) {
                            webView.evaluateJavascript(
                                    "if (typeof handleAndroidRestoreData === 'function') { handleAndroidRestoreData(\"" + escapedContent + "\"); }",
                                    null
                            );
                        } else {
                            webView.evaluateJavascript(
                                    "if (typeof importChatData === 'function') { importChatData(\"" + escapedContent + "\"); }",
                                    null
                            );
                        }
                    });
                } catch (Exception e) {
                    e.printStackTrace();
                    isRestoreDataMode = false;
                    runOnUiThread(() -> {
                        webView.evaluateJavascript(
                                "if (typeof showToast === 'function') { showToast('读取文件失败'); }",
                                null
                        );
                    });
                }
            }
        }

        // 处理图片选择结果
        if (requestCode == IMAGE_CHOOSER_REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) {
                try {
                    InputStream inputStream = getContentResolver().openInputStream(uri);
                    // 读取图片字节
                    byte[] bytes = new byte[inputStream.available()];
                    inputStream.read(bytes);
                    inputStream.close();

                    // 转换为 base64
                    String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);

                    // 获取 MIME 类型
                    String mimeType = getContentResolver().getType(uri);
                    if (mimeType == null) {
                        mimeType = "image/jpeg"; // 默认
                    }

                    // 构建 data URL
                    final String dataUrl = "data:" + mimeType + ";base64," + base64;

                    runOnUiThread(() -> {
                        // 调用 JavaScript 函数处理图片
                        webView.evaluateJavascript(
                                "if (typeof handleAndroidImageSelected === 'function') { handleAndroidImageSelected('" + dataUrl + "'); }",
                                null
                        );
                    });
                } catch (Exception e) {
                    e.printStackTrace();
                    runOnUiThread(() -> {
                        webView.evaluateJavascript(
                                "if (typeof showToast === 'function') { showToast('读取图片失败'); }",
                                null
                        );
                    });
                }
            }
        }

        // 处理压缩图片选择结果
        if (requestCode == COMPRESS_IMAGE_REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) {
                try {
                    InputStream inputStream = getContentResolver().openInputStream(uri);
                    // 读取图片字节
                    byte[] bytes = new byte[inputStream.available()];
                    inputStream.read(bytes);
                    inputStream.close();

                    // 转换为 base64
                    String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);

                    // 获取 MIME 类型
                    String mimeType = getContentResolver().getType(uri);
                    if (mimeType == null) {
                        mimeType = "image/jpeg"; // 默认
                    }

                    // 构建 data URL
                    final String dataUrl = "data:" + mimeType + ";base64," + base64;

                    runOnUiThread(() -> {
                        // 调用 JavaScript 函数处理压缩图片
                        webView.evaluateJavascript(
                                "if (typeof handleAndroidCompressImageSelected === 'function') { handleAndroidCompressImageSelected('" + dataUrl + "'); }",
                                null
                        );
                    });
                } catch (Exception e) {
                    e.printStackTrace();
                    runOnUiThread(() -> {
                        webView.evaluateJavascript(
                                "if (typeof showToast === 'function') { showToast('读取图片失败'); }",
                                null
                        );
                    });
                }
            }
        }

        // 处理上传文件选择结果
        if (requestCode == UPLOAD_FILE_REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) {
                try {
                    InputStream inputStream = getContentResolver().openInputStream(uri);
                    // 读取文件字节
                    byte[] bytes = new byte[inputStream.available()];
                    inputStream.read(bytes);
                    inputStream.close();

                    // 转换为 base64
                    String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);

                    // 获取文件名
                    String fileName = "file";
                    String mimeType = getContentResolver().getType(uri);
                    if (mimeType == null) {
                        mimeType = "application/octet-stream";
                    }
                    
                    // 尝试从 URI 获取文件名
                    android.database.Cursor cursor = getContentResolver().query(uri, null, null, null, null);
                    if (cursor != null && cursor.moveToFirst()) {
                        int nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                        if (nameIndex >= 0) {
                            fileName = cursor.getString(nameIndex);
                        }
                        cursor.close();
                    }

                    // 构建 JSON 对象
                    final String jsonData = "{\"name\":\"" + fileName.replace("\"", "\\\"") + "\",\"mimeType\":\"" + mimeType + "\",\"base64\":\"" + base64 + "\"}";

                    runOnUiThread(() -> {
                        // 调用 JavaScript 函数处理文件
                        webView.evaluateJavascript(
                                "if (typeof handleAndroidFileSelected === 'function') { handleAndroidFileSelected(" + jsonData + "); }",
                                null
                        );
                    });
                } catch (Exception e) {
                    e.printStackTrace();
                    runOnUiThread(() -> {
                        webView.evaluateJavascript(
                                "if (typeof showToast === 'function') { showToast('读取文件失败'); }",
                                null
                        );
                    });
                }
            }
        }

        // 处理电脑文件传输选择结果（Java层直接通过WebSocket发送，不经过WebView）
        if (requestCode == PC_FILE_TRANSFER_REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            // 收集所有文件URI
            java.util.List<Uri> fileUris = new java.util.ArrayList<>();
            if (data.getClipData() != null) {
                android.content.ClipData clipData = data.getClipData();
                for (int i = 0; i < clipData.getItemCount(); i++) {
                    fileUris.add(clipData.getItemAt(i).getUri());
                }
            } else {
                Uri uri = data.getData();
                if (uri != null) fileUris.add(uri);
            }
            // 逐个发送，避免并发连接超出服务端限制
            sendFilesToPCSequentially(fileUris);
        }

        // 处理知识库文件选择结果
        if (requestCode == KNOWLEDGE_FILE_REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            android.util.JsonWriter jsonWriter = null;
            java.io.StringWriter stringWriter = new java.io.StringWriter();
            try {
                jsonWriter = new android.util.JsonWriter(stringWriter);
                jsonWriter.beginArray();

                // 检查是否是多选
                if (data.getClipData() != null) {
                    // 多选模式
                    android.content.ClipData clipData = data.getClipData();
                    for (int i = 0; i < clipData.getItemCount(); i++) {
                        Uri uri = clipData.getItemAt(i).getUri();
                        processKnowledgeFile(uri, jsonWriter);
                    }
                } else if (data.getData() != null) {
                    // 单选模式
                    Uri uri = data.getData();
                    processKnowledgeFile(uri, jsonWriter);
                }

                jsonWriter.endArray();
                jsonWriter.close();
                jsonWriter = null;

                final String jsonArray = stringWriter.toString();
                // 暂存数据，让 JS 主动拉取（避免 evaluateJavascript 超长字符串问题）
                pendingKnowledgeFilesData = jsonArray;
                runOnUiThread(() -> {
                    webView.evaluateJavascript(
                            "if (typeof handleAndroidKnowledgeFilesReady === 'function') { handleAndroidKnowledgeFilesReady(); } else { console.error('handleAndroidKnowledgeFilesReady 函数不存在'); }",
                            null
                    );
                });
            } catch (Exception e) {
                e.printStackTrace();
                try {
                    if (jsonWriter != null) jsonWriter.close();
                } catch (Exception ignored) {}
                runOnUiThread(() -> {
                    webView.evaluateJavascript(
                            "if (typeof showToast === 'function') { showToast('读取文件失败'); }",
                            null
                    );
                });
            }
        }
    }

    // 处理单个知识库文件
    private void processKnowledgeFile(Uri uri, android.util.JsonWriter jsonWriter) throws Exception {
        // 正确读取完整文件内容（不使用 available()，因为它可能返回0或不完整）
        InputStream inputStream = getContentResolver().openInputStream(uri);
        java.io.ByteArrayOutputStream outputStream = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int bytesRead;
        while ((bytesRead = inputStream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, bytesRead);
        }
        inputStream.close();
        byte[] bytes = outputStream.toByteArray();

        String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);

        String fileName = "file";
        String mimeType = getContentResolver().getType(uri);
        if (mimeType == null) {
            mimeType = "application/octet-stream";
        }

        android.database.Cursor cursor = getContentResolver().query(uri, null, null, null, null);
        if (cursor != null && cursor.moveToFirst()) {
            int nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
            if (nameIndex >= 0) {
                fileName = cursor.getString(nameIndex);
            }
            cursor.close();
        }

        jsonWriter.beginObject();
        jsonWriter.name("name").value(fileName);
        jsonWriter.name("mimeType").value(mimeType);
        jsonWriter.name("size").value(bytes.length);
        jsonWriter.name("base64").value(base64);
        jsonWriter.endObject();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        // 取消所有正在进行的异步 HTTP 请求
        for (Map.Entry<String, Call> entry : pendingHttpCalls.entrySet()) {
            if (!entry.getValue().isCanceled()) entry.getValue().cancel();
        }
        pendingHttpCalls.clear();
        cancelledCallbacks.clear();
        if (embeddingGenerator != null) {
            embeddingGenerator.close();
        }
        if (webView != null) {
            webView.destroy();
        }
        // 销毁开屏广告（穿山甲）
        if (mSplashContainer != null) {
            mSplashContainer.removeAllViews();
        }
        mCsjSplashAd = null;
        // GDT 插屏广告已停用
        /*
        if (mInterstitialAd != null) {
            mInterstitialAd.destroy();
            mInterstitialAd = null;
        }
        */
        // 销毁信息流广告
        destroyFeedAdInternal();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // 检测屏幕方向变化并更新状态栏显示
        updateStatusBarVisibility();

        // 屏幕方向变化时重置键盘高度基准，避免误判
        initialHeight[0] = 0;
        lastKeyboardHeight = 0;
        // 通知 WebView 键盘高度归零，恢复容器位置
        notifyWebViewKeyboardHeight(0);

        // 通知 WebView 屏幕方向变化
        int orientation = newConfig.orientation;
        boolean isLandscape = (orientation == Configuration.ORIENTATION_LANDSCAPE);
        if (isLandscape) {
            userRotatedToLandscape = 1;
        }
        notifyWebViewOrientationChange(isLandscape);
    }

    /**
     * 通知 WebView 屏幕方向变化
     * @param isLandscape true 表示横屏，false 表示竖屏
     */
    private void notifyWebViewOrientationChange(final boolean isLandscape) {
        // 只有用户主动旋转到横屏后才通知WebView隐藏标题栏
        if (isLandscape && userRotatedToLandscape == 0) {
            Log.d("Orientation", "非用户主动旋转，跳过横屏通知");
            return;
        }
        runOnUiThread(() -> {
            String jsCode = String.format(
                "if (typeof window.onOrientationChange === 'function') { window.onOrientationChange(%b); }",
                isLandscape
            );
            webView.evaluateJavascript(jsCode, null);
            Log.d("Orientation", "通知WebView屏幕方向变化: " + (isLandscape ? "横屏" : "竖屏"));
        });
    }

    /**
     * 根据屏幕方向更新状态栏显示状态
     * 横屏时隐藏状态栏，竖屏时显示状态栏
     */
    private void updateStatusBarVisibility() {
        int orientation = getResources().getConfiguration().orientation;
        if (orientation == Configuration.ORIENTATION_LANDSCAPE) {
            // 横屏模式：隐藏状态栏
            hideStatusBarInternal();
        } else {
            // 竖屏模式：显示状态栏
            showStatusBarInternal();
        }
    }

    /**
     * 内部方法：隐藏状态栏（沉浸式全屏模式）
     * 横屏时让内容延伸到刘海/挖孔区域
     */
    private void hideStatusBarInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            int flags = View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
        // 确保横屏时刘海/挖孔区域被内容填充
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
    }

    /**
     * 内部方法：显示状态栏
     */
    private void applyStatusBarAppearance(String color) {
        int parsedColor = Color.parseColor(color);
        double luminance = (0.299 * Color.red(parsedColor) + 0.587 * Color.green(parsedColor) + 0.114 * Color.blue(parsedColor)) / 255.0;
        boolean isLight = luminance > 0.5;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().getInsetsController().setSystemBarsAppearance(
                isLight ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
            );
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            View decorView = getWindow().getDecorView();
            int flags = decorView.getSystemUiVisibility();
            if (isLight) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            } else {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            decorView.setSystemUiVisibility(flags);
        }
    }

    private void showStatusBarInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
        // 状态栏永远透明
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
        }
        applyStatusBarAppearance(currentThemeColor);
    }

    /**
     * 内部方法：初始化广告 SDK（GDT 已停用，仅穿山甲）
     * 参考 demo 做法：同步检查一次，不 ready 就直接放弃
     */
    private void initAdSdkInternal() {
        // 隐私合规：用户未同意隐私政策前，不初始化广告SDK
        SharedPreferences prefs = getSharedPreferences(CNAIChatApplication.AD_PREFS_NAME, MODE_PRIVATE);
        if (!prefs.getBoolean("privacy_agreed", false)) {
            Log.d("AdSdk", "用户未同意隐私政策，跳过广告SDK初始化");
            return;
        }

        // 防止重复初始化
        if (isAdSdkInitialized) {
            checkAdSdkAndProceed();
            return;
        }

        // 设置 SDK 初始化成功回调
        CNAIChatApplication.setAdSdkInitCallback(new CNAIChatApplication.AdSdkInitCallback() {
            @Override
            public void onAdSdkInitSuccess() {
                // SDK 初始化成功，继续后续流程
                checkAdSdkAndProceed();
            }
        });

        // 如果 SDK 还没初始化，先初始化
        if (!CNAIChatApplication.isAdSdkReady()) {
            Log.d("AdSdk", "广告SDK未初始化，开始初始化");
            CNAIChatApplication.initAdSdk();
        } else {
            // SDK 已经初始化了，直接继续
            checkAdSdkAndProceed();
        }
    }

    /**
     * 检查广告 SDK 是否就绪并继续后续流程
     */
    private void checkAdSdkAndProceed() {
        if (CNAIChatApplication.isAdSdkReady()) {
            Log.d("AdSdk", "广告SDK已就绪");
            isAdSdkInitialized = true;
            runOnUiThread(() -> {
                webView.evaluateJavascript(
                    "if (typeof window.onAdSdkReady === 'function') { window.onAdSdkReady(); }",
                    null
                );
                
                // requestAdPermissionNow 触发的跳过开屏广告（含预加载）
                if (mFromRequestAdPermission) {
                    Log.d("AdSdk", "来自用户消息触发，跳过开屏广告");
                    mFromRequestAdPermission = false;
                    return;
                }

                // SDK就绪后，通知JS可以加载信息流广告
                    webView.evaluateJavascript(
                        "if(typeof window.onFeedAdSdkReady==='function'){window.onFeedAdSdkReady();}",
                        null
                    );

                // 开屏广告已由穿山甲 SDK 回调独立驱动，此处不再调用
            });
        } else {
            Log.d("AdSdk", "广告SDK未就绪，跳过开屏广告");
        }
    }

    /**
     * 从服务器拉取广告配置
     */
    private void fetchAdConfig() {
        new Thread(() -> {
            HttpURLConnection connection = null;
            BufferedReader reader = null;
            try {
                URL url = new URL(AD_CONFIG_URL);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(500);
                connection.setReadTimeout(500);
                
                int responseCode = connection.getResponseCode();
                if (responseCode == HttpURLConnection.HTTP_OK) {
                    reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
                    StringBuilder response = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        response.append(line);
                    }
                    
                    // 简单解析 JSON（实际项目建议使用 Gson）
                    String json = response.toString();
                    mAdConfig.ad_enabled = !json.contains("\"ad_enabled\": false");
                    mAdConfig.splash_ad_enabled = !json.contains("\"splash_ad_enabled\": false");
                    mAdConfig.banner_ad_enabled = json.contains("\"banner_ad_enabled\": true");
                    mAdConfig.interstitial_ad_enabled = !json.contains("\"interstitial_ad_enabled\": false");  // 默认开启
                    // 激励广告已停用，不再解析
                    /*
                    mAdConfig.rewarded_ad_enabled = json.contains("\"rewarded_ad_enabled\": true");
                    try {
                        String rewardedKey = "\"rewarded_ad_code_id\":";
                        int idx = json.indexOf(rewardedKey);
                        if (idx >= 0) {
                            int start = idx + rewardedKey.length();
                            while (start < json.length() && json.charAt(start) == ' ') start++;
                            if (start < json.length() && json.charAt(start) == '"') {
                                start++;
                                int end = json.indexOf('"', start);
                                if (end > start) {
                                    mAdConfig.rewarded_ad_code_id = json.substring(start, end);
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e("AdSdk", "解析激励广告代码位失败: " + e.getMessage());
                    }
                    */

                    // 解析广告间隔时间（单位：毫秒）
                    try {
                        // 简单的字符串查找和解析
                        String intervalKey = "\"splash_ad_interval_ms\":";
                        int intervalIndex = json.indexOf(intervalKey);
                        if (intervalIndex >= 0) {
                            int startIndex = intervalIndex + intervalKey.length();
                            int endIndex = json.indexOf(',', startIndex);
                            if (endIndex < 0) {
                                endIndex = json.indexOf('}', startIndex);
                            }
                            if (endIndex > startIndex) {
                                String intervalStr = json.substring(startIndex, endIndex).trim();
                                // 先尝试解析为double，支持浮点数
                                double intervalDouble = Double.parseDouble(intervalStr);
                                // 转换为long，至少1毫秒
                                mAdConfig.splash_ad_interval_ms = Math.max(1, (long) intervalDouble);
                            }
                        }
                    } catch (Exception e) {
                        Log.e("AdSdk", "解析广告间隔时间失败，使用默认值: " + e.getMessage());
                        mAdConfig.splash_ad_interval_ms = 3600000; // 解析失败时默认1小时
                    }

                    // 解析免广告密码 adps
                    try {
                        String adpsKey = "\"adps\":";
                        int adpsIdx = json.indexOf(adpsKey);
                        if (adpsIdx >= 0) {
                            int adpsStart = adpsIdx + adpsKey.length();
                            while (adpsStart < json.length() && json.charAt(adpsStart) == ' ') adpsStart++;
                            if (adpsStart < json.length() && json.charAt(adpsStart) == '"') {
                                adpsStart++;
                                int adpsEnd = json.indexOf('"', adpsStart);
                                if (adpsEnd > adpsStart) {
                                    mAdConfig.adps = json.substring(adpsStart, adpsEnd);
                                    Log.d("AdSdk", "已解析免广告密码: " + mAdConfig.adps);
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e("AdSdk", "解析免广告密码失败: " + e.getMessage());
                    }

                    Log.d("AdSdk", "广告配置拉取成功: ad_enabled=" + mAdConfig.ad_enabled +
                          ", splash_ad_enabled=" + mAdConfig.splash_ad_enabled +
                          ", splash_ad_interval_ms=" + mAdConfig.splash_ad_interval_ms);

                    // 保存配置到本地，供下次启动时使用
                    SharedPreferences adPrefs = getSharedPreferences(CNAIChatApplication.AD_PREFS_NAME, MODE_PRIVATE);
                    adPrefs.edit()
                            .putBoolean("ad_enabled", mAdConfig.ad_enabled)
                            .putBoolean("splash_ad_enabled", mAdConfig.splash_ad_enabled)
                            .putBoolean("banner_ad_enabled", mAdConfig.banner_ad_enabled)
                            .putBoolean("interstitial_ad_enabled", mAdConfig.interstitial_ad_enabled)
                            .putLong("splash_ad_interval_ms", mAdConfig.splash_ad_interval_ms)
                            .putString("adps", mAdConfig.adps)
                            .apply();
                    Log.d("AdSdk", "广告配置已保存到本地，供下次启动使用");
                }
            } catch (Exception e) {
                Log.e("AdSdk", "拉取广告配置失败: " + e.getMessage());
            } finally {
                try {
                    if (reader != null) reader.close();
                    if (connection != null) connection.disconnect();
                } catch (Exception e) {
                    // ignore
                }
            }
            runOnUiThread(() -> {
                if (!mAdConfig.ad_enabled) {
                    // 服务器配置关闭了广告，不初始化 SDK
                    Log.d("AdSdk", "服务器配置 ad_enabled=false，跳过广告SDK初始化");
                    return;
                }
                if (shouldDeferAdPermission) {
                    // 延迟模式，只初始化 SDK 不申请权限
                    Log.d("AdSdk", "延迟模式，只初始化 SDK 不申请权限");
                    initAdSdkInternal();
                } else if (isActivityInForeground) {
                    // 正常模式，申请权限
                    requestAdPermissions();
                } else {
                    Log.d("AdSdk", "App不在前台，延迟广告SDK初始化到下次onResume");
                    isAdSdkPendingInit = true;
                }
            });
        }).start();
    }

    /**
     * 加载并展示开屏广告（穿山甲 CSJ）
     */
    private void loadAndShowSplashAd() {
        loadAndShowSplashAd(0);
    }

    private void loadAndShowSplashAd(int retryCount) {
        SharedPreferences prefs = getSharedPreferences("cnaichat_prefs", MODE_PRIVATE);
        SharedPreferences adPrefs = getSharedPreferences(CNAIChatApplication.AD_PREFS_NAME, MODE_PRIVATE);

        if (!CNAIChatApplication.isCsjAdSdkReady()) {
            if (retryCount < 2) {
                Log.w("AdSdk", "穿山甲 SDK 未就绪，2秒后重试 (" + (retryCount + 1) + "/2)");
                webView.postDelayed(() -> loadAndShowSplashAd(retryCount + 1), 2000);
                return;
            }
            Log.w("AdSdk", "穿山甲 SDK 未就绪，已重试2次，放弃开屏广告");
            hideSplashContainer();
            return;
        }

        boolean isFirstLaunch = prefs.getBoolean("is_first_launch", true);
        if (isFirstLaunch) {
            Log.w("AdSdk", "首次启动，跳过开屏广告");
            prefs.edit().putBoolean("is_first_launch", false).apply();
            prefs.edit().putLong("last_ad_open_time", System.currentTimeMillis()).apply();
            hideSplashContainer();
            return;
        }

        // 从本地读取上次保存的广告配置
        long splashInterval = adPrefs.getLong("splash_ad_interval_ms", 3600000); // 默认1小时
        long lastOpenTime = prefs.getLong("last_ad_open_time", 0);
        long currentTime = System.currentTimeMillis();
        if ((currentTime - lastOpenTime) < splashInterval) {
            Log.w("AdSdk", "距离上次打开未满间隔，跳过开屏广告");
            notifySplashAdCheckComplete(false);
            return;
        }

        boolean adEnabled = adPrefs.getBoolean("ad_enabled", false);
        boolean splashAdEnabled = adPrefs.getBoolean("splash_ad_enabled", false);
        if (!adEnabled || !splashAdEnabled) {
            Log.w("AdSdk", "配置关闭了广告，跳过开屏广告");
            hideSplashContainer();
            return;
        }

        prefs.edit().putLong("last_ad_open_time", System.currentTimeMillis()).apply();
        Log.d("AdSdk", "开始加载穿山甲开屏广告，代码位: " + CSJ_SPLASH_AD_CODE_ID);

        // 获取屏幕尺寸
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int width = dm.widthPixels;
        int height = dm.heightPixels;

        TTAdNative adNative = TTAdSdk.getAdManager().createAdNative(this);
        AdSlot adSlot = new AdSlot.Builder()
                .setCodeId(CSJ_SPLASH_AD_CODE_ID)
                .setImageAcceptedSize(width, height)
                .build();

        adNative.loadSplashAd(adSlot, new TTAdNative.CSJSplashAdListener() {
            @Override
            public void onSplashLoadSuccess(CSJSplashAd ad) {
                Log.d("AdSdk", "穿山甲开屏广告加载成功");
            }

            @Override
            public void onSplashLoadFail(CSJAdError error) {
                Log.e("AdSdk", "穿山甲开屏广告加载失败，code: " + error.getCode() + ", msg: " + error.getMsg());
                hideSplashContainer();
            }

            @Override
            public void onSplashRenderSuccess(CSJSplashAd ad) {
                Log.d("AdSdk", "穿山甲开屏广告渲染成功");
                mCsjSplashAd = ad;
                mCsjSplashAd.setSplashAdListener(new CSJSplashAd.SplashAdListener() {
                    @Override
                    public void onSplashAdShow(CSJSplashAd ad) {
                        Log.d("AdSdk", "穿山甲开屏广告展示");
                    }

                    @Override
                    public void onSplashAdClick(CSJSplashAd ad) {
                        Log.d("AdSdk", "穿山甲开屏广告被点击");
                    }

                    @Override
                    public void onSplashAdClose(CSJSplashAd ad, int closeType) {
                        Log.d("AdSdk", "穿山甲开屏广告关闭，closeType: " + closeType);
                        hideSplashContainer();
                    }
                });
                // 广告渲染成功后淡入显示
                mSplashContainer.setAlpha(0f);
                mSplashContainer.setVisibility(View.VISIBLE);
                mSplashContainer.animate().alpha(1f).setDuration(300).start();
                mCsjSplashAd.showSplashView(mSplashContainer);
                notifySplashAdCheckComplete(true);
            }

            @Override
            public void onSplashRenderFail(CSJSplashAd ad, CSJAdError error) {
                Log.e("AdSdk", "穿山甲开屏广告渲染失败，code: " + error.getCode() + ", msg: " + error.getMsg());
                hideSplashContainer();
            }
        }, 3500);
    }

    /**
     * 通知 Web 端开屏广告检测完成
     * @param willShowAd 是否会显示广告
     */
    private void notifySplashAdCheckComplete(boolean willShowAd) {
        // 延迟通知，确保开屏动画加载完成
        webView.postDelayed(() -> {
            if (webView != null) {
                String jsCode = String.format(
                    "if (typeof window.onSplashAdCheckComplete === 'function') { window.onSplashAdCheckComplete(%b); }",
                    willShowAd
                );
                webView.evaluateJavascript(jsCode, null);
                Log.d("AdSdk", "通知 Web 端开屏广告检测完成，willShowAd=" + willShowAd);
            }
        }, 50);
    }

    /**
     * 隐藏开屏广告容器，显示 WebView
     */
    private void hideSplashContainer() {
        runOnUiThread(() -> {
            if (mSplashContainer != null && mSplashContainer.getVisibility() == View.VISIBLE) {
                // 淡出动画
                mSplashContainer.animate()
                    .alpha(0f)
                    .setDuration(500)
                    .withEndAction(() -> {
                        mSplashContainer.removeAllViews();
                        mSplashContainer.setVisibility(View.GONE);
                        mSplashContainer.setAlpha(1f);
                        Log.d("AdSdk", "开屏广告容器淡出完成，已隐藏并清除内容");
                    })
                    .start();
            } else if (mSplashContainer != null) {
                mSplashContainer.removeAllViews();
                mSplashContainer.setVisibility(View.GONE);
            }

            // 强制刷新 WebView 布局，修复广告关闭后标题栏消失的问题
            //if (webView != null) {
            //    webView.requestLayout();
            //    // 通知 JS 端刷新标题栏位置
            //    webView.postDelayed(() -> {
            //        webView.evaluateJavascript(
            //            "if (typeof updateContainerMarginTop === 'function') { updateContainerMarginTop(); }",
            //            null
            //        );
            //    }, 100);
            //}

            // 销毁穿山甲开屏广告实例
            mCsjSplashAd = null;
            Log.d("AdSdk", "穿山甲开屏广告实例已销毁");

            // 重置预加载状态
            isSplashAdLoaded = false;
            isSplashAdLoading = false;

            // 通知 Web 端广告检测完成
            notifySplashAdCheckComplete(false);
        });
    }

    /* ====== 激励广告 + buildInterstitialAdSlot（已停用）======

    private void loadRewardedAd(boolean shouldShowAfterLoad) {
        if (mAdConfig.rewarded_ad_code_id == null || mAdConfig.rewarded_ad_code_id.isEmpty()) {
            Log.d("AdSdk", "激励广告代码位未配置");
            return;
        }
        if (!TTAdSdk.isSdkReady()) {
            Log.d("AdSdk", "广告SDK未就绪，无法加载激励广告");
            return;
        }

        isRewardedAdLoading = true;
        hasShownRewardedAd = false;  // 重置展示标志
        hasNotifiedAdResult = false;  // 重置通知标志
        shouldShowAdAfterLoad = shouldShowAfterLoad;  // 设置是否加载后自动展示
        Log.d("AdSdk", "开始加载激励广告，代码位: " + mAdConfig.rewarded_ad_code_id + ", shouldShowAfterLoad=" + shouldShowAfterLoad);

        AdSlot adSlot = new AdSlot.Builder()
                .setCodeId(mAdConfig.rewarded_ad_code_id)
                .setOrientation(TTAdConstant.VERTICAL)
                .setMediationAdSlot(
                    new MediationAdSlot.Builder()
                        .setMuted(false)
                        .setExtraObject("show_adn_load_error_detail", true)
                        .build()
                )
                .build();

        TTAdNative adNative = TTAdSdk.getAdManager().createAdNative(this);

        adNative.loadRewardVideoAd(adSlot, new TTAdNative.RewardVideoAdListener() {
            @Override
            public void onError(int code, String message) {
                Log.e("AdSdk", "激励广告加载失败，code: " + code + ", msg: " + message);
                isRewardedAdLoaded = false;
                isRewardedAdLoading = false;
                hasNotifiedAdResult = false;  // 重置通知标志
                // 加载失败后直接通知 JS 端执行降级策略，不重试
                notifyJsAdResult(false);
            }

            @Override
            public void onRewardVideoAdLoad(TTRewardVideoAd ad) {
                Log.d("AdSdk", "激励广告加载成功，等待缓存...");
            }

            @Override
            public void onRewardVideoCached() {
                Log.d("AdSdk", "激励广告缓存完成(旧版API)");
            }

            @Override
            public void onRewardVideoCached(TTRewardVideoAd ad) {
                Log.d("AdSdk", "激励广告缓存完成");
                mTTRewardVideoAd = ad;
                isRewardedAdLoaded = true;
                isRewardedAdLoading = false;
                // 只有用户触发的加载（shouldShowAdAfterLoad=true）才自动展示
                if (shouldShowAdAfterLoad && !hasShownRewardedAd) {
                    Log.d("AdSdk", "用户触发，准备展示广告");
                    showRewardedAdInternal();
                } else {
                    Log.d("AdSdk", "预加载完成，仅加载不展示");
                }
            }
        });
    }

     * 展示激励广告

    private void showRewardedAdInternal() {
        Log.d("AdSdk", "========== showRewardedAdInternal 开始 ==========");
        Log.d("AdSdk", "hasShownRewardedAd=" + hasShownRewardedAd);
        
        // 防止重复展示
        if (hasShownRewardedAd) {
            Log.d("AdSdk", "广告已展示过，跳过");
            return;
        }
        
        if (mTTRewardVideoAd == null) {
            Log.d("AdSdk", "激励广告未加载");
            return;
        }

        // 标记已展示
        hasShownRewardedAd = true;
        Log.d("AdSdk", "标记 hasShownRewardedAd=true");
        
        // 重置回调标志，确保每次广告只回调一次
        Log.d("AdSdk", "重置 hasNotifiedAdResult 为 false");
        hasNotifiedAdResult = false;

        mTTRewardVideoAd.setRewardAdInteractionListener(
            new TTRewardVideoAd.RewardAdInteractionListener() {
                @Override
                public void onAdShow() {
                    Log.d("AdSdk", "激励广告展示");
                }

                @Override
                public void onAdVideoBarClick() {
                    Log.d("AdSdk", "激励广告被点击");
                }

                @Override
                public void onAdClose() {
                    Log.d("AdSdk", "激励广告关闭");
                    isRewardedAdLoaded = false;
                    mTTRewardVideoAd = null;
                    // 立即预加载下一个激励广告（仅加载，不自动展示）
                    Log.d("AdSdk", "预加载下一个激励广告");
                    loadRewardedAd(false);
                }

                @Override
                public void onVideoComplete() {
                    Log.d("AdSdk", "激励广告播放完成");
                }

                @Override
                public void onVideoError() {
                    Log.e("AdSdk", "激励广告播放出错");
                    notifyJsAdResult(false);
                }

                @Override
                public void onRewardVerify(boolean rewardValid, int rewardType,
                                           String rewardName, int rewardAmount, String extraInfo) {
                    Log.d("AdSdk", "激励广告奖励验证: valid=" + rewardValid);
                }

                @Override
                public void onRewardArrived(boolean isRewardValid, int rewardType, android.os.Bundle extraInfo) {
                    Log.d("AdSdk", "========== onRewardArrived 触发 ==========");
                    Log.d("AdSdk", "激励广告奖励发放: valid=" + isRewardValid);
                    Log.d("AdSdk", "hasNotifiedAdResult=" + hasNotifiedAdResult);
                    // 奖励发放成功后通知 JS
                    if (isRewardValid) {
                        notifyJsAdResult(true);
                    } else {
                        notifyJsAdResult(false);
                    }
                }

                @Override
                public void onSkippedVideo() {
                    Log.d("AdSdk", "========== onSkippedVideo 触发 ==========");
                    Log.d("AdSdk", "激励广告被跳过");
                    Log.d("AdSdk", "hasNotifiedAdResult=" + hasNotifiedAdResult);
                    notifyJsAdResult(false);
                }
            }
        );

        mTTRewardVideoAd.showRewardVideoAd(MainActivity.this);
    }

    /*
     * 通知 JS 广告展示结果
     * @param success 用户是否完整观看

    private void notifyJsAdResult(boolean success) {
        Log.d("AdSdk", "========== notifyJsAdResult 调用 ==========");
        Log.d("AdSdk", "准备通知 JS，success=" + success);
        Log.d("AdSdk", "hasNotifiedAdResult=" + hasNotifiedAdResult);
        
        // 防止多次回调（只通知一次）
        if (hasNotifiedAdResult) {
            Log.d("AdSdk", "🚫 广告结果已通知，跳过重复回调");
            return;
        }
        
        Log.d("AdSdk", "✅ 首次通知 JS，success=" + success);
        hasNotifiedAdResult = true;

        runOnUiThread(() -> {
            String jsCode = String.format(
                "if (typeof window.onAdResult === 'function') { window.onAdResult(%b); }",
                success
            );
            webView.evaluateJavascript(jsCode, null);
        });
    }
    */

    /**
     * 获取屏幕宽度（像素）- 应用实际可用区域
     */
    private int getScreenWidth() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+ 使用新API
            WindowMetrics windowMetrics = getWindowManager().getCurrentWindowMetrics();
            android.graphics.Rect bounds = windowMetrics.getBounds();
            return bounds.width();
        } else {
            // 旧版本使用 DisplayMetrics，但减去装饰区域
            DisplayMetrics dm = getResources().getDisplayMetrics();
            return dm.widthPixels;
        }
    }

    /**
     * 获取屏幕高度（像素）- 应用实际可用区域
     */
    private int getScreenHeight() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+ 使用新API
            WindowMetrics windowMetrics = getWindowManager().getCurrentWindowMetrics();
            android.graphics.Rect bounds = windowMetrics.getBounds();
            return bounds.height();
        } else {
            // 旧版本获取可见区域高度
            Rect visibleRect = new Rect();
            getWindow().getDecorView().getWindowVisibleDisplayFrame(visibleRect);
            return visibleRect.height();
        }
    }

    /**
     * 广告 SDK 需要的权限列表
     */
    private static final int AD_PERMISSION_REQUEST_CODE = 1001;
    private static final String[] AD_PERMISSIONS = {
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.WRITE_EXTERNAL_STORAGE
    };

    /**
     * 申请广告 SDK 需要的动态权限
     */
    private void requestAdPermissions() {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            // Android 6.0 以下，权限已在安装时授予
            initAdSdkInternal();
            return;
        }

        List<String> needRequestPermissions = new ArrayList<>();
        for (String permission : AD_PERMISSIONS) {
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                needRequestPermissions.add(permission);
            }
        }

        if (needRequestPermissions.isEmpty()) {
            // 所有权限都已授予
            Log.d("AdSdk", "所有广告相关权限已授予");
            initAdSdkInternal();
        } else {
            // 检查是否已经显示过权限说明
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean hasShownExplanation = prefs.getBoolean(KEY_PERMISSION_EXPLANATION_SHOWN, false);
            
            if (hasShownExplanation) {
                // 已经显示过说明，跳过权限申请
                Log.d("AdSdk", "权限说明已显示过，跳过权限申请");
                initAdSdkInternal();
            } else {
                // 第一次申请，通知 Web 端显示权限说明
                pendingPermissionRequest = needRequestPermissions;
                notifyWebViewShowPermissionExplanation(needRequestPermissions);
            }
        }
    }

    /**
     * 通知 WebView 显示权限说明
     */
    private void notifyWebViewShowPermissionExplanation(List<String> needRequestPermissions) {
        StringBuilder permissionTypes = new StringBuilder();
        boolean hasPhoneState = false;
        boolean hasLocation = false;
        boolean hasStorage = false;
        
        for (String permission : needRequestPermissions) {
            if (permission.equals(Manifest.permission.READ_PHONE_STATE)) {
                hasPhoneState = true;
            } else if (permission.equals(Manifest.permission.ACCESS_COARSE_LOCATION) || 
                       permission.equals(Manifest.permission.ACCESS_FINE_LOCATION)) {
                hasLocation = true;
            } else if (permission.equals(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
                hasStorage = true;
            }
        }
        
        // 构建权限类型字符串
        List<String> types = new ArrayList<>();
        if (hasPhoneState) types.add("phone_state");
        if (hasLocation) types.add("location");
        if (hasStorage) types.add("storage");
        
        String typesJson = "[" + String.join(",", types.stream().map(t -> "\"" + t + "\"").toArray(String[]::new)) + "]";
        
        runOnUiThread(() -> {
            String jsCode = String.format(
                "if (typeof window.onShowPermissionExplanation === 'function') { window.onShowPermissionExplanation(%s); }",
                typesJson
            );
            webView.evaluateJavascript(jsCode, null);
        });
    }

    // ==================== 插屏广告相关方法 ====================

    /**
     * 构造插屏广告的 AdSlot

    private AdSlot buildInterstitialAdSlot() {
        return new AdSlot.Builder()
                .setCodeId(mAdConfig.interstitial_ad_code_id)  // 插屏广告位ID
                .setOrientation(TTAdConstant.VERTICAL)  // 设置方向
                .setMediationAdSlot(
                        new MediationAdSlot.Builder()
                                .setMuted(false)
                                .setExtraObject("show_adn_load_error_detail", true)  // 打开各ADN错误信息开关
                                .build()
                )
                .build();
    }
    */

    // ========== GDT 插屏广告（已停用） ==========
    /*
    private void loadInterstitialAd(boolean shouldShowAfterLoad) {
        if (!mAdConfig.ad_enabled || !mAdConfig.interstitial_ad_enabled) {
            Log.d("AdSdk", "插屏广告已被服务器配置关闭");
            return;
        }
        if (mAdConfig.interstitial_ad_code_id == null || mAdConfig.interstitial_ad_code_id.isEmpty()) {
            Log.d("AdSdk", "插屏广告代码位未配置");
            return;
        }
        if (!isAdSdkInitialized) {
            Log.d("AdSdk", "广告SDK未就绪，无法加载插屏广告");
            return;
        }

        isInterstitialAdLoading = true;
        hasShownInterstitialAd = false;
        shouldShowInterstitialAfterLoad = shouldShowAfterLoad;
        Log.d("AdSdk", "开始加载 GDT 插屏广告，代码位: " + mAdConfig.interstitial_ad_code_id);

        // 销毁旧实例
        if (mInterstitialAd != null) {
            mInterstitialAd.close();
            mInterstitialAd.destroy();
            mInterstitialAd = null;
        }

        createInterstitialAd(shouldShowAfterLoad);
    }

    private void createInterstitialAd(boolean shouldShowAfterLoad) {
        runOnUiThread(() -> {
            UnifiedInterstitialADListener listener = new UnifiedInterstitialADListener() {
                @Override
                public void onNoAD(AdError adError) {
                    Log.e("AdSdk", "插屏广告加载失败，code: " + adError.getErrorCode() + ", msg: " + adError.getErrorMsg());
                    isInterstitialAdLoaded = false;
                    isInterstitialAdLoading = false;
                    notifyJsInterstitialAdResult(false);
                    DemoBiddingC2SUtils.reportBiddingNoAd(mInterstitialAd);
                }
                @Override
                public void onADReceive() {
                    Log.d("AdSdk", "插屏广告加载成功");
                    isInterstitialAdLoaded = true;
                    isInterstitialAdLoading = false;
                    DemoBiddingC2SUtils.reportWin(mInterstitialAd);
                    if (shouldShowAfterLoad && !hasShownInterstitialAd) {
                        Log.d("AdSdk", "用户触发，准备展示插屏广告");
                        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                            if (mInterstitialAd != null && mInterstitialAd.isValid()) {
                                showInterstitialAdInternal();
                            } else {
                                Log.w("AdSdk", "插屏广告已失效，展示前重新加载");
                                loadInterstitialAd(true);
                            }
                        }, 300);
                    } else {
                        Log.d("AdSdk", "插屏广告预加载完成，仅加载不展示");
                    }
                }
                @Override
                public void onADExposure() { Log.d("AdSdk", "插屏广告曝光"); }
                @Override
                public void onADClicked() { Log.d("AdSdk", "插屏广告被点击"); }
                @Override
                public void onADClosed() {
                    Log.d("AdSdk", "插屏广告关闭");
                    isInterstitialAdLoaded = false;
                    if (mInterstitialAd != null) {
                        mInterstitialAd.destroy();
                        mInterstitialAd = null;
                    }
                    notifyJsInterstitialAdResult(true);
                }
                @Override
                public void onRenderSuccess() { Log.d("AdSdk", "插屏广告渲染成功"); }
                @Override
                public void onRenderFail() {
                    Log.e("AdSdk", "插屏广告渲染失败");
                    isInterstitialAdLoaded = false;
                    isInterstitialAdLoading = false;
                    notifyJsInterstitialAdResult(false);
                }
                @Override
                public void onADOpened() { Log.d("AdSdk", "插屏广告打开"); }
                @Override
                public void onVideoCached() { Log.d("AdSdk", "插屏广告视频缓存完成"); }
                @Override
                public void onADLeftApplication() { Log.d("AdSdk", "插屏广告离开应用"); }
            };

                mInterstitialAd = new UnifiedInterstitialAD(MainActivity.this, mAdConfig.interstitial_ad_code_id, listener);
            mInterstitialAd.setRewardListener(map -> {
                Log.d("AdSdk", "插屏广告奖励发放: " + map);
                runOnUiThread(() -> {
                    double r = Math.pow(Math.random(), 3);
                    double hours = 0.5 + r * 23.5;
                    hours = Math.round(hours * 2) / 2.0;
                    Toast.makeText(MainActivity.this, "获得额外" + hours + "小时的免广告时间~", Toast.LENGTH_LONG).show();
                    notifyJsAdFreeReward(hours);
                });
            });
            mInterstitialAd.loadFullScreenAD();
        });
    }

    private void showInterstitialAdInternal() {
        Log.d("AdSdk", "========== showInterstitialAdInternal 开始 ==========");
        if (hasShownInterstitialAd) {
            Log.d("AdSdk", "插屏广告已展示过，跳过");
            return;
        }
        if (mInterstitialAd == null) {
            Log.d("AdSdk", "插屏广告未加载");
            return;
        }

        hasShownInterstitialAd = true;
        Log.d("AdSdk", "展示 GDT 插屏广告");
        isResumingFromBackground = false;
        mInterstitialAd.showFullScreenAD(MainActivity.this);
    }
    */

    /**
     * 通知 JS 插屏广告结果
     */
    private void notifyJsInterstitialAdResult(boolean success) {
        runOnUiThread(() -> {
            String jsCode = String.format(
                "if (typeof window.onInterstitialAdResult === 'function') { window.onInterstitialAdResult(%b); }",
                success
            );
            webView.evaluateJavascript(jsCode, null);
        });
    }

    private void notifyJsAdFreeReward(double hours) {
        runOnUiThread(() -> {
            String jsCode = String.format(
                "if (typeof window.onAdFreeReward === 'function') { window.onAdFreeReward(%f); }",
                hours
            );
            webView.evaluateJavascript(jsCode, null);
            Log.d("AdSdk", "通知 JS 免广告奖励: " + hours + "小时");
        });
    }

    private void notifyJsInterstitialAdReward(Map<String, Object> rewardMap) {
        runOnUiThread(() -> {
            try {
                org.json.JSONObject json = new org.json.JSONObject();
                if (rewardMap != null) {
                    for (Map.Entry<String, Object> entry : rewardMap.entrySet()) {
                        json.put(entry.getKey(), entry.getValue());
                    }
                }
                String jsCode = String.format(
                    "if (typeof window.onInterstitialAdReward === 'function') { window.onInterstitialAdReward(%s); }",
                    json.toString()
                );
                webView.evaluateJavascript(jsCode, null);
                Log.d("AdSdk", "通知 JS 插屏广告奖励: " + json.toString());
            } catch (Exception e) {
                Log.e("AdSdk", "通知奖励失败", e);
            }
        });
    }

    /**
     * 设置 JavaScript 接口（在 onCreate 和 onResume 中都调用）
     */
    private void setupJavascriptInterface() {
        // 先移除旧的接口（防止重复添加）
        try {
            webView.removeJavascriptInterface("AndroidBridge");
        } catch (Exception e) {
            // 忽略移除失败的异常
        }
        
        // 添加 JavaScript 接口
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setStatusBarColor(String color) {
                runOnUiThread(() -> {
                    try {
                        currentThemeColor = color;
                        // 状态栏永远透明
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            getWindow().setStatusBarColor(Color.TRANSPARENT);
                        }
                        applyStatusBarAppearance(color);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                });
            }

            @JavascriptInterface
            public void setNavigationBarColor(String color) {
                runOnUiThread(() -> {
                    try {
                        // 导航栏永远透明
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            getWindow().setNavigationBarColor(Color.TRANSPARENT);
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                });
            }

            @JavascriptInterface
            public void openFileChooser() {
                runOnUiThread(() -> {
                    // 检查并请求读取权限（Android 10 及以下需要）
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                        if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                            pendingImportAction = true;
                            pendingExportData = null;
                            pendingExportFileName = null;
                            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST_CODE);
                            return;
                        }
                    }
                    openFileChooserInternal();
                });
            }

            @JavascriptInterface
            public void openImageChooser() {
                runOnUiThread(() -> {
                    // 检查并请求读取权限（Android 10 及以下需要）
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                        if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                            pendingImportAction = false;
                            pendingExportData = null;
                            pendingExportFileName = null;
                            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST_CODE);
                            return;
                        }
                    }
                    openImageChooserInternal();
                });
            }

            @JavascriptInterface
            public String getDownloadsPath() {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                return dir.getAbsolutePath();
            }

            @JavascriptInterface
            public void openUploadFileChooser() {
                runOnUiThread(() -> {
                    // 检查并请求读取权限（Android 10 及以下需要）
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                        if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                            pendingImportAction = false;
                            pendingExportData = null;
                            pendingExportFileName = null;
                            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST_CODE);
                            return;
                        }
                    }
                    openUploadFileChooserInternal();
                });
            }

            @JavascriptInterface
            public void openKnowledgeFileChooser() {
                runOnUiThread(() -> {
                    // 检查并请求读取权限（Android 10 及以下需要）
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                        if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                            pendingImportAction = false;
                            pendingExportData = null;
                            pendingExportFileName = null;
                            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST_CODE);
                            return;
                        }
                    }
                    openKnowledgeFileChooserInternal();
                });
            }

            @JavascriptInterface
            public String getPendingKnowledgeFiles() {
                String data = pendingKnowledgeFilesData;
                pendingKnowledgeFilesData = null;
                return data;
            }

            @JavascriptInterface
            public void openPCFileChooser() {
                runOnUiThread(() -> {
                    openPCFileChooserInternal();
                });
            }

            @JavascriptInterface
            public void setPCConnectionInfo(String ip, String token) {
                pcServerIP = ip;
                pcDeviceToken = token;
                Log.d("FileTransfer", "PC连接信息已设置: ip=" + ip);
            }

            @JavascriptInterface
            public void setCloudAuth(String json) {
                try {
                    SharedPreferences sp = getSharedPreferences("cloud_auth", MODE_PRIVATE);
                    if (json == null || json.isEmpty()) {
                        sp.edit().clear().apply();
                    } else {
                        sp.edit().putString("auth", json).apply();
                    }
                } catch (Exception e) {
                    Log.e("CloudAuth", "保存失败: " + e.getMessage());
                }
            }

            @JavascriptInterface
            public String getCloudAuth() {
                try {
                    SharedPreferences sp = getSharedPreferences("cloud_auth", MODE_PRIVATE);
                    return sp.getString("auth", null);
                } catch (Exception e) {
                    return null;
                }
            }

            @JavascriptInterface
            public void deleteFileIfExists(String fileName) {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "小蓝AI盒子");
                File file = new File(dir, fileName);
                if (file.exists()) file.delete();
            }

            @JavascriptInterface
            public void saveNoteFile(String title, String content) {
                try {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Bluox/Notes");
                    if (!dir.exists()) dir.mkdirs();
                    String safeName = title.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
                    if (safeName.isEmpty()) safeName = "未命名";
                    // 优先 .md，兼容删除旧 .txt
                    File mdFile = new File(dir, safeName + ".md");
                    File txtFile = new File(dir, safeName + ".txt");
                    if (txtFile.exists()) txtFile.delete();
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(mdFile, false);
                    fos.write(content.getBytes("UTF-8"));
                    fos.close();
                } catch (Exception e) {
                    Log.e("Notebook", "保存笔记文件失败: " + e.getMessage());
                }
            }

            @JavascriptInterface
            public void deleteNoteFile(String title) {
                try {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Bluox/Notes");
                    if (!dir.exists()) dir.mkdirs();
                    String safeName = title.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
                    if (safeName.isEmpty()) safeName = "未命名";
                    File mdFile = new File(dir, safeName + ".md");
                    if (mdFile.exists()) mdFile.delete();
                    File txtFile = new File(dir, safeName + ".txt");
                    if (txtFile.exists()) txtFile.delete();
                    // 兼容：同时检查旧目录 BlueBox/Notes
                    File oldDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "BlueBox/Notes");
                    File oldMd = new File(oldDir, safeName + ".md");
                    if (oldMd.exists()) oldMd.delete();
                    File oldTxt = new File(oldDir, safeName + ".txt");
                    if (oldTxt.exists()) oldTxt.delete();
                } catch (Exception e) {
                    Log.e("Notebook", "删除笔记文件失败: " + e.getMessage());
                }
            }

            @JavascriptInterface
            public void renameNoteFile(String oldTitle, String newTitle) {
                try {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Bluox/Notes");
                    String oldSafeName = oldTitle.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
                    if (oldSafeName.isEmpty()) oldSafeName = "未命名";
                    String newSafeName = newTitle.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
                    if (newSafeName.isEmpty()) newSafeName = "未命名";
                    File oldMdFile = new File(dir, oldSafeName + ".md");
                    File oldTxtFile = new File(dir, oldSafeName + ".txt");
                    if (oldMdFile.exists()) {
                        File target = getSafeRenameTarget(dir, newSafeName, ".md", oldMdFile);
                        oldMdFile.renameTo(target);
                    } else if (oldTxtFile.exists()) {
                        File target = getSafeRenameTarget(dir, newSafeName, ".md", oldTxtFile);
                        oldTxtFile.renameTo(target);
                    }
                    // 兼容：同时检查旧目录 BlueBox/Notes
                    File oldDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "BlueBox/Notes");
                    File oldMd2 = new File(oldDir, oldSafeName + ".md");
                    File oldTxt2 = new File(oldDir, oldSafeName + ".txt");
                    if (oldMd2.exists()) {
                        File target = getSafeRenameTarget(dir, newSafeName, ".md", oldMd2);
                        oldMd2.renameTo(target);
                    } else if (oldTxt2.exists()) {
                        File target = getSafeRenameTarget(dir, newSafeName, ".md", oldTxt2);
                        oldTxt2.renameTo(target);
                    }
                } catch (Exception e) {
                    Log.e("Notebook", "重命名笔记文件失败: " + e.getMessage());
                }
            }

            /**
             * 获取安全的重命名目标：如果目标已存在且不是源文件，在名称后加 _new、_new_2 ...
             */
            private File getSafeRenameTarget(File dir, String baseName, String ext, File srcFile) {
                File target = new File(dir, baseName + ext);
                if (!target.exists() || target.getAbsolutePath().equals(srcFile.getAbsolutePath())) {
                    return target;
                }
                int suffix = 1;
                target = new File(dir, baseName + "_new" + ext);
                while (target.exists()) {
                    suffix++;
                    target = new File(dir, baseName + "_new_" + suffix + ext);
                }
                return target;
            }

            @JavascriptInterface
            public String readAllNoteFiles() {
                try {
                    File bluoxDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Bluox/Notes");
                    File blueBoxDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "BlueBox/Notes");
                    // 迁移：把 BlueBox/Notes 的文件移到 Bluox/Notes
                    if (blueBoxDir.exists() && blueBoxDir.isDirectory()) {
                        if (!bluoxDir.exists()) bluoxDir.mkdirs();
                        File[] oldFiles = blueBoxDir.listFiles();
                        if (oldFiles != null) {
                            for (File oldFile : oldFiles) {
                                if (oldFile.isFile()) {
                                    File newFile = new File(bluoxDir, oldFile.getName());
                                    if (!newFile.exists()) oldFile.renameTo(newFile);
                                }
                            }
                        }
                        // 迁移完后删除旧目录
                        blueBoxDir.delete();
                    }
                    File dir = bluoxDir;
                    if (!dir.exists() || !dir.isDirectory()) return "[]";
                    File[] files = dir.listFiles();
                    if (files == null) return "[]";
                    org.json.JSONArray arr = new org.json.JSONArray();
                    for (File f : files) {
                        if (!f.isFile()) continue;
                        String fname = f.getName();
                        boolean isMd = fname.endsWith(".md");
                        boolean isTxt = fname.endsWith(".txt");
                        if (!isMd && !isTxt) continue;
                        // 同名 .md 和 .txt 同时存在时跳过 .txt（避免重复）
                        if (isTxt && new File(dir, fname.replace(".txt", ".md")).exists()) continue;
                        try {
                            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(f), "UTF-8"));
                            StringBuilder sb = new StringBuilder();
                            String line;
                            boolean firstLine = true;
                            boolean pinned = false;
                            while ((line = reader.readLine()) != null) {
                                if (firstLine) {
                                    // 第一行是 pinned 标记
                                    pinned = "pinned:true".equals(line);
                                    firstLine = false;
                                } else {
                                    if (sb.length() > 0) sb.append("\n");
                                    sb.append(line);
                                }
                            }
                            reader.close();
                            String title = f.getName().replace(".md", "").replace(".txt", "");
                            org.json.JSONObject obj = new org.json.JSONObject();
                            obj.put("title", title);
                            obj.put("content", sb.toString());
                            obj.put("time", f.lastModified());
                            obj.put("pinned", pinned);
                            obj.put("isMd", isMd);
                            arr.put(obj);
                        } catch (Exception e) {
                            Log.e("Notebook", "读取笔记文件失败: " + e.getMessage());
                        }
                    }
                    return arr.toString();
                } catch (Exception e) {
                    Log.e("Notebook", "读取笔记目录失败: " + e.getMessage());
                    return "[]";
                }
            }

            @JavascriptInterface
            public void appendReceivedChunk(String fileName, String base64Chunk) {
                try {
                    byte[] bytes = android.util.Base64.decode(base64Chunk, android.util.Base64.DEFAULT);
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "小蓝AI盒子");
                    if (!dir.exists()) dir.mkdirs();
                    File file = new File(dir, fileName);
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(file, true); // append=true
                    fos.write(bytes);
                    fos.close();
                } catch (Exception e) {
                    Log.e("FileTransfer", "追加写入失败: " + e.getMessage());
                }
            }

            @JavascriptInterface
            public String getReceivedFilePath(String fileName) {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "小蓝AI盒子");
                File file = new File(dir, fileName);
                return file.getAbsolutePath();
            }

            @JavascriptInterface
            public void openReceivedFile(String fileName) {
                try {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "小蓝AI盒子");
                    File file = new File(dir, fileName);
                    if (!file.exists()) {
                        Toast.makeText(MainActivity.this, "文件不存在", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                    intent.setDataAndType(uri, getMimeType(fileName));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(intent, "打开文件"));
                } catch (Exception e) {
                    Log.e("FileTransfer", "打开文件失败: " + e.getMessage());
                    Toast.makeText(MainActivity.this, "打开文件失败", Toast.LENGTH_SHORT).show();
                }
            }

            private String getMimeType(String fileName) {
                String ext = android.webkit.MimeTypeMap.getFileExtensionFromUrl(fileName.toLowerCase());
                String mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                return mime != null ? mime : "*/*";
            }

            @JavascriptInterface
            public void openRestoreFileChooser() {
                runOnUiThread(() -> {
                    isRestoreDataMode = true;
                    // 检查并请求读取权限（Android 10 及以下需要）
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                        if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                            pendingImportAction = true;
                            pendingExportData = null;
                            pendingExportFileName = null;
                            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST_CODE);
                            return;
                        }
                    }
                    openFileChooserInternal();
                });
            }

            @JavascriptInterface
            public void openCompressImageChooser() {
                runOnUiThread(() -> {
                    // 检查并请求读取权限（Android 10 及以下需要）
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                        if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                            pendingImportAction = false;
                            pendingExportData = null;
                            pendingExportFileName = null;
                            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST_CODE);
                            return;
                        }
                    }
                    openCompressImageChooserInternal();
                });
            }

            @JavascriptInterface
            public void saveToFile(String fileName, String jsonContent) {
                runOnUiThread(() -> {
                    // 检查并请求写入权限
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            // Android 11+ 不需要 WRITE_EXTERNAL_STORAGE 权限来写入 Downloads
                            saveToFileInternal(fileName, jsonContent);
                        } else {
                            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                                pendingImportAction = false;
                                pendingExportData = jsonContent;
                                pendingExportFileName = fileName;
                                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST_CODE);
                                return;
                            }
                            saveToFileInternal(fileName, jsonContent);
                        }
                    } else {
                        saveToFileInternal(fileName, jsonContent);
                    }
                });
            }

            @JavascriptInterface
            public void saveImageToFile(String fileName, String base64Data) {
                runOnUiThread(() -> {
                    // 检查并请求写入权限
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            // Android 11+ 不需要 WRITE_EXTERNAL_STORAGE 权限来写入 Downloads
                            saveImageToFileInternal(fileName, base64Data);
                        } else {
                            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                                isSaveImageRequest = true;
                                pendingImportAction = false;
                                pendingExportData = base64Data;
                                pendingExportFileName = fileName;
                                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST_CODE);
                                return;
                            }
                            saveImageToFileInternal(fileName, base64Data);
                        }
                    } else {
                        saveImageToFileInternal(fileName, base64Data);
                    }
                });
            }

            @JavascriptInterface
            public void openExternalBrowser(String url) {
                runOnUiThread(() -> {
                    openUrlWithAgreementActivity(url, "获取API Key");
                });
            }

            @JavascriptInterface
            public void exitApp() {
                runOnUiThread(() -> {
                    // 不销毁 Activity，而是将应用移到后台，保留应用移到后台保留
                    moveTaskToBack(true);
                });
            }

            @JavascriptInterface
            public void hideStatusBar() {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        getWindow().getDecorView().getWindowInsetsController().hide(
                            WindowInsets.Type.statusBars()
                        );
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
                        getWindow().getDecorView().setSystemUiVisibility(
                            View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        );
                    }
                });
            }

            @JavascriptInterface
            public void showStatusBar() {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        getWindow().getDecorView().getWindowInsetsController().show(
                            WindowInsets.Type.statusBars()
                        );
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
                        getWindow().getDecorView().setSystemUiVisibility(
                            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        );
                    }
                    // 状态栏永远透明
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        getWindow().setStatusBarColor(Color.TRANSPARENT);
                    }
                    applyStatusBarAppearance(currentThemeColor);
                });
            }

            @JavascriptInterface
            public int getStatusBarHeight() {
                int result = 0;
                int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
                if (resourceId > 0) {
                    result = getResources().getDimensionPixelSize(resourceId);
                }
                // 转换为 CSS 像素
                float density = getResources().getDisplayMetrics().density;
                return (int) (result / density);
            }

            @JavascriptInterface
            public String getScreenInfo() {
                DisplayMetrics dm = getResources().getDisplayMetrics();
                int statusBarHeight = 0;
                int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
                if (resourceId > 0) {
                    statusBarHeight = getResources().getDimensionPixelSize(resourceId);
                }
                return "{\"width\":" + dm.widthPixels + ",\"height\":" + dm.heightPixels + ",\"statusBarHeight\":" + statusBarHeight + ",\"density\":" + dm.density + "}";
            }

            // Native embedding generation methods
            @JavascriptInterface
            public boolean isNativeEmbeddingReady() {
                return embeddingGenerator != null && embeddingGenerator.isInitialized();
            }

            @JavascriptInterface
            public String generateEmbeddingNative(String inputIdsJson, String attentionMaskJson) {
                if (embeddingGenerator == null || !embeddingGenerator.isInitialized()) {
                    return "{\"error\":\"not_initialized\"}";
                }
                return embeddingGenerator.generateEmbeddingJson(inputIdsJson, attentionMaskJson);
            }

            // ========== 热更新相关接口 ==========

            @JavascriptInterface
            public String getAppVersion() {
                // 返回 APK 版本号
                try {
                    return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                } catch (Exception e) {
                    return ASSETS_WEB_VERSION;
                }
            }

            @JavascriptInterface
            public String getWebVersion() {
                // 返回当前使用的 Web 版本号
                return updateManager.getCurrentVersion();
            }

            @JavascriptInterface
            public String getAssetsWebVersion() {
                // 返回 APK 打包时的 Web 版本号
                return ASSETS_WEB_VERSION;
            }

            @JavascriptInterface
            public boolean hasUpdate() {
                // 是否有已下载的更新版本
                return updateManager.isUpdateInstalled() &&
                       !updateManager.getCurrentVersion().equals(ASSETS_WEB_VERSION);
            }

            @JavascriptInterface
            public void checkUpdate() {
                // 手动检查更新（强制检查，忽略时间限制）
                runOnUiThread(() -> checkForUpdates());
            }

            // ========== 广告相关接口 ==========

            @JavascriptInterface
            public void initAdSdk() {
                // Web 端调用时初始化 SDK（延迟模式，不申请权限）
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isAdSdkInitialized) {
                            Log.d("AdSdk", "SDK已初始化，跳过fetchAdConfig");
                            return;
                        }
                        fetchAdConfig();
                    }
                });
            }

            @JavascriptInterface
            public void requestAdPermissionNow() {
                Log.d("AdSdk", "=== requestAdPermissionNow 被调用 ===");
                // 用户第一次发消息时触发权限申请
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Log.d("AdSdk", "requestAdPermissionNow - 开始执行");
                        shouldDeferAdPermission = false;
                        mFromRequestAdPermission = true;
                        // 如果SDK已初始化，直接申请权限，不重复拉配置
                        if (isAdSdkInitialized) {
                            Log.d("AdSdk", "SDK已初始化，直接申请权限");
                            requestAdPermissions();
                            return;
                        }
                        // SDK未初始化，先拉配置再走完整流程
                        fetchAdConfig();
                    }
                });
            }

            @JavascriptInterface
            public boolean isAdSdkReady() {
                return CNAIChatApplication.isAdSdkReady();
            }

            @JavascriptInterface
            public boolean showRewardedAd() {
                // 激励广告已停用
                Log.d("AdSdk", "激励广告已停用");
                return false;
            }

            @JavascriptInterface
            public boolean isRewardedAdReady() {
                return false;
            }

            @JavascriptInterface
            public boolean isInterstitialAdEnabled() {
                return mAdConfig.ad_enabled && mAdConfig.interstitial_ad_enabled;
            }

            @JavascriptInterface
            public String getAdps() {
                return mAdConfig.adps != null ? mAdConfig.adps : "";
            }

            @JavascriptInterface
            public boolean showInterstitialAd() {
                // GDT 插屏广告已停用
                Log.d("AdSdk", "GDT 插屏广告已停用");
                return false;
                /*
                if (!isAdSdkInitialized) {
                    Log.w("AdSdk", "广告 SDK 未初始化，无法展示插屏广告");
                    return false;
                }
                if (!mAdConfig.ad_enabled || !mAdConfig.interstitial_ad_enabled) {
                    Log.d("AdSdk", "插屏广告已被服务器配置关闭");
                    return false;
                }

                if (isInterstitialAdLoading) {
                    Log.d("AdSdk", "插屏广告正在加载中，忽略重复请求");
                    return true;
                }

                if (isInterstitialAdLoaded && mInterstitialAd != null) {
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                        runOnUiThread(() -> showInterstitialAdInternal());
                    }, 800);
                    return true;
                }

                Log.d("AdSdk", "插屏广告未加载，开始加载（用户触发，加载后自动展示）");
                loadInterstitialAd(true);
                return true;
                */
            }

            @JavascriptInterface
            public boolean isInterstitialAdReady() {
                // GDT 插屏广告已停用
                return false;
            }

            // ========== 权限说明相关接口 ==========

            @JavascriptInterface
            public void onPermissionExplanationContinue() {
                // 用户点击继续，申请权限
                runOnUiThread(() -> {
                    if (pendingPermissionRequest != null) {
                        // 标记已显示过权限说明
                        SharedPreferences.Editor editor = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
                        editor.putBoolean(KEY_PERMISSION_EXPLANATION_SHOWN, true);
                        editor.apply();
                        
                        // 申请未授予的权限
                        Log.d("AdSdk", "申请广告相关权限: " + pendingPermissionRequest);
                        requestPermissions(pendingPermissionRequest.toArray(new String[0]), AD_PERMISSION_REQUEST_CODE);
                        isResumingFromBackground = false;
                    }
                });
            }

            @JavascriptInterface
            public void openAgreementActivity(String url, String title) {
                Log.d("AgreementActivity", "openAgreementActivity called, url=" + url + ", title=" + title);
                // 在新 Activity 中打开协议页面
                Intent intent = new Intent(MainActivity.this, AgreementActivity.class);
                intent.putExtra(AgreementActivity.EXTRA_URL, url);
                intent.putExtra(AgreementActivity.EXTRA_TITLE, title);
                startActivity(intent);
            }

            /**
             * 获取所有 SharedPreferences 数据（用于备份）
             */
            @JavascriptInterface
            public String getAllSharedPrefs() {
                try {
                    android.content.SharedPreferences prefs = getSharedPreferences("cnaichat_prefs", MODE_PRIVATE);
                    java.util.Map<String, ?> allPrefs = prefs.getAll();
                    org.json.JSONObject json = new org.json.JSONObject();
                    for (java.util.Map.Entry<String, ?> entry : allPrefs.entrySet()) {
                        json.put(entry.getKey(), entry.getValue());
                    }
                    return json.toString();
                } catch (Exception e) {
                    Log.e("Backup", "获取 SharedPreferences 失败", e);
                    return "{}";
                }
            }

            /**
             * 恢复 SharedPreferences 数据（用于恢复备份）
             */
            @JavascriptInterface
            public void restoreSharedPrefs(String jsonStr) {
                try {
                    android.content.SharedPreferences prefs = getSharedPreferences("cnaichat_prefs", MODE_PRIVATE);
                    android.content.SharedPreferences.Editor editor = prefs.edit();
                    org.json.JSONObject json = new org.json.JSONObject(jsonStr);
                    java.util.Iterator<String> keys = json.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        Object value = json.get(key);
                        if (value instanceof Boolean) {
                            editor.putBoolean(key, (Boolean) value);
                        } else if (value instanceof Integer) {
                            editor.putInt(key, (Integer) value);
                        } else if (value instanceof Long) {
                            editor.putLong(key, (Long) value);
                        } else if (value instanceof Float) {
                            editor.putFloat(key, (Float) value);
                        } else if (value instanceof String) {
                            editor.putString(key, (String) value);
                        }
                    }
                    editor.apply();
                    Log.d("Backup", "SharedPreferences 恢复成功");
                } catch (Exception e) {
                    Log.e("Backup", "恢复 SharedPreferences 失败", e);
                }
            }

            /**
             * 调用 Termux 执行命令（异步，不阻塞 JS 线程）
             *
             * 改进：原 executeSync 会阻塞 WebView JS 线程导致前端卡死。
             * 现在改为异步：立即返回 callbackId，结果通过 window._onTermuxResult(callbackId, result) 回调。
             *
             * 前端用法（Promise 包装）：
             *   const id = AndroidInterface.runTermuxCommand(cmd, workDir, timeout);
             *   const result = await new Promise(resolve => {
             *       const handler = (cbId, data) => {
             *           if (cbId === id) { window._onTermuxResult = null; resolve(data); }
             *       };
             *       window._onTermuxResult = handler;
             *   });
             *
             * @param command   要执行的命令
             * @param workDir   工作目录（可选）
             * @param timeoutSec 超时秒数
             * @return callbackId（字符串），结果稍后通过 JS 回调返回
             */
            @JavascriptInterface
            public String runTermuxCommand(String command, String workDir, int timeoutSec) {
                if (termuxBridge == null) {
                    termuxBridge = new TermuxBridge(MainActivity.this);
                }
                String callbackId = "termux_" + System.currentTimeMillis();
                termuxBridge.executeAsync(command, workDir, callbackId,
                        webView, MainActivity.this, timeoutSec);
                return callbackId;
            }

            /**
             * 获取 Termux 状态信息（安装/版本/权限/配置）
             * @return JSON
             */
            @JavascriptInterface
            public String getTermuxStatus() {
                if (termuxBridge == null) {
                    termuxBridge = new TermuxBridge(MainActivity.this);
                }
                return termuxBridge.getStatusJson();
            }

            /**
             * 获取 Termux 配置指南
             */
            @JavascriptInterface
            public String getTermuxSetupGuide() {
                if (termuxBridge == null) {
                    termuxBridge = new TermuxBridge(MainActivity.this);
                }
                return termuxBridge.setupTermuxProperties();
            }

            /**
             * 请求 RUN_COMMAND 权限（弹出系统授权对话框）
             */
            @JavascriptInterface
            public void requestTermuxPermission() {
                if (termuxBridge == null) {
                    termuxBridge = new TermuxBridge(MainActivity.this);
                }
                runOnUiThread(() -> termuxBridge.requestRunCommandPermission(MainActivity.this));
            }

            /**
             * 取消正在执行的 Termux 异步命令
             * @param callbackId 要取消的命令的 callbackId，传 null 或空字符串则取消所有
             */
            @JavascriptInterface
            public void cancelTermuxCommand(String callbackId) {
                if (termuxBridge == null) {
                    return;
                }
                if (callbackId == null || callbackId.isEmpty()) {
                    termuxBridge.cancelAllAsyncCommands();
                } else {
                    termuxBridge.cancelAsyncCommand(callbackId);
                }
            }

            /**
             * 打开 Termux 应用详情页（手动授权用）
             */
            @JavascriptInterface
            public void openTermuxSettings() {
                if (termuxBridge == null) {
                    termuxBridge = new TermuxBridge(MainActivity.this);
                }
                termuxBridge.openTermuxAppSettings();
            }

            /**
             * 检查 Termux 是否可用
             * @return JSON 结果
             */
            @JavascriptInterface
            public String checkTermux() {
                try {
                    android.content.pm.PackageManager pm = getPackageManager();
                    pm.getPackageInfo("com.termux", 0);
                    return "{\"installed\":true}";
                } catch (Exception e) {
                    return "{\"installed\":false}";
                }
            }

            /**
             * 读取编译输出
             * @param projectPath 项目路径
             * @return 编译输出文本
             */
            @JavascriptInterface
            public String readBuildOutput(String projectPath) {
                try {
                    File outputFile = new File(projectPath, "build_output.txt");
                    if (!outputFile.exists()) {
                        return "{\"output\":\",\"done\":false}";
                    }
                    java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(outputFile));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line).append("\n");
                    }
                    reader.close();
                    String content = sb.toString();
                    boolean done = content.contains("BUILD_DONE");
                    boolean success = content.contains("BUILD_DONE exit=0");
                     String escaped = content.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
                     return "{\"output\":\"" + escaped + "\",\"done\":" + done + ",\"success\":" + success + "}";
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 安装 APK 文件
             * @param apkPath APK 文件路径
             * @return JSON 结果
             */
            @JavascriptInterface
            public String installApk(String apkPath) {
                try {
                    File apkFile = new File(apkPath);
                    if (!apkFile.exists()) {
                        return "{\"error\":\"APK 文件不存在\"}";
                    }
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(android.net.Uri.fromFile(apkFile), "application/vnd.android.package-archive");
                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                    return "{\"success\":true}";
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 设置锁定竖屏
             * @param lock true=锁定竖屏，false=允许旋转
             */
            @JavascriptInterface
            public void setLockPortrait(boolean lock) {
                runOnUiThread(() -> {
                    if (lock) {
                        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                        Log.d("Orientation", "锁定竖屏");
                    } else {
                        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
                        Log.d("Orientation", "解锁竖屏，允许旋转");
                    }
                });
            }

            /**
             * 原生 HTTP GET 请求（用于联网搜索，无 CORS 限制）
             * @param url 请求的 URL
             * @return 响应内容（HTML 文本），失败时返回 JSON 错误信息
             */
            @JavascriptInterface
            public String httpGet(String url) {
                final String[] result = {"{\"error\":\"unknown\"}"};
                final CountDownLatch latch = new CountDownLatch(1);

                new Thread(() -> {
                    try {
                        OkHttpClient client = new OkHttpClient.Builder()
                            .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                            .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                            .followRedirects(true)
                            .followSslRedirects(true)
                            .build();

                        Request request = new Request.Builder()
                            .url(url)
                            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")
                            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
                            .build();

                        try (Response response = client.newCall(request).execute()) {
                            if (response.isSuccessful() && response.body() != null) {
                                String html = response.body().string();
                                // 转义特殊字符，确保 JS 能安全解析
                                result[0] = html;
                            } else {
                                result[0] = "{\"error\":\"HTTP " + response.code() + "\"}";
                            }
                        }
                    } catch (Exception e) {
                        result[0] = "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                    } finally {
                        latch.countDown();
                    }
                }).start();

                try {
                    latch.await(20, java.util.concurrent.TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    result[0] = "{\"error\":\"request_timeout\"}";
                }

                return result[0];
            }

            /**
             * 异步原生 HTTP GET 请求（不阻塞 JS 线程）
             * 使用 OkHttp enqueue 走其内置线程池，支持 cancel
             * @param url 请求的 URL
             * @param callbackId JS 回调 ID
             */
            @JavascriptInterface
            public void httpGetAsync(String url, String callbackId) {
                try {
                    Request request = new Request.Builder()
                        .url(url)
                        .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")
                        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
                        .build();

                    Call call = sharedHttpClient.newCall(request);
                    pendingHttpCalls.put(callbackId, call);

                    call.enqueue(new Callback() {
                        @Override
                        public void onFailure(Call call, IOException e) {
                            pendingHttpCalls.remove(callbackId);
                            String errMsg = e.getMessage() != null ? e.getMessage().replace("\"", "'") : "unknown";
                            if (call.isCanceled()) errMsg = "cancelled";
                            deliverHttpResult(callbackId, "{\"error\":\"" + errMsg + "\"}");
                        }

                        @Override
                        public void onResponse(Call call, Response response) throws IOException {
                            pendingHttpCalls.remove(callbackId);
                            String result;
                            try {
                                if (response.isSuccessful() && response.body() != null) {
                                    long contentLength = response.body().contentLength();
                                    if (contentLength > 2 * 1024 * 1024) {
                                        result = "{\"error\":\"response_too_large\"}";
                                    } else {
                                        // 读取字节后智能检测编码
                                        byte[] bytes = response.body().bytes();
                                        if (bytes.length > 2 * 1024 * 1024) {
                                            byte[] trimmed = new byte[2 * 1024 * 1024];
                                            System.arraycopy(bytes, 0, trimmed, 0, trimmed.length);
                                            bytes = trimmed;
                                        }
                                        result = decodeHtmlEncoding(bytes, response);
                                    }
                                } else {
                                    result = "{\"error\":\"HTTP " + response.code() + "\"}";
                                }
                            } catch (Exception e) {
                                result = "{\"error\":\"" + (e.getMessage() != null ? e.getMessage().replace("\"", "'") : "read_error") + "\"}";
                            }
                            deliverHttpResult(callbackId, result);
                        }
                    });
                } catch (Exception e) {
                    pendingHttpCalls.remove(callbackId);
                    deliverHttpResult(callbackId, "{\"error\":\"" + (e.getMessage() != null ? e.getMessage().replace("\"", "'") : "unknown") + "\"}");
                }
            }

            /**
             * 取消指定的异步 HTTP 请求
             * @param callbackId JS 回调 ID
             */
            @JavascriptInterface
            public void cancelHttpRequest(String callbackId) {
                Call call = pendingHttpCalls.remove(callbackId);
                if (call != null && !call.isCanceled()) {
                    cancelledCallbacks.add(callbackId);
                    call.cancel();
                }
            }

            /**
             * 取消所有正在进行的异步 HTTP 请求
             */
            @JavascriptInterface
            public void cancelAllHttpRequests() {
                java.util.Iterator<Map.Entry<String, Call>> it = pendingHttpCalls.entrySet().iterator();
                while (it.hasNext()) {
                    Map.Entry<String, Call> entry = it.next();
                    it.remove();
                    cancelledCallbacks.add(entry.getKey());
                    if (!entry.getValue().isCanceled()) entry.getValue().cancel();
                }
            }

            /**
             * 将 HTTP 结果回传给 JS（在 UI 线程执行）
             */
            private void deliverHttpResult(String callbackId, String result) {
                // 如果该回调已被取消，跳过无意义的 evaluateJavascript
                if (cancelledCallbacks.remove(callbackId)) {
                    return;
                }
                final String finalResult = result;
                final String finalCbId = callbackId;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    String safeResult = new org.json.JSONArray().put(finalResult).toString();
                    String innerJson = safeResult.substring(1, safeResult.length() - 1);
                    // callbackId 用 JSONObject.quote 正确转为 JSON 字符串（如 "cb_1"），而非数组 ["cb_1"]
                    String cbIdJson = org.json.JSONObject.quote(finalCbId);
                    String js = "window.__httpCallback(" + cbIdJson + "," + innerJson + ");";
                    webView.evaluateJavascript(js, null);
                });
            }

            /**
             * 智能解码 HTML 响应体，处理 charset 问题
             * 优先级: HTTP header > meta charset > 字节级检测 > UTF-8
             */
            private String decodeHtmlEncoding(byte[] bytes, Response response) {
                // 1. 先用 UTF-8 解码（大多数情况正确）
                String utf8 = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
                // 检查是否有明显的乱码（替换字符 \uFFFD）
                boolean hasUtf8Errors = utf8.indexOf('\uFFFD') >= 0;

                if (!hasUtf8Errors) return utf8;

                // 2. 检查 Content-Type header
                String contentType = response.header("Content-Type");
                if (contentType != null) {
                    String charset = parseCharsetFromContentType(contentType);
                    if (charset != null) {
                        try {
                            return new String(bytes, charset);
                        } catch (Exception ignored) {}
                    }
                }

                // 3. 检查 HTML meta charset
                String metaCharset = parseMetaCharset(utf8);
                if (metaCharset != null) {
                    try {
                        return new String(bytes, metaCharset);
                    } catch (Exception ignored) {}
                }

                // 4. 兜底尝试 GBK（中文老站常见）
                try {
                    String gbk = new String(bytes, "GBK");
                    if (gbk.indexOf('\uFFFD') < 0) return gbk;
                } catch (Exception ignored) {}

                // 5. 最终兜底 UTF-8
                return utf8;
            }

            /**
             * 从 Content-Type 提取 charset，如 "text/html; charset=gbk" → "gbk"
             */
            private String parseCharsetFromContentType(String contentType) {
                String lower = contentType.toLowerCase();
                int idx = lower.indexOf("charset=");
                if (idx >= 0) {
                    String charset = contentType.substring(idx + 8).trim();
                    // 去掉分号后面的内容
                    int semi = charset.indexOf(';');
                    if (semi >= 0) charset = charset.substring(0, semi);
                    return charset.trim();
                }
                return null;
            }

            /**
             * 从 HTML 内容中解析 <meta charset="..."> 或 <meta http-equiv="Content-Type" content="...; charset=...">
             */
            private String parseMetaCharset(String html) {
                // <meta charset="gbk">
                java.util.regex.Matcher m1 = java.util.regex.Pattern.compile(
                    "<meta[^>]+charset=[\"']?([\\w-]+)", java.util.regex.Pattern.CASE_INSENSITIVE
                ).matcher(html.length() > 2000 ? html.substring(0, 2000) : html);
                if (m1.find()) return m1.group(1);
                return null;
            }

            /**
             * 读取文件内容
             * @param path 文件路径
             * @param encoding 编码（默认 utf-8）
             * @param offset 起始行号（1-based，0表示从头）
             * @param limit 读取行数（0表示全部）
             * @return JSON 格式的文件内容
             */
            @JavascriptInterface
            public String readFile(String path, String encoding, int offset, int limit) {
                try {
                    File file = new File(path);
                    if (!file.exists()) {
                        return "{\"error\":\"文件不存在: " + path.replace("\"", "'") + "\"}";
                    }
                    if (file.isDirectory()) {
                        return "{\"error\":\"路径是目录，不是文件: " + path.replace("\"", "'") + "\"}";
                    }
                    // 限制文件大小（最大 2MB）
                    if (file.length() > 2 * 1024 * 1024) {
                        return "{\"error\":\"文件过大（超过2MB），请使用 offset/limit 分段读取\"}";
                    }
                    if (encoding == null || encoding.isEmpty()) encoding = "UTF-8";
                    java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)
                    );
                    java.util.List<String> lines = new java.util.ArrayList<>();
                    String line;
                    int lineNum = 0;
                    int startLine = offset > 0 ? offset : 1;
                    int endLine = limit > 0 ? startLine + limit - 1 : Integer.MAX_VALUE;
                    while ((line = reader.readLine()) != null) {
                        lineNum++;
                        if (lineNum >= startLine && lineNum <= endLine) {
                            lines.add(line);
                        }
                        // 不再提前 break，继续遍历到文件末尾以获取正确的总行数
                    }
                    reader.close();
                    StringBuilder sb = new StringBuilder();
                    sb.append("{\"path\":\"").append(path.replace("\\", "\\\\").replace("\"", "\\\"")).append("\",");
                    sb.append("\"totalLines\":").append(lineNum).append(",");
                    sb.append("\"startLine\":").append(startLine).append(",");
                    sb.append("\"endLine\":").append(lines.size() > 0 ? startLine + lines.size() - 1 : startLine).append(",");
                    sb.append("\"lines\":");
                    // 用 JSON 数组返回行内容
                    sb.append("[");
                    for (int i = 0; i < lines.size(); i++) {
                        if (i > 0) sb.append(",");
                        sb.append("\"").append(lines.get(i).replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")).append("\"");
                    }
                    sb.append("]}");
                    return sb.toString();
                } catch (java.io.UnsupportedEncodingException e) {
                    return "{\"error\":\"不支持的编码: " + encoding + "\"}";
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 读取文件并以 base64 返回（用于图片文件）
             * @param path 文件绝对路径
             * @return base64 字符串，失败返回空字符串
             */
            @JavascriptInterface
            public String readFileBase64(String path) {
                try {
                    File file = new File(path);
                    if (!file.exists()) {
                        return "";
                    }
                    if (file.isDirectory()) {
                        return "";
                    }
                    // 限制 5MB
                    if (file.length() > 5 * 1024 * 1024) {
                        return "";
                    }
                    byte[] bytes = new byte[(int) file.length()];
                    java.io.FileInputStream fis = new java.io.FileInputStream(file);
                    fis.read(bytes);
                    fis.close();
                    return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                } catch (Exception e) {
                    return "";
                }
            }

            /**
             * 提取文件文本内容（支持 PDF/Word/PPT/Excel）
             * @param path 文件绝对路径
             * @return JSON 格式结果 {"text":"..."} 或 {"error":"..."}
             */
            @JavascriptInterface
            public String extractFileText(String path) {
                try {
                    File file = new File(path);
                    if (!file.exists()) {
                        return "{\"error\":\"文件不存在: " + path.replace("\"", "'") + "\"}";
                    }
                    if (file.isDirectory()) {
                        return "{\"error\":\"路径是目录，不是文件\"}";
                    }
                    if (file.length() > 20 * 1024 * 1024) {
                        return "{\"error\":\"文件过大（超过20MB），无法解析\"}";
                    }

                    String name = file.getName().toLowerCase();
                    String text = null;

                    if (name.endsWith(".pdf")) {
                        text = extractPdfText(file);
                    } else if (name.endsWith(".docx") || name.endsWith(".doc")) {
                        text = extractWordText(file);
                    } else if (name.endsWith(".pptx") || name.endsWith(".ppt")) {
                        text = extractPptText(file);
                    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
                        text = extractExcelText(file);
                    } else {
                        return "{\"error\":\"不支持的文件类型: " + name.substring(name.lastIndexOf('.')) + "\"}";
                    }

                    if (text == null || text.trim().isEmpty()) {
                        return "{\"error\":\"未能提取到文本内容，文件可能为空或包含扫描图片\"}";
                    }
                    if (text.length() > 100000) {
                        text = text.substring(0, 100000) + "\n\n...（内容过长，已截断）";
                    }
                    String escaped = text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
                    return "{\"text\":\"" + escaped + "\"}";
                } catch (Exception e) {
                    return "{\"error\":\"解析失败: " + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            private String extractPdfText(File file) throws Exception {
                java.io.InputStream is = new java.io.FileInputStream(file);
                try {
                    com.tom_roush.pdfbox.android.PDFBoxResourceLoader.init(getApplicationContext());
                    com.tom_roush.pdfbox.pdmodel.PDDocument document = com.tom_roush.pdfbox.pdmodel.PDDocument.load(is);
                    try {
                        com.tom_roush.pdfbox.text.PDFTextStripper stripper = new com.tom_roush.pdfbox.text.PDFTextStripper();
                        int totalPages = document.getNumberOfPages();
                        StringBuilder sb = new StringBuilder();
                        sb.append("PDF文件，共 ").append(totalPages).append(" 页\n\n");
                        for (int i = 1; i <= totalPages; i++) {
                            stripper.setStartPage(i);
                            stripper.setEndPage(i);
                            String pageText = stripper.getText(document);
                            if (pageText != null && !pageText.trim().isEmpty()) {
                                sb.append("--- 第 ").append(i).append(" 页 ---\n");
                                sb.append(pageText.trim()).append("\n\n");
                            }
                        }
                        return sb.toString();
                    } finally { document.close(); }
                } finally { is.close(); }
            }

            private String extractWordText(File file) throws Exception {
                String name = file.getName().toLowerCase();
                java.io.InputStream is = new java.io.FileInputStream(file);
                try {
                    if (name.endsWith(".docx")) {
                        org.apache.poi.xwpf.usermodel.XWPFDocument doc = new org.apache.poi.xwpf.usermodel.XWPFDocument(is);
                        try {
                            StringBuilder sb = new StringBuilder();
                            for (org.apache.poi.xwpf.usermodel.XWPFParagraph para : doc.getParagraphs()) {
                                String t = para.getText();
                                if (t != null && !t.trim().isEmpty()) sb.append(t).append("\n");
                            }
                            for (org.apache.poi.xwpf.usermodel.XWPFTable table : doc.getTables()) {
                                sb.append("\n[表格]\n");
                                for (org.apache.poi.xwpf.usermodel.XWPFTableRow row : table.getRows()) {
                                    java.util.List<String> cells = new java.util.ArrayList<>();
                                    for (org.apache.poi.xwpf.usermodel.XWPFTableCell cell : row.getTableCells()) {
                                        cells.add(cell.getText().trim());
                                    }
                                    sb.append("| ").append(String.join(" | ", cells)).append(" |\n");
                                }
                            }
                            return sb.toString();
                        } finally { doc.close(); }
                    } else {
                        org.apache.poi.hwpf.HWPFDocument doc = new org.apache.poi.hwpf.HWPFDocument(is);
                        try {
                            return new org.apache.poi.hwpf.extractor.WordExtractor(doc).getText();
                        } finally { doc.close(); }
                    }
                } finally { is.close(); }
            }

            private String extractPptText(File file) throws Exception {
                String name = file.getName().toLowerCase();
                java.io.InputStream is = new java.io.FileInputStream(file);
                try {
                    if (name.endsWith(".pptx")) {
                        org.apache.poi.xslf.usermodel.XMLSlideShow ppt = new org.apache.poi.xslf.usermodel.XMLSlideShow(is);
                        try {
                            StringBuilder sb = new StringBuilder();
                            sb.append("PPT文件，共 ").append(ppt.getSlides().size()).append(" 张幻灯片\n\n");
                            int sn = 1;
                            for (org.apache.poi.xslf.usermodel.XSLFSlide slide : ppt.getSlides()) {
                                sb.append("--- 第 ").append(sn++).append(" 张幻灯片 ---\n");
                                for (org.apache.poi.xslf.usermodel.XSLFShape shape : slide.getShapes()) {
                                    if (shape instanceof org.apache.poi.xslf.usermodel.XSLFTextShape) {
                                        String t = ((org.apache.poi.xslf.usermodel.XSLFTextShape) shape).getText();
                                        if (t != null && !t.trim().isEmpty()) sb.append(t.trim()).append("\n");
                                    } else if (shape instanceof org.apache.poi.xslf.usermodel.XSLFTable) {
                                        org.apache.poi.xslf.usermodel.XSLFTable table = (org.apache.poi.xslf.usermodel.XSLFTable) shape;
                                        sb.append("[表格]\n");
                                        for (org.apache.poi.xslf.usermodel.XSLFTableRow row : table.getRows()) {
                                            java.util.List<String> cells = new java.util.ArrayList<>();
                                            for (org.apache.poi.xslf.usermodel.XSLFTableCell cell : row.getCells()) {
                                                cells.add(cell.getText().trim());
                                            }
                                            sb.append("| ").append(String.join(" | ", cells)).append(" |\n");
                                        }
                                    }
                                }
                                sb.append("\n");
                            }
                            return sb.toString();
                        } finally { ppt.close(); }
                    } else {
                        org.apache.poi.hslf.usermodel.HSLFSlideShow ppt = new org.apache.poi.hslf.usermodel.HSLFSlideShow(is);
                        try {
                            StringBuilder sb = new StringBuilder();
                            java.util.List<org.apache.poi.hslf.usermodel.HSLFSlide> slides = ppt.getSlides();
                            sb.append("PPT文件，共 ").append(slides.size()).append(" 张幻灯片\n\n");
                            int sn = 1;
                            for (org.apache.poi.hslf.usermodel.HSLFSlide slide : slides) {
                                sb.append("--- 第 ").append(sn++).append(" 张幻灯片 ---\n");
                                for (org.apache.poi.hslf.usermodel.HSLFShape shape : slide.getShapes()) {
                                    if (shape instanceof org.apache.poi.hslf.usermodel.HSLFTextShape) {
                                        String t = ((org.apache.poi.hslf.usermodel.HSLFTextShape) shape).getText();
                                        if (t != null && !t.trim().isEmpty()) sb.append(t.trim()).append("\n");
                                    }
                                }
                                sb.append("\n");
                            }
                            return sb.toString();
                        } finally { ppt.close(); }
                    }
                } finally { is.close(); }
            }

            private String extractExcelText(File file) throws Exception {
                String name = file.getName().toLowerCase();
                java.io.InputStream is = new java.io.FileInputStream(file);
                try {
                    org.apache.poi.ss.usermodel.Workbook wb;
                    if (name.endsWith(".xlsx")) {
                        wb = new org.apache.poi.xssf.usermodel.XSSFWorkbook(is);
                    } else {
                        wb = new org.apache.poi.hssf.usermodel.HSSFWorkbook(is);
                    }
                    try {
                        StringBuilder sb = new StringBuilder();
                        int ns = wb.getNumberOfSheets();
                        sb.append("Excel文件，共 ").append(ns).append(" 个工作表\n\n");
                        for (int s = 0; s < ns; s++) {
                            org.apache.poi.ss.usermodel.Sheet sheet = wb.getSheetAt(s);
                            sb.append("=== 工作表: ").append(sheet.getSheetName()).append(" ===\n");
                            for (org.apache.poi.ss.usermodel.Row row : sheet) {
                                java.util.List<String> cells = new java.util.ArrayList<>();
                                for (org.apache.poi.ss.usermodel.Cell cell : row) {
                                    cells.add(getCellText(cell));
                                }
                                sb.append("| ").append(String.join(" | ", cells)).append(" |\n");
                            }
                            sb.append("\n");
                        }
                        return sb.toString();
                    } finally { wb.close(); }
                } finally { is.close(); }
            }

            private String getCellText(org.apache.poi.ss.usermodel.Cell cell) {
                if (cell == null) return "";
                switch (cell.getCellType()) {
                    case STRING: return cell.getStringCellValue().trim();
                    case NUMERIC:
                        double num = cell.getNumericCellValue();
                        if (num == Math.floor(num) && !Double.isInfinite(num)) return String.valueOf((long) num);
                        return String.valueOf(num);
                    case BOOLEAN: return String.valueOf(cell.getBooleanCellValue());
                    case FORMULA:
                        try { return cell.getStringCellValue(); }
                        catch (Exception e) { return String.valueOf(cell.getNumericCellValue()); }
                    default: return "";
                }
            }

            /**
             * 备份文件（破坏性操作前自动调用）
             * 备份失败会抛出异常，中断操作
             * @param path 原文件路径
             * @throws Exception 备份失败时抛出
             */
            private void backupFile(String path) throws Exception {
                File src = new File(path);
                if (!src.exists() || src.isDirectory()) return;
                // 备份目录：Download/Bluox/file_backup/
                File backupDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Bluox/file_backup");
                if (!backupDir.exists() && !backupDir.mkdirs()) {
                    throw new Exception("无法创建备份目录: " + backupDir.getAbsolutePath());
                }
                // 用路径哈希作为子目录，避免文件名冲突
                String dirHash = Integer.toHexString(path.hashCode()).replace("-", "m");
                File fileBackupDir = new File(backupDir, dirHash);
                if (!fileBackupDir.exists() && !fileBackupDir.mkdirs()) {
                    throw new Exception("无法创建备份子目录: " + fileBackupDir.getAbsolutePath());
                }
                // 清理旧备份，只保留最近 20 份
                File[] oldBackups = fileBackupDir.listFiles();
                if (oldBackups != null && oldBackups.length >= 20) {
                    java.util.Arrays.sort(oldBackups, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
                    for (int i = 0; i < oldBackups.length - 19; i++) {
                        oldBackups[i].delete();
                    }
                }
                // 备份文件名：原文件名_yyyyMMdd_HHmmss
                String timestamp = new java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(new java.util.Date());
                String backupName = src.getName() + "_" + timestamp;
                File backupFile = new File(fileBackupDir, backupName);
                java.io.InputStream in = new java.io.FileInputStream(src);
                java.io.OutputStream out = new java.io.FileOutputStream(backupFile);
                byte[] buf = new byte[4096];
                int len;
                while ((len = in.read(buf)) > 0) out.write(buf, 0, len);
                in.close();
                out.flush();
                out.close();
                Log.d("FileBackup", "已备份: " + backupFile.getAbsolutePath());
            }

            /**
             * 列出指定目录下的文件和子目录
             * @param path 目录路径
             * @return JSON 格式的目录列表
             */
            @JavascriptInterface
            public String listDirectory(String path) {
                try {
                    File dir = new File(path);
                    if (!dir.exists()) {
                        return "{\"error\":\"目录不存在: " + path.replace("\"", "'") + "\"}";
                    }
                    if (!dir.isDirectory()) {
                        return "{\"error\":\"路径不是目录: " + path.replace("\"", "'") + "\"}";
                    }
                    File[] files = dir.listFiles();
                    if (files == null) {
                        return "{\"error\":\"无法读取目录（权限不足）: " + path.replace("\"", "'") + "\"}";
                    }
                    java.util.Arrays.sort(files, (a, b) -> {
                        if (a.isDirectory() && !b.isDirectory()) return -1;
                        if (!a.isDirectory() && b.isDirectory()) return 1;
                        return a.getName().compareToIgnoreCase(b.getName());
                    });
                    StringBuilder sb = new StringBuilder();
                    sb.append("{");
                    sb.append("\"path\":\"").append(path.replace("\\", "\\\\").replace("\"", "\\\"")).append("\",");
                    sb.append("\"entries\": [");
                    for (int i = 0; i < files.length; i++) {
                        File f = files[i];
                        if (i > 0) sb.append(",");
                        sb.append("{");
                        sb.append("\"name\":\"").append(f.getName().replace("\"", "\\\"")).append("\",");
                        sb.append("\"type\":\"").append(f.isDirectory() ? "directory" : "file").append("\",");
                        if (f.isFile()) {
                            sb.append("\"size\":").append(f.length()).append(",");
                        }
                        sb.append("\"modified\":").append(f.lastModified());
                        sb.append("}");
                    }
                    sb.append("]}");
                    return sb.toString();
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 写入文件（覆盖整个文件，自动创建父目录）
             * @param path 文件路径
             * @param content 文件内容
             * @return JSON 结果
             */
            @JavascriptInterface
            public String writeFile(String path, String content) {
                try {
                    File file = new File(path);
                    // 备份已有文件
                    if (file.exists()) backupFile(path);
                    File parentDir = file.getParentFile();
                    if (parentDir != null && !parentDir.exists()) {
                        parentDir.mkdirs();
                    }
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(file, false);
                    fos.write(content.getBytes("UTF-8"));
                    fos.flush();
                    fos.close();
                    return "{\"success\":true,\"path\":\"" + path.replace("\\", "\\\\").replace("\"", "\\\"") + "\",\"size\":" + file.length() + "}";
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 编辑文件（搜索替换）
             * @param path 文件路径
             * @param editsJson JSON 数组，每项包含 old_text, new_text, 可选 start_line, end_line
             * @return JSON 结果
             */
            @JavascriptInterface
            public String editFile(String path, String editsJson) {
                try {
                    File file = new File(path);
                    if (!file.exists()) {
                        return "{\"error\":\"文件不存在: " + path.replace("\"", "'") + "\"}";
                    }
                    if (file.isDirectory()) {
                        return "{\"error\":\"路径是目录，不是文件\"}";
                    }
                    // 备份原文件
                    backupFile(path);
                    // 读取文件内容
                    java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.InputStreamReader(new java.io.FileInputStream(file), "UTF-8")
                    );
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line).append("\n");
                    }
                    reader.close();
                    String content = sb.toString();
                    // 如果文件不以换行结尾，去掉末尾多余的换行
                    if (content.length() > 0 && !content.endsWith("\r\n") && content.endsWith("\n")) {
                        // 保留原样
                    }

                    // 解析 edits
                    org.json.JSONArray edits = new org.json.JSONArray(editsJson);
                    int applied = 0;
                    int added = 0, removed = 0;

                    for (int i = 0; i < edits.length(); i++) {
                        org.json.JSONObject edit = edits.getJSONObject(i);
                        String oldText = edit.optString("old_text", "");
                        String newText = edit.optString("new_text", "");
                        int startLine = edit.optInt("start_line", 0);
                        int endLine = edit.optInt("end_line", 0);

                        if (oldText.isEmpty()) continue;

                        // 确定搜索范围
                        int searchStart = 0;
                        int searchEnd = content.length();
                        if (startLine > 0) {
                            // 计算行起始位置
                            int lineNum = 1;
                            for (int j = 0; j < content.length(); j++) {
                                if (lineNum == startLine) { searchStart = j; break; }
                                if (content.charAt(j) == '\n') lineNum++;
                            }
                            if (endLine >= startLine) {
                                lineNum = 1;
                                for (int j = 0; j < content.length(); j++) {
                                    if (lineNum == endLine + 1) { searchEnd = j; break; }
                                    if (content.charAt(j) == '\n') lineNum++;
                                }
                            }
                        }

                        // 在范围内搜索
                        String searchRegion = content.substring(searchStart, searchEnd);
                        int idx = searchRegion.indexOf(oldText);
                        if (idx == -1) {
                            return "{\"error\":\"第 " + (i + 1) + " 个 edit 未找到匹配文本\"}";
                        }
                        // 检查多处匹配
                        int secondIdx = searchRegion.indexOf(oldText, idx + 1);
                        if (secondIdx != -1) {
                            return "{\"error\":\"第 " + (i + 1) + " 个 edit 找到多处匹配，请用 start_line/end_line 缩小范围\"}";
                        }

                        // 计算增删行数
                        int oldLines = oldText.split("\n").length;
                        int newLines = newText.split("\n").length;
                        added += newLines;
                        removed += oldLines;

                        // 执行替换
                        String before = content.substring(0, searchStart + idx);
                        String after = content.substring(searchStart + idx + oldText.length());
                        content = before + newText + after;
                        applied++;
                    }

                    // 写回文件
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(file, false);
                    fos.write(content.getBytes("UTF-8"));
                    fos.flush();
                    fos.close();

                    return "{\"success\":true,\"path\":\"" + path.replace("\\", "\\\\").replace("\"", "\\\"") + "\",\"editsApplied\":" + applied + ",\"added\":" + added + ",\"removed\":" + removed + "}";
                } catch (org.json.JSONException e) {
                    return "{\"error\":\"edits 参数格式错误: " + e.getMessage().replace("\"", "'") + "\"}";
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 创建目录（自动创建父目录）
             * @param path 目录路径
             * @return JSON 结果
             */
            @JavascriptInterface
            public String createDirectory(String path) {
                try {
                    File dir = new File(path);
                    if (dir.exists()) {
                        return "{\"error\":\"目录已存在: " + path.replace("\"", "'") + "\"}";
                    }
                    if (dir.mkdirs()) {
                        return "{\"success\":true,\"path\":\"" + path.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
                    } else {
                        return "{\"error\":\"创建目录失败（权限不足？）: " + path.replace("\"", "'") + "\"}";
                    }
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 移动或复制文件
             * @param src 源文件路径
             * @param dst 目标文件路径
             * @param isCopy true=复制，false=移动
             */
            @JavascriptInterface
            public String moveOrCopyFile(String src, String dst, boolean isCopy) {
                try {
                    File srcFile = new File(src);
                    if (!srcFile.exists()) {
                        return "{\"error\":\"源文件不存在: " + src.replace("\"", "'") + "\"}";
                    }
                    File dstFile = new File(dst);
                    File dstDir = dstFile.getParentFile();
                    if (dstDir != null && !dstDir.exists()) {
                        dstDir.mkdirs();
                    }
                    if (isCopy) {
                        java.io.InputStream in = new java.io.FileInputStream(srcFile);
                        java.io.OutputStream out = new java.io.FileOutputStream(dstFile);
                        byte[] buf = new byte[8192];
                        int len;
                        while ((len = in.read(buf)) > 0) { out.write(buf, 0, len); }
                        in.close(); out.flush(); out.close();
                    } else {
                        if (!srcFile.renameTo(dstFile)) {
                            return "{\"error\":\"移动失败（跨存储区或权限不足？）: " + src.replace("\"", "'") + " -> " + dst.replace("\"", "'") + "\"}";
                        }
                    }
                    String action = isCopy ? "复制" : "移动";
                    return "{\"success\":true,\"action\":\"" + action + "\",\"src\":\"" + src.replace("\\", "\\\\").replace("\"", "\\\"") + "\",\"dst\":\"" + dst.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 获取文件详细信息
             * @param path 文件路径
             * @return JSON 格式的文件信息
             */
            @JavascriptInterface
            public String getFileInfo(String path) {
                try {
                    File file = new File(path);
                    if (!file.exists()) {
                        return "{\"error\":\"文件不存在: " + path.replace("\"", "'") + "\"}";
                    }
                    StringBuilder sb = new StringBuilder();
                    sb.append("{");
                    sb.append("\"path\":\"").append(path.replace("\\", "\\\\").replace("\"", "\\\"")).append("\",");
                    sb.append("\"type\":\"").append(file.isDirectory() ? "directory" : "file").append("\",");
                    sb.append("\"size\":").append(file.length()).append(",");
                    sb.append("\"modified\":").append(file.lastModified()).append(",");
                    sb.append("\"readable\":").append(file.canRead()).append(",");
                    sb.append("\"writable\":").append(file.canWrite());
                    sb.append("}");
                    return sb.toString();
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 按通配符模式搜索文件
             * @param directory 搜索根目录
            * @param pattern 通配符模式（支持 * 和 ?）
             * @return JSON 格式的搜索结果
             */
            @JavascriptInterface
            public String searchFiles(String directory, String pattern) {
                try {
                    File dir = new File(directory);
                    if (!dir.exists() || !dir.isDirectory()) {
                        return "{\"error\":\"目录不存在或不是目录: " + directory.replace("\"", "'") + "\"}";
                    }
                    // 将通配符转为正则
                    String regex = "^" + pattern.replace(".", "\\.").replace("*", ".*").replace("?", ".") + "$";
                    java.util.regex.Pattern p = java.util.regex.Pattern.compile(regex, java.util.regex.Pattern.CASE_INSENSITIVE);
                    java.util.List<java.util.Map<String, Object>> results = new java.util.ArrayList<>();
                    final int MAX_RESULTS = 200;
                    final int MAX_DEPTH = 20;
                    searchFilesWalk(dir, p, results, MAX_RESULTS, MAX_DEPTH, 0);
                    StringBuilder sb = new StringBuilder();
                    sb.append("{\"directory\":\"").append(directory.replace("\\", "\\\\").replace("\"", "\\\"")).append("\",\"results\":");
                    sb.append("[");
                    for (int i = 0; i < results.size(); i++) {
                        if (i > 0) sb.append(",");
                        java.util.Map<String, Object> r = results.get(i);
                        sb.append("{\"name\":\"").append(r.get("name").toString().replace("\"", "\\\"")).append("\",");
                        sb.append("\"path\":\"").append(r.get("path").toString().replace("\\", "\\\\").replace("\"", "\\\"")).append("\",");
                        sb.append("\"type\":\"").append(r.get("type").toString()).append("\",");
                        if (r.containsKey("size")) sb.append("\"size\":").append(r.get("size")).append(",");
                        sb.append("\"modified\":").append(r.get("modified"));
                        sb.append("}");
                    }
                    sb.append("]}");
                    return sb.toString();
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            private void searchFilesWalk(File dir, java.util.regex.Pattern pattern, java.util.List<java.util.Map<String, Object>> results, int maxResults, int maxDepth, int depth) {
                if (depth > maxDepth || results.size() >= maxResults) return;
                File[] files = dir.listFiles();
                if (files == null) return;
                for (File f : files) {
                    if (results.size() >= maxResults) return;
                    if (pattern.matcher(f.getName()).matches()) {
                        java.util.Map<String, Object> entry = new java.util.LinkedHashMap<>();
                        entry.put("name", f.getName());
                        entry.put("path", f.getAbsolutePath());
                        entry.put("type", f.isDirectory() ? "directory" : "file");
                        if (f.isFile()) entry.put("size", f.length());
                        entry.put("modified", f.lastModified());
                        results.add(entry);
                    }
                    if (f.isDirectory() && !f.getName().startsWith(".")) {
                        searchFilesWalk(f, pattern, results, maxResults, maxDepth, depth + 1);
                    }
                }
            }

            /**
             * 在文件内容中搜索关键词或正则
             */
            @JavascriptInterface
            public String searchContent(String directory, String pattern, String include, int maxResults) {
                try {
                    File dir = new File(directory);
                    if (!dir.exists() || !dir.isDirectory()) {
                        return "{\"error\":\"目录不存在或不是目录: " + directory.replace("\"", "'") + "\"}";
                    }
                    if (maxResults <= 0) maxResults = 50;
                    java.util.regex.Pattern searchPattern = java.util.regex.Pattern.compile(pattern, java.util.regex.Pattern.CASE_INSENSITIVE);
                    java.util.List<java.util.regex.Pattern> includePatterns = new java.util.ArrayList<>();
                    if (include != null && !include.isEmpty()) {
                        for (String f : include.split(",")) {
                            f = f.trim();
                            includePatterns.add(java.util.regex.Pattern.compile("^" + f.replace(".", "\\.").replace("*", ".*").replace("?", ".") + "$", java.util.regex.Pattern.CASE_INSENSITIVE));
                        }
                    }
                    java.util.Set<String> skipExts = new java.util.HashSet<>(java.util.Arrays.asList(".exe",".dll",".so",".png",".jpg",".jpeg",".gif",".bmp",".zip",".tar",".gz",".rar",".7z",".mp3",".mp4",".avi",".pdf",".doc",".docx",".class",".o",".pyc"));
                    java.util.List<java.util.Map<String, Object>> results = new java.util.ArrayList<>();
                    searchContentWalk(dir, searchPattern, includePatterns, skipExts, maxResults, 2*1024*1024, 15, 0, results);
                    StringBuilder sb = new StringBuilder("{\"results\":[");
                    for (int i = 0; i < results.size(); i++) {
                        if (i > 0) sb.append(",");
                        java.util.Map<String, Object> r = results.get(i);
                        sb.append("{\"file\":\"").append(r.get("file").toString().replace("\\", "\\\\").replace("\"", "\\\"")).append("\",\"line\":").append(r.get("line")).append(",\"content\":\"").append(r.get("content").toString().replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")).append("\"}");
                    }
                    sb.append("]}");
                    return sb.toString();
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            private void searchContentWalk(File dir, java.util.regex.Pattern searchPattern, java.util.List<java.util.regex.Pattern> includePatterns, java.util.Set<String> skipExts, int maxResults, int maxFileSize, int maxDepth, int depth, java.util.List<java.util.Map<String, Object>> results) {
                if (depth > maxDepth || results.size() >= maxResults) return;
                File[] files = dir.listFiles();
                if (files == null) return;
                for (File f : files) {
                    if (results.size() >= maxResults) return;
                    if (f.isDirectory()) {
                        if (!f.getName().startsWith(".")) searchContentWalk(f, searchPattern, includePatterns, skipExts, maxResults, maxFileSize, maxDepth, depth + 1, results);
                        continue;
                    }
                    String name = f.getName();
                    int dotIdx = name.lastIndexOf('.');
                    if (dotIdx > 0 && skipExts.contains(name.substring(dotIdx).toLowerCase())) continue;
                    if (!includePatterns.isEmpty()) {
                        boolean matched = false;
                        for (java.util.regex.Pattern p : includePatterns) { if (p.matcher(name).matches()) { matched = true; break; } }
                        if (!matched) continue;
                    }
                    if (f.length() > maxFileSize) continue;
                    try {
                        java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(f), "UTF-8"));
                        String line; int lineNum = 0;
                        while ((line = reader.readLine()) != null) {
                            lineNum++;
                            if (results.size() >= maxResults) break;
                            if (searchPattern.matcher(line).find()) {
                                java.util.Map<String, Object> entry = new java.util.LinkedHashMap<>();
                                entry.put("file", f.getAbsolutePath());
                                entry.put("line", lineNum);
                                entry.put("content", line.length() > 200 ? line.substring(0, 200) : line);
                                results.add(entry);
                            }
                        }
                        reader.close();
                    } catch (Exception e) { /* skip */ }
                }
            }

            /**
             * 获取系统信息
             * @param type 信息类型：cpu/memory/os/disk/all
             * @return JSON 格式的系统信息
             */
            @JavascriptInterface
            public String getSystemInfo(String type) {
                try {
                    StringBuilder sb = new StringBuilder("{");
                    boolean first = true;
                    if ("all".equals(type) || "os".equals(type)) {
                        if (!first) sb.append(",");
                        sb.append("\"os\":{\"version\":\"").append(Build.VERSION.RELEASE).append("\",\"sdk\":").append(Build.VERSION.SDK_INT).append(",\"model\":\"").append(Build.MODEL.replace("\"", "\\\"")).append("\",\"manufacturer\":\"").append(Build.MANUFACTURER.replace("\"", "\\\"")).append("\"}");
                        first = false;
                    }
                    if ("all".equals(type) || "memory".equals(type)) {
                        if (!first) sb.append(",");
                        android.app.ActivityManager am = (android.app.ActivityManager) MainActivity.this.getSystemService(Context.ACTIVITY_SERVICE);
                        android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
                        am.getMemoryInfo(mi);
                        sb.append("\"memory\":{\"total\":").append(mi.totalMem).append(",\"available\":").append(mi.availMem).append(",\"totalGB\":").append(String.format("%.1f", mi.totalMem / 1073741824.0)).append(",\"availableGB\":").append(String.format("%.1f", mi.availMem / 1073741824.0)).append("}");
                        first = false;
                    }
                    if ("all".equals(type) || "disk".equals(type)) {
                        if (!first) sb.append(",");
                        android.os.StatFs stat = new android.os.StatFs(Environment.getDataDirectory().getPath());
                        long total = stat.getTotalBytes();
                        long available = stat.getAvailableBytes();
                        sb.append("\"disk\":{\"total\":").append(total).append(",\"available\":").append(available).append(",\"totalGB\":").append(String.format("%.1f", total / 1073741824.0)).append(",\"availableGB\":").append(String.format("%.1f", available / 1073741824.0)).append("}");
                        first = false;
                    }
                    if ("all".equals(type) || "cpu".equals(type)) {
                        if (!first) sb.append(",");
                        int cores = Runtime.getRuntime().availableProcessors();
                        sb.append("\"cpu\":{\"cores\":").append(cores).append("}");
                        first = false;
                    }
                    sb.append("}");
                    return sb.toString();
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 追加内容到文件（自动创建文件和父目录）
             * @param path 文件路径
             * @param content 追加的内容
             * @return JSON 结果
             */
            @JavascriptInterface
            public String appendToFile(String path, String content) {
                try {
                    File file = new File(path);
                    File parentDir = file.getParentFile();
                    if (parentDir != null && !parentDir.exists()) {
                        parentDir.mkdirs();
                    }
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(file, true);
                    fos.write("\n".getBytes("UTF-8"));
                    fos.write(content.getBytes("UTF-8"));
                    fos.flush();
                    fos.close();
                    return "{\"success\":true}";
                } catch (Exception e) {
                    return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
                }
            }

            /**
             * 加载信息流原生广告并覆盖到WebView指定容器位置
             * @param containerId HTML中广告容器的元素ID
             */
            @JavascriptInterface
            public void loadFeedAd(final String containerId) {
                runOnUiThread(() -> {
                    try {
                        if (isFeedAdLoading) return;
                        if (!CNAIChatApplication.isCsjAdSdkReady()) {
                            webView.evaluateJavascript("window.onFeedAdError && window.onFeedAdError('穿山甲SDK未初始化');", null);
                            return;
                        }
                        isFeedAdLoading = true;

                        // 先销毁旧广告
                        destroyFeedAdInternal();

                        Log.d("AdSdk", "开始加载穿山甲信息流广告, 代码位: " + CSJ_FEED_AD_CODE_ID);
                        // 获取容器宽度
                        String jsGetWidth = "(function(){" +
                            "var el=document.getElementById('" + containerId + "');" +
                            "if(!el)return 0;" +
                            "return el.getBoundingClientRect().width;" +
                            "})()";
                        webView.evaluateJavascript(jsGetWidth, (widthResult) -> {
                            float adWidth = 0;
                            try {
                                if (widthResult != null && !widthResult.equals("null")) {
                                    adWidth = Float.parseFloat(widthResult.replace("\"", ""));
                                }
                            } catch (Exception e) {}
                            if (adWidth <= 0) adWidth = webView.getWidth();
                            float density = getResources().getDisplayMetrics().density;
                            int screenWidthPx = getScreenWidth();
                            final float finalAdWidth = (adWidth > 0 && adWidth < screenWidthPx) ? adWidth * density : screenWidthPx;

                            TTAdNative adNative = TTAdSdk.getAdManager().createAdNative(MainActivity.this);
                            AdSlot adSlot = new AdSlot.Builder()
                                    .setCodeId(CSJ_FEED_AD_CODE_ID)
                                    .setImageAcceptedSize((int) finalAdWidth, (int)(finalAdWidth * 2 / 3))
                                    .setMediationAdSlot(
                                        new MediationAdSlot.Builder()
                                            .setMuted(true)
                                            .build()
                                    )
                                    .build();

                            adNative.loadFeedAd(adSlot, new TTAdNative.FeedAdListener() {
                                @Override
                                public void onError(int code, String msg) {
                                    isFeedAdLoading = false;
                                    Log.e("AdSdk", "穿山甲信息流广告加载失败, code: " + code + ", msg: " + msg);
                                    webView.evaluateJavascript("window.onFeedAdError && window.onFeedAdError('" + msg.replace("'", " ") + "');", null);
                                }

                                @Override
                                public void onFeedAdLoad(List<TTFeedAd> list) {
                                    isFeedAdLoading = false;
                                    Log.d("AdSdk", "穿山甲信息流广告加载成功, 数量: " + (list == null ? 0 : list.size()));
                                    if (list == null || list.isEmpty()) {
                                        webView.evaluateJavascript("window.onFeedAdError && window.onFeedAdError('无广告数据');", null);
                                        return;
                                    }
                                    mCsjFeedAd = list.get(0);
                                    // 模板广告：设置渲染监听并调用render
                                    mCsjFeedAd.setExpressRenderListener(new MediationExpressRenderListener() {
                                        @Override
                                        public void onRenderFail(View view, String msg, int code) {
                                            Log.e("AdSdk", "穿山甲信息流广告渲染失败, code: " + code + ", msg: " + msg);
                                            webView.evaluateJavascript("window.onFeedAdError && window.onFeedAdError('广告渲染失败');", null);
                                        }

                                        @Override
                                        public void onAdClick() {
                                            Log.d("AdSdk", "穿山甲信息流广告被点击");
                                        }

                                        @Override
                                        public void onAdShow() {
                                            Log.d("AdSdk", "穿山甲信息流广告曝光");
                                        }

                                        @Override
                                        public void onRenderSuccess(View view, float width, float height, boolean isExpress) {
                                            Log.d("AdSdk", "穿山甲信息流广告渲染成功");
                                            // 注意：必须用getAdView()，不能用回调参数中的view
                                            View adView = mCsjFeedAd.getAdView();
                                            if (adView == null) {
                                                webView.evaluateJavascript("window.onFeedAdError && window.onFeedAdError('广告View为空');", null);
                                                return;
                                            }
                                            // 获取容器位置并展示
                                            String js = "(function(){" +
                                                "var el=document.getElementById('" + containerId + "');" +
                                                "if(!el)return null;" +
                                                "var r=el.getBoundingClientRect();" +
                                                "return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});" +
                                                "})()";
                                            webView.evaluateJavascript(js, (result) -> {
                                                float x = 0, y = 0, w = 0, h = 0;
                                                if (result != null && !result.equals("null")) {
                                                    try {
                                                        result = result.replace("\\\"", "").replace("\"", "");
                                                        String[] parts = result.replace("{","").replace("}","").split(",");
                                                        for (String p : parts) {
                                                            String[] kv = p.split(":");
                                                            if (kv.length == 2) {
                                                                float v = Float.parseFloat(kv[1]);
                                                                switch(kv[0]) {
                                                                    case "x": x = v; break;
                                                                    case "y": y = v; break;
                                                                    case "w": w = v; break;
                                                                    case "h": h = v; break;
                                                                }
                                                            }
                                                        }
                                                    } catch (Exception e) {
                                                        Log.e("AdSdk", "解析位置失败: " + e.getMessage());
                                                    }
                                                }
                                                Log.d("AdSdk", "容器位置: x=" + x + " y=" + y + " w=" + w + " h=" + h);
                                                showFeedAdInView(adView, x, y, w, h, "topFeedAdContainer".equals(containerId));
                                            });
                                        }
                                    });
                                    mCsjFeedAd.render();
                                }
                            });
                        });
                    } catch (Exception e) {
                        isFeedAdLoading = false;
                        Log.e("AdSdk", "loadFeedAd异常: " + e.getMessage());
                    }
                });
            }

            /**
             * 销毁信息流广告
             */
            @JavascriptInterface
            public void destroyFeedAd() {
                runOnUiThread(() -> destroyFeedAdInternal());
            }

            /**
             * 用户同意隐私政策，保存标志
             */
            @JavascriptInterface
            public void setPrivacyAgreed() {
                SharedPreferences prefs = getSharedPreferences(CNAIChatApplication.AD_PREFS_NAME, MODE_PRIVATE);
                prefs.edit().putBoolean("privacy_agreed", true).apply();
                Log.d("MainActivity", "用户已同意隐私政策，已保存 privacy_agreed=true");
            }

            // ========== 内置终端 ==========

            @JavascriptInterface
            public String executeLocalCommand(String command, int timeoutSec) {
                if (terminalExecutor == null) {
                    terminalExecutor = new TerminalExecutor(MainActivity.this);
                }
                return terminalExecutor.execute(command, timeoutSec);
            }

            @JavascriptInterface
            public void executeLocalCommandAsync(String command, int timeoutSec, String callbackId) {
                if (terminalExecutor == null) {
                    terminalExecutor = new TerminalExecutor(MainActivity.this);
                }
                terminalExecutor.executeAsync(command, timeoutSec, callbackId, webView, MainActivity.this);
            }

            @JavascriptInterface
            public void cancelLocalCommand() {
                if (terminalExecutor != null) {
                    terminalExecutor.cancel();
                }
            }

            @JavascriptInterface
            public boolean isBusyboxReady() {
                if (terminalExecutor == null) {
                    terminalExecutor = new TerminalExecutor(MainActivity.this);
                }
                return terminalExecutor.isBusyboxReady();
            }

            @JavascriptInterface
            public String installBusyboxNow() {
                if (terminalExecutor == null) {
                    terminalExecutor = new TerminalExecutor(MainActivity.this);
                }
                return terminalExecutor.installBusyboxSync();
            }

            @JavascriptInterface
            public void reinstallBusybox() {
                if (terminalExecutor == null) {
                    terminalExecutor = new TerminalExecutor(MainActivity.this);
                }
                terminalExecutor.reinstallBusybox();
            }

            @JavascriptInterface
            public String getTerminalHomePath() {
                if (terminalExecutor == null) {
                    terminalExecutor = new TerminalExecutor(MainActivity.this);
                }
                return terminalExecutor.getHomePath();
            }

            @JavascriptInterface
            public String listTerminalCommands() {
                if (terminalExecutor == null) {
                    terminalExecutor = new TerminalExecutor(MainActivity.this);
                }
                return terminalExecutor.listAvailableCommands();
            }

        }, "AndroidBridge");
        
        Log.d("MainActivity", "JavaScript 接口已设置");
    }

    /**
     * 在WebView上层展示模板广告View
     */
    private void showFeedAdInView(View adView, float cssX, float cssY, float cssW, float cssH) {
        showFeedAdInView(adView, cssX, cssY, cssW, cssH, false);
    }

    private void showFeedAdInView(View adView, float cssX, float cssY, float cssW, float cssH, boolean showCountdown) {
        if (adView == null) {
            Log.e("AdSdk", "穿山甲信息流广告View为空");
            webView.evaluateJavascript("window.onFeedAdError && window.onFeedAdError('广告View为空');", null);
            return;
        }

        // CSS像素转物理像素
        float density = getResources().getDisplayMetrics().density;
        float x = cssX * density;
        float y = cssY * density;
        float w = cssW * density;
        Log.d("AdSdk", "物理像素: x=" + x + " y=" + y + " w=" + w + " density=" + density);

        // 移除旧广告View
        if (mFeedAdView != null) {
            FrameLayout root = (FrameLayout) webView.getParent();
            root.removeView(mFeedAdView);
            mFeedAdView = null;
        }

        // 将广告View覆盖到WebView上层，水平居中
        FrameLayout root = (FrameLayout) webView.getParent();
        int adWidth = (int) w > 0 ? (int) w : FrameLayout.LayoutParams.MATCH_PARENT;
        FrameLayout.LayoutParams overlayLp = new FrameLayout.LayoutParams(
            adWidth,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        overlayLp.gravity = android.view.Gravity.TOP | android.view.Gravity.CENTER_HORIZONTAL;
        overlayLp.topMargin = (int) y;
        adView.setLayoutParams(overlayLp);
        root.addView(adView);

        if (showCountdown) {
            // "广告"标签（左上角）
            android.widget.TextView adLabel = new android.widget.TextView(this);
            adLabel.setId(android.view.View.generateViewId());
            adLabel.setText("广告");
            adLabel.setTextColor(0xFFFFFFFF);
            adLabel.setTextSize(11);
            adLabel.setPadding(24, 8, 24, 8);
            android.graphics.drawable.GradientDrawable labelBg = new android.graphics.drawable.GradientDrawable();
            labelBg.setColor(0x99000000);
            labelBg.setCornerRadius(30);
            adLabel.setBackground(labelBg);
            FrameLayout.LayoutParams labelLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            );
            labelLp.gravity = android.view.Gravity.TOP | android.view.Gravity.LEFT;
            labelLp.leftMargin = 16;
            labelLp.topMargin = (int) y + 8;
            adLabel.setLayoutParams(labelLp);
            root.addView(adLabel);
            adLabel.bringToFront();
            mFeedAdLabelView = adLabel;

            // 倒计时TextView（右上角）
            android.widget.TextView countdownText = new android.widget.TextView(this);
            countdownText.setId(android.view.View.generateViewId());
            countdownText.setText("10");
            countdownText.setTextColor(0xFFFFFFFF);
            countdownText.setTextSize(11);
            countdownText.setPadding(24, 8, 24, 8);
            android.graphics.drawable.GradientDrawable cdBg = new android.graphics.drawable.GradientDrawable();
            cdBg.setColor(0x99000000);
            cdBg.setCornerRadius(30);
            countdownText.setBackground(cdBg);
            FrameLayout.LayoutParams cdLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            );
            cdLp.gravity = android.view.Gravity.TOP | android.view.Gravity.RIGHT;
            cdLp.rightMargin = 16;
            cdLp.topMargin = (int) y + 8;
            countdownText.setLayoutParams(cdLp);
            root.addView(countdownText);
            countdownText.bringToFront();

            // 倒计时Handler
            final android.widget.TextView finalCdText = countdownText;
            final int[] cdSec = {10};
            final android.os.Handler cdHandler = new android.os.Handler(android.os.Looper.getMainLooper());
            final Runnable cdRunnable = new Runnable() {
                @Override
                public void run() {
                    cdSec[0]--;
                    if (cdSec[0] <= 0) {
                        finalCdText.setText("0");
                        // 倒计时结束，通知JS关闭广告
                        webView.evaluateJavascript("window.onTopFeedAdExpire && window.onTopFeedAdExpire();", null);
                    } else {
                        finalCdText.setText(cdSec[0] + "");
                        cdHandler.postDelayed(this, 1000);
                    }
                }
            };
            cdHandler.postDelayed(cdRunnable, 1000);
            mFeedAdCountdownHandler = cdHandler;
            mFeedAdCountdownRunnable = cdRunnable;
            mFeedAdCountdownView = countdownText;
        }

        mFeedAdView = adView;
        mFeedAdBaseY = (int) y;

        // 通知JS广告加载成功
        webView.evaluateJavascript("window.onFeedAdLoaded && window.onFeedAdLoaded();", null);
        Log.d("AdSdk", "穿山甲信息流广告展示成功");
    }

    /**
     * 销毁信息流广告（内部方法）
     */
    private void destroyFeedAdInternal() {
        Log.d("AdSdk", "销毁穿山甲信息流广告");
        if (mFeedAdView != null) {
            // 清理倒计时Handler
            if (mFeedAdCountdownHandler != null && mFeedAdCountdownRunnable != null) {
                mFeedAdCountdownHandler.removeCallbacks(mFeedAdCountdownRunnable);
                mFeedAdCountdownHandler = null;
                mFeedAdCountdownRunnable = null;
            }
            FrameLayout root = (FrameLayout) webView.getParent();
            root.removeView(mFeedAdView);
            if (mFeedAdCountdownView != null) {
                root.removeView(mFeedAdCountdownView);
                mFeedAdCountdownView = null;
            }
            if (mFeedAdLabelView != null) {
                root.removeView(mFeedAdLabelView);
                mFeedAdLabelView = null;
            }
            mFeedAdView = null;
        }
        if (mCsjFeedAd != null) {
            mCsjFeedAd = null;
        }
    }

    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        return (int) (dp * density + 0.5f);
    }

    @Override
    protected void onResume() {
        super.onResume();
        isActivityInForeground = true;
        userRotatedToLandscape = 0; // 重置横屏旋转标记
        Log.d("AdSdk", "onResume 被调用，isResumingFromBackground=" + isResumingFromBackground);

        // 如果之前因在后台而延迟了广告SDK初始化，现在补上
        if (isAdSdkPendingInit) {
            Log.d("AdSdk", "App回到前台，补初始化广告SDK");
            isAdSdkPendingInit = false;
            requestAdPermissions();
        }


    }

    @Override
    protected void onPause() {
        super.onPause();
        isActivityInForeground = false;
        Log.d("AdSdk", "onPause 被调用");
    }

    /**
     * 通过 Java 层 WebSocket 直接发送文件到电脑（二进制分片，不经过 WebView，不 base64）
     */
    /** 逐个发送多个文件到电脑（避免并发连接超出服务端限制） */
    private void sendFilesToPCSequentially(java.util.List<Uri> fileUris) {
        if (fileUris.isEmpty()) return;
        new Thread(() -> {
            for (Uri uri : fileUris) {
                sendFileToPCViaWebSocketSync(uri);
            }
        }).start();
    }

    private void sendFileToPCViaWebSocket(Uri fileUri) {
        new Thread(() -> sendFileToPCViaWebSocketSync(fileUri)).start();
    }

    private void sendFileToPCViaWebSocketSync(Uri fileUri) {
        try {
                // 检查连接信息
                if (pcServerIP == null || pcDeviceToken == null) {
                    runOnUiThread(() -> {
                        webView.evaluateJavascript(
                            "if (typeof showToast === 'function') { showToast('请先连接电脑'); }",
                            null
                        );
                    });
                    return;
                }

                // 获取文件名
                String fileName = "file";
                android.database.Cursor cursor = getContentResolver().query(fileUri, null, null, null, null);
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) {
                        fileName = cursor.getString(nameIndex);
                    }
                    cursor.close();
                }

                // 获取文件大小
                InputStream sizeStream = getContentResolver().openInputStream(fileUri);
                int fileSize = sizeStream.available();
                // available() 可能不精确，尝试循环读取来获取真实大小
                byte[] skipBuf = new byte[8192];
                int totalRead = 0;
                int r;
                while ((r = sizeStream.read(skipBuf)) != -1) {
                    totalRead += r;
                }
                sizeStream.close();
                fileSize = totalRead;

                final String finalFileName = fileName;
                final int finalFileSize = fileSize;

                Log.d("FileTransfer", "开始发送文件: " + finalFileName + " 大小: " + finalFileSize);

                // 通知 JS 显示进度
                runOnUiThread(() -> {
                    webView.evaluateJavascript(
                        "if (typeof pcConnection !== 'undefined' && pcConnection) {" +
                        "  var el = document.getElementById('pcTransferProgress');" +
                        "  if (el) { el.style.display = 'block'; }" +
                        "  var fn = document.getElementById('pcTransferFileName');" +
                        "  if (fn) { fn.textContent = '" + finalFileName.replace("'", "\\'") + "'; }" +
                        "  var pct = document.getElementById('pcTransferPercent');" +
                        "  if (pct) { pct.textContent = '连接中...'; }" +
                        "  var bar = document.getElementById('pcTransferBar');" +
                        "  if (bar) { bar.style.width = '0%'; }" +
                        "}",
                        null
                    );
                });

                // 用 CountDownLatch 等待 WebSocket 连接建立
                CountDownLatch connectLatch = new CountDownLatch(1);
                CountDownLatch completeLatch = new CountDownLatch(1);
                final WebSocket[] wsHolder = new WebSocket[1];

                // 建立 OkHttp WebSocket 连接
                OkHttpClient client = new OkHttpClient.Builder()
                    .readTimeout(0, java.util.concurrent.TimeUnit.MINUTES)
                    .writeTimeout(0, java.util.concurrent.TimeUnit.MINUTES)
                    .build();

                // IPv6地址需要用方括号包裹
                String wsHost = pcServerIP.contains(":") ? "[" + pcServerIP + "]" : pcServerIP;
                Request request = new Request.Builder()
                    .url("ws://" + wsHost + ":9876")
                    .build();

                WebSocketListener wsListener = new WebSocketListener() {
                    @Override
                    public void onOpen(WebSocket webSocket, Response response) {
                        Log.d("FileTransfer", "WebSocket已连接");
                        wsHolder[0] = webSocket;
                        connectLatch.countDown();
                    }

                    @Override
                    public void onMessage(WebSocket webSocket, String text) {
                        try {
                            org.json.JSONObject json = new org.json.JSONObject(text);
                            String type = json.optString("type", "");
                            if ("file_send_progress".equals(type)) {
                                int progress = json.optInt("progress", 0);
                                runOnUiThread(() -> {
                                    webView.evaluateJavascript(
                                        "var pct = document.getElementById('pcTransferPercent');" +
                                        "if (pct) { pct.textContent = '" + progress + "%'; }" +
                                        "var bar = document.getElementById('pcTransferBar');" +
                                        "if (bar) { bar.style.width = '" + progress + "%'; }" +
                                        "if (typeof showTransferProgress === 'function') { showTransferProgress('" + finalFileName.replace("'", "\\'") + "', " + progress + "); }",
                                        null
                                    );
                                });
                            } else if ("file_send_complete".equals(type)) {
                                runOnUiThread(() -> {
                                    webView.evaluateJavascript(
                                        "var pct = document.getElementById('pcTransferPercent');" +
                                        "if (pct) { pct.textContent = '✓ 完成'; }" +
                                        "var bar = document.getElementById('pcTransferBar');" +
                                        "if (bar) { bar.style.width = '100%'; }" +
                                        "if (typeof hideTransferProgress === 'function') { hideTransferProgress(); }" +
                                        "if (typeof showToast === 'function') { showToast('文件已发送到电脑: " + finalFileName.replace("'", "\\'") + "'); }",
                                        null
                                    );
                                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                                        webView.evaluateJavascript(
                                            "var el = document.getElementById('pcTransferProgress'); if (el) { el.style.display = 'none'; }",
                                            null
                                        );
                                    }, 3000);
                                });
                                completeLatch.countDown();
                            }
                        } catch (Exception e) {
                            Log.e("FileTransfer", "解析服务器消息失败", e);
                        }
                    }

                    @Override
                    public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                        Log.e("FileTransfer", "WebSocket失败", t);
                        connectLatch.countDown();
                        completeLatch.countDown();
                    }

                    @Override
                    public void onClosed(WebSocket webSocket, int code, String reason) {
                        Log.d("FileTransfer", "WebSocket关闭: " + code + " " + reason);
                        completeLatch.countDown();
                    }
                };

                WebSocket ws = client.newWebSocket(request, wsListener);

                // 等待连接建立（最多10秒）
                if (!connectLatch.await(10, java.util.concurrent.TimeUnit.SECONDS)) {
                    throw new Exception("WebSocket连接超时");
                }
                if (wsHolder[0] == null) {
                    throw new Exception("WebSocket连接失败");
                }

                // 发送认证
                String authMsg = "{\"type\":\"auth\",\"token\":\"" + pcDeviceToken + "\"}";
                ws.send(authMsg);
                Thread.sleep(500);

                // 发送 file_send_start
                String transferId = "file_" + System.currentTimeMillis();
                String startMsg = "{\"type\":\"file_send_start\",\"id\":\"" + transferId + "\",\"fileName\":\"" + finalFileName.replace("\"", "\\\"") + "\",\"fileSize\":" + finalFileSize + "}";
                ws.send(startMsg);
                Thread.sleep(500);

                // 分片读取并发送二进制数据
                InputStream inputStream = getContentResolver().openInputStream(fileUri);
                int CHUNK_SIZE = 512 * 1024; // 512KB
                byte[] buffer = new byte[CHUNK_SIZE];
                int sent = 0;

                while (true) {
                    int bytesRead = 0;
                    while (bytesRead < CHUNK_SIZE) {
                        int n = inputStream.read(buffer, bytesRead, CHUNK_SIZE - bytesRead);
                        if (n == -1) break;
                        bytesRead += n;
                    }
                    if (bytesRead == 0) break;

                    // 流控：等待缓冲区排空（缓冲区超过 8MB 时等待）
                    while (ws.queueSize() > 8 * 1024 * 1024) {
                        Thread.sleep(50);
                    }

                    // 先发 JSON 头标识分片信息
                    String chunkHeader = "{\"type\":\"file_chunk\",\"id\":\"" + transferId + "\",\"binary\":true,\"size\":" + bytesRead + "}";
                    ws.send(chunkHeader);
                    // 再发二进制数据
                    ByteString chunk = ByteString.of(buffer, 0, bytesRead);
                    ws.send(chunk);

                    sent += bytesRead;
                    Log.d("FileTransfer", "已发送: " + sent + "/" + finalFileSize + " 缓冲区: " + ws.queueSize());
                }

                inputStream.close();

                // 发送完成
                String endMsg = "{\"type\":\"file_send_end\",\"id\":\"" + transferId + "\"}";
                ws.send(endMsg);

                Log.d("FileTransfer", "文件发送完成: " + finalFileName);

                // 等待服务器确认后关闭
                completeLatch.await(30, java.util.concurrent.TimeUnit.SECONDS);
                ws.close(1000, "done");

        } catch (Exception e) {
            Log.e("FileTransfer", "发送文件失败", e);
            runOnUiThread(() -> {
                webView.evaluateJavascript(
                    "if (typeof showToast === 'function') { showToast('发送文件失败: " + e.getMessage().replace("'", "\\'") + "'); }",
                    null
                );
            });
        }
    }
}