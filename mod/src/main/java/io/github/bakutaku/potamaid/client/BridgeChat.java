package io.github.bakutaku.potamaid.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** 通信の結果をローカルチャットへ描画する。サーバーのチャットには送らない。 */
@OnlyIn(Dist.CLIENT)
public final class BridgeChat {
    private final BridgeConnection connection;
    private final List<Consumer<JsonObject>> listeners = new CopyOnWriteArrayList<>();
    private volatile boolean connected;

    public BridgeChat(BridgeConnection connection) {
        this.connection = connection;
        connection.setMessageListener(this::message);
    }

    public boolean connected() { return connected; }

    /** 相談画面などが同じ経路で操作を送る。結果は呼び出し側が描画する。 */
    public CompletableFuture<JsonObject> call(JsonObject operation) { return connection.request(operation); }

    /** 通知は Bridge 接続のスレッドで呼ばれる。描画する側でゲームスレッドへ移す。 */
    public void addListener(Consumer<JsonObject> listener) { listeners.add(listener); }

    public void removeListener(Consumer<JsonObject> listener) { listeners.remove(listener); }

    public void request(JsonObject operation) {
        connection.request(operation).whenComplete((response, error) -> {
            if (error != null) line(Component.translatable("commands.potamaid.bridge.unknown"));
            else if (!response.get("ok").getAsBoolean()) line(Component.literal(value(response, "error")));
            else render(response.getAsJsonObject("data"));
        });
    }

    private void message(JsonObject message) {
        String type = value(message, "type");
        if (type.equals("connected")) connected = true;
        else if (type.equals("disconnected")) connected = false;
        for (Consumer<JsonObject> listener : listeners) listener.accept(message);
        switch (type) {
            case "connected" -> {
                line(Component.translatable("commands.potamaid.bridge.connected"));
                request(io.github.bakutaku.potamaid.connection.GameMcpServer.object("action", "status"));
            }
            case "disconnected" -> line(Component.translatable("commands.potamaid.bridge.disconnected"));
            case "notice" -> {
                line(Component.literal(value(message, "title") + ": " + value(message, "body")));
                // 承認の通知には、回答できるボタン付きの一覧を続けて出す。
                if (value(message, "kind").equals("approval")) request(io.github.bakutaku.potamaid.connection.GameMcpServer.object("action", "approvals"));
            }
            case "approval_resolved" -> {
                // 自分の回答は応答で表示済み。Bridge の画面で回答・取り消されたときだけ知らせる。
                String by = value(message, "by");
                if (!by.equals("game")) line(Component.translatable("commands.potamaid.bridge.approvalResolved." + (by.equals("cancel") ? "cancel" : "app"), value(message, "id").substring(0, Math.min(8, value(message, "id").length()))));
            }
            case "consult_state" -> {
                item(message.getAsJsonObject("consult"));
                if (!value(message, "answer").isBlank()) line(Component.literal(value(message, "answer")));
            }
            default -> { }
        }
    }

    private void render(JsonObject data) {
        switch (value(data, "kind")) {
            case "status" -> line(Component.translatable("commands.potamaid.bridge.status", value(data, "name"), value(data, "goals"), value(data, "tasks"), value(data, "consults"), value(data, "approvals"), value(data, "selected")));
            case "approval_progress" -> line(Component.translatable("commands.potamaid.bridge.approvalProgress", data.getAsJsonArray("remaining").toString()));
            case "accepted" -> line(Component.translatable("commands.potamaid.bridge.accepted"));
            case "consult" -> item(data.getAsJsonObject("consult"));
            case "goal" -> item(data.getAsJsonObject("goal"));
            case "task" -> item(data.getAsJsonObject("task"));
            default -> { }
        }
        if (data.has("items")) {
            if (data.getAsJsonArray("items").isEmpty()) line(Component.translatable("commands.potamaid.bridge.empty"));
            for (JsonElement item : data.getAsJsonArray("items")) item(item.getAsJsonObject());
            line(Component.translatable("commands.potamaid.bridge.page", value(data, "page"), value(data, "hasMore")));
        }
        if (data.has("events")) {
            if (data.getAsJsonArray("events").isEmpty()) line(Component.translatable("commands.potamaid.bridge.empty"));
            for (JsonElement element : data.getAsJsonArray("events")) {
                JsonObject event = element.getAsJsonObject();
                line(Component.literal("#" + value(event, "seq") + " [" + value(event, "kind") + "] " + value(event, "text")));
            }
            if (data.get("hasMore").getAsBoolean()) line(Component.translatable("commands.potamaid.bridge.historyMore", value(data, "before")));
        }
    }

