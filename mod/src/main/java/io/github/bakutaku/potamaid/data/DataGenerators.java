package io.github.bakutaku.potamaid.data;

import io.github.bakutaku.potamaid.PotamAId;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import net.minecraft.core.HolderLookup;
import net.minecraft.data.DataGenerator;
import net.minecraft.data.PackOutput;
import net.minecraft.data.loot.LootTableProvider;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.storage.loot.parameters.LootContextParamSets;
import net.neoforged.neoforge.common.data.ExistingFileHelper;
import net.neoforged.neoforge.data.event.GatherDataEvent;

/** runData の入口。生成物は src/generated/resources に出力される。 */
public final class DataGenerators {
    private DataGenerators() {}

    public static void gather(GatherDataEvent event) {
        DataGenerator generator = event.getGenerator();
        PackOutput output = generator.getPackOutput();
        ExistingFileHelper files = event.getExistingFileHelper();
        CompletableFuture<HolderLookup.Provider> lookup = event.getLookupProvider();

        generator.addProvider(event.includeClient(), new ModBlockStates(output, files));
        generator.addProvider(event.includeServer(), new ModRecipes(output, lookup));
        generator.addProvider(event.includeServer(), new LootTableProvider(output, Set.of(),
                List.of(new LootTableProvider.SubProviderEntry(ModBlockLoot::new, LootContextParamSets.BLOCK)), lookup));
        generator.addProvider(event.includeServer(), new ModBlockTags(output, lookup, files));
    }

    /** データ生成で扱うブロックの一覧。例のブロックは今回の対象外。 */
    static Iterable<Block> blocks() {
        return List.of(PotamAId.CONSULT_DESK.get(), PotamAId.PROGRESS_BOARD.get(), PotamAId.NOTICE_LAMP.get());
    }
}
