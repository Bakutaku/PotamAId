package io.github.bakutaku.potamaid.client.hologram;

import com.google.gson.JsonObject;
import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.PotamAIdClient;
import io.github.bakutaku.potamaid.block.HologramBlockEntity;
import io.github.bakutaku.potamaid.client.BridgeStatusCache;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.ConsultInfo;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.Details;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.Entry;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.GoalInfo;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.State;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.Summary;
import io.github.bakutaku.potamaid.client.BridgeStatusCache.TaskInfo;
import io.github.bakutaku.potamaid.client.hologram.HologramPainter.Icon;
import io.github.bakutaku.potamaid.connection.GameConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.WeakHashMap;
import net.minecraft.Util;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import net.neoforged.fml.ModList;

/**
 * 状態ディスプレイ。PotamAId の状態（Bridge・ゲーム MCP の接続と、目標・タスク・相談）を文字の一覧で映す。
 * 進捗ボードが実行中の 1 件を進捗バーで見せるのに対し、こちらは対応が必要なものも含めて全体を確かめるためのもの。
 * 幅 2 以上では、右クリックでページ（概要・タスク・相談・接続）を切り替える。幅 1 では、どのページでも同じ要約を映す。
 * 看板が大きいほど段を増やして並べ、入りきらなければ文字を小さくする（それでも入らない分は描かない）。
 * 映す内容は BUILD_MILLIS ごとに作り直して看板ごとに持つ。Bridge の内容は BridgeStatusCache から読むだけで、通信はしない。
 */
@OnlyIn(Dist.CLIENT)
public final class StatusDisplayRenderer extends HologramPanelRenderer {
    private static final ResourceLocation FRAME = ResourceLocation.fromNamespaceAndPath(PotamAId.MODID, "textures/hologram/status_panel.png");
    private static final int VIOLET = 0xC58CFF;
    private static final int LINE = 10;
    /** 見出しの前の余白。 */
    private static final int GAP = 4;
    /** 1 段の最小の幅（文字の倍率を掛ける前の単位）。 */
    private static final int COLUMN_WIDTH = 150;
    /** 項目の印の幅（印と文字の間を含む）。 */
    private static final int MARK = 11;
    /** 大きい順に試す文字の倍率。 */
    private static final float[] SCALES = { 1f, 0.75f, 0.5f };
    /** 映す内容を作り直す間隔（ミリ秒）。 */
    private static final long BUILD_MILLIS = 250;
    private static final String KEY = "hologram.potamaid.status.";

    /** ページ。右クリックで順に切り替える。 */
    private enum Page {
        OVERVIEW, TASKS, CONSULTS, CONNECTION;

        Component title() { return Component.translatable(KEY + "page." + name().toLowerCase(Locale.ROOT)); }
    }

    private static final Page[] PAGES = Page.values();

    private enum Kind { HEADING, ROW, ITEM, NOTE }

    /**
     * 一覧の 1 行。HEADING = 見出し（text）と右端の補足（value）、ROW = 項目名（text）と値（value）、
     * ITEM = 印（icon。null なら点）と名前（text）と右端の状態（value）、NOTE = 補足の文（text）。color は見出し・値・印の色。
     */
    private record Line(Kind kind, Icon icon, String text, String value, int color) {}

    /** 段の中の置き場所。 */
    private record Slot(Line line, float x, float y, float width) {}

    /** 置き場所が決まり、幅に合わせて文字を切った 1 行。 */
    private record Placed(Line line, float x, float y, float width, Component text, Component value, float valueX) {}

    /** 看板ごとに作っておく内容。page が -1 なら幅 1 の要約。 */
    private record Built(long at, int page, int columns, int rows, float scale, List<Placed> placed) {}

    /** ゲーム MCP の状態。内容を作り直すときに 1 回だけ読む。 */
    private record Mcp(String status, int color, String port, String error) {}

    private static String modVersion;

    private final Map<HologramBlockEntity, Built> built = new WeakHashMap<>();

    public StatusDisplayRenderer(BlockEntityRendererProvider.Context context) {
        super(context);
    }

