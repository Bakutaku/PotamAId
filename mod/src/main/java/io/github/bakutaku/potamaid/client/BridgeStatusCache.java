package io.github.bakutaku.potamaid.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.PotamAIdClient;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import net.minecraft.Util;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import static io.github.bakutaku.potamaid.connection.GameMcpServer.object;

/**
 * ホログラム表示用に、本人の Bridge から届いた最新状況を持つ。論理サーバーには何も送らない。
 * 通知で即時に更新し、表示されている間だけ一定間隔で取得し直す。状態ディスプレイ用の一覧（Details）は、状態ディスプレイが映っている間だけ取得する。
 */
@OnlyIn(Dist.CLIENT)
@EventBusSubscriber(modid = PotamAId.MODID, value = Dist.CLIENT)
public final class BridgeStatusCache {
    /** 実行中の作業1件分。目標の進み具合（done / total）と最新の途中経過を持つ。 */
    public record Entry(String title, String goal, int done, int total, String latest, boolean approval) {}

    public record State(boolean enabled, boolean connected, String project, int approvals, int unread,
            List<Entry> entries, long countsChangedAt) {}

    /** 全体の件数と、それを取得した時刻（Util.getMillis()。未取得なら 0）。 */
    public record Summary(int goals, int tasks, int consults, long refreshedAt) {}

    /** 状態ディスプレイ用のタスク1件分。status は Bridge の状態名、startedAt は最初に実行した時刻（Unix ミリ秒。未実行なら 0）。 */
    public record TaskInfo(int number, String title, String status, boolean paused, long startedAt) {}

    /** 状態ディスプレイ用の未完了の目標1件分。タスクを取得しなかった目標は tasks が空で total が -1。 */
    public record GoalInfo(String title, String status, int done, int total, List<TaskInfo> tasks) {}

    /** 状態ディスプレイ用の相談1件分。 */
    public record ConsultInfo(String title, String status, boolean unread) {}

    /** 状態ディスプレイ用の一覧。goals は対応が必要な順、consults は未読・実行中を先にした順。refreshedAt は取得した時刻（Util.getMillis()。未取得なら 0）。 */
    public record Details(List<GoalInfo> goals, List<ConsultInfo> consults, long refreshedAt) {}

    /** 表示されている間の取得間隔（ティック）。 */
    private static final int REFRESH_TICKS = 200;
    /** 表示が途絶えたらこの時間（ミリ秒）を過ぎて取得をやめる。 */
    private static final long IDLE_MILLIS = 15_000;
    private static final int MAX_GOAL_PAGES = 6;
    private static final int MAX_TASK_PAGES = 4;
    private static final int MAX_CONSULT_PAGES = 4;
    private static final int MAX_ACTIVE_GOALS = 3;
    /** 状態ディスプレイ用にタスクまで取得する目標の数と、一覧に載せる目標の数。 */
    private static final int MAX_DETAIL_GOALS = 6;
    private static final int MAX_LISTED_GOALS = 12;
    /** 目標の並び順（対応が必要なものを先に）。ここにない状態は最後。 */
    private static final List<String> GOAL_ORDER = List.of("review", "waiting", "planReview", "planFailed", "active", "planning");

    private static final BridgeStatusCache INSTANCE = new BridgeStatusCache();

    public static BridgeStatusCache get() { return INSTANCE; }

    /** 未読の返答がある相談の ID と題名。 */
    private final Map<String, String> unreadConsults = new LinkedHashMap<>();
    private volatile State state = new State(false, false, "", 0, 0, List.of(), 0);
    private volatile Summary summary = new Summary(0, 0, 0, 0);
    private volatile Details details = new Details(List.of(), List.of(), 0);
    private volatile long touchedAt, detailsTouchedAt;
    private volatile boolean refreshing;
    private BridgeChat attached;
    private int ticks = REFRESH_TICKS;
    private volatile boolean wantRefresh;

    private BridgeStatusCache() {}

    public State state() { return state; }

    public Summary summary() { return summary; }

    public Details details() { return details; }

    /** 描画側が呼ぶ。呼ばれている間だけ定期取得する。 */
    public void touch() { touchedAt = Util.getMillis(); }

