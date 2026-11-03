package io.github.bakutaku.potamaid.data;

import io.github.bakutaku.potamaid.PotamAId;
import java.util.Set;
import net.minecraft.core.HolderLookup;
import net.minecraft.data.loot.BlockLootSubProvider;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.level.block.Block;

final class ModBlockLoot extends BlockLootSubProvider {
    ModBlockLoot(HolderLookup.Provider registries) {
        super(Set.of(), FeatureFlags.REGISTRY.allFlags(), registries);
    }

    @Override
    protected void generate() {
        dropSelf(PotamAId.CONSULT_DESK.get());
        dropSelf(PotamAId.PROGRESS_BOARD.get());
        dropSelf(PotamAId.NOTICE_LAMP.get());
        dropSelf(PotamAId.STATUS_DISPLAY.get());
    }

    @Override
    protected Iterable<Block> getKnownBlocks() {
        return DataGenerators.blocks();
    }
}
