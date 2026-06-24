package com.cnaichat.app;

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.graphics.Color;
import android.view.Gravity;
import android.widget.Toast;

public class AgreementActivity extends Activity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";

    private WebView webView;
    private ProgressDialog progressDialog;
    private LinearLayout rootLayout;
    private TextView errorTextView;
    private Button retryButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.d("AgreementActivity", "onCreate called");

        try {
            // 获取传递的参数
            String url = getIntent().getStringExtra(EXTRA_URL);
            String title = getIntent().getStringExtra(EXTRA_TITLE);
            Log.d("AgreementActivity", "url=" + url + ", title=" + title);

            // 创建根布局
            rootLayout = new LinearLayout(this);
            rootLayout.setLayoutParams(new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.MATCH_PARENT));
            rootLayout.setOrientation(LinearLayout.VERTICAL);
            rootLayout.setBackgroundColor(Color.WHITE);

            // 创建标题栏
            LinearLayout titleBar = new LinearLayout(this);
            titleBar.setLayoutParams(new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT));
            titleBar.setOrientation(LinearLayout.HORIZONTAL);
            titleBar.setBackgroundColor(Color.parseColor("#0f0f0f"));
            titleBar.setPadding(30, 0, 30, 0);
            titleBar.setGravity(Gravity.CENTER_VERTICAL);

            // 返回按钮
            Button backButton = new Button(this);
            backButton.setText("返回");
            backButton.setTextColor(Color.WHITE);
            backButton.setBackgroundColor(Color.TRANSPARENT);
            backButton.setOnClickListener(v -> finish());

            titleBar.addView(backButton);

            // 弹性空白，把右侧按钮推到最右
            View spacer = new View(this);
            LinearLayout.LayoutParams spacerParams = new LinearLayout.LayoutParams(
                    0, 1, 1.0f);
            titleBar.addView(spacer, spacerParams);

            // 外部浏览器按钮（地球图标）
            Button browserButton = new Button(this);
            browserButton.setText("\uD83C\uDF10");
            browserButton.setTextSize(20);
            browserButton.setBackgroundColor(Color.TRANSPARENT);
            browserButton.setContentDescription("使用外部浏览器浏览");
            browserButton.setOnClickListener(v -> {
                String currentUrl = (webView.getUrl() != null) ? webView.getUrl() : url;
                if (currentUrl != null) {
                    try {
                        Intent browserIntent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(currentUrl));
                        startActivity(browserIntent);
                    } catch (Exception e) {
                        Toast.makeText(this, "无法打开外部浏览器", Toast.LENGTH_SHORT).show();
                    }
                }
            });

            titleBar.addView(browserButton);
            rootLayout.addView(titleBar);

            // 创建错误提示布局（初始隐藏）
            LinearLayout errorLayout = new LinearLayout(this);
            errorLayout.setLayoutParams(new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.MATCH_PARENT));
            errorLayout.setOrientation(LinearLayout.VERTICAL);
            errorLayout.setGravity(Gravity.CENTER);
            errorLayout.setVisibility(View.GONE);
            errorLayout.setPadding(50, 50, 50, 50);

            errorTextView = new TextView(this);
            errorTextView.setText("页面加载失败");
            errorTextView.setTextColor(Color.parseColor("#666666"));
            errorTextView.setTextSize(16);
            errorTextView.setGravity(Gravity.CENTER);
            errorTextView.setPadding(0, 0, 0, 30);

            retryButton = new Button(this);
            retryButton.setText("重试");
            retryButton.setTextColor(Color.WHITE);
            retryButton.setBackgroundColor(Color.parseColor("#667eea"));
            retryButton.setPadding(60, 20, 60, 20);
            retryButton.setOnClickListener(v -> {
                errorLayout.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
                if (url != null) {
                    webView.loadUrl(url);
                }
            });

            errorLayout.addView(errorTextView);
            errorLayout.addView(retryButton);
            rootLayout.addView(errorLayout);

            // 创建 WebView
            webView = new WebView(this);
            webView.setLayoutParams(new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    1.0f));
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setLoadWithOverviewMode(true);
            webView.getSettings().setUseWideViewPort(true);

            // 设置 WebViewClient 处理加载事件
            final String finalUrl = url;
            final LinearLayout finalErrorLayout = errorLayout;
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                }

                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    webView.setVisibility(View.GONE);
                    finalErrorLayout.setVisibility(View.VISIBLE);
                    errorTextView.setText("页面加载失败: " + description);
                    Log.e("AgreementActivity", "加载错误: " + description);
                }
            });

            // 设置 WebChromeClient 显示进度
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onProgressChanged(WebView view, int newProgress) {
                    if (progressDialog != null) {
                        progressDialog.setProgress(newProgress);
                    }
                }
            });

            rootLayout.addView(webView);

            setContentView(rootLayout);
            Log.d("AgreementActivity", "setContentView done");

            // 加载URL
            if (url != null) {
                webView.loadUrl(url);
                Log.d("AgreementActivity", "loadUrl done: " + url);
            }
        } catch (Exception e) {
            Log.e("AgreementActivity", "Error in onCreate", e);
            Toast.makeText(this, "启动失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (progressDialog != null) {
            progressDialog.dismiss();
        }
    }
}