    /** 状態ディスプレイが呼ぶ。呼ばれている間だけ Details も取得する。映り始めたらすぐに取得する。 */
    public void touchDetails() {
        long now = Util.getMillis();
        if (now - detailsTouchedAt >= IDLE_MILLIS) wantRefresh = true;
        detailsTouchedAt = now;
    }

    /** 相談画面を開いたら、返答は読んだものとして数える。 */
    public void markRead() {
        synchronized (unreadConsults) {
            if (unreadConsults.isEmpty()) return;
            unreadConsults.clear();
        }
        update(s -> new State(s.enabled(), s.connected(), s.project(), s.approvals(), 0, s.entries(), s.countsChangedAt()));
        Details d = details;
        details = new Details(d.goals(), d.consults().stream().map(c -> new ConsultInfo(c.title(), c.status(), false)).toList(), d.refreshedAt());
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) { INSTANCE.tick(); }

    private void tick() {
        BridgeChat chat = PotamAIdClient.bridgeChat();
        if (chat != attached && chat != null) {
            attached = chat;
            chat.addListener(this::message);
            update(s -> new State(true, chat.connected(), s.project(), s.approvals(), s.unread(), s.entries(), s.countsChangedAt()));
        }
        if (chat == null) return;
        boolean showing = Util.getMillis() - touchedAt < IDLE_MILLIS;
        if (!showing || !chat.connected()) { ticks = REFRESH_TICKS; return; }
        if ((wantRefresh || ++ticks >= REFRESH_TICKS) && !refreshing) {
            ticks = 0;
            wantRefresh = false;
            refresh(chat);
        }
    }

    /** Bridge 接続のスレッドで呼ばれる。 */
    private void message(JsonObject message) {
        String type = BridgeChat.value(message, "type");
        switch (type) {
            case "connected" -> {
                update(s -> new State(true, true, s.project(), s.approvals(), s.unread(), s.entries(), s.countsChangedAt()));
                wantRefresh = true;
            }
            case "disconnected" -> {
                update(s -> new State(true, false, s.project(), 0, s.unread(), List.of(), s.countsChangedAt()));
                details = new Details(List.of(), List.of(), 0);
            }
            case "notice" -> wantRefresh = true;
            case "consult_state" -> {
                JsonObject consult = message.getAsJsonObject("consult");
                if (consult != null && !BridgeChat.value(message, "answer").isBlank()) {
                    int unread;
                    synchronized (unreadConsults) {
                        unreadConsults.put(BridgeChat.value(consult, "id"), BridgeChat.value(consult, "title"));
                        unread = unreadConsults.size();
                    }
                    update(s -> withCounts(s, s.approvals(), unread));
                }
                wantRefresh = true;
            }
            default -> { }
        }
    }

    // ---- 取得 ----

    /** 1 回の取得で集めたもの。tasks は目標の ID ごとのタスクの一覧。 */
    private record Fetched(List<JsonObject> goals, Map<String, List<JsonObject>> tasks, List<JsonObject> consults) {}

    private void refresh(BridgeChat chat) {
        refreshing = true;
        boolean detailed = Util.getMillis() - detailsTouchedAt < IDLE_MILLIS;
        chat.call(object("action", "status")).thenCompose(status -> {
            JsonObject data = status.getAsJsonObject("data");
            String project = BridgeChat.value(data, "name");
            int approvals = parseInt(BridgeChat.value(data, "approvals"));
            summary = new Summary(parseInt(BridgeChat.value(data, "goals")), parseInt(BridgeChat.value(data, "tasks")),
                    parseInt(BridgeChat.value(data, "consults")), Util.getMillis());
            update(s -> withCounts(new State(s.enabled(), true, project, s.approvals(), s.unread(), s.entries(), s.countsChangedAt()),
                    approvals, s.unread()));
            return goals(chat, 1, detailed, new ArrayList<>());
        }).thenCompose(goals -> {
            // 進捗ボード用の目標と、状態ディスプレイ用に対応が必要な順で先頭の目標のタスクを集める。
            List<JsonObject> targets = new ArrayList<>(activeGoals(goals));
            if (detailed) {
                for (JsonObject goal : byAttention(goals).subList(0, Math.min(MAX_DETAIL_GOALS, goals.size()))) {
                    if (!targets.contains(goal)) targets.add(goal);
                }
            }
            return taskLists(chat, targets, 0, new LinkedHashMap<>()).thenCompose(tasks -> detailed
                    ? consults(chat, 1, new ArrayList<>()).thenApply(consults -> new Fetched(goals, tasks, consults))
                    : CompletableFuture.completedFuture(new Fetched(goals, tasks, List.of())));
        }).whenComplete((fetched, error) -> {
            if (error == null) {
                List<Entry> entries = entries(fetched);
                update(s -> new State(s.enabled(), s.connected(), s.project(), s.approvals(), s.unread(), entries, s.countsChangedAt()));
                if (detailed) details = details(fetched);
            }
            refreshing = false;
        });
    }

