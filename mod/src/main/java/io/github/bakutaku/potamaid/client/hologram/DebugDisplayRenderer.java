package io.github.bakutaku.potamaid.client.hologram;

import com.google.gson.JsonObject;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.PotamAIdClient;
import io.github.bakutaku.potamaid.block.HologramBlockEntity;
import io.github.bakutaku.potamaid.client.BridgeStatusCache;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.State;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.Summary;
import io.github.bakutaku.potamaid.connection.GameConnection;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import net.minecraft.Util;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.Mth;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import net.neoforged.fml.ModList;

/**
 * 開発用の情報ディスプレイ。Bridge・ゲーム MCP・クライアント・統合サーバー・ワールド・プレイヤー・このディスプレイ自身の状態を、
 * 見出し付きの「項目 値」の一覧で映す。幅 1・高さ 1 では要約だけを映す。
 * 看板が大きいほど段を増やして並べ、入りきらなければ文字を小さくする（それでも入らない分は描かない）。
 * 値はクライアントで読めるものを毎フレーム集める。Bridge の内容は BridgeStatusCache から読むだけで、通信はしない。
 */
@OnlyIn(Dist.CLIENT)
public final class DebugDisplayRenderer extends HologramPanelRenderer {
    private static final ResourceLocation FRAME = ResourceLocation.fromNamespaceAndPath(PotamAId.MODID, "textures/hologram/debug_panel.png");
    private static final int VIOLET = 0xC58CFF;
    private static final int LINE = 10;
    /** 見出しの前の余白。 */
    private static final int GAP = 4;
    /** 1 段の最小の幅（文字の倍率を掛ける前の単位）。 */
    private static final int COLUMN_WIDTH = 150;
    /** 大きい順に試す文字の倍率。 */
    private static final float[] SCALES = { 1f, 0.75f, 0.5f };
    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss");

    /** 一覧の 1 行。label が null の行は見出しで、value を見出しとして描く。 */
    private record Line(Component label, String value, int color) {
        boolean heading() { return label == null; }
    }

    /** 置き場所の決まった 1 行。 */
    private record Placed(Line line, float x, float y, float width) {}

    private static String modVersion, minecraftVersion, neoForgeVersion;

    public DebugDisplayRenderer(BlockEntityRendererProvider.Context context) {
        super(context);
    }

    @Override
    protected boolean visible(State state) { return true; }

    @Override
    protected Look look(State state, float time) {
        float flicker = 0.94f + 0.06f * Mth.sin(time * 0.9f);
        return new Look(0xFFFFFF, VIOLET, flicker, 0f, false);
    }

    @Override
    protected ResourceLocation frameTexture() { return FRAME; }

    @Override
    protected void content(Panel panel, State state, Look look) {
        float top = header(panel, Component.translatable("hologram.potamaid.debug.title"), VIOLET);
        if (panel.columns() > 1) {
            HologramPainter.textRight(panel.pose(), panel.buffer(), font, Component.literal(LocalTime.now().format(CLOCK)), panel.width() - PAD, 5, panel.color(GRAY));
        }
        List<Line> lines = panel.size() == Size.COMPACT && panel.rows() == 1 ? summary(state) : details(panel, state);

        float width = panel.width() - PAD * 2, height = panel.height() - top - PAD;
        float scale = SCALES[SCALES.length - 1];
        List<Placed> placed = null;
        for (float candidate : SCALES) {
            List<Placed> attempt = layout(lines, width / candidate, height / candidate);
            if (attempt.size() == lines.size() || candidate == scale) {
                scale = candidate;
                placed = attempt;
                break;
            }
        }

        panel.pose().pushPose();
        panel.pose().translate(PAD, top, 0);
        panel.pose().scale(scale, scale, 1);
        for (Placed item : placed) draw(panel, item);
        panel.pose().popPose();
    }

    // ---- 並べ方と描き方 ----

    /** 上から下へ、段の高さが尽きたら右の段へ流す。見出しは次の 1 行と同じ段に置く。入らなかった行は返さない。 */
    private static List<Placed> layout(List<Line> lines, float width, float height) {
        int columns = Math.max(1, (int) (width / COLUMN_WIDTH));
        float columnWidth = width / columns;
        List<Placed> placed = new ArrayList<>();
        int column = 0;
        float y = 0;
        for (int i = 0; i < lines.size(); i++) {
            Line line = lines.get(i);
            float before = line.heading() && y > 0 ? GAP : 0;
            float need = before + LINE + (line.heading() && i + 1 < lines.size() ? LINE + 2 : 0);
            if (y + need > height) {
                if (++column >= columns) break;
                y = 0;
                before = 0;
            }
            y += before;
            placed.add(new Placed(line, column * columnWidth, y, columnWidth - 6));
            y += line.heading() ? LINE + 2 : LINE;
        }
        return placed;
    }

