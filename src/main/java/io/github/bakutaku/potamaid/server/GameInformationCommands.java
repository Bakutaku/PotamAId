package io.github.bakutaku.potamaid.server;

import com.google.gson.Gson;
import com.mojang.brigadier.exceptions.CommandSyntaxException;

import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.game.GameInformationService;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/** 情報取得の確認用。AI の実行や外部との通信は行わない。 */
@EventBusSubscriber(modid = PotamAId.MODID)
public final class GameInformationCommands {
    private static final Gson GSON = new Gson();

    private GameInformationCommands() {
    }

    @SubscribeEvent
    public static void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal(PotamAId.MODID)
                .then(Commands.literal("info")
                        .executes(context -> showInformation(context.getSource()))));
    }

    private static int showInformation(CommandSourceStack source) throws CommandSyntaxException {
        var player = source.getPlayerOrException();
        var snapshot = new GameInformationService(source.getServer()).getPlayerNow(player.getUUID());
        source.sendSuccess(() -> Component.translatable("commands.potamaid.info.result", GSON.toJson(snapshot)), false);
        return 1;
    }
}
