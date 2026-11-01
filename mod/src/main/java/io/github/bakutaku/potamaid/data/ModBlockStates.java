package io.github.bakutaku.potamaid.data;

import io.github.bakutaku.potamaid.PotamAId;
import net.minecraft.core.Direction;
import net.minecraft.data.PackOutput;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.neoforged.neoforge.client.model.generators.BlockModelBuilder;
import net.neoforged.neoforge.client.model.generators.BlockStateProvider;
import net.neoforged.neoforge.client.model.generators.ConfiguredModel;
import net.neoforged.neoforge.client.model.generators.ModelFile;
import net.neoforged.neoforge.common.data.ExistingFileHelper;

/** 相談デスクのモデルとブロック状態。バニラのテクスチャだけを使う。 */
final class ModBlockStates extends BlockStateProvider {
    ModBlockStates(PackOutput output, ExistingFileHelper files) {
        super(output, PotamAId.MODID, files);
    }

    @Override
    protected void registerStatesAndModels() {
        BlockModelBuilder desk = deskModel();
        getVariantBuilder(PotamAId.CONSULT_DESK.get()).forAllStates(state -> {
            Direction facing = state.getValue(HorizontalDirectionalBlock.FACING);
            return ConfiguredModel.builder().modelFile(desk).rotationY(((int) facing.toYRot() + 180) % 360).build();
        });
        simpleBlockItem(PotamAId.CONSULT_DESK.get(), (ModelFile) desk);
    }

    /** モデルは北向き（画面が北側の面）で作り、向きに応じて回転する。 */
    private BlockModelBuilder deskModel() {
        BlockModelBuilder model = models().getBuilder("block/consult_desk")
                .texture("particle", "minecraft:block/oak_planks")
                .texture("wood", "minecraft:block/oak_planks")
                .texture("frame", "minecraft:block/black_concrete")
                .texture("screen", "minecraft:block/blue_concrete");
        // 天板
        box(model, 0, 6, 0, 16, 8, 16, "#wood", "#wood");
        // 脚
        for (int x : new int[] { 0, 14 }) for (int z : new int[] { 0, 14 }) box(model, x, 0, z, x + 2, 6, z + 2, "#wood", "#wood");
        // モニターの台と本体（画面は北側の面）
        box(model, 7, 8, 7, 9, 10, 9, "#frame", "#frame");
        box(model, 2, 10, 9, 14, 16, 11, "#frame", "#screen");
        return model;
    }

    private static void box(BlockModelBuilder model, int x1, int y1, int z1, int x2, int y2, int z2, String body, String north) {
        var element = model.element().from(x1, y1, z1).to(x2, y2, z2);
        for (Direction direction : Direction.values()) {
            element.face(direction).texture(direction == Direction.NORTH ? north : body).uvs(0, 0, 16, 16).end();
        }
        element.end();
    }
}
