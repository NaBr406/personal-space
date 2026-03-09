package cn.nabr.personalspace.model;

public record UserAuthView(
        long id,
        String username,
        String nickname,
        String avatar,
        String role,
        String token
) {}
