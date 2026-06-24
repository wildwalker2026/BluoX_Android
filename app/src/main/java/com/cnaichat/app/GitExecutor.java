package com.cnaichat.app;

import android.util.Log;

import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.PullCommand;
import org.eclipse.jgit.api.PullResult;
import org.eclipse.jgit.api.PushCommand;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.api.CheckoutCommand;
import org.eclipse.jgit.api.CloneCommand;
import org.eclipse.jgit.diff.DiffEntry;
import org.eclipse.jgit.diff.DiffFormatter;
import org.eclipse.jgit.diff.RawTextComparator;
import org.eclipse.jgit.treewalk.CanonicalTreeParser;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.api.ResetCommand;
import org.eclipse.jgit.api.CleanCommand;
import org.eclipse.jgit.lib.BranchTrackingStatus;
import org.eclipse.jgit.lib.Ref;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.PushResult;
import org.eclipse.jgit.transport.RemoteRefUpdate;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.eclipse.jgit.transport.RemoteConfig;
import org.eclipse.jgit.transport.URIish;
import org.eclipse.jgit.transport.RefSpec;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.List;
import java.util.Set;

/**
 * JGit 封装：为 AndroidBridge 提供 Git 操作能力
 *
 * 支持操作：clone / init / status / add / commit / push / pull / log / diff / branch / checkout / addremote / remote
 *
 * 所有方法返回 JSON 字符串，供 JS 层解析。
 */
public class GitExecutor {
    private static final String TAG = "GitExecutor";
    private static final int MAX_LOG_COUNT = 50;

    // 当前正在运行的线程（用于取消）
    private volatile Thread currentThread = null;
    private volatile boolean cancelled = false;

    /**
     * 执行 Git 操作
     */
    public String execute(String json) {
        cancelled = false;
        currentThread = Thread.currentThread();
        try {
            if (cancelled) {
                return "{\"cancelled\":true}";
            }
            org.json.JSONObject args = new org.json.JSONObject(json);
            String action = args.optString("action", "");
            String path = args.optString("path", "");

            Log.d(TAG, "Git 操作: " + action + ", path=" + path);

            switch (action) {
                case "clone":
                    return doClone(args);
                case "init":
                    return doInit(path);
                case "status":
                    return doStatus(path);
                case "add":
                    return doAdd(path, args);
                case "commit":
                    return doCommit(path, args);
                case "push":
                    return doPush(path, args);
                case "pull":
                    return doPull(path, args);
                case "log":
                    return doLog(path, args);
                case "diff":
                    return doDiff(path, args);
                case "branch":
                    return doBranch(path, args);
                case "checkout":
                    return doCheckout(path, args);
                case "addremote":
                    return doAddRemote(path, args);
                case "remote":
                    return doListRemotes(path);
                case "reset":
                    return doReset(path, args);
                case "clean":
                    return doClean(path, args);
                default:
                    return "{\"error\":\"未知操作: " + escapeJson(action) + "\"}";
            }
        } catch (Exception e) {
            if (cancelled) {
                return "{\"cancelled\":true}";
            }
            Log.e(TAG, "Git 操作失败: " + e.getMessage(), e);
            return "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        } finally {
            currentThread = null;
        }
    }

    /**
     * 异步执行 Git 操作，结果通过 WebView 回调返回
     */
    public void executeAsync(String json, String callbackId,
                             android.webkit.WebView webView, android.app.Activity activity) {
        new Thread(() -> {
            final String result = execute(json);
            activity.runOnUiThread(() -> {
                String js = "window._onGitResult && window._onGitResult('"
                        + callbackId + "', " + result + ");";
                webView.evaluateJavascript(js, null);
            });
        }).start();
    }

    /**
     * 取消当前正在执行的 Git 操作
     */
    public void cancel() {
        cancelled = true;
        Thread t = currentThread;
        if (t != null) {
            t.interrupt();  // JGit 操作通常响应 interrupt
        }
    }

    // ==================== 认证 ====================

