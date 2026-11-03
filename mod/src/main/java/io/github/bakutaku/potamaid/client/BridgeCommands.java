package io.github.bakutaku.potamaid.client;

import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.PotamAIdClient;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;
import static io.github.bakutaku.potamaid.connection.GameMcpServer.object;

/** 本人のクライアントだけで処理する。論理サーバーを経由する操作経路を作らない。 */
@EventBusSubscriber(modid = PotamAId.MODID, value = Dist.CLIENT)
public final class BridgeCommands {
    private BridgeCommands() {}

    @SubscribeEvent
    public static void register(RegisterClientCommandsEvent event) {
        var consult = Commands.literal("consult")
                .then(pages("list", "consult_list"))
                .then(Commands.literal("new").then(Commands.argument("text", StringArgumentType.greedyString())
                        .executes(c -> send(object("action", "consult_new", "text", StringArgumentType.getString(c, "text"))))))
                .then(Commands.literal("select").then(Commands.argument("id", StringArgumentType.word())
                        .executes(c -> send(object("action", "consult_select", "id", StringArgumentType.getString(c, "id"))))))
                .then(Commands.literal("send").then(Commands.argument("text", StringArgumentType.greedyString())
                        .executes(c -> send(object("action", "consult_send", "text", StringArgumentType.getString(c, "text"))))))
                .then(Commands.literal("gui").executes(c -> {
                    // チャット欄を閉じる処理で画面が消えないよう、次のティックで開く。
                    Minecraft.getInstance().tell(ConsultScreen::open); return 1;
                }))
                .then(Commands.literal("cancel").executes(c -> send(object("action", "consult_cancel"))))
                .then(Commands.literal("history").executes(c -> send(object("action", "history", "owner", "consult")))
                        .then(Commands.argument("before", IntegerArgumentType.integer(1))
                                .executes(c -> send(object("action", "history", "owner", "consult", "before", IntegerArgumentType.getInteger(c, "before"))))));
        var root = Commands.literal(PotamAId.MODID)
                .executes(c -> { BridgeChat.line(Component.translatable("commands.potamaid.bridge.help")); return 1; })
                .then(Commands.literal("status").executes(c -> send(object("action", "status"))))
                .then(consult).then(pages("goals", "goals")).then(pages("approvals", "approvals"))
                .then(Commands.literal("approval")
                        // ID を省くと、承認待ちが1件のときだけ回答できる。
                        .then(decisionWithoutId("allow", "allow")).then(decisionWithoutId("always", "allowForSession")).then(decisionWithoutId("deny", "deny"))
                        .then(Commands.literal("answer").then(Commands.argument("question", IntegerArgumentType.integer(1, 20))
                                .then(Commands.argument("value", StringArgumentType.greedyString())
                                        .executes(c -> send(object("action", "approval_answer", "question", IntegerArgumentType.getInteger(c, "question"),
                                                "value", StringArgumentType.getString(c, "value")))))))
                        .then(Commands.argument("id", StringArgumentType.word())
                        .then(decision("allow", "allow")).then(decision("always", "allowForSession")).then(decision("deny", "deny"))
                        .then(Commands.literal("answer").then(Commands.argument("question", IntegerArgumentType.integer(1, 20))
                                .then(Commands.argument("value", StringArgumentType.greedyString())
                                        .executes(c -> send(object("action", "approval_answer", "id", StringArgumentType.getString(c, "id"),
                                                "question", IntegerArgumentType.getInteger(c, "question"), "value", StringArgumentType.getString(c, "value")))))))));
        for (String owner : new String[] { "goal", "task" }) {
            var target = Commands.argument("id", StringArgumentType.word())
                    .executes(c -> send(object("action", owner, "id", StringArgumentType.getString(c, "id"))));
            if (owner.equals("goal")) target.then(Commands.argument("page", IntegerArgumentType.integer(1, 1000000))
                    .executes(c -> send(object("action", owner, "id", StringArgumentType.getString(c, "id"), "page", IntegerArgumentType.getInteger(c, "page")))));
            target.then(Commands.literal("history")
                    .executes(c -> send(object("action", "history", "owner", owner, "id", StringArgumentType.getString(c, "id"))))
                    .then(Commands.argument("before", IntegerArgumentType.integer(1))
                            .executes(c -> send(object("action", "history", "owner", owner, "id", StringArgumentType.getString(c, "id"), "before", IntegerArgumentType.getInteger(c, "before"))))));
            if (owner.equals("goal")) target.then(Commands.literal("approve")
                    .executes(c -> send(object("action", "goal_approve", "id", StringArgumentType.getString(c, "id")))));
            else for (String operation : new String[] { "cancel", "resume" }) target.then(Commands.literal(operation)
                    .executes(c -> send(object("action", "task_" + operation, "id", StringArgumentType.getString(c, "id")))));
            root.then(Commands.literal(owner).then(target));
        }
        event.getDispatcher().register(root);
    }

    private static LiteralArgumentBuilder<CommandSourceStack> decisionWithoutId(String literal, String decision) {
        return Commands.literal(literal).executes(c -> send(object("action", "approval_respond", "decision", decision)));
    }

    private static LiteralArgumentBuilder<CommandSourceStack> decision(String literal, String decision) {
        return Commands.literal(literal).executes(c -> send(object("action", "approval_respond",
                "id", StringArgumentType.getString(c, "id"), "decision", decision)));
    }

    private static LiteralArgumentBuilder<CommandSourceStack> pages(String command, String action) {
        return Commands.literal(command).executes(c -> send(object("action", action)))
                .then(Commands.argument("page", IntegerArgumentType.integer(1, 1000000))
                        .executes(c -> send(object("action", action, "page", IntegerArgumentType.getInteger(c, "page")))));
    }

    private static int send(JsonObject operation) {
        BridgeChat chat = PotamAIdClient.bridgeChat();
        if (chat == null) { BridgeChat.line(Component.translatable("commands.potamaid.bridge.disabled")); return 0; }
        chat.request(operation); return 1;
    }
}