    private void item(JsonObject item) {
        String state = value(item, "paused").equals("true") ? "paused" : value(item, "status");
        line(Component.literal(value(item, "id") + " " + value(item, "title") + " [")
                .append(Component.translatable("commands.potamaid.bridge.state." + state)).append("]"));
        for (String field : new String[] { "summary", "latest", "result", "error" }) {
            for (String text : value(item, field).split("\n")) if (!text.isBlank()) line(Component.literal(text));
        }
        buttons(item);
        if (value(item, "needsGameRestart").equals("true")) line(Component.translatable("commands.potamaid.bridge.restart"));
    }

    private static final java.util.regex.Pattern UUID = java.util.regex.Pattern.compile("[0-9a-fA-F-]{36}");

    /**
     * 操作ボタン。コマンドは固定の語と検証済みの ID だけから Mod が組み立て、AI の自由文を含めない。
     * 選択肢の名前は表示にだけ使い、コマンドには番号を入れる。
     */
    private void buttons(JsonObject item) {
        String id = value(item, "id");
        String entity = value(item, "entity");
        if (!UUID.matcher(id).matches() || !item.has("actions") || !item.get("actions").isJsonArray()) return;
        java.util.Set<String> allowed = switch (entity) {
            case "goal" -> java.util.Set.of("approve");
            case "task" -> java.util.Set.of("cancel", "resume");
            case "approval" -> java.util.Set.of("allow", "always", "deny");
            default -> java.util.Set.of();
        };
        MutableComponent row = Component.literal("  ");
        boolean any = false;
        for (JsonElement element : item.getAsJsonArray("actions")) {
            String action = element.isJsonPrimitive() ? element.getAsString() : "";
            if (!allowed.contains(action)) continue;
            row.append(button(Component.translatable("commands.potamaid.bridge.action." + action), "/potamaid " + entity + " " + id + " " + action));
            any = true;
        }
        if (entity.equals("approval") && item.has("answers") && item.get("answers").isJsonArray()) {
            int number = 1;
            for (JsonElement element : item.getAsJsonArray("answers")) {
                row.append(button(Component.literal(number + ") " + (element.isJsonPrimitive() ? element.getAsString() : "")),
                        "/potamaid approval " + id + " answer 1 " + number));
                any = true;
                number++;
            }
        }
        if (any) Minecraft.getInstance().execute(() -> Minecraft.getInstance().gui.getChat().addMessage(row));
    }

    private static Component button(Component label, String command) {
        Style style = Style.EMPTY.withColor(ChatFormatting.AQUA).withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, command))
                .withHoverEvent(new HoverEvent(HoverEvent.Action.SHOW_TEXT, Component.literal(command)));
        return Component.literal("[").append(label).append("] ").withStyle(style);
    }

    static String value(JsonObject object, String name) {
        JsonElement value = object.get(name);
        return value == null || value.isJsonNull() ? "" : value.getAsString();
    }

    public static void line(Component text) {
        // 自由文は Component.literal で扱い、JSON のクリック操作等として解釈しない。
        Minecraft.getInstance().execute(() -> Minecraft.getInstance().gui.getChat().addMessage(Component.literal("[PotamAId] ").append(text)));
    }
}
