package io.github.bakutaku.potamaid.connection;

import com.google.gson.*;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.game.GameInformationService;
import java.nio.file.*;
import java.time.Duration;
import net.minecraft.server.MinecraftServer;

/** 統合サーバーの起動ごとに MCP を作り、停止時に破棄する。クライアント型を参照しない。 */
public final class GameConnection {
    private GameMcpServer mcp;
    private volatile JsonObject state = GameMcpServer.object("worldAvailable", false, "mcpAvailable", false);
    private final boolean enabled;
    private final int port;
    private final int timeout;
    private final Path directory;

    public GameConnection(Path directory, boolean enabled, int port, int timeout) {
        this.directory = directory;
        this.enabled = enabled;
        this.port = port;
        this.timeout = timeout;
    }

    public JsonObject state() { return state.deepCopy(); }

    public synchronized void start(MinecraftServer server) {
        if (server.isDedicatedServer()) return;
        stop();
        if (!enabled) {
            state = GameMcpServer.object("worldAvailable", true, "mcpAvailable", false, "error", "ゲーム MCP が設定で無効です");
            return;
        }
        try {
            var path = Path.of(System.getProperty("user.home"), ".potamaid", "games", PrivateFiles.gameId(directory), "mcp.json");
            PrivateFiles.directory(path.getParent().getParent().getParent());
            PrivateFiles.directory(path.getParent().getParent());
            PrivateFiles.directory(path.getParent());
            String token = PrivateFiles.token();
            if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
                PrivateFiles.protect(path);
                var saved = JsonParser.parseString(Files.readString(path)).getAsJsonObject();
                if (!new JsonPrimitive(1).equals(saved.get("schemaVersion"))) throw new IllegalArgumentException();
                String auth = saved.getAsJsonObject("headers").get("Authorization").getAsString();
                if (!auth.matches("Bearer [a-f0-9]{64}")) throw new IllegalArgumentException();
                token = auth.substring(7);
            }
            var service = new GameInformationService(server);
            var playerId = server.getSingleplayerProfile().getId();
            var endpoint = new GameMcpServer(port, token, () -> service.getPlayer(playerId, Duration.ofSeconds(timeout)));
            var config = GameMcpServer.object("schemaVersion", 1, "url", "http://127.0.0.1:" + port + "/mcp",
                    "headers", GameMcpServer.object("Authorization", "Bearer " + token));
            try { PrivateFiles.write(path, config.toString()); endpoint.start(); }
            catch (Exception e) { endpoint.close(); throw e; }
            mcp = endpoint;
            state = GameMcpServer.object("worldAvailable", true, "mcpAvailable", true,
                    "mcp", GameMcpServer.object("url", config.get("url"), "headers", config.get("headers")));
        } catch (Exception e) {
            // ファイル内容・認証情報・要求本文をログへ出さない。
            String reason = e instanceof java.net.BindException ? "ゲーム MCP のポートが使用中です" :
                    "ゲーム MCP の接続設定を保護・読み書きできないか、設定が不正です";
            state = GameMcpServer.object("worldAvailable", true, "mcpAvailable", false, "error", reason);
            PotamAId.LOGGER.warn("{}", reason);
        }
    }

    public synchronized void stop() {
        state = GameMcpServer.object("worldAvailable", false, "mcpAvailable", false);
        if (mcp != null) { mcp.close(); mcp = null; }
    }
}