    private void draw(Panel panel, Placed item) {
        Line line = item.line();
        if (line.heading()) {
            HologramPainter.textClipped(panel.pose(), panel.buffer(), font, line.value(), item.x(), item.y(), (int) item.width(), panel.color(line.color()));
            HologramPainter.rect(panel.pose(), HologramPainter.quads(panel.buffer()), item.x(), item.y() + LINE - 1, item.x() + item.width(), item.y() + LINE,
                    -0.4f, panel.color(0x60, line.color()));
            return;
        }
        // 値を優先して右に寄せ、項目名は残りの幅で切る。値が長いときも幅の半分は項目名に残す。
        int labelWidth = font.width(line.label());
        int valueMax = (int) Math.max(item.width() * 0.5f, item.width() - labelWidth - 4);
        String value = font.plainSubstrByWidth(line.value(), valueMax);
        float valueLeft = item.x() + item.width() - font.width(value);
        HologramPainter.textClipped(panel.pose(), panel.buffer(), font, line.label().getString(), item.x(), item.y(),
                (int) (valueLeft - item.x() - 4), panel.color(GRAY));
        HologramPainter.text(panel.pose(), panel.buffer(), font, Component.literal(value), valueLeft, item.y(), panel.color(line.color()));
    }

    // ---- 映す内容 ----

    /** 幅 1・高さ 1 の要約。 */
    private static List<Line> summary(State state) {
        Minecraft minecraft = Minecraft.getInstance();
        List<Line> lines = new ArrayList<>();
        lines.add(row("bridge.status", bridgeStatus(state), bridgeColor(state)));
        lines.add(row("mcp.status", mcpStatus(), mcpColor()));
        lines.add(row("client.fps", String.valueOf(minecraft.getFps()), PALE));
        MinecraftServer server = minecraft.getSingleplayerServer();
        if (server != null) lines.add(row("server.mspt", mspt(server), msptColor(server)));
        return lines;
    }

    private static List<Line> details(Panel panel, State state) {
        Minecraft minecraft = Minecraft.getInstance();
        HologramBlockEntity be = panel.be();
        List<Line> lines = new ArrayList<>();

        // Bridge
        Summary summary = BridgeStatusCache.get().summary();
        boolean fetched = state.connected() && summary.refreshedAt() > 0;
        heading(lines, "bridge");
        lines.add(row("bridge.status", bridgeStatus(state), bridgeColor(state)));
        lines.add(row("bridge.project", state.project().isBlank() ? "-" : state.project(), CYAN));
        lines.add(row("bridge.counts", fetched ? summary.goals() + " / " + summary.tasks() + " / " + summary.consults() : "-", PALE));
        lines.add(row("bridge.running", String.valueOf(state.entries().size()), state.entries().isEmpty() ? PALE : CYAN));
        lines.add(row("bridge.approvals", String.valueOf(state.approvals()), state.approvals() > 0 ? AMBER : PALE));
        lines.add(row("bridge.unread", String.valueOf(state.unread()), state.unread() > 0 ? CYAN : PALE));
        lines.add(row("bridge.refreshed", fetched ? text("hologram.potamaid.debug.secondsAgo", (Util.getMillis() - summary.refreshedAt()) / 1000) : "-", GRAY));

        // ゲーム MCP
        GameConnection game = PotamAIdClient.game();
        heading(lines, "mcp");
        lines.add(row("mcp.status", mcpStatus(), mcpColor()));
        lines.add(row("mcp.port", game == null ? "-" : String.valueOf(game.port()), PALE));
        String error = game == null ? "" : value(game.state(), "error");
        if (!error.isBlank()) lines.add(row("mcp.error", error, RED));

        // クライアント
        Runtime runtime = Runtime.getRuntime();
        long usedMb = (runtime.totalMemory() - runtime.freeMemory()) >> 20, maxMb = runtime.maxMemory() >> 20;
        heading(lines, "client");
        lines.add(row("client.fps", String.valueOf(minecraft.getFps()), PALE));
        lines.add(row("client.memory", usedMb + " / " + maxMb + " MB", usedMb > maxMb * 0.85 ? AMBER : PALE));
        lines.add(row("client.mod", versions()[0], VIOLET));
        lines.add(row("client.minecraft", versions()[1], PALE));
        lines.add(row("client.neoforge", versions()[2], PALE));

        // 統合サーバー（シングルプレイのときだけ）
        MinecraftServer server = minecraft.getSingleplayerServer();
        heading(lines, "server");
        if (server != null) {
            lines.add(row("server.mspt", mspt(server), msptColor(server)));
            lines.add(row("server.players", String.valueOf(server.getPlayerCount()), PALE));
        } else {
            lines.add(row("server.mode", text("hologram.potamaid.debug.server.remote"), GRAY));
        }

        // ワールド
        ClientLevel level = minecraft.level;
        BlockPos pos = be.getBlockPos();
        if (level != null) {
            long dayTime = level.getDayTime();
            long clock = (dayTime + 6000) % 24000;
            heading(lines, "world");
            lines.add(row("world.dimension", level.dimension().location().toString(), PALE));
            lines.add(row("world.biome", level.getBiome(pos).unwrapKey().map(key -> key.location().toString()).orElse("?"), PALE));
            lines.add(row("world.time", text("hologram.potamaid.debug.world.day", dayTime / 24000 + 1,
                    String.format(Locale.ROOT, "%02d:%02d", clock / 1000, clock % 1000 * 60 / 1000)), PALE));
            lines.add(row("world.weather", text(level.isThundering() ? "hologram.potamaid.debug.world.thunder"
                    : level.isRaining() ? "hologram.potamaid.debug.world.rain" : "hologram.potamaid.debug.world.clear"), PALE));
            lines.add(row("world.entities", String.valueOf(level.getEntityCount()), PALE));
        }

        // プレイヤー
        LocalPlayer player = minecraft.player;
        if (player != null) {
            ItemStack held = player.getMainHandItem();
            heading(lines, "player");
            lines.add(row("player.name", player.getGameProfile().getName(), PALE));
            lines.add(row("player.position", String.format(Locale.ROOT, "%.1f %.1f %.1f", player.getX(), player.getY(), player.getZ()), PALE));
            lines.add(row("player.facing", String.format(Locale.ROOT, "%s (%.0f / %.0f)", player.getDirection().getName(),
                    Mth.wrapDegrees(player.getYRot()), player.getXRot()), PALE));
            lines.add(row("player.health", String.format(Locale.ROOT, "%.1f / %.1f", player.getHealth(), player.getMaxHealth()), PALE));
            lines.add(row("player.food", String.valueOf(player.getFoodData().getFoodLevel()), PALE));
            lines.add(row("player.held", held.isEmpty() ? "-" : BuiltInRegistries.ITEM.getKey(held.getItem()) + " x" + held.getCount(), PALE));
            if (minecraft.gameMode != null) lines.add(row("player.mode", minecraft.gameMode.getPlayerMode().getName(), PALE));
            lines.add(row("player.distance", String.format(Locale.ROOT, "%.1f", Math.sqrt(player.distanceToSqr(pos.getCenter()))), PALE));
        }

        // このディスプレイ
        heading(lines, "display");
        lines.add(row("display.position", pos.getX() + " " + pos.getY() + " " + pos.getZ(), PALE));
        lines.add(row("display.facing", be.getBlockState().getValue(HorizontalDirectionalBlock.FACING).getName(), PALE));
        lines.add(row("display.size", panel.columns() + " x " + panel.rows(), PALE));
        return lines;
    }

