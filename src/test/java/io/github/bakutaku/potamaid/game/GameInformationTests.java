package io.github.bakutaku.potamaid.game;

import java.time.Duration;
import java.util.NoSuchElementException;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.google.gson.JsonParser;
import com.mojang.brigadier.exceptions.CommandSyntaxException;

import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.commands.CommandSource;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.neoforged.neoforge.gametest.GameTestHolder;
import net.neoforged.neoforge.gametest.PrefixGameTestTemplate;

@GameTestHolder(PotamAId.MODID)
@PrefixGameTestTemplate(false)
public final class GameInformationTests {
    private static final Duration TIMEOUT = Duration.ofSeconds(2);

    @GameTest(template = "empty")
    public static void capturesDetachedValues(GameTestHelper helper) {
        var player = helper.makeMockServerPlayerInLevel();
        try {
            player.setPos(-12.25, 83.5, 4.75);
            player.setYRot(123.5F);
            player.setXRot(-25.25F);
            player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(PotamAId.EXAMPLE_ITEM.get(), 7));
            player.setItemInHand(InteractionHand.OFF_HAND, new ItemStack(Items.DIAMOND, 3));
            var service = new GameInformationService(helper.getLevel().getServer());
            var result = service.getPlayerNow(player.getUUID());

            helper.assertTrue(result.playerId().equals(player.getUUID()), "UUID is preserved");
            helper.assertTrue(result.playerName().equals(player.getGameProfile().getName()), "Name is preserved");
            helper.assertTrue(result.dimension().equals(helper.getLevel().dimension().location().toString()), "Dimension is preserved");
            helper.assertTrue(result.position().equals(new PlayerSnapshot.Position(-12.25, 83.5, 4.75, 123.5F, -25.25F)), "Position and rotation retain precision");
            helper.assertTrue(result.mainHand().equals(new PlayerSnapshot.HeldItem(PotamAId.MODID + ":example_item", 7)), "Mod item ID and count are preserved");
            helper.assertTrue(result.offHand().equals(new PlayerSnapshot.HeldItem("minecraft:diamond", 3)), "Offhand is separate");

            player.getMainHandItem().shrink(2);
            player.setPos(0, 90, 0);
            var next = service.getPlayerNow(player.getUUID());
            helper.assertTrue(next.mainHand().count() == 5 && next.position().x() == 0, "A new read reflects changes");
            helper.assertTrue(result.mainHand().count() == 7 && result.position().x() == -12.25, "Old values do not change with game objects");
        } finally {
            remove(player);
        }
        helper.succeed();
    }

    @GameTest(template = "empty")
    public static void emptyHandsAndDisconnectedPlayer(GameTestHelper helper) {
        var player = helper.makeMockServerPlayerInLevel();
        var service = new GameInformationService(helper.getLevel().getServer());
        try {
            player.setItemInHand(InteractionHand.MAIN_HAND, ItemStack.EMPTY);
            player.setItemInHand(InteractionHand.OFF_HAND, new ItemStack(Items.STONE, 0));
            var result = service.getPlayerNow(player.getUUID());
            var empty = new PlayerSnapshot.HeldItem("minecraft:air", 0);
            helper.assertTrue(result.mainHand().equals(empty) && result.offHand().equals(empty), "Empty hands normalize to air and zero");
        } finally {
            remove(player);
        }
        expectFailure(helper, service.getPlayer(player.getUUID(), TIMEOUT), NoSuchElementException.class);
        helper.succeed();
    }

    @GameTest(template = "empty")
    public static void rejectsDirectOffThreadRead(GameTestHelper helper) throws Exception {
        var service = new GameInformationService(helper.getLevel().getServer());
        var result = CompletableFuture.supplyAsync(() -> service.getPlayerNow(UUID.randomUUID()));
        result.handle((value, error) -> null).get(2, TimeUnit.SECONDS);
        expectFailure(helper, result, IllegalStateException.class);
        helper.succeed();
    }

    @GameTest(template = "empty", timeoutTicks = 100)
    public static void dispatchesBackgroundRequest(GameTestHelper helper) throws Exception {
        var player = helper.makeMockServerPlayerInLevel();
        var service = new GameInformationService(helper.getLevel().getServer());
        // 受付だけを待つ。ゲーム状態の取得完了は、サーバースレッドを解放してから待つ。
        var result = CompletableFuture.supplyAsync(() -> service.getPlayer(player.getUUID(), TIMEOUT))
                .get(2, TimeUnit.SECONDS);
        helper.runAfterDelay(2, () -> {
            try {
                helper.assertTrue(result.isDone() && !result.isCompletedExceptionally(), "Background request completes on the server thread");
                helper.assertTrue(result.join().playerId().equals(player.getUUID()), "Explicit target is used");
                helper.succeed();
            } finally {
                remove(player);
            }
        });
    }

    @GameTest(template = "empty")
    public static void timesOutWhileServerCannotDispatch(GameTestHelper helper) throws Exception {
        var service = new GameInformationService(helper.getLevel().getServer());
        var result = CompletableFuture.supplyAsync(() -> service.getPlayer(UUID.randomUUID(), Duration.ofMillis(30)))
                .get(2, TimeUnit.SECONDS);
        // テスト時だけメインスレッドを止め、キューが処理されなくても期限で終了することを確認する。
        result.handle((value, error) -> null).get(2, TimeUnit.SECONDS);
        expectFailure(helper, result, TimeoutException.class);
        helper.runAfterDelay(2, () -> {
            expectFailure(helper, result, TimeoutException.class);
            helper.succeed();
        });
    }

    @GameTest(template = "empty")
    public static void rejectsInvalidTimeout(GameTestHelper helper) {
        var service = new GameInformationService(helper.getLevel().getServer());
        for (var timeout : new Duration[]{Duration.ZERO, Duration.ofMillis(-1)}) {
            try {
                service.getPlayer(UUID.randomUUID(), timeout);
                helper.fail("Invalid timeout was accepted");
            } catch (IllegalArgumentException expected) {
                // ゲームへの要求を投入する前に拒否する。
            }
        }
        helper.succeed();
    }

    @GameTest(template = "empty")
    public static void commandDisplaysOnlyCaller(GameTestHelper helper) throws CommandSyntaxException {
        var server = helper.getLevel().getServer();
        var player = helper.makeMockServerPlayerInLevel();
        try {
            var output = new CapturedOutput();
            var source = player.createCommandSourceStack().withSource(output).withPermission(0);
            var dispatcher = server.getCommands().getDispatcher();
            helper.assertTrue(dispatcher.execute(PotamAId.MODID + " info", source) == 1, "Command succeeds without operator permissions");
            helper.assertTrue(output.messages.size() == 1, "Only one result is sent");
            var content = (net.minecraft.network.chat.contents.TranslatableContents) output.messages.getFirst().getContents();
            var json = JsonParser.parseString((String) content.getArgs()[0]).getAsJsonObject();
            helper.assertTrue(json.get("playerId").getAsString().equals(player.getUUID().toString()), "JSON contains the caller UUID");
            helper.assertTrue(json.has("position") && json.has("mainHand") && json.has("offHand"), "Structured data is displayed");
            try {
                dispatcher.execute(PotamAId.MODID + " info", server.createCommandSourceStack().withSource(output));
                helper.fail("Console must not select a player automatically");
            } catch (CommandSyntaxException expected) {
                // 対象がないコンソール実行は Minecraft 標準のエラーにする。
            }
        } finally {
            remove(player);
        }
        helper.succeed();
    }

    private static void expectFailure(GameTestHelper helper, CompletableFuture<?> result, Class<? extends Throwable> type) {
        helper.assertTrue(result.isCompletedExceptionally(), "Request should have failed");
        try {
            result.join();
            helper.fail("Expected " + type.getSimpleName());
        } catch (CompletionException exception) {
            helper.assertTrue(type.isInstance(exception.getCause()), "Expected " + type.getSimpleName() + ", got " + exception.getCause());
        }
    }

    private static void remove(ServerPlayer player) {
        player.getServer().getPlayerList().remove(player);
    }

    private static final class CapturedOutput implements CommandSource {
        private final java.util.List<Component> messages = new java.util.ArrayList<>();

        @Override
        public void sendSystemMessage(Component message) {
            messages.add(message);
        }

        @Override
        public boolean acceptsSuccess() {
            return true;
        }

        @Override
        public boolean acceptsFailure() {
            return true;
        }

        @Override
        public boolean shouldInformAdmins() {
            return false;
        }
    }
}
