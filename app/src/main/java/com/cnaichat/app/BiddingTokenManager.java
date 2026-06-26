package com.cnaichat.app;

import android.text.TextUtils;
import android.util.Log;

// GDT 已停用
// import com.qq.e.comm.managers.GDTAdSdk;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * C2S 竞价 Token 管理器（GDT 已停用）
 * C2S模式下直接用 buyerId 作为 token 传给广告构造函数
 */
public class BiddingTokenManager {
    private static final String TAG = "AdSdk";
    public static final ExecutorService SINGLE_THREAD_EXECUTOR =
            Executors.newSingleThreadExecutor(r -> new Thread(r, "BIDDING_THREAD"));

    public static void requestBiddingToken(String posId, BiddingTokenCallback callback) {
        SINGLE_THREAD_EXECUTOR.execute(() -> {
            // GDT 已停用，直接回调错误
            Log.w(TAG, "GDT 已停用，竞价token不可用");
            callback.onError("GDT 已停用");

            /*
            try {
                Map<String, Object> buyerMap = new HashMap<>();
                String buyerId = GDTAdSdk.getGDTAdManger().getBuyerId(buyerMap);
                Log.d(TAG, "C2S buyerId: " + buyerId);

                if (!TextUtils.isEmpty(buyerId)) {
                    Log.d(TAG, "C2S竞价token就绪: " + buyerId);
                    callback.onTokenReady(buyerId);
                } else {
                    Log.w(TAG, "buyerId为空，降级为普通模式");
                    callback.onError("buyerId为空");
                }
            } catch (Exception e) {
                Log.e(TAG, "获取竞价token异常: " + e.getMessage(), e);
                callback.onError(e.getMessage());
            }
            */
        });
    }

    public interface BiddingTokenCallback {
        void onTokenReady(String token);
        void onError(String msg);
    }
}
