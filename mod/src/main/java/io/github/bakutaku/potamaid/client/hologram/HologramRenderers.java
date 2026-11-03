package io.github.bakutaku.potamaid.client.hologram;

import io.github.bakutaku.potamaid.PotamAId;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

/** ホログラムの描画クラスの登録。 */
@OnlyIn(Dist.CLIENT)
public final class HologramRenderers {
    /** これより遠い看板は描画しない（看板の中心からのブロック単位の距離）。 */
    public static final int VIEW_DISTANCE = 24;

    private HologramRenderers() {}

    public static void register(EntityRenderersEvent.RegisterRenderers event) {
        event.registerBlockEntityRenderer(PotamAId.PROGRESS_BOARD_ENTITY.get(), ProgressBoardRenderer::new);
        event.registerBlockEntityRenderer(PotamAId.NOTICE_LAMP_ENTITY.get(), NoticeLampRenderer::new);
        event.registerBlockEntityRenderer(PotamAId.STATUS_DISPLAY_ENTITY.get(), StatusDisplayRenderer::new);
    }
}
