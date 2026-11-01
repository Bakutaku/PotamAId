package io.github.bakutaku.potamaid.client.hologram;

import io.github.bakutaku.potamaid.block.HologramBlockEntity;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.Entry;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.State;
import io.github.bakutaku.potamaid.client.hologram.HologramPainter.Icon;
import java.util.List;
import net.minecraft.Util;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Mth;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;

/**
 * 接続状態と実行中のタスクの進み具合を看板に映す。大きさごとの内容:
 * 幅 1 = 状態のアイコンと実行中の件数（縦に長ければ各タスクの短い名前と進捗バー）、
 * 幅 2 以上・高さ 1 = 1 件のタスク名・進捗バー・目標名、幅 2・高さ 2 以上 = 1 件の詳細と最新の途中経過、
 * 幅 3 以上・高さ 2 以上 = 実行中のタスクの一覧と、注目中の 1 件の最新の途中経過。
 */
@OnlyIn(Dist.CLIENT)
public final class ProgressBoardRenderer extends HologramPanelRenderer {
    /** 複数あるときに注目する 1 件を切り替える間隔（ティック）。 */
    private static final int SWITCH_TICKS = 100;
    private static final int LINE = 10;

    public ProgressBoardRenderer(BlockEntityRendererProvider.Context context) {
        super(context);
    }

    @Override
    protected boolean visible(State state) { return true; }

    @Override
    protected Look look(State state, float time) {
        if (!state.connected()) return new Look(0xFF9090, RED, 1f, 0f, false);
        // 走査線のちらつき程度に、ごくわずかに明るさを揺らす。
        float flicker = 0.94f + 0.06f * Mth.sin(time * 0.9f);
        return new Look(0xFFFFFF, CYAN, flicker, 0f, !state.entries().isEmpty());
    }

    @Override
    protected void content(Panel panel, State state, Look look) {
        List<Entry> entries = state.connected() ? state.entries() : List.of();
        switch (panel.size()) {
            case COMPACT -> compact(panel, state, entries);
            case STRIP -> strip(panel, state, entries);
            default -> large(panel, state, entries);
        }
    }

    // ---- 大きさごとの内容 ----

    private void compact(Panel panel, State state, List<Entry> entries) {
        Icon icon = statusIcon(state, entries);
        drawStatusIcon(panel, icon, 16, 8, 32);
        Component count = Component.literal(state.connected() ? String.valueOf(entries.size()) : "-");
        HologramPainter.textCentered(panel.pose(), panel.buffer(), font, count, 32, 44, 1.2f, panel.color(statusColor(icon)));
        // 縦に長いときは、残りの高さに各タスクの短い名前と進捗バーを並べる。
        float y = BLOCK + 4;
        for (Entry entry : entries) {
            if (y + 18 > panel.height() - PAD) break;
            int color = entry.approval() ? AMBER : CYAN;
            HologramPainter.textClipped(panel.pose(), panel.buffer(), font, entry.title(), PAD, y, (int) panel.width() - PAD * 2, panel.color(color));
            bar(panel, PAD, y + 11, panel.width() - PAD, y + 16, progress(entry), color);
            y += 22;
        }
    }

    private void strip(Panel panel, State state, List<Entry> entries) {
        float left = PAD, right = panel.width() - PAD;
        int inner = (int) (right - left);
        Icon icon = statusIcon(state, entries);
        if (entries.isEmpty()) {
            drawStatusIcon(panel, icon, left, 6, 16);
            Component title = Component.translatable(state.connected() ? "hologram.potamaid.board.idle" : "hologram.potamaid.disconnected");
            HologramPainter.text(panel.pose(), panel.buffer(), font, title, left + 20, 10, panel.color(state.connected() ? GRAY : RED));
            if (!state.connected()) {
                HologramPainter.text(panel.pose(), panel.buffer(), font, Component.translatable("hologram.potamaid.disconnectedHint"), left, 34, panel.color(GRAY));
                return;
            }
            HologramPainter.textClipped(panel.pose(), panel.buffer(), font, state.project(), left, 30, inner, panel.color(CYAN));
            if (state.approvals() > 0) {
                HologramPainter.text(panel.pose(), panel.buffer(), font, Component.translatable("hologram.potamaid.lamp.approvals", state.approvals()), left, 44, panel.color(AMBER));
            }
            return;
        }
        int index = focusIndex(panel, entries);
        Entry entry = entries.get(index);
        int color = entry.approval() ? AMBER : CYAN;
        drawStatusIcon(panel, entry.approval() ? Icon.APPROVAL : Icon.RUNNING, left, 6, 16);
        int counterWidth = 0;
        if (entries.size() > 1) {
            Component counter = Component.literal((index + 1) + "/" + entries.size());
            counterWidth = font.width(counter) + 4;
            HologramPainter.textRight(panel.pose(), panel.buffer(), font, counter, right, 10, panel.color(GRAY));
        }
        HologramPainter.textClipped(panel.pose(), panel.buffer(), font, entry.title(), left + 20, 10, inner - 20 - counterWidth, panel.color(color));
        drawProgress(panel, entry, left, 28, right, color);
        HologramPainter.textClipped(panel.pose(), panel.buffer(), font, entry.goal(), left, 44, inner, panel.color(GRAY));
    }