    /**
     * pos を含む看板のページを次に進める。右クリックの処理（client.ConsultDeskInteraction）が呼ぶ。
     * 幅 1 の看板はページを持たないので何もしない。進めたかを返す。
     */
    public static boolean nextPage(Level level, BlockPos pos) {
        if (!(level.getBlockEntity(pos) instanceof HologramBlockEntity be)) return false;
        PanelLayout.update(be);
        BlockPos origin = pos.relative(PanelLayout.right(be.getBlockState().getValue(HorizontalDirectionalBlock.FACING)).getOpposite(), be.panelColumn)
                .above(be.panelRow);
        if (!(level.getBlockEntity(origin) instanceof HologramBlockEntity first) || first.getType() != be.getType()) return false;
        PanelLayout.update(first);
        if (first.panelColumns == 1) return false;
        first.displayPage = (Math.floorMod(first.displayPage, PAGES.length) + 1) % PAGES.length;
        return true;
    }

    @Override
    protected boolean visible(State state) { return true; }

    @Override
    protected Look look(State state, float time) {
        float flicker = 0.94f + 0.06f * Mth.sin(time * 0.9f);
        return new Look(0xFFFFFF, state.enabled() && !state.connected() ? RED : VIOLET, flicker, 0f, false);
    }

    @Override
    protected ResourceLocation frameTexture() { return FRAME; }

    @Override
    protected void content(Panel panel, State state, Look look) {
        BridgeStatusCache.get().touchDetails();
        HologramBlockEntity be = panel.be();
        boolean compact = panel.size() == Size.COMPACT;
        int page = compact ? -1 : Math.floorMod(be.displayPage, PAGES.length);
        float top = compact ? PAD : tabs(panel, PAGES[Math.max(page, 0)]);

        long now = Util.getMillis();
        Built cache = built.get(be);
        if (cache == null || now - cache.at() >= BUILD_MILLIS || cache.page() != page || cache.columns() != panel.columns() || cache.rows() != panel.rows()) {
            List<Line> lines = compact ? compact(state, panel.rows()) : lines(PAGES[page], state);
            cache = build(lines, page, panel, top, now);
            built.put(be, cache);
        }

        panel.pose().pushPose();
        panel.pose().translate(PAD, top, 0);
        panel.pose().scale(cache.scale(), cache.scale(), 1);
        for (Placed item : cache.placed()) draw(panel, item);
        panel.pose().popPose();
    }

    // ---- 並べ方と描き方 ----

    /** 見出しの位置にページのタブを並べ、今のページに下線を引く。入らなければ今のページ名と番号だけにする。中身を描き始める y を返す。 */
    private float tabs(Panel panel, Page current) {
        HologramPainter.rect(panel.pose(), HologramPainter.quads(panel.buffer()), PAD, 16, panel.width() - PAD, 17, -0.4f, panel.color(0x70, VIOLET));
        int gap = 8, total = -gap;
        for (Page page : PAGES) total += font.width(page.title()) + gap;
        if (total > panel.width() - PAD * 2) {
            HologramPainter.text(panel.pose(), panel.buffer(), font, current.title(), PAD, 5, panel.color(VIOLET));
            HologramPainter.textRight(panel.pose(), panel.buffer(), font, Component.literal((current.ordinal() + 1) + "/" + PAGES.length),
                    panel.width() - PAD, 5, panel.color(GRAY));
            return 22;
        }
        float x = PAD;
        for (Page page : PAGES) {
            Component title = page.title();
            int width = font.width(title);
            if (page == current) {
                HologramPainter.text(panel.pose(), panel.buffer(), font, title, x, 5, panel.color(VIOLET));
                HologramPainter.rect(panel.pose(), HologramPainter.quads(panel.buffer()), x - 1, 14, x + width + 1, 16, -0.3f, panel.color(VIOLET));
            } else {
                HologramPainter.text(panel.pose(), panel.buffer(), font, title, x, 5, panel.color(0xB0, GRAY));
            }
            x += width + gap;
        }
        return 22;
    }

    /** 大きい倍率から順に試し、全部入る倍率（なければ最小の倍率）で並べる。 */
    private Built build(List<Line> lines, int page, Panel panel, float top, long now) {
        float width = panel.width() - PAD * 2, height = panel.height() - top - PAD;
        float scale = SCALES[SCALES.length - 1];
        List<Slot> slots = List.of();
        for (float candidate : SCALES) {
            slots = layout(lines, width / candidate, height / candidate);
            if (slots.size() == lines.size()) {
                scale = candidate;
                break;
            }
        }
        List<Placed> placed = new ArrayList<>(slots.size());
        for (Slot slot : slots) placed.add(clip(slot));
        return new Built(now, page, panel.columns(), panel.rows(), scale, List.copyOf(placed));
    }

