package io.github.bakutaku.potamaid.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.PotamAIdClient;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
 * 通知で即時に更新し、表示されている間だけ一定間隔で取得し直す。
 */
@OnlyIn(Dist.CLIENT)
@EventBusSubscriber(modid = PotamAId.MODID, value = Dist.CLIENT)
public final class BridgeStatusCache {
    /** 実行中の作業1件分。目標の進み具合（done / total）と最新の途中経過を持つ。 */
    public record Entry(String title, String goal, int done, int total, String latest, boolean approval) {}

    public record State(boolean enabled, boolean connected, String project, int approvals, int unread,
            List<Entry> entries, long countsChangedAt) {}

    /** 情報ディスプレイ用の全体の件数と、それを取得した時刻（Util.getMillis()。未取得なら 0）。 */
    public record Summary(int goals, int tasks, int consults, long refreshedAt) {}

    /** 表示されている間の取得間隔（ティック）。 */
    private static final int REFRESH_TICKS = 200;
    /** 表示が途絶えたらこの時間（ミリ秒）を過ぎて取得をやめる。 */
    private static final long IDLE_MILLIS = 15_000;
    private static final int MAX_GOAL_PAGES = 3;
    private static final int MAX_TASK_PAGES = 4;
    private static final int MAX_ACTIVE_GOALS = 3;

    private static final BridgeStatusCache INSTANCE = new BridgeStatusCache();

    public static BridgeStatusCache get() { return INSTANCE; }

    private final Set<String> unreadConsults = new HashSet<>();
    private volatile State state = new State(false, false, "", 0, 0, List.of(), 0);
    private volatile Summary summary = new Summary(0, 0, 0, 0);
    private volatile long touchedAt;
    private volatile boolean refreshing;
    private BridgeChat attached;
    private int ticks = REFRESH_TICKS;
    private volatile boolean wantRefresh;

    private BridgeStatusCache() {}

    public State state() { return state; }

    public Summary summary() { return summary; }

    /** 描画側が呼ぶ。呼ばれている間だけ定期取得する。 */
    public void touch() { touchedAt = Util.getMillis(); }

    /** 相談画面を開いたら、返答は読んだものとして数える。 */
    public void markRead() {
        synchronized (unreadConsults) {
            if (unreadConsults.isEmpty()) return;
            unreadConsults.clear();
        }
        update(s -> new State(s.enabled(), s.connected(), s.project(), s.approvals(), 0, s.entries(), s.countsChangedAt()));
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
            case "disconnected" -> update(s -> new State(true, false, s.project(), 0, s.unread(), List.of(), s.countsChangedAt()));
            case "notice" -> wantRefresh = true;
            case "consult_state" -> {
                JsonObject consult = message.getAsJsonObject("consult");
                if (consult != null && !BridgeChat.value(message, "answer").isBlank()) {
                    synchronized (unreadConsults) { unreadConsults.add(BridgeChat.value(consult, "id")); }
                    int unread;
                    synchronized (unreadConsults) { unread = unreadConsults.size(); }
                    update(s -> withCounts(s, s.approvals(), unread));
                }
                wantRefresh = true;
            }
            default -> { }
        }
    }

    // ---- 取得 ----

    private void refresh(BridgeChat chat) {
        refreshing = true;
        chat.call(object("action", "status")).thenCompose(status -> {
            JsonObject data = status.getAsJsonObject("data");
            String project = BridgeChat.value(data, "name");
            int approvals = parseInt(BridgeChat.value(data, "approvals"));
            summary = new Summary(parseInt(BridgeChat.value(data, "goals")), parseInt(BridgeChat.value(data, "tasks")),
                    parseInt(BridgeChat.value(data, "consults")), Util.getMillis());
            update(s -> withCounts(new State(s.enabled(), true, project, s.approvals(), s.unread(), s.entries(), s.countsChangedAt()),
                    approvals, s.unread()));
            return goals(chat, 1, new ArrayList<>());
        }).thenCompose(goals -> entries(chat, goals, 0, new ArrayList<>()))
                .whenComplete((entries, error) -> {
                    if (error == null) update(s -> new State(s.enabled(), s.connected(), s.project(), s.approvals(), s.unread(), entries, s.countsChangedAt()));
                    refreshing = false;
                });
    }

    /** 実行中の可能性がある目標（進行中・確認中）だけを集める。 */
    private CompletableFuture<List<JsonObject>> goals(BridgeChat chat, int page, List<JsonObject> acc) {
        return chat.call(object("action", "goals", "page", page)).thenCompose(response -> {
            JsonObject data = response.getAsJsonObject("data");
            for (JsonElement element : data.getAsJsonArray("items")) {
                JsonObject goal = element.getAsJsonObject();
                String status = BridgeChat.value(goal, "status");
                if ((status.equals("active") || status.equals("review")) && acc.size() < MAX_ACTIVE_GOALS) acc.add(goal);
            }
            if (data.get("hasMore").getAsBoolean() && page < MAX_GOAL_PAGES && acc.size() < MAX_ACTIVE_GOALS) return goals(chat, page + 1, acc);
            return CompletableFuture.completedFuture(acc);
        });
    }

    private CompletableFuture<List<Entry>> entries(BridgeChat chat, List<JsonObject> goals, int index, List<Entry> acc) {
        if (index >= goals.size()) return CompletableFuture.completedFuture(acc);
        JsonObject goal = goals.get(index);
        return tasks(chat, BridgeChat.value(goal, "id"), 1, new ArrayList<>()).thenCompose(tasks -> {
            int done = 0;
            for (JsonObject task : tasks) if (BridgeChat.value(task, "status").equals("done")) done++;
            String goalTitle = BridgeChat.value(goal, "title");
            boolean any = false;
            for (JsonObject task : tasks) {
                String status = BridgeChat.value(task, "status");
                if (!status.equals("running") && !status.equals("approval")) continue;
                any = true;
                acc.add(new Entry(BridgeChat.value(task, "title"), goalTitle, done, tasks.size(), clip(BridgeChat.value(task, "latest")), status.equals("approval")));
            }
            if (!any && BridgeChat.value(goal, "status").equals("active")) acc.add(new Entry(goalTitle, goalTitle, done, tasks.size(), "", false));
            return entries(chat, goals, index + 1, acc);
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
}
