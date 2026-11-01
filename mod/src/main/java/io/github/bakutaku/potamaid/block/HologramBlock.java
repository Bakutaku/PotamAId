package io.github.bakutaku.potamaid.block;

import java.util.function.Supplier;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.EntityBlock;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * ホログラムの看板を映す薄い板の共通部分。表（FACING の向き）にホログラムが映り、板は裏側に寄せて置く。
 * 同じ種類・同じ向きで隣り合うと、描画側（client.hologram）で 1 枚の大きな看板として連結して描く。連結のためのデータは持たない。
 * 描画は client.hologram 側にあり、このクラスは画面や描画を参照しない。右クリックで相談画面を開く処理は client.ConsultDeskInteraction にある。
 */
public abstract class HologramBlock extends HorizontalDirectionalBlock implements EntityBlock {
    /** 板の厚さ（ピクセル）。 */
    public static final int PLATE_DEPTH = 2;
    private static final VoxelShape NORTH = Block.box(0, 0, 16 - PLATE_DEPTH, 16, 16, 16);
    private static final VoxelShape SOUTH = Block.box(0, 0, 0, 16, 16, PLATE_DEPTH);
    private static final VoxelShape EAST = Block.box(0, 0, 0, PLATE_DEPTH, 16, 16);
    private static final VoxelShape WEST = Block.box(16 - PLATE_DEPTH, 0, 0, 16, 16, 16);

    private final Supplier<? extends BlockEntityType<HologramBlockEntity>> type;

    protected HologramBlock(Properties properties, Supplier<? extends BlockEntityType<HologramBlockEntity>> type) {
        super(properties);
        this.type = type;
        registerDefaultState(stateDefinition.any().setValue(FACING, Direction.NORTH));
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(FACING);
    }

    /** 壁の横面に置いたときは壁に掛け、それ以外は置いた人の方へ表を向けて立てる。 */
    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        Direction face = context.getClickedFace();
        Direction facing = face.getAxis().isHorizontal() ? face : context.getHorizontalDirection().getOpposite();
        return defaultBlockState().setValue(FACING, facing);
    }

    @Override
    public BlockEntity newBlockEntity(BlockPos pos, BlockState state) {
        return new HologramBlockEntity(type.get(), pos, state);
    }

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return switch (state.getValue(FACING)) {
            case SOUTH -> SOUTH;
            case EAST -> EAST;
            case WEST -> WEST;
            default -> NORTH;
        };
    }
}
