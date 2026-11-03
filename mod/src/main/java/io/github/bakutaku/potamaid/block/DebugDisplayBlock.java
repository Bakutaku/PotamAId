package io.github.bakutaku.potamaid.block;

import com.mojang.serialization.MapCodec;
import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;

/** 開発用の情報ディスプレイ。Bridge・ゲーム MCP・クライアント・ワールドの状態をまとめて映す。レシピもクリエイティブタブもなく、/give でだけ手に入る。 */
public class DebugDisplayBlock extends HologramBlock {
    public static final MapCodec<DebugDisplayBlock> CODEC = simpleCodec(DebugDisplayBlock::new);

    public DebugDisplayBlock(Properties properties) {
        super(properties, () -> PotamAId.DEBUG_DISPLAY_ENTITY.get());
    }

    @Override
    protected MapCodec<? extends HorizontalDirectionalBlock> codec() { return CODEC; }
}
