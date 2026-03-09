package cn.nabr.personalspace.model;

public record PostView(
        long id,
        String content,
        String image,
        String thumbnail,
        String images,
        String thumbnails,
        long userId,
        int views,
        String createdAt,
        String authorName,
        String authorAvatar,
        int likeCount,
        int commentCount,
        Boolean liked
) {}
