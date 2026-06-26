// ==================== 使用点模块 ====================

const UsagePoints = (() => {
    // ========== 配置 ==========
    const STORAGE_KEY = 'cnai_usage_points';          // localStorage key

    // ========== 状态 ==========
    let currentPoints = 0;

    // ========== 初始化 ==========
    function init() {
        const saved = localStorage.getItem(STORAGE_KEY);
        currentPoints = parseInt(saved) || 0;
    }

    /**
     * 增加使用点（发送消息时调用）
     */
    function addPoint(points) {
        currentPoints += points;
        localStorage.setItem(STORAGE_KEY, currentPoints.toString());
        if (typeof updateUsagePointsDisplay === 'function') updateUsagePointsDisplay();
    }

    /**
     * 重置使用点
     */
    function resetPoints() {
        currentPoints = 0;
        localStorage.setItem(STORAGE_KEY, '0');
        if (typeof updateUsagePointsDisplay === 'function') updateUsagePointsDisplay();
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
        return 999; // 仅保留使用次数统计，不触发任何广告
    }

    // ========== 公开 API ==========
    return {
        init,
        addPoint,
        resetPoints,
        getPoints,
        getThreshold,
    };
})();