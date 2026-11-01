package io.github.bakutaku.potamaid.connection;

import com.google.gson.JsonParser;
import io.github.bakutaku.potamaid.client.BridgeConnection;
import java.nio.file.*;

/** Mod の実際の WebSocket クライアントを、Minecraft なしで起動する検証用の入口。 */
public final class BridgeProtocolClient {
    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[0]).toAbsolutePath();
        try (var connection = new BridgeConnection("", directory, () -> {
            try { return JsonParser.parseString(Files.readString(directory.resolve("state.json"))).getAsJsonObject(); }
            catch (Exception e) { return GameMcpServer.object("worldAvailable", false, "mcpAvailable", false); }
        }, directory.resolve("bridge.json"), reason -> {})) {
            connection.setMessageListener(message -> {
                try { Files.writeString(directory.resolve("events.jsonl"), message + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND); }
                catch (Exception e) { throw new IllegalStateException("fixture write failed"); }
            });
            connection.start();
            while (!Files.exists(directory.resolve("stop"))) {
                Path command = directory.resolve("command.json");
                if (Files.exists(command)) {
                    var operation = JsonParser.parseString(Files.readString(command)).getAsJsonObject();
                    Files.delete(command);
                    connection.request(operation).whenComplete((response, error) -> {
                        try { Files.writeString(directory.resolve("response.json"), error == null ? response.toString() : "{\"ok\":false}"); }
                        catch (Exception e) { throw new IllegalStateException("fixture write failed"); }
                    });
                }
                Thread.sleep(100);
            }
        }
    }
}