    /** 上から下へ、段の高さが尽きたら右の段へ流す。見出しは次の 1 行と同じ段に置く。入らなかった行は返さない。 */
    private static List<Slot> layout(List<Line> lines, float width, float height) {
        int columns = Math.max(1, (int) (width / COLUMN_WIDTH));
        float columnWidth = width / columns;
        List<Slot> slots = new ArrayList<>();
        int column = 0;
        float y = 0;
        for (int i = 0; i < lines.size(); i++) {
            boolean heading = lines.get(i).kind() == Kind.HEADING;
            float before = heading && y > 0 ? GAP : 0;
            float need = before + LINE + (heading && i + 1 < lines.size() ? LINE + 2 : 0);
            if (y + need > height) {
                if (++column >= columns) break;
                y = 0;
                before = 0;
            }
            y += before;
            slots.add(new Slot(lines.get(i), column * columnWidth, y, columns > 1 ? columnWidth - 6 : columnWidth));
            y += heading ? LINE + 2 : LINE;
        }
        return slots;
    }

    /** 値を優先して右に寄せ、名前は残りの幅で切る。値が長いときも幅の半分は名前に残す。 */
    private Placed clip(Slot slot) {
        Line line = slot.line();
        float left = line.kind() == Kind.ITEM || line.kind() == Kind.NOTE ? MARK : 0;
        int inner = (int) (slot.width() - left);
        int textWidth = font.width(line.text());
        String value = line.value().isEmpty() ? "" : font.plainSubstrByWidth(line.value(), (int) Math.max(inner * 0.5f, inner - textWidth - 4));
        int valueWidth = font.width(value);
        String text = font.plainSubstrByWidth(line.text(), Math.max(0, inner - (value.isEmpty() ? 0 : valueWidth + 4)));
        return new Placed(line, slot.x(), slot.y(), slot.width(), Component.literal(text), Component.literal(value), slot.x() + slot.width() - valueWidth);
    }

    private void draw(Panel panel, Placed item) {
        Line line = item.line();
        float x = item.x(), y = item.y();
        switch (line.kind()) {
            case HEADING -> {
                HologramPainter.text(panel.pose(), panel.buffer(), font, item.text(), x, y, panel.color(line.color()));
                HologramPainter.text(panel.pose(), panel.buffer(), font, item.value(), item.valueX(), y, panel.color(GRAY));
                HologramPainter.rect(panel.pose(), HologramPainter.quads(panel.buffer()), x, y + LINE - 1, x + item.width(), y + LINE,
                        -0.4f, panel.color(0x60, line.color()));
            }
            case ROW -> {
                HologramPainter.text(panel.pose(), panel.buffer(), font, item.text(), x, y, panel.color(GRAY));
                HologramPainter.text(panel.pose(), panel.buffer(), font, item.value(), item.valueX(), y, panel.color(line.color()));
            }
            case ITEM -> {
                mark(panel, line, x, y);
                HologramPainter.text(panel.pose(), panel.buffer(), font, item.text(), x + MARK, y, panel.color(PALE));
                HologramPainter.text(panel.pose(), panel.buffer(), font, item.value(), item.valueX(), y, panel.color(line.color()));
            }
            case NOTE -> HologramPainter.text(panel.pose(), panel.buffer(), font, item.text(), x + MARK, y, panel.color(GRAY));
        }
    }

    /** 項目の印。アイコンがなければ色の点。実行中のアイコンは回す。 */
    private static void mark(Panel panel, Line line, float x, float y) {
        if (line.icon() == null) {
            HologramPainter.rect(panel.pose(), HologramPainter.quads(panel.buffer()), x + 2, y + 2, x + 6, y + 6, -0.3f, panel.color(line.color()));
        } else if (line.icon() == Icon.RUNNING) {
            HologramPainter.spinningIcon(panel.pose(), panel.buffer(), line.icon(), x, y, 8, -0.1f, panel.time() * 0.08f, panel.color(0xFFFFFF));
        } else {
            HologramPainter.icon(panel.pose(), panel.buffer(), line.icon(), x, y, 8, -0.1f, panel.color(0xFFFFFF));
        }
    }

