import android.content.Context;
import android.content.Intent;

public class TermuxCall {
    public static void main(String[] args) {
        try {
            Intent intent = new Intent();
            intent.setClassName("com.termux", "com.termux.app.RunCommandService");
            intent.setAction("com.termux.RUN_COMMAND");
            intent.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
            intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", "echo hello > /sdcard/termux_test.txt"});
            intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home");
            intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            
            // 获取 ActivityThread 来 startService
            Class<?> atClass = Class.forName("android.app.ActivityThread");
            java.lang.reflect.Method currentAT = atClass.getMethod("currentActivityThread");
            Object at = currentAT.invoke(null);
            java.lang.reflect.Method getApplication = atClass.getMethod("getApplication");
            android.app.Application app = (android.app.Application) getApplication.invoke(at);
            
            app.startService(intent);
            System.out.println("SUCCESS");
        } catch (Exception e) {
            System.out.println("ERROR: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
