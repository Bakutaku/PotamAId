package io.github.bakutaku.potamaid.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.github.bakutaku.potamaid.PotamAIdClient;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.util.FormattedCharSequence;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import static io.github.bakutaku.potamaid.connection.GameMcpServer.object;

/** 相談の一覧と会話を表示する。通信は BridgeChat 経由で、コマンドと同じ操作を使う。 */
@OnlyIn(Dist.CLIENT)
public final class ConsultScreen extends Screen {
    private enum Kind { USER, AGENT, PROGRESS, NOTICE, ERROR }
    private record Line(long seq, Kind kind, String text) {}
    private record Entry(String id, String title, String status) {}

    private static final int ROW = 24;
    private static final int LINE = 10;
    private static final int POLL_TICKS = 60;

    private final BridgeChat chat = PotamAIdClient.bridgeChat();
    private final Consumer<JsonObject> listener = message -> ui(() -> message(message));
    private final List<Entry> consults = new ArrayList<>();
    private final List<Line> lines = new ArrayList<>();
    private final List<FormattedCharSequence> rows = new ArrayList<>();
    private String selected;
    private long oldest = -1;
    private boolean hasOlder;
    private Component notice = Component.empty();
    private String draft = "";
    private boolean started;
    private boolean closed;
    private boolean dirty = true;
    private int listScroll;
    private int logScroll;
    private int ticks;

    private EditBox input;
    private Button send;
    private Button cancel;
    private Button create;
    private Button older;
    private Button refresh;
    private int listX1, listX2, listY1, listY2, logX1, logX2, logY1, logY2;

    private ConsultScreen() {
        super(Component.translatable("screen.potamaid.consult.title"));
    }

    public static void open() {
        Minecraft.getInstance().setScreen(new ConsultScreen());
    }

    @Override
    protected void init() {
        if (input != null) draft = input.getValue();
        int listW = Math.max(110, Math.min(170, width / 4));
        listX1 = 8; listX2 = 8 + listW; listY1 = 24; listY2 = height - 34;
        logX1 = listX2 + 8; logX2 = width - 8; logY1 = 24; logY2 = height - 46;

        create = addRenderableWidget(Button.builder(Component.translatable("screen.potamaid.consult.new"), b -> create())
                .bounds(listX1, height - 28, listW, 20).build());
        older = addRenderableWidget(Button.builder(Component.translatable("screen.potamaid.consult.older"), b -> loadOlder())
                .bounds(logX1, 3, 60, 16).build());
        refresh = addRenderableWidget(Button.builder(Component.translatable("screen.potamaid.consult.refresh"), b -> { refreshList(); refreshHistory(); })
                .bounds(logX1 + 64, 3, 60, 16).build());
        int buttons = 56;
        input = addRenderableWidget(new EditBox(font, logX1, height - 28, logX2 - logX1 - buttons * 2 - 8, 20, Component.translatable("screen.potamaid.consult.input")));
        input.setMaxLength(2000);
        input.setHint(Component.translatable("screen.potamaid.consult.input"));
        input.setValue(draft);
        send = addRenderableWidget(Button.builder(Component.translatable("screen.potamaid.consult.send"), b -> submit())
                .bounds(logX2 - buttons * 2 - 4, height - 28, buttons, 20).build());
        cancel = addRenderableWidget(Button.builder(Component.translatable("screen.potamaid.consult.cancel"), b -> cancelConsult())
                .bounds(logX2 - buttons, height - 28, buttons, 20).build());
        setInitialFocus(input);
        dirty = true;

        if (chat == null) return;
        if (!started) {
            started = true;
            chat.addListener(listener);
            if (chat.connected()) refreshList();
        }
    }

    @Override
    public void onClose() {
        closed = true;
        if (chat != null) chat.removeListener(listener);
        super.onClose();
    }

    @Override
    public void removed() {
        closed = true;
        if (chat != null) chat.removeListener(listener);
    }

    @Override
    public boolean isPauseScreen() { return false; }

