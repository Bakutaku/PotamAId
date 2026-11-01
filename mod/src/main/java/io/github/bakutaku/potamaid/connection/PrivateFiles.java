package io.github.bakutaku.potamaid.connection;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;

/** 接続情報を Git とワールドの外に保存する。秘密を書き込む前に権限を制限する。 */
public final class PrivateFiles {
    private PrivateFiles() {}

    public static String normalize(Path path) throws IOException {
        if (!path.isAbsolute() || !Files.isDirectory(path)) throw new IOException("実在する絶対パスのフォルダーを指定してください");
        String value = path.toRealPath().toString();
        return System.getProperty("os.name").startsWith("Windows") ? value.toLowerCase(Locale.ROOT) : value;
    }

    public static String gameId(Path path) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(normalize(path).getBytes(StandardCharsets.UTF_8)));
    }

    public static String token() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    public static void protect(Path path) throws IOException {
        if (Files.isSymbolicLink(path)) throw new IOException("接続情報の保存先にシンボリックリンクは使えません");
        var acl = Files.getFileAttributeView(path, AclFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (acl != null) {
            var user = path.getFileSystem().getUserPrincipalLookupService()
                    .lookupPrincipalByName(System.getProperty("user.name"));
            var entry = AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(user)
                    .setPermissions(EnumSet.allOf(AclEntryPermission.class)).build();
            acl.setAcl(List.of(entry));
            if (!acl.getAcl().equals(List.of(entry))) throw new IOException("接続情報のアクセス権を制限できません");
        } else {
            var posix = Files.getFileAttributeView(path, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
            if (posix == null) throw new IOException("接続情報のアクセス権を制限できない OS です");
            posix.setPermissions(PosixFilePermissions.fromString(Files.isDirectory(path) ? "rwx------" : "rw-------"));
        }
    }

    public static void directory(Path path) throws IOException {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
            if (path.getParent() != null && !Files.exists(path.getParent())) directory(path.getParent());
            Files.createDirectory(path);
        }
        protect(path);
    }

    public static void write(Path path, String text) throws IOException {
        directory(path.getParent());
        if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) protect(path);
        Path temp = Files.createTempFile(path.getParent(), ".connection-", ".tmp");
        try {
            protect(temp);
            Files.writeString(temp, text, StandardCharsets.UTF_8);
            Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temp);
        }
    }
}
