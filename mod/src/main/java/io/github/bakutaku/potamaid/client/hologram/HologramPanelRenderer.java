package io.github.bakutaku.potamaid.client.hologram;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import io.github.bakutaku.potamaid.block.HologramBlock;
import io.github.bakutaku.potamaid.block.HologramBlockEntity;
import io.github.bakutaku.potamaid.client.BridgeStatusCache;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.State;
import net.minecraft.client.gui.Font;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;

/**
 * 看板型のホログラムの共通の描画。ブロックの表の向きに固定した板に、テクスチャの枠・走査線・光の柱・フラッシュを描き、
 * 中身だけを種類ごとのクラスが描く。隣り合う同じ看板は {@link PanelLayout} で連結し、左上のブロックだけが全体を描く。
 * 内容は BridgeStatusCache から読むだけで、通信はしない。
 */
@OnlyIn(Dist.CLIENT)
public abstract class HologramPanelRenderer implements BlockEntityRenderer<HologramBlockEntity> {
    /** 1 ブロックあたりの板の座標の単位数。文字の 1 ドットが 1 単位になる。 */
    public static final int BLOCK = 64;
    protected static final int PAD = 5;
    protected static final int CYAN = 0x40E0FF;
    protected static final int GREEN = 0x55FF88;
    protected static final int RED = 0xFF5555;
    protected static final int AMBER = 0xFFC04D;
    protected static final int GRAY = 0x9AB4BC;
    protected static final int PALE = 0xD8F4FF;
    /** 板の表面（ブロックの中心からの距離）。板の少し手前に浮かべる。 */
    private static final float FRONT = -0.5f + HologramBlock.PLATE_DEPTH / 16f + 0.03f;

    protected final Font font;

    protected HologramPanelRenderer(BlockEntityRendererProvider.Context context) {
        this.font = context.getFont();
    }

    /** 連結した看板の大きさに応じた、表示の細かさの段階。 */
    public enum Size {
        /** 幅 1 ブロック: アイコンと件数だけ。 */
        COMPACT,
        /** 幅 2 以上・高さ 1: 1 件を 1 行の要約で。 */
        STRIP,
        /** 幅 2・高さ 2 以上: 1 件を詳しく。 */
        DETAIL,
        /** 幅 3 以上・高さ 2 以上: 一覧と詳細。 */
        LIST;

        static Size of(int columns, int rows) {
            if (columns == 1) return COMPACT;
            if (rows == 1) return STRIP;
            return columns == 2 ? DETAIL : LIST;
        }
    }

    /** 枠の色と演出。tint は枠のテクスチャに掛ける色、accent は走査線などの色、flash は 0〜1。 */
    protected record Look(int tint, int accent, float alpha, float flash, boolean beam) {}

    /** 描画中の看板。width と height は板の座標の単位。 */
    protected record Panel(HologramBlockEntity be, PoseStack pose, MultiBufferSource buffer, int columns, int rows,
            float width, float height, Size size, float time, float alpha) {
        /** 板全体の明るさを掛けた色。 */
        public int color(int rgb) { return color(255, rgb); }

        /** 不透明度 opacity（0〜255）に板全体の明るさを掛けた色。 */
        public int color(int opacity, int rgb) { return HologramPainter.argb((int) (opacity * alpha), rgb); }
    }

    /** 何も描かずに消しておくか。 */
    protected abstract boolean visible(State state);

    protected abstract Look look(State state, float time);

    /** 中身を描く。枠と走査線は描き終わっている。奥のものから順に描くこと。 */
    protected abstract void content(Panel panel, State state, Look look);

    @Override
    public int getViewDistance() { return HologramRenderers.VIEW_DISTANCE; }

    /** 連結した看板の左上のブロックだけが描く。距離は看板の中心で測る。 */
    @Override
    public boolean shouldRender(HologramBlockEntity be, Vec3 cameraPos) {
        if (be.getLevel() == null) return false;
        PanelLayout.update(be);
        if (!be.isPanelOrigin()) return false;
        Direction right = PanelLayout.right(facing(be));
        Vec3 center = Vec3.atCenterOf(be.getBlockPos())
                .add(Vec3.atLowerCornerOf(right.getNormal()).scale((be.panelColumns - 1) / 2.0))
                .add(0, -(be.panelRows - 1) / 2.0, 0);
        return center.closerThan(cameraPos, getViewDistance());
    }

    /** 看板全体と、上に伸びる光の柱を視錐台の判定に含める。 */
    @Override
    public AABB getRenderBoundingBox(HologramBlockEntity be) {
        BlockPos corner = be.getBlockPos().relative(PanelLayout.right(facing(be)), be.panelColumns - 1).below(be.panelRows - 1);
        return new AABB(be.getBlockPos()).minmax(new AABB(corner)).inflate(0.5).expandTowards(0, 1.5, 0);
    }