    // ---- 値 ----

    private static String bridgeStatus(State state) {
        if (!state.enabled()) return text("hologram.potamaid.debug.off");
        return text(state.connected() ? "hologram.potamaid.connected" : "hologram.potamaid.disconnected");
    }

    private static int bridgeColor(State state) { return !state.enabled() ? GRAY : state.connected() ? GREEN : RED; }

    private static String mcpStatus() {
        GameConnection game = PotamAIdClient.game();
        if (game == null) return text("hologram.potamaid.debug.mcp.starting");
        if (!game.enabled()) return text("hologram.potamaid.debug.off");
        JsonObject state = game.state();
        if (value(state, "mcpAvailable").equals("true")) return text("hologram.potamaid.debug.mcp.open");
        if (!value(state, "error").isBlank()) return text("hologram.potamaid.debug.mcp.error");
        return text("hologram.potamaid.debug.mcp.closed");
    }

    private static int mcpColor() {
        GameConnection game = PotamAIdClient.game();
        if (game == null || !game.enabled()) return GRAY;
        JsonObject state = game.state();
        if (value(state, "mcpAvailable").equals("true")) return GREEN;
        return value(state, "error").isBlank() ? GRAY : RED;
    }

    /** 1 ティックの平均の処理時間と、そこから求めた TPS。 */
    private static String mspt(MinecraftServer server) {
        double millis = server.getAverageTickTimeNanos() / 1_000_000.0;
        double tps = Math.min(server.tickRateManager().tickrate(), 1000.0 / Math.max(millis, 0.001));
        return String.format(Locale.ROOT, "%.1f TPS / %.1f ms", tps, millis);
    }

    private static int msptColor(MinecraftServer server) {
        double millis = server.getAverageTickTimeNanos() / 1_000_000.0;
        return millis > 50 ? RED : millis > 40 ? AMBER : GREEN;
    }

    /** Mod・Minecraft・NeoForge の版。起動中は変わらないので一度だけ調べる。 */
    private static String[] versions() {
        if (modVersion == null) {
            modVersion = version(PotamAId.MODID);
            minecraftVersion = version("minecraft");
            neoForgeVersion = version("neoforge");
        }
        return new String[] { modVersion, minecraftVersion, neoForgeVersion };
    }

    private static String version(String modId) {
        return ModList.get().getModContainerById(modId).map(container -> container.getModInfo().getVersion().toString()).orElse("?");
    }

    // ---- 部品 ----

    private static void heading(List<Line> lines, String section) {
        lines.add(new Line(null, text("hologram.potamaid.debug." + section), VIOLET));
    }

    private static Line row(String key, String value, int color) {
        return new Line(Component.translatable("hologram.potamaid.debug." + key), value, color);
    }

    private static String text(String key, Object... args) { return Component.translatable(key, args).getString(); }

    private static String value(JsonObject object, String key) {
        return object.has(key) && object.get(key).isJsonPrimitive() ? object.get(key).getAsString() : "";
    }
}
