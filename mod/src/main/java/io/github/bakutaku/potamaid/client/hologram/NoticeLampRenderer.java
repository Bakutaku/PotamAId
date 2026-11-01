package io.github.bakutaku.potamaid.client.hologram;

import io.github.bakutaku.potamaid.client.BridgeStatusCache.Entry;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.State;
import io.github.bakutaku.potamaid.client.hologram.HologramPainter.Icon;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.Util;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;

/**
 * 承認待ちと未読の返答の件数を看板に映し、点滅で知らせる。どちらも 0 のときは何も描かず消灯する。大きさごとの内容:
 * 幅 1 = 優先する方（承認待ち &gt; 未読）のアイコンと件数（縦に長ければ両方）、幅 2 以上・高さ 1 = 両方の件数を 1 行ずつ、
 * 幅 2 以上・高さ 2 以上 = 件数に加えて承認待ちのタスク名の一覧と、相談画面の開き方。
 */
@OnlyIn(Dist.CLIENT)
public final class NoticeLampRenderer extends HologramPanelRenderer {
    /** 件数が変わったときのフラッシュの長さ（ミリ秒）。 */
    private static final long FLASH_MILLIS = 1200;
    private static final int LINE = 10;

    /** 表示する通知 1 種類分。 */
    private record Notice(Icon icon, int color, int count, String key) {}

    public NoticeLampRenderer(BlockEntityRendererProvider.Context context) {
        super(context);
    }

    @Override
    protected boolean visible(State state) { return state.approvals() > 0 || state.unread() > 0; }

    @Override
    protected Look look(State state, float time) {
        boolean urgent = state.approvals() > 0;
        // 点滅。承認待ちがあるときは速く、強く。
        float blink = 0.5f + 0.5f * Mth.sin(time * (urgent ? 0.55f : 0.28f));
        float alpha = Mth.lerp(blink, urgent ? 0.45f : 0.6f, 1f);
        long sinceChange = Util.getMillis() - state.countsChangedAt();
        float flash = state.countsChangedAt() > 0 && sinceChange < FLASH_MILLIS ? 1f - sinceChange / (float) FLASH_MILLIS : 0f;
        int accent = HologramPainter.mix(urgent ? AMBER : CYAN, 0xFFFFFF, flash);
        return new Look(urgent ? 0xFFD890 : 0xFFFFFF, accent, alpha, flash, false);
    }

    @Override
    protected void content(Panel panel, State state, Look look) {
        List<Notice> notices = new ArrayList<>();
        if (state.approvals() > 0) notices.add(new Notice(Icon.APPROVAL, AMBER, state.approvals(), "hologram.potamaid.lamp.approvals"));
        if (state.unread() > 0) notices.add(new Notice(Icon.UNREAD, CYAN, state.unread(), "hologram.potamaid.lamp.unread"));
        // 文字は枠ほど薄くしない。
        int textAlpha = (int) (255 * Mth.lerp(0.5f, look.alpha(), 1f) / look.alpha());
        switch (panel.size()) {
            case COMPACT -> {
                for (int i = 0; i < Math.min(panel.rows(), notices.size()); i++) {
                    Notice notice = notices.get(i);
                    float y = i * BLOCK;
                    HologramPainter.icon(panel.pose(), panel.buffer(), notice.icon(), 16, y + 8, 32, -0.1f, panel.color(0xFFFFFF));
                    HologramPainter.textCentered(panel.pose(), panel.buffer(), font, Component.literal(String.valueOf(notice.count())), 32, y + 44, 1.2f,
                            panel.color(textAlpha, flashed(notice.color(), look)));
                }
            }
            case STRIP -> {
                float y = notices.size() == 1 ? 28 : 14;
                for (Notice notice : notices) {
                    line(panel, notice, y, textAlpha, look);
                    y += 24;
                }
            }
            default -> {
                float y = header(panel, Component.translatable("hologram.potamaid.lamp.title"), look.accent());
                for (Notice notice : notices) {
                    line(panel, notice, y + 4, textAlpha, look);
                    y += 16;
                }
                y += 6;
                // 承認待ちのタスク名（入るだけ）。一番下の行は相談画面の開き方に使う。
                float bottom = panel.height() - PAD - LINE;
                int inner = (int) panel.width() - PAD * 2;
                for (Entry entry : state.entries()) {
                    if (!entry.approval()) continue;
                    if (y + LINE > bottom) break;
                    HologramPainter.textClipped(panel.pose(), panel.buffer(), font, "・" + entry.title(), PAD, y, inner, panel.color(textAlpha, AMBER));
                    y += LINE;
                }
                HologramPainter.textClipped(panel.pose(), panel.buffer(), font, Component.translatable("hologram.potamaid.lamp.hint").getString(),
                        PAD, bottom + 1, inner, panel.color(textAlpha, GRAY));
            }
        }
    }

    /** アイコンと「承認待ち: N件」の 1 行。y は文字の上端。 */
    private void line(Panel panel, Notice notice, float y, int textAlpha, Look look) {
        HologramPainter.icon(panel.pose(), panel.buffer(), notice.icon(), PAD, y - 4, 16, -0.1f, panel.color(0xFFFFFF));
        HologramPainter.textClipped(panel.pose(), panel.buffer(), font, Component.translatable(notice.key(), notice.count()).getString(),
                PAD + 20, y, (int) panel.width() - PAD * 2 - 20, panel.color(textAlpha, flashed(notice.color(), look)));
    }

    private static int flashed(int rgb, Look look) { return HologramPainter.mix(rgb, 0xFFFFFF, look.flash()); }
}