    @Override
    public void render(HologramBlockEntity be, float partialTick, PoseStack pose, MultiBufferSource buffer, int packedLight, int packedOverlay) {
        if (be.getLevel() == null || !be.isPanelOrigin()) return;
        BridgeStatusCache cache = BridgeStatusCache.get();
        cache.touch();
        State state = cache.state();
        if (!visible(state)) return;

        float time = be.getLevel().getGameTime() + partialTick;
        Look look = look(state, time);
        int columns = be.panelColumns, rows = be.panelRows;

        pose.pushPose();
        // ブロックの中心を原点にし、表（FACING）が +z、表から見て右が +x になるよう回す。
        pose.translate(0.5, 0.5, 0.5);
        pose.mulPose(Axis.YP.rotationDegrees(-facing(be).toYRot()));
        // 揺れ: 板から少し浮かせ、前後にゆっくり揺らす。
        float front = FRONT + Mth.sin(time * 0.06f) * 0.008f;
        if (look.beam()) {
            float pulse = 0.65f + 0.35f * Mth.sin(time * 0.2f);
            HologramPainter.beam(pose, HologramPainter.quads(buffer), columns / 2f - 0.5f, front, 0.5f, 1.4f, 0.07f, look.accent(), (int) (110 * pulse));
        }
        // 看板の左上を原点にした板の座標にする。
        pose.translate(-0.5, 0.5, front);
        pose.scale(1f / BLOCK, -1f / BLOCK, 1f / BLOCK);
        Panel panel = new Panel(be, pose, buffer, columns, rows, columns * BLOCK, rows * BLOCK, Size.of(columns, rows), time, look.alpha());
        drawFrame(panel, look);
        content(panel, state, look);
        if (look.flash() > 0) {
            float grow = (1f - look.flash()) * 24;
            HologramPainter.outline(pose, HologramPainter.quads(buffer), -grow, -grow, panel.width() + grow, panel.height() + grow, 0.2f,
                    1.5f, HologramPainter.argb((int) (200 * look.flash()), 0xFFFFFF));
        }
        pose.popPose();
    }

    private void drawFrame(Panel panel, Look look) {
        HologramPainter.frame(panel.pose(), panel.buffer(), panel.width(), panel.height(), -1f,
                HologramPainter.argb((int) (255 * look.alpha()), HologramPainter.mix(look.tint(), 0xFFFFFF, look.flash())));
        // 流れる明るい帯（上から下へ繰り返す）
        var quads = HologramPainter.quads(panel.buffer());
        float height = panel.height();
        float band = (panel.time() * 0.7f) % (height + 16) - 8;
        for (int i = 0; i < 3; i++) {
            float y1 = Mth.clamp(band - i * 2, 2, height - 2);
            float y2 = Mth.clamp(band - i * 2 + 2, 2, height - 2);
            if (y2 > y1) {
                HologramPainter.rect(panel.pose(), quads, 2, y1, panel.width() - 2, y2, -0.6f,
                        HologramPainter.argb((int) ((0x40 - i * 0x14) * look.alpha()), look.accent()));
            }
        }
    }

    // ---- 中身を描く部品 ----

    /** 見出しと区切り線。見出しの下（中身を描き始める y）を返す。 */
    protected float header(Panel panel, Component title, int accent) {
        HologramPainter.rect(panel.pose(), HologramPainter.quads(panel.buffer()), PAD, 16, panel.width() - PAD, 17, -0.4f, panel.color(0x70, accent));
        HologramPainter.text(panel.pose(), panel.buffer(), font, title, PAD, 5, panel.color(accent));
        return 22;
    }

    /** 進捗バー。先端に光を流す。 */
    protected static void bar(Panel panel, float x1, float y1, float x2, float y2, float fraction, int rgb) {
        PoseStack pose = panel.pose();
        var quads = HologramPainter.quads(panel.buffer());
        HologramPainter.rect(pose, quads, x1, y1, x2, y2, -0.5f, HologramPainter.argb(0x70, 0x000000));
        float fill = x1 + (x2 - x1) * Mth.clamp(fraction, 0, 1);
        if (fill > x1) {
            HologramPainter.gradient(pose, quads, x1, y1, fill, y2, -0.4f, panel.color(0xE0, rgb), panel.color(0x90, rgb));
            float shine = x1 + (fill - x1) * ((panel.time() * 0.03f) % 1f);
            HologramPainter.rect(pose, quads, Math.max(x1, shine - 3), y1, Math.min(fill, shine + 3), y2, -0.3f, HologramPainter.argb(0x70, 0xFFFFFF));
        }
        HologramPainter.outline(pose, quads, x1, y1, x2, y2, -0.2f, 1f, panel.color(0xC0, rgb));
    }

    private static Direction facing(HologramBlockEntity be) { return be.getBlockState().getValue(HorizontalDirectionalBlock.FACING); }
}
