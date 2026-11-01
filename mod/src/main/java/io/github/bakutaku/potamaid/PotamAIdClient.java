package io.github.bakutaku.potamaid;

import net.minecraft.client.Minecraft;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.client.gui.ConfigurationScreen;
import net.neoforged.neoforge.client.gui.IConfigScreenFactory;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.GameShuttingDownEvent;
import io.github.bakutaku.potamaid.client.BridgeConnection;
import io.github.bakutaku.potamaid.connection.GameConnection;

// This class will not load on dedicated servers. Accessing client side code from here is safe.
@Mod(value = PotamAId.MODID, dist = Dist.CLIENT)
// You can use EventBusSubscriber to automatically register all static methods in the class annotated with @SubscribeEvent
@EventBusSubscriber(modid = PotamAId.MODID, value = Dist.CLIENT)
public class PotamAIdClient {
    private static GameConnection game;
    private static BridgeConnection bridge;

    public PotamAIdClient(ModContainer container, IEventBus bus) {
        // Allows NeoForge to create a config screen for this mod's configs.
        // The config screen is accessed by going to the Mods screen > clicking on your mod > clicking on config.
        // Do not forget to add translations for your config options to the en_us.json file.
        container.registerExtensionPoint(IConfigScreenFactory.class, ConfigurationScreen::new);
        container.registerConfig(ModConfig.Type.CLIENT, Config.CLIENT_SPEC);
        bus.addListener(PotamAIdClient::onClientSetup);
    }

    static void onClientSetup(FMLClientSetupEvent event) {
        event.enqueueWork(() -> {
            game = new GameConnection(Minecraft.getInstance().gameDirectory.toPath().toAbsolutePath(),
                    Config.MCP_ENABLED.get(), Config.MCP_PORT.get(), Config.MCP_REQUEST_TIMEOUT.get());
            if (Config.BRIDGE_ENABLED.get()) {
                bridge = new BridgeConnection(Config.BRIDGE_PROJECT_ROOT.get(),
                        Minecraft.getInstance().gameDirectory.toPath().toAbsolutePath(), game);
                bridge.start();
            }
        });
    }

    @SubscribeEvent
    static void onServerStarted(ServerStartedEvent event) {
        if (game != null && !event.getServer().isDedicatedServer()) game.start(event.getServer());
    }

    @SubscribeEvent
    static void onServerStopping(ServerStoppingEvent event) {
        if (game != null && !event.getServer().isDedicatedServer()) game.stop();
    }

    @SubscribeEvent
    static void onGameStopping(GameShuttingDownEvent event) {
        if (bridge != null) bridge.close();
        if (game != null) game.stop();
    }
}
