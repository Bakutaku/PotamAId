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
        ShapedRecipeBuilder.shaped(RecipeCategory.DECORATIONS, PotamAId.PROGRESS_BOARD_ITEM.get())
                .pattern("GGG")
                .pattern("LRL")
                .pattern("SSS")
                .define('G', Items.GLASS_PANE)
                .define('L', Items.LAPIS_LAZULI)
                .define('R', Items.REDSTONE)
                .define('S', Items.STONE_SLAB)
                .unlockedBy("has_redstone", has(Items.REDSTONE))
                .save(output);
        ShapedRecipeBuilder.shaped(RecipeCategory.DECORATIONS, PotamAId.NOTICE_LAMP_ITEM.get())
                .pattern("G")
                .pattern("R")
                .pattern("S")
                .define('G', Items.GLASS_PANE)
                .define('R', Items.REDSTONE)
                .define('S', Items.STONE_SLAB)
                .unlockedBy("has_redstone", has(Items.REDSTONE))
                .save(output);
        ShapedRecipeBuilder.shaped(RecipeCategory.DECORATIONS, PotamAId.STATUS_DISPLAY_ITEM.get())
                .pattern("GGG")
                .pattern("ACA")
                .pattern("SSS")
                .define('G', Items.GLASS_PANE)
                .define('A', Items.AMETHYST_SHARD)
                .define('C', Items.COMPARATOR)
                .define('S', Items.STONE_SLAB)
                .unlockedBy("has_redstone", has(Items.REDSTONE))
                .save(output);
    }
}