    // ---- 映す内容 ----

    private static List<Line> lines(Page page, State state) {
        Mcp mcp = mcp();
        if (page == Page.CONNECTION) return connection(state, mcp);
        if (!state.connected()) return disconnected(state, mcp);
        Details details = BridgeStatusCache.get().details();
        return switch (page) {
            case OVERVIEW -> overview(state, details, mcp);
            case TASKS -> tasks(details);
            case CONSULTS -> consults(details);
            case CONNECTION -> List.of();
        };
    }

    /** 幅 1 の要約。縦に長ければ、要対応と実行中の名前も並べる。 */
    private static List<Line> compact(State state, int rows) {
        Mcp mcp = mcp();
        Details details = BridgeStatusCache.get().details();
        boolean fetched = state.connected() && details.refreshedAt() > 0;
        List<Line> attention = fetched ? attention(state, details) : List.of();
        List<Line> running = state.connected() ? running(state, details) : List.of();
        int attentionCount = fetched ? attention.size() : state.connected() ? state.approvals() + state.unread() : 0;

        List<Line> lines = new ArrayList<>();
        lines.add(item(state.connected() ? Icon.CONNECTED : Icon.DISCONNECTED, text(KEY + "compact.bridge"), "", bridgeColor(state)));
        lines.add(item(null, text(KEY + "compact.mcp"), "", mcp.color()));
        lines.add(item(running.isEmpty() ? null : Icon.RUNNING, text(KEY + "compact.running"),
                state.connected() ? String.valueOf(running.size()) : "-", running.isEmpty() ? GRAY : CYAN));
        lines.add(item(attentionCount > 0 ? Icon.APPROVAL : null, text(KEY + "compact.attention"),
                state.connected() ? String.valueOf(attentionCount) : "-", attentionCount > 0 ? AMBER : GRAY));
        if (rows > 1) {
            lines.addAll(attention);
            lines.addAll(running);
        }
        return lines;
    }

    private static List<Line> disconnected(State state, Mcp mcp) {
        List<Line> lines = new ArrayList<>();
        lines.add(row("bridge", bridgeStatus(state), bridgeColor(state)));
        if (state.enabled()) lines.add(note(text("hologram.potamaid.disconnectedHint")));
        lines.add(row("mcp", mcp.status(), mcp.color()));
        return lines;
    }

    /** 概要: 接続の状態、対応が必要なもの、AI が動いているもの。 */
    private static List<Line> overview(State state, Details details, Mcp mcp) {
        List<Line> lines = new ArrayList<>();
        lines.add(row("bridge", bridgeStatus(state), bridgeColor(state)));
        lines.add(row("project", state.project().isBlank() ? "-" : state.project(), CYAN));
        lines.add(row("mcp", mcp.status(), mcp.color()));
        if (details.refreshedAt() == 0) {
            lines.add(note(text(KEY + "loading")));
            return lines;
        }
        List<Line> attention = attention(state, details);
        lines.add(heading(text(KEY + "attention"), String.valueOf(attention.size()), attention.isEmpty() ? VIOLET : AMBER));
        if (attention.isEmpty()) lines.add(note(text(KEY + "none")));
        lines.addAll(attention);
        List<Line> running = running(state, details);
        lines.add(heading(text(KEY + "running"), String.valueOf(running.size()), VIOLET));
        if (running.isEmpty()) lines.add(note(text(KEY + "none")));
        lines.addAll(running);
        return lines;
    }

