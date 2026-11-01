package io.github.bakutaku.potamaid.client;

import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;

/**
 * 相談デスクの右クリックはクライアントで取り消し、論理サーバーへ送らない。
 * ブロック本体は画面を知らないので、専用サーバーでも安全に読み込める。
 */
@EventBusSubscriber(modid = PotamAId.MODID, value = Dist.CLIENT)
public final class ConsultDeskInteraction {
    private ConsultDeskInteraction() {}

    @SubscribeEvent
    public static void onRightClickBlock(PlayerInteractEvent.RightClickBlock event) {
        // スニーク中は手持ちのブロックを置けるよう、通常の処理に任せる。
        if (!event.getLevel().isClientSide() || event.getEntity().isSecondaryUseActive()) return;
        if (!event.getLevel().getBlockState(event.getPos()).is(PotamAId.CONSULT_DESK.get())) return;
        event.setCanceled(true);
        event.setCancellationResult(InteractionResult.SUCCESS);
        if (event.getHand() == InteractionHand.MAIN_HAND) ConsultScreen.open();
    }
}
