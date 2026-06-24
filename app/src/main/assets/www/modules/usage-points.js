// ==================== 使用点 & 商业化广告模块 ====================

const UsagePoints = (() => {
    // ========== 配置 ==========
    const STORAGE_KEY = 'cnai_usage_points';          // localStorage key
    const STORAGE_KEY_LAST_AD_TIME = 'cnai_last_ad_time'; // 上次广告触发时间的 key
    const THRESHOLD = 10;                             // 触发广告的使用点阈值
    const DECREMENT_ON_AD_FAIL = 1;                   // 广告失败时扣除的使用点
    const AD_INTERVAL_MS = 3600000;                  // 插屏广告触发间隔，1小时
    const STORAGE_KEY_THRESHOLD_OVERRIDE = 'cnai_threshold_override'; // 广告点数阈值覆盖（彩蛋）

    // ========== 状态 ==========
    let currentPoints = 0;
    let isAdShowing = false;       // 广告正在展示
    let lastAdTime = 0;            // 上次广告触发时间
    let pendingRewardHours = 0;    // 待叠加的奖励小时数

    // ========== 初始化 ==========
    function init() {
        // 从 localStorage 读取使用点
        const saved = localStorage.getItem(STORAGE_KEY);
        currentPoints = parseInt(saved) || 0;
        console.log('[AdSdk] 初始化，当前使用点:', currentPoints);
        
        // 从 localStorage 读取上次广告触发时间
        const savedLastAdTime = localStorage.getItem(STORAGE_KEY_LAST_AD_TIME);
        lastAdTime = parseInt(savedLastAdTime) || 0;
        console.log('[AdSdk] 初始化，上次广告触发时间:', lastAdTime);
    }

    // ========== 核心方法 ==========

    /**
     * 增加使用点（发送消息时调用）
     * 达到阈值时自动触发广告展示（非阻塞）
     */
    function addPoint(points) {
        currentPoints+=points;
        localStorage.setItem(STORAGE_KEY, currentPoints.toString());
        console.log('[AdSdk] 使用点 +'+points+', 当前:', currentPoints);
        if (typeof updateUsagePointsDisplay === 'function') updateUsagePointsDisplay();

        if (currentPoints >= getThreshold()) {
            // 达到阈值，触发广告展示（非阻塞）
            checkAndShowAd();
        }
    }

    /**
     * 检查并触发广告展示
     * 广告与消息生成并行执行，不阻塞
     * 按需加载模式：先加载广告，加载成功后自动展示
     */
    function checkAndShowAd() {
        if (isAdShowing) {
            console.log('[AdSdk] 广告正在展示中，跳过重复触发');
            return;
        }

        // 专家模式：弹顶部信息流广告，不走插屏逻辑
        const _expertOn = localStorage.getItem('cnai_expert_mode') === '1';
        if (_expertOn) {
            console.log('[AdSdk] 专家模式，展示顶部信息流广告');
            showTopFeedAd();
            return;
        }

        // 检查广告时间间隔（每小时最多一次）
        const now = Date.now();
        if (now - lastAdTime < AD_INTERVAL_MS) {
            const remainingMs = AD_INTERVAL_MS - (now - lastAdTime);
            const remainingMinutes = Math.ceil(remainingMs / 60000);
            console.log('[AdSdk] 距离上次广告未满' + (AD_INTERVAL_MS / 60000) + '分钟，还剩' + remainingMinutes + '分钟，跳过触发');
            return;
        }

        // Web 端（非 Android 环境）：直接重置，不需要看广告
        if (!window.AndroidBridge) {
            console.log('[AdSdk] Web 端，直接重置使用点');
            resetPoints();
            return;
        }

        // 检查广告 SDK 是否就绪
        if (!window.AndroidBridge.isAdSdkReady || !window.AndroidBridge.isAdSdkReady()) {
            console.log('[AdSdk] 广告 SDK 未就绪，执行降级策略');
            handleAdFallback();
            return;
        }

        // 检查广告是否被服务端配置关闭
        if (window.AndroidBridge.isInterstitialAdEnabled && !window.AndroidBridge.isInterstitialAdEnabled()) {
            console.log('[AdSdk] 插屏广告已被服务器配置关闭，执行降级策略');
            handleAdFallback();
            return;
        }

        // 所有检查通过，确定要进入广告了
        console.log('[AdSdk] 按需加载并展示插屏广告');
        //showPulsingHint();  // 现在才显示"看个广告休息一下~"
        isAdShowing = true;
        
        // 调用 Android 端展示广告
        const success = window.AndroidBridge.showInterstitialAd();
        
        // 如果 Android 端返回 false（广告被关闭），立即重置状态
        if (!success) {
            console.log('[AdSdk] Android 端返回 false，重置 isAdShowing');
            isAdShowing = false;
            hidePulsingHint();
        }
    }

    /**
     * 专家模式：在主界面顶部展示信息流广告，10秒后自动销毁
     */
    let _topFeedAdTimer = null;
    function showTopFeedAd() {
        // 非Android环境直接重置
        if (!window.AndroidBridge || typeof AndroidBridge.loadFeedAd !== 'function') {
            console.log('[AdSdk] 非Android环境，跳过顶部信息流广告');
            resetPoints();
            return;
        }

        // 创建或复用顶部广告容器
        let adBar = document.getElementById('topFeedAdBar');
        if (!adBar) {
            adBar = document.createElement('div');
            adBar.id = 'topFeedAdBar';
            // 背景跟随主题
            adBar.style.cssText = 'width:100%;height:0;overflow:hidden;transition:height 0.3s ease;background:var(--bg-color);position:relative;z-index:100;';
            // 插入到聊天容器前面
            const chatContainer = document.getElementById('chatContainer');
            if (chatContainer && chatContainer.parentNode) {
                chatContainer.parentNode.insertBefore(adBar, chatContainer);
            } else {
                document.body.insertBefore(adBar, document.body.firstChild);
            }
        }

        // 内部广告容器（给Android端定位用），居中
        let inner = document.getElementById('topFeedAdContainer');
        if (!inner) {
            inner = document.createElement('div');
            inner.id = 'topFeedAdContainer';
            inner.style.cssText = 'width:calc(100% - 40px);max-width:400px;margin:0 auto;min-height:100px;';
            adBar.appendChild(inner);
        }

        // 展开容器，高度基于屏幕宽度（宽度的2/3）
        const _adHeight = Math.round(window.innerWidth * 2 / 3);
        adBar.style.height = '0';
        void adBar.offsetHeight;
        adBar.style.height = _adHeight + 'px';

        console.log('[AdSdk] 顶部信息流广告容器已展开，开始加载广告');

        // 加载信息流广告
        if (typeof loadFeedAd === 'function') {
            loadFeedAd('topFeedAdContainer');
        } else if (window.AndroidBridge && AndroidBridge.loadFeedAd) {
            AndroidBridge.loadFeedAd('topFeedAdContainer');
        }

        // 15秒兜底：如果Java回调没触发，强制关闭
        if (_topFeedAdTimer) clearTimeout(_topFeedAdTimer);
        _topFeedAdTimer = setTimeout(() => {
            console.log('[AdSdk] 15秒兜底触发，检查广告是否已关闭');
            if (document.getElementById('topFeedAdBar')) {
                console.log('[AdSdk] 广告仍在，兜底强制关闭');
                onTopFeedAdExpire();
            } else {
                console.log('[AdSdk] 广告已关闭，兜底跳过');
            }
        }, 15000);
    }

    /**
     * 顶部信息流广告到期回调（由Java端倒计时触发）
     */
    function onTopFeedAdExpire() {
        // 已关闭则跳过
        const adBar = document.getElementById('topFeedAdBar');
        if (!adBar) {
            console.log('[AdSdk] 广告已关闭，跳过重复关闭');
            return;
        }
        console.log('[AdSdk] 顶部信息流广告到期，开始销毁');
        // 清除兜底定时器
        if (_topFeedAdTimer) { clearTimeout(_topFeedAdTimer); _topFeedAdTimer = null; }
        if (typeof destroyFeedAd === 'function') destroyFeedAd();
        else if (window.AndroidBridge && AndroidBridge.destroyFeedAd) AndroidBridge.destroyFeedAd();
        adBar.style.height = '0';
        setTimeout(() => { if (adBar.parentNode) adBar.parentNode.removeChild(adBar); }, 300);
        resetPoints();
    }

    /**
     * 广告降级策略：使用点 -10
     */
    function handleAdFallback() {
        currentPoints -= DECREMENT_ON_AD_FAIL;
        if (currentPoints < 0) currentPoints = 0;
        localStorage.setItem(STORAGE_KEY, currentPoints.toString());
        console.log('[AdSdk] 广告未加载，使用点 -' + DECREMENT_ON_AD_FAIL + ', 当前:', currentPoints);
    }

    /**
     * 插屏广告结果回调（由 Android 端通过 evaluateJavascript 调用）
     * @param {boolean} success 插屏广告是否展示完成
     */
    function onInterstitialAdResult(success) {
        console.log('========== [AdSdk] JS onInterstitialAdResult 触发 ==========');
        console.log('[AdSdk] 插屏广告结果:', success);
        console.log('[AdSdk] isAdShowing:', isAdShowing);
        console.log('[AdSdk] currentPoints:', currentPoints);

        // 无论成功失败，都重置状态
        isAdShowing = false;
        hidePulsingHint();

        if (success) {
            console.log('[AdSdk] 插屏广告展示完成，重置使用点');
            // 广告触发时间 = 现在 + 待叠加的奖励小时
            lastAdTime = Date.now() + pendingRewardHours * 3600 * 1000;
            localStorage.setItem(STORAGE_KEY_LAST_AD_TIME, lastAdTime.toString());
            if (pendingRewardHours > 0) {
                console.log('[AdSdk] 已叠加奖励时间' + pendingRewardHours + '小时，下次广告最早:', new Date(lastAdTime).toLocaleString());
                pendingRewardHours = 0;
            } else {
                console.log('[AdSdk] 已记录广告触发时间:', lastAdTime);
            }
            // 重置使用点
            resetPoints();
        } else {
            console.log('[AdSdk] 插屏广告失败，不重置使用点');
            // 插屏广告加载失败，不重置使用点
            console.log('[AdSdk] 使用点保持不变，当前:', currentPoints);
        }
    }

    /**
     * 重置使用点
     */
    function resetPoints() {
        currentPoints = 0;
        localStorage.setItem(STORAGE_KEY, '0');
        console.log('[AdSdk] 使用点已重置');
        if (typeof updateUsagePointsDisplay === 'function') updateUsagePointsDisplay();
    }

    /**
     * 免广告奖励回调（由 Android 端通过 evaluateJavascript 调用）
     * @param {number} hours 获得的免广告小时数
     */
    function onAdFreeReward(hours) {
        console.log('[AdSdk] 获得免广告奖励:', hours, '小时');
        pendingRewardHours += hours;
        console.log('[AdSdk] 待叠加奖励小时数:', pendingRewardHours);
    }

    /**
     * 获取当前使用点数
     */
    function getPoints() {
        return currentPoints;
    }

    /**
     * 获取阈值
     */
    function getThreshold() {
        const override = localStorage.getItem(STORAGE_KEY_THRESHOLD_OVERRIDE);
        if (override) {
            return parseInt(override);
        }
        return THRESHOLD;
    }

    // ========== UI 方法 ==========

    /**
     * 显示脉动提示（标题栏中间）
     */
    function showPulsingHint() {
        const hint = document.getElementById('adPulsingHint');
        if (hint) {
            hint.style.display = '';

            // 创建 toast 提示（替代 alert，支持自动关闭）
            let toast = document.getElementById('adToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'adToast';
                toast.textContent = '看广告休息一下~';
                Object.assign(toast.style, {
                    position: 'fixed',
                    top: '70%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    fontSize: '16px',
                    zIndex: '99999',
                    transition: 'opacity 0.3s'
                });
                document.body.appendChild(toast);
            }
            toast.style.opacity = '1';

            // 3秒后自动隐藏 toast 和脉动提示
            setTimeout(() => {
                if (toast) toast.style.opacity = '0';
                setTimeout(() => {
                    if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
                }, 300);
                hidePulsingHint();
            }, 3000);
        }
    }

    /**
     * 隐藏脉动提示
     */
    function hidePulsingHint() {
        const hint = document.getElementById('adPulsingHint');
        if (hint) {
            hint.style.display = 'none';
        }
    }

    // ========== 公开 API ==========
    return {
        init,
        addPoint,
        onInterstitialAdResult,
        onAdFreeReward,
        resetPoints,
        getPoints,
        getThreshold,
        showPulsingHint,
        hidePulsingHint,
        showTopFeedAd,
        onTopFeedAdExpire
    };
})();

// 暴露插屏广告结果回调到全局（供 Android evaluateJavascript 调用）
window.onInterstitialAdResult = function(success) {
    UsagePoints.onInterstitialAdResult(success);
};

// 暴露顶部信息流广告到期回调到全局（供 Android evaluateJavascript 调用）
window.onTopFeedAdExpire = function() {
    UsagePoints.onTopFeedAdExpire();
};
// 暴露免广告奖励回调到全局（供 Android evaluateJavascript 调用）
window.onAdFreeReward = function(hours) {
    UsagePoints.onAdFreeReward(hours);
};