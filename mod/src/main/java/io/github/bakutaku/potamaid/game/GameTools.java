package io.github.bakutaku.potamaid.game;

import java.util.concurrent.CompletableFuture;

/** MCP が呼ぶ読み取り専用の取得処理。ゲームの型に依存させず、テストでは差し替える。 */
public interface GameTools {
    CompletableFuture<PlayerSnapshot> playerSnapshot();

    CompletableFuture<TargetBlock> targetBlock();

    CompletableFuture<ModEnvironment> modEnvironment();

    CompletableFuture<GameLogs> gameLogs();
}
