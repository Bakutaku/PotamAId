package io.github.bakutaku.potamaid.data;

import io.github.bakutaku.potamaid.PotamAId;
import java.util.concurrent.CompletableFuture;
import net.minecraft.core.HolderLookup;
import net.minecraft.data.PackOutput;
import net.minecraft.data.recipes.RecipeCategory;
import net.minecraft.data.recipes.RecipeOutput;
import net.minecraft.data.recipes.RecipeProvider;
import net.minecraft.data.recipes.ShapedRecipeBuilder;
import net.minecraft.tags.ItemTags;
import net.minecraft.world.item.Items;

final class ModRecipes extends RecipeProvider {
    ModRecipes(PackOutput output, CompletableFuture<HolderLookup.Provider> lookup) {
        super(output, lookup);
    }

    @Override
    protected void buildRecipes(RecipeOutput output) {
        ShapedRecipeBuilder.shaped(RecipeCategory.DECORATIONS, PotamAId.CONSULT_DESK_ITEM.get())
                .pattern("GGG")
                .pattern("PRP")
                .pattern("P P")
                .define('G', Items.GLASS_PANE)
                .define('P', ItemTags.PLANKS)
                .define('R', Items.REDSTONE)
                .unlockedBy("has_redstone", has(Items.REDSTONE))
                .save(output);
    }
}