    private CredentialsProvider buildCredentials(org.json.JSONObject args) {
        String token = args.optString("token", "");
        if (token.isEmpty()) return null;
        String username = args.optString("username", "token");
        return new UsernamePasswordCredentialsProvider(username, token);
    }

    // ==================== clone ====================

    private String doClone(org.json.JSONObject args) {
        String url = args.optString("url", "");
        String path = args.optString("path", "");
        String branch = args.optString("branch", "");
        String depth = args.optString("depth", "");

        if (url.isEmpty() || path.isEmpty()) {
            return "{\"error\":\"clone 需要 url 和 path 参数\"}";
        }

        File dir = new File(path);
        if (dir.exists() && dir.listFiles() != null && dir.listFiles().length > 0) {
            return "{\"error\":\"目标目录不为空: " + escapeJson(path) + "\"}";
        }

        try {
            CloneCommand cmd = Git.cloneRepository()
                    .setURI(url)
                    .setDirectory(dir);

            if (!branch.isEmpty()) {
                cmd.setBranch(branch);
            }
            if (!depth.isEmpty()) {
                try {
                    int d = Integer.parseInt(depth);
                    cmd.setDepth(d);
                } catch (NumberFormatException ignored) {}
            }

            CredentialsProvider cred = buildCredentials(args);
            if (cred != null) cmd.setCredentialsProvider(cred);

            try (Git git = cmd.call()) {
                String currentBranch = git.getRepository().getBranch();
                long size = calculateDirSize(dir);
                return "{\"success\":true,\"action\":\"clone\","
                        + "\"path\":\"" + escapeJson(path) + "\","
                        + "\"branch\":\"" + escapeJson(currentBranch) + "\","
                        + "\"size\":" + size + "}";
            }
        } catch (Exception e) {
            deleteRecursive(dir);
            return "{\"error\":\"克隆失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== init ====================

    private String doInit(String path) {
        if (path.isEmpty()) {
            return "{\"error\":\"init 需要 path 参数\"}";
        }
        try {
            File dir = new File(path);
            try (Git git = Git.init().setDirectory(dir).call()) {
                return "{\"success\":true,\"action\":\"init\","
                        + "\"path\":\"" + escapeJson(path) + "\"}";
            }
        } catch (Exception e) {
            return "{\"error\":\"初始化失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== status ====================

    private String doStatus(String path) {
        if (path.isEmpty()) {
            return "{\"error\":\"status 需要 path 参数\"}";
        }
        try (Git git = Git.open(new File(path))) {
            Status s = git.status().call();
            org.json.JSONObject result = new org.json.JSONObject();
            result.put("success", true);
            result.put("action", "status");
            result.put("clean", s.isClean());
            result.put("branch", git.getRepository().getBranch());
            result.put("added", toArray(s.getAdded()));
            result.put("modified", toArray(s.getModified()));
            result.put("removed", toArray(s.getRemoved()));
            result.put("untracked", toArray(s.getUntracked()));
            result.put("missing", toArray(s.getMissing()));
            result.put("conflicting", toArray(s.getConflicting()));
            result.put("stagedAdded", toArray(s.getChanged()));

            try {
                BranchTrackingStatus bts = BranchTrackingStatus.of(
                        git.getRepository(), git.getRepository().getBranch());
                if (bts != null) {
                    result.put("aheadCount", bts.getAheadCount());
                    result.put("behindCount", bts.getBehindCount());
                    result.put("remoteBranch", bts.getRemoteTrackingBranch());
                }
            } catch (Exception ignored) {}

            return result.toString();
        } catch (Exception e) {
            return "{\"error\":\"查看状态失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== add ====================

    private String doAdd(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            String pattern = args.optString("pattern", ".");
            git.add().addFilepattern(pattern).call();
            return "{\"success\":true,\"action\":\"add\","
                    + "\"pattern\":\"" + escapeJson(pattern) + "\"}";
        } catch (Exception e) {
            return "{\"error\":\"add 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== commit ====================

    private String doCommit(String path, org.json.JSONObject args) {
        String message = args.optString("message", "");
        if (message.isEmpty()) {
            return "{\"error\":\"commit 需要 message 参数\"}";
        }
        try (Git git = Git.open(new File(path))) {
            String author = args.optString("author", "小蓝AI");
            String email = args.optString("email", "ai@xiaolanbox.com");

            Status status = git.status().call();
            if (status.isClean()) {
                return "{\"error\":\"没有变更可提交（工作区是干净的）\"}";
            }

            RevCommit commit = git.commit()
                    .setMessage(message)
                    .setAuthor(author, email)
                    .call();

            return "{\"success\":true,\"action\":\"commit\","
                    + "\"hash\":\"" + commit.getId().getName().substring(0, 7) + "\","
                    + "\"fullHash\":\"" + commit.getId().getName() + "\","
                    + "\"message\":\"" + escapeJson(message) + "\","
                    + "\"author\":\"" + escapeJson(author) + "\","
                    + "\"date\":" + commit.getCommitTime() + "}";
        } catch (Exception e) {
            return "{\"error\":\"commit 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== push ====================

    private String doPush(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            PushCommand cmd = git.push();
            CredentialsProvider cred = buildCredentials(args);
            if (cred != null) cmd.setCredentialsProvider(cred);

            String branch = args.optString("branch", "");
            if (!branch.isEmpty()) {
                cmd.setRemote("origin").setRefSpecs(
                        new RefSpec("refs/heads/" + branch + ":refs/heads/" + branch));
            }

            Iterable<PushResult> results = cmd.call();
            org.json.JSONArray arr = new org.json.JSONArray();
            for (PushResult r : results) {
                for (RemoteRefUpdate u : r.getRemoteUpdates()) {
                    org.json.JSONObject obj = new org.json.JSONObject();
                    obj.put("ref", u.getRemoteName());
                    obj.put("status", u.getStatus().name());
                    if (u.getMessage() != null) obj.put("message", u.getMessage());
                    arr.put(obj);
                }
            }
            return "{\"success\":true,\"action\":\"push\",\"results\":" + arr.toString() + "}";
        } catch (Exception e) {
            return "{\"error\":\"push 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== pull ====================

    private String doPull(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            PullCommand cmd = git.pull();
            CredentialsProvider cred = buildCredentials(args);
            if (cred != null) cmd.setCredentialsProvider(cred);

            PullResult r = cmd.call();
            org.json.JSONObject result = new org.json.JSONObject();
            result.put("success", true);
            result.put("action", "pull");

            if (r.getMergeResult() != null) {
                result.put("mergeStatus", r.getMergeResult().getMergeStatus().name());
            }
            if (r.getRebaseResult() != null) {
                result.put("rebaseStatus", r.getRebaseResult().getStatus().name());
            }

            return result.toString();
        } catch (Exception e) {
            return "{\"error\":\"pull 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== log ====================

    private String doLog(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            int max = args.optInt("max", 20);
            if (max > MAX_LOG_COUNT) max = MAX_LOG_COUNT;

            Iterable<RevCommit> logs = git.log().setMaxCount(max).call();
            org.json.JSONArray arr = new org.json.JSONArray();
            for (RevCommit c : logs) {
                org.json.JSONObject obj = new org.json.JSONObject();
                obj.put("hash", c.getId().getName().substring(0, 7));
                obj.put("fullHash", c.getId().getName());
                obj.put("author", c.getAuthorIdent().getName());
                obj.put("email", c.getAuthorIdent().getEmailAddress());
                obj.put("date", c.getAuthorIdent().getWhen().getTime());
                obj.put("message", c.getShortMessage());
                obj.put("fullMessage", c.getFullMessage().trim());
                arr.put(obj);
            }
            return "{\"success\":true,\"action\":\"log\",\"commits\":" + arr.toString() + "}";
        } catch (Exception e) {
            return "{\"error\":\"log 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== diff ====================

    private String doDiff(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            // 先暂存所有变更，确保未跟踪文件也能被 diff
            try {
                git.add().addFilepattern(".").call();
            } catch (Exception ignored) {}

            // 比较 暂存区 vs HEAD（等同于 git diff --cached）
            org.json.JSONArray arr = new org.json.JSONArray();
            List<DiffEntry> diffs;
            try {
                ObjectId head = git.getRepository().resolve("HEAD");
                CanonicalTreeParser oldTree = new CanonicalTreeParser();
                CanonicalTreeParser newTree = new CanonicalTreeParser();
                try (org.eclipse.jgit.revwalk.RevWalk rw = new org.eclipse.jgit.revwalk.RevWalk(git.getRepository());
                     org.eclipse.jgit.lib.ObjectReader reader = git.getRepository().newObjectReader();
                     org.eclipse.jgit.lib.ObjectInserter inserter = git.getRepository().newObjectInserter()) {
                    org.eclipse.jgit.revwalk.RevTree headTree = rw.parseTree(head);
                    oldTree.reset(reader, headTree.getId());
                    // 从暂存区构建 tree
                    org.eclipse.jgit.dircache.DirCache dc = git.getRepository().readDirCache();
                    ObjectId dcTreeId = dc.writeTree(inserter);
                    inserter.flush();
                    newTree.reset(reader, dcTreeId);
                }
                diffs = git.diff().setOldTree(oldTree).setNewTree(newTree).call();
            } catch (Exception diffEx) {
                return "{\"error\":\"diff 失败: " + escapeJson(diffEx.getMessage()) + "\"}";
            }

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            DiffFormatter fmt = new DiffFormatter(out);
            fmt.setRepository(git.getRepository());
            fmt.setDiffComparator(RawTextComparator.DEFAULT);

            for (DiffEntry e : diffs) {
                org.json.JSONObject obj = new org.json.JSONObject();
                obj.put("type", e.getChangeType().name());
                obj.put("oldPath", e.getOldPath());
                obj.put("newPath", e.getNewPath());

                try {
                    out.reset();
                    fmt.format(e);
                    String diffText = out.toString("UTF-8");
                    if (diffText != null && !diffText.isEmpty()) {
                        obj.put("content", diffText);
                    }
                } catch (Exception ex) {
                    obj.put("content", "[无法读取差异详情]");
                }

                arr.put(obj);
            }
            fmt.close();

            return "{\"success\":true,\"action\":\"diff\",\"entries\":" + arr.toString() + "}";
        } catch (Exception e) {
            return "{\"error\":\"diff 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== branch ====================

    private String doBranch(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            String branchName = args.optString("branch", "");
            boolean list = args.optBoolean("list", false);

            if (list || branchName.isEmpty()) {
                List<Ref> refs = git.branchList().call();
                org.json.JSONArray arr = new org.json.JSONArray();
                String currentBranch = git.getRepository().getBranch();
                for (Ref ref : refs) {
                    String name = ref.getName().replace("refs/heads/", "");
                    org.json.JSONObject obj = new org.json.JSONObject();
                    obj.put("name", name);
                    obj.put("current", name.equals(currentBranch));
                    arr.put(obj);
                }
                return "{\"success\":true,\"action\":\"branch\",\"branches\":" + arr.toString() + "}";
            }

            git.branchCreate().setName(branchName).call();
            return "{\"success\":true,\"action\":\"branch\","
                    + "\"branch\":\"" + escapeJson(branchName) + "\","
                    + "\"created\":true}";
        } catch (Exception e) {
            return "{\"error\":\"branch 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== checkout ====================

    private String doCheckout(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            String branchName = args.optString("branch", "");
            boolean force = args.optBoolean("force", false);
            if (branchName.isEmpty()) {
                return "{\"error\":\"checkout 需要 branch 参数\"}";
            }

            CheckoutCommand cmd = git.checkout().setName(branchName);
            if (force) cmd.setForce(true);
            cmd.call();

            return "{\"success\":true,\"action\":\"checkout\","
                    + "\"branch\":\"" + escapeJson(branchName) + "\"}";
        } catch (Exception e) {
            return "{\"error\":\"checkout 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== addremote ====================

    private String doAddRemote(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            String url = args.optString("url", "");
            String remoteName = args.optString("remoteName", "origin");
            if (url.isEmpty()) {
                return "{\"error\":\"addremote 需要 url 参数\"}";
            }

            RemoteConfig remoteConfig = new RemoteConfig(git.getRepository().getConfig(), remoteName);
            remoteConfig.addURI(new URIish(url));
            remoteConfig.update(git.getRepository().getConfig());
            git.getRepository().getConfig().save();

            return "{\"success\":true,\"action\":\"addremote\","
                    + "\"remoteName\":\"" + escapeJson(remoteName) + "\","
                    + "\"url\":\"" + escapeJson(url) + "\"}";
        } catch (Exception e) {
            return "{\"error\":\"addremote 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== remote ====================

    private String doListRemotes(String path) {
        try (Git git = Git.open(new File(path))) {
            List<RemoteConfig> remotes = RemoteConfig.getAllRemoteConfigs(git.getRepository().getConfig());
            org.json.JSONArray arr = new org.json.JSONArray();
            for (RemoteConfig rc : remotes) {
                org.json.JSONObject obj = new org.json.JSONObject();
                obj.put("name", rc.getName());
                org.json.JSONArray uris = new org.json.JSONArray();
                for (URIish uri : rc.getURIs()) {
                    uris.put(uri.toString());
                }
                obj.put("uris", uris);
                arr.put(obj);
            }
            return "{\"success\":true,\"action\":\"remote\",\"remotes\":" + arr.toString() + "}";
        } catch (Exception e) {
            return "{\"error\":\"remote 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== reset ====================

    private String doReset(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            String mode = args.optString("mode", "hard");
            String ref = args.optString("ref", "HEAD");

            ResetCommand.ResetType resetType;
            switch (mode.toLowerCase()) {
                case "soft":
                    resetType = ResetCommand.ResetType.SOFT;
                    break;
                case "mixed":
                case "":
                    resetType = ResetCommand.ResetType.MIXED;
                    break;
                case "hard":
                default:
                    resetType = ResetCommand.ResetType.HARD;
                    break;
            }

            ObjectId refId = git.getRepository().resolve(ref);
            if (refId == null) {
                return "{\"error\":\"无法解析引用: " + escapeJson(ref) + "\"}";
            }

            git.reset().setMode(resetType).setRef(ref).call();

            return "{\"success\":true,\"action\":\"reset\","
                    + "\"mode\":\"" + mode + "\","
                    + "\"ref\":\"" + escapeJson(ref) + "\"}";
        } catch (Exception e) {
            return "{\"error\":\"reset 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== clean ====================

    private String doClean(String path, org.json.JSONObject args) {
        try (Git git = Git.open(new File(path))) {
            boolean cleanDirs = args.optBoolean("cleanDirectories", true);
            boolean dryRun = args.optBoolean("dryRun", false);

            Set<String> cleanedFiles = git.clean()
                    .setCleanDirectories(cleanDirs)
                    .setDryRun(dryRun)
                    .call();

            org.json.JSONArray arr = new org.json.JSONArray();
            for (String f : cleanedFiles) {
                arr.put(f);
            }

            return "{\"success\":true,\"action\":\"clean\","
                    + "\"cleanedFiles\":" + arr.toString() + ","
                    + "\"count\":" + cleanedFiles.size() + "}";
        } catch (Exception e) {
            return "{\"error\":\"clean 失败: " + escapeJson(e.getMessage()) + "\"}";
        }
    }

    // ==================== 工具方法 ====================

    private org.json.JSONArray toArray(java.util.Collection<String> coll) {
        org.json.JSONArray arr = new org.json.JSONArray();
        if (coll != null) {
            for (String s : coll) {
                arr.put(s);
            }
        }
        return arr;
    }

    private long calculateDirSize(File dir) {
        long size = 0;
        if (dir.isDirectory()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    size += f.isDirectory() ? calculateDirSize(f) : f.length();
                }
            }
        } else {
            size = dir.length();
        }
        return size;
    }

    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        try {
            file.delete();
        } catch (Exception ignored) {}
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}