package io.github.bakutaku.potamaid.block;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 描画のためだけの BlockEntity。保存するデータも通信も持たない。
 * 連結した看板の形や、アニメーションの途中経過・状態ディスプレイのページ（クライアントの描画でだけ使う値）を持つ。
 */
public class HologramBlockEntity extends BlockEntity {
    /** 連結した看板の中でのこのブロックの位置（左上が 0, 0）と、看板の大きさ（ブロック単位）。クライアントの描画だけが読み書きする。 */
    public int panelColumn, panelRow, panelColumns = 1, panelRows = 1;
    /** 連結を最後に調べたゲーム時刻。 */
    public long panelCheckedAt = Long.MIN_VALUE;
    /** 進捗バーの表示中の長さ（0〜1）と、その対象。クライアントの描画だけが読み書きする。 */
    public float shownProgress;
    public String shownKey = "";
    public long lastFrameMillis;
    /** 状態ディスプレイで映しているページ（連結した看板の左上のブロックが持つ）。クライアントだけが持ち、保存も同期もしない。 */
    public int displayPage;

    public HologramBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state) {
        super(type, pos, state);
    }

    /** 連結した看板の左上（全体を描くブロック）か。 */
    public boolean isPanelOrigin() { return panelColumn == 0 && panelRow == 0; }
}
