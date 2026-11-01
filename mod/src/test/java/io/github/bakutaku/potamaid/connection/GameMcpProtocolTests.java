package io.github.bakutaku.potamaid.connection;

import com.google.gson.*;
import io.github.bakutaku.potamaid.game.PlayerSnapshot;
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
        try (var server = new GameMcpServer(0, TOKEN, () -> switch (mode.get()) {
            case 1 -> CompletableFuture.failedFuture(new NoSuchElementException("private detail"));
            case 2 -> CompletableFuture.failedFuture(new TimeoutException("private detail"));
            case 3 -> CompletableFuture.failedFuture(new IllegalStateException("private detail"));
            default -> CompletableFuture.completedFuture(value);
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
            var tool = rpc("tools/list", new JsonObject()).getAsJsonObject("result").getAsJsonArray("tools").get(0).getAsJsonObject();
            check(tool.getAsJsonObject("annotations").get("readOnlyHint").getAsBoolean(), "read only");
            check(!tool.getAsJsonObject("inputSchema").get("additionalProperties").getAsBoolean(), "no arguments");
            var call = GameMcpServer.object("name", "get_player_snapshot", "arguments", new JsonObject());
            var snapshot = rpc("tools/call", call).getAsJsonObject("result");
            check(snapshot.getAsJsonObject("structuredContent").get("playerName").getAsString().equals("TestPlayer"), "snapshot structure");
            check(JsonParser.parseString(snapshot.getAsJsonArray("content").get(0).getAsJsonObject().get("text").getAsString()).equals(snapshot.get("structuredContent")), "same text and structured content");
            check(rpc("tools/call", GameMcpServer.object("name", "get_player_snapshot", "arguments", GameMcpServer.object("player", "someone"))).has("error"), "reject arguments");
            for (int failure = 1; failure <= 3; failure++) {
                mode.set(failure);
                var result = rpc("tools/call", call).getAsJsonObject("result");
                check(result.get("isError").getAsBoolean() && !result.toString().contains("private detail") && !result.has("structuredContent"), "redacted failure without stale result");
            }
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
        CLIENT.close();
        if (checks < 25) throw new AssertionError("Missing protocol checks");
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
