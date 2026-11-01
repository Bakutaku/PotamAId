package io.github.bakutaku.potamaid.block;

import com.mojang.serialization.MapCodec;
import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;

/** 承認待ちと未読の返答の件数を映す看板。どちらも 0 のときは何も映さない。 */
public class NoticeLampBlock extends HologramBlock {
    public static final MapCodec<NoticeLampBlock> CODEC = simpleCodec(NoticeLampBlock::new);

    public NoticeLampBlock(Properties properties) {
        super(properties, () -> PotamAId.NOTICE_LAMP_ENTITY.get());
    }

    @Override
    protected MapCodec<? extends HorizontalDirectionalBlock> codec() { return CODEC; }
}
