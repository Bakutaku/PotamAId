package io.github.bakutaku.potamaid.game;

import java.nio.file.Path;
import java.time.Duration;
import java.util.Comparator;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import net.minecraft.SharedConstants;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.neoforged.fml.ModList;

/** 論理サーバーの情報取得。通信・表示には依存しない（mod 一覧の取得だけ NeoForge の ModList を使う）。 */
public final class GameInformationService {
    /** ブロックエンティティの NBT の最大文字数。チェストなど大きいものを丸ごと AI に渡さない。 */
    private static final int MAX_NBT_CHARS = 16 * 1024;
    private static final ExecutorService LOG_READER = Executors.newSingleThreadExecutor(runnable -> {
        var thread = new Thread(runnable, "PotamAId game log reader");
        thread.setDaemon(true);
        return thread;
    });

    private final MinecraftServer server;

    // サーバーの起動ごとに作る。static に保持して次のワールドへ持ち越さない。
    public GameInformationService(MinecraftServer server) {
        this.server = Objects.requireNonNull(server);
    }

    /** 通信用スレッドから利用する入口。対象は明示し、自動では選ばない。 */
    public CompletableFuture<PlayerSnapshot> getPlayer(UUID playerId, Duration timeout) {
        Objects.requireNonNull(playerId);
        return onServerThread(timeout, () -> getPlayerNow(playerId));
    }

    /** プレイヤーの視線の先のブロック。サーバーが持つ位置・向きから判定するため、クライアントへの問い合わせは不要。 */
    public CompletableFuture<TargetBlock> getTargetBlock(UUID playerId, Duration timeout) {
        Objects.requireNonNull(playerId);
        return onServerThread(timeout, () -> getTargetBlockNow(playerId));
    }

    public CompletableFuture<ModEnvironment> getModEnvironment(Duration timeout) {
        return onServerThread(timeout, this::getModEnvironmentNow);
    }

    /**
     * latest.log の末尾。ゲームの状態を読まないため、サーバースレッドは使わずに別スレッドで読む。
     * 専用サーバーの構成ではサーバー JVM のログになる（クライアントのログは対象外）。
     */
    public static CompletableFuture<GameLogs> getGameLogs(Path gameDirectory, Duration timeout) {
        Objects.requireNonNull(gameDirectory);
        checkTimeout(timeout);
        return CompletableFuture.supplyAsync(
                        () -> GameLogs.readTail(gameDirectory.resolve("logs").resolve("latest.log"), GameLogs.MAX_BYTES),
                        LOG_READER)
                .orTimeout(timeout.toNanos(), TimeUnit.NANOSECONDS);
    }

    private <T> CompletableFuture<T> onServerThread(Duration timeout, Supplier<T> read) {
        checkTimeout(timeout);
        var result = new CompletableFuture<T>();
        result.orTimeout(timeout.toNanos(), TimeUnit.NANOSECONDS);
        try {
            server.executeIfPossible(() -> {
                // タイムアウト・キャンセル済みの要求でゲームの状態を読まない。
                if (result.isDone()) {
                    return;
                }
                try {
                    result.complete(read.get());
                } catch (RuntimeException exception) {
                    result.completeExceptionally(exception);
                }
            });
        } catch (RuntimeException exception) {
            result.completeExceptionally(exception);
        }
        return result;
    }

    private static void checkTimeout(Duration timeout) {
        Objects.requireNonNull(timeout);
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("Timeout must be positive");
        }
    }

    /** コマンドなど、すでにサーバースレッド上にいる呼び出し元用。 */
    public PlayerSnapshot getPlayerNow(UUID playerId) {
        var player = playerNow(playerId);

        return new PlayerSnapshot(
                player.getUUID(),
                player.getGameProfile().getName(),
                player.serverLevel().dimension().location().toString(),
                new PlayerSnapshot.Position(player.getX(), player.getY(), player.getZ(),
                        player.getYRot(), player.getXRot()),
                snapshot(player.getMainHandItem()),
                snapshot(player.getOffhandItem()));
    }

    public TargetBlock getTargetBlockNow(UUID playerId) {
        var player = playerNow(playerId);
        var hit = player.pick(player.blockInteractionRange(), 1.0F, false);
        if (!(hit instanceof BlockHitResult blockHit) || hit.getType() != HitResult.Type.BLOCK) {
            return TargetBlock.none();
        }
        var level = player.serverLevel();
        var pos = blockHit.getBlockPos();
        var state = level.getBlockState(pos);
        var properties = new TreeMap<String, String>();
        for (var property : state.getProperties()) {
            properties.put(property.getName(), valueName(state, property));
        }
        TargetBlock.BlockEntity blockEntity = null;
        var entity = level.getBlockEntity(pos);
        if (entity != null) {
            String nbt = entity.saveWithFullMetadata(server.registryAccess()).toString();
            boolean truncated = nbt.length() > MAX_NBT_CHARS;
            blockEntity = new TargetBlock.BlockEntity(
                    BuiltInRegistries.BLOCK_ENTITY_TYPE.getKey(entity.getType()).toString(),
                    truncated ? nbt.substring(0, MAX_NBT_CHARS) : nbt, truncated);
        }
        return new TargetBlock(true, level.dimension().location().toString(),
                new TargetBlock.Position(pos.getX(), pos.getY(), pos.getZ()),
                BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString(), properties, blockEntity);
    }

    public ModEnvironment getModEnvironmentNow() {
        if (!server.isSameThread()) {
            throw new IllegalStateException("Game information must be read on the server thread");
        }
        var mods = ModList.get().getMods().stream()
                .map(mod -> new ModEnvironment.Mod(mod.getModId(), mod.getDisplayName(), mod.getVersion().toString()))
                .sorted(Comparator.comparing(ModEnvironment.Mod::id))
                .toList();
        String neoForge = mods.stream().filter(mod -> mod.id().equals("neoforge"))
                .map(ModEnvironment.Mod::version).findFirst().orElse("unknown");
        return new ModEnvironment(SharedConstants.getCurrentVersion().getName(), neoForge,
                System.getProperty("java.version"), mods);
    }

    private ServerPlayer playerNow(UUID playerId) {
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
        return player;
    }

    private static <T extends Comparable<T>> String valueName(BlockState state, Property<T> property) {
        return property.getName(state.getValue(property));
    }

    private static PlayerSnapshot.HeldItem snapshot(ItemStack stack) {
        return new PlayerSnapshot.HeldItem(
                BuiltInRegistries.ITEM.getKey(stack.isEmpty() ? Items.AIR : stack.getItem()).toString(),
                stack.isEmpty() ? 0 : stack.getCount());
    }
}
