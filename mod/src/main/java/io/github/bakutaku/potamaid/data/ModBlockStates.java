package io.github.bakutaku.potamaid.data;

import io.github.bakutaku.potamaid.PotamAId;
import io.github.bakutaku.potamaid.block.HologramBlock;
import net.minecraft.core.Direction;
import net.minecraft.data.PackOutput;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.neoforged.neoforge.client.model.generators.BlockModelBuilder;
import net.neoforged.neoforge.client.model.generators.BlockStateProvider;
import net.neoforged.neoforge.client.model.generators.ConfiguredModel;
import net.neoforged.neoforge.client.model.generators.ModelFile;
import net.neoforged.neoforge.common.data.ExistingFileHelper;

/** 相談デスクとホログラムの看板のモデルとブロック状態。看板の表の面だけ Mod のテクスチャを使う。 */
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

        horizontal(PotamAId.PROGRESS_BOARD.get(), panelModel("progress_board", "minecraft:block/cyan_terracotta"));
        horizontal(PotamAId.NOTICE_LAMP.get(), panelModel("notice_lamp", "minecraft:block/orange_terracotta"));
    }

    /** 北向きで作ったモデルを、FACING に合わせて回す。 */
    private void horizontal(Block block, BlockModelBuilder model) {
        getVariantBuilder(block).forAllStates(state -> {
            Direction facing = state.getValue(HorizontalDirectionalBlock.FACING);
            return ConfiguredModel.builder().modelFile(model).rotationY(((int) facing.toYRot() + 180) % 360).build();
        });
        simpleBlockItem(block, (ModelFile) model);
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

    /**
     * ホログラムの看板: 裏側に寄せた薄い板。表（北側の面）にホログラムが映る。
     * 進捗ボードと通知ランプは形と表の面が同じで、縁と裏の色だけで見分ける。
     */
    private BlockModelBuilder panelModel(String name, String edge) {
        BlockModelBuilder model = models().getBuilder("block/" + name)
                .texture("particle", PotamAId.MODID + ":block/hologram_plate")
                .texture("plate", PotamAId.MODID + ":block/hologram_plate")
                .texture("edge", edge);
        int depth = HologramBlock.PLATE_DEPTH;
        var element = model.element().from(0, 0, 16 - depth).to(16, 16, 16);
        element.face(Direction.NORTH).texture("#plate").uvs(0, 0, 16, 16).end();
        element.face(Direction.SOUTH).texture("#edge").uvs(0, 0, 16, 16).end();
        element.face(Direction.EAST).texture("#edge").uvs(16 - depth, 0, 16, 16).end();
        element.face(Direction.WEST).texture("#edge").uvs(0, 0, depth, 16).end();
        element.face(Direction.UP).texture("#edge").uvs(0, 16 - depth, 16, 16).end();
        element.face(Direction.DOWN).texture("#edge").uvs(0, 0, 16, depth).end();
        element.end();
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
