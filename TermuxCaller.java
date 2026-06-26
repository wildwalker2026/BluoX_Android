import android.content.Intent;

public class TermuxCaller {
    public static void main(String[] args) {
        try {
            Intent intent = new Intent();
            intent.setClassName("com.termux", "com.termux.app.RunCommandService");
            intent.setAction("com.termux.RUN_COMMAND");
            intent.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
            intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", "echo hello > /sdcard/termux_test.txt"});
            intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home");
            intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            
            // 用 am 来发送 intent
            Runtime.getRuntime().exec(new String[]{
                "am", "startservice",
                "-n", "com.termux/com.termux.app.RunCommandService",
                "-a", "com.termux.RUN_COMMAND",
                "--es", "com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash",
                "--esa", "com.termux.RUN_COMMAND_ARGUMENTS", "-c,echo hello > /sdcard/termux_test.txt",
                "--es", "com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home",
                "--ez", "com.termux.RUN_COMMAND_BACKGROUND", "true"
            }).waitFor();
            System.out.println("DONE");
        } catch (Exception e) {
            System.out.println("ERROR: " + e.getMessage());
        }
    }
}
