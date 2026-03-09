package cn.nabr.personalspace.model;

public record AnnouncementView(
        long id,
        long userId,
        String title,
        String content,
        int pinned,
        String createdAt,
        String authorName,
        String authorAvatar
) {}
