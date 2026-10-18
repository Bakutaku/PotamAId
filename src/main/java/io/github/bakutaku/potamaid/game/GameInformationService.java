package io.github.bakutaku.potamaid.game;

import java.time.Duration;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** 論理サーバーの情報取得。NeoForge・通信・表示には依存しない。 */
public final class GameInformationService {
    private final MinecraftServer server;

    // サーバーの起動ごとに作る。static に保持して次のワールドへ持ち越さない。
    public GameInformationService(MinecraftServer server) {
        this.server = Objects.requireNonNull(server);
    }

    /** 通信用スレッドから利用する入口。対象は明示し、自動では選ばない。 */
    public CompletableFuture<PlayerSnapshot> getPlayer(UUID playerId, Duration timeout) {
        Objects.requireNonNull(playerId);
        Objects.requireNonNull(timeout);
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("Timeout must be positive");
        }

        var result = new CompletableFuture<PlayerSnapshot>();
        result.orTimeout(timeout.toNanos(), TimeUnit.NANOSECONDS);
        try {
            server.executeIfPossible(() -> {
                // タイムアウト・キャンセル済みの要求でゲームの状態を読まない。
                if (result.isDone()) {
                    return;
                }
                try {
                    result.complete(getPlayerNow(playerId));
                } catch (RuntimeException exception) {
                    result.completeExceptionally(exception);
                }
            });
        } catch (RuntimeException exception) {
            result.completeExceptionally(exception);
        }
        return result;
    }

    /** コマンドなど、すでにサーバースレッド上にいる呼び出し元用。 */
    public PlayerSnapshot getPlayerNow(UUID playerId) {
        if (!server.isSameThread()) {
            throw new IllegalStateException("Game information must be read on the server thread");
        }
        if (!server.isRunning() || server.isStopped()) {
            throw new IllegalStateException("Server is not running");
        }
        var player = server.getPlayerList().getPlayer(Objects.requireNonNull(playerId));
        if (player == null) {
            throw new NoSuchElementException("Player is not connected: " + playerId);
        }

        return new PlayerSnapshot(
                player.getUUID(),
                player.getGameProfile().getName(),
                player.serverLevel().dimension().location().toString(),
                new PlayerSnapshot.Position(player.getX(), player.getY(), player.getZ(),
                        player.getYRot(), player.getXRot()),
                snapshot(player.getMainHandItem()),
                snapshot(player.getOffhandItem()));
    }

    private static PlayerSnapshot.HeldItem snapshot(ItemStack stack) {
        return new PlayerSnapshot.HeldItem(
                BuiltInRegistries.ITEM.getKey(stack.isEmpty() ? Items.AIR : stack.getItem()).toString(),
                stack.isEmpty() ? 0 : stack.getCount());
    }
}