    @Override
    public void tick() {
        boolean online = chat != null && chat.connected();
        send.active = online;
        create.active = online;
        refresh.active = online;
        older.active = online && selected != null && hasOlder;
        cancel.active = online && selected != null && isBusy(statusOf(selected));
        if (online && selected != null && isBusy(statusOf(selected)) && ++ticks % POLL_TICKS == 0) refreshHistory();
    }

    private static boolean isBusy(String status) { return status.equals("running") || status.equals("queued"); }

    private String statusOf(String id) {
        for (Entry entry : consults) if (entry.id().equals(id)) return entry.status();
        return "";
    }

    // ---- 通信 ----

    private void ui(Runnable action) {
        Minecraft.getInstance().execute(() -> { if (!closed) action.run(); });
    }

    private void call(JsonObject operation, Consumer<JsonObject> onData) {
        if (chat == null) return;
        chat.call(operation).whenComplete((response, error) -> ui(() -> {
            if (error != null) notice = Component.translatable("commands.potamaid.bridge.unknown");
            else if (!response.get("ok").getAsBoolean()) notice = Component.literal(BridgeChat.value(response, "error"));
            else { notice = Component.empty(); onData.accept(response.getAsJsonObject("data")); }
        }));
    }

    private void message(JsonObject message) {
        switch (BridgeChat.value(message, "type")) {
            case "connected" -> {
                // 接続し直すと Bridge 側の相談の選択は解除される。
                selected = null; lines.clear(); hasOlder = false; dirty = true;
                refreshList();
            }
            case "notice" -> addLine(new Line(-1, Kind.NOTICE, BridgeChat.value(message, "title") + ": " + BridgeChat.value(message, "body")));
            case "consult_state" -> {
                JsonObject consult = message.getAsJsonObject("consult");
                String id = BridgeChat.value(consult, "id");
                if (!replaceEntry(consult)) refreshList();
                if (id.equals(selected)) refreshHistory();
            }
            default -> { }
        }
    }

    private void refreshList() {
        fetchPage(1, new ArrayList<>());
    }

    private void fetchPage(int page, List<Entry> acc) {
        call(object("action", "consult_list", "page", page), data -> {
            for (JsonElement element : data.getAsJsonArray("items")) acc.add(entry(element.getAsJsonObject()));
            if (data.get("hasMore").getAsBoolean() && page < 40) { fetchPage(page + 1, acc); return; }
            consults.clear(); consults.addAll(acc);
            listScroll = Math.min(listScroll, Math.max(0, consults.size() - listRows()));
        });
    }

    private boolean replaceEntry(JsonObject consult) {
        Entry updated = entry(consult);
        for (int i = 0; i < consults.size(); i++) {
            if (consults.get(i).id().equals(updated.id())) { consults.set(i, updated); return true; }
        }
        return false;
    }

    private static Entry entry(JsonObject item) {
        return new Entry(BridgeChat.value(item, "id"), BridgeChat.value(item, "title"), BridgeChat.value(item, "status"));
    }

    private void select(Entry entry) {
        call(object("action", "consult_select", "id", entry.id()), this::open);
    }

    /** consult_select / consult_new の応答で、表示する相談を切り替える。 */
    private void open(JsonObject data) {
        JsonObject consult = data.getAsJsonObject("consult");
        selected = BridgeChat.value(consult, "id");
        if (!replaceEntry(consult)) refreshList();
        lines.clear(); oldest = -1; logScroll = 0;
        merge(data);
        older(data);
        dirty = true;
    }

    private void refreshHistory() {
        if (selected == null) return;
        call(object("action", "history", "owner", "consult"), this::merge);
    }

    private void loadOlder() {
        if (selected == null || !hasOlder) return;
        call(object("action", "history", "owner", "consult", "before", oldest), data -> { merge(data); older(data); });
    }

    private void submit() {
        String text = input.getValue().strip();
        if (text.isEmpty()) return;
        if (selected == null) { create(); return; }
        call(object("action", "consult_send", "text", text), data -> {
            input.setValue("");
            refreshList(); refreshHistory();
        });
    }

