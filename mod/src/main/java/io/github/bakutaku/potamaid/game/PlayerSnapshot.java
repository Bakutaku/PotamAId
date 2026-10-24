package io.github.bakutaku.potamaid.game;

import java.util.UUID;

/** 取得時点の値だけを保持する。MCP や Bridge の通信形式ではない。 */
public record PlayerSnapshot(
        UUID playerId,
        String playerName,
        String dimension,
        Position position,
        HeldItem mainHand,
        HeldItem offHand) {

    public record Position(double x, double y, double z, float yaw, float pitch) {
    }

    /** 空の手は minecraft:air、個数 0。コンポーネントや NBT はこの段階では取得しない。 */
    public record HeldItem(String itemId, int count) {
    }
}
