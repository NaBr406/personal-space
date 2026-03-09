package cn.nabr.personalspace.security;

import cn.nabr.personalspace.exception.ApiException;
import cn.nabr.personalspace.model.UserSummary;
import cn.nabr.personalspace.repository.AuthRepository;
import cn.nabr.personalspace.util.TokenUtils;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class AuthHelper {
    private final AuthRepository authRepository;

    public AuthHelper(AuthRepository authRepository) {
        this.authRepository = authRepository;
    }

    public UserSummary requireUser(HttpServletRequest request) {
        return getUser(request).orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "请先登录"));
    }

    public java.util.Optional<UserSummary> getUser(HttpServletRequest request) {
        String authHeader = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authHeader == null || authHeader.isBlank() || !authHeader.startsWith("Bearer ")) {
            return java.util.Optional.empty();
        }
        String token = authHeader.substring("Bearer ".length()).trim();
        if (token.isEmpty()) {
            return java.util.Optional.empty();
        }
        return authRepository.findUserByTokenHash(TokenUtils.sha256(token));
    }

    public String extractBearerToken(HttpServletRequest request) {
        String authHeader = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return null;
        }
        return authHeader.substring("Bearer ".length()).trim();
    }
}
