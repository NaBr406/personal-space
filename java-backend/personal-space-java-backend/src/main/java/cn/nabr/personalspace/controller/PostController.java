package cn.nabr.personalspace.controller;

import cn.nabr.personalspace.security.AuthHelper;
import cn.nabr.personalspace.service.PostService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/posts")
public class PostController {
    private final PostService postService;
    private final AuthHelper authHelper;

    public PostController(PostService postService, AuthHelper authHelper) {
        this.postService = postService;
        this.authHelper = authHelper;
    }

    @GetMapping
    public Map<String, Object> listPosts(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(required = false) String start,
            @RequestParam(required = false) String end,
            HttpServletRequest request
    ) {
        Integer userId = authHelper.getUser(request).map(user -> (int) user.id()).orElse(null);
        return postService.listPosts(userId, page, limit, start, end);
    }

    @GetMapping("/{id}")
    public Object getPost(@PathVariable long id, HttpServletRequest request) {
        Integer userId = authHelper.getUser(request).map(user -> (int) user.id()).orElse(null);
        return postService.getPost(id, userId);
    }

    @PostMapping("/{id}/view")
    public Map<String, Object> addView(@PathVariable long id) {
        return postService.addView(id);
    }
}
