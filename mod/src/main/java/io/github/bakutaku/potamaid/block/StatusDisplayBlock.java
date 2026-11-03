package io.github.bakutaku.potamaid.block;

import com.mojang.serialization.MapCodec;
import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;

/**
 * 状態ディスプレイ。Bridge・ゲーム MCP の接続と、目標・タスク・相談の状態を一覧で映す。
 * 右クリックでページを切り替える処理は client.ConsultDeskInteraction にあり、どのページかはクライアントだけが持つ。
 */
public class StatusDisplayBlock extends HologramBlock {
    public static final MapCodec<StatusDisplayBlock> CODEC = simpleCodec(StatusDisplayBlock::new);

    public StatusDisplayBlock(Properties properties) {
        super(properties, () -> PotamAId.STATUS_DISPLAY_ENTITY.get());
    }

    @Override
    protected MapCodec<? extends HorizontalDirectionalBlock> codec() { return CODEC; }
}
