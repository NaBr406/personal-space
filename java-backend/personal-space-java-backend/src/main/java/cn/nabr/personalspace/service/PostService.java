package cn.nabr.personalspace.service;

import cn.nabr.personalspace.exception.ApiException;
import cn.nabr.personalspace.model.PostView;
import cn.nabr.personalspace.repository.PostRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class PostService {
    private final PostRepository postRepository;

    public PostService(PostRepository postRepository) {
        this.postRepository = postRepository;
    }

    public Map<String, Object> listPosts(Integer currentUserId, int page, int limit, String start, String end) {
        int safePage = Math.max(1, page);
        int safeLimit = Math.min(50, Math.max(1, limit));
        var posts = postRepository.findPosts(currentUserId, safePage, safeLimit, start, end);
        int total = postRepository.countPosts(start, end);
        Map<String, Object> pagination = new LinkedHashMap<>();
        pagination.put("page", safePage);
        pagination.put("limit", safeLimit);
        pagination.put("total", total);
        pagination.put("pages", (int) Math.ceil(total / (double) safeLimit));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("posts", posts);
        body.put("pagination", pagination);
        return body;
    }

    public PostView getPost(long id, Integer currentUserId) {
        return postRepository.findPostById(id, currentUserId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "动态不存在"));
    }

    public Map<String, Object> addView(long id) {
        int views = postRepository.incrementViews(id);
        return Map.of("views", views);
    }
}
