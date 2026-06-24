package com.cnaichat.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

/**
 * Termux RUN_COMMAND 结果接收器
 *
 * 当通过 TermuxService 执行命令并传入 PendingIntent 时，
 * Termux 会将执行结果（stdout / stderr / exitCode）回传到此 Receiver。
 *
 * 结果会转发给 TermuxBridge 中注册的回调。
 */
public class TermuxResultReceiver extends BroadcastReceiver {

    private static final String TAG = "TermuxResultReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "收到 Termux 执行结果");

        // 从 Intent 中取出原始 PendingIntent 的 extra
        Bundle resultBundle = intent.getBundleExtra("com.termux.service.EXTRA_PLUGIN_RESULT_BUNDLE");
        if (resultBundle == null) {
            // 尝试其他可能的 key
            resultBundle = intent.getExtras();
        }

        if (resultBundle == null) {
            Log.w(TAG, "结果 Bundle 为空");
            TermuxBridge.notifyResult(null, -1, "", "结果为空");
            return;
        }

        // 提取 stdout / stderr / exitCode
        String stdout = resultBundle.getString("com.termux.service.EXTRA_PLUGIN_RESULT_BUNDLE_STDOUT", "");
        String stderr = resultBundle.getString("com.termux.service.EXTRA_PLUGIN_RESULT_BUNDLE_STDERR", "");
        int exitCode = resultBundle.getInt("com.termux.service.EXTRA_PLUGIN_RESULT_BUNDLE_EXIT_CODE", -1);
        String err = resultBundle.getString("com.termux.service.EXTRA_PLUGIN_RESULT_BUNDLE_ERRORS", "");

        Log.d(TAG, "exitCode=" + exitCode + ", stdout.len=" + stdout.length() + ", stderr.len=" + stderr.length());

        // 转发给 TermuxBridge
        TermuxBridge.notifyResult(null, exitCode, stdout, stderr + (err.isEmpty() ? "" : "\n" + err));
    }
}
