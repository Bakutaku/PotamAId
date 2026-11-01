package io.github.bakutaku.potamaid.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
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
            case "notice" -> line(Component.literal(value(message, "title") + ": " + value(message, "body")));
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
            if (!value(item, field).isBlank()) line(Component.literal(value(item, field)));
        }
        if (value(item, "needsGameRestart").equals("true")) line(Component.translatable("commands.potamaid.bridge.restart"));
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