    /** 対応が必要なもの。承認待ち・失敗・目標の確認・未読の返答の順。 */
    private static List<Line> attention(State state, Details details) {
        List<Line> lines = new ArrayList<>();
        int approvals = 0;
        for (GoalInfo goal : details.goals()) {
            for (TaskInfo task : goal.tasks()) {
                if (!task.status().equals("approval")) continue;
                lines.add(item(Icon.APPROVAL, task.title(), state("approval"), AMBER));
                approvals++;
            }
        }
        // 相談・計画づくりの承認待ちや、取得しなかった目標のタスクの承認待ち。
        if (state.approvals() > approvals) {
            lines.add(item(Icon.APPROVAL, text(KEY + "otherApprovals"), String.valueOf(state.approvals() - approvals), AMBER));
        }
        for (GoalInfo goal : details.goals()) {
            for (TaskInfo task : goal.tasks()) {
                if (task.status().equals("failed")) lines.add(item(null, task.title(), state("failed"), RED));
            }
        }
        for (GoalInfo goal : details.goals()) {
            switch (goal.status()) {
                case "planFailed", "review", "waiting", "planReview" -> lines.add(item(null, goal.title(), state(goal.status()), goalColor(goal.status())));
                default -> { }
            }
        }
        for (ConsultInfo consult : details.consults()) {
            if (consult.unread()) lines.add(item(Icon.UNREAD, consult.title(), text(KEY + "unread"), CYAN));
        }
        return lines;
    }

    /** AI が動いているもの（応答中のタスク・計画中の目標・応答中の相談）。一覧をまだ取得していなければ進捗ボードと同じ内容から作る。 */
    private static List<Line> running(State state, Details details) {
        List<Line> lines = new ArrayList<>();
        if (details.refreshedAt() == 0) {
            for (Entry entry : state.entries()) if (!entry.approval()) lines.add(item(Icon.RUNNING, entry.title(), "", CYAN));
            return lines;
        }
        for (GoalInfo goal : details.goals()) {
            if (goal.status().equals("planning")) lines.add(item(Icon.RUNNING, goal.title(), state("planning"), CYAN));
            for (TaskInfo task : goal.tasks()) {
                if (task.status().equals("running")) lines.add(item(Icon.RUNNING, task.title(), elapsed(task.startedAt()), CYAN));
            }
        }
        for (ConsultInfo consult : details.consults()) {
            if (consult.status().equals("running")) lines.add(item(Icon.RUNNING, consult.title(), state("running"), CYAN));
        }
        return lines;
    }

    /** タスク: 未完了の目標ごとに、動いている・止まっているタスクを並べ、残りは数だけにする。 */
    private static List<Line> tasks(Details details) {
        if (details.refreshedAt() == 0) return List.of(note(text(KEY + "loading")));
        if (details.goals().isEmpty()) return List.of(note(text(KEY + "noGoals")));
        List<Line> lines = new ArrayList<>();
        for (GoalInfo goal : details.goals()) {
            String value = state(goal.status()) + (goal.total() > 0 ? " " + goal.done() + "/" + goal.total() : "");
            lines.add(heading(goal.title(), value, goalColor(goal.status())));
            int todo = 0, done = 0;
            for (TaskInfo task : goal.tasks()) {
                String title = "#" + task.number() + " " + task.title();
                switch (task.status()) {
                    case "running" -> lines.add(item(Icon.RUNNING, title, elapsed(task.startedAt()), CYAN));
                    case "approval" -> lines.add(item(Icon.APPROVAL, title, elapsed(task.startedAt()), AMBER));
                    case "failed" -> lines.add(item(null, title, state("failed"), RED));
                    case "done" -> done++;
                    default -> {
                        if (task.paused()) lines.add(item(null, title, text(KEY + "paused"), GRAY));
                        else todo++;
                    }
                }
            }
            if (todo + done > 0) lines.add(note(text(KEY + "rest", todo, done)));
        }
        return lines;
    }

    /** 相談: 未読・応答中・順番待ち・失敗を先に並べる。 */
    private static List<Line> consults(Details details) {
        if (details.refreshedAt() == 0) return List.of(note(text(KEY + "loading")));
        if (details.consults().isEmpty()) return List.of(note(text(KEY + "noConsults")));
        List<Line> lines = new ArrayList<>();
        for (ConsultInfo consult : details.consults()) {
            if (consult.unread()) {
                lines.add(item(Icon.UNREAD, consult.title(), text(KEY + "unread"), CYAN));
                continue;
            }
            lines.add(switch (consult.status()) {
                case "running" -> item(Icon.RUNNING, consult.title(), state("running"), CYAN);
                case "queued" -> item(null, consult.title(), state("queued"), AMBER);
                case "failed" -> item(null, consult.title(), state("failed"), RED);
                default -> item(null, consult.title(), "", GRAY);
            });
        }
        return lines;
    }

