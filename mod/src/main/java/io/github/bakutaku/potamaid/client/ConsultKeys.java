package io.github.bakutaku.potamaid.client;

import com.mojang.blaze3d.platform.InputConstants;
import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import org.lwjgl.glfw.GLFW;

/** 相談画面を開くキー割り当て。論理サーバーには何も送らない。 */
@EventBusSubscriber(modid = PotamAId.MODID, value = Dist.CLIENT)
public final class ConsultKeys {
    private static final KeyMapping OPEN = new KeyMapping("key.potamaid.open_consult", InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_O, "key.categories.potamaid");

    private ConsultKeys() {}

    /** モッドバスのイベントなので PotamAIdClient のコンストラクタから登録する。 */
    public static void register(RegisterKeyMappingsEvent event) {
        event.register(OPEN);
    }

    @SubscribeEvent
    public static void onClientTick(ClientTickEvent.Post event) {
        Minecraft minecraft = Minecraft.getInstance();
        while (OPEN.consumeClick()) {
            if (minecraft.screen == null && minecraft.player != null) ConsultScreen.open();
        }
    }
}
