package io.github.bakutaku.potamaid.client;

import com.google.gson.*;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.connection.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.function.Consumer;
import java.util.function.Supplier;
import static io.github.bakutaku.potamaid.connection.GameMcpServer.object;

/** ネットワーク処理と再試行は専用スレッドで行う。ゲームの状態は不変の通知だけを受け取る。 */
public final class BridgeConnection implements AutoCloseable {
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(r -> {
        var t = new Thread(r, "PotamAId Bridge connection"); t.setDaemon(true); return t;
    });
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final String gameInstanceId = UUID.randomUUID().toString();
    private final String projectRoot;
    private final Path gameDirectory;
    private final Supplier<JsonObject> gameState;
    private final Path discovery;
    private final Consumer<String> warning;
    private WebSocket socket;
    private volatile CompletableFuture<WebSocket> connecting;
    private int failures;
    private volatile boolean closed;
    private boolean welcomed;
    private long connectedAt;
    private long lastResponse;
    private long lastPing;
    private long nextAttempt;
    private String sentState;
    private String lastError;

    public BridgeConnection(String projectRoot, Path gameDirectory, GameConnection game) {
        this(projectRoot, gameDirectory, game::state, Path.of(System.getProperty("user.home"), ".potamaid", "bridge.json"),
                reason -> PotamAId.LOGGER.warn("{}", reason));
    }

    /** ゲームを起動しない通信テストでも同じクライアントを使う。 */
    public BridgeConnection(String projectRoot, Path gameDirectory, Supplier<JsonObject> gameState, Path discovery, Consumer<String> warning) {
        this.projectRoot = projectRoot;
        this.gameDirectory = gameDirectory;
        this.gameState = gameState;
        this.discovery = discovery;
        this.warning = warning;
    }

    public void start() { worker.scheduleWithFixedDelay(this::tick, 0, 1, TimeUnit.SECONDS); }

