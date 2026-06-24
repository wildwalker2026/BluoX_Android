package com.cnaichat.app;

import android.util.Log;

// GDT 已停用
// import com.qq.e.comm.constants.BiddingLossReason;
// import com.qq.e.comm.pi.IBidding;
// import com.qq.e.comm.pi.IBiddingLoss;

import java.util.HashMap;

/**
 * C2S 竞价工具类（GDT 已停用）
 */
public class DemoBiddingC2SUtils {

  private static final String TAG = "AdSdk";

  private static int reportBiddingWinLoss = -1;

  public static final int REPORT_BIDDING_DISABLE = -1;
  public static final int REPORT_BIDDING_WIN = 0;
  // GDT 已停用，以下常量值固定
  public static final int REPORT_BIDDING_LOSS_LOW_PRICE = 101; // BiddingLossReason.LOW_PRICE
  public static final int REPORT_BIDDING_LOSS_NO_AD = 102; // BiddingLossReason.NO_AD
  public static final int REPORT_BIDDING_LOSS_NOT_COMPETITION = 103; // BiddingLossReason.NOT_COMPETITION
  public static final int REPORT_BIDDING_LOSS_OTHER = 104; // BiddingLossReason.OTHER

  public static void setReportBiddingWinLoss(int reportBiddingWinLoss) {
    DemoBiddingC2SUtils.reportBiddingWinLoss = reportBiddingWinLoss;
  }

  /**
   * 广告加载成功，上报竞胜（GDT 已停用，空实现）
   */
  public static void reportWin(Object ad) {
    Log.d(TAG, "C2S竞价上报: 竞胜（GDT已停用，跳过）");
  }

  /**
   * 广告加载成功但竞价失败（GDT 已停用，空实现）
   */
  public static void reportLoss(Object ad, int reason) {
    Log.d(TAG, "C2S竞价上报: 竞败, reason=" + reason + "（GDT已停用，跳过）");
  }

  public static void reportBiddingWinLoss(Object ad) {
    // GDT 已停用，空实现
  }

  public static void reportBiddingNoAd(Object ad) {
    // GDT 已停用，空实现
  }
}
