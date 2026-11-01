package io.github.bakutaku.potamaid.block;

import com.mojang.serialization.MapCodec;
import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;

/** 接続状態と実行中のタスクの進み具合を映す看板。 */
public class ProgressBoardBlock extends HologramBlock {
    public static final MapCodec<ProgressBoardBlock> CODEC = simpleCodec(ProgressBoardBlock::new);

    public ProgressBoardBlock(Properties properties) {
        super(properties, () -> PotamAId.PROGRESS_BOARD_ENTITY.get());
    }

    @Override
    protected MapCodec<? extends HorizontalDirectionalBlock> codec() { return CODEC; }
}
