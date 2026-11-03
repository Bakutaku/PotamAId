package io.github.bakutaku.potamaid.game;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.regex.Pattern;

/**
 * latest.log の末尾。ファイルの場所（ユーザー名を含みうる絶対パス）は返さない。
 * ログ自体にもユーザー名やパスが含まれうるため、AI（外部サービス）へ渡る点は利用手順に明記している。
 */
public record GameLogs(String file, long totalBytes, boolean truncated, String text) {
    /** 返す末尾の最大バイト数。超えた分は先頭側を切り捨てる。 */
    public static final int MAX_BYTES = 32 * 1024;

    private static final Pattern BEARER = Pattern.compile("(?i)Bearer\\s+[A-Za-z0-9._~+/=-]+");

    public static GameLogs readTail(Path file, int maxBytes) {
        if (maxBytes <= 0) {
            throw new IllegalArgumentException("maxBytes must be positive");
        }
        try (var input = new RandomAccessFile(file.toFile(), "r")) {
            long size = input.length();
            int length = (int) Math.min(size, maxBytes);
            boolean truncated = size > length;
            // 切り詰めるときは、読み始め位置の直前の1バイトも読み、行の境界かどうかを判定する。
            int extra = truncated ? 1 : 0;
            var bytes = new byte[length + extra];
            input.seek(size - length - extra);
            input.readFully(bytes);
            int start = extra;
            if (truncated && bytes[0] != '\n') {
                // 行の途中（文字の途中を含む）から始まるため、最初の改行の後から返す。
                while (start < bytes.length && bytes[start] != '\n') {
                    start++;
                }
                start = Math.min(start + 1, bytes.length);
            }
            var decoder = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPLACE)
                    .onUnmappableCharacter(CodingErrorAction.REPLACE);
            String text;
            try {
                text = decoder.decode(ByteBuffer.wrap(bytes, start, bytes.length - start)).toString();
            } catch (CharacterCodingException exception) {
                throw new UncheckedIOException(exception);
            }
            return new GameLogs("logs/" + file.getFileName(), size, truncated, redact(text));
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    /** ログに認証トークンが出ることはない設計だが、万一に備えて Bearer 形式を伏せる。 */
    static String redact(String text) {
        return BEARER.matcher(text).replaceAll("Bearer [REDACTED]");
    }
}