    private void large(Panel panel, State state, List<Entry> entries) {
        float left = PAD, right = panel.width() - PAD;
        int inner = (int) (right - left);
        float top = header(panel, Component.translatable("hologram.potamaid.board.title"), CYAN);
        Component link = Component.translatable(state.connected() ? "hologram.potamaid.connected" : "hologram.potamaid.disconnected");
        HologramPainter.textRight(panel.pose(), panel.buffer(), font, link, right, 5, panel.color(state.connected() ? GREEN : RED));
        HologramPainter.icon(panel.pose(), panel.buffer(), state.connected() ? Icon.CONNECTED : Icon.DISCONNECTED, right - font.width(link) - 12, 4, 10, -0.1f, panel.color(0xFFFFFF));

        float middle = (top + panel.height()) / 2;
        if (!state.connected()) {
            HologramPainter.textCentered(panel.pose(), panel.buffer(), font, Component.translatable("hologram.potamaid.disconnected"), panel.width() / 2, middle - 12, 1.6f, panel.color(RED));
            HologramPainter.textCentered(panel.pose(), panel.buffer(), font, Component.translatable("hologram.potamaid.disconnectedHint"), panel.width() / 2, middle + 10, 0.8f, panel.color(GRAY));
            return;
        }
        if (entries.isEmpty()) {
            HologramPainter.textCentered(panel.pose(), panel.buffer(), font, Component.translatable("hologram.potamaid.board.idle"), panel.width() / 2, middle - 14, 1.1f, panel.color(GRAY));
            if (!state.project().isBlank()) {
                HologramPainter.textCentered(panel.pose(), panel.buffer(), font, Component.literal(font.plainSubstrByWidth(state.project(), inner)), panel.width() / 2, middle + 2, 1f, panel.color(CYAN));
            }
            if (state.approvals() > 0) {
                HologramPainter.textCentered(panel.pose(), panel.buffer(), font, Component.translatable("hologram.potamaid.lamp.approvals", state.approvals()), panel.width() / 2, middle + 16, 1f, panel.color(AMBER));
            }
            return;
        }

        int index = focusIndex(panel, entries);
        Entry focus = entries.get(index);
        float y = top;
        if (panel.size() == Size.LIST) {
            // 一覧。注目中の 1 件に印を付ける。下に途中経過を 2 行以上残す。
            int fit = Math.max(1, (int) ((panel.height() - top - PAD - LINE * 2 - 6) / 14));
            float barLeft = left + inner * 0.55f, barRight = right - 30;
            for (int i = 0; i < Math.min(fit, entries.size()); i++) {
                Entry entry = entries.get(i);
                int color = entry.approval() ? AMBER : CYAN;
                boolean focused = i == index;
                if (focused) HologramPainter.text(panel.pose(), panel.buffer(), font, Component.literal("▶"), left, y, panel.color(color));
                HologramPainter.textClipped(panel.pose(), panel.buffer(), font, entry.title(), left + 9, y, (int) (barLeft - left - 13), panel.color(focused ? color : PALE));
                bar(panel, barLeft, y + 1, barRight, y + 7, focused ? smoothProgress(panel.be(), focus) : progress(entry), color);
                HologramPainter.textRight(panel.pose(), panel.buffer(), font, Component.literal(entry.done() + "/" + entry.total()), right, y, panel.color(0xFFFFFF));
                y += 14;
            }
            if (entries.size() > fit) {
                HologramPainter.textRight(panel.pose(), panel.buffer(), font, Component.literal("+" + (entries.size() - fit)), right, y - 2, panel.color(GRAY));
            }
            HologramPainter.rect(panel.pose(), HologramPainter.quads(panel.buffer()), left, y + 1, right, y + 2, -0.4f, panel.color(0x50, CYAN));
            y += 6;
        } else {
            int color = focus.approval() ? AMBER : CYAN;
            int counterWidth = 0;
            if (entries.size() > 1) {
                Component counter = Component.literal((index + 1) + "/" + entries.size());
                counterWidth = font.width(counter) + 4;
                HologramPainter.textRight(panel.pose(), panel.buffer(), font, counter, right, y, panel.color(GRAY));
            }
            HologramPainter.textClipped(panel.pose(), panel.buffer(), font, focus.title(), left, y, inner - counterWidth, panel.color(color));
            HologramPainter.textClipped(panel.pose(), panel.buffer(), font, focus.goal(), left, y + LINE, inner, panel.color(GRAY));
            drawProgress(panel, focus, left, y + 22, right, color);
            y += 36;
        }
        // 注目中の 1 件の最新の途中経過（入るだけ）
        Component latest = focus.approval() ? Component.translatable("hologram.potamaid.board.approval")
                : focus.latest().isBlank() ? Component.translatable("hologram.potamaid.board.waiting") : Component.literal(focus.latest());
        List<FormattedCharSequence> lines = font.split(latest, inner);
        int maxLines = (int) ((panel.height() - PAD - y) / LINE);
        for (int i = 0; i < Math.min(maxLines, lines.size()); i++) {
            HologramPainter.text(panel.pose(), panel.buffer(), font, lines.get(i), left, y + i * LINE, panel.color(focus.approval() ? AMBER : PALE));
        }
    }

