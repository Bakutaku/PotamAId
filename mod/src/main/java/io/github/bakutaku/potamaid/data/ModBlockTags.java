package io.github.bakutaku.potamaid.data;

import io.github.bakutaku.potamaid.PotamAId;
import java.util.concurrent.CompletableFuture;
import net.minecraft.core.HolderLookup;
import net.minecraft.data.PackOutput;
import net.minecraft.tags.BlockTags;
import net.neoforged.neoforge.common.data.BlockTagsProvider;
import net.neoforged.neoforge.common.data.ExistingFileHelper;

final class ModBlockTags extends BlockTagsProvider {
    ModBlockTags(PackOutput output, CompletableFuture<HolderLookup.Provider> lookup, ExistingFileHelper files) {
        super(output, lookup, PotamAId.MODID, files);
    }

    @Override
    protected void addTags(HolderLookup.Provider provider) {
        tag(BlockTags.MINEABLE_WITH_AXE).add(PotamAId.CONSULT_DESK.get());
        tag(BlockTags.MINEABLE_WITH_PICKAXE).add(PotamAId.PROGRESS_BOARD.get(), PotamAId.NOTICE_LAMP.get(), PotamAId.STATUS_DISPLAY.get());
    }
}