    /** 完了していない目標を集める。Details が要らなければ、進捗ボード用の目標が揃った時点でやめる。 */
    private CompletableFuture<List<JsonObject>> goals(BridgeChat chat, int page, boolean detailed, List<JsonObject> acc) {
        return chat.call(object("action", "goals", "page", page)).thenCompose(response -> {
            JsonObject data = response.getAsJsonObject("data");
            for (JsonElement element : data.getAsJsonArray("items")) {
                JsonObject goal = element.getAsJsonObject();
                if (!BridgeChat.value(goal, "status").equals("done")) acc.add(goal);
            }
            boolean enough = !detailed && activeGoals(acc).size() >= MAX_ACTIVE_GOALS;
            if (data.get("hasMore").getAsBoolean() && page < MAX_GOAL_PAGES && !enough) return goals(chat, page + 1, detailed, acc);
            return CompletableFuture.completedFuture(acc);
        });
    }

    private CompletableFuture<Map<String, List<JsonObject>>> taskLists(BridgeChat chat, List<JsonObject> goals, int index, Map<String, List<JsonObject>> acc) {
        if (index >= goals.size()) return CompletableFuture.completedFuture(acc);
        String id = BridgeChat.value(goals.get(index), "id");
        return tasks(chat, id, 1, new ArrayList<>()).thenCompose(tasks -> {
            acc.put(id, tasks);
            return taskLists(chat, goals, index + 1, acc);
        });
    }

    private CompletableFuture<List<JsonObject>> tasks(BridgeChat chat, String goalId, int page, List<JsonObject> acc) {
        return chat.call(object("action", "goal", "id", goalId, "page", page)).thenCompose(response -> {
            JsonObject data = response.getAsJsonObject("data");
            for (JsonElement element : data.getAsJsonArray("items")) acc.add(element.getAsJsonObject());
            if (data.get("hasMore").getAsBoolean() && page < MAX_TASK_PAGES) return tasks(chat, goalId, page + 1, acc);
            return CompletableFuture.completedFuture(acc);
        });
    }

    private CompletableFuture<List<JsonObject>> consults(BridgeChat chat, int page, List<JsonObject> acc) {
        return chat.call(object("action", "consult_list", "page", page)).thenCompose(response -> {
            JsonObject data = response.getAsJsonObject("data");
            for (JsonElement element : data.getAsJsonArray("items")) acc.add(element.getAsJsonObject());
            if (data.get("hasMore").getAsBoolean() && page < MAX_CONSULT_PAGES) return consults(chat, page + 1, acc);
            return CompletableFuture.completedFuture(acc);
        });
    }

    // ---- 取得したものの整理 ----

    /** 実行中の可能性がある目標（進行中・確認中）の先頭 MAX_ACTIVE_GOALS 件。 */
    private static List<JsonObject> activeGoals(List<JsonObject> goals) {
        return goals.stream().filter(goal -> {
            String status = BridgeChat.value(goal, "status");
            return status.equals("active") || status.equals("review");
        }).limit(MAX_ACTIVE_GOALS).toList();
    }

    private static List<JsonObject> byAttention(List<JsonObject> goals) {
        return goals.stream().sorted(Comparator.comparingInt(goal -> {
            int index = GOAL_ORDER.indexOf(BridgeChat.value(goal, "status"));
            return index < 0 ? GOAL_ORDER.size() : index;
        })).toList();
    }