    /** 接続: Bridge とゲーム MCP の詳しい状態と、この Mod の版。 */
    private static List<Line> connection(State state, Mcp mcp) {
        Summary summary = BridgeStatusCache.get().summary();
        boolean fetched = state.connected() && summary.refreshedAt() > 0;
        List<Line> lines = new ArrayList<>();
        lines.add(heading(text(KEY + "bridge"), "", VIOLET));
        lines.add(row("status", bridgeStatus(state), bridgeColor(state)));
        lines.add(row("project", state.project().isBlank() ? "-" : state.project(), CYAN));
        lines.add(row("counts", fetched ? summary.goals() + " / " + summary.tasks() + " / " + summary.consults() : "-", PALE));
        lines.add(row("refreshed", fetched ? text(KEY + "secondsAgo", (Util.getMillis() - summary.refreshedAt()) / 1000) : "-", GRAY));
        lines.add(heading(text(KEY + "mcp"), "", VIOLET));
        lines.add(row("status", mcp.status(), mcp.color()));
        lines.add(row("port", mcp.port(), PALE));
        if (!mcp.error().isBlank()) lines.add(row("error", mcp.error(), RED));
        lines.add(heading("PotamAId", "", VIOLET));
        lines.add(row("version", version(), VIOLET));
        return lines;
    }

    // ---- 値 ----

    private static String bridgeStatus(State state) {
        if (!state.enabled()) return text(KEY + "off");
        return text(state.connected() ? "hologram.potamaid.connected" : "hologram.potamaid.disconnected");
    }

    private static int bridgeColor(State state) { return !state.enabled() ? GRAY : state.connected() ? GREEN : RED; }

    private static int goalColor(String status) {
        return switch (status) {
            case "review" -> GREEN;
            case "waiting", "planReview" -> AMBER;
            case "planFailed" -> RED;
            default -> CYAN;
        };
    }

    private static Mcp mcp() {
        GameConnection game = PotamAIdClient.game();
        if (game == null) return new Mcp(text(KEY + "mcp.starting"), GRAY, "-", "");
        String port = String.valueOf(game.port());
        if (!game.enabled()) return new Mcp(text(KEY + "off"), GRAY, port, "");
        JsonObject state = game.state();
        String error = value(state, "error");
        if (value(state, "mcpAvailable").equals("true")) return new Mcp(text(KEY + "mcp.open"), GREEN, port, "");
        if (!error.isBlank()) return new Mcp(text(KEY + "mcp.error"), RED, port, error);
        return new Mcp(text(KEY + "mcp.closed"), GRAY, port, "");
    }

    /** 最初に実行してからの時間（m:ss か h:mm:ss）。未実行なら空。 */
    private static String elapsed(long startedAt) {
        if (startedAt <= 0) return "";
        long seconds = Math.max(0, (System.currentTimeMillis() - startedAt) / 1000);
        long hours = seconds / 3600, minutes = seconds / 60 % 60;
        return hours > 0 ? String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, seconds % 60)
                : String.format(Locale.ROOT, "%d:%02d", minutes, seconds % 60);
    }

    /** この Mod の版。起動中は変わらないので一度だけ調べる。 */
    private static String version() {
        if (modVersion == null) {
            modVersion = ModList.get().getModContainerById(PotamAId.MODID).map(container -> container.getModInfo().getVersion().toString()).orElse("?");
        }
        return modVersion;
    }

    // ---- 部品 ----

    private static Line heading(String text, String value, int color) { return new Line(Kind.HEADING, null, text, value, color); }

    private static Line row(String key, String value, int color) { return new Line(Kind.ROW, null, text(KEY + key), value, color); }

    private static Line item(Icon icon, String text, String value, int color) { return new Line(Kind.ITEM, icon, text, value, color); }

    private static Line note(String text) { return new Line(Kind.NOTE, null, text, "", GRAY); }

    /** Bridge の状態名（目標・タスク・相談で共通）。 */
    private static String state(String status) { return text("commands.potamaid.bridge.state." + status); }

    private static String text(String key, Object... args) { return Component.translatable(key, args).getString(); }

    private static String value(JsonObject object, String key) {
        return object.has(key) && object.get(key).isJsonPrimitive() ? object.get(key).getAsString() : "";
    }
}
