package io.github.bakutaku.potamaid.client.hologram;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.client.gui.Font;
import net.minecraft.client.renderer.LightTexture;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Mth;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import org.joml.Matrix4f;

/**
 * ホログラムの部品（テクスチャの枠・アイコン・半透明の四角・光の柱・文字）。表示する内容を知らないので、目標ボードなども同じ部品で作れる。
 * 板は「1 単位 = 1/64 ブロック、y は下向き、z は手前が正」の座標で描く（{@link HologramPanelRenderer}）。
 * 種類の違う描画を切り替えると、それまでの分が先に描かれる。奥のものから順に描き、描く直前にバッファを取り直すこと。
 */
@OnlyIn(Dist.CLIENT)
public final class HologramPainter {
    /** 枠の 9 スライス（16 × 16 のセルを 3 × 3）。 */
    private static final ResourceLocation PANEL = ResourceLocation.fromNamespaceAndPath(PotamAId.MODID, "textures/hologram/panel.png");
    private static final ResourceLocation ICONS = ResourceLocation.fromNamespaceAndPath(PotamAId.MODID, "textures/hologram/icons.png");
    private static final int CELL = 16;

    /** icons.png の並び順。 */
    public enum Icon { CONNECTED, DISCONNECTED, APPROVAL, UNREAD, RUNNING }

    private HologramPainter() {}

    public static int argb(int alpha, int rgb) { return (Mth.clamp(alpha, 0, 255) << 24) | (rgb & 0xFFFFFF); }

    /** 色を別の色へ寄せる（フラッシュ用）。 */
    public static int mix(int rgb, int other, float amount) {
        int r = Mth.lerpInt(amount, (rgb >> 16) & 0xFF, (other >> 16) & 0xFF);
        int g = Mth.lerpInt(amount, (rgb >> 8) & 0xFF, (other >> 8) & 0xFF);
        int b = Mth.lerpInt(amount, rgb & 0xFF, (other & 0xFF));
        return (r << 16) | (g << 8) | b;
    }

    public static VertexConsumer quads(MultiBufferSource buffer) { return buffer.getBuffer(RenderType.debugQuads()); }

    // ---- テクスチャ（板の座標） ----

    /** 9 スライスの枠。角はそのまま、辺と中央は 16 単位ずつ繰り返して、大きさによらず同じ密度で描く。argb は色の掛け合わせ。 */
    public static void frame(PoseStack pose, MultiBufferSource buffer, float width, float height, float z, int argb) {
        VertexConsumer out = buffer.getBuffer(RenderType.text(PANEL));
        Matrix4f m = pose.last().pose();
        for (float y = 0; y < height; ) {
            int row = y < CELL ? 0 : y >= height - CELL ? 2 : 1;
            float y2 = row == 1 ? Math.min(y + CELL, height - CELL) : y + CELL;
            for (float x = 0; x < width; ) {
                int column = x < CELL ? 0 : x >= width - CELL ? 2 : 1;
                float x2 = column == 1 ? Math.min(x + CELL, width - CELL) : x + CELL;
                float u = column * CELL, v = row * CELL;
                textured(m, out, x, y, x2, y2, z, u / 48f, v / 48f, (u + x2 - x) / 48f, (v + y2 - y) / 48f, argb);
                x = x2;
            }
            y = y2;
        }
    }

    /** アイコン。左上 (x, y) から size 四方に描く。 */
    public static void icon(PoseStack pose, MultiBufferSource buffer, Icon icon, float x, float y, float size, float z, int argb) {
        VertexConsumer out = buffer.getBuffer(RenderType.text(ICONS));
        float u = icon.ordinal() / 5f;
        textured(pose.last().pose(), out, x, y, x + size, y + size, z, u, 0, u + 0.2f, 1, argb);
    }

    /** 中心のまわりに angle（ラジアン）だけ回したアイコン。実行中の歯車などに使う。 */
    public static void spinningIcon(PoseStack pose, MultiBufferSource buffer, Icon icon, float x, float y, float size, float z, float angle, int argb) {
        pose.pushPose();
        pose.translate(x + size / 2, y + size / 2, 0);
        pose.mulPose(com.mojang.math.Axis.ZP.rotation(angle));
        icon(pose, buffer, icon, -size / 2, -size / 2, size, z, argb);
        pose.popPose();
    }