    private void tick() {
        if (closed) return;
        long now = System.nanoTime();
        if (socket != null) {
            if ((!welcomed && now - connectedAt > TimeUnit.SECONDS.toNanos(10)) ||
                    now - lastResponse > TimeUnit.SECONDS.toNanos(60)) { disconnected("Bridge の応答がありません"); return; }
            if (welcomed) {
                JsonObject currentState = gameState.get();
                String state = currentState.toString();
                if (!state.equals(sentState)) {
                    var message = currentState.deepCopy();
                    message.addProperty("type", "game_state");
                    message.addProperty("gameInstanceId", gameInstanceId);
                    send(message); sentState = state;
                }
                if (now - lastPing > TimeUnit.SECONDS.toNanos(20)) {
                    send(object("type", "ping")); lastPing = now;
                }
            }
            return;
        }
        if (now < nextAttempt) return;
        try {
            String root = projectRoot.isBlank() ? "" : PrivateFiles.normalize(Path.of(projectRoot));
            String normalizedGameDirectory = PrivateFiles.normalize(gameDirectory);
            Path path = discovery;
            PrivateFiles.protect(path);
            var info = JsonParser.parseString(Files.readString(path)).getAsJsonObject();
            if (!new JsonPrimitive(1).equals(info.get("schemaVersion")) || !new JsonPrimitive(1).equals(info.get("protocolVersion")) ||
                    info.get("instanceId").getAsString().isBlank()) throw new IllegalArgumentException();
            URI uri = URI.create(info.get("url").getAsString());
            if (!"ws".equals(uri.getScheme()) || !"127.0.0.1".equals(uri.getHost()) || !"/mod".equals(uri.getRawPath()) ||
                    uri.getPort() < 1 || uri.getPort() > 65535 || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getUserInfo() != null)
                throw new IllegalArgumentException();
            String token = info.get("token").getAsString();
            if (!token.matches("[a-f0-9]{64}")) throw new IllegalArgumentException();
            // join の上限も設ける。失敗の例外本文にはヘッダーが含まれ得るので出力しない。
            connecting = http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + token).buildAsync(uri, new Listener());
            socket = connecting.get(10, TimeUnit.SECONDS);
            connecting = null;
            if (closed) { socket.abort(); socket = null; return; }
            welcomed = false; sentState = null;
            connectedAt = lastResponse = lastPing = System.nanoTime();
            send(object("type", "hello", "protocolVersion", 1, "gameInstanceId", gameInstanceId,
                    "projectRoot", root, "gameDirectory", normalizedGameDirectory));
        } catch (Exception e) {
            if (connecting != null) { connecting.cancel(true); connecting = null; }
            if (closed) return;
            disconnected("Bridge に接続できません。起動状態・接続情報の権限・対象modの設定を確認してください");
        }
    }

    private void send(JsonObject message) {
        WebSocket current = socket;
        if (current != null) current.sendText(message.toString(), true).whenComplete((s, e) -> {
            if (e != null && !closed) worker.execute(() -> { if (socket == current) disconnected("Bridge への送信に失敗しました"); });
        });
    }

    private void disconnected(String reason) {
        if (socket != null) socket.abort();
        socket = null; welcomed = false; sentState = null;
        int seconds = new int[] {1, 2, 4, 8, 15}[Math.min(failures++, 4)];
        nextAttempt = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        if (!reason.equals(lastError)) { warning.accept(reason); lastError = reason; }
    }

    private final class Listener implements WebSocket.Listener {
        private final StringBuilder text = new StringBuilder();
        @Override public void onOpen(WebSocket ws) { if (closed) ws.abort(); else ws.request(1); }
        @Override public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            if (text.length() + data.length() > 65536) { ws.abort(); return null; }
            text.append(data);
            if (last) {
                String message = text.toString(); text.setLength(0);
                worker.execute(() -> {
                    if (socket != ws || closed) return;
                    try {
                        var json = JsonParser.parseString(message).getAsJsonObject();
                        String type = json.get("type").getAsString();
                        if (type.equals("welcome") && new JsonPrimitive(1).equals(json.get("protocolVersion")) &&
                                json.has("projectId") && json.get("projectId").isJsonPrimitive() &&
                                json.get("projectId").getAsJsonPrimitive().isString() && !json.get("projectId").getAsString().isBlank()) {
                            welcomed = true; failures = 0; lastError = null;
                        } else if (type.equals("error")) {
                            // 相手の自由文をログへ転記しない。
                            String code = json.has("code") ? json.get("code").getAsString() : "";
                            disconnected(switch (code) {
                                case "unknown_project" -> "Bridge に対象modのフォルダーが登録されていません";
                                case "unknown_game_project" -> "ゲームの実行フォルダーに対応する対象modがありません。Bridge の登録先を確認してください";
                                case "ambiguous_project" -> "対象modの候補が複数あります。bridge.projectRoot で接続先を指定してください";
                                case "invalid_game_directory" -> "ゲームの実行フォルダーを確認できません";
                                case "invalid_project_path" -> "対象modの指定フォルダーが見つかりません";
                                case "project_access_error" -> "対象modの所属を確認できません。フォルダーのアクセス権を確認してください";
                                case "game_already_connected" -> "この対象modには別のゲームが接続しています";
                                case "protocol_mismatch" -> "Bridge と Mod の通信バージョンが一致しません";
                                default -> "Bridge が接続を拒否しました。対象modの設定を確認してください";
                            });
                        } else if (!type.equals("pong")) { disconnected("Bridge の通信バージョンまたは応答が不正です"); }
                        lastResponse = System.nanoTime();
                    } catch (RuntimeException e) { disconnected("Bridge の応答形式が不正です"); }
                });
            }
            ws.request(1); return null;
        }
        @Override public CompletionStage<?> onClose(WebSocket ws, int status, String reason) {
            if (!closed) worker.execute(() -> { if (socket == ws) disconnected("Bridge との接続が閉じられました"); });
            return null;
        }
        @Override public void onError(WebSocket ws, Throwable error) {
            if (!closed) worker.execute(() -> { if (socket == ws) disconnected("Bridge との通信に失敗しました"); });
        }
    }

    @Override public void close() {
        closed = true;
        worker.shutdownNow();
        if (connecting != null) connecting.cancel(true);
        if (socket != null) socket.abort();
        http.shutdownNow();
    }
}
