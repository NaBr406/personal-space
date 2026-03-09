package cn.nabr.personalspace.model;

public record UserSummary(
        long id,
        String username,
        String nickname,
        String avatar,
        String role
) {}
