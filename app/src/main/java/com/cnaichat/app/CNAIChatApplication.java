package com.cnaichat.app;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

// GDT 已停用
// import com.qq.e.comm.managers.GDTAdSdk;
// import com.qq.e.comm.managers.status.SDKStatus;

import com.bytedance.sdk.openadsdk.TTAdSdk;
import com.bytedance.sdk.openadsdk.TTAdConfig;
import com.bytedance.sdk.openadsdk.TTAdConstant;

public class CNAIChatApplication extends Application {

    // GDT 已停用
    // private static final String GDT_APP_ID = "1216302353";
    private static final String CSJ_APP_ID = "5807825";  // 穿山甲 APP_ID
    private static boolean isAdSdkStarted = false;       // GDT SDK 就绪状态（已停用）
    private static boolean isCsjAdSdkStarted = false;    // 穿山甲 SDK 就绪状态
    private static Application appContext = null;

    // 广告配置本地存储 key
    public static final String AD_PREFS_NAME = "cnaichat_ad_config";

    public interface AdSdkInitCallback {
        void onAdSdkInitSuccess();
    }
    private static AdSdkInitCallback adSdkInitCallback = null;

    // 穿山甲 SDK 就绪回调
    public interface CsjAdSdkCallback {
        void onCsjAdSdkReady();
    }
    private static CsjAdSdkCallback csjAdSdkCallback = null;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d("CNAIChatApplication", "Application onCreate");
        appContext = this;

        // 隐私合规：只有用户已同意隐私政策且上次配置开启了广告，才在启动时初始化穿山甲 SDK
        SharedPreferences prefs = getSharedPreferences(AD_PREFS_NAME, MODE_PRIVATE);

        // 兼容老用户：如果 privacy_agreed 还没设置过，但用户已完成过引导（非首次启动），自动补上
        if (!prefs.contains("privacy_agreed")) {
            SharedPreferences appPrefs = getSharedPreferences("cnaichat_prefs", MODE_PRIVATE);
            boolean isFirstLaunch = appPrefs.getBoolean("is_first_launch", true);
            if (!isFirstLaunch) {
                prefs.edit().putBoolean("privacy_agreed", true).apply();
                Log.d("AdSdk", "兼容老用户：检测到已完成引导，自动设置 privacy_agreed=true");
            }
        }

        boolean privacyAgreed = prefs.getBoolean("privacy_agreed", false);
        boolean lastAdEnabled = prefs.getBoolean("ad_enabled", false); // 默认 false
        if (privacyAgreed && lastAdEnabled) {
            Log.d("AdSdk", "用户已同意隐私政策且 ad_enabled=true，启动时初始化穿山甲 SDK");
            initCsjAdSdk();
        } else {
            Log.d("AdSdk", "用户未同意隐私政策或 ad_enabled=false，跳过穿山甲 SDK 初始化");
        }

        // GDT SDK 已停用，不再初始化
    }

    public static void setAdSdkInitCallback(AdSdkInitCallback callback) {
        adSdkInitCallback = callback;
    }

    public static void setCsjAdSdkCallback(CsjAdSdkCallback callback) {
        csjAdSdkCallback = callback;
        // 如果 SDK 已经就绪了，立即回调
        if (isCsjAdSdkStarted && csjAdSdkCallback != null) {
            csjAdSdkCallback.onCsjAdSdkReady();
        }
    }

    public static void initAdSdk() {
        // GDT 已停用，仅初始化穿山甲
        Log.d("AdSdk", "initAdSdk: GDT已停用，仅初始化穿山甲 SDK");

        /*
        if (isAdSdkStarted) {
            Log.d("AdSdk", "GDT广告SDK已启动，跳过重复初始化");
            return;
        }
        if (appContext == null) {
            Log.e("AdSdk", "Application context 为空，无法启动广告 SDK");
            return;
        }

        Log.d("AdSdk", "开始启动 GDT 广告 SDK，APPID: " + GDT_APP_ID);

        try {
            // 隐私合规：禁止SDK收集已安装包名列表
            try {
                Class<?> globalSettingClass = Class.forName("com.qq.e.comm.managers.setting.GlobalSetting");
                java.lang.reflect.Method method = globalSettingClass.getDeclaredMethod("setEnableCollectAppInstallStatus", boolean.class);
                method.invoke(null, false);
                Log.d("AdSdk", "已禁止GDT SDK收集已安装包名列表");
            } catch (Exception e) {
                Log.w("AdSdk", "设置隐私配置失败: " + e.getMessage());
            }
            GDTAdSdk.initWithoutStart(appContext, GDT_APP_ID);
            GDTAdSdk.start(new GDTAdSdk.OnStartListener() {
                @Override
                public void onStartSuccess() {
                    Log.d("AdSdk", "GDT 广告 SDK 启动成功");
                    isAdSdkStarted = true;
                    if (adSdkInitCallback != null) {
                        adSdkInitCallback.onAdSdkInitSuccess();
                    }
                }

                @Override
                public void onStartFailed(Exception e) {
                    Log.e("AdSdk", "GDT 广告 SDK 启动失败: " + e.getMessage());
                    isAdSdkStarted = false;
                }
            });
        } catch (Exception e) {
            Log.e("AdSdk", "GDT SDK start 异常", e);
        }
        */

        // 如果穿山甲还没初始化（上次配置为false但本次fetchAdConfig确认ad_enabled=true），补初始化
        initCsjAdSdk();
    }

    public static boolean isAdSdkReady() {
        // GDT 已停用，以穿山甲 SDK 状态为准
        return isCsjAdSdkStarted;
    }

    /**
     * 初始化穿山甲 SDK
     */
    private static void initCsjAdSdk() {
        if (isCsjAdSdkStarted) {
            Log.d("AdSdk", "穿山甲SDK已启动，跳过重复初始化");
            return;
        }
        if (appContext == null) {
            Log.e("AdSdk", "Application context 为空，无法启动穿山甲 SDK");
            return;
        }

        Log.d("AdSdk", "开始初始化穿山甲 SDK，APPID: " + CSJ_APP_ID);

        try {
            TTAdConfig adConfig = new TTAdConfig.Builder()
                    .appId(CSJ_APP_ID)
                    .appName("小蓝AI盒子")
                    .titleBarTheme(TTAdConstant.TITLE_BAR_THEME_DARK)
                    .allowShowNotify(true)
                    .debug(false)
                    .directDownloadNetworkType(TTAdConstant.NETWORK_STATE_WIFI)
                    .supportMultiProcess(false)
                    .useMediation(true)  // 开启 GroMore 聚合
                    .build();

            TTAdSdk.init(appContext, adConfig);
            TTAdSdk.start(new TTAdSdk.Callback() {
                @Override
                public void success() {
                    Log.d("AdSdk", "穿山甲 SDK 启动成功");
                    isCsjAdSdkStarted = true;
                    if (csjAdSdkCallback != null) {
                        csjAdSdkCallback.onCsjAdSdkReady();
                    }
                }

                @Override
                public void fail(int code, String msg) {
                    Log.e("AdSdk", "穿山甲 SDK 启动失败，code: " + code + ", msg: " + msg);
                    isCsjAdSdkStarted = false;
                }
            });
        } catch (Exception e) {
            Log.e("AdSdk", "穿山甲 SDK init 异常", e);
        }
    }

    /**
     * 穿山甲 SDK 是否就绪
     */
    public static boolean isCsjAdSdkReady() {
        return isCsjAdSdkStarted && TTAdSdk.isSdkReady();
    }
}
