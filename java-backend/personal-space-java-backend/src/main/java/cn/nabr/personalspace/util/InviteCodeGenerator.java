package cn.nabr.personalspace.util;

import java.security.SecureRandom;

public final class InviteCodeGenerator {
    private static final char[] HEX = "0123456789ABCDEF".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();

    private InviteCodeGenerator() {}

    public static String generate() {
        char[] chars = new char[8];
        for (int i = 0; i < chars.length; i++) {
            chars[i] = HEX[RANDOM.nextInt(HEX.length)];
        }
        return new String(chars);
    }
}
