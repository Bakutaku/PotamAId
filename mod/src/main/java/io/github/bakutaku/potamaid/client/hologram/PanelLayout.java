package io.github.bakutaku.potamaid.client.hologram;

import io.github.bakutaku.potamaid.block.HologramBlockEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;

/**
 * 隣り合う看板の連結をクライアントで判定する。ブロックにも BlockEntity にも連結の情報は保存しない。
 * 同じ種類・同じ向きのブロックが横に続く範囲を「行」とし、真上・真下の行が左右の端まで同じなら縦にもつなげる。
 * 大きすぎる範囲は左上から {@link #MAX_COLUMNS} × {@link #MAX_ROWS} ずつに区切る。どのブロックで判定しても同じ区切りになるので、
 * 区切りの左上のブロックだけが全体を描けば二重に描かれない。
 */
@OnlyIn(Dist.CLIENT)
final class PanelLayout {
    static final int MAX_COLUMNS = 8;
    static final int MAX_ROWS = 6;
    /** 横・縦に調べる最大の距離。これより長く続く並びでは、区切りがブロックによってずれることがある。 */
    private static final int SCAN_COLUMNS = 32;
    private static final int SCAN_ROWS = 16;
    /** 連結を調べ直す間隔（ティック）。 */
    private static final int CHECK_TICKS = 10;

    private PanelLayout() {}

    /** 表から見て右の向き。 */
    static Direction right(Direction facing) { return facing.getCounterClockWise(); }

    /** 一定間隔で連結を調べ直し、結果を BlockEntity の描画用の値に入れる。 */
    static void update(HologramBlockEntity be) {
        Level level = be.getLevel();
        long now = level.getGameTime();
        if (be.panelCheckedAt != Long.MIN_VALUE && now >= be.panelCheckedAt && now - be.panelCheckedAt < CHECK_TICKS) return;
        be.panelCheckedAt = now;

        BlockState state = be.getBlockState();
        Block block = state.getBlock();
        Direction facing = state.getValue(HorizontalDirectionalBlock.FACING);
        Direction right = right(facing);
        BlockPos pos = be.getBlockPos();
        int left = run(level, pos, right.getOpposite(), block, facing, SCAN_COLUMNS);
        int rightCount = run(level, pos, right, block, facing, SCAN_COLUMNS);
        int up = stack(level, pos, Direction.UP, right, block, facing, left, rightCount);
        int down = stack(level, pos, Direction.DOWN, right, block, facing, left, rightCount);

        int columns = left + rightCount + 1;
        be.panelColumn = left % MAX_COLUMNS;
        be.panelColumns = Math.min(MAX_COLUMNS, columns - (left - be.panelColumn));
        int rows = up + down + 1;
        be.panelRow = up % MAX_ROWS;
        be.panelRows = Math.min(MAX_ROWS, rows - (up - be.panelRow));
    }

    /** 隣の行が、左右の端まで同じ並びで続く数。 */
    private static int stack(Level level, BlockPos pos, Direction vertical, Direction right, Block block, Direction facing, int left, int rightCount) {
        int count = 0;
        BlockPos row = pos;
        while (count < SCAN_ROWS) {
            row = row.relative(vertical);
            if (!same(level, row, block, facing)) break;
            if (run(level, row, right.getOpposite(), block, facing, left + 1) != left) break;
            if (run(level, row, right, block, facing, rightCount + 1) != rightCount) break;
            count++;
        }
        return count;
    }

    /** pos から direction へ、同じ看板のブロックが続く数（pos 自身は数えない）。 */
    private static int run(Level level, BlockPos pos, Direction direction, Block block, Direction facing, int limit) {
        int count = 0;
        BlockPos.MutableBlockPos cursor = pos.mutable();
        while (count < limit) {
            cursor.move(direction);
            if (!same(level, cursor, block, facing)) break;
            count++;
        }
        return count;
    }

    private static boolean same(Level level, BlockPos pos, Block block, Direction facing) {
        BlockState state = level.getBlockState(pos);
        return state.is(block) && state.getValue(HorizontalDirectionalBlock.FACING) == facing;
    }
}
