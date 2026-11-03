package io.github.bakutaku.potamaid.game;

import java.util.List;

/** 取得時点の値だけを保持する。mods には minecraft・neoforge 自体も含まれる。 */
public record ModEnvironment(
        String minecraftVersion,
        String neoForgeVersion,
        String javaVersion,
        List<Mod> mods) {

    public record Mod(String id, String name, String version) {
    }
}