    /** 入力があればそれを最初の質問として新しい相談を作り、なければ選択を外して新規入力を待つ。 */
    private void create() {
        String text = input.getValue().strip();
        if (text.isEmpty()) {
            selected = null; lines.clear(); hasOlder = false; dirty = true;
            setFocused(input);
            return;
        }
        call(object("action", "consult_new", "text", text), data -> {
            input.setValue("");
            open(data);
            refreshHistory();
        });
    }

    private void cancelConsult() {
        if (selected == null) return;
        call(object("action", "consult_cancel"), data -> { refreshList(); refreshHistory(); });
    }

    private void older(JsonObject data) {
        hasOlder = data.has("hasMore") && data.get("hasMore").getAsBoolean();
        JsonElement before = data.get("before");
        if (before != null && !before.isJsonNull()) oldest = before.getAsLong();
    }

    private void merge(JsonObject data) {
        if (!data.has("events")) return;
        for (JsonElement element : data.getAsJsonArray("events")) {
            JsonObject event = element.getAsJsonObject();
            addLine(new Line(event.get("seq").getAsLong(), kind(BridgeChat.value(event, "kind")), BridgeChat.value(event, "text")));
        }
    }

    private static Kind kind(String kind) {
        return switch (kind) {
            case "user" -> Kind.USER;
            case "agent" -> Kind.AGENT;
            case "system" -> Kind.NOTICE;
            case "error" -> Kind.ERROR;
            default -> Kind.PROGRESS;
        };
    }

    /** 連番のある発言は連番順に差し込み、重複は捨てる。連番のない通知は到着順で末尾に置く。 */
    private void addLine(Line line) {
        if (line.seq() >= 0) {
            for (int i = 0; i < lines.size(); i++) {
                Line existing = lines.get(i);
                if (existing.seq() == line.seq()) return;
                if (existing.seq() > line.seq()) { lines.add(i, line); dirty = true; return; }
            }
        }
        lines.add(line);
        dirty = true;
    }

