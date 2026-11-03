package io.github.bakutaku.potamaid;

import org.slf4j.Logger;

import io.github.bakutaku.potamaid.block.ConsultDeskBlock;
import io.github.bakutaku.potamaid.block.DebugDisplayBlock;
import io.github.bakutaku.potamaid.block.HologramBlockEntity;
import io.github.bakutaku.potamaid.block.NoticeLampBlock;
import io.github.bakutaku.potamaid.block.ProgressBoardBlock;
import io.github.bakutaku.potamaid.data.DataGenerators;

import com.mojang.logging.LogUtils;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Rarity;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

// The value here should match an entry in the META-INF/neoforge.mods.toml file
@Mod(PotamAId.MODID)
public class PotamAId {
    // Define mod id in a common place for everything to reference
    public static final String MODID = "potamaid";
    // Directly reference a slf4j logger
    public static final Logger LOGGER = LogUtils.getLogger();
    // Create a Deferred Register to hold Blocks which will all be registered under the "potamaid" namespace
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MODID);
    // Create a Deferred Register to hold Items which will all be registered under the "potamaid" namespace
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MODID);
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITY_TYPES = DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, MODID);
    // Create a Deferred Register to hold CreativeModeTabs which will all be registered under the "potamaid" namespace
    public static final DeferredRegister<CreativeModeTab> CREATIVE_MODE_TABS = DeferredRegister.create(Registries.CREATIVE_MODE_TAB, MODID);

    // Creates a new Block with the id "potamaid:example_block", combining the namespace and path
    public static final DeferredBlock<Block> EXAMPLE_BLOCK = BLOCKS.registerSimpleBlock("example_block", BlockBehaviour.Properties.of().mapColor(MapColor.STONE));
    // Creates a new BlockItem with the id "potamaid:example_block", combining the namespace and path
    public static final DeferredItem<BlockItem> EXAMPLE_BLOCK_ITEM = ITEMS.registerSimpleBlockItem("example_block", EXAMPLE_BLOCK);

    // 画面付きの机。右クリックで相談画面を開く処理はクライアント側（client.ConsultDeskInteraction）にある。
    public static final DeferredBlock<ConsultDeskBlock> CONSULT_DESK = BLOCKS.registerBlock("consult_desk", ConsultDeskBlock::new,
            BlockBehaviour.Properties.of().mapColor(MapColor.WOOD).strength(2.0f).sound(SoundType.WOOD).noOcclusion());
    public static final DeferredItem<BlockItem> CONSULT_DESK_ITEM = ITEMS.registerSimpleBlockItem("consult_desk", CONSULT_DESK);

    // ホログラムを映す看板。描画はクライアント専用のクラス（client.hologram）にあり、BlockEntity は描画のためだけに置く。
    public static final DeferredBlock<ProgressBoardBlock> PROGRESS_BOARD = BLOCKS.registerBlock("progress_board", ProgressBoardBlock::new,
            BlockBehaviour.Properties.of().mapColor(MapColor.COLOR_CYAN).strength(2.0f).sound(SoundType.METAL).lightLevel(state -> 6).noOcclusion());
    public static final DeferredItem<BlockItem> PROGRESS_BOARD_ITEM = ITEMS.registerSimpleBlockItem("progress_board", PROGRESS_BOARD);
    public static final DeferredBlock<NoticeLampBlock> NOTICE_LAMP = BLOCKS.registerBlock("notice_lamp", NoticeLampBlock::new,
            BlockBehaviour.Properties.of().mapColor(MapColor.COLOR_ORANGE).strength(2.0f).sound(SoundType.METAL).noOcclusion());
    public static final DeferredItem<BlockItem> NOTICE_LAMP_ITEM = ITEMS.registerSimpleBlockItem("notice_lamp", NOTICE_LAMP);
    // 開発用の情報ディスプレイ。レシピもクリエイティブタブもなく、/give potamaid:debug_display でだけ手に入る。
    public static final DeferredBlock<DebugDisplayBlock> DEBUG_DISPLAY = BLOCKS.registerBlock("debug_display", DebugDisplayBlock::new,
            BlockBehaviour.Properties.of().mapColor(MapColor.COLOR_PURPLE).strength(2.0f).sound(SoundType.METAL).lightLevel(state -> 6).noOcclusion());
    public static final DeferredItem<BlockItem> DEBUG_DISPLAY_ITEM = ITEMS.registerSimpleBlockItem("debug_display", DEBUG_DISPLAY,
            new Item.Properties().rarity(Rarity.EPIC));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<HologramBlockEntity>> PROGRESS_BOARD_ENTITY = BLOCK_ENTITY_TYPES.register("progress_board",
            () -> BlockEntityType.Builder.of((pos, state) -> new HologramBlockEntity(PotamAId.PROGRESS_BOARD_ENTITY.get(), pos, state), PROGRESS_BOARD.get()).build(null));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<HologramBlockEntity>> NOTICE_LAMP_ENTITY = BLOCK_ENTITY_TYPES.register("notice_lamp",
            () -> BlockEntityType.Builder.of((pos, state) -> new HologramBlockEntity(PotamAId.NOTICE_LAMP_ENTITY.get(), pos, state), NOTICE_LAMP.get()).build(null));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<HologramBlockEntity>> DEBUG_DISPLAY_ENTITY = BLOCK_ENTITY_TYPES.register("debug_display",
            () -> BlockEntityType.Builder.of((pos, state) -> new HologramBlockEntity(PotamAId.DEBUG_DISPLAY_ENTITY.get(), pos, state), DEBUG_DISPLAY.get()).build(null));

    // Creates a new food item with the id "potamaid:example_id", nutrition 1 and saturation 2
    public static final DeferredItem<Item> EXAMPLE_ITEM = ITEMS.registerSimpleItem("example_item", new Item.Properties().food(new FoodProperties.Builder()
            .alwaysEdible().nutrition(1).saturationModifier(2f).build()));

    // Creates a creative tab with the id "potamaid:example_tab" for the example item, that is placed after the combat tab
    public static final DeferredHolder<CreativeModeTab, CreativeModeTab> EXAMPLE_TAB = CREATIVE_MODE_TABS.register("example_tab", () -> CreativeModeTab.builder()
            .title(Component.translatable("itemGroup.potamaid")) //The language key for the title of your CreativeModeTab
            .withTabsBefore(CreativeModeTabs.COMBAT)
            .icon(() -> EXAMPLE_ITEM.get().getDefaultInstance())
            .displayItems((parameters, output) -> {
                output.accept(EXAMPLE_ITEM.get());// Add the example item to the tab. For your own tabs, this method is preferred over the event
                output.accept(CONSULT_DESK_ITEM.get());
                output.accept(PROGRESS_BOARD_ITEM.get());
                output.accept(NOTICE_LAMP_ITEM.get());
            }).build());

    // The constructor for the mod class is the first code that is run when your mod is loaded.
    // FML will recognize some parameter types like IEventBus or ModContainer and pass them in automatically.
    public PotamAId(IEventBus modEventBus, ModContainer modContainer) {
        // Register the commonSetup method for modloading
        modEventBus.addListener(this::commonSetup);
        modEventBus.addListener(DataGenerators::gather);

        // Register the Deferred Register to the mod event bus so blocks get registered
        BLOCKS.register(modEventBus);
        // Register the Deferred Register to the mod event bus so items get registered
        ITEMS.register(modEventBus);
        BLOCK_ENTITY_TYPES.register(modEventBus);
        // Register the Deferred Register to the mod event bus so tabs get registered
        CREATIVE_MODE_TABS.register(modEventBus);

        // Register ourselves for server and other game events we are interested in.
        // Note that this is necessary if and only if we want *this* class (PotamAId) to respond directly to events.
        // Do not add this line if there are no @SubscribeEvent-annotated functions in this class, like onServerStarting() below.
        NeoForge.EVENT_BUS.register(this);

        // Register the item to a creative tab
        modEventBus.addListener(this::addCreative);

        // Register our mod's ModConfigSpec so that FML can create and load the config file for us
        modContainer.registerConfig(ModConfig.Type.COMMON, Config.SPEC);
    }

    private void commonSetup(FMLCommonSetupEvent event) {
        // Some common setup code
        LOGGER.info("HELLO FROM COMMON SETUP");

        if (Config.LOG_DIRT_BLOCK.getAsBoolean()) {
            LOGGER.info("DIRT BLOCK >> {}", BuiltInRegistries.BLOCK.getKey(Blocks.DIRT));
        }

        LOGGER.info("{}{}", Config.MAGIC_NUMBER_INTRODUCTION.get(), Config.MAGIC_NUMBER.getAsInt());

        Config.ITEM_STRINGS.get().forEach((item) -> LOGGER.info("ITEM >> {}", item));
    }

    // Add the example block item to the building blocks tab
    private void addCreative(BuildCreativeModeTabContentsEvent event) {
        if (event.getTabKey() == CreativeModeTabs.BUILDING_BLOCKS) {
            event.accept(EXAMPLE_BLOCK_ITEM);
        }
    }

    // You can use SubscribeEvent and let the Event Bus discover methods to call
    @SubscribeEvent
    public void onServerStarting(ServerStartingEvent event) {
        // Do something when the server starts
        LOGGER.info("HELLO from server starting");
    }
}
