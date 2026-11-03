package io.github.bakutaku.potamaid.game;

import java.util.Map;

/** 取得時点の値だけを保持する。見ている先にブロックがなければ hit は false で、他は null。 */
public record TargetBlock(
        boolean hit,
        String dimension,
        Position position,
        String blockId,
        Map<String, String> state,
        BlockEntity blockEntity) {

    public record Position(int x, int y, int z) {
    }

    /** nbt は SNBT 文字列。上限を超えたら切り詰め、truncated を true にする。 */
    public record BlockEntity(String typeId, String nbt, boolean truncated) {
    }

    public static TargetBlock none() {
        return new TargetBlock(false, null, null, null, null, null);
    }
}