    private static List<Entry> entries(Fetched fetched) {
        List<Entry> acc = new ArrayList<>();
        for (JsonObject goal : activeGoals(fetched.goals())) {
            List<JsonObject> tasks = fetched.tasks().getOrDefault(BridgeChat.value(goal, "id"), List.of());
            int done = done(tasks);
            String goalTitle = BridgeChat.value(goal, "title");
            boolean any = false;
            for (JsonObject task : tasks) {
                String status = BridgeChat.value(task, "status");
                if (!status.equals("running") && !status.equals("approval")) continue;
                any = true;
                acc.add(new Entry(BridgeChat.value(task, "title"), goalTitle, done, tasks.size(), clip(BridgeChat.value(task, "latest")), status.equals("approval")));
            }
            if (!any && BridgeChat.value(goal, "status").equals("active")) acc.add(new Entry(goalTitle, goalTitle, done, tasks.size(), "", false));
        }
        return acc;
    }

    private Details details(Fetched fetched) {
        List<GoalInfo> goals = new ArrayList<>();
        for (JsonObject goal : byAttention(fetched.goals())) {
            if (goals.size() >= MAX_LISTED_GOALS) break;
            List<JsonObject> tasks = fetched.tasks().get(BridgeChat.value(goal, "id"));
            List<TaskInfo> infos = new ArrayList<>();
            if (tasks != null) {
                for (JsonObject task : tasks) {
                    infos.add(new TaskInfo(parseInt(BridgeChat.value(task, "number")), BridgeChat.value(task, "title"), BridgeChat.value(task, "status"),
                            BridgeChat.value(task, "paused").equals("true"), parseLong(BridgeChat.value(task, "startedAt"))));
                }
            }
            goals.add(new GoalInfo(BridgeChat.value(goal, "title"), BridgeChat.value(goal, "status"),
                    tasks == null ? 0 : done(tasks), tasks == null ? -1 : tasks.size(), List.copyOf(infos)));
        }

        Map<String, String> unread;
        synchronized (unreadConsults) { unread = new LinkedHashMap<>(unreadConsults); }
        List<ConsultInfo> consults = new ArrayList<>();
        for (JsonObject consult : fetched.consults()) {
            String id = BridgeChat.value(consult, "id");
            consults.add(new ConsultInfo(BridgeChat.value(consult, "title"), BridgeChat.value(consult, "status"), unread.remove(id) != null));
        }
        // 一覧の取得範囲に入らなかった未読の相談も載せる。
        unread.values().forEach(title -> consults.add(new ConsultInfo(title, "idle", true)));
        // 未読・応答中・順番待ち・失敗を先に。それ以外は新しいもの（一覧の後ろ）を先にする。
        List<ConsultInfo> ordered = new ArrayList<>(consults.reversed());
        ordered.sort(Comparator.comparingInt(BridgeStatusCache::consultOrder));
        return new Details(List.copyOf(goals), List.copyOf(ordered), Util.getMillis());
    }

    private static int consultOrder(ConsultInfo consult) {
        if (consult.unread()) return 0;
        return switch (consult.status()) {
            case "running" -> 1;
            case "queued" -> 2;
            case "failed" -> 3;
            default -> 4;
        };
    }

    private static int done(List<JsonObject> tasks) {
        int done = 0;
        for (JsonObject task : tasks) if (BridgeChat.value(task, "status").equals("done")) done++;
        return done;
    }

    // ---- 状態の更新 ----

    private synchronized void update(java.util.function.UnaryOperator<State> change) { state = change.apply(state); }

    /** 件数が変わったら、フラッシュの起点にする時刻を記録する。 */
    private static State withCounts(State s, int approvals, int unread) {
        long changedAt = approvals != s.approvals() || unread != s.unread() ? Util.getMillis() : s.countsChangedAt();
        return new State(s.enabled(), s.connected(), s.project(), approvals, unread, s.entries(), changedAt);
    }

    private static String clip(String text) { return text.length() > 150 ? text.substring(0, 150) + "…" : text; }

    private static int parseInt(String value) {
        try { return Integer.parseInt(value); } catch (NumberFormatException e) { return 0; }
    }

    private static long parseLong(String value) {
        try { return Long.parseLong(value); } catch (NumberFormatException e) { return 0; }
    }
}