    // ---- 部品 ----

    private static Icon statusIcon(State state, List<Entry> entries) {
        if (!state.connected()) return Icon.DISCONNECTED;
        if (state.approvals() > 0 || entries.stream().anyMatch(Entry::approval)) return Icon.APPROVAL;
        return entries.isEmpty() ? Icon.CONNECTED : Icon.RUNNING;
    }

    private static int statusColor(Icon icon) {
        return switch (icon) {
            case DISCONNECTED -> RED;
            case APPROVAL -> AMBER;
            case CONNECTED -> GREEN;
            default -> CYAN;
        };
    }

    /** 実行中のアイコンは回す。 */
    private static void drawStatusIcon(Panel panel, Icon icon, float x, float y, float size) {
        if (icon == Icon.RUNNING) HologramPainter.spinningIcon(panel.pose(), panel.buffer(), icon, x, y, size, -0.1f, panel.time() * 0.08f, panel.color(0xFFFFFF));
        else HologramPainter.icon(panel.pose(), panel.buffer(), icon, x, y, size, -0.1f, panel.color(0xFFFFFF));
    }

    /** 進捗バーと「済み/全体」。バーの長さはなめらかに動かす。 */
    private void drawProgress(Panel panel, Entry entry, float left, float y, float right, int color) {
        bar(panel, left, y, right - 26, y + 8, smoothProgress(panel.be(), entry), color);
        HologramPainter.textRight(panel.pose(), panel.buffer(), font, Component.literal(entry.done() + "/" + entry.total()), right, y, panel.color(0xFFFFFF));
    }

    private static int focusIndex(Panel panel, List<Entry> entries) {
        return (int) ((panel.be().getLevel().getGameTime() / SWITCH_TICKS) % entries.size());
    }

    private static float progress(Entry entry) { return entry.total() == 0 ? 0 : (float) entry.done() / entry.total(); }

    /** 表示中の長さを目標へなめらかに近づける。対象が変わったら 0 から伸ばす。 */
    private static float smoothProgress(HologramBlockEntity be, Entry entry) {
        long now = Util.getMillis();
        String key = entry.goal() + "\n" + entry.title();
        if (!key.equals(be.shownKey)) { be.shownKey = key; be.shownProgress = 0; }
        float seconds = Mth.clamp((now - be.lastFrameMillis) / 1000f, 0f, 0.25f);
        be.lastFrameMillis = now;
        be.shownProgress += (progress(entry) - be.shownProgress) * Math.min(1f, seconds * 4f);
        return be.shownProgress;
    }
}
