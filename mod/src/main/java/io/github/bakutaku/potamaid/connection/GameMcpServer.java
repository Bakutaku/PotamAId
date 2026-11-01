package io.github.bakutaku.potamaid.connection;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.game.PlayerSnapshot;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;

/** 読み取り専用・セッションを持たない Streamable HTTP (2025 系) の最小実装。 */
public final class GameMcpServer implements AutoCloseable {
    public static final Set<String> VERSIONS = Set.of("2025-03-26", "2025-06-18", "2025-11-25");
    private static final Gson GSON = new Gson();
    private final HttpServer server;
    private final ExecutorService executor = Executors.newFixedThreadPool(4, r -> {
        Thread thread = new Thread(r, "PotamAId game MCP");
        thread.setDaemon(true);
        return thread;
    });
    private final String authorization;
    private final Supplier<CompletableFuture<PlayerSnapshot>> snapshot;

    public GameMcpServer(int port, String token, Supplier<CompletableFuture<PlayerSnapshot>> snapshot) throws IOException {
        this.authorization = "Bearer " + token;
        this.snapshot = snapshot;
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
        server.setExecutor(executor);
        server.createContext("/mcp", this::handle);
    }

    public void start() { server.start(); }
    public int port() { return server.getAddress().getPort(); }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            String host = exchange.getRequestHeaders().getFirst("Host");
            if (exchange.getRequestHeaders().containsKey("Origin") ||
                    !(Objects.equals(host, "127.0.0.1:" + port()) || Objects.equals(host, "localhost:" + port()))) {
                send(exchange, 403, null); return;
            }
            var auth = exchange.getRequestHeaders().getFirst("Authorization");
            if (auth == null || !MessageDigest.isEqual(auth.getBytes(StandardCharsets.UTF_8), authorization.getBytes(StandardCharsets.UTF_8))) {
                send(exchange, 401, null); return;
            }
            if (!exchange.getRequestURI().toString().equals("/mcp")) { send(exchange, 404, null); return; }
            String version = exchange.getRequestHeaders().getFirst("MCP-Protocol-Version");
            if (version != null && !VERSIONS.contains(version)) { send(exchange, 400, error(JsonNull.INSTANCE, -32602, "Unsupported MCP protocol version")); return; }
            if (!exchange.getRequestMethod().equals("POST")) {
                exchange.getResponseHeaders().set("Allow", "POST");
                send(exchange, 405, null); return;
            }
            String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
            String accept = exchange.getRequestHeaders().getFirst("Accept");
            if (contentType == null || !contentType.split(";", 2)[0].trim().equalsIgnoreCase("application/json")) { send(exchange, 415, null); return; }
            if (accept == null || !accept.contains("application/json") || !accept.contains("text/event-stream")) { send(exchange, 406, null); return; }
            byte[] body = exchange.getRequestBody().readNBytes(65537);
            if (body.length > 65536) { send(exchange, 413, null); return; }
            JsonObject request;
            try { request = JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject(); }
            catch (RuntimeException e) { send(exchange, 400, error(JsonNull.INSTANCE, -32700, "Parse error")); return; }
            var id = request.has("id") ? request.get("id") : JsonNull.INSTANCE;
            if (!request.has("jsonrpc") || !request.get("jsonrpc").equals(new JsonPrimitive("2.0")) ||
                    !request.has("method") || !request.get("method").isJsonPrimitive() || !request.get("method").getAsJsonPrimitive().isString() ||
                    (request.has("id") && !(id.isJsonPrimitive() && (id.getAsJsonPrimitive().isString() || id.getAsJsonPrimitive().isNumber())))) {
                send(exchange, 400, error(JsonNull.INSTANCE, -32600, "Invalid request")); return;
            }
            String method = request.get("method").getAsString();
            if (!request.has("id")) { send(exchange, 202, null); return; }
            JsonObject params;
            try {
                params = request.has("params") ? request.getAsJsonObject("params") : new JsonObject();
                if (params == null) throw new IllegalArgumentException();
                if (params.has("_meta") && params.getAsJsonObject("_meta").has("io.modelcontextprotocol/protocolVersion")) {
                    send(exchange, 400, error(id, -32602, "Per-request MCP protocol versions are not supported; use a supported 2025 initialize version")); return;
                }
            }
            catch (RuntimeException e) { send(exchange, 200, error(id, -32602, "Invalid params")); return; }
            JsonElement result;
            try {
                result = switch (method) {
                    case "initialize" -> initialize(params);
                    case "ping" -> new JsonObject();
                    case "tools/list" -> tools();
                    case "tools/call" -> call(params);
                    default -> null;
                };
            } catch (RuntimeException e) {
                send(exchange, 200, error(id, -32602, "Invalid params or unsupported MCP version")); return;
            }
            send(exchange, 200, result == null ? error(id, -32601, "Method not found") : object("jsonrpc", "2.0", "id", id, "result", result));
        } catch (RuntimeException e) {
            // 要求や例外に認証情報が含まれる可能性があるため、内容をログに出さない。
            PotamAId.LOGGER.warn("ゲーム MCP の要求処理に失敗しました");
        }
    }

    private JsonObject initialize(JsonObject params) {
        if (!params.has("clientInfo") || !params.get("clientInfo").isJsonObject() ||
                !params.has("capabilities") || !params.get("capabilities").isJsonObject()) throw new IllegalArgumentException();
        var client = params.getAsJsonObject("clientInfo");
        for (String key : List.of("name", "version")) {
            if (!client.has(key) || !client.get(key).isJsonPrimitive() || !client.get(key).getAsJsonPrimitive().isString()) throw new IllegalArgumentException();
        }
        String version = params.has("protocolVersion") ? params.get("protocolVersion").getAsString() : "";
        if (!VERSIONS.contains(version)) throw new IllegalArgumentException();
        return object("protocolVersion", version, "capabilities", object("tools", new JsonObject()),
                "serverInfo", object("name", PotamAId.MODID + "_game", "version", "1"));
    }

    private JsonObject tools() {
        return object("tools", GSON.toJsonTree(List.of(object("name", "get_player_snapshot",
                "description", "起動中のシングルプレイの自分の現在地・向き・両手のアイテムを取得する。",
                "inputSchema", object("type", "object", "properties", new JsonObject(), "additionalProperties", false),
                "annotations", object("readOnlyHint", true, "destructiveHint", false, "idempotentHint", true, "openWorldHint", false)))));
    }

    private JsonObject call(JsonObject params) {
        if (!params.has("name") || !params.get("name").getAsString().equals("get_player_snapshot") ||
                (params.has("arguments") && (!params.get("arguments").isJsonObject() || !params.getAsJsonObject("arguments").isEmpty())))
            throw new IllegalArgumentException();
        try {
            var data = GSON.toJsonTree(snapshot.get().join());
            return object("content", GSON.toJsonTree(List.of(object("type", "text", "text", GSON.toJson(data)))), "structuredContent", data);
        } catch (RuntimeException exception) {
            Throwable cause = exception;
            while (cause.getCause() != null) cause = cause.getCause();
            String message = cause instanceof TimeoutException ? "ゲーム情報の取得がタイムアウトしました" :
                    cause instanceof NoSuchElementException ? "プレイヤーが接続していません" : "サーバーが停止しているか、ゲーム情報を取得できません";
            return object("isError", true, "content", GSON.toJsonTree(List.of(object("type", "text", "text", message))));
        }
    }

    private static JsonObject error(JsonElement id, int code, String message) {
        return object("jsonrpc", "2.0", "id", id, "error", object("code", code, "message", message));
    }

    public static JsonObject object(Object... values) {
        var json = new JsonObject();
        for (int i = 0; i < values.length; i += 2) json.add((String) values[i], GSON.toJsonTree(values[i + 1]));
        return json;
    }

    private static void send(HttpExchange exchange, int status, JsonObject json) throws IOException {
        if (json == null) { exchange.sendResponseHeaders(status, -1); return; }
        byte[] bytes = GSON.toJson(json).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    @Override public void close() { server.stop(0); executor.shutdownNow(); }
}
