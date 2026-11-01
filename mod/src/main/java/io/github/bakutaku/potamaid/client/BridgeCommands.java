package io.github.bakutaku.potamaid.client;

import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.PotamAIdClient;
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
                .then(Commands.literal("cancel").executes(c -> send(object("action", "consult_cancel"))))
                .then(Commands.literal("history").executes(c -> send(object("action", "history", "owner", "consult")))
                        .then(Commands.argument("before", IntegerArgumentType.integer(1))
                                .executes(c -> send(object("action", "history", "owner", "consult", "before", IntegerArgumentType.getInteger(c, "before"))))));
        var root = Commands.literal(PotamAId.MODID)
                .executes(c -> { BridgeChat.line(Component.translatable("commands.potamaid.bridge.help")); return 1; })
                .then(Commands.literal("status").executes(c -> send(object("action", "status"))))
                .then(consult).then(pages("goals", "goals"));
        for (String owner : new String[] { "goal", "task" }) {
            var target = Commands.argument("id", StringArgumentType.word())
                    .executes(c -> send(object("action", owner, "id", StringArgumentType.getString(c, "id"))));
            if (owner.equals("goal")) target.then(Commands.argument("page", IntegerArgumentType.integer(1, 1000000))
                    .executes(c -> send(object("action", owner, "id", StringArgumentType.getString(c, "id"), "page", IntegerArgumentType.getInteger(c, "page")))));
            target.then(Commands.literal("history")
                    .executes(c -> send(object("action", "history", "owner", owner, "id", StringArgumentType.getString(c, "id"))))
                    .then(Commands.argument("before", IntegerArgumentType.integer(1))
                            .executes(c -> send(object("action", "history", "owner", owner, "id", StringArgumentType.getString(c, "id"), "before", IntegerArgumentType.getInteger(c, "before"))))));
            root.then(Commands.literal(owner).then(target));
        }
        event.getDispatcher().register(root);
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