    // ---- 入力 ----

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (input.isFocused() && (keyCode == 257 || keyCode == 335)) { submit(); return true; }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button == 0 && mouseX >= listX1 && mouseX < listX2 && mouseY >= listY1 && mouseY < listY2) {
            int index = ((int) mouseY - listY1 - 2) / ROW + listScroll;
            if (index >= 0 && index < consults.size() && chat != null && chat.connected()) select(consults.get(index));
            return true;
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        int direction = scrollY > 0 ? 1 : -1;
        if (mouseX < listX2) listScroll = Math.max(0, Math.min(Math.max(0, consults.size() - listRows()), listScroll - direction));
        else logScroll = Math.max(0, Math.min(Math.max(0, rows.size() - logRows()), logScroll + direction * 3));
        return true;
    }

    private int listRows() { return Math.max(1, (listY2 - listY1 - 4) / ROW); }

    private int logRows() { return Math.max(1, (logY2 - logY1 - 4) / LINE); }

    // ---- 描画 ----

    private static int color(Kind kind) {
        return switch (kind) {
            case USER -> 0x8FD0FF;
            case AGENT -> 0xFFFFFF;
            case PROGRESS -> 0x9A9A9A;
            case NOTICE -> 0xFFD27F;
            case ERROR -> 0xFF7777;
        };
    }

    private static int statusColor(String status) {
        return switch (status) {
            case "idle" -> 0x55FF55;
            case "queued" -> 0xFFD255;
            case "running" -> 0x55D5FF;
            case "failed" -> 0xFF5555;
            default -> 0xAAAAAA;
        };
    }

    private void rebuildRows() {
        rows.clear();
        int wrap = logX2 - logX1 - 12;
        for (Line line : lines) {
            if (!rows.isEmpty()) rows.add(FormattedCharSequence.EMPTY);
            int color = color(line.kind());
            // 自由文は Component.literal で扱い、JSON のクリック操作等として解釈しない。
            MutableComponent text = Component.translatable("screen.potamaid.consult.role." + line.kind().name().toLowerCase())
                    .withStyle(style -> style.withColor(color).withBold(true))
                    .append(Component.literal("  ").append(Component.literal(line.text())).withStyle(style -> style.withColor(color)));
            rows.addAll(font.split(text, wrap));
        }
        logScroll = Math.min(logScroll, Math.max(0, rows.size() - logRows()));
        dirty = false;
    }

    @Override
    public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        super.renderBackground(graphics, mouseX, mouseY, partialTick);
        graphics.fill(listX1, listY1, listX2, listY2, 0xA0000000);
        graphics.fill(logX1, logY1, logX2, logY2, 0xA0000000);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        super.render(graphics, mouseX, mouseY, partialTick);
        if (dirty) rebuildRows();
        boolean online = chat != null && chat.connected();

        graphics.drawString(font, title, listX1, 8, 0xFFFFFFFF);
        Component state = Component.literal("● ").append(chat == null ? Component.translatable("screen.potamaid.consult.disabled")
                : Component.translatable(online ? "screen.potamaid.consult.connected" : "screen.potamaid.consult.disconnected"));
        int stateX = logX2 - font.width(state);
        graphics.drawString(font, state, stateX, 8, online ? 0xFF55FF55 : 0xFFFF5555);
        if (selected != null) {
            String title = "";
            for (Entry entry : consults) if (entry.id().equals(selected)) title = entry.title();
            int titleX = logX1 + 130;
            graphics.drawString(font, font.plainSubstrByWidth(title, Math.max(0, stateX - titleX - 8)), titleX, 8, 0xFFFFFFFF);
        }

        renderList(graphics);
        renderLog(graphics, online);
        if (!notice.getString().isEmpty()) graphics.drawString(font, font.plainSubstrByWidth(notice.getString(), logX2 - logX1), logX1, height - 40, 0xFFFF7777);
    }

    private void renderList(GuiGraphics graphics) {
        graphics.enableScissor(listX1, listY1, listX2, listY2);
        if (consults.isEmpty()) graphics.drawString(font, Component.translatable("screen.potamaid.consult.emptyList"), listX1 + 6, listY1 + 6, 0xFF9A9A9A);
        int y = listY1 + 2;
        for (int i = listScroll; i < consults.size() && y < listY2; i++, y += ROW) {
            Entry entry = consults.get(i);
            if (entry.id().equals(selected)) graphics.fill(listX1 + 1, y, listX2 - 1, y + ROW - 2, 0x55FFFFFF);
            graphics.fill(listX1 + 5, y + 4, listX1 + 11, y + 10, 0xFF000000 | statusColor(entry.status()));
            graphics.drawString(font, font.plainSubstrByWidth(entry.title(), listX2 - listX1 - 22), listX1 + 16, y + 3, 0xFFFFFFFF);
            Component detail = Component.literal(entry.id().substring(0, Math.min(8, entry.id().length())) + " ")
                    .append(Component.translatable("commands.potamaid.bridge.state." + entry.status()));
            graphics.drawString(font, detail, listX1 + 16, y + 13, 0xFF9A9A9A);
        }
        graphics.disableScissor();
    }

    private void renderLog(GuiGraphics graphics, boolean online) {
        graphics.enableScissor(logX1, logY1, logX2, logY2);
        if (!online) {
            int y = logY1 + 8;
            for (FormattedCharSequence row : font.split(Component.translatable(chat == null ? "screen.potamaid.consult.disabledHint" : "screen.potamaid.consult.disconnectedHint"), logX2 - logX1 - 16)) {
                graphics.drawString(font, row, logX1 + 8, y, 0xFFFFD27F); y += LINE;
            }
        } else if (rows.isEmpty()) {
            graphics.drawString(font, Component.translatable("screen.potamaid.consult.emptyLog"), logX1 + 8, logY1 + 8, 0xFF9A9A9A);
        } else {
            int y = logY2 - 4 - LINE;
            for (int i = rows.size() - 1 - logScroll; i >= 0 && y > logY1 - LINE; i--, y -= LINE) {
                graphics.drawString(font, rows.get(i), logX1 + 6, y, 0xFFFFFFFF);
            }
        }
        graphics.disableScissor();
    }
}