    /** 文字と同じ頂点の順（左上・左下・右下・右上）で、表から見える向きにする。 */
    private static void textured(Matrix4f m, VertexConsumer out, float x1, float y1, float x2, float y2, float z,
            float u1, float v1, float u2, float v2, int argb) {
        out.addVertex(m, x1, y1, z).setColor(argb).setUv(u1, v1).setLight(LightTexture.FULL_BRIGHT);
        out.addVertex(m, x1, y2, z).setColor(argb).setUv(u1, v2).setLight(LightTexture.FULL_BRIGHT);
        out.addVertex(m, x2, y2, z).setColor(argb).setUv(u2, v2).setLight(LightTexture.FULL_BRIGHT);
        out.addVertex(m, x2, y1, z).setColor(argb).setUv(u2, v1).setLight(LightTexture.FULL_BRIGHT);
    }

    // ---- 単色（板の座標） ----

    /** 単色の四角。 */
    public static void rect(PoseStack pose, VertexConsumer out, float x1, float y1, float x2, float y2, float z, int argb) {
        gradient(pose, out, x1, y1, x2, y2, z, argb, argb);
    }

    /** 上辺と下辺で色が違う四角。 */
    public static void gradient(PoseStack pose, VertexConsumer out, float x1, float y1, float x2, float y2, float z, int top, int bottom) {
        Matrix4f m = pose.last().pose();
        out.addVertex(m, x1, y1, z).setColor(top);
        out.addVertex(m, x1, y2, z).setColor(bottom);
        out.addVertex(m, x2, y2, z).setColor(bottom);
        out.addVertex(m, x2, y1, z).setColor(top);
    }

    /** 枠線。 */
    public static void outline(PoseStack pose, VertexConsumer out, float x1, float y1, float x2, float y2, float z, float width, int argb) {
        rect(pose, out, x1, y1, x2, y1 + width, z, argb);
        rect(pose, out, x1, y2 - width, x2, y2, z, argb);
        rect(pose, out, x1, y1 + width, x1 + width, y2 - width, z, argb);
        rect(pose, out, x2 - width, y1 + width, x2, y2 - width, z, argb);
    }

    /** 下から上へ薄れる光の柱。十字に交差した 2 枚の板で、どの向きからも見える。ブロックの座標（y は上向き）。 */
    public static void beam(PoseStack pose, VertexConsumer out, float centerX, float centerZ, float yBottom, float yTop, float halfWidth, int rgb, int bottomAlpha) {
        Matrix4f m = pose.last().pose();
        int bottom = argb(bottomAlpha, rgb);
        int top = argb(0, rgb);
        out.addVertex(m, centerX - halfWidth, yBottom, centerZ).setColor(bottom);
        out.addVertex(m, centerX + halfWidth, yBottom, centerZ).setColor(bottom);
        out.addVertex(m, centerX + halfWidth, yTop, centerZ).setColor(top);
        out.addVertex(m, centerX - halfWidth, yTop, centerZ).setColor(top);
        out.addVertex(m, centerX, yBottom, centerZ - halfWidth).setColor(bottom);
        out.addVertex(m, centerX, yBottom, centerZ + halfWidth).setColor(bottom);
        out.addVertex(m, centerX, yTop, centerZ + halfWidth).setColor(top);
        out.addVertex(m, centerX, yTop, centerZ - halfWidth).setColor(top);
    }

    // ---- 文字（板の座標。z = 0 が文字の面） ----

    public static void text(PoseStack pose, MultiBufferSource buffer, Font font, Component text, float x, float y, int argb) {
        font.drawInBatch(text, x, y, argb, false, pose.last().pose(), buffer, Font.DisplayMode.NORMAL, 0, LightTexture.FULL_BRIGHT);
    }

    public static void text(PoseStack pose, MultiBufferSource buffer, Font font, FormattedCharSequence text, float x, float y, int argb) {
        font.drawInBatch(text, x, y, argb, false, pose.last().pose(), buffer, Font.DisplayMode.NORMAL, 0, LightTexture.FULL_BRIGHT);
    }

    /** 幅に収まらない分を切って描く。 */
    public static void textClipped(PoseStack pose, MultiBufferSource buffer, Font font, String text, float x, float y, int maxWidth, int argb) {
        text(pose, buffer, font, Component.literal(font.plainSubstrByWidth(text, Math.max(0, maxWidth))), x, y, argb);
    }

    /** 右端を揃えて描く。 */
    public static void textRight(PoseStack pose, MultiBufferSource buffer, Font font, Component text, float right, float y, int argb) {
        text(pose, buffer, font, text, right - font.width(text), y, argb);
    }

    /** 中央を揃えて描く。scale は文字の倍率。 */
    public static void textCentered(PoseStack pose, MultiBufferSource buffer, Font font, Component text, float centerX, float y, float scale, int argb) {
        pose.pushPose();
        pose.translate(centerX, y, 0);
        pose.scale(scale, scale, 1);
        text(pose, buffer, font, text, -font.width(text) / 2f, 0, argb);
        pose.popPose();
    }
}
