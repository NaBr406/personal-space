package cn.nabr.personalspace.service;

import cn.nabr.personalspace.exception.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class CaptchaService {
    private static final int CAPTCHA_MAX = 5000;
    private static final long EXPIRE_MILLIS = 5 * 60 * 1000L;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, CaptchaEntry> captchaStore = new ConcurrentHashMap<>();

    public Map<String, String> createCaptcha() {
        cleanupExpired();
        if (captchaStore.size() >= CAPTCHA_MAX) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "服务繁忙，请稍后再试");
        }
        int a = random.nextInt(20) + 1;
        int b = random.nextInt(20) + 1;
        boolean plus = random.nextBoolean();
        int x = plus ? a : Math.max(a, b);
        int y = plus ? b : Math.min(a, b);
        int answer = plus ? x + y : x - y;
        String question = x + " " + (plus ? "+" : "-") + " " + y + " = ?";
        String token = java.util.UUID.randomUUID().toString().replace("-", "");
        captchaStore.put(token, new CaptchaEntry(answer, Instant.now().toEpochMilli() + EXPIRE_MILLIS));
        return Map.of("question", question, "token", token);
    }

    public void verify(String token, String answerText) {
        if (token == null || token.isBlank() || answerText == null || answerText.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "请完成验证码");
        }
        CaptchaEntry entry = captchaStore.get(token);
        if (entry == null || entry.expiresAt < Instant.now().toEpochMilli()) {
            captchaStore.remove(token);
            throw new ApiException(HttpStatus.BAD_REQUEST, "验证码已过期，请刷新");
        }
        int answer;
        try {
            answer = Integer.parseInt(answerText.trim());
        } catch (NumberFormatException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "验证码错误");
        }
        if (answer != entry.answer) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "验证码错误");
        }
        captchaStore.remove(token);
    }

    private void cleanupExpired() {
        long now = Instant.now().toEpochMilli();
        captchaStore.entrySet().removeIf(entry -> entry.getValue().expiresAt < now);
    }

    private record CaptchaEntry(int answer, long expiresAt) {}
}
