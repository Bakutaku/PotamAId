package io.github.bakutaku.potamaid;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.event.config.ModConfigEvent;
import net.neoforged.neoforge.common.ModConfigSpec;

// An example config class. This is not required, but it's a good idea to have one to keep your config organized.
// Demonstrates how to use Neo's config APIs
public class Config {
    private static final ModConfigSpec.Builder BUILDER = new ModConfigSpec.Builder();

    public static final ModConfigSpec.BooleanValue LOG_DIRT_BLOCK = BUILDER
            .comment("Whether to log the dirt block on common setup")
            .define("logDirtBlock", true);

    public static final ModConfigSpec.IntValue MAGIC_NUMBER = BUILDER
            .comment("A magic number")
            .defineInRange("magicNumber", 42, 0, Integer.MAX_VALUE);

    public static final ModConfigSpec.ConfigValue<String> MAGIC_NUMBER_INTRODUCTION = BUILDER
            .comment("What you want the introduction message to be for the magic number")
            .define("magicNumberIntroduction", "The magic number is... ");

    // a list of strings that are treated as resource locations for items
    public static final ModConfigSpec.ConfigValue<List<? extends String>> ITEM_STRINGS = BUILDER
            .comment("A list of items to log on common setup.")
            .defineListAllowEmpty("items", List.of("minecraft:iron_ingot"), () -> "", Config::validateItemName);

    public static final ModConfigSpec.BooleanValue MCP_ENABLED = BUILDER.translation("potamaid.configuration.mcp.enabled")
            .comment("Enable the read-only game MCP in singleplayer. Restart the game after changing connection settings.").define("mcp.enabled", true);
    public static final ModConfigSpec.IntValue MCP_PORT = BUILDER.translation("potamaid.configuration.mcp.port")
            .comment("Fixed localhost MCP port. Use a different port for each concurrent game.").defineInRange("mcp.port", 38281, 1024, 65535);
    public static final ModConfigSpec.IntValue MCP_REQUEST_TIMEOUT = BUILDER.translation("potamaid.configuration.mcp.requestTimeoutSeconds")
            .comment("Timeout in seconds for a server-thread snapshot request.").defineInRange("mcp.requestTimeoutSeconds", 5, 1, 60);
    static final ModConfigSpec SPEC = BUILDER.build();

    private static final ModConfigSpec.Builder CLIENT_BUILDER = new ModConfigSpec.Builder();
    public static final ModConfigSpec.BooleanValue BRIDGE_ENABLED = CLIENT_BUILDER.translation("potamaid.configuration.bridge.enabled")
            .comment("Automatically connect to PotamAId Bridge on this PC.").define("bridge.enabled", true);
    public static final ModConfigSpec.ConfigValue<String> BRIDGE_PROJECT_ROOT = CLIENT_BUILDER.translation("potamaid.configuration.bridge.projectRoot")
            .comment("Leave empty to automatically match the game directory to a single project registered in Bridge.",
                    "Optional absolute project path override. Restart the game after changing this.").define("bridge.projectRoot", "");
    static final ModConfigSpec CLIENT_SPEC = CLIENT_BUILDER.build();

    private static boolean validateItemName(final Object obj) {
        return obj instanceof String itemName && BuiltInRegistries.ITEM.containsKey(ResourceLocation.parse(itemName));
    }
}
