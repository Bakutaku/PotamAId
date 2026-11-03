package io.github.bakutaku.potamaid.connection;

import com.google.gson.*;
import io.github.bakutaku.potamaid.game.*;
import java.util.function.Supplier;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Minecraft を起動せず、実際の HTTP 待ち受けと保存ファイルを検証する。 */
public final class GameMcpProtocolTests {
    private static int checks;
    private static final String TOKEN = PrivateFiles.token();
    private static URI uri;
    private static final HttpClient CLIENT = HttpClient.newBuilder().build();

    public static void main(String[] args) throws Exception {
        var mode = new AtomicInteger();
        var value = new PlayerSnapshot(UUID.randomUUID(), "TestPlayer", "minecraft:overworld",
                new PlayerSnapshot.Position(-12.25, 64, 8.5, 120, -20),
                new PlayerSnapshot.HeldItem("minecraft:stone", 4), new PlayerSnapshot.HeldItem("minecraft:air", 0));
        var block = new TargetBlock(true, "minecraft:overworld", new TargetBlock.Position(1, 64, -3), "minecraft:chest",
                Map.of("facing", "north"), new TargetBlock.BlockEntity("minecraft:chest", "{Items:[]}", false));
        var environment = new ModEnvironment("1.21.1", "21.1.0", "21", List.of(new ModEnvironment.Mod("potamaid", "PotamAId", "0.1.0")));
        var logs = new GameLogs("logs/latest.log", 12, false, "[INFO] started\n");
        // 失敗の種類は mode で切り替える。ログの失敗は読み取りエラー（4）も使う。
        var failures = new Supplier<CompletableFuture<Object>>() {
            @Override public CompletableFuture<Object> get() {
                return switch (mode.get()) {
                    case 1 -> CompletableFuture.failedFuture(new NoSuchElementException("private detail"));
                    case 2 -> CompletableFuture.failedFuture(new TimeoutException("private detail"));
                    case 3 -> CompletableFuture.failedFuture(new IllegalStateException("private detail"));
                    case 4 -> CompletableFuture.failedFuture(new java.io.UncheckedIOException(new java.io.IOException("private detail")));
                    default -> null;
                };
            }
        };
        try (var server = new GameMcpServer(0, TOKEN, new GameTools() {
            @SuppressWarnings("unchecked")
            private <T> CompletableFuture<T> result(T success) {
                var failure = failures.get();
                return failure == null ? CompletableFuture.completedFuture(success) : (CompletableFuture<T>) failure;
            }
            @Override public CompletableFuture<PlayerSnapshot> playerSnapshot() { return result(value); }
            @Override public CompletableFuture<TargetBlock> targetBlock() { return result(block); }
            @Override public CompletableFuture<ModEnvironment> modEnvironment() { return result(environment); }
            @Override public CompletableFuture<GameLogs> gameLogs() { return result(logs); }
        })) {
            server.start();
            uri = URI.create("http://127.0.0.1:" + server.port() + "/mcp");
            if (args.length > 0) {
                Path directory = Path.of(args[0]);
                PrivateFiles.directory(directory);
                Files.deleteIfExists(directory.resolve("stop"));
                var config = GameMcpServer.object("schemaVersion", 1, "url", uri.toString(), "headers", GameMcpServer.object("Authorization", "Bearer " + TOKEN));
                PrivateFiles.write(directory.resolve("mcp.json"), config.toString());
                // プロバイダーの相互運用テスト用。秘密はファイルだけに渡す。
                Files.writeString(directory.resolve("ready"), "ready");
                while (!Files.exists(directory.resolve("stop"))) Thread.sleep(100);
                return;
            }
            check(post("{}", Map.of("Authorization", "")).statusCode() == 401, "auth");
            check(post("{}", Map.of("Origin", "http://localhost")).statusCode() == 403, "origin");
            check(post("{}", Map.of("MCP-Protocol-Version", "2026-07-28")).statusCode() == 400, "unsupported header");
            check(post("[", Map.of()).statusCode() == 400, "parse error");
            check(post("[]", Map.of()).statusCode() == 400, "batch rejected");
            check(post("{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"ping\"}", Map.of()).statusCode() == 400, "null id");
            check(post("x".repeat(65537), Map.of()).statusCode() == 413, "body limit");
            for (String version : GameMcpServer.VERSIONS) {
                var result = rpc("initialize", GameMcpServer.object("protocolVersion", version, "clientInfo", GameMcpServer.object("name", "test", "version", "1"), "capabilities", new JsonObject()));
                check(result.getAsJsonObject("result").get("protocolVersion").getAsString().equals(version), "version negotiation");
            }
            check(rpc("initialize", GameMcpServer.object("protocolVersion", "2026-07-28")).has("error"), "unsupported initialize");
            check(rpc("initialize", GameMcpServer.object("protocolVersion", "2025-11-25")).has("error"), "missing client info");
            check(post(GameMcpServer.object("jsonrpc", "2.0", "id", 1, "method", "tools/list", "params", GameMcpServer.object("_meta", GameMcpServer.object("io.modelcontextprotocol/protocolVersion", "2026-07-28"))).toString(), Map.of()).statusCode() == 400, "unsupported per-request version");
            try (var raw = new java.net.Socket("127.0.0.1", server.port())) {
                raw.setSoTimeout(5000);
                raw.getOutputStream().write(("GET /mcp HTTP/1.1\r\nHost: evil.example\r\nAuthorization: Bearer " + TOKEN + "\r\nConnection: close\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                check(new String(raw.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).startsWith("HTTP/1.1 403"), "host");
            }
            check(rpc("missing", new JsonObject()).getAsJsonObject("error").get("code").getAsInt() == -32601, "unknown method");
            var tools = rpc("tools/list", new JsonObject()).getAsJsonObject("result").getAsJsonArray("tools");
            var names = new ArrayList<String>();
            for (var element : tools) {
                var tool = element.getAsJsonObject();
                names.add(tool.get("name").getAsString());
                check(tool.getAsJsonObject("annotations").get("readOnlyHint").getAsBoolean(), "read only");
                check(!tool.getAsJsonObject("inputSchema").get("additionalProperties").getAsBoolean(), "no arguments");
            }
            check(names.equals(List.of("get_player_snapshot", "get_target_block", "get_mod_environment", "get_game_logs")), "tool names and order");
            check(rpc("tools/call", GameMcpServer.object("name", "unknown_tool", "arguments", new JsonObject())).has("error"), "reject unknown tool");
            for (String name : List.of("get_target_block", "get_mod_environment", "get_game_logs")) {
                var any = GameMcpServer.object("name", name, "arguments", GameMcpServer.object("x", 1));
                check(rpc("tools/call", any).has("error"), "reject arguments for " + name);
            }
            var targetResult = rpc("tools/call", GameMcpServer.object("name", "get_target_block", "arguments", new JsonObject())).getAsJsonObject("result").getAsJsonObject("structuredContent");
            check(targetResult.get("blockId").getAsString().equals("minecraft:chest") && targetResult.getAsJsonObject("position").get("y").getAsInt() == 64
                    && targetResult.getAsJsonObject("state").get("facing").getAsString().equals("north")
                    && targetResult.getAsJsonObject("blockEntity").get("nbt").getAsString().equals("{Items:[]}"), "target block structure");
            var envResult = rpc("tools/call", GameMcpServer.object("name", "get_mod_environment", "arguments", new JsonObject())).getAsJsonObject("result").getAsJsonObject("structuredContent");
            check(envResult.get("minecraftVersion").getAsString().equals("1.21.1") && envResult.getAsJsonArray("mods").size() == 1, "environment structure");
            var logResult = rpc("tools/call", GameMcpServer.object("name", "get_game_logs", "arguments", new JsonObject())).getAsJsonObject("result");
            check(logResult.getAsJsonObject("structuredContent").get("text").getAsString().equals("[INFO] started\n")
                    && !logResult.toString().contains(System.getProperty("user.home").replace("\\", "\\\\")), "log structure without absolute path");
            var call = GameMcpServer.object("name", "get_player_snapshot", "arguments", new JsonObject());
            var snapshot = rpc("tools/call", call).getAsJsonObject("result");
            check(snapshot.getAsJsonObject("structuredContent").get("playerName").getAsString().equals("TestPlayer"), "snapshot structure");
            check(JsonParser.parseString(snapshot.getAsJsonArray("content").get(0).getAsJsonObject().get("text").getAsString()).equals(snapshot.get("structuredContent")), "same text and structured content");
            check(rpc("tools/call", GameMcpServer.object("name", "get_player_snapshot", "arguments", GameMcpServer.object("player", "someone"))).has("error"), "reject arguments");
            for (String name : names) {
                for (int failure = 1; failure <= 4; failure++) {
                    mode.set(failure);
                    var result = rpc("tools/call", GameMcpServer.object("name", name, "arguments", new JsonObject())).getAsJsonObject("result");
                    check(result.get("isError").getAsBoolean() && !result.toString().contains("private detail") && !result.has("structuredContent"), "redacted failure without stale result: " + name);
                }
            }
            mode.set(4);
            check(rpc("tools/call", GameMcpServer.object("name", "get_game_logs", "arguments", new JsonObject())).toString().contains("ログファイルを読み取れません"), "log read error reason");
            mode.set(0);
            check(post("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}", Map.of()).statusCode() == 202, "notification");
            var get = CLIENT.send(HttpRequest.newBuilder(uri).header("Authorization", "Bearer " + TOKEN).GET().build(), HttpResponse.BodyHandlers.ofString());
            check(get.statusCode() == 405, "no SSE stream");
        }
        try { post("{}", Map.of()); throw new AssertionError("server should stop"); } catch (java.io.IOException expected) { checks++; }
        Path directory = Files.createTempDirectory("potamaid-private-test-");
        try {
            PrivateFiles.write(directory.resolve("mcp.json"), "first");
            PrivateFiles.write(directory.resolve("mcp.json"), "second");
            check(Files.readString(directory.resolve("mcp.json")).equals("second"), "atomic replace");
            check(PrivateFiles.gameId(directory).equals(PrivateFiles.gameId(directory.resolve("."))), "normalized game directory");
        } finally { Files.deleteIfExists(directory.resolve("mcp.json")); Files.delete(directory); }
        gameLogChecks();
        CLIENT.close();
        if (checks < 60) throw new AssertionError("Missing protocol checks");
    }

    /** latest.log の末尾の切り詰め・文字化け防止・認証情報の伏せ字を、実ファイルで確かめる。 */
    private static void gameLogChecks() throws Exception {
        Path directory = Files.createTempDirectory("potamaid-log-test-");
        Path file = directory.resolve("latest.log");
        try {
            String secret = "Bearer " + TOKEN;
            Files.writeString(file, "[INFO] first\nAuthorization: " + secret + "\n[ERROR] 日本語のエラー\n");
            var small = GameLogs.readTail(file, GameLogs.MAX_BYTES);
            check(!small.truncated() && small.text().startsWith("[INFO] first") && small.file().equals("logs/latest.log"), "small log is whole");
            check(!small.text().contains(TOKEN) && small.text().contains("Bearer [REDACTED]"), "bearer token redacted");
            check(!small.file().contains(directory.toString()), "absolute path not returned");

            var big = new StringBuilder();
            for (int i = 0; i < 5000; i++) big.append("[INFO] 行").append(i).append(" あいうえお\n");
            Files.writeString(file, big.toString());
            var tail = GameLogs.readTail(file, 4096);
            check(tail.truncated() && tail.totalBytes() == Files.size(file), "large log is truncated");
            check(tail.text().getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 4096, "tail respects size limit");
            check(tail.text().startsWith("[INFO] 行") && tail.text().endsWith("あいうえお\n") && !tail.text().contains("�"), "tail starts at a line boundary without broken characters");
            check(tail.text().contains("行4999 "), "tail keeps newest lines");
            // 読み始めがちょうど行頭なら、先頭の行を捨てない。
            Files.writeString(file, "old\nnew\n");
            var boundary = GameLogs.readTail(file, 4);
            check(boundary.truncated() && boundary.text().equals("new\n"), "line boundary keeps first line");
            var middle = GameLogs.readTail(file, 5);
            check(middle.truncated() && middle.text().equals("new\n"), "mid-line start drops partial line");
            // タブ区切り・短いトークンも伏せる。
            Files.writeString(file, "Authorization: Bearer\tabc123\nauthorization: bearer   short-token_1.2\n");
            var tabbed = GameLogs.readTail(file, GameLogs.MAX_BYTES);
            check(!tabbed.text().contains("abc123") && !tabbed.text().contains("short-token") && tabbed.text().contains("Bearer [REDACTED]"), "tab and short tokens redacted");
            try { GameLogs.readTail(directory.resolve("missing.log"), 10); throw new AssertionError("missing log"); }
            catch (java.io.UncheckedIOException expected) { checks++; }
        } finally { Files.deleteIfExists(file); Files.delete(directory); }
    }

    private static HttpResponse<String> post(String body, Map<String, String> overrides) throws Exception {
        var headers = new HashMap<>(Map.of("Authorization", "Bearer " + TOKEN, "Content-Type", "application/json", "Accept", "application/json, text/event-stream"));
        headers.putAll(overrides);
        var builder = HttpRequest.newBuilder(uri).timeout(java.time.Duration.ofSeconds(10));
        headers.forEach(builder::header);
        return CLIENT.send(builder.POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    private static JsonObject rpc(String method, JsonObject params) throws Exception {
        return JsonParser.parseString(post(GameMcpServer.object("jsonrpc", "2.0", "id", 1, "method", method, "params", params).toString(), Map.of()).body()).getAsJsonObject();
    }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); checks++; }
}
